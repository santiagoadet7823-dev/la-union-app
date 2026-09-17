import { sx } from '../../lib/sx'

/**
 * Ranking horizontal: una fila por entidad, barra proporcional al máximo, valor a la derecha.
 * Es el mismo dibujo que hacían `FilaEquipo` (km sobre el máximo del equipo) y
 * `TableroSheet.BarraRanking` (participación de productos), unificado.
 *
 * El color sigue a la ENTIDAD (`colorPorId` para personas), nunca al puesto: si un filtro saca
 * al primero, el segundo no se pinta del color del primero.
 *
 * @param {Array<{id:string, label:string, valor:number, color?:string, secundario?:string, onClick?:()=>void}>} filas
 * @param {(v:number)=>string} formato
 * @param {number} max  opcional, por defecto el mayor de las filas
 */
export default function BarrasH({ filas = [], formato = (v) => String(v), max, sinDatosTexto = 'Sin registros en el período' }) {
  const lista = filas.filter((f) => Number.isFinite(f.valor))
  if (!lista.length) {
    return <div style={sx('padding:14px;color:var(--faint);font-size:var(--fs-sm);border:1px dashed var(--line2);border-radius:var(--r-md);text-align:center')}>{sinDatosTexto}</div>
  }
  const tope = max || Math.max(...lista.map((f) => f.valor), 0) || 1

  return (
    <div style={sx('display:flex;flex-direction:column;gap:8px')}>
      {lista.map((f) => (
        <div
          key={f.id}
          onClick={f.onClick}
          className={f.onClick ? 'lu-press' : undefined}
          role={f.onClick ? 'button' : undefined}
          style={{ ...sx('display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 10px;align-items:center'), cursor: f.onClick ? 'pointer' : 'default' }}
        >
          <div style={sx('display:flex;align-items:center;gap:8px;min-width:0')}>
            <span style={{ ...sx('width:9px;height:9px;border-radius:99px;flex:none'), background: f.color || 'var(--primary)' }} />
            <span style={sx('font-size:var(--fs-sm);font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{f.label}</span>
            {f.secundario && <span style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint);flex:none')}>{f.secundario}</span>}
          </div>
          <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--fs-sm);font-weight:600;color:var(--text);text-align:right')}>
            {formato(f.valor)}
          </div>
          <div style={sx('grid-column:1 / -1;height:6px;border-radius:3px;background:var(--bar);overflow:hidden')}>
            <div style={{ ...sx('height:100%;border-radius:3px;transition:width .3s ease'), width: `${Math.max(1.5, (f.valor / tope) * 100)}%`, background: f.color || 'var(--primary)' }} />
          </div>
        </div>
      ))}
    </div>
  )
}
