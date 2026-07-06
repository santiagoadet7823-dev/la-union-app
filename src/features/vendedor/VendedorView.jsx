import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { Home, Pin, Box, User, Search, Check, Route } from '../../components/icons'
import LeafletMap from '../../components/LeafletMap'
import { useTheme } from '../../context/ThemeContext'
import { useLivePosition } from '../../hooks/useLivePosition'
import { publicarPosicion } from '../../services/telemetry'
import { CLIENTES_GEO, statusColor, ROUTE_COLOR } from '../../data/demoGeo'

// Coordenadas por id de cliente (mismo dataset que usa el Admin) para el mapa real.
const GEO = Object.fromEntries(CLIENTES_GEO.map((c) => [c.id, c]))

const PRODUCTS = [
  { id: 'P-1042', cat: 'Bebidas', name: 'Gaseosa Cola 2.25 L ×6', price: 14800, kg: 13.5 },
  { id: 'P-1055', cat: 'Bebidas', name: 'Agua Mineral 2 L ×6', price: 6900, kg: 12 },
  { id: 'P-1061', cat: 'Bebidas', name: 'Cerveza Rubia 1 L ×12', price: 21600, kg: 18 },
  { id: 'P-1078', cat: 'Bebidas', name: 'Jugo Naranja 1 L ×8', price: 9400, kg: 8 },
  { id: 'P-2010', cat: 'Almacén', name: 'Yerba Mate 1 kg ×10', price: 38500, kg: 10 },
  { id: 'P-2024', cat: 'Almacén', name: 'Aceite Girasol 1.5 L ×12', price: 32400, kg: 16.6 },
  { id: 'P-2031', cat: 'Almacén', name: 'Harina 000 1 kg ×10', price: 7800, kg: 10 },
  { id: 'P-2047', cat: 'Almacén', name: 'Arroz Largo Fino 1 kg ×10', price: 13200, kg: 10 },
  { id: 'P-2052', cat: 'Almacén', name: 'Azúcar 1 kg ×10', price: 10900, kg: 10 },
  { id: 'P-2066', cat: 'Almacén', name: 'Fideos Guiseros 500 g ×20', price: 12600, kg: 10 },
  { id: 'P-3005', cat: 'Galletitas y snacks', name: 'Galletitas Surtidas 400 g ×12', price: 16300, kg: 4.8 },
  { id: 'P-3012', cat: 'Galletitas y snacks', name: 'Papas Fritas 145 g ×15', price: 19500, kg: 2.2 },
  { id: 'P-3020', cat: 'Galletitas y snacks', name: 'Alfajor Triple ×24', price: 14400, kg: 1.9 },
  { id: 'P-4008', cat: 'Limpieza', name: 'Lavandina 2 L ×6', price: 7200, kg: 12.6 },
  { id: 'P-4015', cat: 'Limpieza', name: 'Detergente 750 ml ×12', price: 15800, kg: 9 },
  { id: 'P-4022', cat: 'Limpieza', name: 'Rollo de Cocina ×12', price: 11900, kg: 3.1 },
]

const CLIENTS_INIT = [
  { id: 'CLI-001', name: 'Kiosco EBEN-EZER', loc: 'Las Lajitas', status: 'visitado', monto: 186400, hora: '08:42' },
  { id: 'CLI-002', name: 'Kiosco Los 2 Gauchos', loc: 'Las Lajitas', status: 'visitado', monto: 341850, hora: '09:15' },
  { id: 'CLI-003', name: 'Kiosco catalina', loc: 'Las Lajitas', status: 'sin_pedido', motivo: 'Stock suficiente', hora: '09:40' },
  { id: 'CLI-004', name: 'Kiosco tenefe', loc: 'Las Lajitas', status: 'pendiente', dist: '600 m' },
]

const MOTIVOS = ['Stock suficiente', 'Precio / condición', 'Comercio cerrado', 'Otro']
const PIN_XY = [[14, 16], [42, 14], [76, 18], [18, 42], [48, 40], [80, 44], [30, 68], [68, 70]]

