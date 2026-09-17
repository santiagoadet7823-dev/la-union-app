/**
 * Formateadores cortos para ejes y leyendas. `fmtPesos` (`lib/format.js`) escribe "$ 16.002.286"
 * y en un eje de 40 px de ancho eso no entra: acá se abrevia a "$ 16,0 M". El número completo
 * sigue yendo en el tooltip y en las tarjetas; el eje sólo orienta.
 */
export function fmtCompacto(n) {
  const v = Number(n) || 0
  const abs = Math.abs(v)
  if (abs >= 1e6) return (v / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' M'
  if (abs >= 1e3) return (v / 1e3).toLocaleString('es-AR', { maximumFractionDigits: abs >= 1e5 ? 0 : 1 }) + ' k'
  return v.toLocaleString('es-AR', { maximumFractionDigits: 1 })
}

export function fmtPesosCompacto(n) {
  return '$ ' + fmtCompacto(n)
}

export function fmtKm(n) {
  return (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + ' km'
}

export function fmtEntero(n) {
  return (Number(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 })
}

/** '16/09' — etiqueta corta de un 'YYYY-MM-DD' para ejes y tooltips. */
export function fmtDiaCorto(dia) {
  const [, m, d] = String(dia).split('-')
  return `${d}/${m}`
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']
/** 'mar 16/09' */
export function fmtDiaLargo(dia) {
  const [a, m, d] = String(dia).split('-').map(Number)
  const f = new Date(a, m - 1, d)
  return `${DIAS[f.getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`
}

/** 0..1 → '37 %'. `null` cuando la base no alcanza (ver MIN_BASE de comparar.js). */
export function fmtPct(fraccion) {
  if (fraccion == null || !Number.isFinite(fraccion)) return '—'
  return Math.round(fraccion * 100) + ' %'
}
