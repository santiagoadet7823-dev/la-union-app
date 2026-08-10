import { sx } from '../../../lib/sx'

/** Número de tercer nivel: paradas y tiempo en movimiento. Mismo contrato de contexto que KpiCard. */
const TONOS = { success: 'var(--success)', danger: 'var(--danger)', faint: 'var(--faint)' }

export default function MiniKpi({ label, valor, unidad, comp, nota }) {
  return (
    <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:13px 14px;box-shadow:var(--shadow)')}>
      <div style={sx('font-size:var(--fs-xs);color:var(--muted);line-height:1.3')}>{label}</div>
      <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:24px;font-weight:700;margin-top:3px')}>
        {valor}
        {unidad && <span style={sx('font-size:var(--fs-sm);font-weight:600;color:var(--faint);margin-left:3px')}>{unidad}</span>}
      </div>
      <div style={{
        ...sx('font-family:var(--font-mono);font-size:var(--fs-2xs);margin-top:2px;line-height:1.3'),
        color: comp ? (TONOS[comp.tono] || 'var(--faint)') : 'var(--faint)',
      }}>
        {comp ? comp.texto : nota || ''}
      </div>
    </div>
  )
}
