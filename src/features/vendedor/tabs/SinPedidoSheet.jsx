import { sx } from '../../../lib/sx'

const MOTIVOS = ['Stock suficiente', 'Precio / condición', 'Comercio cerrado', 'Otro']

/**
 * Cartel CENTRADO para cerrar una visita SIN pedido, indicando el motivo. Va centrado (no como
 * hoja abajo) para que nunca lo tape la bottom-nav, y con entrada pulida (scrim fade + card
 * scale-in, ease-out fuerte <300ms) siguiendo los estándares de animación de Emil Kowalski.
 * z-index 50 → por encima de la barra de pestañas (40).
 */
export default function SinPedidoSheet({ j }) {
  const { visitC, motivo, setMotivo, setSheet, endVisit, showToast } = j
  const cerrar = () => { setSheet(false); setMotivo(null) }

  return (
    <div style={sx('position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px')}>
      <div className="lu-modal-scrim" onClick={cerrar} style={sx('position:absolute;inset:0;background:var(--scrim)')} />
      <div className="lu-modal-card" style={sx('position:relative;width:100%;max-width:400px;max-height:88vh;overflow-y:auto;background:var(--surface);border:1px solid var(--line2);border-radius:20px;box-shadow:var(--shadow-lg);padding:18px')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:2px')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Visita sin pedido</div>
          <button onClick={cerrar} className="lu-press" style={sx('width:30px;height:30px;border-radius:8px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;font-size:16px')}>✕</button>
        </div>
        <div style={sx('font-size:12.5px;color:var(--muted);margin-bottom:16px')}>Indicá el motivo para cerrar la visita en <b>{visitC?.name}</b>.</div>
        {MOTIVOS.map((m) => (
          <div key={m} onClick={() => setMotivo(m)} className="lu-press" style={{ ...sx('display:flex;align-items:center;gap:10px;min-height:50px;padding:0 13px;border-radius:12px;margin-bottom:8px;cursor:pointer'), border: `1px solid ${motivo === m ? 'var(--primary)' : 'var(--line)'}`, background: motivo === m ? 'var(--primary-tint)' : 'var(--surface)' }}>
            <span style={{ ...sx('width:18px;height:18px;flex:none;border-radius:99px;display:grid;place-items:center'), border: `2px solid ${motivo === m ? 'var(--primary)' : 'var(--line2)'}` }}>
              <span style={{ ...sx('width:8px;height:8px;border-radius:99px'), background: motivo === m ? 'var(--primary)' : 'transparent' }} />
            </span>
            <span style={sx('font-size:14px;font-weight:500')}>{m}</span>
          </div>
        ))}
        <button onClick={() => { if (!motivo) return; endVisit('sin_pedido', { motivo }); showToast(`Visita cerrada sin pedido · ${motivo}`) }} disabled={!motivo} className="lu-press" style={{ ...sx('width:100%;margin-top:10px;min-height:50px;display:grid;place-items:center;border:none;border-radius:12px;font-weight:600;font-size:14.5px;cursor:pointer'), background: motivo ? 'var(--warning)' : 'var(--surface2)', color: motivo ? '#3A2A00' : 'var(--faint)' }}>Confirmar sin pedido</button>
      </div>
    </div>
  )
}