const CATS = [...new Set(PRODUCTS.map((p) => p.cat))]
const now = () => {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

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
  const [clients, setClients] = useState(CLIENTS_INIT)
  const { theme } = useTheme()
  const { pos: livePos, error: gpsError } = useLivePosition(gps)

  const timerRef = useRef(null)
  const toastRef = useRef(null)

  useEffect(() => () => { clearInterval(timerRef.current); clearTimeout(toastRef.current) }, [])

  // Publica la posición real a la telemetría en vivo (la ve el Admin en su mapa).
  useEffect(() => {
    if (livePos) publicarPosicion({ id: 'VEND-07', nombre: 'Martín Ríos', lat: livePos.lat, lng: livePos.lng, ts: Date.now() })
  }, [livePos])

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
    showToast('Geofence OK · check-in a 23 m del comercio')
  }
  function endVisit(status, extra) {
    clearInterval(timerRef.current)
    setClients((cs) => cs.map((c) => (c.id === visit ? { ...c, status, hora: now(), ...extra } : c)))
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

  // --- derivados ---
  const nextId = (clients.find((c) => c.status === 'pendiente') || {}).id
  const done = clients.filter((c) => c.status !== 'pendiente').length
  const conPedido = clients.filter((c) => c.status === 'visitado')
  const montoHoy = conPedido.reduce((a, c) => a + (c.monto || 0), 0)
  const visitC = clients.find((c) => c.id === visit)

  const q = search.trim().toLowerCase()
  const groups = CATS.map((cat) => {
    const items = PRODUCTS.filter((p) => p.cat === cat && (!q || p.name.toLowerCase().includes(q)))
    return { cat, items, count: String(items.length).padStart(2, '0') }
  }).filter((g) => g.items.length)

  const entries = Object.entries(cart)
  const cartCount = entries.reduce((a, [, v]) => a + v, 0)
  const cartKg = entries.reduce((a, [id, v]) => a + v * PRODUCTS.find((p) => p.id === id).kg, 0)
  const cartTotal = entries.reduce((a, [id, v]) => a + v * PRODUCTS.find((p) => p.id === id).price, 0)
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  const pend = clients.map((c, i) => ({ c, i })).filter((x) => x.c.status === 'pendiente')
  const LIVE = { lat: -24.72155, lng: -64.19560 }
  const pendingCoords = pend.map((x) => GEO[x.c.id]).filter(Boolean).map((g) => ({ lat: g.lat, lng: g.lng }))
  const meta = Math.min(100, Math.round((montoHoy / 900000) * 100))
  const efect = done ? Math.round((conPedido.length / done) * 100) : 0

  const pinFor = (c, i) => ({
    n: String(i + 1).padStart(2, '0'), name: c.name, dist: c.dist || c.hora || '', x: PIN_XY[i][0], y: PIN_XY[i][1],
    bg: c.status === 'visitado' ? 'var(--success)' : c.status === 'sin_pedido' ? 'var(--warning)' : c.id === nextId ? 'var(--primary)' : 'var(--surface2)',
    fg: c.status === 'pendiente' && c.id !== nextId ? 'var(--muted)' : c.id === nextId ? 'var(--on-primary)' : '#fff',
  })

  const navItem = (t) => (tab === t ? 'var(--primary)' : 'var(--faint)')

  return (
    <div className="lu-mob" style={sx('height:100%;min-height:600px;display:flex;flex-direction:column;background:var(--bg-app);font-family:Inter,system-ui,sans-serif;color:var(--text);overflow:hidden;position:relative;padding-top:12px;box-sizing:border-box')}>

      {/* ===== INICIO ===== */}
      {tab === 'inicio' && (
        <div style={sx('flex:1;overflow-y:auto;padding:14px 14px 92px')}>
          <div style={sx('display:flex;align-items:center;justify-content:space-between;margin:2px 2px 14px')}>
            <div style={sx('display:flex;align-items:center;gap:8px')}>
              <div style={logo}>U</div>
              <div style={sx("font-family:var(--font-display);font-weight:600;font-size:14px;letter-spacing:.04em")}>LA UNIÓN</div>
            </div>
            <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--faint)')}>MAR 07 JUL</div>
          </div>

          <div style={card}>
            <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px')}>
              <div style={sx('font-size:12px;color:var(--muted);font-weight:500')}>Resumen del día · Martín Ríos</div>
              <div style={sx('display:flex;align-items:center;gap:5px;font-size:11px;color:var(--success)')}>
                <span style={sx('width:6px;height:6px;border-radius:99px;background:var(--success);display:inline-block;animation:lu-blink 2s infinite')} />GPS activo
              </div>
            </div>
            <div style={sx('display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:8px')}>
              <Stat label="Paradas" value={<>{done}<span style={sx('color:var(--faint);font-size:13px')}>/{clients.length}</span></>} />
              <Stat label="Pedidos" value={conPedido.length} />
              <Stat label="Monto" value={fmtPesos(montoHoy)} color="var(--deep)" />
            </div>
            <div style={sx('margin-top:12px;height:5px;border-radius:99px;background:var(--surface2);overflow:hidden;border:1px solid var(--line)')}>
              <div style={{ ...sx('height:100%;border-radius:99px;background:var(--primary);transition:width .4s'), width: `${Math.round((done / clients.length) * 100)}%` }} />
            </div>
          </div>

          <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin:0 2px 10px')}>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Hoja de ruta</div>
            <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--faint)')}>RUTA-N-042</div>
          </div>

          {clients.map((c, i) => {
            const isNext = c.id === nextId
            const pill = c.status === 'visitado' ? ['Visitado', 'var(--success)', 'var(--success-tint)']
              : c.status === 'sin_pedido' ? ['Sin pedido', 'var(--warning)', 'var(--warning-tint)']
              : ['Pendiente', 'var(--faint)', 'var(--surface2)']
            const nBg = c.status === 'visitado' ? 'var(--success-tint)' : c.status === 'sin_pedido' ? 'var(--warning-tint)' : isNext ? 'var(--primary-tint)' : 'var(--surface2)'
            const nColor = c.status === 'visitado' ? 'var(--success)' : c.status === 'sin_pedido' ? 'var(--warning)' : isNext ? 'var(--deep)' : 'var(--faint)'
            const subColor = c.status === 'visitado' ? 'var(--success)' : c.status === 'sin_pedido' ? 'var(--warning)' : isNext ? 'var(--deep)' : 'var(--faint)'
            const sub = c.status === 'visitado' ? `${c.hora} · ${fmtPesos(c.monto)}` : c.status === 'sin_pedido' ? `${c.hora} · ${c.motivo || ''}` : isNext ? `Próxima parada · a ${c.dist || '—'}` : `a ${c.dist || '—'}`
            return (
              <div key={c.id} style={{ ...sx('display:flex;gap:10px;align-items:center;background:var(--surface);border-radius:16px;padding:12px;margin-bottom:8px;box-shadow:var(--shadow)'), border: `1px solid ${isNext ? 'var(--primary)' : 'var(--line)'}` }}>
                <div style={{ ...sx('width:30px;height:30px;flex:none;border-radius:10px;display:grid;place-items:center;font-family:var(--font-mono);font-size:12px;font-weight:600'), background: nBg, color: nColor }}>{String(i + 1).padStart(2, '0')}</div>
                <div style={sx('flex:1;min-width:0')}>
                  <div style={sx('font-weight:600;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</div>
                  <div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}>{c.loc} · <span style={sx('font-family:var(--font-mono)')}>{c.id}</span></div>
                  <div style={{ ...sx('font-size:11px;margin-top:3px;font-family:var(--font-mono);font-variant-numeric:tabular-nums'), color: subColor }}>{sub}</div>
                </div>
                {isNext ? (
                  <button onClick={() => startVisit(c.id)} style={sx('flex:none;min-height:44px;padding:0 16px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:13px;cursor:pointer;border:none')}>Check-in</button>
                ) : (
                  <div style={{ ...sx('flex:none;display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;font-size:11px;font-weight:600'), background: pill[2], color: pill[1] }}>
                    <span style={{ ...sx('width:6px;height:6px;border-radius:99px'), background: pill[1] }} />{pill[0]}
                  </div>
                )}
              </div>
            )
          })}
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
                  <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>{visitC.id} · {visitC.loc}</div>
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
              Modo consulta — hacé check-in en una parada para tomar un pedido.
            </div>
          )}

          <div style={sx('flex:none;padding:12px 14px 8px')}>
            <div style={sx('display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:0 12px;height:44px')}>
              <Search />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" style={sx('flex:1;border:none;outline:none;background:transparent;font-family:Inter,sans-serif;font-size:13.5px;color:var(--text)')} />
            </div>
          </div>

          <div style={sx('flex:1;overflow-y:auto;padding:0 14px 180px')}>
            {groups.map((g) => (
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
            ))}
          </div>

          {cartCount > 0 && (
            <div style={sx('position:absolute;left:12px;right:12px;bottom:80px;background:var(--surface);border:1px solid var(--line2);border-radius:16px;box-shadow:var(--shadow-lg);padding:12px 14px;z-index:5')}>
              <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                <div style={sx('font-size:12px;color:var(--muted)')}>{cartCount} ítems · {cartKg.toFixed(1).replace('.', ',')} kg</div>
                <div style={sx('font-size:18px;font-weight:600;color:var(--text)')}>{fmtPesos(cartTotal)}</div>
              </div>
              {visitC ? (
                <button
                  onClick={() => { const n = 'PED-' + (2040 + conPedido.length + 1); const total = cartTotal; endVisit('visitado', { monto: total }); showToast(`Pedido ${n} confirmado · ${fmtPesos(total)}`) }}
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
            markers={clients
              .map((c, i) => {
                const g = GEO[c.id]
                if (!g) return null
                const esProxima = c.id === nextId
                return {
                  lat: g.lat, lng: g.lng, label: String(i + 1).padStart(2, '0'), title: c.name,
                  color: esProxima ? (theme === 'dark' ? '#2DD4CE' : '#0ABAB5') : statusColor(c.status, theme),
                  labelColor: c.status === 'pendiente' && !esProxima ? (theme === 'dark' ? '#ECF5F4' : '#0B2B2A') : '#fff',
                  selected: esProxima,
                }
              })
              .filter(Boolean)}
            live={livePos || LIVE}
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
                : gps
                  ? 'Buscando señal GPS…'
                  : 'GPS apagado (Perfil → Tracking GPS)'}
          </div>
          {routeCalc && (
            <div style={sx('display:flex;gap:6px;margin-top:8px')}>
              {[rutaInfo ? `${(rutaInfo.distancia / 1000).toFixed(1).replace('.', ',')} km` : '—', rutaInfo ? `~${Math.round(rutaInfo.duracion / 60)} min` : '—', `${pend.length} paradas · orden óptimo`].map((t) => (
                <div key={t} style={sx('background:var(--surface);border:1px solid var(--line2);border-radius:10px;padding:6px 10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--text)')}>{t}</div>
              ))}
            </div>
          )}
          <button onClick={() => setRouteCalc((v) => !v)} style={{ ...sx('width:100%;margin-top:12px;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line2);border-radius:12px;font-weight:600;font-size:14px;cursor:pointer'), background: routeCalc ? 'var(--surface)' : 'var(--primary)', color: routeCalc ? 'var(--deep)' : 'var(--on-primary)' }}>
            <Route />{routeCalc ? 'Ruta calculada — recalcular' : 'Calcular ruta óptima'}
          </button>
          <div style={sx('margin-top:14px')}>
            <div style={sx('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:0 2px 8px')}>Paradas pendientes</div>
            {pend.map((x) => {
              const p = pinFor(x.c, x.i)
              return (
                <div key={x.c.id} style={sx('display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border:1px solid var(--line);border-radius:12px;margin-bottom:6px')}>
                  <span style={{ ...sx('width:22px;height:22px;border-radius:8px;display:grid;place-items:center;font-family:var(--font-mono);font-size:10px;font-weight:600'), background: p.bg, color: p.fg }}>{p.n}</span>
                  <span style={sx('flex:1;font-size:12.5px;font-weight:500')}>{x.c.name}</span>
                  <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>{x.c.dist}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ===== PERFIL ===== */}
      {tab === 'perfil' && (
        <div style={sx('flex:1;overflow-y:auto;padding:14px 14px 92px')}>
          <div style={sx('display:flex;align-items:center;gap:12px;margin:4px 2px 16px')}>
            <div style={sx('width:44px;height:44px;border-radius:14px;background:var(--tlight);color:var(--deep);display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:16px')}>MR</div>
            <div>
              <div style={sx('font-family:var(--font-display);font-weight:600;font-size:16px')}>Martín Ríos</div>
              <div style={sx('font-size:11.5px;color:var(--faint);font-family:var(--font-mono)')}>VEND-07 · Zona Norte GBA</div>
            </div>
          </div>
          <div style={card}>
            <div style={sx('display:flex;justify-content:space-between;align-items:baseline')}>
              <div style={sx('font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)')}>Venta del día</div>
              <div style={sx('font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--success)')}>▲ +12,4%</div>
            </div>
            <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:28px;font-weight:600;margin:4px 0 10px')}>{fmtPesos(montoHoy)}</div>
            <svg viewBox="0 0 260 56" style={sx('width:100%;height:56px;display:block')}>
              <path d="M0 14 H260 M0 28 H260 M0 42 H260" stroke="var(--grid)" strokeWidth="1" />
              <path d="M0 50 L26 46 L52 47 L78 40 L104 42 L130 33 L156 36 L182 26 L208 28 L234 16 L260 10" fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
              <path d="M0 50 L26 46 L52 47 L78 40 L104 42 L130 33 L156 36 L182 26 L208 28 L234 16 L260 10 V56 H0 Z" fill="var(--primary-tint)" />
              <circle cx="260" cy="10" r="3" fill="var(--primary)" />
            </svg>
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
                <div style={sx('font-size:11px;color:var(--faint)')}>Envía tu posición cada 30 s</div>
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

      {/* ===== BOTTOM NAV ===== */}
      <div style={sx('flex:none;position:absolute;bottom:0;left:0;right:0;background:var(--surface);border-top:1px solid var(--line);display:grid;grid-template-columns:repeat(4,1fr);padding:6px 8px 14px;z-index:10')}>
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
