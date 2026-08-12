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

/**
 * Pre-pase LINEAL O(n): descarta puntos a menos de `minM` del último conservado. Colapsa barato los
 * racimos de "quieto" (miles de puntos casi idénticos parado en un cliente), que además son el peor
 * caso de RDP. Deja el primero y el último siempre.
 *
 * 🩸 SE PROBÓ HACER ESTE PISO ADAPTATIVO Y NO SIRVIÓ — no repetirlo (10/08/2026, noche).
 *
 * Hipótesis: el cliente reportó "zonas con puntos" (manchas donde el vendedor estuvo parado), y
 * medido sobre la jornada del 10/08 el **58 % de los puntos de la flota** cae dentro de una parada
 * (Zura 89 %, Nelson rojas 87 %, Orlando chavez 70 %… Luis Mendoza 27 %). Parecía que este
 * pre-pase las dejaba pasar enteras: con `epsilonM` 7 el piso es de 3,5 m y el jitter de un
 * teléfono con 20-25 m de precisión separa los puntos 10-25 m.
 *
 * Se implementó `umbral = max(minM, pisoDeRuido(ref, p))` y **se midió A/B en la PWA con la flota
 * entera: 351 paths / 717 vértices SIN el cambio, 352 / 719 CON él.** Cero efecto. Sobre el día de
 * Zura daba 32 → 26 vértices, y ése era el único caso que se movía.
 *
 * El motivo es que RDP y el corte por huecos YA parten el día en tramos cortos, así que a la
 * decimación nunca le llega una nube densa: la cadencia estando quieto entrega un punto cada
 * 38-54 s (medido), no cada 10. En una nube sintética densa sí colapsa (40 → 7 vértices), o sea
 * que serviría si la cadencia volviera a bajar — pero hoy no.
 *
 * **Y las "zonas con puntos" eran otra cosa**: los CONECTORES punteados que dejaba el corte de
 * 45 s (Agustin llegó a 267 en un día), ya resueltos con el piso de distancia de `HUECO_DUDOSO_MS`.
 */
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
 *
 * 🩸 Y EL CORTE NECESITA DOS CONDICIONES, NO UNA (10/08/2026, esa misma tarde). Con solo el tiempo,
 * el corte disparaba sobre saltos que no habían recorrido NADA. Medido sobre la jornada del 10/08,
 * cortes de menos de 9 m sobre el total de cortes dudosos: Alejandro mercado 27 de 27, Orlando
 * chavez 42 de 43, **Agustin Vasquez 181 de 189** — y Agustin es el equipo más sano del parque, con
 * CERO metros dudosos de 50 m o más. O sea: el trazo del vendedor que mejor funciona quedaba picado
 * en 189 pedazos por saltos de 3 metros.
 *
 * La causa es la cadencia: con `NEAR_LIVE_MS` en 30 s (la lenta), **un solo fix perdido ya son 60 s**
 * y eso pasa los 45. Parado en un cliente, cualquier hipo del chip corta el dibujo.
 *
 * Una recta de 3 metros no cruza una manzana: no hay ninguna mentira que prevenir, solo confeti.
 * Se le agrega el piso de `MIN_MOVE_M` (9 m) — la MISMA constante del piso de `kmDePuntos` y del
 * filtro de captura del servicio nativo: por debajo de eso el teléfono considera que no se movió,
 * así que no hay camino que afirmar. Lo que sí tiene distancia real sigue punteado entero (Gabriel
 * tevez conserva sus 6,8 km, Javier 2,3 km, Luis Mendoza 1,2 km).
 *
 * Efecto medido sobre el 10/08: Agustin 189 → 8 cortes, Orlando 43 → 1, Zura 74 → 4, Alejandro
 * 27 → 0, Nelson rojas 86 → 6, Javier 119 → 22, Luis 69 → 14, Gabriel tevez 123 → 63.
 *
 * ⚠️ Esto NO toca los 45.000: el umbral de TIEMPO sigue espejando a `segmentar.ts` y la Edge
 * Function no se toca. Del lado del snap la guarda ya era inmune por construcción — un hop ciego de
 * 3 m aporta ~0 a `fraccionCiega`, que mide LARGO ruteado a ciegas.
 */
export const HUECO_DUDOSO_MS = 45000

