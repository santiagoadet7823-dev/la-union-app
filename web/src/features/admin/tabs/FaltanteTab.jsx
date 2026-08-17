import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { panel, label10, faltGrid } from '../ui'

// Demo estático del reporte de faltante (se completa con entregas reales de repartidores).
const FALTANTES = [
  ['Harina 000 1 kg ×10', 48, 41, 'Sin stock'],
  ['Gaseosa Cola 2.25 L ×6', 62, 58, 'Sin stock'],
  ['Cerveza Rubia 1 L ×12', 36, 30, 'Sin stock'],
  ['Azúcar 1 kg ×10', 40, 36, 'Sin stock'],
  ['Aceite Girasol 1.5 L ×12', 30, 27, 'Rechazado'],
  ['Detergente 750 ml ×12', 24, 22, 'Otro'],
  ['Yerba Mate 1 kg ×10', 44, 44, '—'],
]

/** Pestaña "Faltante": reporte de stock generado vs entregado (maqueta, sin datos reales aún). */
export default function FaltanteTab() {
  const [faltVacio] = useState(true)

  const faltRows = FALTANTES.map((f) => {
    const falt = f[1] - f[2]
    return {
      name: f[0], gen: f[1], ent: f[2], faltTxt: falt > 0 ? `−${falt}` : '0',
      faltColor: falt > 0 ? 'var(--danger)' : 'var(--faint)', motivo: f[3],
      motBg: f[3] === 'Sin stock' ? 'var(--danger-tint)' : f[3] === 'Rechazado' ? 'var(--warning-tint)' : 'var(--surface2)',
      motFg: f[3] === 'Sin stock' ? 'var(--danger)' : f[3] === 'Rechazado' ? 'var(--warning)' : 'var(--faint)',
    }
  })
  const maxGen = Math.max(...FALTANTES.map((f) => f[1]))
  const faltBars = FALTANTES.map((f) => ({
    entPct: Math.round((f[2] / maxGen) * 92),
    faltPct: Math.max(f[1] - f[2] > 0 ? 4 : 0, Math.round(((f[1] - f[2]) / maxGen) * 92)),
    short: f[0].split(' ')[0],
  }))

  return (
    <div style={sx('flex:1;padding:20px;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box')}>
      <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
        <div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:18px')}>Reporte de faltante de stock</div>
          <div style={sx('font-size:12px;color:var(--muted);margin-top:2px')}>Pedidos generados vs entregados</div>
        </div>
      </div>

      {faltVacio ? (
        <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:64px 20px;display:flex;flex-direction:column;align-items:center;gap:12px')}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M16.5 9.4 7.55 4.24" /><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.29 7 12 12l8.71-5" /><path d="M12 22V12" /></svg>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Sin entregas registradas aún</div>
          <div style={sx('font-size:12.5px;color:var(--muted);max-width:360px;text-align:center')}>El reporte se completa a medida que los repartidores confirman entregas y declaran faltantes.</div>
        </div>
      ) : (
        <>
          <div style={sx('display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px')}>
            <div style={panel}><div style={label10}>Unidades faltantes</div><div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:26px;font-weight:600;margin-top:4px;color:var(--danger)')}>26</div><div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>sobre 284 generadas</div></div>
            <div style={panel}><div style={label10}>Cumplimiento</div><div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:26px;font-weight:600;margin-top:4px;color:var(--success)')}>90,8%</div><div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>▲ +1,2 pp vs semana pasada</div></div>
            <div style={panel}><div style={label10}>Motivo principal</div><div style={sx('font-family:var(--font-display);font-size:19px;font-weight:600;margin-top:6px')}>Sin stock</div><div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>21 de 26 unidades (81%)</div></div>
          </div>

          <div style={sx('display:grid;grid-template-columns:1.2fr 1fr;gap:14px;align-items:start')}>
            <div style={panel}>
              <div style={{ ...label10, marginBottom: 10 }}>Detalle por producto</div>
              <div style={{ ...faltGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
                <span>Producto</span><span style={sx('text-align:right')}>Generado</span><span style={sx('text-align:right')}>Entregado</span><span style={sx('text-align:right')}>Faltante</span><span>Motivo</span>
              </div>
              {faltRows.map((f) => (
                <div key={f.name} style={{ ...faltGrid, ...sx('padding:9px 10px;align-items:center;border-bottom:1px solid var(--line);font-size:12.5px') }}>
                  <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{f.name}</span>
                  <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{f.gen}</span>
                  <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--success)')}>{f.ent}</span>
                  <span style={{ ...sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600'), color: f.faltColor }}>{f.faltTxt}</span>
                  <span><span style={{ ...sx('display:inline-flex;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), background: f.motBg, color: f.motFg }}>{f.motivo}</span></span>
                </div>
              ))}
              <div style={{ ...faltGrid, ...sx('padding:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12.5px;font-weight:600') }}>
                <span style={sx('font-family:Inter,sans-serif')}>Total</span><span style={sx('text-align:right')}>284</span><span style={sx('text-align:right;color:var(--success)')}>258</span><span style={sx('text-align:right;color:var(--danger)')}>−26</span><span />
              </div>
            </div>

            <div style={panel}>
              <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px')}>
                <div style={label10}>Entregado vs faltante</div>
                <div style={sx('display:flex;gap:10px;font-size:10.5px;color:var(--muted)')}>
                  <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:8px;height:8px;border-radius:2px;background:var(--primary)')} />Entregado</span>
                  <span style={sx('display:flex;align-items:center;gap:4px')}><span style={sx('width:8px;height:8px;border-radius:2px;background:var(--danger)')} />Faltante</span>
                </div>
              </div>
              <div style={sx('position:relative;height:230px;border-bottom:1px solid var(--line2);display:flex;align-items:flex-end;padding:0 4px')}>
                <div style={sx('position:absolute;top:0;right:0;bottom:0;left:0;background:repeating-linear-gradient(to top,transparent,transparent 45px,var(--grid) 45px,var(--grid) 46px);pointer-events:none')} />
                {faltBars.map((b, i) => (
                  <div key={i} style={sx('flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end')}>
                    <div style={sx('display:flex;align-items:flex-end;gap:3px;width:100%;justify-content:center;height:100%')}>
                      <div title="Entregado" style={{ ...sx('width:16px;background:var(--primary);border-radius:3px 3px 0 0;opacity:.9'), height: `${b.entPct}%` }} />
                      <div title="Faltante" style={{ ...sx('width:16px;background:var(--danger);border-radius:3px 3px 0 0'), height: `${b.faltPct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={sx('display:flex;padding:6px 4px 0')}>
                {faltBars.map((b, i) => (
                  <div key={i} style={sx('flex:1;text-align:center;font-family:var(--font-mono);font-size:9px;color:var(--faint);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 2px')}>{b.short}</div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
