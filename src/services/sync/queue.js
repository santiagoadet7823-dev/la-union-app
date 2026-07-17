import { supabase, hasSupabase } from '../supabase'
import { persistence } from '../persistence'

/**
 * Cola local de posiciones GPS (buffer offline). Cada fix se guarda PRIMERO en el
 * almacenamiento local y se intenta enviar; si no hay red (o el envío falla), queda
 * en la cola y se reintenta después. Así el recorrido NO se pierde al perder datos
 * móviles ni con la pantalla bloqueada. Cada punto conserva su `ts` real.
 *
 * Persiste vía el puerto `persistence` (async): localStorage en web, SQLite en la
 * APK. Las lecturas/escrituras se serializan con un mutex para que el enqueue y el
 * flush no se pisen (read-modify-write concurrente).
 */
const KEY = 'lu-pos-queue'
const MAX = 8000        // tope de puntos en cola (una jornada larga entra de sobra)
const BATCH = 200       // filas por request al hacer flush

// Telemetría de pérdida: antes los descartes (desborde FIFO al pasar MAX, o fallo
// de almacenamiento) se tragaban en catch vacíos. Ahora se cuentan y avisan.
let dropsPorDesborde = 0
let dropsPorCuota = 0

// Mutex: encadena las operaciones de la cola para evitar interleaving.
let chain = Promise.resolve()
function serialize(fn) {
  const next = chain.then(fn, fn)
  chain = next.catch(() => {})
  return next
}

async function read() {
  return (await persistence.get(KEY, [])) || []
}
async function writeRaw(arr) {
  if (arr.length > MAX) {
    dropsPorDesborde += arr.length - MAX
    console.warn(`[cola GPS] desborde: ${arr.length - MAX} puntos viejos descartados (tope ${MAX}). Total: ${dropsPorDesborde}`)
    arr = arr.slice(-MAX)
  }
  try {
    await persistence.set(KEY, arr)
  } catch (_) {
    dropsPorCuota++
    console.warn(`[cola GPS] fallo de almacenamiento al guardar la cola. Total: ${dropsPorCuota}`)
  }
}

/** Agrega un punto a la cola local. row: {id_usuario, rol, lat, lng, accuracy?, id_empresa, ts, client_uid} */
export function enqueuePosicion(row) {
  return serialize(async () => {
    const q = await read()
    q.push(row)
    await writeRaw(q)
  })
}

let flushing = false

/**
 * Sube a Supabase todos los puntos pendientes, por lotes. Si un lote falla (sin
 * red), corta y los deja para el próximo intento. Reentrante: si ya hay un flush en
 * curso, no hace nada.
 */
export async function flushPosiciones() {
  if (!hasSupabase || flushing) return
  // NOTA: NO cortar por `navigator.onLine === false`. En algunos WebView de la APK ese flag
  // queda mal (reporta offline estando conectado) y bloqueaba TODAS las subidas de posiciones
  // (mientras estado_dispositivo, que no lo usa, seguía subiendo). Si no hay red, el upsert
  // falla y se reintenta igual — el guard sobra y era una fuente de "no envía nada".
  flushing = true
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const q = await read()
      if (!q.length) break
      const batch = q.slice(0, BATCH)
      // upsert + ignoreDuplicates sobre client_uid: si un batch se commiteó pero se
      // perdió la respuesta y se reintenta, las filas ya insertadas se ignoran en
      // vez de duplicarse (cierra la ventana de duplicación por respuesta perdida).
      const { error } = await supabase.from('posiciones').upsert(batch, { onConflict: 'client_uid', ignoreDuplicates: true })
      if (error) break // sin red / error: se reintenta luego, sin perder nada
      // Sacar el batch subido (serializado, re-leyendo por si entraron nuevos).
      await serialize(async () => {
        const cur = await read()
        await writeRaw(cur.slice(batch.length))
      })
    }
  } catch (_) {
    /* sin red: los puntos quedan en la cola */
  } finally {
    flushing = false
  }
}

let posStarted = false
/**
 * Arranca el auto-flush GLOBAL de la cola de posiciones (una sola vez), independiente de que el
 * rastreo esté activo. Antes el único flush vivía en `usePublishPosition`, gateado por `enabled`
 * y por que el componente estuviera montado (app en primer plano): si el vendedor reconectaba con
 * la jornada terminada / fuera de horario, o con la app en background, los puntos capturados
 * offline quedaban encolados para SIEMPRE sin subir. Con esto, la cola drena SIEMPRE que la app
 * esté viva y con red — mismo patrón que `startWriteQueue`.
 *
 * `visibilitychange` es el disparador clave del caso "salí sin internet y al volver abrí la app":
 * en background el WebView se congela (timers y `online` no corren), así que al volver a primer
 * plano se dispara el flush ya mismo, sin esperar el próximo fix GPS ni los 30 s.
 */
export function startPosQueue() {
  if (posStarted || typeof window === 'undefined') return
  posStarted = true
  flushPosiciones()
  window.addEventListener('online', () => flushPosiciones())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushPosiciones() })
  setInterval(() => flushPosiciones(), 30000)
}

/** Cantidad de puntos pendientes de subir (para mostrar estado). */
export async function pendingCount() {
  return (await read()).length
}

/** Estado de la cola: pendientes + descartes acumulados (diagnóstico/telemetría). */
export async function queueStats() {
  return { pendientes: (await read()).length, dropsPorDesborde, dropsPorCuota }
}
