/** '$ 102.000' — versión compacta usada en las vistas */
export function fmtPesos(n) {
  return '$ ' + (n || 0).toLocaleString('es-AR')
}

/** '9,5' kg (solo el número, con un decimal) */
export function kgFmt(n) {
  return (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** '45 s' | '5 min' | '1 h 20 min' — duración humana (p.ej. paradas del recorrido) */
export function fmtDuracion(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const seg = Math.floor(ms / 1000)
  if (seg < 60) return seg + ' s'
  const min = Math.floor(seg / 60)
  if (min < 60) return min + ' min'
  const h = Math.floor(min / 60)
  const resto = min % 60
  return resto ? h + ' h ' + resto + ' min' : h + ' h'
}

/** hh:mm actual */
export function horaActual() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
