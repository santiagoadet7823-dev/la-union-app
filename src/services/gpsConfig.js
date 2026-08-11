/**
 * Constantes compartidas de filtrado GPS. Antes vivían solo en usePublishPosition
 * y useEstadoDispositivo las duplicaba de forma inconsistente (ignoraba accuracy);
 * un único origen evita que los dos vuelvan a divergir.
 */
// 🩸 ESTE es el umbral que gobierna la densidad del trazo CAMINANDO, no el intervalo de captura
// (30/07/2026). Medido sobre el 29/07 de la empresa: en la banda de 1-5 km/h el intervalo mediano
// entre puntos GUARDADOS era de 30 s exactos — o sea STATIONARY_KEEPALIVE_MS, el latido de cortesía.
// El motivo: a 1 km/h se recorren 4 m en 15 s, no se llega a los 12 m, el fix se descarta y el
// próximo punto que entra es el latido. Con una cuadra por minuto eso daba 2 puntos por cuadra, que
// es justo el número con el que NO se puede saber si pasó por esa calle o por la paralela (hacen
// falta 3). Bajado a 9 m: caminando a 1-1,4 m/s con captura de 10 s se guarda un punto cada 9-14 m.
//
// NO bajar de 9 m: ahí abajo se entra en el ruido del propio GPS y el que está parado empieza a
// dejar racimos de jitter. Lo que hoy contiene ese ruido: el filtro de precisión (ACCURACY_MAX_M),
// `simplificarTrazo` (RDP con épsilon 7 m, que colapsa los racimos al dibujar) y el detector de
// paradas, que trabaja con medianas. Por debajo de 9 m esas tres defensas dejan de alcanzar.
export const MIN_MOVE_M = 9        // metros de desplazamiento mínimos para registrar un punto
export const KEEPALIVE_MS = 90000  // reenvío de cortesía aunque no se mueva (marcador "vivo")
// Cadencia de CAPTURA "casi en vivo" (pedido del cliente 24/07/2026): el chip adquiere a esta cadencia
// para que, EN MOVIMIENTO, el supervisor lo vea moverse en tiempo casi real. Gobierna PRESET_QUIETO.interval
// (estados.js) y el intervaloMs del uploader nativo. OJO: captura ≠ guardado — cuánto se GUARDA lo decide
// el filtro por movimiento (MIN_MOVE_M o STATIONARY_KEEPALIVE_MS), no esta constante.
//
// 🩸 BAJADA DE 10 s A 5 s (03/08/2026). Medido sobre un recorrido real de reparto (Emanuel Arias,
// 03/08, 09:55-10:40, 90 tramos): precisión mediana 15,6 m y distancia mediana entre puntos 10,6 m
// —o sea que caminando la densidad estaba BIEN—, pero **32 tramos de entre 20 y 200 m** (máximo
// 171 m) y cadencia mediana de 15 s. Esos 32 tramos son los saltitos EN VEHÍCULO entre cliente y
// cliente, y son exactamente las diagonales que cruzan la manzana en el mapa.
//
// La cadencia rápida no los cubre: pide superar VEL_UMBRAL_MPS de forma sostenida, y un salto de
// 200 m a 25 km/h dura 29 segundos — se termina antes de que la detección reaccione y aplique el
// intervalo nuevo. La adaptativa sirve para un viaje; para un salto de media cuadra llega tarde
// SIEMPRE. Lo único que cubre el salto corto es la cadencia BASE.
//
// El volumen no se dispara porque el techo de densidad lo pone MIN_MOVE_M (9 m), no esta constante:
// parado sigue mandando el keepalive de 30 s y caminando se sigue guardando cada 9-13 m. Lo que sí
// cuesta es batería (más adquisiciones por minuto); cuánto, hay que medirlo en un teléfono real.
//
// 🩸 Y VUELTA A 10 s EL 03/08/2026, el día siguiente. El razonamiento de arriba sobre los saltos
// cortos sigue siendo correcto; lo que estaba mal era suponer que pedir más seguido significa
// recibir más seguido. Medido sobre el ÚNICO teléfono que llegó a correr 1.8.1 (Gabriel Tevez,
// mismo aparato, misma persona):
//   27/07 (1.6.x): 907 puntos/día, 0,9 % de huecos > 60 s
//   29/07 (1.6.x): 1056 puntos/día, 0,5 %
//   03/08 (1.8.1): 175 puntos en 158 min, **24,0 %** — y 3,7 de sus 5,1 km adentro de esos huecos
// Los otros dos teléfonos, con 1.8.0, ese mismo día estaban perfectos (0,2 % y 3,8 %). O sea que el
// 5 s / 2 s no está probado en ningún lado y el único que lo corrió se degradó 25×.
//
// La causa más probable es el CHURN de `requestLocationUpdates` (cada llamada reinicia la agenda de
// entrega del proveedor, y con 2 s el modo rápido entraba y salía todo el tiempo). Eso se arregla en
// nativo en 1.9.0 (anti-churn + WakeLock + telemetría de cadencia pedida vs entregada), pero hasta
// tener esa medición los números vuelven a los que se sabe que funcionan. La densidad ahora la
// gobierna la distancia por modo, que es más barata en batería y más fiel al trazo que apretar el
// temporizador.
export const NEAR_LIVE_MS = 10000  // 10 s
// Reenvío estando QUIETO. Antes el gate de "quieto" usaba NEAR_LIVE_MS (10 s): un vendedor parado en un
// cliente emitía 6 puntos/min redundantes → inundaba `posiciones`, saturaba Realtime y trababa el mapa
// (medido 26/07/2026). El marcador sigue "vivo" y se corta el volumen de quieto.
// 27/07/2026: bajado de 60 s a 30 s (pedido del cliente: 1 min se siente demasiado "viejo" el marcador
// parado; 30 s da mejor frescura a costa de ~2× el volumen de quieto, aceptable). En movimiento no cambia
// nada: ahí manda MIN_MOVE_M. Lo comparte el filtro nativo (uploaderNativo.js → K_KEEPALIVE del servicio).
export const STATIONARY_KEEPALIVE_MS = 30000  // 30 s
// Cadencia ADAPTATIVA por velocidad (pedido del cliente 27/07/2026): a 15 s de captura, en auto (~40 km/h
// ≈ 11 m/s) el chip da un fix cada ~165 m → la polilínea une esos dos puntos con una RECTA que cruza la
// manzana (el trazo "no respeta la calle"). El filtro por movimiento no ayuda: a esa velocidad todo fix
// supera MIN_MOVE_M y se guarda; el techo de densidad EN MOVIMIENTO lo pone el intervalo de adquisición.
// Solución: el servicio nativo sube la cadencia SOLO cuando detecta alta velocidad (getSpeed) y vuelve a
// la lenta al frenar — más puntos en las curvas/avenidas sin gastar batería parado. Estos valores viajan
// al nativo por uploaderNativo.configurar (SharedPreferences) → afinables por OTA sin recompilar el APK.
// 03/08/2026: bajada de 5 s a 2 s. Medido el mismo día sobre otro tramo del recorrido: en la banda
// de 11-29 km/h (calles del pueblo, que es donde el trazo tiene que distinguir una calle de su
// paralela) la cadencia rápida SÍ estaba activa —5,0 s de mediana— y aun así quedaban 27,8 m entre
// puntos. A 2 s son ~11 m, que es la densidad con la que la esquina se dobla en vez de cortarse.
// En ruta (81 km/h de promedio medido) pasa de 132 m a ~45 m: sigue sin ser fiel, pero ahí no hay
// calles paralelas con las que confundirse — eso lo resuelve el snap, no más puntos.
// 03/08/2026: vuelve a 5 s por el mismo motivo que NEAR_LIVE_MS (ver el 🩸 de arriba). Los 2 s son
// el sospechoso número uno del churn: con ese destino, el modo rápido entraba y salía cada 20-30 s
// y cada entrada reemplazaba el LocationRequest.
export const NEAR_LIVE_RAPIDO_MS = 5000   // captura EN MOVIMIENTO RÁPIDO (auto): trazo que sigue la calle
// 30/07/2026: bajado de 4 m/s (14 km/h) a 3 (11 km/h). La banda de 5-14 km/h —moto lenta, auto en el
// pueblo, alguien apurado— quedaba en cadencia lenta y es donde MÁS falta densidad: son calles de
// ciudad, con paralelas a media cuadra, o sea justo donde un trazo pobre inventa por dónde pasó. En
// ruta (≥40 km/h) el problema no existe aunque los puntos estén lejos: son caminos largos sin otra
// calle con la que confundirse.
export const VEL_UMBRAL_MPS = 3           // ~11 km/h: por encima de esto, activar la cadencia rápida
// 🩸 10/08/2026 — SE PROBÓ SUBIRLO A 45 s Y SE REVIRTIÓ EN LA MISMA SESIÓN, ANTES DE PUBLICAR.
// Queda anotado para que nadie vuelva a intentarlo por el mismo camino.
//
// La hipótesis era: el reparto puerta a puerta cruza el umbral de 3 m/s en cada esquina, cae a la
// cadencia lenta, y el piso anti-churn (REPEDIDO_MIN_MS, 60 s) le impide volver — así que subir la
// histéresis lo mantendría en la rápida. Encajaba con lo medido en movimiento ese día:
//
//   Agustin Vasquez  5,0 s entre puntos · 29 m mediana ·  42 m p90 · 19 km/h
//   Javier          11,5 s              · 45 m         · 158 m p90 · 18 km/h
//   Gabriel tevez   12,9 s              · 64 m         · 157 m p90 · 13 km/h
//
// LA HIPÓTESIS ES FALSA. Se contrastó contando, sobre 3 días, cuántos huecos de ≥25 s en movimiento
// caen justo después de un cruce del umbral. Si el churn de modo fuera la causa, los huecos tendrían
// que estar enriquecidos en cruces respecto de los tramos normales. No lo están:
//
//   Gabriel   1 cruce en 29 huecos (3 %)  vs  33 en 1181 normales (2,8 %)  → CERO enriquecimiento
//   Javier    7 cruces en 49 huecos (14 %) vs  41 en  924 normales (4,4 %)
//   Agustin   5 cruces en 20 huecos (25 %) vs  55 en  713 normales (7,7 %)
//
// Y sobre todo: los huecos de Gabriel —el caso que reportó el cliente— pasan a 0,5-1,5 m/s, o sea
// CAMINANDO, muy por debajo del umbral de 3 m/s. La histéresis no lo toca ni en la vieja ni en la
// nueva: nunca estuvo cerca de la cadencia rápida. El cambio habría sido inerte justo para el caso
// que decía arreglar.
//
// Lo que sí apareció al contrastar: los huecos de Javier y Agustin vienen precedidos por fixes de
// PEOR precisión (25,8 m y 18,4 m de promedio contra 18,9 y 13,2 en los tramos normales), con el
// techo de descarte en 30. O sea que buena parte del hueco es ACCURACY_MAX_M haciendo su trabajo —
// el agujero es el filtro, no el GPS fallando. Y ojo con "arreglarlo" subiendo el techo: eso mete
// de vuelta las vueltas falsas que motivaron la regla 18.
//
// MORALEJA, que es la que vale más que el número: antes de tocar una constante de GPS, contrastar la
// hipótesis contra los datos. Las tres veces que se movió algo acá se movió por una teoría plausible
// y las tres veces la teoría era incompleta.
export const VEL_HIST_MS = 20000          // sostener 20 s bajo el umbral antes de volver a la cadencia lenta (anti-flapping)
export const ACCURACY_MAX_M = 30   // fixes menos precisos que esto NO SE CONFÍAN (jitter de interior = causa #1 de "vueltas" falsas)

