/**
 * Recorridos → geometría de Leaflet, para las DOS supervisiones (Movil y Desktop).
 *
 * Vive acá por el MISMO motivo que ./dwells.js, y con la misma cicatriz: `SupervisionMovil` y
 * `SupervisionDesktop` no comparten una línea de código, y este bloque ya divergió una vez. El
 * arreglo de performance del 26/07/2026 (`simplificarTrazo`, para una jornada de ~11k puntos que
 * trababa el mapa varios segundos) se aplicó SOLO en Movil; en Desktop se siguió mandando el rastro
 * crudo entero durante dos días, hasta que alguien se dio cuenta el 28/07. Duplicar esto es
 * garantizar que vuelva a pasar, así que ahora hay una sola copia.
 *
 * Cuatro funciones, en el orden en que se usan:
 *   limpiarPorUsuario  → saca los saltos imposibles y parte por huecos (lib/geo.limpiarTrazo)
 *   construirTrails    → uno por persona, con sus km, filtrado por el chip Vend./Rep.
 *   construirInicios   → el marcador de arranque del día (a qué hora se prendió el GPS)
 *   construirLeaflet   → las polilíneas finales, con foco, snap y conectores de hueco
 */
import { colorPorId } from '../../lib/colors'
import { kmDePuntos, limpiarTrazo, simplificarTrazo } from '../../lib/geo'
import { fmtHora } from '../../lib/format'
import { distanciaMetros } from '../../services/geolocation/geofence'

/**
 * Limpia el recorrido de cada persona UNA sola vez. De acá salen las cuatro cosas que se muestran
 * —trazos, km, paradas y el resumen del pin—, así que ninguna puede contar un recorrido distinto.
 *
 * @param {Record<string,{rol?:string, points?:Array}>} byUserCrudo lo que devuelve useRecorridosDelDia
 * @returns {Record<string,{rol?:string, points:Array, segmentos:Array<Array>, descartados:number}>}
 */
export function limpiarPorUsuario(byUserCrudo) {
  const out = {}
  for (const [id, v] of Object.entries(byUserCrudo || {})) {
    const r = limpiarTrazo(v.points || [])
    // `aproximados` (1.9.0) son los tramos triangulados por antenas/WiFi. Van aparte de `points` a
    // propósito: no suman km ni cuentan para paradas. Ver el 🩸 de `limpiarTrazo`.
    out[id] = { rol: v.rol, points: r.puntos, segmentos: r.segmentos, aproximados: r.aproximados, descartados: r.descartados }
  }
  return out
}

/** Cuántos puntos se descartaron en toda la empresa (para reportarlo, no para decidir nada). */
export const totalDescartados = (byUser) =>
  Object.values(byUser || {}).reduce((a, v) => a + (v.descartados || 0), 0)

/**
 * Un trazo por persona con >= 2 puntos que pase el filtro del chip. Los km salen de los puntos
 * LIMPIOS: sobre los crudos, el 29/07/2026 un vendedor figuraba con 524,8 km porque cuatro fixes
 * falsos lo mandaban 127 km al norte y lo traían. Su día real fueron 17,9 km.
 */
export function construirTrails(byUser, pasaFiltro) {
  return Object.entries(byUser)
    .filter(([, v]) => v.points.length >= 2 && pasaFiltro(v.rol))
    .map(([id, v]) => {
      // 🩸 El km sale del MISMO helper que usa MetricasEquipo (`kmDePuntos`, lib/geo.js). Estaba
      // duplicado acá como un for suelto, y cuando se le agregó el piso de ruido en un lado el otro
      // habría seguido inflando — el panel y la supervisión mostrando distinto para el mismo día.
      return { id, points: v.points, segmentos: v.segmentos, aproximados: v.aproximados || [], color: colorPorId(id), km: kmDePuntos(v.points) }
    })
}

