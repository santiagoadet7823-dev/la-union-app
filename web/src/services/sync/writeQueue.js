import { supabase, hasSupabase } from '../supabase'
import { persistence } from '../persistence'

/**
 * Cola de ESCRITURAS offline genérica (altas/ediciones). Mismo espíritu que la cola
 * de posiciones, pero para mutaciones de catálogo (clientes, productos, zonas): si
 * no hay red, la operación NO se pierde — se guarda local y se sincroniza al volver
 * la conexión. Usa el puerto `persistence` (async), así en la APK puede pasar a
 * SQLite sin tocar este archivo.
 *
 * Cada mutación: { op_uid, table, op:'insert'|'update'|'updateMany'|'delete'|'borrarArchivos', payload, id?, ids? }.
 * - insert:     upsert(onConflict:'id', ignoreDuplicates) → reintentar no duplica.
 * - update:     update(payload).eq('id', id).
 * - updateMany: update(payload).in('id', ids) → UNA entrada para N filas.
 * - delete:     delete().eq('id', id) → reintentar es idempotente (borrar lo ya borrado no falla).
 * - borrarArchivos: Storage, no tabla. `{ bucket, paths[] }` → remove(paths).
 * El id de las filas nuevas lo genera el cliente (uuid), así la fila optimista y la
 * de la base comparten el mismo id.
 *
 * 🩸 POR QUÉ EXISTE `updateMany` (28/07/2026): archivar los 195 clientes basura de la importación
 * encolaba 195 entradas de una. Con `MAX = 2000` y `slice(-MAX)`, una acción de lote puede empujar
 * fuera de la ventana mutaciones más VIEJAS todavía sin subir, y se pierden sin un solo aviso —
 * exactamente lo que prohíbe la regla 20 de CLAUDE.md ("nunca borrar de una cola"). Toda acción
 * masiva nueva tiene que entrar por acá, no por un `for` que llame N veces a `enqueueMutacion`.
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
  // NOTA: NO cortar por `navigator.onLine === false`. En algunos WebView de la APK ese flag
  // queda mal (reporta offline estando conectado) y bloqueaba TODAS las mutaciones (altas/
  // ediciones de catálogo) estando la red OK. Si no hay red, el request falla y se reintenta
  // igual — el guard sobra y era una fuente de "no sincroniza nada". Igual criterio que queue.js.
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
      } else if (m.op === 'updateMany') {
        // Sin ids no hay nada que hacer, y `.in('id', [])` es un no-op caro: se descarta.
        if (Array.isArray(m.ids) && m.ids.length) {
          ({ error } = await supabase.from(m.table).update(m.payload).in('id', m.ids))
        }
      } else if (m.op === 'delete') {
        ({ error } = await supabase.from(m.table).delete().eq('id', m.id))
      } else if (m.op === 'borrarArchivos') {
        /* 🩸 LA FOTO NO SE BORRABA NUNCA (18/08/2026). `deleteProducto` encolaba el DELETE de la
         * fila y no tocaba Storage, así que cada producto eliminado dejaba su imagen para siempre.
         * Medido el 18/08: **626 fotos huérfanas (13 MB) contra 0 productos**.
         *
         * Va por la cola y no por un `await` suelto en el contexto porque las mutaciones de
         * catálogo van SIEMPRE por acá (es regla del repo): si se borra un producto sin red, el
         * DELETE de la fila se encola y la foto tiene que seguir el mismo camino. Si no, la fila
         * se va al reconectar y el archivo queda huérfano igual — el bug, con más pasos.
         *
         * ⚠️ IDEMPOTENTE Y SIN TAPONAR: `remove()` sobre algo que ya no está **no es error** en la
         * API de Storage, así que un reintento pasa limpio. Y un fallo de PERMISO tampoco puede
         * frenar la cola: sería un archivo perdido bloqueando altas y ediciones de catálogo detrás
         * suyo, que es mucho peor que la foto que quedó. Por eso el error se anota y NO se propaga
         * (la cola corta al primer `error` no nulo, ver el `if (error) break` de abajo).
         */
        const { error: eStorage } = await supabase.storage.from(m.bucket).remove(m.paths || [])
        if (eStorage) console.warn('[writeQueue] no se pudo borrar el archivo', m.paths, eStorage.message)
      } else {
        // Op desconocida. Se descarta igual (si no, tapona la cola para siempre), pero se GRITA:
        // el caso real es un APK que revierte a un bundle OTA anterior y se encuentra con
        // mutaciones encoladas por una versión más nueva. Antes esto pasaba en absoluto silencio.
        console.error('[writeQueue] operación desconocida, se descarta', m)
      }
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

/**
 * Las mutaciones pendientes de UNA tabla, para poder MOSTRARLAS.
 *
 * 🩸 Existe por "Mis pedidos" (20/08/2026). Un vendedor sin señal confirma un pedido, entra a
 * revisarlo y —si la lista saliera solo de Supabase— no lo encuentra: la fila todavía está acá,
 * esperando red. Que no aparezca se lee como "se perdió", que es justo lo contrario de lo que la
 * cola garantiza. Una pantalla que no puede ver la cola tiene que mentir sobre ella.
 *
 * Devuelve los payloads crudos, no filas de la base: quien las muestre tiene que marcarlas como
 * "sin subir" y no mezclarlas de callado con lo confirmado.
 */
export async function pendientesDe(table, op = 'insert') {
  const q = await read()
  return q.filter((m) => m.table === table && m.op === op).map((m) => m.payload)
}

/** Arranca el auto-flush (una sola vez): al recuperar red y cada 30 s. */
export function startWriteQueue() {
  if (started || typeof window === 'undefined') return
  started = true
  flushMutaciones()
  window.addEventListener('online', () => flushMutaciones())
  setInterval(() => flushMutaciones(), 30000)
}
