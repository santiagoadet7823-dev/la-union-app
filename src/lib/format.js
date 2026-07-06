const currencyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
})

/** '$ 102.000' */
export function formatMonto(valor) {
  return currencyFormatter.format(valor || 0)
}

/** '$ 102.000' sin símbolo de moneda localizado — versión compacta usada en mocks */
export function fmtPesos(n) {
  return '$ ' + (n || 0).toLocaleString('es-AR')
}

/** '9,5 kg' */
export function formatKg(valor) {
  return `${(valor || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`
}

export function kgFmt(n) {
  return (n || 0).toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

/** hh:mm en horario local a partir de un ISO */
export function formatHora(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

/** mm:ss o hh:mm:ss para un total de segundos */
export function formatDuracion(segundosTotales) {
  const s = Math.max(0, Math.floor(segundosTotales))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${pad(hh)}:${pad(mm)}:${pad(ss)}` : `${pad(mm)}:${pad(ss)}`
}

/** hh:mm actual */
export function horaActual() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
