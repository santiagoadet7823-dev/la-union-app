import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { colorPorId } from '../../lib/colors'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { fetchSnapRecorridos } from '../../services/recorridos'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import useRecorridosDelDia from '../../hooks/useRecorridosDelDia'
import LeafletMap from '../../components/LeafletMap'
import EstadoEquipo from './components/EstadoEquipo'

/**
 * Pantalla de SUPERVISIÓN MÓVIL (full-screen, nativa / APK). Implementa el diseño
 * del handoff (SupervisionMovil.dc.html): mapa a pantalla completa como capa base y
 * "chrome" de vidrio flotando encima (header, chips, bottom-nav, bottom-sheet).
 *
 * Un solo componente con dos variantes por rol:
 *   - encargado   → supervisor operativo: incluye menú "+" de acciones y equipo en vivo.
 *   - propietario → dueño, SOLO LECTURA: sin menú "+", dashboard con KPIs "próximamente".
 *
 * El "mapa principal" muestra los RECORRIDOS del día (trazos por persona) + los
 * móviles en vivo como pines. Datos reales por empresa (RLS aísla el tenant).
 *
 * props:
 *   - role         'encargado' | 'propietario' | 'admin' | 'superadmin'
 *   - onIrAJornada () => void | null   (solo encargado: volver a "Mi jornada")
 *   - onIrAPanel   () => void | null   (admin/superadmin: ir al panel de gestión completo)
 */
const REFRESH_MS = 60000
const hoyStr = () => new Date().toISOString().slice(0, 10)
const initials = (n) => (n || '?').split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()

