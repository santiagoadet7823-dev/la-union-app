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
import { limpiarTrazo, simplificarTrazo } from '../../lib/geo'
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
      let km = 0
      for (let i = 1; i < v.points.length; i++) km += distanciaMetros(v.points[i - 1], v.points[i])
      return { id, points: v.points, segmentos: v.segmentos, aproximados: v.aproximados || [], color: colorPorId(id), km: km / 1000 }
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

/**
 * Geometría final para `<LeafletMap trails={...}>`.
 *
 * - `snapOn` → geometría pegada a calles (OSRM, Edge Function); si no hay, cae al crudo.
 * - El crudo se SIMPLIFICA para dibujar (RDP): km y paradas siguen sobre los puntos densos.
 *   La rama snap ya viene simplificada por OSRM y no se re-toca.
 * - Con una persona enfocada, su trazo va nítido (0.95, más grueso) y el resto muy tenue (0.12)
 *   pero visible; sin foco, todos con la opacidad de siempre. El enfocado se dibuja ÚLTIMO para
 *   que los tenues no lo tapen.
 * - 🩸 CONECTORES DE HUECO (30/07/2026). Cada segmento es su propia polilínea, así que entre dos
 *   queda un vacío. Sin nada en el medio, el recorrido parece dos recorridos distintos; con una
 *   línea llena, vuelve la mentira original (una recta que cruza manzanas por las que no pasó).
 *   La línea punteada y fina es la única lectura honesta: "siguió siendo la misma persona, pero
 *   acá no hay datos". No entra al encuadre porque su opacidad queda bajo 0.5 (ver LeafletMap).
 */
export function construirLeaflet({ trails, snapped = {}, snapOn = false, focoId = null }) {
  const out = trails.flatMap((t) => {
    const enfocado = focoId && t.id === focoId
    const opacity = !focoId ? 0.85 : (enfocado ? 0.95 : 0.12)
    const weight = enfocado ? 5 : 4
    const segs = snapOn ? snapped[t.id] : null
    const base = (segs && segs.length)
      ? segs.map((s) => ({ points: s }))
      : (t.segmentos || []).map((s) => ({ points: simplificarTrazo(s) }))
    const piezas = base.map((b) => ({ ...b, color: t.color, id: t.id, opacity, weight }))
    // 🩸 TRAMOS APROXIMADOS (1.9.0): lo que el teléfono triangula por antenas y WiFi cuando el GPS
    // se calla. Van SIEMPRE punteados y finos, también con el snap prendido — porque no son un
    // trazo peor, son otra cosa: "por acá anduvo, con ±80 m". Dibujarlos como línea llena sería
    // cambiar un hueco honesto por una precisión que no tenemos.
    for (const a of t.aproximados || []) {
      if (a.length >= 2) piezas.push({ id: t.id, color: t.color, weight: 2, opacity: opacity * 0.6, dashArray: '2 6', points: a })
    }
    // Los conectores solo tienen sentido sobre el crudo: la rama snap trae los segmentos que
    // decidió OSRM, que no se corresponden con los huecos de captura.
    if (!segs || !segs.length) {
      for (let i = 1; i < base.length; i++) {
        const a = base[i - 1].points
        const b = base[i].points
        if (!a?.length || !b?.length) continue
        piezas.push({
          id: t.id, color: t.color, weight: 2, opacity: opacity * 0.5,
          dashArray: '3 7', points: [a[a.length - 1], b[0]],
        })
      }
    }
    return piezas
  })
  if (focoId) out.sort((a, b) => (a.id === focoId ? 1 : 0) - (b.id === focoId ? 1 : 0))
  return out
}
