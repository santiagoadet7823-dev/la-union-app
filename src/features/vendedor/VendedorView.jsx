import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { Home, Pin, Box, User, Search, Check, Route } from '../../components/icons'
import LeafletMap from '../../components/LeafletMap'
import { glassSurface } from '../../lib/glass'
import { useTheme } from '../../context/ThemeContext'
import { useDevice } from '../../context/DeviceContext'
import { useGps } from '../../context/GpsContext'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { ROUTE_COLOR, CENTRO } from '../../data/demoGeo'
import NuevoCliente from '../catalog/NuevoCliente'

const MOTIVOS = ['Stock suficiente', 'Precio / condición', 'Comercio cerrado', 'Otro']
const now = () => {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
const hoy = () => new Date().toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()

export default function VendedorView() {
  const [tab, setTab] = useState('inicio')
  const [visit, setVisit] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const [cart, setCart] = useState({})
  const [sheet, setSheet] = useState(false)
  const [motivo, setMotivo] = useState(null)
  const [search, setSearch] = useState('')
  const [routeCalc, setRouteCalc] = useState(false)
  const [gps, setGps] = useState(true)
  const [toast, setToast] = useState(null)
  const [rutaInfo, setRutaInfo] = useState(null)
  const [modalCliente, setModalCliente] = useState(false)
  const [visitState, setVisitState] = useState({}) // { [idCliente]: {status, hora, monto, motivo} }
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { pos: livePos, error: gpsError, request: pedirGps } = useGps()
  const { perfil } = useAuth()
  const { productos: PRODUCTS, clientes: cartera, loading: catLoading } = useCatalog()

  const nombre = perfil?.nombre || 'Vendedor'
  const timerRef = useRef(null)
  const toastRef = useRef(null)

  useEffect(() => () => { clearInterval(timerRef.current); clearTimeout(toastRef.current) }, [])

  function showToast(msg) {
    clearTimeout(toastRef.current)
    setToast(msg)
    toastRef.current = setTimeout(() => setToast(null), 2800)
  }
  function startVisit(id) {
    clearInterval(timerRef.current)
    setSeconds(0)
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    setVisit(id); setCart({}); setTab('catalogo')
    showToast('Check-in registrado en el comercio')
  }
  function endVisit(status, extra) {
    clearInterval(timerRef.current)
    setVisitState((v) => ({ ...v, [visit]: { status, hora: now(), ...extra } }))
    setVisit(null); setSeconds(0); setCart({}); setSheet(false); setMotivo(null); setTab('inicio')
  }
  function addCart(id, d) {
    setCart((c) => {
      const q = Math.max(0, (c[id] || 0) + d)
      const next = { ...c }
      if (q === 0) delete next[id]; else next[id] = q
      return next
    })
  }

  // --- clientes (cartera real) + estado de visita del día ---
  const clients = cartera.map((c) => ({ id: c.id, name: c.name, loc: c.loc, codigo: c.codigo, lat: c.lat, lng: c.lng, activo: c.activo, ...(visitState[c.id] || { status: 'pendiente' }) }))
  const nextId = (clients.find((c) => c.status === 'pendiente') || {}).id
  const done = clients.filter((c) => c.status !== 'pendiente').length
  const conPedido = clients.filter((c) => c.status === 'visitado')
  const montoHoy = conPedido.reduce((a, c) => a + (c.monto || 0), 0)
  const visitC = clients.find((c) => c.id === visit)

  // --- catálogo real ---
  const CATS = [...new Set(PRODUCTS.map((p) => p.cat))]
  const q = search.trim().toLowerCase()
  const groups = CATS.map((cat) => {
    const items = PRODUCTS.filter((p) => p.cat === cat && (!q || p.name.toLowerCase().includes(q)))
    return { cat, items, count: String(items.length).padStart(2, '0') }
  }).filter((g) => g.items.length)

  const prodById = (id) => PRODUCTS.find((p) => p.id === id)
  const entries = Object.entries(cart)
  const cartCount = entries.reduce((a, [, v]) => a + v, 0)
  const cartKg = entries.reduce((a, [id, v]) => a + v * (prodById(id)?.kg || 0), 0)
  const cartTotal = entries.reduce((a, [id, v]) => a + v * (prodById(id)?.price || 0), 0)
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  const pend = clients.map((c, i) => ({ c, i })).filter((x) => x.c.status === 'pendiente')
  const pendingCoords = pend.map((x) => x.c).filter((c) => c.lat != null).map((c) => ({ lat: c.lat, lng: c.lng }))
  const meta = Math.min(100, Math.round((montoHoy / 900000) * 100))
  const efect = done ? Math.round((conPedido.length / done) * 100) : 0

  const navItem = (t) => (tab === t ? 'var(--primary)' : 'var(--faint)')

  return (
    <div className="lu-mob" style={{ ...sx('min-height:600px;display:flex;flex-direction:column;background:var(--bg-app);font-family:Inter,system-ui,sans-serif;color:var(--text);overflow:hidden;position:relative;padding-top:calc(12px + env(safe-area-inset-top));box-sizing:border-box'), height: isMobile ? '100dvh' : '100%' }}>

      {/* ===== INICIO ===== */}
      {tab === 'inicio' && (
        <div style={sx('flex:1;overflow-y:auto;padding:14px 14px 92px')}>
          <div style={sx('display:flex;align-items:center;justify-content:space-between;margin:2px 2px 14px')}>
            <div style={sx('display:flex;align-items:center;gap:8px')}>
              <div style={logo}>U</div>
              <div style={sx("font-family:var(--font-display);font-weight:600;font-size:14px;letter-spacing:.04em")}>LA UNIÓN</div>
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
          </div>

          <div style={sx('display:flex;justify-content:space-between;align-items:center;margin:0 2px 10px')}>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Mis clientes</div>
            <button onClick={() => setModalCliente(true)} style={sx('display:flex;align-items:center;gap:5px;background:var(--primary-tint);border:1px solid var(--primary);color:var(--deep);border-radius:10px;padding:6px 11px;font-size:12px;font-weight:600;cursor:pointer')}>
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
                  {c.status === 'pendiente' ? (
                    <button onClick={() => startVisit(c.id)} style={sx('flex:none;min-height:44px;padding:0 16px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:13px;cursor:pointer;border:none')}>Check-in</button>
                  ) : (
                    <div style={{ ...sx('flex:none;display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;font-size:11px;font-weight:600'), background: pill[2], color: pill[1] }}>
                      <span style={{ ...sx('width:6px;height:6px;border-radius:99px'), background: pill[1] }} />{pill[0]}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ===== CATÁLOGO / VISITA ===== */}
      {tab === 'catalogo' && (
        <div style={sx('flex:1;display:flex;flex-direction:column;overflow:hidden')}>
          {visitC ? (
            <div style={sx('flex:none;background:var(--surface);border-bottom:1px solid var(--line);padding:12px 14px')}>
              <div style={sx('display:flex;justify-content:space-between;align-items:center')}>
                <div style={sx('display:flex;align-items:center;gap:7px;font-size:10.5px;font-weight:600;letter-spacing:.08em;color:var(--primary)')}>
                  <span style={sx('width:7px;height:7px;border-radius:99px;background:var(--primary);animation:lu-blink 1.4s infinite')} />VISITA EN CURSO
                </div>
                <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:600;color:var(--text)')}>{timer}</div>
              </div>
              <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:6px')}>
                <div>
                  <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>{visitC.name}</div>
                  <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>{visitC.codigo || ''} · {visitC.loc || ''}</div>
                </div>
                <div style={sx('display:flex;gap:6px')}>
                  <button onClick={() => setSheet(true)} style={sx('min-height:38px;padding:0 12px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-size:12px;font-weight:600;color:var(--warning);cursor:pointer;background:transparent')}>Sin pedido</button>
                  <button onClick={() => { clearInterval(timerRef.current); setVisit(null); setSeconds(0); setCart({}); setTab('inicio') }} style={sx('min-height:38px;padding:0 12px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;background:transparent')}>Cancelar</button>
                </div>
              </div>
            </div>
          ) : (
            <div style={sx('flex:none;margin:12px 14px 0;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--info-tint);color:var(--muted);font-size:12px;display:flex;gap:8px;align-items:center')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
              Modo consulta — hacé check-in en un cliente para tomar un pedido.
            </div>
          )}

          <div style={sx('flex:none;padding:12px 14px 8px')}>
            <div style={sx('display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:0 12px;height:44px')}>
              <Search />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" style={sx('flex:1;border:none;outline:none;background:transparent;font-family:Inter,sans-serif;font-size:13.5px;color:var(--text)')} />
            </div>
          </div>

          <div style={sx('flex:1;overflow-y:auto;padding:0 14px 180px')}>
            {PRODUCTS.length === 0 ? (
              <div style={{ ...card, textAlign: 'center', padding: '34px 18px', marginTop: 12 }}>
                <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:4px')}>El catálogo está vacío</div>
                <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>El administrador todavía no cargó los productos. En cuanto los cargue, vas a poder armar pedidos.</div>
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.cat}>
                  <div style={sx('display:flex;align-items:center;gap:8px;margin:14px 2px 8px')}>
                    <span style={sx('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--deep)')}>{g.cat}</span>
                    <span style={sx('flex:1;height:1px;background:var(--line)')} />
                    <span style={sx('font-family:var(--font-mono);font-size:10px;color:var(--faint)')}>{g.count}</span>
                  </div>
                  {g.items.map((p) => {
                    const qty = cart[p.id] || 0
                    return (
                      <div key={p.id} style={{ ...sx('display:flex;align-items:center;gap:10px;background:var(--surface);border-radius:14px;padding:10px 12px;margin-bottom:7px'), border: `1px solid ${qty > 0 ? 'var(--primary)' : 'var(--line)'}` }}>
                        <div style={sx('flex:1;min-width:0')}>
                          <div style={sx('font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{p.name}</div>
                          <div style={sx('font-size:11px;color:var(--faint);margin-top:2px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                            <span style={sx('color:var(--deep);font-weight:600')}>{fmtPesos(p.price)}</span> · {String(p.kg).replace('.', ',')} kg
                          </div>
                        </div>
                        <div style={sx('display:flex;align-items:center;gap:2px')}>
                          <button onClick={() => addCart(p.id, -1)} style={sx('width:38px;height:38px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;cursor:pointer;color:var(--muted);font-size:18px;user-select:none;background:transparent')}>−</button>
                          <div style={{ ...sx('width:34px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14px;font-weight:600'), color: qty > 0 ? 'var(--deep)' : 'var(--faint)' }}>{qty}</div>
                          <button onClick={() => addCart(p.id, 1)} style={sx('width:38px;height:38px;display:grid;place-items:center;background:var(--primary-tint);border:1px solid var(--primary);border-radius:10px;cursor:pointer;color:var(--deep);font-size:17px;user-select:none')}>+</button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {cartCount > 0 && (
            <div style={sx('position:absolute;left:12px;right:12px;bottom:80px;background:var(--surface);border:1px solid var(--line2);border-radius:16px;box-shadow:var(--shadow-lg);padding:12px 14px;z-index:5')}>
              <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                <div style={sx('font-size:12px;color:var(--muted)')}>{cartCount} ítems · {cartKg.toFixed(1).replace('.', ',')} kg</div>
                <div style={sx('font-size:18px;font-weight:600;color:var(--text)')}>{fmtPesos(cartTotal)}</div>
              </div>
              {visitC ? (
                <button
                  onClick={() => { const total = cartTotal; endVisit('visitado', { monto: total }); showToast(`Pedido confirmado · ${fmtPesos(total)}`) }}
                  style={sx('width:100%;min-height:48px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:14px;cursor:pointer;border:none')}
                >Confirmar pedido y finalizar visita</button>
              ) : (
                <div style={sx('min-height:48px;display:grid;place-items:center;background:var(--surface2);color:var(--faint);border:1px solid var(--line);border-radius:12px;font-weight:600;font-size:13px')}>Hacé check-in para confirmar el pedido</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== RUTA ===== */}
      {tab === 'ruta' && (
        <div style={sx('flex:1;overflow-y:auto;padding:14px 14px 92px')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px;margin:2px 2px 10px')}>Mapa de ruta</div>
          <LeafletMap
            theme={theme}
            height={330}
            center={livePos || CENTRO}
            markers={clients
              .filter((c) => c.lat != null)
              .map((c, i) => {
                const esProxima = c.id === nextId
                return {
                  lat: c.lat, lng: c.lng, label: String(i + 1).padStart(2, '0'), title: c.name,
                  color: esProxima ? (theme === 'dark' ? '#2DD4CE' : '#0ABAB5') : c.status === 'visitado' ? (theme === 'dark' ? '#34D399' : '#10B981') : c.status === 'sin_pedido' ? (theme === 'dark' ? '#FBBF24' : '#F59E0B') : (theme === 'dark' ? '#5C7370' : '#93A9A7'),
                  labelColor: '#fff', selected: esProxima,
                }
              })}
            live={livePos}
            route={routeCalc ? pendingCoords : null}
            routeColor={ROUTE_COLOR[theme] || ROUTE_COLOR.dark}
            optimize
            roundtrip={false}
            onRouteInfo={setRutaInfo}
          />
          {/* Estado real del GPS del dispositivo */}
          <div style={sx('display:flex;align-items:center;gap:8px;margin-top:8px;font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>
            <span style={{ width: 7, height: 7, borderRadius: 99, display: 'inline-block', background: livePos ? 'var(--success)' : gpsError ? 'var(--danger)' : 'var(--faint)', animation: livePos ? 'lu-blink 1.6s infinite' : 'none' }} />
            {livePos
              ? `GPS en vivo · ${livePos.lat.toFixed(5)}, ${livePos.lng.toFixed(5)}`
              : gpsError
                ? 'GPS sin permiso — activá la ubicación del navegador'
                : 'Buscando señal GPS…'}
          </div>
          {routeCalc && !rutaInfo?.error && (
            <div style={sx('display:flex;gap:6px;margin-top:8px;flex-wrap:wrap')}>
              {[rutaInfo && rutaInfo.distancia != null ? `${(rutaInfo.distancia / 1000).toFixed(1).replace('.', ',')} km` : 'calculando…', rutaInfo && rutaInfo.duracion != null ? `~${Math.round(rutaInfo.duracion / 60)} min` : '—', `${pend.length} paradas · orden óptimo`].map((t) => (
                <div key={t} style={sx('background:var(--surface);border:1px solid var(--line2);border-radius:10px;padding:6px 10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--text)')}>{t}</div>
              ))}
            </div>
          )}
          {routeCalc && rutaInfo?.error && (
            <div style={sx('margin-top:8px;font-size:11.5px;color:var(--warning);background:var(--warning-tint);border:1px solid var(--warning);border-radius:10px;padding:8px 10px;line-height:1.4')}>
              Sin conexión para calcular la ruta por calles ahora. Se muestra la línea directa entre paradas. Reintentá cuando tengas señal.
            </div>
          )}
          {pendingCoords.length >= 1 && (
            <>
              <button onClick={() => setRouteCalc((v) => !v)} style={{ ...sx('width:100%;margin-top:12px;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line2);border-radius:12px;font-weight:600;font-size:14px;cursor:pointer'), background: routeCalc ? 'var(--surface)' : 'var(--primary)', color: routeCalc ? 'var(--deep)' : 'var(--on-primary)' }}>
                <Route />{routeCalc ? 'Ruta calculada — recalcular' : 'Calcular ruta óptima'}
              </button>
              <div style={sx('margin-top:6px;font-size:11px;color:var(--faint);line-height:1.5')}>
                Ordena tus <b>paradas pendientes</b> por el camino más corto siguiendo las calles (desde tu ubicación actual). No incluye las visitas ya hechas.
              </div>
            </>
          )}
          <div style={sx('margin-top:14px')}>
            <div style={sx('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:0 2px 8px')}>Paradas pendientes</div>
            {pend.length === 0 && <div style={sx('font-size:12px;color:var(--faint);padding:8px 2px')}>No hay paradas pendientes.</div>}
            {pend.map((x) => (
              <div key={x.c.id} style={sx('display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:6px')}>
                <span style={{ ...sx('width:22px;height:22px;border-radius:8px;display:grid;place-items:center;font-family:var(--font-mono);font-size:10px;font-weight:600'), background: x.c.id === nextId ? 'var(--primary)' : 'var(--surface2)', color: x.c.id === nextId ? 'var(--on-primary)' : 'var(--muted)' }}>{String(x.i + 1).padStart(2, '0')}</span>
                <span style={sx('flex:1;font-size:12.5px;font-weight:500')}>{x.c.name}</span>
                <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>{x.c.loc || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ===== PERFIL ===== */}
      {tab === 'perfil' && (
        <div style={sx('flex:1;overflow-y:auto;padding:14px 14px 92px')}>
          <div style={sx('display:flex;align-items:center;gap:12px;margin:4px 2px 16px')}>
            <div style={sx('width:44px;height:44px;border-radius:14px;background:var(--tlight);color:var(--deep);display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:16px')}>{nombre.slice(0, 2).toUpperCase()}</div>
            <div>
              <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>{nombre}</div>
              <div style={sx('font-size:11.5px;color:var(--faint);font-family:var(--font-mono)')}>Vendedor · LA UNIÓN</div>
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
          <button onClick={() => showToast('Jornada cerrada · resumen enviado al panel')} style={sx('width:100%;min-height:48px;display:grid;place-items:center;border:1px solid var(--danger);color:var(--danger);background:var(--danger-tint);border-radius:12px;font-weight:600;font-size:13.5px;cursor:pointer')}>Cerrar jornada</button>
        </div>
      )}

      {/* ===== BOTTOM SHEET · SIN PEDIDO ===== */}
      {sheet && (
        <div style={sx('position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;justify-content:flex-end')}>
          <div onClick={() => { setSheet(false); setMotivo(null) }} style={sx('position:absolute;inset:0;background:var(--scrim)')} />
          <div style={sx('position:relative;background:var(--surface);border:1px solid var(--line2);border-bottom:none;border-radius:20px 20px 0 0;padding:10px 16px 24px')}>
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
      )}

      {/* ===== TOAST ===== */}
      {toast && (
        <div style={sx('position:absolute;top:14px;left:14px;right:14px;z-index:30;background:var(--surface);border:1px solid var(--line2);border-radius:12px;box-shadow:var(--shadow-lg);padding:11px 14px;display:flex;align-items:center;gap:9px')}>
          <Check color="var(--success)" />
          <span style={sx('font-size:12.5px;font-weight:500')}>{toast}</span>
        </div>
      )}

      {modalCliente && <NuevoCliente onClose={() => setModalCliente(false)} onToast={showToast} center={livePos} />}

      {/* ===== BOTTOM NAV (glass + safe-area) ===== */}
      <div style={{ ...sx('flex:none;position:absolute;bottom:0;left:0;right:0;display:grid;grid-template-columns:repeat(4,1fr);z-index:10'), ...glassSurface(theme === 'dark'), padding: '6px 8px calc(10px + env(safe-area-inset-bottom))' }}>
        {[['inicio', 'Inicio', Home], ['ruta', 'Ruta', Pin], ['catalogo', 'Catálogo', Box], ['perfil', 'Perfil', User]].map(([t, label, Icon]) => (
          <div key={t} onClick={() => setTab(t)} style={{ ...sx('display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 0;cursor:pointer'), color: navItem(t) }}>
            <Icon />
            <span style={sx('font-size:10px;font-weight:600')}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

const logo = { width: 26, height: 26, borderRadius: 8, background: 'var(--primary)', color: 'var(--on-primary)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }
const card = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:14px;margin-bottom:16px') }

function Stat({ label, value, color }) {
  return (
    <div>
      <div style={sx('font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:.06em')}>{label}</div>
      <div style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:18px;font-weight:600'), color: color || 'inherit' }}>{value}</div>
    </div>
  )
}