const glass = { backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' }

const KPIS_PROX = [
  { label: 'Pedidos por preventista' },
  { label: 'Horas trabajadas / semana' },
  { label: 'Clientes visitados' },
  { label: 'Recaudado en la semana' },
]

export default function SupervisionMovil({ role = 'encargado', onIrAJornada = null, onIrAPanel = null }) {
  const { theme, isDark, toggleTheme } = useTheme()
  const { perfil, user, idEmpresa, signOut } = useAuth()
  const { nombres, movers, gpsOff, mqttOn } = useEquipoEnVivo()
  const isProp = role === 'propietario'

  const [section, setSection] = useState('mapa') // 'mapa' | 'dash'
  const [filter, setFilter] = useState(null)     // null | 'v' | 'r'
  const [pinId, setPinId] = useState(null)
  const [acctOpen, setAcctOpen] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [snapped, setSnapped] = useState({})     // { id: [{lat,lng}] } pegado a calles
  const [, tick] = useState(0)
  const [fitDone, setFitDone] = useState(false)  // encuadrar el mapa solo la 1ª vez
  const toastRef = useRef(null)

  // ---- Recorridos del día (trazos por persona), con auto-refresh incremental. ----
  const { byUser, reload: recargarPosiciones } = useRecorridosDelDia(hoyStr(), idEmpresa, true)

  // Snap-to-road: geometría pegada a calles (Edge Function con cache). Falla suave → crudo.
  const cargarSnap = useCallback(async () => {
    if (!idEmpresa) return
    const fecha = hoyStr()
    const s = await fetchSnapRecorridos({ fecha, desde: new Date(fecha + 'T00:00:00').toISOString(), hasta: new Date(fecha + 'T23:59:59').toISOString() })
    setSnapped(s)
  }, [idEmpresa])

  useEffect(() => { cargarSnap() }, [cargarSnap])
  useEffect(() => { const iv = setInterval(cargarSnap, REFRESH_MS); return () => clearInterval(iv) }, [cargarSnap])
  // Encuadrar el mapa solo la primera vez que hay datos; después se preserva el zoom/pan.
  useEffect(() => {
    if (fitDone) return
    if (Object.keys(byUser).length || Object.keys(movers).length) setFitDone(true)
  }, [byUser, movers, fitDone])
  // "hace Xs" en vivo.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  useEffect(() => () => clearTimeout(toastRef.current), [])

  function showToast(m) {
    clearTimeout(toastRef.current)
    setToast(m)
    toastRef.current = setTimeout(() => setToast(null), 2600)
  }

  const esRep = (rol) => rol === 'repartidor'
  const pasaFiltro = (rol) => !filter || (filter === 'r' ? esRep(rol) : !esRep(rol))

  const moversArr = Object.values(movers)
  const moversFil = moversArr.filter((m) => pasaFiltro(m.rol))
  const vendCount = moversArr.filter((m) => !esRep(m.rol)).length
  const repCount = moversArr.filter((m) => esRep(m.rol)).length

  // Trazos (>=2 puntos) filtrados por chip.
  const trails = useMemo(() => Object.entries(byUser)
    .filter(([, v]) => v.points.length >= 2 && pasaFiltro(v.rol))
    .map(([id, v]) => {
      let km = 0
      for (let i = 1; i < v.points.length; i++) km += distanciaMetros(v.points[i - 1], v.points[i])
      return { id, points: v.points, color: colorPorId(id), km: km / 1000 }
    }), [byUser, filter])

  // Móviles en vivo → pines clickeables (marcadores del mapa).
  const mapMarkers = moversFil.map((m) => ({
    lat: m.lat, lng: m.lng, label: initials(nombres[m.id] || m.rol),
    color: colorPorId(m.id), labelColor: '#fff', title: nombres[m.id] || m.rol,
    selected: m.id === pinId,
  }))
  // Pegado a calles (uno o varios segmentos por persona) si está; si no, rastro crudo.
  const leafletTrails = trails.flatMap((t) => {
    const segs = snapped[t.id]
    if (segs && segs.length) return segs.map((s) => ({ points: s, color: t.color }))
    return [{ points: t.points, color: t.color }]
  })
  const pin = moversArr.find((m) => m.id === pinId) || null

  function doSync() {
    if (syncing) return
    setSyncing(true)
    Promise.resolve(recargarPosiciones()).finally(() => setTimeout(() => { setSyncing(false); showToast('Ubicaciones actualizadas · hace 0s') }, 700))
  }

  const nombre = perfil?.nombre || user?.email || 'Usuario'
  const roleLabel = { propietario: 'Propietario', encargado: 'Encargado', admin: 'Administrador', superadmin: 'Superadmin' }[role] || 'Supervisión'
  const title = section === 'mapa' ? 'Monitoreo en vivo' : 'Dashboard total'
  const cerrarTodo = () => { setPlusOpen(false); setAcctOpen(false); setPinId(null) }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--map-bg)', color: 'var(--text)', fontFamily: 'var(--font-body)', overflow: 'hidden', userSelect: 'none' }}>

      {/* ===== CAPA 0 · MAPA =====
          isolation:isolate crea un stacking context propio → confina los z-index internos
          de Leaflet (panes/controles 200–1000) DEBAJO del chrome (header/chips/nav), si no
          el mapa tapa los menús. */}
      <div style={{ position: 'absolute', inset: 0, isolation: 'isolate' }}>
        <LeafletMap
          theme={theme}
          height="100%"
          trails={leafletTrails.length ? leafletTrails : null}
          markers={mapMarkers}
          fit={!fitDone}
          onMarkerClick={(i) => { const m = moversFil[i]; if (m) { setPinId(m.id); setPlusOpen(false); setAcctOpen(false) } }}
        />

        {/* estado vacío del overlay */}
        {!moversArr.length && !trails.length && (
          <div style={{ position: 'absolute', left: '50%', top: '42%', transform: 'translate(-50%,-50%)', width: 240, textAlign: 'center', background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 16, padding: '20px 18px', boxShadow: 'var(--shadow-lg)' }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}><path d="M12 21s-7-6.7-7-11a7 7 0 0 1 14 0c0 4.3-7 11-7 11Z" /><circle cx="12" cy="10" r="2.4" /></svg>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>Sin personal en la calle</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>Cuando vendedores o repartidores inicien jornada, aparecerán acá en vivo.</div>
          </div>
        )}
      </div>

      {/* ===== HEADER GLASS ===== */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 12, background: 'var(--glass-bg)', ...glass, borderBottom: '0.5px solid var(--glass-brd)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 11px' }}>
          <div style={{ width: 34, height: 34, borderRadius: 11, background: 'var(--primary)', color: 'var(--on-primary)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>U</div>
          <div style={{ textAlign: 'center', lineHeight: 1.15 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>{title}</div>
            <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 1 }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: mqttOn ? 'var(--success)' : 'var(--faint)', animation: mqttOn ? 'lu-blink 2s infinite' : 'none' }} />{roleLabel} · en vivo
            </div>
          </div>
          <div onClick={() => { setAcctOpen((v) => !v); setPlusOpen(false); setPinId(null) }} style={{ width: 34, height: 34, borderRadius: 99, background: 'var(--tlight)', color: 'var(--deep)', border: `1.5px solid ${acctOpen ? 'var(--primary)' : 'var(--line2)'}`, display: 'grid', placeItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12.5, position: 'relative' }}>
            {initials(nombre)}
            <span style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: 99, background: 'var(--success)', border: '2px solid var(--glass-bg)' }} />
          </div>
        </div>
      </div>

      {/* ===== PANEL DE CUENTA ===== */}
      {acctOpen && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 30 }}>
          <div onClick={() => setAcctOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)' }} />
          <div style={{ position: 'absolute', top: 'calc(64px + env(safe-area-inset-top))', right: 12, left: 56, background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', animation: 'lu-rise .22s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 15px 13px' }}>
              <div style={{ width: 46, height: 46, flex: 'none', borderRadius: 14, background: 'var(--tlight)', color: 'var(--deep)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{initials(nombre)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{roleLabel} · {user?.email || ''}</div>
              </div>
            </div>
            <div style={{ height: '0.5px', background: 'var(--glass-brd)' }} />
            <div style={{ padding: 6 }}>
              {onIrAJornada && !isProp && (
                <div onClick={() => { setAcctOpen(false); onIrAJornada() }} style={acctItem}>
                  <div style={acctIconBox}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3z" /><path d="M9 7v13M15 4v13" /></svg></div>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Ir a mi jornada</span>
                  <Chevron />
                </div>
              )}
              {onIrAPanel && (
                <div onClick={() => { setAcctOpen(false); onIrAPanel() }} style={acctItem}>
                  <div style={acctIconBox}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg></div>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Panel de gestión</span>
                  <Chevron />
                </div>
              )}
              <div onClick={() => { setAcctOpen(false); showToast('Perfil de la cuenta · próximamente') }} style={acctItem}>
                <div style={acctIconBox}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.2" /><path d="M5 21c0-3.5 3.1-6 7-6s7 2.5 7 6" /></svg></div>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Mi perfil</span>
                <Chevron />
              </div>
              <div onClick={() => { setAcctOpen(false); showToast('Ayuda y soporte · próximamente') }} style={acctItem}>
                <div style={acctIconBox}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.8.4-1.4 1-1.4 2M12 17h.01" /></svg></div>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Ayuda y soporte</span>
                <Chevron />
              </div>
            </div>
            <div style={{ height: '0.5px', background: 'var(--glass-brd)' }} />
            <div style={{ padding: '13px 15px' }}>
              <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 9 }}>Apariencia</div>
              <div style={{ display: 'flex', gap: 6, background: 'var(--surface2)', border: '1px solid var(--line)', borderRadius: 12, padding: 4 }}>
                <div onClick={() => { if (!isDark) toggleTheme() }} style={themeBtn(isDark)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>Oscuro</div>
                <div onClick={() => { if (isDark) toggleTheme() }} style={themeBtn(!isDark)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>Claro</div>
              </div>
            </div>
            <div style={{ height: '0.5px', background: 'var(--glass-brd)' }} />
            <div onClick={() => signOut()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', cursor: 'pointer', color: 'var(--danger)', minHeight: 44, boxSizing: 'border-box' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>Cerrar sesión</span>
            </div>
          </div>
        </div>
      )}

      {/* ===== ALERTA GPS APAGADO (si hay) ===== */}
      {Object.values(gpsOff).length > 0 && section === 'mapa' && (
        <div style={{ position: 'absolute', top: 'calc(72px + env(safe-area-inset-top))', left: 14, right: 14, zIndex: 11, background: 'var(--danger-tint)', ...glass, border: '0.5px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '9px 12px', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, boxShadow: 'var(--shadow-lg)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
          {Object.values(gpsOff).map((u) => `${u.nombre} (${u.rol})`).join(', ')} · GPS desactivado
        </div>
      )}

      {/* ===== FRANJA DE CHIPS ===== */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(86px + env(safe-area-inset-bottom))', zIndex: 11, display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px' }}>
        <div style={{ flex: 1, display: 'flex', gap: 8, overflowX: 'auto', padding: '2px 0' }}>
          <Chip on={filter === 'v'} dim={filter && filter !== 'v'} color="var(--info)" dotRadius={99} count={vendCount} label="Vend." onClick={() => { setFilter((f) => f === 'v' ? null : 'v'); setPinId(null) }} />
          <Chip on={filter === 'r'} dim={filter && filter !== 'r'} color="var(--warning)" dotRadius={4} count={repCount} label="Rep." onClick={() => { setFilter((f) => f === 'r' ? null : 'r'); setPinId(null) }} />
        </div>
        <div onClick={doSync} style={{ flex: 'none', width: 44, height: 44, borderRadius: 99, display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'var(--glass-bg)', ...glass, border: '0.5px solid var(--glass-brd)', color: syncing ? 'var(--primary)' : 'var(--muted)', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ display: 'grid', placeItems: 'center', animation: syncing ? 'lu-spin .9s linear infinite' : 'none' }}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v5h-5" /></svg></div>
        </div>
      </div>

      {/* ===== TARJETA FLOTANTE DE PIN ===== */}
      {pin && (
        <div style={{ position: 'absolute', left: 14, right: 14, bottom: 'calc(142px + env(safe-area-inset-bottom))', zIndex: 16, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '13px 14px', animation: 'lu-rise .2s ease' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
            <div style={{ width: 38, height: 38, flex: 'none', borderRadius: esRep(pin.rol) ? 11 : 99, background: colorPorId(pin.id), color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }}>{initials(nombres[pin.id] || pin.rol)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombres[pin.id] || pin.rol}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--faint)', whiteSpace: 'nowrap' }}>hace {Math.max(0, Math.round((Date.now() - pin.ts) / 1000))}s</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{pin.rol} · en vivo</div>
            </div>
            <div onClick={() => setPinId(null)} style={{ flex: 'none', width: 26, height: 26, borderRadius: 8, border: '1px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--muted)' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></div>
          </div>
        </div>
      )}

      {/* ===== BOTTOM NAV ===== */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 12, background: 'var(--glass-bg)', ...glass, borderTop: '0.5px solid var(--glass-brd)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'space-around', padding: '8px 10px 8px' }}>
          <NavBtn active={section === 'mapa'} label="Mapa" onClick={() => { setSection('mapa'); cerrarTodo() }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3z" /><path d="M9 7v13M15 4v13" /></svg>
          </NavBtn>
          <NavBtn active={section === 'dash'} label="Dashboard" onClick={() => { setSection('dash'); setPlusOpen(false); setAcctOpen(false); setPinId(null) }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" rx="1" /><rect x="12.5" y="8" width="3" height="10" rx="1" /><rect x="18" y="5" width="3" height="13" rx="1" /></svg>
          </NavBtn>
          {!isProp && (
            <NavBtn active={plusOpen} label="Menú" onClick={() => { setPlusOpen((v) => !v); setPinId(null); setAcctOpen(false) }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h11M3 18h11" /><path d="M18 15v6M15 18h6" /></svg>
            </NavBtn>
          )}
        </div>
      </div>

      {/* ===== MENÚ "+" (encargado) ===== */}
      {plusOpen && !isProp && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 24 }}>
          <div onClick={() => setPlusOpen(false)} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)' }} />
          <div style={{ position: 'absolute', right: 12, bottom: 'calc(84px + env(safe-area-inset-bottom))', width: 236, background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: 7, animation: 'lu-rise .22s ease' }}>
            <div style={{ padding: '8px 10px 6px', fontSize: 9.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)' }}>Acciones</div>
            {[
              ['Cargar pedido de venta', 'var(--primary-tint)', 'var(--deep)'],
              ['Asignar ruta', 'var(--info-tint)', 'var(--info)'],
              ['Registrar usuario', 'var(--success-tint)', 'var(--success)'],
            ].map(([label, tint, color]) => (
              <div key={label} onClick={() => { setPlusOpen(false); showToast(`${label} · próximamente`) }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 10px', borderRadius: 12, cursor: 'pointer', minHeight: 44, boxSizing: 'border-box' }}>
                <div style={{ width: 34, height: 34, flex: 'none', borderRadius: 10, background: tint, color, display: 'grid', placeItems: 'center' }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg></div>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{label}</span>
              </div>
            ))}
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 11px', marginTop: 2, borderTop: '0.5px solid var(--glass-brd)', fontSize: 10.5, color: 'var(--faint)', lineHeight: 1.35 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flex: 'none' }}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>Se conectan cuando avancen los módulos.
            </div>
          </div>
        </div>
      )}

      {/* ===== BOTTOM-SHEET · DASHBOARD ===== */}
      {section === 'dash' && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 22, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={() => setSection('mapa')} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)' }} />
          <div style={{ position: 'relative', maxHeight: '78%', display: 'flex', flexDirection: 'column', background: 'var(--sheet-bg)', ...glass, border: '0.5px solid var(--glass-brd)', borderBottom: 'none', borderRadius: '22px 22px 0 0', boxShadow: 'var(--shadow-lg)', animation: 'lu-rise .26s ease', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ flex: 'none', padding: '9px 18px 6px' }}>
              <div style={{ width: 38, height: 4, borderRadius: 99, background: 'var(--line2)', margin: '0 auto 10px' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16 }}>Dashboard</div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{isProp ? 'Vista de dirección · solo lectura' : 'Jornada en curso'}</div>
                </div>
                <div onClick={() => setSection('mapa')} style={{ width: 28, height: 28, borderRadius: 9, border: '1px solid var(--line)', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--muted)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg></div>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 16px 26px' }}>

              {/* Informe: por qué no llega la señal (lo ve también el propietario) */}
              <div style={{ marginBottom: 10 }}><EstadoEquipo /></div>

              {/* Equipo en la calle (real) */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 14, marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <span style={sheetLabel}>Equipo en la calle</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--deep)' }}>{moversArr.length} en vivo</span>
                </div>
                {moversArr.length === 0 ? (
                  <div style={{ padding: '10px 2px', fontSize: 12, color: 'var(--faint)' }}>Nadie está compartiendo ubicación ahora.</div>
                ) : moversArr.map((m) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ width: 12, height: 12, flex: 'none', borderRadius: 99, background: colorPorId(m.id), boxShadow: `0 0 0 4px ${colorPorId(m.id)}22` }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombres[m.id] || m.rol}</div>
                      <div style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{m.rol}</div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>hace {Math.max(0, Math.round((Date.now() - m.ts) / 1000))}s</div>
                  </div>
                ))}
              </div>

              {/* KPIs próximamente */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--info-tint)', border: '1px solid var(--info)', borderRadius: 12, padding: '10px 12px', marginBottom: 12, fontSize: 11.5, color: 'var(--info)', fontWeight: 500, lineHeight: 1.35 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></svg>
                {isProp ? 'Indicadores de dirección' : 'Indicadores del día'} — se completan cuando el módulo de pedidos esté en marcha.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {KPIS_PROX.map((k) => (
                  <div key={k.label} style={{ background: 'var(--surface)', border: '1px dashed var(--line2)', borderRadius: 14, padding: '14px 13px', minHeight: 108, display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', lineHeight: 1.25 }}>{k.label}</div>
                    <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 600, color: 'var(--faint)' }}>—</span>
                      <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--info)', background: 'var(--info-tint)', padding: '3px 7px', borderRadius: 99 }}>Próx.</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===== TOAST ===== */}
      {toast && (
        <div style={{ position: 'absolute', top: 'calc(70px + env(safe-area-inset-top))', left: 16, right: 16, zIndex: 40, background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 13, boxShadow: 'var(--shadow-lg)', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9, animation: 'lu-rise .2s ease' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{toast}</span>
        </div>
      )}
    </div>
  )
}

// ---- piezas chicas ----
const acctItem = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px', borderRadius: 11, cursor: 'pointer', minHeight: 44, boxSizing: 'border-box', color: 'var(--text)' }
const acctIconBox = { width: 30, height: 30, flex: 'none', borderRadius: 9, background: 'var(--surface2)', color: 'var(--muted)', display: 'grid', placeItems: 'center' }
const sheetLabel = { fontSize: 10, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--faint)' }

function Chevron() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
}

function themeBtn(active) {
  return { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 38, borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: active ? 'var(--surface)' : 'transparent', color: active ? 'var(--text)' : 'var(--muted)', boxShadow: active ? 'var(--shadow)' : 'none' }
}

function Chip({ on, dim, color, dotRadius, count, label, onClick }) {
  return (
    <div onClick={onClick} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7, padding: '9px 13px', borderRadius: 99, cursor: 'pointer', background: on ? color : 'var(--glass-bg)', border: `0.5px solid ${on ? 'transparent' : 'var(--glass-brd)'}`, color: on ? '#fff' : (dim ? 'var(--faint)' : 'var(--text)'), backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)', boxShadow: 'var(--shadow-lg)' }}>
      <span style={{ width: 8, height: 8, borderRadius: dotRadius, background: on ? '#fff' : color, flex: 'none' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}

function NavBtn({ active, label, onClick, children }) {
  return (
    <div onClick={onClick} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '5px 0', cursor: 'pointer', color: active ? 'var(--primary)' : 'var(--muted)' }}>
      {children}
      <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
    </div>
  )
}