/**
 * 🩸 EL PISO DE RUIDO ES ADAPTATIVO, NO UN NÚMERO FIJO (10/08/2026, noche).
 *
 * Un desplazamiento solo es EVIDENCIA de movimiento si supera la incertidumbre de los dos fixes
 * que lo forman. Con 2,7 m de precisión, 9 metros son movimiento; con 23 m, 9 metros son ruido —
 * y hasta hoy el piso era el mismo 9 para los dos casos.
 *
 * Eso explica por qué el mapa se ve tan distinto según la persona. Medido sobre la jornada del
 * 10/08 CON EL ANCLA (que es lo que hace el código; ver `kmDePuntos`), σ combinada = √(σ₁²+σ₂²),
 * k = 0,75:
 *
 *   Agustin Vasquez  σ̄ 2,7 m  · 51,88 → 51,85 km →  −0,1 %   ← no lo toca
 *   Javier           σ̄ 16,5 m · 66,62 → 65,81 km →  −1,2 %   ← no lo toca
 *   Orlando chavez   σ̄ 12,4 m ·  6,93 →  6,56 km →  −5,4 %
 *   Gabriel tevez    σ̄ 16,9 m · 17,12 → 16,00 km →  −6,6 %
 *   Luis Mendoza     σ̄ 21,4 m · 14,45 → 12,68 km → −12,3 %
 *   Alejandro merc.  σ̄ 23,4 m · 14,55 → 12,45 km → −14,4 %
 *   Nelson rojas     σ̄ 20,7 m ·  8,51 →  6,96 km → −18,1 %
 *   Zura             σ̄ 21,7 m ·  1,32 →  0,94 km → −28,9 %   ← no se movió en todo el día
 *
 * **Que discrimine es la prueba de que está bien**: un filtro que recorta parejo estaría comiendo
 * datos buenos. Éste deja intactos a los dos que de verdad viajaron y recorta a los que estuvieron
 * parados. En la ventana de monitoreo de 33 min (19:04-19:37) la separación es aún más cruda:
 * Orlando 231 m de jitter contra 21 m de movimiento real; Gabriel 119 contra 13.
 *
 * ⚠️ **Sin el ancla los recortes se DUPLICAN y son falsos** (Orlando daría −21,8 % en vez de
 * −5,4 %; Zura −40,7 % en vez de −28,9 %). Medir hop por hop cuenta como ruido cada pedacito de un
 * desplazamiento real que se hizo de a poco. Es la cota superior, no el efecto.
 *
 * `k = 0,75` y no 1: a 1σ empieza a comerse caminatas lentas en teléfonos malos, y el criterio del
 * repo ante la duda es NO destruir dato (regla 20). Nunca baja de `MIN_MOVE_M`, así que no puede
 * ser más permisivo que el piso viejo.
 *
 * ⚠️ Depende de que `accuracy` LLEGUE. Estuvo ausente desde 1.9.0 hasta el 08/08/2026 y nadie lo
 * notó porque `NaN > 30` es `false` en silencio (ver `useRecorridosDelDia.js`). Si falta, el
 * término vale 0 y esto degrada exactamente al piso fijo de antes — verificar el campo antes de
 * creerle a esta función.
 */
export const SIGMA_K = 0.75

export function pisoDeRuido(a, b) {
  const sa = Number(a?.accuracy)
  const sb = Number(b?.accuracy)
  // Sin dato de precisión el término se anula: degrada al piso fijo, nunca a algo más permisivo.
  const na = Number.isFinite(sa) && sa > 0 ? sa : 0
  const nb = Number.isFinite(sb) && sb > 0 ? sb : 0
  return Math.max(MIN_MOVE_M, SIGMA_K * Math.hypot(na, nb))
}

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
 *
 * 🩸 Y SE MIDE CONTRA UN ANCLA, NO CONTRA EL PUNTO ANTERIOR (10/08/2026, noche). Con el piso
 * adaptativo (`pisoDeRuido`) el umbral en un teléfono malo llega a ~26 m, y descartando hop por hop
 * un peatón lento perdería la caminata entera en pedacitos que nunca llegan solos al umbral. El
 * ancla acumula: se queda quieta mientras el desplazamiento sea ruido y salta —sumando el tramo
 * completo— recién cuando hay evidencia de que se movió. Es la misma idea que el ancla del servicio
 * nativo (`UploaderGpsService.procesarFix`), y por el mismo motivo.
 */
export function kmDePuntos(points) {
  if (!points || points.length < 2) return 0
  let m = 0
  let ancla = points[0]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]
    const d = metros(ancla, p)
    if (d >= pisoDeRuido(ancla, p)) { m += d; ancla = p }
  }
  return m / 1000
}
// 800 m: más que la cuadra más larga del pueblo y menos que cualquier traslado real entre clientes.
export const HUECO_M = 800