/**
 * 🩸 DOS TECHOS, NO UNO: CAPTURAR NO ES CONFIAR (11/08/2026).
 *
 * `ACCURACY_MAX_M` gobernaba TRES cosas distintas a la vez y solo una de las tres quería ese valor:
 * el techo de CAPTURA del servicio nativo, el umbral del carril punteado al DIBUJAR (`limpiarTrazo`)
 * y el filtro del carril JS. Como el nativo tiraba el fix, el dibujo nunca lo veía: el punto no
 * llegaba a existir.
 *
 * Medido sobre la jornada COMPLETA del 11/08 (base viva + telemetría del propio teléfono).
 * ⚠️ Los contadores son acumulados del día y el latido los sube cuando el JS corre: un corte de
 * media mañana da porcentajes muy distintos. Éstos son de cierre.
 *
 *   Alejandro mercado  960 de 1.452 (66 %) · red 0  · silencio 0,3 min → **84 % de sus km sin dibujar**
 *   Javier             457 de 1.507 (30 %) · red 30 · silencio 44,6 min → **84 % sin dibujar**
 *   Luis Mendoza       256 de   923 (28 %) · red 22 · silencio 42,2 min → 27 %
 *   Gabriel tevez      154 de 1.528 (10 %) · red 50                     → 39 %
 *   Orlando chavez      10 de 3.131 ( 0 %) · red 0  · silencio 0,5 min →  **0 %**  ← control
 *   Agustin Vasquez      0 de    62 ( 0 %) · red 0                      → 11 %     ← control
 *
 * Alejandro es el caso que lo prueba, y los controles son los que lo cierran: su servicio **nunca
 * estuvo más de 18 segundos sin recibir un fix**, y aun así perdió **39,6 km de ruta a 76 km/h sin
 * un solo punto**. Los fixes llegaban puntuales y venían todos peores que 30 m, así que se tiraron
 * uno por uno. No fue un silencio del chip: fue este filtro. Los dos teléfonos que descartan ~0 %
 * son exactamente los dos que dibujan bien.
 *
 * Y el parque tiene DOS poblaciones: Orlando y Agustin trabajan con precisión p90 de 1,9 y 5,0 m
 * (trazos perfectos); los otros seis viven en 20-28 m, **pegados al techo**. Un teléfono que se
 * ubica por antenas y WiFi —que es lo que hace el A07 adentro de un vehículo, verificado con
 * `dumpsys location`: `Location[network … hAcc=400.0]`— no puede pasar nunca un techo de 30.
 *
 * Un fix de 60 m no sirve para afirmar POR QUÉ CALLE pasó alguien. Sirve perfectamente para decir
 * **"por acá anduvo"**, y esa distinción ya está construida y probada desde 1.9.0: `limpiarTrazo`
 * manda todo lo que supere `ACCURACY_MAX_M` al carril `aproximados` —punteado fino, fuera de los km,
 * fuera del snap y fuera de la burbuja en vivo (regla 40, `db/28`)—. Lo único que faltaba era que el
 * punto LLEGARA.
 *
 * ⚠️ Esto NO contradice la regla 18, que prohíbe BAJAR `ACCURACY_MAX_M`: ese techo no se mueve y
 * sigue decidiendo qué se dibuja lleno y qué suma kilómetros. El que sube es otro.
 *
 * 120 y no 150 (el techo de `ACCURACY_RED_MAX_M`) a propósito: así la precisión sigue distinguiendo
 * si el punto vino del carril de red o del fused.
 *
 * ⚠️ Riesgo conocido mientras el APK sea 1.13.0: en `UploaderGpsService.procesarFix` un fix
 * impreciso que ahora se acepta también vota la cadencia (`evaluarCadencia`) y pasa a ser la
 * referencia del filtro de salto imposible. Lo contiene el propio filtro (45 m/s) y
 * `MAX_SALTOS_SEGUIDOS`. El próximo APK lo cierra tratándolo con la semántica de `deRed`.
 */
