import { sx } from '../../../lib/sx'
import { fmtPesos } from '../../../lib/format'
import { Pin } from '../../../components/icons'
import Logo from '../../../components/Logo'
import { useGps } from '../../../context/GpsContext'
import { useAuth } from '../../../context/AuthContext'
import { card, Stat } from '../ui'

const hoy = () => new Date().toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()

/** Pestaña "Inicio": activación de GPS, resumen del día y lista de clientes con check-in. */
export default function InicioTab({ j, onNuevoCliente, onEditarCliente }) {
  const { pos: livePos, error: gpsError, request: pedirGps } = useGps()
  const { perfil, user } = useAuth()
  const nombre = perfil?.nombre || 'Vendedor'
  const { clients, done, conPedido, montoHoy, meta, efect, nextId, startVisit, catLoading } = j

  return (
    <div style={sx('flex:1;overflow-y:auto;padding:14px 14px 92px')}>
      <div style={sx('display:flex;align-items:center;justify-content:space-between;margin:2px 2px 14px')}>
        <div style={sx('display:flex;align-items:center;gap:8px')}>
          <Logo size={26} radius={8} />
          <div style={sx("font-family:var(--font-display);font-weight:600;font-size:14px;letter-spacing:.04em")}>DisT-At</div>
        </div>
        <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--faint)')}>{hoy()}</div>
      </div>

      {/* Activación de GPS — en móvil el permiso se pide con un toque del usuario */}
      {!livePos ? (
        <button
          onClick={() => pedirGps().catch(() => {})}
          style={sx('width:100%;margin-bottom:6px;min-height:52px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border:none;border-radius:14px;font-weight:600;font-size:14px;cursor:pointer')}
        >
          <Pin size={18} />
          {gpsError ? 'Reintentar — activar ubicación' : 'Activar GPS en vivo · compartir ubicación'}
        </button>
      ) : (
        <div style={sx('width:100%;margin-bottom:14px;display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:var(--success-tint);border:1px solid var(--success);color:var(--success);font-size:12px;font-weight:500')}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--success)', animation: 'lu-blink 1.4s infinite' }} />
          GPS activo · el panel ve tu ubicación en vivo
        </div>
      )}
      {gpsError && !livePos && (
        <div style={sx('margin:2px 0 14px;font-size:11px;color:var(--danger)')}>
          Permiso de ubicación denegado. Habilitalo en los ajustes del navegador/app y tocá de nuevo.
        </div>
      )}

      <div style={card}>
        <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px')}>
          <div style={sx('font-size:12px;color:var(--muted);font-weight:500')}>Resumen del día · {nombre}</div>
        </div>
        <div style={sx('display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:8px')}>
          <Stat label="Paradas" value={<>{done}<span style={sx('color:var(--faint);font-size:13px')}>/{clients.length}</span></>} />
          <Stat label="Pedidos" value={conPedido.length} />
          <Stat label="Monto" value={fmtPesos(montoHoy)} color="var(--deep)" />
        </div>
        {clients.length > 0 && (
          <div style={sx('margin-top:12px;height:5px;border-radius:99px;background:var(--surface2);overflow:hidden;border:1px solid var(--line)')}>
            <div style={{ ...sx('height:100%;border-radius:99px;background:var(--primary);transition:width .4s'), width: `${Math.round((done / clients.length) * 100)}%` }} />
          </div>
        )}

        {/* Meta diaria + efectividad (venían del dashboard de la vieja pestaña Perfil). */}
        <div style={sx('display:grid;grid-template-columns:1.5fr 1fr;gap:12px;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)')}>
          <div>
            <div style={sx('display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:var(--muted);margin-bottom:6px')}><span>Meta diaria</span><span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--deep);font-weight:600')}>{meta}%</span></div>
            <div style={sx('height:6px;border-radius:99px;background:var(--surface2);overflow:hidden;border:1px solid var(--line)')}>
              <div style={{ ...sx('height:100%;border-radius:99px;background:var(--primary);transition:width .4s'), width: `${Math.min(100, meta)}%` }} />
            </div>
            <div style={sx('font-size:9.5px;color:var(--faint);font-family:var(--font-mono);margin-top:4px')}>de $ 900.000</div>
          </div>
          <div>
            <div style={sx('font-size:11px;color:var(--muted);margin-bottom:4px')}>Efectividad</div>
            <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;color:var(--success)')}>{efect}%</div>
          </div>
        </div>
      </div>

      <div style={sx('display:flex;justify-content:space-between;align-items:center;margin:0 2px 10px')}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Mis clientes</div>
        <button onClick={onNuevoCliente} style={sx('display:flex;align-items:center;gap:5px;background:var(--primary-tint);border:1px solid var(--primary);color:var(--deep);border-radius:10px;padding:6px 11px;font-size:12px;font-weight:600;cursor:pointer')}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo
        </button>
      </div>

      {catLoading ? (
        <div style={sx('padding:30px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando clientes…</div>
      ) : clients.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '30px 18px' }}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:4px')}>Todavía no tenés clientes</div>
          <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>Agregá tu primer comercio con el botón <b>Nuevo</b>. Se marca en el mapa con tu ubicación actual.</div>
        </div>
      ) : (
        clients.map((c, i) => {
          const isNext = c.id === nextId
          const pill = c.status === 'visitado' ? ['Visitado', 'var(--success)', 'var(--success-tint)']
            : c.status === 'sin_pedido' ? ['Sin pedido', 'var(--warning)', 'var(--warning-tint)']
              : ['Pendiente', 'var(--faint)', 'var(--surface2)']
          const nBg = c.status === 'visitado' ? 'var(--success-tint)' : c.status === 'sin_pedido' ? 'var(--warning-tint)' : isNext ? 'var(--primary-tint)' : 'var(--surface2)'
          const nColor = c.status === 'visitado' ? 'var(--success)' : c.status === 'sin_pedido' ? 'var(--warning)' : isNext ? 'var(--deep)' : 'var(--faint)'
          const subColor = c.status === 'visitado' ? 'var(--success)' : c.status === 'sin_pedido' ? 'var(--warning)' : isNext ? 'var(--deep)' : 'var(--faint)'
          const sub = c.status === 'visitado' ? `${c.hora} · ${fmtPesos(c.monto)}` : c.status === 'sin_pedido' ? `${c.hora} · ${c.motivo || ''}` : isNext ? 'Próxima parada' : 'Pendiente'
          return (
            <div key={c.id} style={{ ...sx('display:flex;gap:10px;align-items:center;background:var(--surface);border-radius:16px;padding:12px;margin-bottom:8px;box-shadow:var(--shadow)'), border: `1px solid ${isNext ? 'var(--primary)' : 'var(--line)'}` }}>
              <div style={{ ...sx('width:30px;height:30px;flex:none;border-radius:10px;display:grid;place-items:center;font-family:var(--font-mono);font-size:12px;font-weight:600'), background: nBg, color: nColor }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={sx('flex:1;min-width:0')}>
                <div style={sx('display:flex;align-items:center;gap:6px')}>
                  <div style={sx('font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</div>
                  {!c.activo && <span style={sx('flex:none;font-size:9px;font-weight:700;color:var(--warning);background:var(--warning-tint);border-radius:99px;padding:2px 6px')}>A CONFIRMAR</span>}
                </div>
                <div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>{c.loc || '—'} · <span style={sx('font-family:var(--font-mono)')}>{c.codigo || c.id.slice(0, 6)}</span></div>
                <div style={{ ...sx('font-size:11px;margin-top:3px;font-family:var(--font-mono);font-variant-numeric:tabular-nums'), color: subColor }}>{sub}</div>
              </div>
              <div style={sx('flex:none;display:flex;align-items:center;gap:6px')}>
                {c.idVendedor === user?.id && (
                  <button onClick={(e) => { e.stopPropagation(); onEditarCliente?.(c.id) }} title="Editar ubicación y días de visita" style={sx('flex:none;width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);cursor:pointer')}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                  </button>
                )}
                {c.status === 'pendiente' ? (
                  <button onClick={() => startVisit(c.id)} style={sx('flex:none;min-height:44px;padding:0 16px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:13px;cursor:pointer;border:none')}>Check-in</button>
                ) : (
                  <div style={{ ...sx('flex:none;display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;font-size:11px;font-weight:600'), background: pill[2], color: pill[1] }}>
                    <span style={{ ...sx('width:6px;height:6px;border-radius:99px'), background: pill[1] }} />{pill[0]}
                  </div>
                )}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
