/**
 * Paradas → carteles del mapa, para las DOS supervisiones (Movil y Desktop).
 *
 * Vive acá y no dentro de cada vista porque `SupervisionMovil` y `SupervisionDesktop` no
 * comparten una sola línea de código: duplican GESTION_ITEMS, themeBtn, Chevron, esRep… y
 * ya divergieron antes (los carteles salieron en 1.5.7 solo en Movil, y por eso en la PWA
 * de escritorio no aparecían). Cualquier cosa que las dos tengan que mostrar IGUAL va acá.
 */
import { detectarParadas } from '../../services/geolocation/dwell'
import { distanciaMetros } from '../../services/geolocation/geofence'
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
 * Nombre de comercio (Feature C+, 1.6.x): a medida que los vendedores geolocalizan clientes en
 * el check-in, si una parada cae cerca (≤ MATCH_RADIO_M) de un cliente con lat/lng, el cartel
 * muestra el nombre del comercio en la línea secundaria en vez del horario. `clientes` es
 * opcional: sin él (o sin match), cae al horario de siempre. Antes esto estaba bloqueado por
 * datos (1 de 2.001 clientes tenía coordenadas); ahora se va desbloqueando solo.
 *
 * @param {Record<string,{rol?:string, points?:Array}>} byUser
 * @param {(rol?:string) => boolean} pasaFiltro filtro por chip (Vend./Rep.) de cada vista
 * @param {Array<{lat:number,lng:number,name?:string,nombre_comercio?:string}>} [clientes] cartera geolocalizada
 * @returns {Array<{lat:number,lng:number,label:string,sub:string,color:string}>}
 */
const MATCH_RADIO_M = 60 // un poco más que el radio de parada (40 m) para tolerar el jitter del centro

function comercioCercano(lat, lng, clientes) {
  if (!clientes || !clientes.length) return null
  let mejor = null
  let mejorD = MATCH_RADIO_M
  for (const c of clientes) {
    if (c.lat == null || c.lng == null) continue
    const d = distanciaMetros({ lat, lng }, c)
    if (d < mejorD) { mejorD = d; mejor = c }
  }
  return mejor ? (mejor.name || mejor.nombre_comercio || null) : null
}

export function calcularDwells(byUser, pasaFiltro, clientes) {
  return Object.entries(byUser)
    .filter(([, v]) => pasaFiltro(v.rol))
    .flatMap(([id, v]) => detectarParadas(v.points || [])
      .map((p) => {
        const comercio = comercioCercano(p.lat, p.lng, clientes)
        return {
          lat: p.lat,
          lng: p.lng,
          label: etiquetaDwell(p),
          sub: comercio || horarioDwell(p),
          color: colorPorId(id),
        }
      }))
}
