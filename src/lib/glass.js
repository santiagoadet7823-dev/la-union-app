/**
 * "Liquid glass" — elemento del handoff del diseñador (ios-frame.jsx). No usamos
 * el marco iOS (la app es Android nativa), pero sí este tratamiento esmerilado
 * para controles flotantes (barra de navegación mobile, píldoras flotantes).
 * En WebViews viejos SIN backdrop-filter, el desenfoque se ignora: index.css tiene un
 * `@supports not (backdrop-filter)` que vuelve sólidos los tokens --glass-* como fallback.
 *
 * 19/07/2026: antes esto hardcodeaba rgba literales que duplicaban EXACTAMENTE
 * los tokens --glass-bg / --glass-brd de index.css, con el agravante de que
 * necesitaba recibir `isDark` para elegir cuál. Al leer los tokens el tema lo
 * resuelve el CSS solo, así que el parámetro ya no hace falta.
 */

/**
 * Solo el desenfoque. Es la parte que GestionHost.jsx y SupervisionMovil.jsx
 * redefinían por su cuenta: aplican el fondo con `background: var(--glass-bg)`
 * aparte, así que no pueden usar glassSurface() entero.
 */
export const glassBlur = {
  backdropFilter: 'blur(14px) saturate(160%)',
  WebkitBackdropFilter: 'blur(14px) saturate(160%)',
}

/**
 * Superficie de vidrio completa (fondo + desenfoque + borde + sombra).
 *
 * @returns {object} estilo React para aplicar sobre un contenedor
 */
export function glassSurface() {
  return {
    background: 'var(--glass-bg)',
    ...glassBlur,
    border: '0.5px solid var(--glass-brd)',
    boxShadow: 'var(--glass-shadow)',
  }
}