/**
 * Marcador de INICIO: el primer punto del día de cada persona, con la hora a la que se prendió
 * el GPS.
 *
 * 🩸 05/08/2026 — nace de un problema de campo. Con el horario de rastreo en 08:00, el arranque
 * llegaba tarde (medido sobre 29 días hábiles: mediana de 51 min, y el 79 % de los días con más de
 * 15 min de retraso), y desde el mapa NO había forma de verlo: el primer punto ya estaba dibujado,
 * pero indistinguible del resto del trazo. Poder leer "este arrancó 08:47" de un vistazo es lo que
 * convierte un problema invisible en uno que se mira.
 *
 * Sale de `trails` y no de `byUser` a propósito, por dos motivos:
 *   · hereda gratis el filtro del chip Vend./Rep. (mismo criterio que las polilíneas);
 *   · y sobre todo, `trails` trae los puntos YA LIMPIOS (regla 22-bis). Sobre el crudo el primer
 *     punto del día puede ser un teleport, y el marcador de arranque quedaría plantado a 127 km de
 *     donde la persona arrancó de verdad — que es exactamente el bug del 29/07/2026, pero peor:
 *     acá la mentira no sería un número raro, sería un ícono afirmando una hora y un lugar.
 */
export function construirInicios(trails) {
  return (trails || []).flatMap((t) => {
    const p = t.points?.[0]
    if (!p) return []
    return [{ id: t.id, lat: p.lat, lng: p.lng, ts: p.ts || null, color: t.color, hora: p.ts ? fmtHora(p.ts) : '' }]
  })
}

/**
 * Marcador de CIERRE: el último punto del día de cada persona. Simétrico a `construirInicios` y con
 * las mismas dos razones para salir de `trails` y no de `byUser` (filtro heredado + puntos limpios).
 *
 * ⚠️ Es el ÚLTIMO PUNTO RECIBIDO, no un fin de jornada declarado: esta app no tiene botón de
 * finalizar. Si el teléfono se quedó sin batería a las 14:10, esto marca las 14:10 — y por eso el
 * marcador se rotula "último punto". La distinción entre "terminó" y "dejó de reportar" la hace el
 * reporte, cruzando esta hora contra la ventana de rastreo asignada.
 */
export function construirFines(trails) {
  return (trails || []).flatMap((t) => {
    const p = t.points?.[t.points.length - 1]
    if (!p) return []
    return [{ id: t.id, lat: p.lat, lng: p.lng, ts: p.ts || null, color: t.color, hora: p.ts ? fmtHora(p.ts) : '' }]
  })
}

/** Largo de una polilínea de puntos {lat,lng}, en metros. */
function largoDe(linea) {
  let m = 0
  for (let i = 1; i < linea.length; i++) m += distanciaMetros(linea[i - 1], linea[i])
  return m
}

/**
 * ¿La geometría pegada a calles representa el recorrido, o perdió pedazos por el camino?
 *
 * Se comparan LARGOS y no cantidad de tramos: el snap agrupa y adelgaza a propósito, así que contar
 * piezas no dice nada, pero el largo total sí — un ruteo honesto queda cerca del crudo (la guarda
 * anti-detour de la propia Edge Function ya rechaza lo que se alargue más de ×1,5/×1,8).
 *
 * El umbral sale de los datos del 12/08: los recorridos sanos daban 100 % de cobertura y los rotos
 * 0 % (Nelson) y 38 % (Luis). Con 0,75 los dos casos malos caen del lado correcto y queda margen
 * para el adelgazado normal del snap, que sobre un día 100 % crudo ya da ~×0,86.
 */
const COBERTURA_MIN = 0.75

function cubreElRecorrido(segs, segmentosCrudos) {
  const crudo = (segmentosCrudos || []).reduce((a, s) => a + largoDe(s), 0)
  // Sin crudo con qué comparar no hay nada que sospechar: se usa lo pegado.
  if (crudo <= 0) return true
  const pegado = segs.reduce((a, s) => a + largoDe(s), 0)
  return pegado >= COBERTURA_MIN * crudo
}

