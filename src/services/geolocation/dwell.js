/**
 * Detección de PARADAS ("el vendedor estuvo X minutos acá") a partir de los puntos
 * GPS que ya se capturan. Es cálculo puro sobre datos existentes: no prende el GPS,
 * no agrega consultas y no cuesta batería.
 *
 * Por qué no se reusa `isStationary` de la Edge Function (snap-recorridos/index.ts:44):
 * ese test responde "¿ESTE segmento entero es jitter?" — es global, de una sola
 * pasada, y sirve para decidir si vale la pena rutearlo. Como `splitGaps` solo corta
 * por saltos espaciales > 1500 m, una jornada entera suele quedar como UN segmento,
 * así que `isStationary` da `false` casi siempre. Sirve de inspiración por el criterio
 * de MEDIANA (robusto a outliers, mismo umbral de 40 m ya calibrado), nada más: acá
 * hace falta recorrer la jornada con una ventana deslizante y emitir VARIAS paradas.
 *
 * Tampoco se construye sobre `crearDetector` (geofence.js:29): es código muerto,
 * necesita un cliente conocido de antemano y su comentario miente (dice "histéresis"
 * pero tiene un solo umbral).
 *
 * Nota de densidad: KEEPALIVE_MS = 90000 (gpsConfig.js:7) reenvía un punto cada 90 s
 * aunque el teléfono esté quieto → una parada de 5 min deja apenas ~4 fixes. El
 * algoritmo tiene que funcionar con ventanas chicas, no asume densidad alta.
 */
import { distanciaMetros } from './geofence'

export const DWELL_MIN_MS = 180000 // 3 min: menos que esto es un semáforo, no una visita
export const DWELL_RADIO_M = 40    // m: mismo umbral que STATIONARY_R en la Edge Function

/** Mediana simple (mismo criterio que la Edge Function: en pares toma el de arriba). */
const mediana = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** ts a ms epoch: acepta número o string ISO. Devuelve NaN si no se puede leer. */
const tsMs = (ts) => {
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : NaN
  if (typeof ts === 'string') return new Date(ts).getTime()
  if (ts instanceof Date) return ts.getTime()
  return NaN
}

/** Centro de la ventana: mediana de lats y de lngs POR SEPARADO (robusto a outliers). */
const centroDe = (win) => ({
  lat: mediana(win.map((p) => p.lat)),
  lng: mediana(win.map((p) => p.lng)),
})

/** ¿La ventana sigue siendo una parada? Mediana de distancias al centro < radio. */
const esParada = (win, radioM) => {
  const centro = centroDe(win)
  return mediana(win.map((p) => distanciaMetros(centro, p))) < radioM
}

/**
 * Detecta las paradas de una traza GPS con una ventana deslizante.
 *
 * @param {Array<{lat:number,lng:number,ts:number|string}>} points ordenados por ts ASC
 * @param {{minMs?:number, radioM?:number}} [opts]
 * @returns {Array<{lat:number,lng:number,desde:number,hasta:number,duracionMs:number,puntos:number}>}
 *   lat/lng = centro (mediana) de la parada; desde/hasta = ms epoch; puntos = fixes que la componen.
 */
export function detectarParadas(points, { minMs = DWELL_MIN_MS, radioM = DWELL_RADIO_M } = {}) {
  if (!Array.isArray(points) || points.length === 0) return []

  // Normalizamos y descartamos basura (lat/lng o ts inválidos) antes de nada.
  const pts = []
  for (const p of points) {
    if (!p) continue
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    const ts = tsMs(p.ts)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(ts)) continue
    pts.push({ lat, lng, ts })
  }
  if (pts.length === 0) return []

  const paradas = []
  // Cierra la ventana: emite la parada (si duró lo suficiente) y devuelve los puntos
  // SOBRANTES — la cola de fixes ya lejos del centro, que son el arranque del viaje.
  //
  // El recorte importa: la mediana es robusta a outliers, así que los primeros puntos
  // de la partida NO rompen la ventana (hacen falta ~tantos como tenga la parada para
  // mover la mediana). Sin recortar, una parada larga se come el principio de la
  // caminata siguiente e infla su duración. Se emite hasta el último fix que estuvo
  // efectivamente en el lugar; los sobrantes se reciclan en la ventana siguiente.
  //
  // El recorte se itera hasta punto fijo: el centro de la ventana COMPLETA viene
  // corrido hacia la partida (la arrastran los fixes del viaje), y con el centro
  // corrido el recorte se queda corto. Al recortar la cola, el centro vuelve hacia
  // el lugar real y deja ver más sobrantes; converge en pocas vueltas.
  const cerrar = (win) => {
    let fin = win.length
    for (;;) {
      const centro = centroDe(win.slice(0, fin))
      let nuevoFin = fin
      while (nuevoFin > 0 && distanciaMetros(centro, win[nuevoFin - 1]) >= radioM) nuevoFin--
      if (nuevoFin === fin) break
      fin = nuevoFin
    }
    // La última ventana del recorrido nunca pasó por el test de mediana (puede ser una
    // semilla de dos puntos lejanos): ahí el recorte puede vaciarla. Dejamos uno para
    // no quedarnos sin puntos — dura 0 ms, así que no se emite igual.
    if (fin === 0) fin = 1
    const quietos = win.slice(0, fin)
    const desde = quietos[0].ts
    const hasta = quietos[quietos.length - 1].ts
    if (hasta - desde >= minMs) {
      const c = centroDe(quietos)
      paradas.push({ lat: c.lat, lng: c.lng, desde, hasta, duracionMs: hasta - desde, puntos: quietos.length })
    }
    return win.slice(fin)
  }

  let win = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const cand = [...win, pts[i]]
    if (esParada(cand, radioM)) {
      win = cand
      continue
    }
    // El punto nuevo rompió la condición: cerramos y arrancamos ventana nueva con los
    // sobrantes + el punto que rompió (cada punto se procesa una sola vez).
    win = [...cerrar(win), pts[i]]
  }
  cerrar(win)
  return paradas
}
