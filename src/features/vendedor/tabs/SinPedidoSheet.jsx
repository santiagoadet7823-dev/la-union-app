import { sx } from '../../../lib/sx'

const MOTIVOS = ['Stock suficiente', 'Precio / condición', 'Comercio cerrado', 'Otro']

/** Bottom sheet para cerrar una visita SIN pedido, indicando el motivo. */
export default function SinPedidoSheet({ j }) {
  const { visitC, motivo, setMotivo, setSheet, endVisit, showToast } = j
  const cerrar = () => { setSheet(false); setMotivo(null) }

  return (
    <div style={sx('position:absolute;inset:0;z-index:50;display:flex;flex-direction:column;justify-content:flex-end')}>
      <div onClick={cerrar} style={sx('position:absolute;inset:0;background:var(--scrim)')} />
      <div style={sx('position:relative;background:var(--surface);border:1px solid var(--line2);border-bottom:none;border-radius:20px 20px 0 0;padding:10px 16px calc(24px + env(safe-area-inset-bottom))')}>
        <div style={sx('width:36px;height:4px;border-radius:99px;background:var(--line2);margin:2px auto 14px')} />
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px;margin-bottom:2px')}>Visita sin pedido</div>
        <div style={sx('font-size:12px;color:var(--muted);margin-bottom:14px')}>Indicá el motivo para cerrar la visita en <b>{visitC?.name}</b>.</div>
        {MOTIVOS.map((m) => (
          <div key={m} onClick={() => setMotivo(m)} style={{ ...sx('display:flex;align-items:center;gap:10px;min-height:48px;padding:0 12px;border-radius:12px;margin-bottom:7px;cursor:pointer'), border: `1px solid ${motivo === m ? 'var(--primary)' : 'var(--line)'}`, background: motivo === m ? 'var(--primary-tint)' : 'var(--surface)' }}>
            <span style={{ ...sx('width:16px;height:16px;border-radius:99px;display:grid;place-items:center'), border: `2px solid ${motivo === m ? 'var(--primary)' : 'var(--line2)'}` }}>
              <span style={{ ...sx('width:7px;height:7px;border-radius:99px'), background: motivo === m ? 'var(--primary)' : 'transparent' }} />
            </span>
            <span style={sx('font-size:13.5px;font-weight:500')}>{m}</span>
          </div>
        ))}
        <div onClick={() => { if (!motivo) return; endVisit('sin_pedido', { motivo }); showToast(`Visita cerrada sin pedido · ${motivo}`) }} style={{ ...sx('margin-top:6px;min-height:48px;display:grid;place-items:center;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer'), background: motivo ? 'var(--warning)' : 'var(--surface2)', color: motivo ? '#3A2A00' : 'var(--faint)' }}>Confirmar sin pedido</div>
      </div>
    </div>
  )
}
