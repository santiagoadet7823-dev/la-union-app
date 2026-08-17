import { sx } from '../lib/sx'

/**
 * Primitivas de formulario compartidas.
 *
 * 19/07/2026 — `Field` y el estilo `inp` estaban COPIADOS en NuevoCliente,
 * NuevoProducto y MiPerfilModal (y una cuarta variante inline dentro de
 * ClientesTab). Cuatro copias del mismo input que ya habían empezado a divergir
 * en radio y padding.
 *
 * 🩸 El `outline: none` que traían las cuatro copias NO se reintrodujo: mataba el
 * foco por teclado sin poner nada en su lugar, y al ser estilo inline le ganaba
 * al `:focus-visible` global de index.css:124. Los inputs eran inalcanzables a
 * ciegas. Si hace falta cambiar el aro de foco, se cambia en `.lu-input`, nunca
 * volviendo a apagarlo acá.
 */

export function Field({ label, children }) {
  return (
    <div style={sx('margin-bottom:var(--sp-3)')}>
      <div style={sx('font-size:var(--fs-xs);font-weight:600;color:var(--muted);margin-bottom:6px')}>{label}</div>
      {children}
    </div>
  )
}

/**
 * Estilo base de input/select/textarea. Va SIEMPRE junto a className="lu-input",
 * que es quien aporta el foco visible y la transición del borde.
 */
export const inputStyle = sx(
  'width:100%;box-sizing:border-box;min-height:44px;padding:10px 11px;' +
  'border:1px solid var(--line2);border-radius:var(--r-md);' +
  'background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font-body)'
)
