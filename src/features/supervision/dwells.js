/**
 * Paradas → carteles del mapa, para las DOS supervisiones (Movil y Desktop).
 *
 * Vive acá y no dentro de cada vista porque `SupervisionMovil` y `SupervisionDesktop` no
 * comparten una sola línea de código: duplican GESTION_ITEMS, themeBtn, Chevron, esRep… y
 * ya divergieron antes (los carteles salieron en 1.5.7 solo en Movil, y por eso en la PWA
 * de escritorio no aparecían). Cualquier cosa que las dos tengan que mostrar IGUAL va acá.
 */
import { detectarParadas } from '../../services/geolocation/dwell'
import { colorPorId } from '../../lib/colors'
import { fmtDuracion, fmtHora } from '../../lib/format'

/**
 * Línea principal: cuánto estuvo y con cuánta batería.
 *
 * `bateria` es nullable (los fixes anteriores a 1.5.6 no la capturaban), y en ese caso se
 * muestra solo el tiempo en vez de un "null%". OJO con `!= null`: la batería puede ser 0 y
 * un chequeo por falsy la borraría del cartel justo cuando más importa.
 */
export const etiquetaDwell = (p) =>
  p.bateria != null ? `${fmtDuracion(p.duracionMs)} · ${p.bateria}%` : fmtDuracion(p.duracionMs)

/**
 * Línea secundaria: el horario de la parada ('21:26–21:34').
 *
 * Va en su propio renglón y no pegado a la duración porque la píldora se autodimensiona al
 * texto (`white-space:nowrap`): todo en una línea daba ~180 px cruzando el mapa.
 */
export const horarioDwell = (p) => `${fmtHora(p.desde)}–${fmtHora(p.hasta)}`

/**
 * Calcula los carteles a partir del rastro CRUDO (byUser) a propósito: el snapped
 * (geometría OSRM pegada a calles) ya descartó los tramos quietos, así que sobre él una
 * parada no existe. Umbrales: los de dwell.js (3 min / 40 m).
 *
 * Pendiente (bloqueado por datos, no por código): cuando la parada caiga dentro del
 * `geofence_radio` de un cliente, el cartel debería decir el nombre del comercio en vez del
 * horario. Hoy es imposible: de 2.001 clientes, UNO tiene coordenadas — y está inactivo.
 * La tabla tampoco tiene domicilio (solo `localidad`, con un único valor), así que no se
 * pueden geocodificar. Primero hay que resolver de dónde salen esas 2.000 coordenadas.
 *
 * @param {Record<string,{rol?:string, points?:Array}>} byUser
 * @param {(rol?:string) => boolean} pasaFiltro filtro por chip (Vend./Rep.) de cada vista
 * @returns {Array<{lat:number,lng:number,label:string,sub:string,color:string}>}
 */
export function calcularDwells(byUser, pasaFiltro) {
  return Object.entries(byUser)
    .filter(([, v]) => pasaFiltro(v.rol))
    .flatMap(([id, v]) => detectarParadas(v.points || [])
      .map((p) => ({
        lat: p.lat,
        lng: p.lng,
        label: etiquetaDwell(p),
        sub: horarioDwell(p),
        color: colorPorId(id),
      })))
}