/**
 * Geometría final para `<LeafletMap trails={...}>`.
 *
 * - El trazo es SIEMPRE el crudo, simplificado para dibujar (RDP): km y paradas siguen sobre los
 *   puntos densos. El pegado a calles de los TRAMOS se retiró el 18/08/2026 — ver el 🩸 adentro.
 * - De la Edge Function solo se usa `_conectores`: la ruta de los huecos largos.
 * - Con una persona enfocada, su trazo va nítido (0.95, más grueso) y el resto muy tenue (0.12)
 *   pero visible; sin foco, todos con la opacidad de siempre. El enfocado se dibuja ÚLTIMO para
 *   que los tenues no lo tapen.
 * - 🩸 CONECTORES DE HUECO (30/07/2026). Cada segmento se dibuja por separado, así que entre dos
 *   queda un vacío. Sin nada en el medio, el recorrido parece dos recorridos distintos; con una
 *   línea llena, vuelve la mentira original (una recta que cruza manzanas por las que no pasó).
 *   La línea punteada y fina es la única lectura honesta: "siguió siendo la misma persona, pero
 *   acá no hay datos". No entra al encuadre porque su opacidad queda bajo 0.5 (ver LeafletMap).
 *
 * 🩸 UNA PIEZA POR PERSONA Y POR TIPO, NO UNA POR TRAMO (10/08/2026, noche). El cliente reportó que
 * al final de la jornada el mapa queda imposible de usar, "re lento y trabado". **No era la
 * cantidad de puntos.** Medido en la PWA con los 8 equipos del día: **352 `<path>` de SVG para 719
 * vértices en total — 345 de esos paths tenían exactamente DOS puntos**, más 111 markers. O sea
 * ~463 capas de Leaflet, y cada capa se re-proyecta entera en cada pan y cada zoom. 719 vértices no
 * le pesan a nadie; 463 capas sí.
 *
 * La causa es que el día se parte en muchos tramos (huecos de GPS) y antes cada tramo, cada
 * aproximado y cada conector era su PROPIA polilínea. Como todos los de una persona comparten
 * color, grosor, opacidad y dashArray, van en UNA sola capa multi-línea (`lineas`, array de arrays,
 * que Leaflet acepta de forma nativa): 352 capas → ~24, tres por persona.
 *
 * **No cambia ni un pixel de lo que se dibuja**: son exactamente las mismas líneas, agrupadas.
 */
