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
 * Pide la ubicación UNA vez. Debe llamarse desde un gesto del usuario (tap) para
 * que iOS/Android muestren el prompt de permiso. Una vez concedido, el watch
 * empieza a entregar posiciones sin volver a preguntar.
 * @returns {Promise<{lat:number,lng:number,ts:number}>}
 */
export function pedirUbicacionUnaVez() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocalización no disponible en este navegador'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, ts: p.timestamp, accuracy: p.coords.accuracy }),
      reject,
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
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
      backgroundMessage: 'LA UNIÓN registra tu ruta',
      backgroundTitle: 'Tracking activo',
      requestPermissions: true,
      stale: false,
      distanceFilter: 12, // metros → coincide con el "por movimiento" del panel
    },
    (location, error) => {
      if (error) return onError(error)
      onUpdate({ lat: location.latitude, lng: location.longitude, ts: Date.now(), accuracy: location.accuracy })
    }
  )
  return () => BackgroundGeolocation.removeWatcher({ id })
}
