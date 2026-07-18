/**
 * Basemaps (capas de mapa) elegibles por el usuario, compartidos por TODAS las vistas.
 * La elección se guarda en localStorage y se emite un evento para que cualquier mapa montado
 * se actualice en vivo. El color de pines/trazos NO depende de esto (lo sigue fijando el tema).
 *
 * Stadia exige API key en producción (keyless SOLO en localhost). Pegá la key en STADIA_KEY:
 * sin ella, las dos capas Stadia solo cargan en el dev server, no en la PWA (github.io) ni el APK.
 * Además hay que registrar el dominio `santiagoadet7823-dev.github.io` en el panel de Stadia.
 */

// API key de Stadia (cuenta gratis en stadiamaps.com). Es una clave de navegador (va en el bundle);
// protegida además por dominios permitidos en el panel de Stadia. Vacía = Stadia solo en localhost.
export const STADIA_KEY = 'ec37db38-e3d9-4105-a11c-eb327aecab76'

const stadiaParam = STADIA_KEY ? `?api_key=${STADIA_KEY}` : ''

// Lista ordenada: el orden es el que se ve en el selector. `crossOrigin:'anonymous'` mantiene la
// exportación a PNG del informe sin "tainted canvas" (los tres proveedores mandan CORS).
export const BASEMAPS = [
  {
    id: 'osm',
    label: 'Mapa (OSM)',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    opts: { subdomains: 'abc', maxZoom: 19, crossOrigin: 'anonymous', attribution: '&copy; OpenStreetMap' },
  },
  {
    id: 'stadia_dark',
    label: 'Oscuro (Stadia)',
    needsKey: true,
    url: `https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png${stadiaParam}`,
    opts: { maxZoom: 20, crossOrigin: 'anonymous', attribution: '&copy; Stadia Maps &copy; OpenMapTiles &copy; OpenStreetMap' },
  },
  {
    id: 'stadia_sat',
    label: 'Satélite (Stadia)',
    needsKey: true,
    url: `https://tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}{r}.jpg${stadiaParam}`,
    opts: { maxZoom: 20, crossOrigin: 'anonymous', attribution: '&copy; Stadia Maps, &copy; OpenStreetMap, imágenes satelitales' },
  },
]

export const DEFAULT_BASEMAP = 'osm'
const KEY = 'lu-basemap'
const EVT = 'lu-basemap'

// Stadia solo carga con API key... salvo en localhost (dev), donde anda sin key. Así, en producción
// sin key las opciones Stadia NO se ofrecen (evita elegirlas y ver el mapa en blanco); apenas se
// pega la key en STADIA_KEY, aparecen. En el dev server se ven siempre para poder probarlas.
function stadiaUsable() {
  if (STADIA_KEY) return true
  return typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
}

/** Basemaps realmente usables ahora (filtra Stadia si no hay key y no es localhost). */
export function usableBasemaps() {
  const stadia = stadiaUsable()
  return BASEMAPS.filter((b) => !b.needsKey || stadia)
}

/** id del basemap elegido (o el default si no hay nada guardado / no es usable ahora). */
export function getBasemap() {
  try {
    const id = localStorage.getItem(KEY)
    return usableBasemaps().some((b) => b.id === id) ? id : DEFAULT_BASEMAP
  } catch (_) {
    return DEFAULT_BASEMAP
  }
}

/** Devuelve el objeto basemap por id (con fallback al default). */
export function basemapById(id) {
  return BASEMAPS.find((b) => b.id === id) || BASEMAPS.find((b) => b.id === DEFAULT_BASEMAP) || BASEMAPS[0]
}

/** Cambia el basemap: persiste y avisa a todos los mapas montados (mismo tab). */
export function setBasemap(id) {
  if (!BASEMAPS.some((b) => b.id === id)) return
  try { localStorage.setItem(KEY, id) } catch (_) { /* modo privado: igual se aplica en vivo */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVT, { detail: id }))
}

/** Suscribe a cambios de basemap (en este tab). Devuelve la función para desuscribir. */
export function onBasemapChange(fn) {
  if (typeof window === 'undefined') return () => {}
  const h = (e) => fn(e.detail || getBasemap())
  window.addEventListener(EVT, h)
  return () => window.removeEventListener(EVT, h)
}
