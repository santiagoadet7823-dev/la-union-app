/**
 * Contexto para los números del dashboard del dueño.
 *
 * POR QUÉ EXISTE: "47 km" no es bueno ni malo. El dueño no abre la app para leer un dato, la abre
 * para saber si algo va bien o mal, y eso solo se sabe contra una referencia. Este módulo produce
 * esa referencia.
 *
 * SE COMPARA CONTRA EL MISMO DÍA DE LA SEMANA, no contra ayer: un lunes no se parece a un sábado,
 * y "bajó 60 % respecto de ayer" un domingo es ruido, no información.
 *
 * 🩸 LA REGLA QUE MÁS IMPORTA ES LA DE NO MOSTRAR NADA. Al 28/07/2026 la base tiene 8 días de
 * historia: para cualquier día de semana hay UN comparable, no cuatro. El prototipo del diseñador
 * muestra "+12 %" en todas las pantallas, pero su propio texto dice que con menos de 3 comparables
 * el porcentaje no se muestra. O sea: el estado real de esta pantalla el día 1 es el que el
 * prototipo no dibuja. Está implementado acá como camino principal, no como excepción.
 */

/** Mínimo de días comparables para animarse a mostrar un porcentaje. */
export const MIN_BASE = 3

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/**
 * 'YYYY-MM-DD' → Date LOCAL. `new Date('2026-07-27')` lo interpreta como UTC y en Salta (UTC−3)
 * devuelve el 26 a las 21:00 — el mismo error de zona que documenta `hoyStr()`.
 */
export function aFecha(dia) {
  const [a, m, d] = String(dia).split('-').map(Number)
  return new Date(a, m - 1, d)
}

/** Date → 'YYYY-MM-DD' local. */
export function aDia(fecha) {
  return fecha.getFullYear() + '-' +
    String(fecha.getMonth() + 1).padStart(2, '0') + '-' +
    String(fecha.getDate()).padStart(2, '0')
}

/** Corre `n` días (puede ser negativo) sin cruzar por UTC. */
export function sumarDias(dia, n) {
  const f = aFecha(dia)
  f.setDate(f.getDate() + n)
  return aDia(f)
}

/** 'viernes' — para el pie "base: 2 viernes". */
export function nombreDiaSemana(dia) {
  return DIAS_SEMANA[aFecha(dia).getDay()]
}

/** Plural del pie: 1 → 'base: 1 viernes', 2 → 'base: 2 viernes' (invariable en español). */
export function textoBase(dia, n) {
  return `base: ${n} ${nombreDiaSemana(dia)}${n === 1 ? '' : 's'}`
}

/**
 * Los días con los que se compara `dia`: el mismo día de la semana de las `semanas` semanas
 * anteriores, del más reciente al más viejo.
 */
export function diasComparables(dia, semanas = 4) {
  const out = []
  for (let i = 1; i <= semanas; i++) out.push(sumarDias(dia, -7 * i))
  return out
}

/**
 * Compara el valor de `dia` contra el promedio de los mismos días de semana anteriores.
 *
 * @param {Record<string, number>} serie  { 'YYYY-MM-DD': valor } — solo días CON dato. Un día que
 *   no está en la serie es un día sin registro y NO cuenta como comparable: promediarlo como 0
 *   diría "bajó 100 %" cuando la verdad es "no sabemos".
 * @param {string} dia
 * @returns {{valor:number, base:number, pct:number|null, texto:string, tono:'success'|'danger'|'faint'}}
 */
/**
 * ⚠️ LIMITACIÓN CONOCIDA, a resolver cuando haya historia suficiente para que esto se vea: el día
 * en curso se compara contra días COMPLETOS. A las 14:00 un viernes lleva medio día de kilómetros
 * y los viernes anteriores llevan el día entero, así que el porcentaje va a dar sistemáticamente
 * negativo. Hoy no se nota porque con 8 días de base el porcentaje ni siquiera se muestra (ver
 * MIN_BASE), y el default de horizonte antes de las 11 es "semana" justamente por esto. El arreglo
 * real es recortar los días previos a la misma hora del día, y eso necesita que la RPC devuelva el
 * acumulado por hora, no por día. No inventar un factor de proyección: mentiría con más decimales.
 */
