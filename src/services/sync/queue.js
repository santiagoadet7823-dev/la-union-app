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
let dropsPorAjeno = 0
let dropsPorRechazo = 0

/**
 * Usuario dueño de la cola AHORA. La clave `lu-pos-queue` es del DISPOSITIVO, no del
 * usuario: si en el mismo teléfono se cierra sesión y entra otra cuenta, los puntos de
 * la anterior quedan en la cola. Esos puntos son VENENO: la policy `posiciones_ins`
 * exige `id_usuario = auth.uid()`, así que RLS los rechaza para siempre, y como el
 * flush cortaba al primer lote fallido, tapaban la cola y NINGÚN punto posterior subía
 * nunca más (18/07/2026: 264 puntos atascados, error 42501 cada 30s durante 8 horas,
 * un recorrido entero perdido — y `estado_dispositivo` seguía subiendo, que es lo que
 * hacía parecer que "la app andaba bien").
 *
 * Se setea junto con la identidad del tracker. Si es null (rastreo apagado, sesión sin
 * abrir) NO se descarta nada: ante la duda, se conserva.
 */
let usuarioActual = null
export function setUsuarioCola(id) { usuarioActual = id || null }

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
 * Códigos de Postgres que NO se arreglan reintentando: la fila es inválida para esta
 * sesión y lo va a seguir siendo. Ante uno de estos hay que DESCARTAR el lote, no
 * reintentarlo — si no, tapona la cola para siempre (ver `usuarioActual`).
 * Cualquier otro error (sin red, timeout, 5xx) se reintenta como antes.
 */
const CODIGOS_PERMANENTES = new Set([
  '42501', // violación de RLS (id_usuario/id_empresa que no son los de la sesión)
  '23514', // check constraint
  '22P02', // sintaxis de entrada inválida (uuid/numérico corrupto en la cola)
  '23503', // FK: el usuario o la empresa ya no existen
])

/** Saca de la cola los puntos que no son del usuario logueado ahora. */
async function purgarAjenos() {
  await serialize(async () => {
    const q = await read()
    const propios = q.filter((r) => r.id_usuario === usuarioActual)
    const ajenos = q.length - propios.length
    if (!ajenos) return
    dropsPorAjeno += ajenos
    console.warn(`[cola GPS] ${ajenos} puntos de otra cuenta descartados (destapan la cola). Total: ${dropsPorAjeno}`)
    await writeRaw(propios)
  })
}

/**
 * Sube a Supabase todos los puntos pendientes, por lotes. Reentrante: si ya hay un
 * flush en curso, no hace nada.
 *
 * Ante un error TRANSITORIO (sin red) corta y deja todo para el próximo intento, sin
 * perder nada. Ante uno PERMANENTE (CODIGOS_PERMANENTES) descarta el lote y sigue: ese
 * lote no va a entrar nunca y, si no se saca, tapona la cola entera.
 */
export async function flushPosiciones() {
  if (!hasSupabase || flushing) return
  // Tope de vueltas: la cola tiene MAX puntos y cada vuelta consume un lote, así que
  // con MAX/BATCH alcanza de sobra. Es un cinturón por si writeRaw no logra persistir
  // el recorte (cuota llena): sin esto el bucle giraría en vacío sobre el mismo lote.
  let vueltas = 0
  const MAX_VUELTAS = Math.ceil(MAX / BATCH) + 2
  // NOTA: NO cortar por `navigator.onLine === false`. En algunos WebView de la APK ese flag
  // queda mal (reporta offline estando conectado) y bloqueaba TODAS las subidas de posiciones
  // (mientras estado_dispositivo, que no lo usa, seguía subiendo). Si no hay red, el upsert
  // falla y se reintenta igual — el guard sobra y era una fuente de "no envía nada".
  flushing = true
  try {
    // Antes de intentar nada: sacar los puntos de OTRO usuario (ver `usuarioActual`).
    // Van a ser rechazados por RLS siempre, así que no son "pendientes": son un tapón.
    if (usuarioActual) await purgarAjenos()

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (++vueltas > MAX_VUELTAS) {
        console.error('[cola GPS] flush abortado por tope de vueltas: la cola no se está achicando (¿almacenamiento lleno?).')
        break
      }
      const q = await read()
      if (!q.length) break
      const batch = q.slice(0, BATCH)
      // upsert + ignoreDuplicates sobre client_uid: si un batch se commiteó pero se
      // perdió la respuesta y se reintenta, las filas ya insertadas se ignoran en
      // vez de duplicarse (cierra la ventana de duplicación por respuesta perdida).
      const { error } = await supabase.from('posiciones').upsert(batch, { onConflict: 'client_uid', ignoreDuplicates: true })
      if (error) {
        // Error TRANSITORIO (sin red, timeout, 5xx): cortar y reintentar luego, sin perder nada.
        if (!CODIGOS_PERMANENTES.has(error.code)) break
        // Error PERMANENTE: este lote no va a entrar nunca. Descartarlo para no taponar
        // la cola, y seguir con el resto (los puntos de atrás pueden ser perfectamente
        // válidos — de hecho ese fue el caso del 18/07/2026).
        dropsPorRechazo += batch.length
        console.error(
          `[cola GPS] lote rechazado de forma permanente (${error.code}: ${error.message}). ` +
          `${batch.length} puntos descartados para destapar la cola. Total: ${dropsPorRechazo}`,
        )
        await serialize(async () => {
          const cur = await read()
          await writeRaw(cur.slice(batch.length))
        })
        continue
      }
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
