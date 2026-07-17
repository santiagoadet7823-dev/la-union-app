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

/** 'hh:mm' local del instante dado (ms epoch, Date o ISO) */
export function fmtHora(ts) {
  const d = new Date(ts)
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/** hh:mm actual */
export function horaActual() {
  return fmtHora(Date.now())
}

/**
 * Día local ('YYYY-MM-DD') del instante dado — por defecto, HOY.
 *
 * NUNCA usar `new Date().toISOString().slice(0, 10)` para esto, que es lo que hacían las 8
 * copias que esta función reemplaza: `toISOString()` devuelve UTC y Salta es UTC−3, así que
 * de 21:00 a 24:00 daba MAÑANA. Y convivía con ventanas de consulta armadas en hora local
 * (`new Date(fecha + 'T00:00:00')`), de modo que todas las noches, durante esas 3 horas,
 * Supervisión pedía un día que todavía no existía: el mapa quedaba vacío y los recorridos
 * de esa tarde parecían perdidos (no lo estaban — quedaban archivados en el día anterior).
 *
 * Usa la zona horaria del dispositivo, que es la misma con la que se arman las ventanas.
 */
export function hoyStr(d = new Date()) {
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
}
