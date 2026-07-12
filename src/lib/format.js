/** '$ 102.000' — versión compacta usada en las vistas */
export function fmtPesos(n) {
  return '$ ' + (n || 0).toLocaleString('es-AR')
}

/** '9,5' kg (solo el número, con un decimal) */
export function kgFmt(n) {
  return (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** hh:mm actual */
export function horaActual() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
