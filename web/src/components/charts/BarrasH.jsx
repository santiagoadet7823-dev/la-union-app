import { sx } from '../../lib/sx'
import { FS_MIN } from './formato'

/**
 * Ranking horizontal: una fila por entidad, barra proporcional al máximo, valor a la derecha.
 * Es el mismo dibujo que hacían `FilaEquipo` (km sobre el máximo del equipo) y
 * `TableroSheet.BarraRanking` (participación de productos), unificado.
 *
 * El color sigue a la ENTIDAD (`colorPorId` para personas), nunca al puesto: si un filtro saca
 * al primero, el segundo no se pinta del color del primero.
 *
 * `monocromo` (01/10/2026, decisión 6 del dueño: neutros + un acento): las barras van en neutro
 * (`--line2`) y solo la primera —la que encabeza el ranking— en `--primary`, como la hoja "Panel
 * de Dirección" 7a/7b. El color de identidad de la persona queda en el punto junto al nombre, que
 * siempre va acompañado del nombre: la identidad nunca es color solo. Sin `monocromo` se dibuja
 * como antes (lo usa `FaltanteTab`, fuera de este rediseño).
 *
 * Con `onClick` cada fila es un botón de verdad: alto mínimo de 44 px y se activa con teclado.
 * El rótulo puede partir en dos líneas (nada de elipsis en el nombre).
 *
 * @param {Array<{id:string, label:string, valor:number, color?:string, secundario?:string, onClick?:()=>void}>} filas
 * @param {(v:number)=>string} formato
 * @param {number} max  opcional, por defecto el mayor de las filas
 * @param {boolean} monocromo
 */
export default function BarrasH({ filas = [], formato = (v) => String(v), max, sinDatosTexto = 'Sin registros en el período', monocromo = false }) {
  const lista = filas.filter((f) => Number.isFinite(f.valor))
  if (!lista.length) {
    return <div style={sx('padding:14px;color:var(--faint);font-size:var(--fs-sm);border:1px dashed var(--line2);border-radius:var(--r-md);text-align:center')}>{sinDatosTexto}</div>
  }
  const tope = max || Math.max(...lista.map((f) => f.valor), 0) || 1
  const colorBarra = (f, i) => (monocromo ? (i === 0 ? 'var(--primary)' : 'var(--line2)') : f.color || 'var(--primary)')

  return (
    <div style={sx('display:flex;flex-direction:column;gap:8px')}>
      {lista.map((f, i) => (
        <div
          key={f.id}
          onClick={f.onClick}
          onKeyDown={f.onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.onClick() } } : undefined}
          tabIndex={f.onClick ? 0 : undefined}
          className={f.onClick ? 'lu-press' : undefined}
          role={f.onClick ? 'button' : undefined}
          // Flex con wrap y no grilla: el nombre pide 14ch y el monto va a la derecha. `ch` crece con
          // la letra del sistema (informe 08), así que con letra grande el monto baja a su propio
          // renglón en vez de dejarle al nombre una columna de una palabra.
          style={{ ...sx('display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;align-content:center'), cursor: f.onClick ? 'pointer' : 'default', minHeight: f.onClick ? 44 : undefined }}
        >
          {/* Punto + nombre en una fila SIN wrap: si el nombre no entra, parte el texto y el punto
              queda a su lado (con wrap el nombre bajaba entero y el punto quedaba solo en un
              renglón, revisión del 01/10/2026). El dato secundario va SIEMPRE en su propio
              renglón, alineado con el nombre: si se acomodaba al lado cuando entraba, cada fila
              del ranking quedaba distinta. */}
          <div style={sx('flex:1 1 14ch;min-width:0')}>
            <div style={sx('display:flex;align-items:center;gap:8px;min-width:0')}>
              <span aria-hidden="true" style={{ ...sx('width:9px;height:9px;border-radius:99px;flex:none'), background: f.color || 'var(--primary)' }} />
              <span style={sx('flex:1 1 0%;min-width:0;font-size:var(--fs-sm);font-weight:600;color:var(--text);overflow-wrap:break-word;line-height:1.3')}>{f.label}</span>
            </div>
            {f.secundario && <div style={{ ...sx('padding-left:17px;margin-top:2px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--faint);overflow-wrap:break-word'), fontSize: FS_MIN }}>{f.secundario}</div>}
          </div>
          <div style={sx('margin-left:auto;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--fs-sm);font-weight:600;color:var(--text);text-align:right')}>
            {formato(f.valor)}
          </div>
          <div style={sx('flex:1 1 100%;height:6px;border-radius:3px;background:var(--bar);overflow:hidden')}>
            <div style={{ ...sx('height:100%;border-radius:3px;transition:width .3s ease'), width: `${Math.max(1.5, (f.valor / tope) * 100)}%`, background: colorBarra(f, i) }} />
          </div>
        </div>
      ))}
    </div>
  )
}
