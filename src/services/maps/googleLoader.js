import { Loader } from '@googlemaps/js-api-loader'
import { GOOGLE_MAPS_API_KEY } from './index'

/**
 * Carga la Google Maps JS API una sola vez (singleton). Devuelve el objeto
 * `google` global listo para usar. Incluye la librería de rutas para Directions.
 */
let promise = null

export function loadGoogleMaps() {
  if (!GOOGLE_MAPS_API_KEY) {
    return Promise.reject(new Error('Falta VITE_GOOGLE_MAPS_API_KEY'))
  }
  if (!promise) {
    const loader = new Loader({
      apiKey: GOOGLE_MAPS_API_KEY,
      version: 'weekly',
      libraries: ['maps', 'marker', 'routes'],
    })
    promise = loader.load()
  }
  return promise
}