export function compararDia(serie, dia, { semanas = 4 } = {}) {
  const valor = Number(serie[dia]) || 0
  const previos = diasComparables(dia, semanas)
    .map((d) => serie[d])
    .filter((v) => Number.isFinite(v))

  return armar(valor, previos, textoBase(dia, previos.length))
}

/**
 * Compara un RANGO (semana / mes) contra los rangos equivalentes inmediatamente anteriores, del
 * mismo largo. Para una ventana de 7 días, el comparable es la semana previa; para 30, el mes previo.
 *
 * A diferencia de `compararDia`, acá un día sin dato SÍ suma 0: una semana en la que alguien no
 * salió el martes es una semana con menos kilómetros, no una semana desconocida. Lo que se exige es
 * que el período previo tenga al menos un día con registro, si no no es un período, es un hueco.
 */
export function compararRango(serie, desde, hasta, { periodos = 4 } = {}) {
  const largo = Math.round((aFecha(hasta) - aFecha(desde)) / 86400000) + 1
  const sumar = (ini) => {
    let total = 0
    let conDato = 0
    for (let i = 0; i < largo; i++) {
      const v = serie[sumarDias(ini, i)]
      if (Number.isFinite(v)) { total += v; conDato++ }
    }
    return conDato ? total : null
  }

  const valor = sumar(desde) || 0
  const previos = []
  for (let i = 1; i <= periodos; i++) {
    const v = sumar(sumarDias(desde, -largo * i))
    if (v != null) previos.push(v)
  }

  const unidad = largo > 7 ? 'período' : 'semana'
  return armar(valor, previos, `base: ${previos.length} ${unidad}${previos.length === 1 ? '' : 's'}`)
}

/**
 * El corazón de la honestidad de la pantalla: con pocos comparables devuelve `pct: null` y un texto
 * que lo dice, en vez de un porcentaje que suena preciso y no lo es. La UI usa `pct == null` para
 * decidir si pinta el delta en verde/rojo o si escribe la frase en gris.
 */
function armar(valor, previos, base) {
  if (previos.length < MIN_BASE) {
    return {
      valor,
      base: previos.length,
      pct: null,
      texto: previos.length === 0 ? 'primer registro' : 'todavía sin base para comparar',
      tono: 'faint',
    }
  }

  const promedio = previos.reduce((a, b) => a + b, 0) / previos.length
  if (!promedio) {
    return { valor, base: previos.length, pct: null, texto: base, tono: 'faint' }
  }

  const pct = Math.round(((valor - promedio) / promedio) * 100)
  return {
    valor,
    base: previos.length,
    pct,
    // El 0 % no lleva signo ni color: "igual que lo normal" es la lectura correcta y no merece
    // ni verde ni rojo. Es el caso que más se va a dar cuando haya historia de verdad.
    texto: pct === 0 ? 'igual que lo normal' : `${pct > 0 ? '+' : ''}${pct} %`,
    tono: pct === 0 ? 'faint' : pct > 0 ? 'success' : 'danger',
  }
}

/**
 * Serie de los últimos `n` días terminando en `hasta`, lista para la sparkline: alturas relativas
 * al máximo, con marca de cuál es el día que se está mirando.
 *
 * Los días sin dato van con `sinDato: true` y altura mínima visible: una barra de altura 0 se lee
 * como "cero kilómetros" y en realidad es "no hubo registro". El componente los pinta distinto.
 */
export function serieParaBarras(serie, hasta, n = 8) {
  const dias = []
  for (let i = n - 1; i >= 0; i--) dias.push(sumarDias(hasta, -i))
  const valores = dias.map((d) => serie[d])
  const max = Math.max(...valores.filter(Number.isFinite), 0)

  return dias.map((d, i) => {
    const v = valores[i]
    const sinDato = !Number.isFinite(v)
    return {
      dia: d,
      valor: sinDato ? null : v,
      sinDato,
      // 6 % de piso para que una barra chica siga siendo visible y no parezca ausente.
      alturaPct: sinDato || !max ? 0 : Math.max(6, Math.round((v / max) * 100)),
      esUltimo: i === n - 1,
    }
  })
}
