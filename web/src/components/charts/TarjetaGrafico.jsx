import { sx } from '../../lib/sx'
import { EYEBROW, FS_MIN } from './formato'

/**
 * Contenedor de un gráfico del dashboard: eyebrow mono en mayúsculas, título, un slot a la
 * derecha (delta, toggle, leyenda) y el cuerpo. Mismos tokens que `MiniKpi` para que las tarjetas
 * con número y las tarjetas con gráfico se lean como una sola familia.
 *
 * 01/10/2026 (brief estético v2 §2.2/§2.8): el eyebrow pasa al tracking único del sistema
 * (`--track-eyebrow`, .08em; antes .12em) y a un piso de 11 px, igual que la nota. El delta lleva
 * flecha además del color ("▲ +8 %"): la dirección nunca la dice solo el verde o el rojo.
 */
const TONOS = { success: 'var(--success)', danger: 'var(--danger)', faint: 'var(--faint)' }
const FLECHA = { success: '▲', danger: '▼' }

export default function TarjetaGrafico({ eyebrow, titulo, comp, derecha, nota, children, style }) {
  const flecha = comp && FLECHA[comp.tono]
  return (
    <div style={{ ...sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:16px;box-shadow:var(--shadow);min-width:0;display:flex;flex-direction:column'), ...style }}>
      <div style={sx('display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:6px 10px;margin-bottom:10px')}>
        <div style={sx('min-width:0;flex:1 1 140px')}>
          {eyebrow && <div style={EYEBROW}>{eyebrow}</div>}
          {titulo && <div style={sx('font-family:var(--font-display);font-size:var(--fs-md);font-weight:600;color:var(--text);margin-top:2px;line-height:1.25')}>{titulo}</div>}
        </div>
        {comp ? (
          <span style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:var(--fs-xs);font-weight:600;text-align:right;flex:none'), color: TONOS[comp.tono] || 'var(--faint)' }}>
            {flecha && <span aria-hidden="true" style={{ marginRight: 4 }}>{flecha}</span>}
            {comp.texto}
          </span>
        ) : derecha || null}
      </div>
      <div style={sx('flex:1;min-width:0')}>{children}</div>
      {nota && <div style={{ ...sx('margin-top:8px;color:var(--faint);line-height:1.45'), fontSize: FS_MIN }}>{nota}</div>}
    </div>
  )
}
