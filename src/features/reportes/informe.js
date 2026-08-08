/**
 * Motor del INFORME DE JORNADA: de los recorridos del día a los números que se leen, se imprimen
 * y se exportan. Uno por persona, más el consolidado del equipo.
 *
 * 🩸 NO REIMPLEMENTA NADA. Cada número sale de la función que ya lo calcula para el mapa, y eso es
 * el punto entero del módulo: si el reporte tuviera su propio haversine o su propio detector de
 * paradas, tendría los mismos km "casi" iguales a los del mapa, y ese "casi" es exactamente lo que
 * convierte un reporte en una discusión. Km → `construirTrails`. Paradas → `detectarParadas`.
 * Comercio → `comercioCercano`. Limpieza → `limpiarTrazo`, vía `limpiarPorUsuario` (regla 22-bis).
 *
 * ⚠️ ENTRADA: `byUser` YA LIMPIO (lo que devuelve `limpiarPorUsuario`), nunca el crudo. Es el mismo
 * objeto que reciben `calcularDwells` y `construirTrails` en las supervisiones, y por eso la
 * numeración de paradas del reporte coincide exactamente con la de los carteles del mapa: las dos
 * salen de `detectarParadas` sobre los mismos puntos, en el mismo orden.
 */
import { detectarParadas } from '../../services/geolocation/dwell'
import { comercioCercano } from '../supervision/dwells'
import { construirTrails } from '../supervision/trazos'
import { colorPorId } from '../../lib/colors'
import { HUECO_MS } from '../../lib/geo'
import { inicioProgramado } from '../../services/tracking'

/** Batería crítica: por debajo de esto el teléfono es un riesgo de perder la tarde. */
export const BATERIA_BAJA = 20
/** Un hueco de señal más largo que esto entra al bloque "Atención" del consolidado. */
export const SIN_SENAL_ALERTA_MS = 30 * 60000
/** Arranque tardío: a partir de acá se reporta. 15 min es el umbral con el que se midió el problema. */
export const RETRASO_ALERTA_MIN = 15

const ms = (t) => (t == null ? NaN : new Date(t).getTime())

/**
 * Serie de batería del día: un punto por cada lectura con dato.
 *
 * `!= null` y no un chequeo por falsy: la batería puede ser 0 y un `if (p.bateria)` la borraría
 * justo en el caso que más importa (mismo gotcha que documenta `etiquetaDwell`).
 *
 * Se DECIMA a un punto por minuto porque la curva se dibuja en ~280 px: con 900 puntos por persona
 * no se ve nada distinto y el SVG pesa diez veces más. Se conserva el ÚLTIMO valor de cada minuto,
 * no el primero, para que el final de la serie sea el estado más reciente y no uno de hace 59 s.
 */
function serieBateria(points) {
  const porMinuto = new Map()
  for (const p of points || []) {
    if (p.bateria == null) continue
    const t = ms(p.ts)
    if (!Number.isFinite(t)) continue
    porMinuto.set(Math.floor(t / 60000), { ts: t, nivel: p.bateria })
  }
  return [...porMinuto.values()].sort((a, b) => a.ts - b.ts)
}

/**
 * Huecos de señal: los espacios ENTRE segmentos limpios.
 *
 * Sale de `segmentos` y no de recorrer los puntos de nuevo porque `limpiarTrazo` ya decidió dónde
 * hubo un corte, con su umbral (`HUECO_MS`) y sus reglas — incluida la de "venía descartando de
 * más, no puedo afirmar continuidad". Recalcularlo acá sería una segunda opinión sobre lo mismo.
 */
function huecosDeSenal(segmentos) {
  const out = []
  for (let i = 1; i < (segmentos?.length || 0); i++) {
    const finAnterior = segmentos[i - 1][segmentos[i - 1].length - 1]
    const inicioActual = segmentos[i][0]
    const a = ms(finAnterior?.ts)
    const b = ms(inicioActual?.ts)
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue
    const dur = b - a
    // El corte también puede haber sido por DISTANCIA (HUECO_M) con poco tiempo de por medio: eso
    // no es "se quedó sin señal", así que no entra como hueco temporal.
    if (dur >= HUECO_MS) out.push({ desde: a, hasta: b, ms: dur })
  }
  return out
}

/**
 * Informe de una persona-día.
 *
 * `movimientoMs` es jornada − parado, y no una suma de tramos "en movimiento": no existe una
 * definición de tramo en movimiento que no sea el complemento de las paradas, y calcularla aparte
 * daría dos números que no cierran entre sí.
 */
