/**
 * Puerto de geolocalización.
 * - Web / PWA:  navigator.geolocation.watchPosition (solo con app en primer plano).
 * - Nativo:     @capacitor-community/background-geolocation (segundo plano real,
 *               pantalla bloqueada) — este es el motivo de migrar a Capacitor.
 *
 * Devuelve una función para cancelar el watch.
 */
import { isNative } from '../platform'
import { registerPlugin } from '@capacitor/core'
import { MIN_MOVE_M } from '../gpsConfig'

const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

/**
 * Opciones del watcher nativo en modo "movimiento" (la jornada normal).
 * Exportadas para que otro código pueda reusarlas como base y variar solo lo que
 * necesita (ej. `{ ...OPCIONES_GPS_MOVIMIENTO, priority: 102 }` para un modo quieto),
 * y pasarlas a `actualizarWatcher`. OJO: `updateWatcher` no hace merge con las opciones
 * actuales del watcher — lo que no se pasa cae al default del plugin. Siempre partir de
 * este objeto en vez de mandar opciones sueltas.
 */
export const OPCIONES_GPS_MOVIMIENTO = Object.freeze({
  // Alineado con MIN_MOVE_M de gpsConfig (importado de verdad: antes era un 10
  // hardcodeado con un comentario que decía "alineado", que es la clase de alineación
  // que dura hasta que alguien toca gpsConfig): con 5 m el plugin despertaba el
  // WebView por fixes que procesarFix descartaba igual (~50% tirados por
  // `if (!movio && !keepAlive) return`). OJO — distanceFilter NO baja el consumo
  // del chip GPS: mapea a setSmallestDisplacement, que filtra la ENTREGA, no la
  // ADQUISICIÓN. Lo que se ahorra acá son despertares de CPU/IPC, no el sensor.
  distanceFilter: MIN_MOVE_M,

  // --- Opciones habilitadas por el patch de patch-package (ver patches/) ---
  // Upstream hardcodeaba interval=1000 / maxWaitTime=1000 / PRIORITY_HIGH_ACCURACY,
  // sin ninguna perilla desde JS: el chip GPS quedaba a 1 Hz máxima precisión toda
  // la jornada (~14 h). Eso era el piso de consumo de la app.

  // 5 s en vez de 1 s → 5× menos adquisiciones del chip, SIN perder precisión.
  // Es la palanca de mayor ahorro por unidad de riesgo.
  interval: 5000,

  // Deja que el SO agrupe entregas hasta 10 s y duerma la radio entremedio.
  // Solo es seguro porque el patch además arregla onLocationResult para iterar
  // getLocations() en vez de getLastLocation(): upstream descartaba TODOS los fixes
  // intermedios de un lote, así que subir esto sin el patch perdía puntos en silencio.
  maxWaitTime: 10000,

  // 100 = PRIORITY_HIGH_ACCURACY (sin cambios respecto de upstream).
  // NO pasar a 102 (BALANCED_POWER) sin subir ACCURACY_MAX_M de gpsConfig.js: 102 da
  // ~30-100 m de precisión y procesarFix descarta todo lo que supere 30 m → los
  // recorridos quedarían vacíos. Es el próximo experimento, pero se prueba en device.
  priority: 100,
})

/**
 * @param {(pos:{lat:number,lng:number,ts:number}) => void} onUpdate
 * @param {(err:any) => void} [onError]
 * @returns {Promise<(() => void) & {watcherId: string|null}>} función de cleanup; lleva
 *          colgado el id del watcher nativo (`.watcherId`, null en web) para poder pasarlo
 *          a `actualizarWatcher`.
 */
export async function watchPosition(onUpdate, onError = () => {}) {
  if (isNative()) {
    return watchNative(onUpdate, onError)
  }
  return watchWeb(onUpdate, onError)
}

