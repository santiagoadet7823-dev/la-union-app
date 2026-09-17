import { sx } from '../../lib/sx'

/**
 * Contenedor de un gráfico del dashboard: eyebrow mono en mayúsculas, título, un slot a la
 * derecha (delta, toggle, leyenda) y el cuerpo. Mismos tokens que `KpiCard` para que las tarjetas
 * con número y las tarjetas con gráfico se lean como una sola familia.
 */
const TONOS = { success: 'var(--success)', danger: 'var(--danger)', faint: 'var(--faint)' }

export default function TarjetaGrafico({ eyebrow, titulo, comp, derecha, nota, children, style }) {
  return (
    <div style={{ ...sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card);padding:16px;box-shadow:var(--shadow);min-width:0;display:flex;flex-direction:column'), ...style }}>
      <div style={sx('display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px')}>
        <div style={sx('min-width:0')}>
          {eyebrow && <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:600')}>{eyebrow}</div>}
          {titulo && <div style={sx('font-family:var(--font-display);font-size:var(--fs-md);font-weight:600;color:var(--text);margin-top:2px;line-height:1.25')}>{titulo}</div>}
        </div>
        {comp ? (
          <span style={{ ...sx('font-family:var(--font-mono);font-size:var(--fs-xs);font-weight:600;text-align:right;flex:none'), color: TONOS[comp.tono] || 'var(--faint)' }}>{comp.texto}</span>
        ) : derecha || null}
      </div>
      <div style={sx('flex:1;min-width:0')}>{children}</div>
      {nota && <div style={sx('margin-top:8px;font-size:var(--fs-2xs);color:var(--faint);line-height:1.45')}>{nota}</div>}
    </div>
  )
}
