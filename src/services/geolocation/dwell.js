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
 * Nota de densidad: desde el modo "casi en vivo" (24/07/2026) el reenvío estando quieto
 * es cada NEAR_LIVE_MS = 10 s (antes 90 s), así que una parada deja MÁS fixes que antes.
 * El algoritmo ya funcionaba con ventanas chicas (no asume densidad alta): más densidad
 * solo lo hace más preciso, nunca lo rompe.
 *
 * 🩸 PERO CUESTA AL CUADRADO, Y ESO SÍ LO ROMPIÓ (11/08/2026). El párrafo de arriba es cierto
 * sobre la PRECISIÓN y falso sobre el COSTO. El cliente viene reportando hace sesiones que "el mapa
 * se pone lento al final de la jornada", y perfilando el pipeline de la supervisión con el código
 * real sobre la forma de la jornada de hoy:
 *
 *     limpiarTrazo 36 ms · kmDePuntos 18 ms · simplificarTrazo 54 ms · detectarParadas 7.090 ms
 *
 * **El 99 % del tiempo estaba acá**, y el arreglo de capas de Leaflet del 10/08 —que sirvió— no
 * podía tocarlo. Peor: el costo creció SOLO, sin que nadie modificara este archivo, porque depende
 * del cuadrado de los puntos de una parada. Medido: 200 puntos → 55 ms; 800 → 682 ms; 1.200 →
 * 1.561 ms; **2.152 → 5.607 ms**. Y el 11/08 Nelson rojas tenía 2.152 puntos con la racha quieta
 * más larga de 2.152: su jornada entera era UNA ventana, y él solo costaba ~7 segundos.
 * El comentario de `LeafletMap.jsx` que decía "~410 ms por persona-día" era cierto cuando un día
 * traía ~850 puntos. Con 2,5× los puntos costaba 17× más.
 *
 * Lo que se hizo: **las mismas decisiones, sin copiar ni ordenar** (ver `selMediana` y el bucle
 * principal). Medido sobre 63 persona-días REALES de 7 días: **×8,0 más rápido y salida
 * BIT-IDÉNTICA** — 605 paradas, cero días con distinto número, centro corrido 0,0000 m.
 *
 * 🩸 **Y lo que se probó primero y NO sirve, para no repetirlo**: acotar las medianas a una muestra
 * de K puntos de la ventana. Contra trazas SINTÉTICAS daba ×7,7 con salida idéntica y parecía la
 * solución. Contra los 63 persona-días REALES cambiaba el número de paradas en 8 de ellos, con el
 * centro corrido hasta **286 m** y duraciones distintas por hasta **29 minutos** (con K=128 seguía
 * fallando en 5). El dato real tiene deriva y paradas que se solapan; el sintético no. **Ninguna
 * medición de este detector vale si no es contra días guardados.**
 */
import { distanciaMetros } from './geofence'

export const DWELL_MIN_MS = 180000 // 3 min: menos que esto es un semáforo, no una visita
export const DWELL_RADIO_M = 40    // m: mismo umbral que STATIONARY_R en la Edge Function

/**
 * Buffer reusado para las medianas. Vive a nivel de módulo a propósito: `esParada` se llama una vez
 * por punto y antes cada llamada asignaba tres arrays nuevos del tamaño de la ventana — con una
 * parada de 2.000 fixes eso son millones de asignaciones que el GC después tiene que limpiar.
 *
 * ⚠️ No es reentrante, y no puede serlo: `detectarParadas` es sincrónica y JS es de un solo hilo,
 * así que dos llamadas nunca se solapan. Si algún día esto se mueve a un Worker, cada Worker tiene
 * su propio módulo y su propio buffer, así que sigue valiendo.
 */
let _buf = new Float64Array(4096)
const bufDe = (n) => {
  if (_buf.length < n) _buf = new Float64Array(n * 2)
  return _buf
}

/**
 * k-ésimo elemento (k = ⌊n/2⌋) por SELECCIÓN, sin ordenar el resto — mismo resultado que
 * `[...arr].sort()[⌊n/2⌋]`, que es el criterio de la Edge Function (en pares toma el de arriba).
 *
 * Ordenar cuesta O(n log n) y acá solo hace falta UN elemento, que es O(n). Muta el buffer, nunca
 * la entrada.
 */