function informeDePersona({ id, trail, limpio, clientes, nombres, roles, cfgHorario, fecha }) {
  const points = limpio.points || []
  const paradasCrudas = detectarParadas(points)
  const paradas = paradasCrudas.map((p, i) => ({
    // El MISMO número que el cartel del mapa: los dos son el índice de `detectarParadas` + 1 sobre
    // los mismos puntos limpios. Si alguna vez difieren, es que una de las dos dejó de usar `byUser`.
    orden: i + 1,
    desde: p.desde,
    hasta: p.hasta,
    duracionMs: p.duracionMs,
    lat: p.lat,
    lng: p.lng,
    bateria: p.bateria ?? null,
    comercio: comercioCercano(p.lat, p.lng, clientes),
  }))

  const inicioTs = ms(points[0]?.ts)
  const finTs = ms(points[points.length - 1]?.ts)
  const jornadaMs = Number.isFinite(inicioTs) && Number.isFinite(finTs) ? finTs - inicioTs : 0
  const paradasMs = paradas.reduce((a, p) => a + p.duracionMs, 0)
  const duraciones = paradas.map((p) => p.duracionMs)

  const bateria = serieBateria(points)
  const niveles = bateria.map((b) => b.nivel)
  const huecos = huecosDeSenal(limpio.segmentos)

  // Arranque programado vs. real. `inicioProgramado` vive en services/tracking.js a propósito
  // (regla 36): la ventana de rastreo ya está escrita tres veces y no hace falta una cuarta.
  const progMin = cfgHorario ? inicioProgramado(cfgHorario, new Date(fecha + 'T12:00:00')) : null
  const realMin = Number.isFinite(inicioTs)
    ? new Date(inicioTs).getHours() * 60 + new Date(inicioTs).getMinutes()
    : null
  const retrasoMin = progMin != null && realMin != null ? realMin - progMin : null

  return {
    id,
    nombre: nombres?.[id] || null,
    rol: roles?.[id] || limpio.rol || null,
    color: colorPorId(id),
    inicioTs: Number.isFinite(inicioTs) ? inicioTs : null,
    // ⚠️ `finTs` es el ÚLTIMO PUNTO RECIBIDO, no un cierre de jornada declarado: esta app no tiene
    // botón de finalizar. Un teléfono sin batería a las 14:10 pone acá las 14:10. La pantalla lo
    // rotula "último punto" y el retraso/adelanto contra la ventana lo dice `horario`.
    finTs: Number.isFinite(finTs) ? finTs : null,
    jornadaMs,
    // Km del trail, que es el mismo `construirTrails` que dibuja el mapa. Sin trail (menos de 2
    // puntos) es 0 y no un `null`: la persona existe en el informe, simplemente no se movió.
    km: trail?.km || 0,
    paradas,
    paradasN: paradas.length,
    paradasMs,
    avgMs: paradas.length ? paradasMs / paradas.length : 0,
    minMs: paradas.length ? Math.min(...duraciones) : 0,
    maxMs: paradas.length ? Math.max(...duraciones) : 0,
    // Complemento de las paradas. Nunca negativo: con jornadas cortas y paradas solapando el borde
    // el resto puede dar −40 s, y un "−1 min en movimiento" es peor que un 0.
    movimientoMs: Math.max(0, jornadaMs - paradasMs),
    bateria: {
      serie: bateria,
      inicio: niveles.length ? niveles[0] : null,
      fin: niveles.length ? niveles[niveles.length - 1] : null,
      min: niveles.length ? Math.min(...niveles) : null,
    },
    calidad: {
      puntos: points.length,
      descartados: limpio.descartados || 0,
      // Los triangulados son puntos, no tramos: se cuentan los puntos de los tramos aproximados
      // menos los dos extremos de GPS con los que `limpiarTrazo` los cose.
      triangulados: (limpio.aproximados || []).reduce((a, t) => a + Math.max(0, t.length - 2), 0),
      huecos,
      sinSenalMs: huecos.reduce((a, h) => a + h.ms, 0),
    },
    horario: progMin == null ? null : { programadoMin: progMin, realMin, retrasoMin },
  }
}

