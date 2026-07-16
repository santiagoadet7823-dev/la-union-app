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

const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

/**
 * @param {(pos:{lat:number,lng:number,ts:number}) => void} onUpdate
 * @param {(err:any) => void} [onError]
 * @returns {Promise<() => void>} función de cleanup
 */
export async function watchPosition(onUpdate, onError = () => {}) {
  if (isNative()) {
    return watchNative(onUpdate, onError)
  }
  return watchWeb(onUpdate, onError)
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
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onUpdate({ lat: p.coords.latitude, lng: p.coords.longitude, ts: p.timestamp, accuracy: p.coords.accuracy }),
    onError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  )
  return () => navigator.geolocation.clearWatch(id)
}

async function watchNative(onUpdate, onError) {
  const id = await BackgroundGeolocation.addWatcher(
    {
      backgroundMessage: 'DisT-At registra tu ruta',
      backgroundTitle: 'Tracking activo',
      requestPermissions: true,
      stale: false,
      // Alineado con MIN_MOVE_M=10 de gpsConfig: con 5 m el plugin despertaba el
      // WebView por fixes que procesarFix descartaba igual (~50% tirados por
      // `if (!movio && !keepAlive) return`). OJO — distanceFilter NO baja el consumo
      // del chip GPS: mapea a setSmallestDisplacement, que filtra la ENTREGA, no la
      // ADQUISICIÓN. Lo que se ahorra acá son despertares de CPU/IPC, no el sensor.
      distanceFilter: 10,

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
  return () => BackgroundGeolocation.removeWatcher({ id })
}