const selMediana = (a, n) => {
  const k = n >> 1
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const p = a[(lo + hi) >> 1]
    let i = lo
    let j = hi
    while (i <= j) {
      while (a[i] < p) i++
      while (a[j] > p) j--
      if (i <= j) { const t = a[i]; a[i] = a[j]; a[j] = t; i++; j-- }
    }
    if (k <= j) hi = j
    else if (k >= i) lo = i
    else break
  }
  return a[k]
}


/** ts a ms epoch: acepta número o string ISO. Devuelve NaN si no se puede leer. */
const tsMs = (ts) => {
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : NaN
  if (typeof ts === 'string') return new Date(ts).getTime()
  if (ts instanceof Date) return ts.getTime()
  return NaN
}

/**
 * Centro de los primeros `n` puntos de `win`: mediana de lats y de lngs POR SEPARADO (robusto a
 * outliers).
 *
 * Toma `n` en vez de recibir el array ya cortado porque los dos llamadores lo usan sobre un PREFIJO
 * de la ventana, y cortarlo con `slice` era una copia por llamada — en el bucle de punto fijo de
 * `cerrar`, varias por parada.
 */
const centroDe = (win, n = win.length) => {
  const b = bufDe(n)
  for (let i = 0; i < n; i++) b[i] = win[i].lat
  const lat = selMediana(b, n)
  for (let i = 0; i < n; i++) b[i] = win[i].lng
  const lng = selMediana(b, n)
  return { lat, lng }
}

/** ¿Los primeros `n` puntos siguen siendo una parada? Mediana de distancias al centro < radio. */
const esParada = (win, n, radioM) => {
  const centro = centroDe(win, n)
  const b = bufDe(n)
  for (let i = 0; i < n; i++) b[i] = distanciaMetros(centro, win[i])
  return selMediana(b, n) < radioM
}

/**
 * Detecta las paradas de una traza GPS con una ventana deslizante.
 *
 * @param {Array<{lat:number,lng:number,ts:number|string,bateria?:number|null}>} points ordenados por ts ASC
 * @param {{minMs?:number, radioM?:number}} [opts]
 * @returns {Array<{lat:number,lng:number,desde:number,hasta:number,duracionMs:number,puntos:number,bateria:number|null}>}
 *   lat/lng = centro (mediana) de la parada; desde/hasta = ms epoch; puntos = fixes que la
 *   componen; bateria = último % con dato de la parada (null si ningún fix lo trae).
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
    // `bateria` viaja como pasajero: no participa de ningún cálculo (ni del centro ni de
    // la mediana), solo se arrastra para poder mostrarla en el cartel. Es nullable — las
    // posiciones anteriores a 1.5.6 no la tienen.
    pts.push({ lat, lng, ts, bateria: p.bateria })
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
      const centro = centroDe(win, fin)
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
      // Batería: el ÚLTIMO valor con dato de la parada (el nivel al irse del lugar, que es
      // lo informativo). Puede quedar null: los fixes previos a 1.5.6 no la traen.
      let bateria = null
      for (let i = quietos.length - 1; i >= 0; i--) {
        if (quietos[i].bateria != null) { bateria = quietos[i].bateria; break }
      }
      paradas.push({ lat: c.lat, lng: c.lng, desde, hasta, duracionMs: hasta - desde, puntos: quietos.length, bateria })
    }
    return win.slice(fin)
  }

  // 🩸 LA VENTANA CRECE CON `push`, NO CON `[...win, p]` (11/08/2026). Ese spread copiaba la
  // ventana ENTERA una vez por punto: con una parada de 2.152 fixes son ~2,3 millones de copias de
  // referencia solo para probar si el punto siguiente entra. Se prueba empujando y, si no entra, se
  // deshace con `pop` — misma decisión, sin la copia. Ver el 🩸 de la cabecera.
  let win = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    win.push(pts[i])
    if (esParada(win, win.length, radioM)) continue
    win.pop()
    // El punto nuevo rompió la condición: cerramos y arrancamos ventana nueva con los
    // sobrantes + el punto que rompió (cada punto se procesa una sola vez).
    win = cerrar(win)
    win.push(pts[i])
  }
  cerrar(win)
  return paradas
}