export const ACCURACY_CAPTURA_MAX_M = 120
export const MAX_SPEED_MPS = 45    // ~160 km/h: un desplazamiento más rápido es un salto imposible → glitch
// Cuántos fixes seguidos se pueden descartar por "salto imposible" antes de sospechar de la REFERENCIA
// en vez de los fixes nuevos. Pasa cuando el primer fix tras arrancar el servicio es el malo: sin este
// tope, ese único punto podría descartar la jornada entera.
export const MAX_SALTOS_SEGUIDOS = 3

// ── 1.9.0 · Guardar por DISTANCIA según el modo ──────────────────────────────────────────────────
// El pedido del cliente (03/08/2026): "pasar de temporizador a distancia, cada 10 metros una
// ubicación, y si detecta que es ruta por donde va viajando que sea cada 50 o 100 metros para
// minimizar carga en base de datos".
//
// Se implementa en el filtro de GUARDADO del servicio nativo, no en el LocationRequest:
// `setMinUpdateDistanceMeters` haría que el SO ENTREGUE menos fixes, que es lo contrario de lo que
// hace falta (el problema medido es que llegan pocos, no que sobren).
//
// ⚠️ La banda urbana NO va a 50 m, y la diferencia importa: es donde vive el problema que motivó
// toda esta tanda. Son calles con paralelas a media cuadra, y a 50 m entre puntos el trazo dibuja
// la diagonal que cruza la manzana. Medido: a 5 s de captura en esa banda ya quedaban 27,8 m entre
// puntos y no alcanzaba. Los 100 m van donde el cliente los pidió y donde no cuestan nada — en
// ruta, arriba de 40 km/h, donde no hay calle paralela con la que confundirse.
//
// Dimensión real del "problema" de carga, para no exagerarlo: `posiciones` tiene 25.368 filas y
// 14 MB en total, con 3.171 filas/día. Esto entra porque es lo correcto para el trazo en ruta.
export const MIN_MOVE_URBANO_M = 15   // 11-40 km/h: denso, es donde se confunden las calles
export const MIN_MOVE_RUTA_M = 100    // > 40 km/h: sin paralelas, se puede ralear sin perder nada
export const VEL_RUTA_MPS = 11        // ~40 km/h: desde acá se considera "ruta"