/**
 * 🩸 EL CARRIL PUNTEADO TAMBIÉN INVENTABA CAMINO (12/08/2026) — y era el mismo error de la regla 49,
 * cometido de nuevo en el otro carril.
 *
 * El cliente reportó que el trazo "sigue haciendo trazos por sobre las cuadras". Medido sobre la
 * jornada del 12/08, separando los metros dibujados por carril:
 *
 *                    línea llena (GPS puro)      punteado (triangulado)
 *   Javier              8.486 m · 21 m/tramo      32.951 m (80 %) · 141 m/tramo · el mayor 4.174 m
 *   Luis Mendoza        5.051 m                    9.474 m (65 %) · 13 tramos > 150 m
 *   Gabriel tevez      11.931 m                    4.173 m (26 %) ·  8 tramos > 150 m
 *   Orlando · Agustin  32.323 · 50.054 m                    0
 *
 * O sea: **el 80 % de los metros que se dibujaban de Javier salían del carril triangulado**, y su
 * línea de GPS puro promedia 21 m por tramo — ésa nunca estuvo mal. Lo que cruzaba las manzanas eran
 * las rectas del punteado.
 *
 * El error de diseño es unir con una LÍNEA dos fixes de ±60-120 m. Un punto así sirve para decir
 * "por acá anduvo"; una recta entre dos afirma **por dónde fue**, que es exactamente lo que no se
 * sabe. Con 4 km entre dos puntos eso no es un trazo impreciso: es una invención.
 *
 * El reparto de los tramos punteados de ese día dice dónde cortar (toda la flota):
 *
 *   < 40 m   268 tramos ·  3.084 m   ← más corto que el propio error del fix: no cruza nada
 *   40-80 m   94 tramos ·  5.716 m
 *   80-150 m  50 tramos ·  5.327 m
 *   150-400 m 29 tramos ·  6.543 m
 *   > 400 m   15 tramos · 25.883 m   ← el 3 % de los tramos con el 56 % de los metros
 *
 * 150 m: por debajo la recta es del orden de la incertidumbre y es inofensiva; por encima empieza a
 * atravesar manzanas. Deja de dibujar 44 tramos que cargaban 32,4 km de camino inventado.
 *
 * ⚠️ **Los puntos NO se descartan**: se sigue viendo dónde estuvo, solo se deja de afirmar el camino
 * entre uno y el siguiente. Es la misma decisión que `HUECO_DUDOSO_MS` tomó para la línea llena.
 * ⚠️ Y los km NO cambian: salen de `puntos`, que nunca incluyó a los triangulados (regla 40).
 */
export const APROX_MAX_TRAMO_M = 150

/* ==============================================================================================
   🩸 PINCHOS — el punto que se va y vuelve (10/08/2026, noche).

   El cliente reportó "trazos irracionales". Son PINCHOS: un fix que se aleja 40-90 m y el
   siguiente vuelve al mismo lugar. En el mapa es una púa que sale de la calle y entra de nuevo.

   El filtro de salto imposible NO los ve, y no es un descuido: mide VELOCIDAD, y 89 m en 16 s son
   20 km/h — perfectamente normales. `MAX_SPEED_MPS` está calibrado en 162 km/h para teleports de
   127 km (regla 22-bis), no para esto.

   Medido sobre la jornada del 10/08: **19 pinchos, 1.964 metros falsos**, 12 de ellos de un solo
   teléfono (Luis Mendoza). Y de dónde salen, que es lo que decide el arreglo:

     precisión 0-15 m  → 46,1 % de los puntos →  0 % de los pinchos
     precisión 15-20 m → 22,3 % de los puntos → 10,5 %
     precisión 20-30 m → 31,6 % de los puntos → 89,5 %   ← acá están

   ⚠️ **Y la salida NO es bajar `ACCURACY_MAX_M`**, aunque la tabla lo sugiera. Medido: con techo
   20 m, Alejandro mercado pierde el **75,1 %** de sus puntos, Zura 62 %, Nelson rojas 61,9 % y
   Luis Mendoza 60 % — les vacía el recorrido. La regla 18 tiene razón y esta medición la confirma
   en vez de contradecirla. Por eso el filtro es GEOMÉTRICO: ataca la forma del glitch, no la banda
   de precisión donde vive, y así no le cuesta un punto legítimo a nadie.

   Se decide con los dos VECINOS, así que hace falta una pasada previa: `limpiarTrazo` es un
   recorrido hacia adelante y no puede mirar el punto que sigue.
   ============================================================================================== */
export const PINCHO_DESVIO_M = 40    // cuánto se tiene que ir para llamarlo pincho
export const PINCHO_REGRESO_M = 25   // los dos vecinos casi en el mismo lugar: por eso es ida y vuelta
export const PINCHO_MAX_MS = 120000  // la ida y la vuelta, dentro de 2 min

