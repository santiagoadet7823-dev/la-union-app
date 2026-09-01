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
 * Props para CUALQUIER input de búsqueda. Se esparce sobre el `<input>`: `{...propsBusqueda}`.
 *
 * 🩸 POR QUÉ ES COMPARTIDO Y NO UN PARCHE POR PANTALLA. Hay cinco buscadores en la app y el gesto
 * es el mismo en los cinco: en el celular, escribir deja el teclado abierto tapando media pantalla
 * —justo los resultados que uno acaba de pedir— y no hay forma obvia de cerrarlo, porque el input
 * filtra mientras se escribe y nunca hay un "buscar" que apretar. El vendedor terminaba tocando
 * cualquier lado para que el teclado se fuera.
 *
 * Hace tres cosas, y las tres son del navegador, sin librerías:
 *   · `enterKeyHint="search"` → la tecla de acción del teclado dice **Buscar** en vez de Enter.
 *   · `inputMode="search"` → teclado de búsqueda.
 *   · al presionarla, `blur()` → se cierra el teclado. El `preventDefault` evita que, si el input
 *     llegara a estar dentro de un `<form>`, Enter recargue la página.
 *
 * NO se limpia ni se dispara nada más: la búsqueda ya ocurrió mientras se escribía. Lo único que
 * falta es devolverle la pantalla a la persona.
 */
export const propsBusqueda = {
  type: 'search',
  inputMode: 'search',
  enterKeyHint: 'search',
  onKeyDown: (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur() }
  },
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
