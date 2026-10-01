import { sx } from '../../lib/sx'
import { Check } from '../icons'
import { pintarIcono } from './icono'

/**
 * CHIP DE FILTRO (01/10/2026). Fuente única del brief v2 §2.7 y de la hoja "Cuenta y Navegación"
 * (5a/5b) y "Marketing" (8a): "Todos · Vendedores · Repartidores", "Todas las marcas · Almacén…".
 *
 * Reemplaza a las copias que hay hoy (`Chip` de SupervisionDesktop y de EstadoCatalogo, los chips
 * de categoría de GrillaCatalogo y de la vidriera); esas pantallas se migran en otro bloque.
 *
 * Por qué así:
 * - El ELEGIDO lleva ✓ además del tinte: el estado no puede depender solo del color (criterio C2;
 *   con el acento azul acero, tinte contra superficie casi no se distingue al sol).
 * - El <button> mide 44 px de alto (2,75 rem) aunque la píldora visible mida 36: la píldora es
 *   el hijo `.lu-chip-cara`. Se eligió esto y no el `::after` del brief porque así el área táctil
 *   ES la caja del botón: se mide con getBoundingClientRect, y una fila de chips con `gap` de 8
 *   no superpone áreas. El foco y el "presionado" se dibujan sobre la cara (ui.css).
 * - `min-height`, nunca `height`: con letra grande la píldora crece en vez de recortar el texto.
 *
 * Props:
 *   - children       el rótulo
 *   - seleccionado   bool: tinte de acento + borde + ✓ (y `aria-pressed`)
 *   - onClick
 *   - contador       número opcional a la derecha, en mono (p. ej. cuántos hay en esa categoría)
 *   - icono          opcional, a la izquierda (componente de icons.jsx o elemento); con
 *                    `seleccionado` lo reemplaza el ✓
 *   - deshabilitado
 *   - title, style   (style va al <button>, para márgenes o `flex:none` en una fila con scroll)
 *
 * Fila de chips: `<div className="lu-chips" style={{ display:'flex', gap:8, overflowX:'auto',
 * flex:'none' }}>`. ⚠️ El `flex:none` de la FILA no es decorativo: dentro de una columna flex, un
 * contenedor con `overflow` tiene alto mínimo 0 y, si la pantalla se llena (letra grande), la
 * columna lo aplasta hasta hacerlo desaparecer. Pasó en la galería con la letra al 200 %.
 */
export default function Chip({ children, seleccionado = false, onClick, contador, icono, deshabilitado = false, title, style }) {
  const on = !!seleccionado
  return (
    <button
      type="button"
      className="lu-chip"
      aria-pressed={on}
      disabled={deshabilitado}
      onClick={onClick}
      title={title}
      style={{ ...sx('flex:none;display:inline-flex;align-items:center;min-height:2.75rem;min-width:2.75rem;padding:0;margin:0;border:0;background:transparent;cursor:pointer;font-family:inherit;-webkit-tap-highlight-color:transparent'), ...style }}
    >
      <span
        className="lu-chip-cara"
        style={{
          ...sx('display:inline-flex;align-items:center;justify-content:center;gap:var(--sp-1);width:100%;min-height:2.25rem;padding:0 var(--sp-3);border-radius:var(--r-pill);border-width:1px;border-style:solid;font-size:var(--fs-sm);line-height:1.2;white-space:nowrap'),
          background: on ? 'var(--primary-tint)' : 'var(--surface)',
          borderColor: on ? 'var(--primary)' : 'var(--line2)',
          color: on ? 'var(--deep)' : 'var(--text)',
          fontWeight: on ? 600 : 500,
        }}
      >
        {on
          ? <span aria-hidden="true" style={sx('display:grid;flex:none')}><Check size={14} w={1.75} /></span>
          : icono ? <span aria-hidden="true" style={sx('display:grid;flex:none;color:var(--muted)')}>{pintarIcono(icono, 16)}</span> : null}
        <span>{children}</span>
        {contador != null && (
          <span style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--fs-xs);margin-left:2px'), color: on ? 'var(--deep)' : 'var(--faint)' }}>{contador}</span>
        )}
      </span>
    </button>
  )
}
