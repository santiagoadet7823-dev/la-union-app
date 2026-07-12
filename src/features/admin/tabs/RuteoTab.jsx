import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { fmtPesos, kgFmt } from '../../../lib/format'
import { panel, label10, fieldLabel, asignGrid } from '../ui'

// Demo estático de órdenes (andamiaje del ruteo — el eje pedidos aún no está cableado).
const ORDENES = [
  ['PED-2031', 'Autoservicio La Esquina', 'San Andrés', 'M. Ríos', 12, 121.3, 341850, 'Entregado', '11:02'],
  ['PED-2029', 'Almacén Don Carlos', 'Villa Ballester', 'M. Ríos', 8, 84.5, 186400, 'En camino', '08:42'],
  ['PED-2034', 'Despensa El Ombú', 'San Martín', 'L. Paz', 6, 52.0, 98700, 'Pendiente', '09:58'],
  ['PED-2038', 'Súper Mi Barrio', 'Villa Lynch', 'M. Ríos', 15, 164.2, 412300, 'Pendiente', '10:21'],
  ['PED-2040', 'Maxikiosco Central', 'San Martín', 'L. Paz', 4, 18.9, 64150, 'Pendiente', '10:45'],
  ['PED-2027', 'Kiosco Rivadavia', 'San Andrés', 'L. Paz', 5, 24.6, 58200, 'Entregado', '10:12'],
  ['PED-2025', 'Almacén La Nueva', 'Villa Maipú', 'M. Ríos', 9, 88.1, 176900, 'Entregado', '09:40'],
  ['PED-2033', 'Despensa Norte', 'Villa Ballester', 'L. Paz', 7, 61.4, 132500, 'En camino', '09:51'],
  ['PED-2036', 'Autoservicio 9 de Julio', 'San Martín', 'M. Ríos', 11, 104.8, 268400, 'Pendiente', '10:05'],
  ['PED-2022', 'Kiosco El Faro', 'Villa Lynch', 'L. Paz', 3, 12.2, 41300, 'No entregado', '09:02'],
]

