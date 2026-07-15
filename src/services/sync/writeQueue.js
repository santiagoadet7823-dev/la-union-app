import { supabase, hasSupabase } from '../supabase'
import { persistence } from '../persistence'

/**
 * Cola de ESCRITURAS offline genérica (altas/ediciones). Mismo espíritu que la cola
 * de posiciones, pero para mutaciones de catálogo (clientes, productos, zonas): si
 * no hay red, la operación NO se pierde — se guarda local y se sincroniza al volver
 * la conexión. Usa el puerto `persistence` (async), así en la APK puede pasar a
 * SQLite sin tocar este archivo.
 *
 * Cada mutación: { op_uid, table, op:'insert'|'update'|'delete', payload, id? }.
 * - insert: upsert(onConflict:'id', ignoreDuplicates) → reintentar no duplica.
 * - update: update(payload).eq('id', id).
 * - delete: delete().eq('id', id) → reintentar es idempotente (borrar lo ya borrado no falla).
 * El id de las filas nuevas lo genera el cliente (uuid), así la fila optimista y la
 * de la base comparten el mismo id.
 */
const KEY = 'lu-write-queue'
const MAX = 2000

let flushing = false
let started = false

async function read() { return (await persistence.get(KEY, [])) || [] }
async function write(arr) {
  await persistence.set(KEY, arr.length > MAX ? arr.slice(-MAX) : arr)
}

/** Encola una mutación para sincronizar. */
export async function enqueueMutacion(mut) {
  const q = await read()
  q.push(mut)
  await write(q)
}

/** Sube las mutaciones pendientes en orden (FIFO). Corta al primer fallo/sin red. */
export async function flushMutaciones() {
  if (!hasSupabase || flushing) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  flushing = true
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const q = await read()
      if (!q.length) break
      const m = q[0]
      let error = null
      if (m.op === 'insert') {
        ({ error } = await supabase.from(m.table).upsert(m.payload, { onConflict: 'id', ignoreDuplicates: true }))
      } else if (m.op === 'update') {
        ({ error } = await supabase.from(m.table).update(m.payload).eq('id', m.id))
      } else if (m.op === 'delete') {
        ({ error } = await supabase.from(m.table).delete().eq('id', m.id))
      } // op desconocida → se descarta (error queda null y se saca de la cola)
      if (error) break
      const q2 = await read()
      await write(q2.slice(1)) // re-leer por si entraron nuevas mientras tanto
    }
  } catch (_) {
    /* sin red: las mutaciones quedan encoladas */
  } finally {
    flushing = false
  }
}

/** Cantidad de mutaciones pendientes (para diagnóstico/estado). */
export async function pendingMutaciones() { return (await read()).length }

/** Arranca el auto-flush (una sola vez): al recuperar red y cada 30 s. */
export function startWriteQueue() {
  if (started || typeof window === 'undefined') return
  started = true
  flushMutaciones()
  window.addEventListener('online', () => flushMutaciones())
  setInterval(() => flushMutaciones(), 30000)
}
