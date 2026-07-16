import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { colorPorId } from '../../lib/colors'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { detectarParadas } from '../../services/geolocation/dwell'
import { fmtDuracion } from '../../lib/format'
import { fetchSnapRecorridos } from '../../services/recorridos'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import useRecorridosDelDia from '../../hooks/useRecorridosDelDia'
import useEmpresaBase from '../../hooks/useEmpresaBase'
import LeafletMap from '../../components/LeafletMap'
import Logo from '../../components/Logo'
import EstadoEquipo from './components/EstadoEquipo'
import GestionHost from './components/GestionHost'
import { App as CapApp } from '@capacitor/app'
import { APP_VERSION } from '../../version'

// Vistas de gestión migradas al botón "Menú" (antes vivían en el Panel de gestión / AdminView,
// la vista de escritorio tipo PWA). Se cargan bajo demanda para no engordar el chunk del mapa.
const ClientesTab = lazy(() => import('../admin/tabs/ClientesTab'))
const ZonasView = lazy(() => import('../admin/ZonasView'))
const CatalogoTab = lazy(() => import('../admin/tabs/CatalogoTab'))
const FaltanteTab = lazy(() => import('../admin/tabs/FaltanteTab'))
const ConsultasView = lazy(() => import('../admin/ConsultasView'))
const UsuariosView = lazy(() => import('../admin/UsuariosView'))
const EmpresasView = lazy(() => import('../admin/EmpresasView'))
const NuevoCliente = lazy(() => import('../catalog/NuevoCliente'))
const NuevoProducto = lazy(() => import('../catalog/NuevoProducto'))
const MiPerfilModal = lazy(() => import('../perfil/MiPerfilModal'))

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
 *
 * Las funciones de gestión (Clientes, Zonas, Catálogo, Faltante, Consultas, Usuarios,
 * Empresas) se abren NATIVAS desde el botón "Menú" (GestionHost). Ya no se navega al
 * AdminView de escritorio (PWA) desde la APK.
 */
const REFRESH_MS = 60000
const hoyStr = () => new Date().toISOString().slice(0, 10)
const initials = (n) => (n || '?').split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()

// Métricas del chrome flotante. Antes vivían como literales sueltos (56/64/70/72/84/86/142)
// repetidos en 9 calc() con env(safe-area-*). Los offsets se expresan RELATIVOS a estas
// constantes para que el layout siga siendo coherente si cambia el alto del header/nav.
const NAV_H = 56    // alto de la bottom-nav (sin safe-area)
const HEADER_H = 56 // alto del header glass (sin safe-area)
const RAIL_W = 44   // lado de los botones del rail vertical (área táctil mínima)
const safeTop = (px) => `calc(${px}px + env(safe-area-inset-top))`
const safeBottom = (px) => `calc(${px}px + env(safe-area-inset-bottom))`

const glass = { backdropFilter: 'blur(14px) saturate(160%)', WebkitBackdropFilter: 'blur(14px) saturate(160%)' }

const KPIS_PROX = [
  { label: 'Pedidos por preventista' },
  { label: 'Horas trabajadas / semana' },
  { label: 'Clientes visitados' },
  { label: 'Recaudado en la semana' },
]

// Acciones de gestión que abren en pantalla nativa (GestionHost) desde el botón "Menú".
// Reemplazan al viejo "Panel de gestión" (AdminView / PWA). Gate por rol: Usuarios solo
// admin/superadmin; Empresas solo superadmin; el resto para todo gestor (incl. encargado).
const GESTION_ITEMS = [
  { key: 'clientes', label: 'Clientes', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'zonas', label: 'Zonas', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'catalogo', label: 'Catálogo', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'faltante', label: 'Faltante', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'consultas', label: 'Consultas', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'usuarios', label: 'Usuarios', roles: ['admin', 'superadmin'] },
  { key: 'empresas', label: 'Empresas', roles: ['superadmin'] },
]
const GESTION_TITLES = Object.fromEntries(GESTION_ITEMS.map((i) => [i.key, i.label]))