/** Pestaña "Ruteo": parámetros del plan + selección de órdenes a asignar (andamiaje TSP). */
export default function RuteoTab({ onToast }) {
  const [objetivo, setObjetivo] = useState('Minimizar distancia')
  const [optState, setOptState] = useState('idle')
  const [selOrders, setSelOrders] = useState({ 0: true, 1: true, 2: true, 3: true, 4: true })

  const capData = [['Peso', '640', '1.000 kg', 64], ['Volumen', '5,2', '8 m³', 65], ['Dinero', '$ 4,9M', '$ 6M', 81], ['Visitas', '18', '24', 75]]
  const icons = { Peso: '⚖', Volumen: '▣', Dinero: '$', Visitas: '◎' }
  const capChips = capData.map(([label, usado, total, pct]) => ({
    label, usado, total, pct, barPct: Math.min(100, pct), icon: icons[label],
    color: pct > 100 ? 'var(--danger)' : pct > 80 ? 'var(--warning)' : 'var(--primary)',
  }))
  const asignFuente = ORDENES.filter((o) => o[7] === 'Pendiente' || o[7] === 'No entregado')
  const selIdx = asignFuente.map((_, i) => i).filter((i) => selOrders[i])
  const selKgTot = kgFmt(selIdx.reduce((a, i) => a + asignFuente[i][5], 0))
  const selMontoTot = fmtPesos(selIdx.reduce((a, i) => a + asignFuente[i][6], 0))

  return (
    <div className="lu-tabs" style={sx('flex:1;padding:20px;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;grid-template-columns:360px minmax(640px,1fr);gap:14px;align-items:start;overflow-x:auto')}>
      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={label10}>Parámetros del plan</div>
        <div>
          <div style={fieldLabel}>Depósito de salida</div>
          <div style={sx('display:flex;align-items:center;justify-content:space-between;border:1px solid var(--line2);border-radius:12px;padding:11px 12px;font-size:13px;cursor:pointer')}>
            <span>Depósito Central · San Martín</span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>
          </div>
        </div>
        <div>
          <div style={fieldLabel}>Objetivo</div>
          <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:6px')}>
            {['Minimizar distancia', 'Minimizar tiempo'].map((o) => {
              const on = objetivo === o
              return <div key={o} onClick={() => setObjetivo(o)} style={{ ...sx('padding:10px;border-radius:12px;font-size:12px;font-weight:600;text-align:center;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--muted)' }}>{o}</div>
            })}
          </div>
        </div>
        <div>
          <div style={fieldLabel}>Capacidad del vehículo · CAM-12</div>
          <div style={sx('display:flex;flex-direction:column;gap:8px')}>
            {capChips.map((c) => (
              <div key={c.label} style={sx('border:1px solid var(--line);border-radius:12px;padding:9px 11px')}>
                <div style={sx('display:flex;align-items:center;gap:8px;font-size:11.5px')}>
                  <span style={{ color: c.color, display: 'flex' }}>{c.icon}</span>
                  <span style={sx('flex:1;font-weight:600;color:var(--muted)')}>{c.label}</span>
                  <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px')}>{c.usado} / {c.total}</span>
                  <span style={{ ...sx('font-family:var(--font-mono);font-size:10.5px;font-weight:600;width:36px;text-align:right'), color: c.color }}>{c.pct}%</span>
                </div>
                <div style={sx('margin-top:7px;height:4px;border-radius:99px;background:var(--surface2);overflow:hidden')}><div style={{ ...sx('height:100%;border-radius:99px'), width: `${c.barPct}%`, background: c.color }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div onClick={() => { if (optState === 'running') return; setOptState('running'); setTimeout(() => setOptState('done'), 1400) }} style={{ ...sx('min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer'), background: optState === 'running' ? 'var(--surface2)' : 'var(--primary)', color: optState === 'running' ? 'var(--faint)' : 'var(--on-primary)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3m6.4-.4-2.2 2.2M21 12h-3m.4 6.4-2.2-2.2M12 18v3m-6.4-.4 2.2-2.2M3 12h3m-.4-6.4 2.2 2.2" /></svg>
          {optState === 'running' ? 'Optimizando…' : optState === 'done' ? 'Reoptimizar rutas' : 'Optimizar rutas'}
        </div>
        {optState === 'done' && (
          <div style={sx('border:1px solid var(--success);background:var(--success-tint);border-radius:12px;padding:12px')}>
            <div style={sx('font-size:12px;font-weight:600;color:var(--success);margin-bottom:4px')}>Plan V2 generado</div>
            <div style={sx('font-size:11.5px;color:var(--muted);font-family:var(--font-mono);font-variant-numeric:tabular-nums;line-height:1.7')}>2 rutas · 46,8 km · 6 h 40 m<br />▼ −18% distancia vs plan actual</div>
            <div onClick={() => onToast('Plan V2 publicado · 2 móviles notificados')} style={sx('margin-top:10px;min-height:40px;display:grid;place-items:center;background:var(--success);color:#04211F;border-radius:10px;font-weight:600;font-size:12.5px;cursor:pointer')}>Publicar plan a los móviles</div>
          </div>
        )}
      </div>

      <div style={panel}>
        <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px')}>
          <div style={label10}>Órdenes a asignar</div>
          <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted)')}><span style={sx('color:var(--deep);font-weight:600')}>{selIdx.length}</span> seleccionadas · {selKgTot} kg · {selMontoTot}</div>
        </div>
        <div style={{ ...asignGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
          <span /><span>Pedido</span><span>Cliente</span><span>Localidad</span><span style={sx('text-align:right')}>Arts</span><span style={sx('text-align:right')}>Kilos</span><span style={sx('text-align:right')}>Monto</span>
        </div>
        {asignFuente.map((o, i) => {
          const on = !!selOrders[i]
          return (
            <div key={o[0]} onClick={() => setSelOrders((v) => ({ ...v, [i]: !v[i] }))} style={{ ...asignGrid, ...sx('padding:10px;align-items:center;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer'), background: on ? 'var(--primary-tint)' : 'transparent' }}>
              <span style={sx('display:flex')}><span style={{ ...sx('width:18px;height:18px;border-radius:6px;display:grid;place-items:center'), border: `1.5px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary)' : 'transparent' }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={on ? 'var(--on-primary)' : 'transparent'} strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg></span></span>
              <span style={sx('font-family:var(--font-mono);font-size:11.5px;color:var(--deep);font-weight:600')}>{o[0]}</span>
              <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{o[1]}</span>
              <span style={sx('color:var(--muted)')}>{o[2]}</span>
              <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{o[4]}</span>
              <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{kgFmt(o[5])}</span>
              <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600')}>{fmtPesos(o[6])}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
