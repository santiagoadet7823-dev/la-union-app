import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos, kgFmt, horaActual } from '../../lib/format'
import { Truck, Check, Pin } from '../../components/icons'
import { useGps } from '../../context/GpsContext'
import { useAuth } from '../../context/AuthContext'

const MOTIVO_CHIPS = ['Sin stock', 'Rechazado', 'Otro']
const ORDER = { pendiente: 0, en_camino: 1, entregado: 2 }
const hoy = () => new Date().toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()

export default function RepartidorView() {
  // Las entregas reales llegarán de los pedidos asignados (módulo de ventas, próxima etapa).
  const [deliveries, setDeliveries] = useState([])
  const [modal, setModal] = useState(null) // id
  const [step, setStep] = useState('cant')
  const [qty, setQty] = useState({})
  const [motivos, setMotivos] = useState({})
  const [hasInk, setHasInk] = useState(false)
  const [toast, setToast] = useState(null)

  // El repartidor emite su ubicación en vivo (GPS del contexto) para que el Admin lo siga.
  const { pos: livePos, error: gpsError, request: pedirGps } = useGps()
  const { perfil } = useAuth()
  const nombre = perfil?.nombre || 'Repartidor'

  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const drawing = useRef(false)
  const toastRef = useRef(null)

  useEffect(() => () => clearTimeout(toastRef.current), [])

  function showToast(msg) {
    clearTimeout(toastRef.current)
    setToast(msg)
    toastRef.current = setTimeout(() => setToast(null), 2800)
  }
  function setStatus(id, status, extra) {
    setDeliveries((ds) => ds.map((d) => (d.id === id ? { ...d, status, ...extra } : d)))
  }
  function openModal(d) {
    const q = {}
    d.items.forEach((it, i) => { q[i] = it.gen })
    setQty(q); setMotivos({}); setHasInk(false); setStep('cant'); setModal(d.id)
  }

  // --- signature pad ---
  const initCanvas = (el) => {
    canvasRef.current = el
    if (!el) { ctxRef.current = null; return }
    const w = el.offsetWidth || 340
    el.width = w * 2
    el.height = 420
    const ctx = el.getContext('2d')
    ctx.scale(2, 2)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#0B2B2A'
    ctxRef.current = ctx
    drawing.current = false
  }
  const posOf = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const down = (e) => {
    if (!ctxRef.current) return
    e.target.setPointerCapture?.(e.pointerId)
    drawing.current = true
    const [x, y] = posOf(e)
    ctxRef.current.beginPath()
    ctxRef.current.moveTo(x, y)
    if (!hasInk) setHasInk(true)
  }
  const move = (e) => {
    if (!drawing.current || !ctxRef.current) return
    const [x, y] = posOf(e)
    ctxRef.current.lineTo(x, y)
    ctxRef.current.stroke()
  }
  const up = () => { drawing.current = false }
  const clearSig = () => {
    if (canvasRef.current && ctxRef.current) ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    setHasInk(false)
  }

  // --- derivados ---
  const sorted = [...deliveries].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.tomado.localeCompare(b.tomado))
  const porEntregar = deliveries.filter((d) => d.status !== 'entregado').length
  const progressPct = deliveries.length ? Math.round(((deliveries.length - porEntregar) / deliveries.length) * 100) : 0
  const md = deliveries.find((d) => d.id === modal)

  return (
    <div className="lu-mob" style={sx('height:100%;min-height:600px;display:flex;flex-direction:column;background:var(--bg-app);font-family:Inter,system-ui,sans-serif;color:var(--text);overflow:hidden;position:relative')}>
      {/* HEADER */}
      <div style={sx('flex:none;padding:16px 16px 12px;background:var(--surface);border-bottom:1px solid var(--line)')}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between')}>
          <div style={sx('display:flex;align-items:center;gap:8px')}>
            <div style={logo}>U</div>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:14px;letter-spacing:.04em')}>LA UNIÓN</div>
          </div>
          <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--faint)')}>{nombre} · {hoy()}</div>
        </div>
        <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-top:12px')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:18px')}>Hoja de entregas</div>
          <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted)')}>
            <span style={sx('color:var(--text);font-weight:600')}>{porEntregar}</span> de {deliveries.length} por entregar
          </div>
        </div>
        <div style={sx('margin-top:10px;height:5px;border-radius:99px;background:var(--surface2);overflow:hidden;border:1px solid var(--line)')}>
          <div style={{ ...sx('height:100%;border-radius:99px;background:var(--success);transition:width .4s'), width: `${progressPct}%` }} />
        </div>

        {/* GPS en vivo — el repartidor envía su ubicación al panel aunque no vea el mapa */}
        {!livePos ? (
          <button
            onClick={() => pedirGps().catch(() => {})}
            style={sx('width:100%;margin-top:12px;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:13px;cursor:pointer')}
          >
            <Pin size={16} />
            {gpsError ? 'Reintentar — activar ubicación' : 'Activar GPS · enviar mi ubicación al panel'}
          </button>
        ) : (
          <div style={sx('margin-top:12px;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--success);font-family:var(--font-mono)')}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--success)', animation: 'lu-blink 1.6s infinite' }} />
            Enviando ubicación en vivo · {livePos.lat.toFixed(5)}, {livePos.lng.toFixed(5)}
          </div>
        )}
      </div>

      {/* LISTA */}
      <div style={sx('flex:1;overflow-y:auto;padding:12px 14px 28px')}>
        {deliveries.length === 0 && (
          <div style={sx('margin-top:20px;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:34px 20px;text-align:center')}>
            <div style={sx('width:52px;height:52px;margin:0 auto 12px;border-radius:99px;background:var(--surface2);display:grid;place-items:center')}>
              <Truck />
            </div>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:4px')}>No tenés entregas asignadas</div>
            <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>Cuando el panel te asigne pedidos vas a verlos acá. Mientras, tu ubicación se envía en vivo al panel.</div>
          </div>
        )}
        {sorted.map((d) => {
          const arts = d.items.reduce((a, it) => a + it.gen, 0)
          const pill = d.status === 'pendiente' ? ['Pendiente', 'var(--warning)', 'var(--warning-tint)', 'none']
            : d.status === 'en_camino' ? ['En camino', 'var(--info)', 'var(--info-tint)', 'lu-blink 1.6s infinite']
            : ['Entregado', 'var(--success)', 'var(--success-tint)', 'none']
          return (
            <div key={d.id} style={{ ...sx('background:var(--surface);border-radius:16px;box-shadow:var(--shadow);padding:14px;margin-bottom:10px'), border: `1px solid ${d.status === 'en_camino' ? 'var(--info)' : 'var(--line)'}` }}>
              <div style={sx('display:flex;justify-content:space-between;align-items:flex-start;gap:8px')}>
                <div style={sx('min-width:0')}>
                  <div style={sx('font-weight:600;font-size:15px')}>{d.client}</div>
                  <div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}><span style={sx('font-family:var(--font-mono)')}>{d.id}</span> · {d.loc}</div>
                </div>
                <div style={{ ...sx('flex:none;display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;font-size:11px;font-weight:600'), background: pill[2], color: pill[1] }}>
                  <span style={{ ...sx('width:6px;height:6px;border-radius:99px'), background: pill[1], animation: pill[3] }} />{pill[0]}
                </div>
              </div>
              <div style={sx('display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:8px;margin:12px 0;padding:10px 12px;background:var(--surface2);border:1px solid var(--line);border-radius:12px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                <Mini label="Artículos" value={arts} />
                <Mini label="Peso" value={`${kgFmt(d.kg)} kg`} />
                <Mini label="Monto" value={fmtPesos(d.monto)} color="var(--deep)" />
              </div>
              <div style={sx('display:flex;gap:12px;font-size:11px;color:var(--faint);font-family:var(--font-mono);font-variant-numeric:tabular-nums;margin-bottom:2px')}>
                <span>Tomado {d.tomado}</span>
                {d.entregado && <span style={sx('color:var(--success)')}>Entregado {d.entregado}</span>}
              </div>
              {d.status === 'pendiente' && (
                <button onClick={() => { setStatus(d.id, 'en_camino'); showToast(`${d.id} marcado en camino`) }} style={sx('width:100%;margin-top:10px;min-height:52px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--info-tint);border:1px solid var(--info);color:var(--info);border-radius:12px;font-weight:600;font-size:15px;cursor:pointer')}>
                  <Truck />Marcar en camino
                </button>
              )}
              {d.status === 'en_camino' && (
                <button onClick={() => openModal(d)} style={sx('width:100%;margin-top:10px;min-height:52px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:15px;cursor:pointer;border:none')}>
                  <Check color="currentColor" w={2.2} size={18} />Confirmar entrega
                </button>
              )}
              {d.status === 'entregado' && (
                <div style={sx('margin-top:10px;display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--success);background:var(--success-tint);border-radius:12px')}>
                  <div style={sx('flex:none;width:92px;height:44px;background:#F7FCFB;border:1px solid var(--line2);border-radius:8px;display:grid;place-items:center;overflow:hidden')}>
                    {d.firma ? <img src={d.firma} alt="firma" style={sx('width:100%;height:100%;object-fit:contain')} />
                      : <svg viewBox="0 0 92 44" style={sx('width:100%;height:100%')}><path d="M12 30 C20 12, 28 34, 36 22 S52 10, 58 26 S74 34, 82 18" fill="none" stroke="#0B2B2A" strokeWidth="1.6" strokeLinecap="round" /></svg>}
                  </div>
                  <div>
                    <div style={sx('font-size:12.5px;font-weight:600;color:var(--success)')}>Conformidad registrada</div>
                    <div style={sx('font-size:11px;color:var(--muted);margin-top:2px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>Firma del receptor · {d.entregado}</div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* MODAL */}
      {md && (
        <div style={sx('position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;justify-content:flex-end')}>
          <div style={sx('position:absolute;inset:0;background:var(--scrim)')} />
          <div style={sx('position:relative;background:var(--surface);border:1px solid var(--line2);border-bottom:none;border-radius:20px 20px 0 0;max-height:88%;display:flex;flex-direction:column')}>
            <div style={sx('flex:none;padding:10px 16px 12px;border-bottom:1px solid var(--line)')}>
              <div style={sx('width:36px;height:4px;border-radius:99px;background:var(--line2);margin:2px auto 12px')} />
              <div style={sx('display:flex;justify-content:space-between;align-items:center')}>
                <div>
                  <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>{step === 'cant' ? 'Verificación de cantidades' : 'Firma de conformidad'}</div>
                  <div style={sx('font-size:11.5px;color:var(--faint);font-family:var(--font-mono);margin-top:2px')}>{md.id} · {md.client}</div>
                </div>
                <div style={sx('display:flex;gap:4px;align-items:center')}>
                  <span style={sx('width:22px;height:4px;border-radius:99px;background:var(--primary)')} />
                  <span style={{ ...sx('width:22px;height:4px;border-radius:99px'), background: step === 'firma' ? 'var(--primary)' : 'var(--line2)' }} />
                </div>
              </div>
            </div>

            {step === 'cant' && (
              <>
                <div style={sx('flex:1;overflow-y:auto;padding:12px 16px')}>
                  <div style={sx('font-size:12px;color:var(--muted);margin-bottom:10px')}>Verificá lo que entregás. Si es menos que lo pedido, indicá el motivo — alimenta el <b>reporte de faltante</b>.</div>
                  {md.items.map((it, i) => {
                    const del = qty[i] ?? it.gen
                    const short = del < it.gen
                    const motivo = motivos[i] || 'Sin stock'
                    return (
                      <div key={i} style={{ ...sx('background:var(--surface);border-radius:14px;padding:12px;margin-bottom:8px'), border: `1px solid ${short ? 'var(--warning)' : 'var(--line)'}` }}>
                        <div style={sx('display:flex;align-items:center;gap:10px')}>
                          <div style={sx('flex:1;min-width:0')}>
                            <div style={sx('font-size:13px;font-weight:500')}>{it.name}</div>
                            <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono);font-variant-numeric:tabular-nums;margin-top:2px')}>Pedido: {it.gen} u.</div>
                          </div>
                          <div style={sx('display:flex;align-items:center;gap:2px')}>
                            <button onClick={() => setQty((v) => ({ ...v, [i]: Math.max(0, (v[i] ?? it.gen) - 1) }))} style={stepBtn}>−</button>
                            <div style={{ ...sx('width:38px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:16px;font-weight:600'), color: short ? 'var(--warning)' : 'var(--text)' }}>{del}</div>
                            <button onClick={() => setQty((v) => ({ ...v, [i]: Math.min(it.gen, (v[i] ?? it.gen) + 1) }))} style={stepBtn}>+</button>
                          </div>
                        </div>
                        {short && (
                          <div style={sx('margin-top:10px;padding-top:10px;border-top:1px dashed var(--line2)')}>
                            <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--warning);margin-bottom:7px')}>Faltan {it.gen - del} u. — motivo</div>
                            <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
                              {MOTIVO_CHIPS.map((label) => {
                                const on = motivo === label
                                return (
                                  <div key={label} onClick={() => setMotivos((v) => ({ ...v, [i]: label }))} style={{ ...sx('padding:8px 13px;border-radius:99px;font-size:12px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--warning)' : 'var(--line2)'}`, background: on ? 'var(--warning-tint)' : 'var(--surface)', color: on ? 'var(--warning)' : 'var(--muted)' }}>{label}</div>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div style={sx('flex:none;padding:12px 16px 24px;border-top:1px solid var(--line);display:flex;gap:8px')}>
                  <button onClick={() => setModal(null)} style={sx('flex:none;min-height:50px;padding:0 16px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-weight:600;font-size:13.5px;color:var(--muted);cursor:pointer;background:transparent')}>Cancelar</button>
                  <button onClick={() => { setStep('firma'); setHasInk(false) }} style={sx('flex:1;min-height:50px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:14.5px;cursor:pointer;border:none')}>Continuar a firma</button>
                </div>
              </>
            )}

            {step === 'firma' && (
              <>
                <div style={sx('flex:1;overflow-y:auto;padding:14px 16px')}>
                  <div style={sx('font-size:12px;color:var(--muted);margin-bottom:10px')}>Entregá el teléfono al receptor para que firme la conformidad.</div>
                  <div style={sx('position:relative;border:1px solid var(--line2);border-radius:14px;overflow:hidden;background:#F7FCFB')}>
                    <canvas ref={initCanvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} style={sx('display:block;width:100%;height:210px;touch-action:none;cursor:crosshair')} />
                    <div style={sx('position:absolute;left:24px;right:24px;bottom:42px;border-bottom:1.5px dashed #C9E0DE;pointer-events:none')} />
                    {!hasInk && <div style={sx('position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;color:#93A9A7;font-size:14px;font-weight:500')}>Firmá acá</div>}
                  </div>
                  <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:8px')}>
                    <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>{kgFmt(md.kg)} kg · {fmtPesos(md.monto)}</div>
                    <button onClick={clearSig} style={sx('min-height:38px;padding:0 14px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer;background:transparent')}>Limpiar</button>
                  </div>
                </div>
                <div style={sx('flex:none;padding:12px 16px 24px;border-top:1px solid var(--line);display:flex;gap:8px')}>
                  <button onClick={() => setStep('cant')} style={sx('flex:none;min-height:50px;padding:0 16px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-weight:600;font-size:13.5px;color:var(--muted);cursor:pointer;background:transparent')}>Atrás</button>
                  <button
                    onClick={() => {
                      if (!hasInk || !md) return
                      const firma = canvasRef.current ? canvasRef.current.toDataURL('image/png') : null
                      const faltantes = md.items.reduce((a, it, i) => a + (it.gen - (qty[i] ?? it.gen)), 0)
                      setStatus(md.id, 'entregado', { entregado: horaActual(), firma })
                      setModal(null)
                      showToast(`${md.id} entregado${faltantes > 0 ? ` · ${faltantes} u. a reporte de faltante` : ' · completo'}`)
                    }}
                    style={{ ...sx('flex:1;min-height:50px;display:grid;place-items:center;border-radius:12px;font-weight:600;font-size:14.5px;cursor:pointer;border:none'), background: hasInk ? 'var(--primary)' : 'var(--surface2)', color: hasInk ? 'var(--on-primary)' : 'var(--faint)' }}
                  >Confirmar entrega</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div style={sx('position:absolute;top:14px;left:14px;right:14px;z-index:30;background:var(--surface);border:1px solid var(--line2);border-radius:12px;box-shadow:var(--shadow-lg);padding:11px 14px;display:flex;align-items:center;gap:9px')}>
          <Check color="var(--success)" />
          <span style={sx('font-size:12.5px;font-weight:500')}>{toast}</span>
        </div>
      )}
    </div>
  )
}

const logo = { width: 26, height: 26, borderRadius: 8, background: 'var(--primary)', color: 'var(--on-primary)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }
const stepBtn = { ...sx('width:42px;height:42px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;cursor:pointer;color:var(--muted);font-size:19px;user-select:none;background:transparent') }

function Mini({ label, value, color }) {
  return (
    <div>
      <div style={sx('font-size:9.5px;color:var(--faint);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.06em')}>{label}</div>
      <div style={{ ...sx('font-size:15px;font-weight:600;margin-top:1px'), color: color || 'inherit' }}>{value}</div>
    </div>
  )
}
