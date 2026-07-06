/**
 * Puerto de geolocalización.
 * - Web / PWA:  navigator.geolocation.watchPosition (solo con app en primer plano).
 * - Nativo:     @capacitor-community/background-geolocation (segundo plano real,
 *               pantalla bloqueada) — este es el motivo de migrar a Capacitor.
 *
 * Devuelve una función para cancelar el watch.
 */
import { isNative } from '../platform'

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

function watchWeb(onUpdate, onError) {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError(new Error('Geolocalización no disponible en este navegador'))
    return () => {}
  }
  const id = navigator.geolocation.watchPosition(
    (p) => onUpdate({ lat: p.coords.latitude, lng: p.coords.longitude, ts: p.timestamp }),
    onError,
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  )
  return () => navigator.geolocation.clearWatch(id)
}

/*
 * INTEGRACIÓN NATIVA (fase Capacitor):
 * import { registerPlugin } from '@capacitor/core'
 * const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')
 * const id = await BackgroundGeolocation.addWatcher(
 *   { backgroundMessage: 'LA UNIÓN registra tu ruta', distanceFilter: 20 },
 *   (loc) => onUpdate({ lat: loc.latitude, lng: loc.longitude, ts: Date.now() })
 * )
 * return () => BackgroundGeolocation.removeWatcher({ id })
 */
async function watchNative(onUpdate, onError) {
  // Fallback funcional hasta cablear el plugin nativo (ver bloque de arriba).
  return watchWeb(onUpdate, onError)
}
