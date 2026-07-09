import { supabase, hasSupabase } from '../supabase'

/**
 * Cola local de posiciones GPS (buffer offline). Cada fix se guarda PRIMERO en
 * localStorage y se intenta enviar; si no hay red (o el envío falla), queda en la
 * cola y se reintenta después. Así el recorrido NO se pierde al perder datos
 * móviles ni con la pantalla bloqueada: se acumula localmente y se sube cuando hay
 * conexión. Cada punto conserva su `ts` real (no el de subida).
 */
const KEY = 'lu-pos-queue'
const MAX = 8000        // tope de puntos en cola (una jornada larga entra de sobra)
const BATCH = 200       // filas por request al hacer flush

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch (_) { return [] }
}
function write(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr.slice(-MAX))) } catch (_) {}
}

/** Agrega un punto a la cola local. row: {id_usuario, rol, lat, lng, accuracy?, id_empresa, ts} */
export function enqueuePosicion(row) {
  const q = read()
  q.push(row)
  write(q)
}

let flushing = false

/**
 * Sube a Supabase todos los puntos pendientes, por lotes. Si un lote falla (sin
 * red), corta y los deja para el próximo intento. Se puede llamar seguido: si ya
 * hay un flush en curso, no hace nada.
 */
export async function flushPosiciones() {
  if (!hasSupabase || flushing) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return
  flushing = true
  try {
    // Bucle por lotes mientras haya cola y los envíos anden.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const q = read()
      if (!q.length) break
      const batch = q.slice(0, BATCH)
      const { error } = await supabase.from('posiciones').insert(batch)
      if (error) break // sin red / error: se reintenta luego, sin perder nada
      write(read().slice(batch.length)) // re-leer por si entraron nuevos mientras tanto
    }
  } catch (_) {
    /* sin red: los puntos quedan en la cola */
  } finally {
    flushing = false
  }
}

/** Cantidad de puntos pendientes de subir (para mostrar estado). */
export function pendingCount() {
  return read().length
}
