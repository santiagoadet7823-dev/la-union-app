/**
 * "Liquid glass" — elemento del handoff del diseñador (ios-frame.jsx). No usamos
 * el marco iOS (la app es Android nativa), pero sí este tratamiento esmerilado
 * para controles flotantes (barra de navegación mobile, píldoras flotantes).
 * Válido en Android (WebView Chromium soporta backdrop-filter).
 *
 * @param {boolean} isDark
 * @returns {object} estilo React para aplicar sobre un contenedor
 */
export function glassSurface(isDark) {
  return {
    background: isDark ? 'rgba(13,31,30,0.62)' : 'rgba(255,255,255,0.62)',
    backdropFilter: 'blur(14px) saturate(160%)',
    WebkitBackdropFilter: 'blur(14px) saturate(160%)',
    border: isDark ? '0.5px solid rgba(255,255,255,0.14)' : '0.5px solid rgba(11,43,42,0.06)',
    boxShadow: isDark ? '0 -2px 16px rgba(0,0,0,0.35)' : '0 -2px 16px rgba(11,43,42,0.08)',
  }
}