// `snapOn` ya no se recibe: el pegado de tramos se retiró y los conectores van siempre. Se deja el
// parámetro fuera a propósito y no como ignorado, para que un llamador que todavía lo pase falle en
// la revisión en vez de creer que sigue teniendo un interruptor.
export function construirLeaflet({ trails, snapped = {}, focoId = null }) {
  const out = trails.flatMap((t) => {
    const enfocado = focoId && t.id === focoId
    const opacity = !focoId ? 0.85 : (enfocado ? 0.95 : 0.12)
    const weight = enfocado ? 5 : 4
    // 🩸 EL SNAP NO PUEDE BORRAR RECORRIDO (12/08/2026) — invariante, no optimización.
    //
    // La geometría pegada REEMPLAZA a la cruda, así que cualquier tramo que la Edge Function decida
    // no devolver **desaparece del mapa**. Y devolvía de menos: `snap-recorridos` descartaba entero
    // todo segmento que `isStationary` considerara quieto (mediana de distancia al centro < 40 m),
    // que con un teléfono de 20 m de error se cumple caminando un par de cuadras. Medido sobre la
    // jornada del 12/08, metros que desaparecían al prender "Calles":
    //
    //   Nelson rojas  6.446 m — **el 100 % de su día**  ·  Luis Mendoza 5.230 m (62 %)
    //   Gabriel tevez 1.591 m (18 %)  ·  Orlando y Agustin (precisión 1,6 m): 0 m
    //
    // Lo reportó el cliente con el mecanismo exacto: *"al tener un ruido de gps el pegado a calles no
    // sabe a cuál va y elimina el trazo"*.
    //
    // La causa se arregla en la Edge Function (ALGO 11: quieto = no rutear, pero sí dibujar). Esta
    // guarda es la RED DE CONTENCIÓN, y se queda para siempre: el snap es un servicio remoto con su
    // propio cache y sus propias guardas, y ninguna de ellas puede tener licencia para borrar
    // kilómetros del recorrido. Si lo pegado cubre bastante menos que el crudo, se dibuja el crudo.
    /* 🩸 EL PEGADO DE TRAMOS SE RETIRÓ (18/08/2026), A PEDIDO EXPLÍCITO DEL CLIENTE.
     *
     * Textual: *"hay trazos que toman caminos que nunca recorrió, así que lo ideal es sacarlo y
     * borrar, porque hay teléfonos que son muy fieles a la ubicación que envían"*. Y tiene razón
     * medida: Orlando y Agustin trabajan con p90 de 1,9 y 5,0 m de precisión, y sobre un rastro así
     * el ruteo solo puede AGREGAR error — OSRM reencamina entre waypoints y elige el camino más
     * corto, que no siempre es el que se hizo. El botón "Calles" además se retiró de la interfaz:
     * los encargados no entendían qué prendía y lo confundían con otras cosas.
     *
     * Lo que SÍ se conserva es el CONECTOR de los huecos largos, que es otro mecanismo (existe
     * separado desde 1.14.6, justamente por esto): cuando el teléfono se calla 27 minutos y
     * reaparece a 25 km, la recta a campo traviesa es imposible y la ruta es la única lectura
     * honesta. Eso se validó con el cociente ruta/recta (×1,008 a ×1,106 en los 7 casos reales) y no
     * reencamina nada de lo observado — solo une dos puntas que no tienen nada en el medio.
     *
     * Para volver a prenderlo: `snapped[t.id]` sigue llegando de la Edge Function y
     * `cubreElRecorrido` sigue escrita más arriba con su calibración. Son tres líneas y el botón.
     */
    const conectoresRuteados = snapped?._conectores?.[t.id] || null
    // OJO: `(s) => simplificarTrazo(s)` y no `.map(simplificarTrazo)` — map pasa el ÍNDICE como
    // segundo argumento y ahí sería `epsilonM`, o sea una tolerancia distinta por segmento.
    const lineas = (t.segmentos || []).map((s) => simplificarTrazo(s)).filter((s) => s.length >= 2)
    const piezas = []
    if (lineas.length) piezas.push({ id: t.id, color: t.color, opacity, weight, lineas })
    // 🩸 TRAMOS APROXIMADOS (1.9.0): lo que el teléfono triangula por antenas y WiFi cuando el GPS
    // se calla. Van SIEMPRE punteados y finos, también con el snap prendido — porque no son un
    // trazo peor, son otra cosa: "por acá anduvo, con ±80 m". Dibujarlos como línea llena sería
    // cambiar un hueco honesto por una precisión que no tenemos.
    const aprox = (t.aproximados || []).filter((a) => a.length >= 2)
    if (aprox.length) piezas.push({ id: t.id, color: t.color, weight: 2, opacity: opacity * 0.6, dashArray: '2 6', lineas: aprox })
    // Los conectores solo tienen sentido sobre el crudo: la rama snap trae los segmentos que
    // decidió OSRM, que no se corresponden con los huecos de captura.
    //
    // 🩸 CONECTORES SÓLIDOS DESDE 1.14.3 (13/08/2026), A PEDIDO EXPLÍCITO DEL CLIENTE: *"subí para
    // que dejen de aparecer los huecos o zonas punteadas, la ruta debe ser un trazo casi prolijo
    // porque no hay edificios que obstruyan la señal"*.
    //
    // POR QUÉ SE CAMBIA ACÁ Y NO SUBIENDO `HUECO_MS`/`HUECO_M`, que era lo primero que pedía el
    // cliente y lo que yo iba a hacer. Los umbrales parten los SEGMENTOS, y los segmentos los
    // consume algo más: `features/reportes/informe.js` saca los "huecos de señal" de los bordes
    // entre segmentos (`huecosDeSenal`). Subir los umbrales habría hecho desaparecer del informe el
    // silencio de 28 minutos de la ruta de Javier — o sea, habría borrado la medición del problema
    // que estamos persiguiendo, para que el mapa se viera lindo. El punteado nunca estuvo en los
    // datos: lo dibujaba esta línea. Cambiando SOLO el estilo, el mapa queda continuo y el modelo
    // sigue diciendo la verdad: `segmentos`, `puntos`, los km, el informe y el snap no se enteran.
    //
    // ⚠️ Lo que esto SÍ hace, y hay que saberlo: une con una recta llena dos puntos separados por un
    // hueco. En la ruta es razonable (25 km entre pueblos, sin calles paralelas con las que
    // confundirse, que es el caso que motivó el pedido). En el pueblo una recta sobre un hueco largo
    // puede cruzar manzanas por las que nadie pasó — es exactamente el "salta calles" del 10/08, y
    // vuelve a ser posible. La red de contención que queda es el filtro de salto imposible
    // (`MAX_SPEED_MPS`, 45 m/s), que sí sigue vivo y descarta los teleports de verdad.
    //
    // Los `aproximados` (triangulados) NO se tocan: siguen punteados y finos. Esos no son un hueco
    // sino datos de ±100 m, y dibujarlos llenos sería afirmar una precisión que no existe. Además
    // dejan de generarse solos: el modo `simple` apaga la triangulación (ver `gpsPerfil.js`).
    //
    // 🩸 Y DESDE 1.14.6 EL HUECO LARGO VIENE RUTEADO DEL SERVIDOR. El caso que lo motivó, textual:
    // *"no puede estar en González y aparecer en Lajitas, debió ir por la ruta"* — 7 tramos de 21 a
    // 27 km, con el teléfono mudo, unidos por esta recta. Cuando el hueco mide más de 5 km, se hizo
    // en menos de 90 min y a velocidad de vehículo, `snap-recorridos` devuelve la RUTA real en
    // `_conectores` (y solo si esa ruta mide menos de ×1,25 la recta, que es la prueba de que hay un
    // solo camino posible). En el pueblo no se activa nunca: ahí la recta corta sigue siendo menos
    // mentira que inventar una calle.
    // El conector RUTEADO de los huecos largos (ver el 🩸 de arriba). Se dibuja siempre que la Edge
    // Function lo haya devuelto: es independiente del pegado de tramos, que se retiró.
    if (conectoresRuteados?.length) {
      piezas.push({ id: t.id, color: t.color, weight, opacity, lineas: conectoresRuteados })
    }
    // Y la recta para el resto de los huecos — los cortos, que son la enorme mayoría. Se saltean los
    // que YA tienen conector ruteado: dibujar los dos deja una recta a campo traviesa por encima de
    // la ruta real, que es justo lo que se vino a sacar. Se emparejan por las puntas, con la
    // tolerancia de un hop (`GAP_M`/16): el ruteo arranca y termina en el punto encajado a la
    // calle, a metros del dato, así que comparar por igualdad exacta no serviría.
    const conectores = []
    for (let i = 1; i < lineas.length; i++) {
      const a = lineas[i - 1]
      const b = lineas[i]
      const desde = a[a.length - 1]
      const hasta = b[0]
      const yaRuteado = (conectoresRuteados || []).some((g) => {
        if (!g || g.length < 2) return false
        return distanciaMetros(g[0], desde) < 50 && distanciaMetros(g[g.length - 1], hasta) < 50
      })
      if (!yaRuteado) conectores.push([desde, hasta])
    }
    if (conectores.length) piezas.push({ id: t.id, color: t.color, weight, opacity, lineas: conectores })
    return piezas
  })
  if (focoId) out.sort((a, b) => (a.id === focoId ? 1 : 0) - (b.id === focoId ? 1 : 0))
  return out
}
