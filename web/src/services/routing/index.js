/**
 * Puerto de ruteo. La UI (mapa) nunca habla directo con un proveedor: pide una
 * ruta a este servicio. Hoy usa OSRM público (gratis, sin API key). En producción
 * se cambia SOLO este archivo por Google Directions (optimizeWaypoints:true) o
 * Route Optimization / OR-Tools, sin tocar componentes.
 *
 * Este es el "seam" escalable que pediste: el motor de mapas es reemplazable.
 */

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving'
const OSRM_TRIP = 'https://router.project-osrm.org/trip/v1/driving'
const OSRM_MATCH = 'https://router.project-osrm.org/match/v1/driving'

/**
 * SNAP-TO-ROAD (map matching). Toma el rastro GPS crudo (con saltos por señal) y lo
 * "pega" a la red de calles real usando el servicio `match` de OSRM. Devuelve la
 * geometría corregida para dibujar/exportar un recorrido limpio.
 *
 * @param {Array<{lat,lng}>} puntos  rastro crudo (>=2)
 * @returns {Promise<{coords:[number,number][]}>}  coords en [lat,lng]
 */
export async function matchTrail(puntos) {
  if (!puntos || puntos.length < 2) return { coords: [] }
  // OSRM `match` acepta ~100 coordenadas por consulta: si hay más, muestreamos
  // uniformemente conservando el primer y último punto.
  let pts = puntos
  const MAX = 100
  if (pts.length > MAX) {
    const step = pts.length / MAX
    const sampled = []
    for (let i = 0; i < MAX; i++) sampled.push(pts[Math.floor(i * step)])
    sampled[sampled.length - 1] = pts[pts.length - 1]
    pts = sampled
  }
  const coordsStr = pts.map((p) => `${p.lng},${p.lat}`).join(';')
  const radiuses = pts.map(() => 30).join(';') // tolerancia de matcheo por punto (m)
  const url = `${OSRM_MATCH}/${coordsStr}?geometries=geojson&overview=full&radiuses=${radiuses}&tidy=true`
  const res = await fetch(url)
  const data = await res.json()
  if (data.code !== 'Ok' || !data.matchings?.length) throw new Error('OSRM match sin resultado')
  const coords = []
  data.matchings.forEach((m) => m.geometry.coordinates.forEach(([lng, lat]) => coords.push([lat, lng])))
  return { coords }
}

/**
 * Ruta punto a punto.
 * @param {{lat,lng}} origen
 * @param {{lat,lng}} destino
 * @returns {Promise<{coords:[number,number][], distancia:number, duracion:number}>}
 *          coords en [lat,lng] listos para Leaflet.
 */
export async function obtenerRuta(origen, destino) {
  const url = `${OSRM_BASE}/${origen.lng},${origen.lat};${destino.lng},${destino.lat}?overview=full&geometries=geojson`
  const res = await fetch(url)
  const data = await res.json()
  const r = data.routes?.[0]
  if (!r) throw new Error('OSRM no devolvió ruta')
  return {
    coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distancia: r.distance,
    duracion: r.duration,
  }
}

/**
 * Ruta a través de varios puntos EN ORDEN, en una sola consulta OSRM. Sigue las
 * calles y respeta sentidos. Ideal para dibujar el recorrido del día.
 * @param {Array<{lat,lng}>} puntos  (>=2)
 * @returns {Promise<{coords:[number,number][], distancia:number, duracion:number}>}
 */
export async function obtenerRutaMulti(puntos) {
  if (!puntos || puntos.length < 2) return { coords: [], distancia: 0, duracion: 0 }
  const coordsStr = puntos.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_BASE}/${coordsStr}?overview=full&geometries=geojson`
  const res = await fetch(url)
  const data = await res.json()
  const r = data.routes?.[0]
  if (!r) throw new Error('OSRM no devolvió ruta')
  return {
    coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distancia: r.distance,
    duracion: r.duration,
  }
}

/**
 * RUTA ÓPTIMA REAL (TSP) — resuelve el mejor ORDEN de paradas con el servicio
 * `trip` de OSRM (Problema del Viajante) y devuelve el trazado por calles.
 * Esto es lo que hace que la ruta sea "óptima" de verdad, no solo seguir calles.
 * @param {Array<{lat,lng}>} puntos
 * @param {{roundtrip?:boolean}} opts  roundtrip=true vuelve al inicio (recorrido cerrado)
 * @returns {Promise<{coords:[number,number][], distancia:number, duracion:number, orden:number[]}>}
 *          `orden` = índice original de cada parada en la secuencia óptima.
 */
export async function obtenerRutaOptimaTSP(puntos, { roundtrip = true } = {}) {
  if (!puntos || puntos.length < 2) return { coords: [], distancia: 0, duracion: 0, orden: [] }
  const coordsStr = puntos.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${OSRM_TRIP}/${coordsStr}?source=first&roundtrip=${roundtrip}&overview=full&geometries=geojson`
  const res = await fetch(url)
  const data = await res.json()
  const trip = data.trips?.[0]
  if (!trip) throw new Error('OSRM trip no devolvió ruta')
  return {
    coords: trip.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distancia: trip.distance,
    duracion: trip.duration,
    orden: (data.waypoints || []).map((w) => w.waypoint_index),
  }
}

/**
 * Ruta optimizada multi-parada (TSP). Con OSRM público se resuelve secuencial;
 * en producción, delegar a Google Directions `optimizeWaypoints:true` (hasta 25
 * paradas) o Route Optimization API para flotas con restricciones.
 * @param {{lat,lng}} deposito
 * @param {Array<{lat,lng}>} paradas
 */
export async function obtenerRutaOptima(deposito, paradas) {
  const puntos = [deposito, ...paradas, deposito]
  const tramos = []
  let distancia = 0
  let duracion = 0
  for (let i = 0; i < puntos.length - 1; i++) {
    const t = await obtenerRuta(puntos[i], puntos[i + 1])
    tramos.push(...t.coords)
    distancia += t.distancia
    duracion += t.duracion
  }
  return { coords: tramos, distancia, duracion }
}
