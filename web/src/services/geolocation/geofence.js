/**
 * Lógica de geofencing (pura). Detecta entrada/salida de un radio alrededor de
 * las coordenadas de un cliente para automatizar el check-in/check-out del
 * Vendedor (radio 50–100 m, según ROADMAP_PROD).
 */

const R = 6371000 // radio terrestre en metros

/** Distancia haversine en metros entre dos puntos {lat,lng}. */
export function distanciaMetros(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** ¿La posición está dentro del radio (m) del cliente? */
export function dentroDeGeofence(pos, cliente, radioM = 75) {
  return distanciaMetros(pos, { lat: cliente.latitud, lng: cliente.longitud }) <= radioM
}

/**
 * Crea un detector de transiciones enter/exit con histéresis simple.
 * Uso: const det = crearDetector(cliente, 75); det(pos) -> 'enter'|'exit'|null
 */
export function crearDetector(cliente, radioM = 75) {
  let dentro = false
  return (pos) => {
    const ahora = dentroDeGeofence(pos, cliente, radioM)
    if (ahora && !dentro) {
      dentro = true
      return 'enter'
    }
    if (!ahora && dentro) {
      dentro = false
      return 'exit'
    }
    return null
  }
}