// Cadencia con "quieto" CONFIRMADO por el acelerómetro (Activity Recognition). Es de donde sale la
// batería que cuesta la captura densa; el riesgo es acotado porque parado no hay trazo que perder y
// el marcador lo mantiene vivo STATIONARY_KEEPALIVE_MS. Se deshace con el primer fix que se mueva.
export const NEAR_LIVE_QUIETO_MS = 30000

// ── 1.9.0 · Triangulación por red durante un silencio ────────────────────────────────────────────
// Si el GPS no entrega nada por más de SILENCIO_MS, el teléfono pide ubicación por antenas y WiFi
// para no dejar el hueco vacío. Esos puntos valen para "por acá anduvo" y para nada más: entran con
// su propio techo y el front los dibuja PUNTEADOS, fuera de los km y fuera del snap. La marca es la
// precisión misma — hasta hoy no existe en `posiciones` un solo punto con accuracy > ACCURACY_MAX_M.
export const ACCURACY_RED_MAX_M = 150
export const SILENCIO_MS = 90000

// Piso entre dos cambios de cadencia (anti-churn). Cada `requestLocationUpdates` reemplaza el
// request y reinicia la agenda de entrega del proveedor: cambiar de cadencia cada 20-30 s equivale a
// no recibir nada, y es el sospechoso principal de lo que le pasó a 1.8.1.
export const REPEDIDO_MIN_MS = 60000

// ── 1.11.0 · Arranque del rastreo al horario ─────────────────────────────────────────────────────
// Cada cuánto pinguea el watchdog offline (AlarmManager). 15 min es el piso duro del plugin: por
// debajo, Doze no lo respeta igual (rate-limit de allow-while-idle). Estaba hardcodeado en
// GpsContext.jsx, que es exactamente el patrón que la regla 22-ter existe para evitar.
export const WATCHDOG_MIN = 30

// Cuánto ANTES del inicio de la ventana despertar al servicio.
//
// 🩸 El signo importa y depende de otra decisión. Adelantarse solo tiene sentido porque desde 1.11.0
// el servicio PAUSA fuera de horario en vez de apagarse: despierta, calienta el chip y a las
// 08:00:00 ya tiene fix. Con el comportamiento viejo (stopSelf) despertar a las 07:57 habría sido
// contraproducente — el servicio se habría suicidado a los 30 s y el turno se gastaba igual, que es
// literalmente el bug que se está arreglando. Si alguna vez se vuelve al apagado, esto tiene que
// pasar a ser POSITIVO (inicio + 20 s).
export const ARRANQUE_MARGEN_MS = 180000  // 3 min
