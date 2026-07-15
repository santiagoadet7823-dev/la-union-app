/**
 * Tracker de posiciones (módulo puro, NO-React).
 *
 * Concentra el filtrado + encolado + subida de cada fix GPS para que la
 * PERSISTENCIA no dependa del ciclo de render de React. El callback nativo de
 * background-geolocation llama `procesarFix()` de forma SÍNCRONA, así los puntos se
 * guardan aunque Android congele el WebView con la pantalla bloqueada (Doze) y los
 * effects de React no disparen.
 *
 * Antes: callback nativo → setPos (estado React) → useEffect([pos]) → enqueue.
 * Con la pantalla bloqueada ese useEffect no corría y el fix se perdía (equimaps no
 * persiste nativo). Ahora el enqueue ocurre dentro del propio callback nativo.
 */
import { enqueuePosicion, flushPosiciones } from '../sync/queue'
import { persistence } from '../persistence'
import { dentroDeHorario } from '../tracking'
import { distanciaMetros } from './geofence'
import { MIN_MOVE_M, KEEPALIVE_MS, ACCURACY_MAX_M, MAX_SPEED_MPS } from '../gpsConfig'
import { uid as nuevoUid } from '../../lib/uid'

const HB_KEY = 'lu-bg-heartbeat'
const HB_THROTTLE_MS = 20000 // no saturar SQLite con distanceFilter:5

// Estado a nivel de módulo (fuera de React) → sobrevive al congelamiento del WebView.
let identidad = null       // { id, rol, idEmpresa }
let cfg = null             // ventana horaria (getTrackConfig)
let last = null            // { lat, lng, ts, sentAt } — reemplaza el lastRef de React
let hbUltimoGuardado = 0   // throttle de escritura del heartbeat

/** La identidad del usuario a rastrear. Sin id/idEmpresa, procesarFix no hace nada. */
export function setIdentidad(next) {
  identidad = next && next.id && next.idEmpresa ? next : null
}

/** Ventana horaria de rastreo cacheada (la empuja usePublishPosition al cargarla). */
export function setConfig(next) {
  cfg = next || null
}

/** Limpia el estado de sesión (al deshabilitar/desloguear/cambiar de rol). */
export function reset() {
  identidad = null
  last = null
  // NO se limpia `cfg`: la administra el effect de config (keyeado en [enabled]), no
  // el de identidad; borrarla acá la dejaría en null hasta el próximo refresco si la
  // identidad cambia después de enabled. Sin identidad, procesarFix ya corta igual.
  // El heartbeat tampoco se borra acá: es telemetría del día (se resetea por fecha).
}

function visibleAhora() {
  return typeof document !== 'undefined' && document.visibilityState === 'visible'
}

// Persiste un latido de captura (última captura + si fue en 2º plano). Se escribe en
// el MISMO callback síncrono que encola, así que si el enqueue corre con la pantalla
// bloqueada, el heartbeat también → prueba de vida en background y fuente de `bg_ok`
// en useEstadoDispositivo, aunque el `pos` de React quede viejo por el congelamiento.
function registrarHeartbeat(bg) {
  const now = Date.now()
  if (now - hbUltimoGuardado < HB_THROTTLE_MS) return
  hbUltimoGuardado = now
  const uid = identidad ? identidad.id : null
  persistence.get(HB_KEY, null).then((prev) => {
    const hoy = new Date().toISOString().slice(0, 10)
    // Reinicia el acumulado si cambió el día O el usuario (evita heredar el heartbeat
    // de otra sesión en un dispositivo compartido → falso bg_ok del usuario nuevo).
    const base = prev && prev.dia === hoy && prev.id === uid ? prev : { dia: hoy, capturasBg: 0 }
    return persistence.set(HB_KEY, {
      id: uid,
      dia: hoy,
      ultimaCapturaTs: now,
      ultimaBg: bg,
      capturasBg: (base.capturasBg || 0) + (bg ? 1 : 0),
    })
  }).catch(() => {})
}

/**
 * Filtra y encola un fix. La función NO es async y actualiza `last` ANTES de llamar a
 * enqueue: así el watch nativo y el poll de foreground no pueden interleavear a mitad
 * (JS single-thread) y no hay doble-envío. Corre dentro del callback nativo, de modo
 * que NO depende de que React re-renderice → sigue ejecutando con la pantalla
 * bloqueada.
 *
 * OJO: enqueuePosicion → SQLite es async (persistence no expone API síncrona). El
 * callback solo *inicia* la escritura; el drenado real del microtask + write nativo
 * ocurre después. En la práctica el foreground service de background-geolocation
 * mantiene vivo el proceso el tiempo suficiente, pero esto es lo único que hay que
 * confirmar EN DISPOSITIVO (contar puntos tras una caminata bloqueado real).
 * @param {{lat:number,lng:number,ts:number,accuracy?:number}} fix
 */
export function procesarFix(fix) {
  if (!fix || !identidad) return
  const { id, rol, idEmpresa } = identidad

  // Ventana horaria: defensa de borde (el watch ya se apaga fuera de horario).
  if (cfg && !dentroDeHorario(cfg)) return

  // Precisión: descartar fixes imprecisos (jitter de interior = causa #1 de "vueltas").
  if (typeof fix.accuracy === 'number' && fix.accuracy > ACCURACY_MAX_M) return

  const prev = last

  // Salto imposible: velocidad implícita irreal respecto al último punto bueno → glitch.
  if (prev) {
    const dt = Math.max(1, (fix.ts - prev.ts) / 1000)
    const dist = distanciaMetros(prev, fix)
    if (dist > MIN_MOVE_M && dist / dt > MAX_SPEED_MPS) return
  }

  const movio = !prev || distanciaMetros(prev, fix) >= MIN_MOVE_M
  const keepAlive = prev && Date.now() - prev.sentAt >= KEEPALIVE_MS
  if (!movio && !keepAlive) return

  // Actualizar `last` ANTES de cualquier await (JS single-thread → sin interleaving).
  last = { lat: fix.lat, lng: fix.lng, ts: fix.ts, sentAt: Date.now() }

  const row = {
    id_usuario: id, rol, lat: fix.lat, lng: fix.lng, id_empresa: idEmpresa,
    ts: new Date(fix.ts || Date.now()).toISOString(), client_uid: nuevoUid(),
  }
  if (typeof fix.accuracy === 'number') row.accuracy = fix.accuracy

  // Guardar SIEMPRE en la cola local (mutex en queue.js) y luego intentar subir.
  enqueuePosicion(row)
  flushPosiciones()

  registrarHeartbeat(!visibleAhora())
}

/** Lee el heartbeat de captura background (para la telemetría bg_ok/gps_ok). */
export function getHeartbeat() {
  return persistence.get(HB_KEY, null)
}
