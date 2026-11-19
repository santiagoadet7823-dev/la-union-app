/**
 * Convierte un string CSS ("display:flex;gap:8px") en un objeto de estilo React.
 * Permite portar los mockups del diseñador (inline styles + CSS variables) con
 * fidelidad 1:1, sin reescribir cada declaración a mano.
 *
 * 🩸 CON CACHÉ (19/11/2026, plan 50). Cada fila de Pedidos llama a `sx` ~12 veces; con 30 días
 * (4 519 pedidos) eran ≈ 54 000 `split` + regex por dibujo, repetidos con cada letra del buscador.
 * Ahora el texto se parsea una sola vez. Se devuelve una COPIA del objeto guardado: hay llamadores
 * que lo guardan en una constante o lo esparcen, y ninguno debe poder ensuciar la caché de otro.
 * Tope de entradas porque hay estilos armados con valores interpolados (anchos, colores).
 */
const cache = new Map()
const TOPE = 3000

function parsear(css) {
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

export function sx(css) {
  let s = cache.get(css)
  if (!s) {
    s = parsear(css)
    if (cache.size >= TOPE) cache.clear()
    cache.set(css, s)
  }
  return { ...s }
}
