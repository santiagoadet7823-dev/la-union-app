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
import { ACCURACY_MAX_M, MAX_SPEED_MPS, MIN_MOVE_M } from '../services/gpsConfig'

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
//
// Es el mismo valor que `GAP_MS` de `supabase/functions/snap-recorridos/segmentar.ts` y responde la
// misma pregunta ("¿esto es otro tramo?"). Si se toca uno hay que tocar el otro.
export const HUECO_MS = 4 * 60000

/**
 * 🩸 EL HUECO DUDOSO (10/08/2026) — "no sabemos" dibujado como si supiéramos.
 *
 * El cliente reportó que el trazo "salta calles" en tres vendedores. NO era el snap inventando: con
 * el `fraccionCiega` real, Gabriel ya iba **72 % crudo** y Javier **57 %**, o sea que la guarda del
 * snap ya los estaba rechazando. Lo que cruzaba manzanas eran las RECTAS DEL CRUDO.
 *
 * La causa es que la pregunta *"¿sabemos qué pasó en el medio?"* estaba contestada con dos números
 * que difieren ×5: el snap declara ciego un hueco de más de `HUECO_CIEGO_MS` (45 s) y se niega a
 * rutearlo, pero el dibujo recién cortaba a los 4 minutos. Entre esos dos valores el mapa trazaba
 * una recta LLENA — el snap decía "no sé" y el dibujo decía "fue por acá", y ganaba el que miente.
 *
 * Medido: el **45 %** de los km dibujados de Gabriel (10/08) y de Javier (08/08) caía en esa franja,
 * y la recta más larga de esa clase medía **3.839 m**.
 *
 * Un hueco dudoso NO parte el recorrido (para eso está `HUECO_MS`): parte solo el DIBUJO. El tramo
 * queda como un salto entre dos segmentos, y `construirLeaflet` (trazos.js) ya dibuja punteado y
 * fino entre segmentos consecutivos — no hizo falta agregar nada, el mecanismo existía y decía
 * exactamente esto: "siguió siendo la misma persona, pero acá no hay datos".
 *
 * Los kilómetros NO cambian: salen de `puntos`, que conserva los dos extremos del salto. Ese
 * desplazamiento ocurrió de verdad; lo único que deja de afirmarse es POR DÓNDE.
 *
 * Medido con el código real sobre dos días guardados, y discrimina:
 *   Gabriel tevez 10/08 → 45 % del dibujo pasa a punteado (3,415 km, 40 conectores). km: 7,812 sin cambio.
 *   Agustin Vasquez 10/08 (día sano, control) → 2 % (0,115 km). km: 7,084 sin cambio.
 *
 * ⚠️ Vale 45.000 porque es `HUECO_CIEGO_MS` de `segmentar.ts:109`. Son dos constantes en dos runtimes
 * (Deno vs. el bundle) que no pueden compartir módulo: si se cambia una, cambiar la otra.
 */
export const HUECO_DUDOSO_MS = 45000

/**
 * 🩸 KILÓMETROS DE UN RECORRIDO — ÚNICO lugar donde se suman (10/08/2026).
 *
 * Estaba escrito dos veces (un `for` en `kmDeTrazo` de MetricasEquipo.jsx y otro suelto en
 * `construirTrails` de trazos.js), más una tercera vez en SQL dentro de la RPC
 * `metricas_actividad`. Tres sumas de lo mismo, ninguna sincronizada.
 *
 * EL PISO DE RUIDO. Un hop de menos de `MIN_MOVE_M` entre dos puntos GUARDADOS es, por
 * construcción, un punto de cortesía estando quieto: el servicio nativo solo guarda si se movió
 * ≥ minMove **o** si venció el keepAlive, así que por debajo de minMove no hubo movimiento. Esos
 * metros son el jitter del GPS y no se caminaron.
 *
 * El problema de fondo está en `UploaderGpsService.java` (el ancla `lastLat/lastLng` se actualiza
 * también en un punto de cortesía, así que persigue al ruido en vez de sujetarlo) y se corrige en
 * el próximo APK. Este piso corrige el NÚMERO mientras tanto, y además arregla el histórico.
 *
 * Medido con el piso de 9 m sobre 6 días: Zura 10/08 baja 26 % (0,45 de 1,75 km), Nelson rojas
 * 08/08 19 %, Emanuel Arias 06/08 16 %, Gabriel tevez 10/08 13 %.
 *
 * ⚠️ Se usa `MIN_MOVE_M` (9, el umbral a pie) y NO el del modo: es el piso más conservador de los
 * tres, así que nunca descarta un desplazamiento que el teléfono consideró movimiento real.
 */
