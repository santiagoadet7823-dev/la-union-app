/**
 * Convierte un string CSS ("display:flex;gap:8px") en un objeto de estilo React.
 * Permite portar los mockups del diseñador (inline styles + CSS variables) con
 * fidelidad 1:1, sin reescribir cada declaración a mano.
 */
export function sx(css) {
  const style = {}
  for (const rule of css.split(';')) {
    const i = rule.indexOf(':')
    if (i === -1) continue
    const prop = rule.slice(0, i).trim()
    const val = rule.slice(i + 1).trim()
    if (!prop) continue
    const jsProp = prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    style[jsProp] = val
  }
  return style
}
