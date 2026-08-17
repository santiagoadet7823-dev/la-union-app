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
const QKEY = 'lu-pos-cuarentena'
const MAX = 8000        // tope de puntos en cola (una jornada larga entra de sobra)
const MAX_Q = 4000      // tope de la cuarentena
const BATCH = 200       // filas por request al hacer flush

// Telemetría de pérdida: antes los descartes (desborde FIFO al pasar MAX, o fallo
// de almacenamiento) se tragaban en catch vacíos. Ahora se cuentan y avisan.
let dropsPorDesborde = 0
let dropsPorCuota = 0
let aCuarentena = 0

/**
 * Usuario dueño de la cola AHORA. La clave `lu-pos-queue` es del DISPOSITIVO, no del
 * usuario: si en el mismo teléfono se cierra sesión y entra otra cuenta, los puntos de
 * la anterior quedan en la cola. La policy `posiciones_ins` exige
 * `id_usuario = auth.uid()`, así que RLS los rechaza para siempre, y como el flush
 * cortaba al primer lote fallido, tapaban la cola y NINGÚN punto posterior subía nunca
 * más (18/07/2026: 264 puntos atascados, error 42501 cada 30s durante 8 horas — y
 * `estado_dispositivo` seguía subiendo, que es lo que hacía parecer que "la app andaba
 * bien").
 *
 * Esos puntos NO SE BORRAN: van a CUARENTENA (`lu-pos-cuarentena`). Son el recorrido
 * real de otra persona, y si esa cuenta vuelve a iniciar sesión en este teléfono se
 * devuelven solos a la cola y suben. La primera versión de este fix (bundle 1.5.26) los
 * borraba: destapó la cola pero destruyó 264 puntos que eran recuperables. Descartar
 * datos que no se pueden inspeccionar es peor que dejarlos trabados — la cuarentena
 * logra lo mismo sin perder nada.
 *
 * Se setea junto con la identidad del tracker. Si es null (rastreo apagado, sesión sin
 * abrir) NO se mueve nada: ante la duda, no se toca.
 */
let usuarioActual = null
export function setUsuarioCola(id) { usuarioActual = id || null }

/** Cuántos puntos hay en cuarentena (diagnóstico / futura UI de recuperación). */
export async function pendientesCuarentena() {
  return ((await persistence.get(QKEY, [])) || []).length
}

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

async function leerCuarentena() {
  return (await persistence.get(QKEY, [])) || []
}

/** Manda filas a cuarentena (FIFO, con tope). Nunca borra sin dejar rastro. */
async function aislar(filas, motivo) {
  if (!filas.length) return
  const marcadas = filas.map((r) => ({ ...r, _motivo: motivo, _aislado_en: new Date().toISOString() }))
  let q = (await leerCuarentena()).concat(marcadas)
  if (q.length > MAX_Q) q = q.slice(-MAX_Q)
  aCuarentena += filas.length
  console.warn(`[cola GPS] ${filas.length} puntos a CUARENTENA (${motivo}). En cuarentena: ${q.length}`)
  try { await persistence.set(QKEY, q) } catch (_) { /* si no entra, se pierden igual: ya estaban trabados */ }
}

/**
 * Separa la cola por dueño: los puntos de otra cuenta van a cuarentena (destapan la
 * cola sin perderse) y, al revés, los que estaban en cuarentena y SÍ son del usuario
 * actual vuelven a la cola para subir. Eso hace que un recorrido atrapado por un cambio
 * de cuenta se recupere solo cuando su dueño vuelve a entrar en el mismo teléfono.
 */
async function separarPorDueño() {
  await serialize(async () => {
    const q = await read()
    const propios = q.filter((r) => r.id_usuario === usuarioActual)
    const ajenos = q.filter((r) => r.id_usuario !== usuarioActual)

    const cuar = await leerCuarentena()
    const rescatados = cuar.filter((r) => r.id_usuario === usuarioActual)
    const siguenAisladas = cuar.filter((r) => r.id_usuario !== usuarioActual)

    if (ajenos.length) await aislar(ajenos, 'otra cuenta')
    if (rescatados.length) {
      console.warn(`[cola GPS] ${rescatados.length} puntos recuperados de cuarentena (volvió su dueño).`)
      // eslint-disable-next-line no-unused-vars
      const limpios = rescatados.map(({ _motivo, _aislado_en, ...r }) => r)
      try { await persistence.set(QKEY, siguenAisladas) } catch (_) {}
      // Los rescatados van ADELANTE: son más viejos que lo que se capturó después.
      await writeRaw(limpios.concat(propios))
      return
    }
    if (ajenos.length) await writeRaw(propios)
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
    // Antes de intentar nada: separar por dueño (ver `usuarioActual`). Los ajenos van a
    // cuarentena porque RLS los rechaza siempre y taponan; los propios que estaban en
    // cuarentena vuelven a la cola.
    if (usuarioActual) await separarPorDueño()

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
        // Error PERMANENTE: este lote no va a entrar nunca tal como está. Sacarlo de la
        // cola para no taponar el resto, pero A CUARENTENA, no a la basura: no sabemos
        // por qué lo rechazó y puede ser un recorrido real y recuperable.
        console.error(
          `[cola GPS] lote rechazado de forma permanente (${error.code}: ${error.message}). ` +
          `${batch.length} puntos a cuarentena para destapar la cola.`,
        )
        await aislar(batch, `rechazo ${error.code}`)
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