/**
 * Cambia las opciones de un watcher nativo YA corriendo, sin cortarlo.
 *
 * Existe porque la alternativa (removeWatcher + addWatcher) es break-before-make: el
 * servicio nativo es bound-only y su estado foreground es lo único que sostiene el
 * proceso, así que ese hueco entre remove y add es una ventana en la que Android puede
 * matar la captura — y en Android 14 re-levantar el foreground service desde background
 * puede fallar en silencio, dejando el tracking muerto sin ningún error visible.
 * `updateWatcher` (patch DisT-At) solo reemplaza el LocationRequest.
 *
 * No-op en web: `navigator.geolocation.watchPosition` no tiene reconfiguración en
 * caliente (habría que clearWatch + watchPosition, que en web es inofensivo pero no hace
 * falta: el problema del foreground service es exclusivo de nativo).
 *
 * @param {string|null|undefined} id id devuelto por watchPosition (`stop.watcherId`)
 * @param {object} opts opciones completas (partir de OPCIONES_GPS_MOVIMIENTO)
 * @returns {Promise<boolean>} true si se aplicó, false si no es nativo o no hay id
 */
export async function actualizarWatcher(id, opts = {}) {
  if (!isNative() || !id) return false
  await BackgroundGeolocation.updateWatcher({ id, ...opts })
  return true
}

/**
 * Abre la pantalla de ajustes de permisos de la app (para que el usuario elija
 * "Permitir siempre" la ubicación — Android 11+ no deja pedirlo por diálogo).
 * En web es un no-op. Devuelve true si intentó abrir los ajustes.
 */
export async function abrirAjustesUbicacion() {
  if (!isNative()) return false
  try { await BackgroundGeolocation.openSettings(); return true }
  catch (_) { return false }
}

/**
 * Pide la ubicación UNA vez. Debe llamarse desde un gesto del usuario (tap) para
 * que iOS/Android muestren el prompt de permiso. Una vez concedido, el watch
 * empieza a entregar posiciones sin volver a preguntar.
 *
 * `maximumAge` por defecto es 0 (fix nuevo, sin caché) para no cambiar el
 * comportamiento del prompt de permiso. Los llamadores que solo quieren refrescar el
 * marcador (el latido de useLivePosition) pasan un maximumAge alto para que el SO
 * devuelva el fix que el watch nativo YA adquirió, sin volver a encender el GPS.
 * @param {{maximumAge?:number}} [opts]
 * @returns {Promise<{lat:number,lng:number,ts:number}>}
 */
export function pedirUbicacionUnaVez(opts = {}) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocalización no disponible en este navegador'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, ts: p.timestamp, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0, ...opts }
    )
  })
}

function watchWeb(onUpdate, onError) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError(new Error('Geolocalización no disponible en este navegador'))
    return conId(() => {}, null)
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onUpdate({ lat: p.coords.latitude, lng: p.coords.longitude, ts: p.timestamp, accuracy: p.coords.accuracy }),
    onError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  )
  // watcherId null: el id numérico del watch web no sirve para actualizarWatcher (es no-op en web).
  return conId(() => navigator.geolocation.clearWatch(id), null)
}

/**
 * Cuelga el id del watcher de la función de cleanup.
 *
 * Decisión de forma: watchPosition/watchNative siguen devolviendo LA FUNCIÓN de stop, con el
 * id como propiedad, en vez de pasar a `{ id, stop }`. Es la opción menos invasiva: el único
 * consumidor (useLivePosition) hace `stopRef.current()` directo y no se toca, y cualquier
 * llamador que solo quiera cortar el watch sigue sin enterarse de que existe un id. Quien
 * necesite reconfigurar lee `stop.watcherId`.
 */
function conId(stop, id) {
  stop.watcherId = id
  return stop
}

async function watchNative(onUpdate, onError) {
  const id = await BackgroundGeolocation.addWatcher(
    {
      backgroundMessage: 'DisT-At registra tu ruta',
      backgroundTitle: 'Tracking activo',
      requestPermissions: true,
      stale: false,
      ...OPCIONES_GPS_MOVIMIENTO,
    },
    (location, error) => {
      if (error) return onError(error)
      // IMPORTANTE: usar location.time (hora REAL del fix), NO Date.now(). Cuando el
      // WebView se congela en un bloqueo largo (Doze), el plugin bufferea los fixes
      // nativamente y los entrega TODOS juntos al desbloquear. Con Date.now() todos
      // quedaban sellados con la hora de entrega → el recorrido se comprimía en un
      // instante y el filtro de "salto imposible" (dt≈0) descartaba puntos. Con
      // location.time cada punto conserva su hora real aunque llegue tarde.
      onUpdate({ lat: location.latitude, lng: location.longitude, ts: location.time || Date.now(), accuracy: location.accuracy })
    }
  )
  return conId(() => BackgroundGeolocation.removeWatcher({ id }), id)
}