export function kmDePuntos(points) {
  if (!points || points.length < 2) return 0
  let m = 0
  for (let i = 1; i < points.length; i++) {
    const d = metros(points[i - 1], points[i])
    if (d >= MIN_MOVE_M) m += d
  }
  return m / 1000
}
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
 * 🩸 PUNTOS TRIANGULADOS (1.9.0, 03/08/2026). Desde esta versión el teléfono, cuando el GPS se
 * calla más de 90 s, pide ubicación por antenas y WiFi para no dejar el hueco vacío. Esos puntos
 * llegan con `accuracy` de 20 a 150 m, y la precisión ES la marca: hasta 1.8.1 no existía en
 * `posiciones` un solo punto con accuracy > ACCURACY_MAX_M, porque el uploader los descartaba.
 *
 * Valen para decir "por acá anduvo" y para NADA más, así que salen por una tercera lista:
 *   · NO entran a `puntos` → no suman kilómetros (el número de km sigue saliendo solo del GPS);
 *   · NO entran a `segmentos` → no se dibujan como línea llena ni van al snap;
 *   · sí forman `aproximados`, que se dibujan PUNTEADOS y arrancan/terminan en el punto de GPS que
 *     los rodea, así el tramo aproximado queda cosido al recorrido en vez de flotando.
 * Cambiar un hueco por una línea llena inventada sería el mismo error que el snap cometía.
 *
 * @param {Array<{lat:number,lng:number,ts?:number|string,accuracy?:number}>} points ordenados por ts ASC
 * @returns {{ segmentos: Array<Array<object>>, puntos: Array<object>, aproximados: Array<Array<object>>, descartados: number }}
 *   `segmentos` para dibujar (una polilínea cada uno); `puntos` es todo lo bueno concatenado, que
 *   es lo que necesitan km y paradas; `aproximados` son los tramos triangulados.
 */
export function limpiarTrazo(points) {
  if (!points || points.length === 0) return { segmentos: [], puntos: [], aproximados: [], descartados: 0 }

  const segmentos = []
  const puntos = []
  const aproximados = []
  let aprox = []          // tramo triangulado en curso (arranca en el último punto de GPS bueno)
  let actual = []
  let ult = null          // último punto ACEPTADO (no el anterior del array: si no, un outlier arrastra al que le sigue)
  let ultMs = NaN
  let descartados = 0
  let seguidos = 0

  const cerrarAprox = (siguiente) => {
    if (!aprox.length) return
    // Se cose al punto de GPS que sigue: sin eso el tramo punteado termina en el aire.
    if (siguiente) aprox.push(siguiente)
    if (aprox.length >= 2) aproximados.push(aprox)
    aprox = []
  }

  for (const p of points) {
    if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) continue
    const ms = msDe(p.ts)

    // Triangulado: va al carril aproximado y no toca NADA de lo demás (ni la referencia de saltos,
    // ni los km, ni los segmentos). Ver el 🩸 de arriba.
    if (Number(p.accuracy) > ACCURACY_MAX_M) {
      if (!aprox.length && ult) aprox.push(ult)
      aprox.push(p)
      continue
    }
    cerrarAprox(p)

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
      } else if (dt * 1000 > HUECO_DUDOSO_MS) {
        // HUECO DUDOSO: no alcanza para cortar el recorrido, pero tampoco se puede afirmar por dónde
        // pasó. Se cierra la línea llena acá y el segmento se reabre en el punto nuevo.
        //
        // NO hace falta emitir el conector: `construirLeaflet` (trazos.js) ya dibuja una línea
        // punteada y fina entre cada par de segmentos consecutivos, y existe exactamente para esto
        // — "siguió siendo la misma persona, pero acá no hay datos". Partir el segmento ES el
        // mecanismo completo.
        //
        // Los km NO cambian: salen de `puntos`, que conserva los dos extremos del salto. Ese
        // desplazamiento ocurrió de verdad; lo único que se deja de afirmar es el camino.
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
  // Un tramo triangulado que quedó abierto al final del día no tiene con qué coserse adelante: se
  // cierra igual, que es más honesto que descartarlo (es la última pista de dónde estuvo).
  cerrarAprox(null)

  // Un segmento de un solo punto no se puede dibujar (Leaflet necesita 2) pero SÍ cuenta para km y
  // paradas, por eso se filtra solo acá y no de `puntos`.
  return { segmentos: segmentos.filter((s) => s.length >= 2), puntos, aproximados, descartados }
}