/**
 * El informe completo del día.
 *
 * @param {object}   byUser    recorridos YA LIMPIOS (limpiarPorUsuario). NO el crudo.
 * @param {function} pasaFiltro filtro por chip de rol, igual que en las supervisiones
 * @param {Array}    clientes  cartera geolocalizada, para nombrar las paradas (opcional)
 * @param {object}   nombres   id → nombre (useEquipoEnVivo)
 * @param {object}   roles     id → rol, cuando `byUser` no lo trae
 * @param {object}   horarios  id → cfg de getTrackConfig (opcional; sin él no hay retraso)
 * @param {string}   fecha     'YYYY-MM-DD' del día informado
 * @param {number}   plantel   cuánta gente rastreable hay, para decir "5 de 9 salieron"
 */
export function construirInforme({ byUser, pasaFiltro = () => true, clientes, nombres, roles, horarios, fecha, plantel = 0 }) {
  const trails = construirTrails(byUser || {}, pasaFiltro)
  const porTrail = new Map(trails.map((t) => [t.id, t]))

  const porUsuario = Object.entries(byUser || {})
    .filter(([, v]) => pasaFiltro(v.rol))
    // Se incluye a quien tenga AL MENOS UN punto, aunque no llegue a los dos que pide un trazo:
    // "salió y mandó tres puntos" es un dato del informe, y filtrarlo lo haría desaparecer de la
    // lista igualándolo con quien no reportó nunca. Son dos problemas distintos.
    .filter(([, v]) => (v.points?.length || 0) >= 1)
    .map(([id, limpio]) => informeDePersona({
      id,
      trail: porTrail.get(id),
      limpio,
      clientes,
      nombres,
      roles,
      cfgHorario: horarios?.[id] || null,
      fecha,
    }))
    .sort((a, b) => b.km - a.km)

  const global = {
    km: porUsuario.reduce((a, u) => a + u.km, 0),
    personas: porUsuario.length,
    plantel,
    paradasN: porUsuario.reduce((a, u) => a + u.paradasN, 0),
    jornadaMs: porUsuario.reduce((a, u) => a + u.jornadaMs, 0),
    movimientoMs: porUsuario.reduce((a, u) => a + u.movimientoMs, 0),
    paradasMs: porUsuario.reduce((a, u) => a + u.paradasMs, 0),
    descartados: porUsuario.reduce((a, u) => a + u.calidad.descartados, 0),
    triangulados: porUsuario.reduce((a, u) => a + u.calidad.triangulados, 0),
    sinSenalMs: porUsuario.reduce((a, u) => a + u.calidad.sinSenalMs, 0),
  }

  return { fecha, porUsuario, global, atencion: construirAtencion(porUsuario) }
}

/**
 * Lo accionable, separado de lo informativo.
 *
 * Un informe que es solo una tabla obliga a leer nueve filas para encontrar el problema. Esto es lo
 * que hay que mirar hoy, y nada más — por eso los umbrales son constantes exportadas y no números
 * escondidos: el día que alguien discuta si 20 % de batería es poco, se discute un solo lugar.
 */
export function construirAtencion(porUsuario) {
  const out = []
  for (const u of porUsuario) {
    const quien = u.nombre || u.rol || u.id
    if (u.horario && u.horario.retrasoMin != null && u.horario.retrasoMin >= RETRASO_ALERTA_MIN) {
      out.push({ id: u.id, quien, tipo: 'tarde', detalle: `Arrancó ${u.horario.retrasoMin} min tarde` })
    }
    if (u.bateria.min != null && u.bateria.min <= BATERIA_BAJA) {
      out.push({ id: u.id, quien, tipo: 'bateria', detalle: `Bajó a ${u.bateria.min} % de batería` })
    }
    if (u.calidad.sinSenalMs >= SIN_SENAL_ALERTA_MS) {
      out.push({ id: u.id, quien, tipo: 'senal', detalle: `${Math.round(u.calidad.sinSenalMs / 60000)} min sin reportar` })
    }
    // Km en cero con jornada larga: el teléfono habló todo el día desde el mismo lugar. No es lo
    // mismo que "no reportó" (ese ni siquiera aparece en la lista) y por eso tiene su propio aviso.
    if (u.km < 0.2 && u.jornadaMs > 60 * 60000) {
      out.push({ id: u.id, quien, tipo: 'quieto', detalle: 'Sin desplazamiento en toda la jornada' })
    }
  }
  return out
}

/** Quién NO reportó un solo punto: está en el plantel y no aparece en el informe. */
export function sinReportar(porUsuario, plantelIds = [], nombres = {}) {
  const conDatos = new Set(porUsuario.map((u) => u.id))
  return plantelIds.filter((id) => !conDatos.has(id)).map((id) => ({ id, quien: nombres[id] || id }))
}
