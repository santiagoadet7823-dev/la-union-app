/**
 * Utilidades geométricas para el DIBUJO de recorridos (no para el análisis).
 *
 * Motivo (26/07/2026): con el GPS casi-en-vivo, una jornada llegó a ~11k puntos por día para toda la
 * empresa. El mapa dibujaba la polilínea cruda entera y se trababa varios segundos. `simplificarTrazo`
 * reduce esos miles de puntos a unos cientos preservando la forma, SOLO para la geometría que se le pasa
 * a Leaflet. Los datos crudos NO se tocan: el cálculo de km y el detector de paradas (dwell.js) siguen
 * necesitando la densidad completa (regla ya documentada en SupervisionMovil/dwell).
 */

// `gpsConfig` es un módulo de CONSTANTES puro (sin imports ni efectos), así que traerlo desde lib/ no
// invierte la dependencia de verdad. Se importa a propósito en vez de copiar los números: el filtro de
// saltos imposibles de acá tiene que usar EL MISMO umbral que el de captura (tracker.js:143). Dos
// umbrales que se llaman igual y valen distinto es cómo se producen los bugs que nadie encuentra.
import { MAX_SPEED_MPS, MIN_MOVE_M } from '../services/gpsConfig'

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

/* ==============================================================================================
   LIMPIEZA DEL RECORRIDO (30/07/2026) — las dos cosas que hacen que un trazo mienta.

   1. SALTOS IMPOSIBLES. `tracker.js:143` descarta un fix cuya velocidad implícita supera
      MAX_SPEED_MPS, pero **ese filtro solo existe en el camino JS**. El uploader NATIVO —el que
      está en la calle desde 1.6.x— solo mira la precisión (UploaderGpsService.java:145), así que
      la basura entra igual. Medido en la base: el 29/07/2026, entre las 12:47 y las 12:49, un
      vendedor tiene cuatro fixes que ALTERNAN entre dos lugares a 127 km uno del otro; el resto
      de su día está a 100 m de su pueblo. Las precisiones de esos fixes eran 21 y 29 m — o sea
      que el filtro de precisión no los podía cazar ni en teoría. En el mapa son cuatro rayas de
      127 km atravesando la provincia, y en las métricas ~500 km de recorrido que no existió.

   2. HUECOS. El trazo se dibujaba como UNA polilínea de la jornada entera, sin cortar nunca. Si
      el GPS se pierde 4 minutos mientras el vendedor maneja 900 m, Leaflet une los dos extremos
      con una RECTA — y esa recta cruza manzanas por las que no pasó. Ese mismo día hay 20 huecos
      de más de 2 minutos en un solo recorrido.

   Esto filtra al DIBUJAR, no al capturar: arregla también los días ya guardados, sin tocar un
   solo punto de la base. El filtro nativo (que es el que evita que la basura entre) va aparte y
   necesita APK nuevo.
   ============================================================================================== */

/** Haversine en metros. Duplicada de geofence.js a propósito: lib/ no importa de services/. */
function metros(a, b) {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const msDe = (ts) => (typeof ts === 'number' ? ts : new Date(ts).getTime())

// Umbrales del corte por hueco. 4 min es holgado a propósito: el reenvío estando quieto es cada
// 30 s (STATIONARY_KEEPALIVE_MS) y una cola que drena tarde puede dejar baches de un par de
// minutos que SÍ son recorrido continuo. Cortar ahí llenaría el mapa de tramos falsos.
export const HUECO_MS = 4 * 60000
// 800 m: más que la cuadra más larga del pueblo y menos que cualquier traslado real entre clientes.
export const HUECO_M = 800
// Si se descartan tantos puntos seguidos, el punto de referencia ya no es confiable (puede ser ÉL
// el malo, no los que vienen). Se acepta el siguiente y se abre segmento nuevo, en vez de tirar el
// resto de la jornada por creerle a un solo fix.
const MAX_DESCARTES_SEGUIDOS = 3

/**
 * Limpia un recorrido crudo para dibujarlo: saca los saltos imposibles y lo parte en segmentos
 * donde hubo un hueco. NO decima ni simplifica (de eso se encarga `simplificarTrazo`) y no muta la
 * entrada: el detector de paradas necesita la densidad completa y sigue recibiéndola.
 *
 * @param {Array<{lat:number,lng:number,ts?:number|string}>} points ordenados por ts ASC
 * @returns {{ segmentos: Array<Array<object>>, puntos: Array<object>, descartados: number }}
 *   `segmentos` para dibujar (una polilínea cada uno); `puntos` es todo lo bueno concatenado, que
 *   es lo que necesitan km y paradas.
 */
export function limpiarTrazo(points) {
  if (!points || points.length === 0) return { segmentos: [], puntos: [], descartados: 0 }

  const segmentos = []
  const puntos = []
  let actual = []
  let ult = null          // último punto ACEPTADO (no el anterior del array: si no, un outlier arrastra al que le sigue)
  let ultMs = NaN
  let descartados = 0
  let seguidos = 0

  for (const p of points) {
    if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) continue
    const ms = msDe(p.ts)

    if (ult) {
      const d = metros(ult, p)
      const dt = (ms - ultMs) / 1000
      // Salto imposible. Solo se juzga con dt > 0: con dos fixes del mismo segundo la velocidad da
      // infinito y descartaríamos puntos buenos. Ese caso lo cubre igual el corte por distancia.
      if (dt > 0 && d > MIN_MOVE_M && d / dt > MAX_SPEED_MPS && seguidos < MAX_DESCARTES_SEGUIDOS) {
        descartados++
        seguidos++
        continue
      }
      // Hueco: arranca segmento nuevo. También cuando se venía de descartar de más — ahí la
      // referencia estaba podrida y no se puede afirmar que el tramo intermedio sea continuo.
      // Ojo con NaN: si algún punto viniera sin `ts`, `dt` es NaN y las comparaciones dan false —
      // o sea que el corte por TIEMPO se apaga solo y queda el corte por DISTANCIA. Eso es lo
      // correcto: sin reloj no se puede afirmar que hubo un hueco, y forzar el corte partiría el
      // recorrido en un tramo por punto.
      const hueco = dt * 1000 > HUECO_MS || d > HUECO_M || seguidos >= MAX_DESCARTES_SEGUIDOS
      if (hueco) {
        if (actual.length) segmentos.push(actual)
        actual = []
      }
    }

    seguidos = 0
    ult = p
    ultMs = ms
    actual.push(p)
    puntos.push(p)
  }
  if (actual.length) segmentos.push(actual)

  // Un segmento de un solo punto no se puede dibujar (Leaflet necesita 2) pero SÍ cuenta para km y
  // paradas, por eso se filtra solo acá y no de `puntos`.
  return { segmentos: segmentos.filter((s) => s.length >= 2), puntos, descartados }
}
