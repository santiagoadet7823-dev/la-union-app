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
 * `extra` (30/07/2026) es el dato que PIERDE esa elección. Cuando hay comercio, el horario no se
 * tira: viaja acá y el cartel lo muestra cuando se lo amplía tocándolo. Cerrado sigue siendo de
 * dos renglones, que es lo que lo mantiene angosto sobre el mapa.
 *
 * @param {Record<string,{rol?:string, points?:Array}>} byUser
 * @param {(rol?:string) => boolean} pasaFiltro filtro por chip (Vend./Rep.) de cada vista
 * @param {Array<{lat:number,lng:number,name?:string,nombre_comercio?:string}>} [clientes] cartera geolocalizada
 * @returns {Array<{lat:number,lng:number,label:string,sub:string,color:string}>}
 */
const MATCH_RADIO_M = 60 // un poco más que el radio de parada (40 m) para tolerar el jitter del centro

/**
 * Grilla de la cartera geolocalizada, cacheada por IDENTIDAD del array de clientes.
 *
 * `comercioCercano` recorría la cartera ENTERA por cada parada: con 605 paradas en la semana y
 * 1.803 clientes vigentes son más de un millón de haversines por recálculo, y crece con las dos
 * cosas a la vez (más clientes ubicados × más paradas). La celda es de 0,001° ≈ 111 m, o sea más
 * grande que MATCH_RADIO_M, así que mirar el vecindario de 3×3 alcanza para cubrir el radio entero.
 *
 * El cache es un `WeakMap` sobre el array: cuando el llamador arma una lista nueva, la grilla vieja
 * se recolecta sola. Sin él, `calcularDwells` reconstruiría la grilla en cada recálculo y estaríamos
 * cambiando un problema por otro.
 */
const CELDA = 0.001
const _grillas = new WeakMap()
const clave = (lat, lng) => Math.floor(lat / CELDA) + ':' + Math.floor(lng / CELDA)

function grillaDe(clientes) {
  let g = _grillas.get(clientes)
  if (g) return g
  g = new Map()
  for (const c of clientes) {
    if (c.lat == null || c.lng == null) continue
    const k = clave(c.lat, c.lng)
    const celda = g.get(k)
    if (celda) celda.push(c); else g.set(k, [c])
  }
  _grillas.set(clientes, g)
  return g
}

/**
 * Nombre del comercio geolocalizado más cercano a menos de MATCH_RADIO_M, o null.
 *
 * Exportada desde el 30/07/2026: la lista de paradas del dueño (`SheetPersona`) mostraba las
 * coordenadas crudas teniendo esto acá al lado. Un dueño no puede hacer nada con "-24.7891".
 */
export function comercioCercano(lat, lng, clientes) {
  if (!clientes || !clientes.length) return null
  const g = grillaDe(clientes)
  const ci = Math.floor(lat / CELDA)
  const cj = Math.floor(lng / CELDA)
  let mejor = null
  let mejorD = MATCH_RADIO_M
  for (let i = ci - 1; i <= ci + 1; i++) {
    for (let j = cj - 1; j <= cj + 1; j++) {
      const celda = g.get(i + ':' + j)
      if (!celda) continue
      for (const c of celda) {
        const d = distanciaMetros({ lat, lng }, c)
        if (d < mejorD) { mejorD = d; mejor = c }
      }
    }
  }
  return mejor ? (mejor.name || mejor.nombre_comercio || null) : null
}

/**
 * 🩸 EL CACHE DE PARADAS NO VIVE ACÁ — está adentro de `detectarParadas` (`dwell.js`).
 *
 * Estuvo acá durante 1.13.4 y fue un error de diseño: cubría solo a este llamador, mientras
 * `MetricasEquipo` seguía invocando el detector por su cuenta en cada recálculo (medido: 552 ms
 * extra por vuelta sobre la jornada del 11/08). Puesto en el módulo lo aprovechan los cuatro
 * llamadores y ninguno tiene que acordarse. Tener el mismo criterio en dos lugares es cómo divergen
 * (regla 31); acá directamente sobraba.
 *
 * Lo que sigue siendo cierto y es lo que hace que el cache sirva: `calcularDwells` se memoiza en las
 * vistas con `[byUser, filter, clientes]`, así que tocar el chip Vend./Rep. vuelve a entrar acá con
 * los MISMOS arrays de puntos — y en el refresco de 60 s, `useRecorridosDelDia` solo reemplaza el
 * array de quien recibió puntos nuevos, así que los demás salen gratis.
 */
export function calcularDwells(byUser, pasaFiltro, clientes) {
  return Object.entries(byUser)
    .filter(([, v]) => pasaFiltro(v.rol))
    .flatMap(([id, v]) => detectarParadas(v.points || [])
      .map((p, i) => {
        const comercio = comercioCercano(p.lat, p.lng, clientes)
        const horario = horarioDwell(p)
        return {
          lat: p.lat,
          lng: p.lng,
          label: etiquetaDwell(p),
          sub: comercio || horario,
          extra: comercio ? horario : null,
          color: colorPorId(id),
          // 08/08/2026 — el ORDEN dentro de la jornada de esta persona. `detectarParadas` ya
          // devuelve cronológico, así que es el índice + 1 y no cuesta un cálculo.
          //
          // Numeración POR PERSONA y no global del día: con varios en el mapa los números se
          // repiten, pero el color ya desambigua (igual que con los trazos), y una numeración
          // global sería ilegible justo en el caso que importa — seguir el recorrido de UNO. Es
          // también la que coincide con la tabla de paradas del reporte.
          orden: i + 1,
          // El `id` ya se tenía y se tiraba (solo sobrevivía disuelto en `colorPorId`). Hace falta
          // para atenuar los carteles ajenos cuando hay alguien enfocado, y eso se decide al
          // DIBUJAR: meter el foco acá obligaría a recalcular `detectarParadas` en cada toque.
          id,
        }
      }))
}
