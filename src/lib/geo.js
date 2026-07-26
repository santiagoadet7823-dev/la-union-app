/**
 * Utilidades geométricas para el DIBUJO de recorridos (no para el análisis).
 *
 * Motivo (26/07/2026): con el GPS casi-en-vivo, una jornada llegó a ~11k puntos por día para toda la
 * empresa. El mapa dibujaba la polilínea cruda entera y se trababa varios segundos. `simplificarTrazo`
 * reduce esos miles de puntos a unos cientos preservando la forma, SOLO para la geometría que se le pasa
 * a Leaflet. Los datos crudos NO se tocan: el cálculo de km y el detector de paradas (dwell.js) siguen
 * necesitando la densidad completa (regla ya documentada en SupervisionMovil/dwell).
 */

const R = 6371000 // radio terrestre en metros

// Proyección local equirectangular a metros, relativa a un origen. Exacta para distancias cortas
// (recorridos urbanos); evita llamar haversine dentro del bucle de RDP.
function aXY(p, origen, cosLat) {
  const toRad = Math.PI / 180
  return {
    x: (p.lng - origen.lng) * toRad * cosLat * R,
    y: (p.lat - origen.lat) * toRad * R,
  }
}

// Distancia perpendicular (m) del punto p al segmento a-b, en el plano local.
function distPerpM(p, a, b, origen, cosLat) {
  const P = aXY(p, origen, cosLat)
  const A = aXY(a, origen, cosLat)
  const B = aXY(b, origen, cosLat)
  const dx = B.x - A.x
  const dy = B.y - A.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(P.x - A.x, P.y - A.y)
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy))
}

// Pre-pase LINEAL O(n): descarta puntos a menos de `minM` del último conservado. Colapsa barato los
// racimos de "quieto" (miles de puntos casi idénticos parado en un cliente), que además son el peor caso
// de RDP. Deja el primero y el último siempre.
function decimarPorDistancia(points, minM) {
  const n = points.length
  if (n <= 2) return points.slice()
  const toRad = Math.PI / 180
  const cosLat = Math.cos(points[0].lat * toRad)
  const out = [points[0]]
  let ref = points[0]
  for (let i = 1; i < n - 1; i++) {
    const p = points[i]
    const dx = (p.lng - ref.lng) * toRad * cosLat * R
    const dy = (p.lat - ref.lat) * toRad * R
    if (dx * dx + dy * dy >= minM * minM) { out.push(p); ref = p }
  }
  out.push(points[n - 1])
  return out
}

// Ramer–Douglas–Peucker iterativo (sin recursión → sin stack overflow). Conserva los vértices donde el
// recorrido cambia de dirección más de `epsilonM` metros; descarta los que están casi sobre la recta.
function rdp(points, epsilonM) {
  const n = points.length
  if (n <= 2) return points.slice()
  const cosLat = Math.cos(points[0].lat * (Math.PI / 180))
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [i, j] = stack.pop()
    let maxD = -1
    let idx = -1
    for (let k = i + 1; k < j; k++) {
      const d = distPerpM(points[k], points[i], points[j], points[0], cosLat)
      if (d > maxD) { maxD = d; idx = k }
    }
    if (maxD > epsilonM && idx !== -1) {
      keep[idx] = 1
      stack.push([i, idx], [idx, j])
    }
  }
  const out = []
  for (let k = 0; k < n; k++) if (keep[k]) out.push(points[k])
  return out
}

/**
 * Simplifica un trazo [{lat,lng,...}] para dibujarlo. Primero decima por distancia (barato, mata los
 * racimos de quieto) y después aplica RDP para respetar la forma. Devuelve un array nuevo; no muta la
 * entrada. `epsilonM` es la tolerancia de desviación (m): más alto = menos puntos.
 */
export function simplificarTrazo(points, epsilonM = 7) {
  if (!points || points.length <= 2) return points ? points.slice() : []
  const decimado = decimarPorDistancia(points, Math.max(2, epsilonM * 0.5))
  return rdp(decimado, epsilonM)
}
