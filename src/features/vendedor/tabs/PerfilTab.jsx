import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { fmtPesos } from '../../../lib/format'
import { useAuth } from '../../../context/AuthContext'
import { card } from '../ui'
import MiCuenta from '../../perfil/MiCuenta'

/** Pestaña "Perfil": venta del día, meta diaria, visitas/efectividad y cierre de jornada. */
export default function PerfilTab({ j }) {
  const { perfil } = useAuth()
  const nombre = perfil?.nombre || 'Vendedor'
  const { montoHoy, done, clients, meta, efect, showToast } = j
  const [gps, setGps] = useState(true)

  return (
    <div style={sx('flex:1;overflow-y:auto;padding:14px 14px 92px')}>
      <div style={sx('display:flex;align-items:center;gap:12px;margin:4px 2px 16px')}>
        <div style={sx('width:44px;height:44px;border-radius:14px;background:var(--tlight);color:var(--deep);display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:16px')}>{nombre.slice(0, 2).toUpperCase()}</div>
        <div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>{nombre}</div>
          <div style={sx('font-size:11.5px;color:var(--faint);font-family:var(--font-mono)')}>Vendedor · DisT-At</div>
        </div>
      </div>
      <div style={card}>
        <div style={sx('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)')}>Venta del día</div>
        <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:28px;font-weight:600;margin:4px 0 10px')}>{fmtPesos(montoHoy)}</div>
      </div>
      <div style={sx('display:flex;gap:10px;margin-bottom:10px')}>
        <div style={{ ...card, marginBottom: 0, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={sx('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);align-self:flex-start;margin-bottom:8px')}>Meta diaria</div>
          <div style={sx('position:relative;width:110px;height:110px')}>
            <svg viewBox="0 0 120 120" style={{ width: '100%', height: '100%', transform: 'rotate(-90deg)' }}>
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface2)" strokeWidth="10" />
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--primary)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${(meta * 3.267).toFixed(1)} 326.7`} />
            </svg>
            <div style={sx('position:absolute;inset:0;display:grid;place-items:center')}>
              <div style={sx('text-align:center')}>
                <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:600')}>{meta}%</div>
                <div style={sx('font-size:9.5px;color:var(--faint);font-family:var(--font-mono)')}>de $ 900.000</div>
              </div>
            </div>
          </div>
        </div>
        <div style={sx('flex:1;display:flex;flex-direction:column;gap:10px')}>
          <div style={{ ...card, marginBottom: 0, flex: 1 }}>
            <div style={sx('font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.06em')}>Visitas</div>
            <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;margin-top:2px')}>{done}/{clients.length}</div>
          </div>
          <div style={{ ...card, marginBottom: 0, flex: 1 }}>
            <div style={sx('font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.06em')}>Efectividad</div>
            <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;margin-top:2px;color:var(--success)')}>{efect}%</div>
          </div>
        </div>
      </div>
      <div style={{ ...card, padding: '4px 14px' }}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between;padding:12px 0')}>
          <div>
            <div style={sx('font-size:13.5px;font-weight:500')}>Tracking GPS</div>
            <div style={sx('font-size:11px;color:var(--faint)')}>Envía tu posición al moverte</div>
          </div>
          <div onClick={() => setGps((v) => !v)} style={{ ...sx('width:48px;height:28px;border-radius:99px;padding:3px;cursor:pointer;transition:background .2s'), background: gps ? 'var(--primary)' : 'var(--line2)' }}>
            <div style={{ ...sx('width:22px;height:22px;border-radius:99px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s'), transform: `translateX(${gps ? 20 : 0}px)` }} />
          </div>
        </div>
      </div>
      <button onClick={() => showToast('Jornada cerrada · resumen enviado al panel')} style={sx('width:100%;min-height:48px;display:grid;place-items:center;border:1px solid var(--danger);color:var(--danger);background:var(--danger-tint);border-radius:12px;font-weight:600;font-size:13.5px;cursor:pointer;margin-bottom:12px')}>Cerrar jornada</button>

      {/* Cuenta (editar perfil, tema, cerrar sesión) — mismas acciones que el menú del admin. */}
      <MiCuenta onToast={showToast} />
    </div>
  )
}
