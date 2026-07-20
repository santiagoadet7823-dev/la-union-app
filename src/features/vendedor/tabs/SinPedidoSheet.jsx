import { useState } from 'react'
import { sx } from '../../../lib/sx'
import Overlay from '../../../components/Overlay'

const MOTIVOS = ['Stock suficiente', 'Precio / condición', 'Comercio cerrado', 'Otro']

/**
 * Cartel CENTRADO para cerrar una visita SIN pedido, indicando el motivo.
 *
 * ⚠️ Va CENTRADO (variant="modal") y no como hoja abajo, aunque el archivo se
 * llame "Sheet": una hoja inferior quedaría tapada por la bottom-nav del vendedor.
 * No cambiarlo a variant="sheet" por coherencia de nombre.
 *
 * `contained`: se renderiza dentro del marco de teléfono (PhoneFrame) en
 * escritorio, así que NO va por portal. Ver Overlay.jsx.
 */
export default function SinPedidoSheet({ j }) {
  const { visitC, motivo, setMotivo, setSheet, endVisit, showToast } = j
  const [abierto, setAbierto] = useState(true)
  const cerrar = () => { setSheet(false); setMotivo(null) }

  function confirmar() {
    if (!motivo) return
    endVisit('sin_pedido', { motivo })
    showToast(`Visita cerrada sin pedido · ${motivo}`)
  }

  return (
    <Overlay
      open={abierto}
      onClose={cerrar}
      contained
      maxWidth={400}
      title="Visita sin pedido"
      footer={
        <button
          type="button"
          onClick={confirmar}
          disabled={!motivo}
          className="lu-press"
          style={{
            ...sx('width:100%;min-height:50px;display:grid;place-items:center;border:none;border-radius:var(--r-md);font-weight:600;font-size:var(--fs-md)'),
            background: motivo ? 'var(--warning)' : 'var(--surface2)',
            color: motivo ? '#3A2A00' : 'var(--faint)',
            cursor: motivo ? 'pointer' : 'not-allowed',
          }}
        >
          Confirmar sin pedido
        </button>
      }
    >
      <div style={sx('font-size:var(--fs-sm);color:var(--muted);margin-bottom:16px')}>
        Indicá el motivo para cerrar la visita en <b>{visitC?.name}</b>.
      </div>
      {/* radiogroup: antes eran <div onClick> sin rol ni foco, invisibles para
          teclado y lector de pantalla. */}
      <div role="radiogroup" aria-label="Motivo">
        {MOTIVOS.map((m) => {
          const on = motivo === m
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setMotivo(m)}
              className="lu-press"
              style={{
                ...sx('width:100%;display:flex;align-items:center;gap:10px;min-height:50px;padding:0 13px;border-radius:var(--r-md);margin-bottom:8px;cursor:pointer;text-align:left'),
                border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`,
                background: on ? 'var(--primary-tint)' : 'var(--surface)',
                color: 'var(--text)',
              }}
            >
              <span style={{ ...sx('width:18px;height:18px;flex:none;border-radius:var(--r-pill);display:grid;place-items:center'), border: `2px solid ${on ? 'var(--primary)' : 'var(--line2)'}` }}>
                <span style={{ ...sx('width:8px;height:8px;border-radius:var(--r-pill)'), background: on ? 'var(--primary)' : 'transparent' }} />
              </span>
              <span style={sx('font-size:var(--fs-md);font-weight:500')}>{m}</span>
            </button>
          )
        })}
      </div>
    </Overlay>
  )
}