export default function SupervisionMovil({ role = 'encargado', onIrAJornada = null }) {
  const { theme, isDark, toggleTheme } = useTheme()
  const { perfil, user, idEmpresa, signOut } = useAuth()
  const { nombres, movers, gpsOff, mqttOn } = useEquipoEnVivo()
  const base = useEmpresaBase(idEmpresa) // dónde abre el mapa (depósito de la empresa)
  const isProp = role === 'propietario'

  const [section, setSection] = useState('mapa') // 'mapa' | 'dash'
  const [filter, setFilter] = useState(null)     // null | 'v' | 'r'
  const [pinId, setPinId] = useState(null)
  const [acctOpen, setAcctOpen] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [snapped, setSnapped] = useState({})     // { id: [{lat,lng}] } pegado a calles
  const [snapOn, setSnapOn] = useState(false)    // false = rastro crudo fiel (default); true = pegado a calles
  const [dwellOn, setDwellOn] = useState(true)   // carteles de permanencia sobre el mapa (default: encendidos)
  const [, tick] = useState(0)
  const [fitDone, setFitDone] = useState(false)  // encuadrar el mapa solo la 1ª vez
  const [fecha, setFecha] = useState(hoyStr)      // día visualizado en el mapa (default hoy)
  const [gestion, setGestion] = useState(null)   // vista de gestión abierta (Clientes, Zonas, …) o null
  const [apkVer, setApkVer] = useState(null)     // versión nativa del APK (para distinguir el fix nativo del OTA)
  const [modalCliente, setModalCliente] = useState(false)
  const [modalProducto, setModalProducto] = useState(false)
  const [modalPerfil, setModalPerfil] = useState(false)
  const [datePop, setDatePop] = useState(false)  // fallback: popover con el <input date> inline
  const toastRef = useRef(null)
  const dateRef = useRef(null)                   // <input type="date"> oculto (picker nativo)

  // Ítems del menú de gestión visibles para el rol actual. El propietario es SOLO LECTURA:
  // se corta explícito (igual que Desktop) en vez de depender de que 'propietario' no figure
  // en ningún array `roles` — esa invariante implícita se rompe sola al agregar un ítem.
  const gestionItems = useMemo(() => (isProp ? [] : GESTION_ITEMS.filter((it) => it.roles.includes(role))), [role, isProp])

  const esHoy = fecha === hoyStr()

  // ---- Recorridos del día elegido (trazos por persona). Auto-refresh incremental solo si es hoy. ----
  const { byUser, reload: recargarPosiciones } = useRecorridosDelDia(fecha, idEmpresa, esHoy)

  // Snap-to-road: geometría pegada a calles (Edge Function con cache). Falla suave → crudo.
  const cargarSnap = useCallback(async () => {
    if (!idEmpresa) return
    const s = await fetchSnapRecorridos({ fecha, desde: new Date(fecha + 'T00:00:00').toISOString(), hasta: new Date(fecha + 'T23:59:59').toISOString() })
    setSnapped(s)
  }, [idEmpresa, fecha])

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
  // Versión nativa del APK (App.getInfo). En web/PWA falla → queda null (solo se muestra la web).
  useEffect(() => { CapApp.getInfo().then((i) => setApkVer(i?.version || null)).catch(() => {}) }, [])

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

  // Paradas → carteles sobre el mapa. Se calculan sobre el rastro CRUDO (byUser) a propósito:
  // el snapped (geometría OSRM pegada a calles) ya descartó los tramos quietos, así que ahí
  // una parada no existe. Umbrales: los de dwell.js (3 min / 40 m, calibrados contra la Edge
  // Function). Mismo filtro por chip y mismo color por persona que los trazos.
  const dwells = useMemo(() => {
    if (!dwellOn) return []
    return Object.entries(byUser)
      .filter(([, v]) => pasaFiltro(v.rol))
      .flatMap(([id, v]) => detectarParadas(v.points || [])
        .map((p) => ({ lat: p.lat, lng: p.lng, label: fmtDuracion(p.duracionMs), color: colorPorId(id) })))
  }, [byUser, filter, dwellOn])

  // Móviles en vivo → pines clickeables (marcadores del mapa). Solo tienen sentido HOY
  // (son la posición "ahora"); en un día pasado se muestran únicamente los recorridos.
  const mapMarkers = esHoy ? moversFil.map((m) => ({
    lat: m.lat, lng: m.lng, label: initials(nombres[m.id] || m.rol),
    color: colorPorId(m.id), labelColor: '#fff', title: nombres[m.id] || m.rol,
    selected: m.id === pinId,
  })) : []
  // Por defecto (snapOn=false) se dibuja el rastro CRUDO fiel (los puntos GPS reales). Con el
  // toggle activo se usa la geometría pegada a calles (OSRM), con fallback al crudo si no está.
  const leafletTrails = trails.flatMap((t) => {
    const segs = snapOn ? snapped[t.id] : null
    if (segs && segs.length) return segs.map((s) => ({ points: s, color: t.color }))
    return [{ points: t.points, color: t.color }]
  })
  const pin = moversArr.find((m) => m.id === pinId) || null

  // % de batería del móvil seleccionado. El `pin` sale de `movers` (useEquipoEnVivo), cuyo
  // select NO trae `bateria`, así que la sacamos del último punto con dato del recorrido del
  // día (byUser). Se recorre de atrás para adelante porque los bundles viejos mandan null y
  // el último fix puede no tenerlo. Sin dato → null (no se muestra nada, ni "—" ni "0%").
  const pinBateria = useMemo(() => {
    const pts = (pinId && byUser[pinId]?.points) || null
    if (!pts) return null
    for (let i = pts.length - 1; i >= 0; i--) {
      const b = pts[i]?.bateria
      if (b !== null && b !== undefined) return b
    }
    return null
  }, [pinId, byUser])

  // Abre el date picker NATIVO sobre el <input type="date"> oculto del rail.
  // 1) showPicker()  → WebView/Chrome moderno (gesto de usuario ⇒ permitido).
  // 2) .click()      → WebView viejo sin showPicker; el input está oculto por opacidad
  //                    (no display:none), así que sigue siendo "focusable"/clickeable.
  // 3) popover       → último recurso: input inline visible, el usuario lo toca él mismo.
  function abrirFecha() {
    const el = dateRef.current
    if (!el) { setDatePop(true); return }
    try {
      if (typeof el.showPicker === 'function') { el.showPicker(); return }
    } catch { /* NotAllowedError / no soportado → seguimos con el fallback */ }
    try {
      el.focus({ preventScroll: true })
      el.click()
      return
    } catch { /* ni click → popover */ }
    setDatePop(true)
  }

  const cambiarFecha = (v) => { setFecha(v || hoyStr()); setFitDone(false); setPinId(null); setDatePop(false) }

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
      <div style={{ position: 'absolute', top: safeTop(HEADER_H), bottom: safeBottom(NAV_H), left: 0, right: 0, isolation: 'isolate' }}>
        <LeafletMap
          theme={theme}
          height="100%"
          center={base}
          trails={leafletTrails.length ? leafletTrails : null}
          markers={mapMarkers}
          dwells={dwells}
          fit={!fitDone}
          edgePadding={{ top: 16, right: RAIL_W + 24, bottom: 24, left: 16 }}
          onMarkerClick={(i) => { const m = moversFil[i]; if (m) { setPinId(m.id); setPlusOpen(false); setAcctOpen(false) } }}
        />

        {/* estado vacío del overlay */}
        {!mapMarkers.length && !trails.length && (
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 240, textAlign: 'center', background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 16, padding: '20px 18px', boxShadow: 'var(--shadow-lg)' }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}><path d="M12 21s-7-6.7-7-11a7 7 0 0 1 14 0c0 4.3-7 11-7 11Z" /><circle cx="12" cy="10" r="2.4" /></svg>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>{esHoy ? 'Sin personal en la calle' : 'Sin recorridos ese día'}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>{esHoy ? 'Cuando vendedores o repartidores inicien jornada, aparecerán acá en vivo.' : 'No hay recorridos registrados para la fecha elegida. Probá con otro día o volvé a “Hoy”.'}</div>
          </div>
        )}
      </div>

      {/* ===== HEADER GLASS ===== */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 12, background: 'var(--glass-bg)', ...glass, borderBottom: '0.5px solid var(--glass-brd)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 11px' }}>
          <Logo size={34} radius={11} />
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
          <div style={{ position: 'absolute', top: safeTop(HEADER_H + 8), right: 12, left: 56, background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', animation: 'lu-rise .22s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 15px 13px' }}>
              <div style={{ width: 46, height: 46, flex: 'none', borderRadius: 14, background: 'var(--tlight)', color: 'var(--deep)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{initials(nombre)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{roleLabel} · {user?.email || ''}</div>
                <div style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>App v{APP_VERSION}{apkVer ? ` · APK ${apkVer}` : ''}</div>
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
              <div onClick={() => { setAcctOpen(false); setModalPerfil(true) }} style={acctItem}>
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
        <div style={{ position: 'absolute', top: safeTop(HEADER_H + 16), left: 14, right: 14, zIndex: 11, background: 'var(--danger-tint)', ...glass, border: '0.5px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '9px 12px', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, boxShadow: 'var(--shadow-lg)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
          {Object.values(gpsOff).map((u) => `${u.nombre} (${u.rol})`).join(', ')} · GPS desactivado
        </div>
      )}

      {/* ===== RAIL DE CONTROLES (vertical, abajo a la derecha) =====
          Antes era una franja horizontal que metía ~460px de controles en los ~365px útiles
          de un Android de 393px: los chips scrolleaban en horizontal sin ninguna affordance
          ("botones amontonados"). Ahora cada control es un botón de 44×44 apilado hacia
          arriba desde la bottom-nav; el rail crece agregando ítems, no comprimiéndolos. */}
      <div style={{ position: 'absolute', right: 12, bottom: safeBottom(NAV_H + 14), zIndex: 11, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Vendedores */}
        <RailBtn
          on={filter === 'v'} dim={!!filter && filter !== 'v'} color="var(--info)"
          badge={vendCount} title={`Vendedores (${vendCount})`}
          onClick={() => { setFilter((f) => f === 'v' ? null : 'v'); setPinId(null) }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 99, background: filter === 'v' ? '#fff' : 'var(--info)' }} />
        </RailBtn>

        {/* Repartidores */}
        <RailBtn
          on={filter === 'r'} dim={!!filter && filter !== 'r'} color="var(--warning)"
          badge={repCount} title={`Repartidores (${repCount})`}
          onClick={() => { setFilter((f) => f === 'r' ? null : 'r'); setPinId(null) }}
        >
          <span style={{ width: 12, height: 12, borderRadius: 4, background: filter === 'r' ? '#fff' : 'var(--warning)' }} />
        </RailBtn>

        {/* Fecha: abre el picker nativo. En un día pasado se ven los recorridos históricos
            (sin móviles en vivo) y el botón queda en --primary. */}
        <RailBtn on={!esHoy} color="var(--primary)" onClick={abrirFecha} title={esHoy ? 'Viendo hoy · en vivo' : `Viendo ${fecha} · histórico`}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
          {/* Oculto por opacidad (NO display:none): showPicker()/click() necesitan un input vivo. */}
          <input
            ref={dateRef} type="date" value={fecha} max={hoyStr()} tabIndex={-1} aria-hidden="true"
            onChange={(e) => cambiarFecha(e.target.value)}
            style={{ position: 'absolute', bottom: 0, right: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 'none', padding: 0, colorScheme: isDark ? 'dark' : 'light' }}
          />
        </RailBtn>

        {/* Volver a hoy: solo aparece cuando se está mirando un día pasado. */}
        {!esHoy && (
          <RailBtn color="var(--primary)" onClick={() => cambiarFecha(hoyStr())} title="Volver a hoy · en vivo">
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.02em' }}>Hoy</span>
          </RailBtn>
        )}

        {/* Pegar el trazo a las calles (solo tiene sentido si hay recorridos dibujados). */}
        {trails.length > 0 && (
          <RailBtn on={snapOn} color="var(--primary)" onClick={() => setSnapOn((v) => !v)} title="Por defecto se muestra el rastro real (GPS). Activá para pegar el trazo a las calles.">
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h6M9 6a3 3 0 1 0-6 0c0 2 3 5 3 5M9 6c0 2-3 5-3 5m9-5a3 3 0 1 1 6 0c0 2-3 5-3 5m-3-5c0 2 3 5 3 5M6 18h12" /></svg>
          </RailBtn>
        )}

        {/* Carteles de permanencia ("permaneció 5 min acá"). Encendidos por defecto; con muchos
            recorridos cargados ensucian el mapa, así que se pueden apagar. */}
        {trails.length > 0 && (
          <RailBtn on={dwellOn} color="var(--primary)" onClick={() => setDwellOn((v) => !v)} title={dwellOn ? 'Ocultar paradas (permanencia)' : 'Mostrar paradas (permanencia)'}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 1.9" /></svg>
          </RailBtn>
        )}

        {/* Sincronizar ubicaciones */}
        <RailBtn on={syncing} color="var(--primary)" onClick={doSync} title="Actualizar ubicaciones">
          <div style={{ display: 'grid', placeItems: 'center', animation: syncing ? 'lu-spin .9s linear infinite' : 'none' }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v5h-5" /></svg>
          </div>
        </RailBtn>
      </div>

      {/* Fallback final del selector de fecha: WebView sin showPicker() ni click() programático
          → input inline visible para que el usuario lo toque él mismo. */}
      {datePop && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 20 }}>
          <div onClick={() => setDatePop(false)} style={{ position: 'absolute', inset: 0, background: 'var(--scrim)' }} />
          <div style={{ position: 'absolute', right: RAIL_W + 20, bottom: safeBottom(NAV_H + 14), background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: '10px 12px', animation: 'lu-rise .2s ease' }}>
            <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>Fecha</div>
            <input
              type="date" value={fecha} max={hoyStr()} autoFocus
              onChange={(e) => cambiarFecha(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', outline: 'none', minHeight: 32, colorScheme: isDark ? 'dark' : 'light' }}
            />
          </div>
        </div>
      )}

      {/* ===== TARJETA FLOTANTE DE PIN ===== */}
      {pin && (
        <div style={{ position: 'absolute', left: 14, right: RAIL_W + 24, bottom: safeBottom(NAV_H + 86), zIndex: 16, background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', padding: '13px 14px', animation: 'lu-rise .2s ease' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
            <div style={{ width: 38, height: 38, flex: 'none', borderRadius: esRep(pin.rol) ? 11 : 99, background: colorPorId(pin.id), color: '#fff', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13 }}>{initials(nombres[pin.id] || pin.rol)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombres[pin.id] || pin.rol}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--faint)', whiteSpace: 'nowrap' }}>hace {Math.max(0, Math.round((Date.now() - pin.ts) / 1000))}s</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 1 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{pin.rol} · en vivo</span>
                {/* Batería: solo si el dispositivo la reporta (bundles viejos mandan null). */}
                {pinBateria !== null && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600, color: pinBateria <= 20 ? 'var(--danger)' : 'var(--muted)' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
                      <rect x="2" y="8" width="16" height="9" rx="2" />
                      <path d="M21 11.5v2" />
                      <rect x="4" y="10" width={Math.max(1, Math.round(12 * Math.min(100, Math.max(0, pinBateria)) / 100))} height="5" rx="1" fill="currentColor" stroke="none" />
                    </svg>
                    {pinBateria}%
                  </span>
                )}
              </div>
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
          <div style={{ position: 'absolute', right: 12, bottom: safeBottom(NAV_H + 28), width: 236, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: 7, animation: 'lu-rise .22s ease' }}>
            <div style={{ padding: '8px 10px 6px', fontSize: 9.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)' }}>Gestión</div>
            {gestionItems.map((it) => (
              <div key={it.key} onClick={() => { setPlusOpen(false); setGestion(it.key) }} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 10px', borderRadius: 12, cursor: 'pointer', minHeight: 44, boxSizing: 'border-box' }}>
                <div style={{ width: 34, height: 34, flex: 'none', borderRadius: 10, background: 'var(--surface2)', color: 'var(--deep)', display: 'grid', placeItems: 'center' }}><GestIcon k={it.key} /></div>
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500, color: 'var(--text)' }}>{it.label}</span>
                <Chevron />
              </div>
            ))}
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

      {/* ===== GESTIÓN (pantalla nativa, abierta desde el botón "Menú") ===== */}
      {gestion && (
        <GestionHost title={GESTION_TITLES[gestion]} onClose={() => { setGestion(null); setModalCliente(false); setModalProducto(false) }}>
          <Suspense fallback={<GestionCargando />}>
            {gestion === 'clientes' && <ClientesTab onToast={showToast} onNuevoCliente={() => setModalCliente(true)} />}
            {gestion === 'zonas' && <ZonasView onToast={showToast} />}
            {gestion === 'catalogo' && <CatalogoTab onNuevoProducto={() => setModalProducto(true)} />}
            {gestion === 'faltante' && <FaltanteTab />}
            {gestion === 'consultas' && <ConsultasView />}
            {gestion === 'usuarios' && <UsuariosView onToast={showToast} />}
            {gestion === 'empresas' && <EmpresasView onToast={showToast} />}
          </Suspense>
        </GestionHost>
      )}

      {/* Modales de alta (se abren desde Clientes / Catálogo). z-index:80 → por encima del host. */}
      {(modalCliente || modalProducto || modalPerfil) && (
        <Suspense fallback={null}>
          {modalCliente && <NuevoCliente onClose={() => setModalCliente(false)} onToast={showToast} center={null} />}
          {modalProducto && <NuevoProducto onClose={() => setModalProducto(false)} onToast={showToast} />}
          {modalPerfil && <MiPerfilModal onClose={() => setModalPerfil(false)} onToast={showToast} />}
        </Suspense>
      )}

      {/* ===== TOAST ===== */}
      {toast && (
        <div style={{ position: 'absolute', top: safeTop(HEADER_H + 14), left: 16, right: 16, zIndex: 90, background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 13, boxShadow: 'var(--shadow-lg)', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9, animation: 'lu-rise .2s ease' }}>
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

// Íconos de las acciones de gestión del menú "+".
function GestIcon({ k }) {
  const inner = {
    clientes: <><circle cx="12" cy="8" r="3.2" /><path d="M5 21c0-3.5 3.1-6 7-6s7 2.5 7 6" /></>,
    zonas: <><path d="M12 21s-7-6.7-7-11a7 7 0 0 1 14 0c0 4.3-7 11-7 11Z" /><circle cx="12" cy="10" r="2.4" /></>,
    catalogo: <path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />,
    faltante: <><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></>,
    consultas: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
    usuarios: <><circle cx="9" cy="8" r="3" /><path d="M2.5 21c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" /><path d="M17 7.7a3 3 0 0 1 0 5.6" /></>,
    empresas: <><path d="M3 21V7l8-4 8 4v14" /><path d="M9 21v-6h6v6" /></>,
  }[k]
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{inner}</svg>
}

// Fallback mientras carga (lazy) la vista de gestión dentro del GestionHost.
function GestionCargando() {
  return <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>Cargando…</div>
}

function themeBtn(active) {
  return { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 38, borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: active ? 'var(--surface)' : 'transparent', color: active ? 'var(--text)' : 'var(--muted)', boxShadow: active ? 'var(--shadow)' : 'none' }
}

/**
 * Botón del rail vertical. 44×44 (área táctil mínima), mismo glass/sombra que tenían los
 * chips de la franja vieja.
 *   - on    → activo: se pinta con `color` sólido y texto blanco.
 *   - dim   → hay otro filtro activo: se apaga a --faint.
 *   - badge → conteo (0 no se muestra) en una píldora chica sobre el botón.
 */
function RailBtn({ on, dim, color, badge, title, onClick, children }) {
  return (
    <div
      onClick={onClick} title={title} role="button" aria-pressed={!!on}
      style={{
        position: 'relative', width: RAIL_W, height: RAIL_W, flex: 'none', boxSizing: 'border-box',
        borderRadius: 12, display: 'grid', placeItems: 'center', cursor: 'pointer',
        background: on ? color : 'var(--glass-bg)',
        border: `0.5px solid ${on ? 'transparent' : 'var(--glass-brd)'}`,
        color: on ? '#fff' : (dim ? 'var(--faint)' : 'var(--text)'),
        opacity: dim && !on ? 0.72 : 1,
        boxShadow: 'var(--shadow-lg)', ...glass,
      }}
    >
      {children}
      {badge > 0 && (
        <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 17, height: 17, padding: '0 4px', boxSizing: 'border-box', borderRadius: 99, background: on ? 'var(--surface)' : color, color: on ? color : '#fff', border: '1.5px solid var(--surface)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{badge}</span>
      )}
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
