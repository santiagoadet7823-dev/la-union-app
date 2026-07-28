/**
 * El titular del dashboard del dueño: la frase grande de arriba.
 *
 * POR QUÉ UNA FRASE Y NO UN NÚMERO: el dueño abre la app en un semáforo. "7/9" lo obliga a
 * interpretar; "El equipo salió completo" ya viene interpretado. El número que la sostiene va al
 * lado, en el subtitular, para quien quiera el detalle.
 *
 * Es una función pura a propósito: toda la lógica de "qué decir" vive acá y se puede leer entera
 * sin abrir la vista. Si mañana el criterio cambia (p.ej. que un sábado con poca gente no se
 * reporte como problema), se cambia en un solo lugar.
 */
import { aFecha, nombreDiaSemana } from '../../lib/comparar'
import { fmtHora } from '../../lib/format'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const capitalizar = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Horizonte por defecto según la hora.
 *
 * Antes de las 11 "hoy" casi no tiene datos: un dueño que abre a las 8:30 vería 4 km y sacaría una
 * conclusión falsa sobre un día que recién empieza. Hasta esa hora el default es la semana, y el
 * titular lo aclara.
 */
export function horizonteInicial(ahora = new Date()) {
  return ahora.getHours() < 11 ? 'semana' : 'hoy'
}

/** Franja del día, para que el eyebrow diga a qué altura de la jornada se está mirando. */
function franja(h) {
  if (h < 6) return 'de madrugada'
  if (h < 11) return 'temprano'
  if (h < 14) return 'media mañana'
  if (h < 18) return 'media tarde'
  if (h < 21) return 'al cierre'
  return 'jornada terminada'
}

/** 'VIERNES 27 · MEDIA MAÑANA' | 'SEMANA DEL 21 AL 27' | 'JULIO · ÚLTIMOS 30 DÍAS' */
export function periodoTxt(horizonte, { desde, hasta, ahora = new Date() } = {}) {
  if (horizonte === 'hoy') {
    const f = aFecha(hasta)
    return `${capitalizar(nombreDiaSemana(hasta))} ${f.getDate()} · ${franja(ahora.getHours())}`
  }
  const a = aFecha(desde)
  const b = aFecha(hasta)
  if (horizonte === 'semana') {
    const mismoMes = a.getMonth() === b.getMonth()
    return mismoMes
      ? `Semana del ${a.getDate()} al ${b.getDate()} de ${MESES[b.getMonth()]}`
      : `Del ${a.getDate()} de ${MESES[a.getMonth()]} al ${b.getDate()} de ${MESES[b.getMonth()]}`
  }
  return `${capitalizar(MESES[b.getMonth()])} · últimos 30 días`
}

/**
 * @param {object} p
 * @param {'hoy'|'semana'|'mes'} p.horizonte
 * @param {number} p.enCalle      personas con un punto en los últimos 5 minutos
 * @param {number} p.conDatos     personas que reportaron algo en el período
 * @param {number} p.sinDatos     personas del plantel sin un solo punto
 * @param {string|null} p.unicoNombre  nombre de la única persona reportando, si es una sola
 * @param {number|null} p.ultimoCierreTs  ms del último punto del día (para "el último cerró a las…")
 * @param {{pct:number|null, texto:string}|null} p.km  comparación de kilómetros
 * @param {boolean} p.hayVentas   si el módulo de pedidos ya tiene datos (horizonte 2)
 * @param {{pct:number|null}|null} p.ventas
 * @returns {{titular:string, subtitular:string}}
 */
export function titular({
  horizonte = 'hoy',
  enCalle = 0,
  conDatos = 0,
  sinDatos = 0,
  unicoNombre = null,
  ultimoCierreTs = null,
  km = null,
  hayVentas = false,
  ventas = null,
} = {}) {
  const plantel = conDatos + sinDatos

  // Horizonte 2: cuando existan ventas, el titular pasa a hablar de plata. Es el único cambio de
  // jerarquía que trae el módulo de pedidos — la forma de la pantalla no se toca.
  if (hayVentas && ventas && ventas.pct != null) {
    const dir = ventas.pct >= 0 ? 'arriba' : 'abajo'
    const ref = horizonte === 'hoy' ? 'un día normal' : horizonte === 'semana' ? 'una semana normal' : 'lo habitual'
    return {
      titular: `${horizonte === 'hoy' ? 'Vas' : 'Van'} ${Math.abs(ventas.pct)} % ${dir} de ${ref}`,
      subtitular: resumenActividad({ enCalle, conDatos, plantel, km, horizonte }),
    }
  }

  // Nadie reportó nada en todo el período. No es un error ni un dato faltante: un domingo con la
  // app cerrada es el estado normal, y la pantalla no tiene por qué pedir disculpas.
  if (conDatos === 0) {
    return {
      titular: horizonte === 'hoy' ? 'Jornada cerrada' : 'Sin actividad en el período',
      subtitular: ultimoCierreTs
        ? `Nadie en la calle. El último cerró a las ${fmtHora(ultimoCierreTs)}. Así queda hasta mañana a la mañana.`
        : 'Nadie reportó ubicación. Si es un día no laborable, es lo esperable.',
    }
  }

  // Una sola persona reportando con un plantel de varios: no se afirma que los demás no trabajaron
  // —no se sabe—, se dice que sus teléfonos no reportan y se sugiere mirarlo.
  if (conDatos === 1 && plantel > 2) {
    return {
      titular: `Solo ${unicoNombre || 'una persona'} está reportando`,
      subtitular: `${sinDatos} de ${plantel} teléfonos sin señal. Puede ser normal según el día, pero conviene mirarlo.`,
    }
  }

  if (sinDatos === 0) {
    return {
      titular: horizonte === 'hoy' ? 'El equipo salió completo' : 'El equipo reportó todos los días',
      subtitular: resumenActividad({ enCalle, conDatos, plantel, km, horizonte }),
    }
  }

  return {
    titular: sinDatos === 1 ? 'Falta 1 por reportar' : `Faltan ${sinDatos} por reportar`,
    subtitular: resumenActividad({ enCalle, conDatos, plantel, km, horizonte }),
  }
}

/**
 * El subtitular mete la comparación en prosa. Si no hay base suficiente lo dice en vez de inventar
 * un porcentaje — la misma regla de `lib/comparar.js`, sostenida también en el texto.
 */
function resumenActividad({ enCalle, conDatos, plantel, km, horizonte }) {
  const partes = []
  if (horizonte === 'hoy') {
    partes.push(`${enCalle} de ${plantel} en la calle ahora`)
  } else {
    partes.push(`${conDatos} de ${plantel} con actividad`)
  }

  if (km) {
    if (km.pct == null) partes.push('todavía sin historia suficiente para comparar')
    else if (km.pct === 0) partes.push('mismos kilómetros que lo habitual')
    else partes.push(`${Math.abs(km.pct)} % ${km.pct > 0 ? 'más' : 'menos'} km que lo habitual`)
  }

  return partes.join(' · ')
}