/**
 * Índices de los puntos que son un pincho. Solo mira el carril de GPS: un punto TRIANGULADO no
 * toca la referencia de `limpiarTrazo` (va por `aproximados`), así que tampoco puede ser vecino
 * de un pincho ni serlo él mismo.
 *
 * Limitación conocida y aceptada: dos pinchos SEGUIDOS se tapan entre sí (cada uno es vecino del
 * otro y ninguno cumple el regreso). No se persigue ese caso — en la jornada medida no aparece
 * ninguno, y una pasada iterativa correría el riesgo de comerse una curva cerrada real.
 */
function marcarPinchos(points) {
  const malos = new Set()
  const idx = []
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) continue
    if (Number(p.accuracy) > ACCURACY_MAX_M) continue
    idx.push(i)
  }
  for (let k = 1; k < idx.length - 1; k++) {
    const a = points[idx[k - 1]]
    const p = points[idx[k]]
    const b = points[idx[k + 1]]
    const dt = msDe(b.ts) - msDe(a.ts)
    // Sin reloj no se puede afirmar que la ida y la vuelta pasaron juntas: no se descarta nada.
    if (!(dt > 0 && dt <= PINCHO_MAX_MS)) continue
    // El desvío tiene que superar TAMBIÉN el piso de ruido de esos fixes: con 25 m de precisión,
    // 40 m está dentro de lo que el propio teléfono admite no saber.
    const minDesvio = Math.max(PINCHO_DESVIO_M, pisoDeRuido(a, p))
    if (metros(a, p) > minDesvio && metros(p, b) > minDesvio && metros(a, b) < PINCHO_REGRESO_M) {
      malos.add(idx[k])
    }
  }
  return malos
}
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

  // Corta el tramo punteado en curso y lo emite si tiene con qué dibujarse.
  const emitirAprox = () => {
    if (aprox.length >= 2) aproximados.push(aprox)
    aprox = []
  }

  const cerrarAprox = (siguiente) => {
    if (!aprox.length) return
    // Se cose al punto de GPS que sigue: sin eso el tramo punteado termina en el aire. Pero solo si
    // está CERCA — si el próximo fix bueno aparece a 4 km, coserlo dibuja justamente la recta que
    // este cambio vino a sacar (ver el 🩸 de APROX_MAX_TRAMO_M).
    if (siguiente && metros(aprox[aprox.length - 1], siguiente) <= APROX_MAX_TRAMO_M) aprox.push(siguiente)
    emitirAprox()
  }

  // Pasada previa: los pinchos se deciden mirando los DOS vecinos y este bucle va hacia adelante.
  const pinchos = marcarPinchos(points)

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (!p || !Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lng))) continue
    // Pincho: se va y vuelve al mismo lugar. Se descarta como el salto imposible —no toca la
    // referencia ni los km— pero no cuenta para `seguidos`: no es "la referencia está podrida",
    // es un fix aislado y el que viene es bueno. Ver el 🩸 de `marcarPinchos`.
    if (pinchos.has(i)) { descartados++; continue }
    const ms = msDe(p.ts)

    // Triangulado: va al carril aproximado y no toca NADA de lo demás (ni la referencia de saltos,
    // ni los km, ni los segmentos). Ver el 🩸 de arriba.
    if (Number(p.accuracy) > ACCURACY_MAX_M) {
      // 🩸 Se corta el tramo si el salto hasta este punto pasa de APROX_MAX_TRAMO_M: unir con una
      // recta dos fixes de ±100 m separados por kilómetros no es un trazo impreciso, es una
      // invención — y era el 80 % de los metros que se dibujaban de Javier. Ver el 🩸 de la
      // constante. El punto NO se descarta: arranca un tramo nuevo, así se sigue viendo dónde
      // estuvo y solo se deja de afirmar el camino entre uno y otro.
      const anterior = aprox.length ? aprox[aprox.length - 1] : ult
      if (anterior && metros(anterior, p) > APROX_MAX_TRAMO_M) emitirAprox()
      if (!aprox.length && ult && metros(ult, p) <= APROX_MAX_TRAMO_M) aprox.push(ult)
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
      } else if (dt * 1000 > HUECO_DUDOSO_MS && d >= pisoDeRuido(ult, p)) {
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
        //
        // El `d >= pisoDeRuido(...)` de la condición es el piso de distancia: un salto de tiempo
        // que no recorrió nada no tiene camino que ocultar, y cortar ahí solo pica el trazo. Ver
        // el 🩸 de `HUECO_DUDOSO_MS`, con los números del 10/08. Usa el piso ADAPTATIVO y no el
        // fijo por el mismo motivo que los km: en un teléfono con 25 m de precisión, 12 metros de
        // "desplazamiento" durante el hueco no son evidencia de que se haya movido a ningún lado.
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
