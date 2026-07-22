import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useDevice } from '../../context/DeviceContext'
import { useCatalog } from '../../context/CatalogContext'
import { colorPorId } from '../../lib/colors'
import { hoyStr } from '../../lib/format'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { calcularDwells } from './dwells'
import { fetchSnapRecorridos } from '../../services/recorridos'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import useRecorridosDelDia from '../../hooks/useRecorridosDelDia'
import useEmpresaBase from '../../hooks/useEmpresaBase'
import LeafletMap from '../../components/LeafletMap'
import Logo from '../../components/Logo'
import EstadoEquipo from './components/EstadoEquipo'
import { APP_VERSION } from '../../version'

/**
 * Shell de ESCRITORIO (PWA / .exe) para los roles de supervisión: replica las
 * mismas secciones de la APK (SupervisionMovil) pero con la disposición clásica de
 * panel de escritorio:
 *   - Sidebar FIJA a la izquierda (logo arriba + navegación Monitoreo / Dashboard /
 *     Gestión). En pantallas chicas colapsa a un drawer con hamburguesa.
 *   - Topbar arriba: título de la sección activa a la izquierda; avatar de perfil a
 *     la derecha con menú de cuenta (tema + cerrar sesión + "Ir a mi jornada").
 *   - Área central: Monitoreo = mapa grande con barra de filtros (Vend./Rep., fecha,
 *     "Calles") y las MÉTRICAS DEBAJO del mapa. Dashboard expande esas métricas.
 *     Gestión = renderiza el componente elegido (Clientes, Zonas, …) inline.
 *
 * SOLO se usa en web/PWA (App.jsx enruta acá cuando NO es nativo). La APK sigue con
 * SupervisionMovil intacto. Reutiliza la MISMA lógica de mapa/recorridos y la misma
 * lista GESTION_ITEMS que la vista móvil para no divergir.
 *
 * props:
 *   - role         'admin' | 'superadmin' | 'encargado' | 'propietario'
 *   - vista        'panel' | 'jornada' | null   (solo informativo para el encargado)
 *   - onIrAJornada () => void | null   (solo encargado: volver a "Mi jornada")
 */

// Vistas de gestión reutilizadas tal cual del panel (lazy, como en SupervisionMovil).
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

const REFRESH_MS = 60000
const initials = (n) => (n || '?').split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()

const KPIS_PROX = [
  { label: 'Pedidos por preventista', hint: 'cantidad semanal por vendedor' },
  { label: 'Horas trabajadas / semana', hint: 'por preventista, a la semana' },
  { label: 'Clientes visitados', hint: 'visitas efectivas en la semana' },
  { label: 'Recaudado en la semana', hint: 'cobrado + a cobrar' },
]

// Mismos ítems (y gate por rol) que la vista móvil: Usuarios solo admin/superadmin;
// Empresas solo superadmin; el resto para todo gestor (incl. encargado). El propietario
// no ve NADA de esta sección (solo lectura, sin Gestión).
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
const SIDEBAR_W = 232

export default function SupervisionDesktop({ role = 'admin', vista = null, onIrAJornada = null }) {
  const { theme, isDark, toggleTheme } = useTheme()
  const { perfil, user, idEmpresa, signOut } = useAuth()
  const { isMobile, setMode } = useDevice()
  const { nombres, fotos, movers, gpsOff, mqttOn } = useEquipoEnVivo()
  const base = useEmpresaBase(idEmpresa) // dónde abre el mapa (depósito de la empresa)
  const isProp = role === 'propietario'

  const [view, setView] = useState('mapa') // 'mapa' | 'dash' | <clave de gestión>
  const [filter, setFilter] = useState(null) // null | 'v' | 'r'
  const [dwellOn, setDwellOn] = useState(true) // carteles de permanencia sobre el mapa (default: encendidos)
  const [showClientes, setShowClientes] = useState(false) // capa de clientes geolocalizados (default: apagada)
  const [pinId, setPinId] = useState(null)
  const [foco, setFoco] = useState(null)       // { id, nonce } — usuario a enfocar en el mapa
  const [acctOpen, setAcctOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false) // sidebar como drawer en mobile
  const [toast, setToast] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [snapped, setSnapped] = useState({}) // { id: [{lat,lng}] } pegado a calles
  const [snapOn, setSnapOn] = useState(false) // false = rastro crudo fiel (default)
  const [, tick] = useState(0)
  const [fitDone, setFitDone] = useState(false)
  const [fecha, setFecha] = useState(hoyStr)
  const [modalCliente, setModalCliente] = useState(false)
  const [modalProducto, setModalProducto] = useState(false)
  const [modalPerfil, setModalPerfil] = useState(false)
  const toastRef = useRef(null)

  // Ítems de gestión visibles para el rol (vacío para propietario → sin sección).
  const gestionItems = useMemo(() => (isProp ? [] : GESTION_ITEMS.filter((it) => it.roles.includes(role))), [role, isProp])
  const esGestion = !!GESTION_TITLES[view]
  const esHoy = fecha === hoyStr()

  // ---- Recorridos del día elegido (misma lógica que la vista móvil). ----
  const { byUser, reload: recargarPosiciones, error: recorridosError } = useRecorridosDelDia(fecha, idEmpresa, esHoy)

  // Cartera geolocalizada → capa de contexto en el mapa (toggle). Memoizada para que su
  // referencia sea estable entre ticks y LeafletMap no la re-dibuje cada segundo.
  const { clientes: cartera } = useCatalog()
  const clientMarkers = useMemo(
    () => (cartera || []).filter((c) => c.lat != null && c.lng != null).map((c) => ({ lat: c.lat, lng: c.lng, nombre: c.name || c.nombre_comercio })),
    [cartera]
  )

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

  function showToast(m) {
    clearTimeout(toastRef.current)
    setToast(m)
    toastRef.current = setTimeout(() => setToast(null), 2800)
  }

  const esRep = (rol) => rol === 'repartidor'
  const pasaFiltro = (rol) => !filter || (filter === 'r' ? esRep(rol) : !esRep(rol))

  const moversArr = Object.values(movers)
  const moversFil = moversArr.filter((m) => pasaFiltro(m.rol))
  const vendCount = moversArr.filter((m) => !esRep(m.rol)).length
  const repCount = moversArr.filter((m) => esRep(m.rol)).length

  // Click en una persona (lista de métricas o informe de estado) → volver al mapa y encuadrar
  // su recorrido del día; si no tiene, su posición en vivo; si no hay ninguna, avisa.
  const enfocarUsuario = useCallback((id) => {
    setView('mapa')
    setPinId(id)
    setFoco({ id, nonce: Date.now() })
  }, [])

  const focusData = useMemo(() => {
    if (!foco) return null
    const pts = byUser[foco.id]?.points
    if (pts && pts.length) return { points: pts, nonce: foco.nonce }
    const mv = movers[foco.id]
    if (mv) return { points: [{ lat: mv.lat, lng: mv.lng }], nonce: foco.nonce }
    return { points: [], nonce: foco.nonce }
  }, [foco, byUser, movers])

  useEffect(() => {
    if (foco && focusData && focusData.points.length === 0) showToast('Sin recorrido de esa persona hoy')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco && foco.nonce])

  // Trazos (>=2 puntos) filtrados por chip.
  const trails = useMemo(() => Object.entries(byUser)
    .filter(([, v]) => v.points.length >= 2 && pasaFiltro(v.rol))
    .map(([id, v]) => {
      let km = 0
      for (let i = 1; i < v.points.length; i++) km += distanciaMetros(v.points[i - 1], v.points[i])
      return { id, points: v.points, color: colorPorId(id), km: km / 1000 }
    }), [byUser, filter])

  // Paradas → carteles sobre el mapa. Misma lógica exacta que Movil (./dwells): hasta 1.5.7
  // los carteles existían solo en la vista móvil, así que en la PWA de escritorio no aparecían.
  // `useDeferredValue`: ver la nota en SupervisionMovil — el detector cuesta ~410 ms sobre una
  // jornada real y bloqueaba el pintado del trazo. Diferido, el mapa aparece primero.
  const byUserDiferido = useDeferredValue(byUser)
  const dwells = useMemo(
    () => (dwellOn ? calcularDwells(byUserDiferido, pasaFiltro) : []),
    [byUserDiferido, filter, dwellOn]
  )

  // Móviles en vivo → pines clickeables. Solo tienen sentido HOY (posición "ahora").
  const mapMarkers = esHoy ? moversFil.map((m) => ({
    lat: m.lat, lng: m.lng, label: initials(nombres[m.id] || m.rol),
    color: colorPorId(m.id), labelColor: '#fff', title: nombres[m.id] || m.rol,
    // Burbuja de perfil (Life360): foto del perfil o iniciales, con frescura por ts.
    bubble: true, foto: fotos[m.id], ts: m.ts,
    selected: m.id === pinId,
  })) : []
  // Por defecto (snapOn=false) rastro CRUDO fiel; con el toggle, geometría por calles (OSRM).
  const leafletTrails = trails.flatMap((t) => {
    const segs = snapOn ? snapped[t.id] : null
    if (segs && segs.length) return segs.map((s) => ({ points: s, color: t.color }))
    return [{ points: t.points, color: t.color }]
  })

  function doSync() {
    if (syncing) return
    setSyncing(true)
    Promise.resolve(recargarPosiciones()).finally(() => setTimeout(() => { setSyncing(false); showToast('Ubicaciones actualizadas · hace 0s') }, 700))
  }

  const nombre = perfil?.nombre || user?.email || 'Usuario'
  const roleLabel = { propietario: 'Propietario', encargado: 'Encargado', admin: 'Administrador', superadmin: 'Superadmin' }[role] || 'Supervisión'
  const title = esGestion ? GESTION_TITLES[view] : (view === 'mapa' ? 'Monitoreo en vivo' : 'Dashboard total')
  const subtitle = esGestion ? 'Gestión' : (view === 'mapa' ? `${roleLabel} · en vivo` : (isProp ? 'Vista de dirección · solo lectura' : 'Indicadores del día'))

  // Elegir una sección desde el sidebar (cierra el drawer y el menú de cuenta).
  const irA = (k) => { setView(k); setPinId(null); setAcctOpen(false); setDrawerOpen(false) }

  const gpsOffArr = Object.values(gpsOff)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg-app)', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>

      {/* ===== SIDEBAR IZQUIERDA ===== */}
      {/* En escritorio: columna fija en el flujo. En mobile: drawer flotante sobre scrim. */}
      {isMobile && drawerOpen && (
        <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-sheet)', background: 'var(--scrim)' }} />
      )}
      <aside
        style={{
          flex: 'none', width: SIDEBAR_W, background: 'var(--surface)', borderRight: '1px solid var(--line)',
          display: 'flex', flexDirection: 'column',
          ...(isMobile
            ? { position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 'var(--z-sheet)', transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .22s ease', boxShadow: drawerOpen ? 'var(--shadow-lg)' : 'none' }
            : { position: 'sticky', top: 0, height: '100vh' }),
        }}
      >
        {/* Logo + marca arriba */}
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 16px 14px', borderBottom: '1px solid var(--line)' }}>
          <Logo size={30} radius={9} />
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, letterSpacing: '.03em' }}>DisT-At</div>
            <div style={{ fontSize: 9.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>Supervisión</div>
          </div>
        </div>

        {/* Navegación (scrolleable) */}
        <nav style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 10px' }}>
          <SideGroup label="Monitoreo">
            <SideItem active={view === 'mapa'} label="Monitoreo en vivo" onClick={() => irA('mapa')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3z" /><path d="M9 7v13M15 4v13" /></svg>
            </SideItem>
            <SideItem active={view === 'dash'} label="Dashboard" onClick={() => irA('dash')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" rx="1" /><rect x="12.5" y="8" width="3" height="10" rx="1" /><rect x="18" y="5" width="3" height="13" rx="1" /></svg>
            </SideItem>
          </SideGroup>

          {/* Gestión: oculta para el propietario (solo lectura). */}
          {gestionItems.length > 0 && (
            <SideGroup label="Gestión">
              {gestionItems.map((it) => (
                <SideItem key={it.key} active={view === it.key} label={it.label} onClick={() => irA(it.key)}>
                  <GestIcon k={it.key} />
                </SideItem>
              ))}
            </SideGroup>
          )}
        </nav>

        {/* Pie: cambiar a vista celular (útil en la PWA de escritorio). */}
        <div style={{ flex: 'none', padding: 10, borderTop: '1px solid var(--line)' }}>
          <div onClick={() => setMode('mobile')} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 10, cursor: 'pointer', color: 'var(--muted)', fontSize: 12.5, fontWeight: 600 }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
            Cambiar a vista Celular
          </div>
        </div>
      </aside>

      {/* ===== COLUMNA DERECHA (topbar + contenido) ===== */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>

        {/* ===== TOPBAR ===== */}
        {/* 20/07/2026 — Este header estaba en `zIndex: 1200` con un comentario que explicaba
            por qué: quedar por encima de las capas internas de Leaflet (~1000) para que el
            menú de cuenta se despliegue SOBRE el mapa. Al tokenizar los z-index se bajó a
            --z-chrome (100) SIN leer ese comentario, y el bug volvió: el desplegable se veía
            sobre el header y desaparecía sobre el mapa.
            Ahora el número chico es seguro porque la contención se hace en el origen:
            LeafletMap lleva `isolation: isolate` y confina sus 200–1000 adentro. Si alguna
            vez se saca ese isolate, este header vuelve a necesitar un z-index > 1000. */}
        <header style={{ flex: 'none', minHeight: 58, display: 'flex', alignItems: 'center', gap: 12, padding: '0 18px', background: 'var(--surface)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 'var(--z-chrome)' }}>
          {/* Hamburguesa (solo mobile) */}
          {isMobile && (
            <button onClick={() => setDrawerOpen(true)} title="Menú" style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 38, height: 38, border: '1px solid var(--line)', borderRadius: 10, background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
            </button>
          )}

          {/* Título de la sección activa */}
          <div style={{ minWidth: 0, lineHeight: 1.15 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: mqttOn ? 'var(--success)' : 'var(--faint)', animation: mqttOn ? 'lu-blink 2s infinite' : 'none' }} />{subtitle}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 8 }} />

          {/* Avatar + menú de cuenta */}
          <div style={{ position: 'relative', flex: 'none' }}>
            <div onClick={() => setAcctOpen((v) => !v)} style={{ width: 38, height: 38, borderRadius: 99, background: 'var(--tlight)', color: 'var(--deep)', border: `1.5px solid ${acctOpen ? 'var(--primary)' : 'var(--line2)'}`, display: 'grid', placeItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13, position: 'relative' }}>
              {initials(nombre)}
              <span style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: 99, background: 'var(--success)', border: '2px solid var(--surface)' }} />
            </div>

            {acctOpen && (
              <>
                <div onClick={() => setAcctOpen(false)} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-popover)' }} />
                <div style={{ position: 'absolute', top: 'calc(100% + 10px)', right: 0, width: 264, zIndex: 'var(--z-popover)', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 16, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', animation: 'lu-rise .18s ease' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 15px 12px' }}>
                    <div style={{ width: 44, height: 44, flex: 'none', borderRadius: 13, background: 'var(--tlight)', color: 'var(--deep)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>{initials(nombre)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{roleLabel} · {user?.email || ''}</div>
                      <div style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>App v{APP_VERSION}</div>
                    </div>
                  </div>
                  <div style={{ height: 1, background: 'var(--line)' }} />
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
                  </div>
                  <div style={{ height: 1, background: 'var(--line)' }} />
                  <div style={{ padding: '13px 15px' }}>
                    <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 9 }}>Apariencia</div>
                    <div style={{ display: 'flex', gap: 6, background: 'var(--surface2)', border: '1px solid var(--line)', borderRadius: 12, padding: 4 }}>
                      <div onClick={() => { if (!isDark) toggleTheme() }} style={themeBtn(isDark)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>Oscuro</div>
                      <div onClick={() => { if (isDark) toggleTheme() }} style={themeBtn(!isDark)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>Claro</div>
                    </div>
                  </div>
                  <div style={{ height: 1, background: 'var(--line)' }} />
                  <div onClick={() => signOut()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', cursor: 'pointer', color: 'var(--danger)' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>Cerrar sesión</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        {/* ===== ÁREA CENTRAL ===== */}
        <main style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {esGestion ? (
            // Vistas de gestión reutilizadas inline (mismo componente que el panel/APK).
            <Suspense fallback={<Cargando />}>
              {view === 'clientes' && <ClientesTab onToast={showToast} onNuevoCliente={() => setModalCliente(true)} />}
              {view === 'zonas' && <ZonasView onToast={showToast} />}
              {view === 'catalogo' && <CatalogoTab onNuevoProducto={() => setModalProducto(true)} />}
              {view === 'faltante' && <FaltanteTab />}
              {view === 'consultas' && <ConsultasView />}
              {view === 'usuarios' && <UsuariosView onToast={showToast} />}
              {view === 'empresas' && <EmpresasView onToast={showToast} />}
            </Suspense>
          ) : (
            <div style={{ maxWidth: 1500, width: '100%', margin: '0 auto', boxSizing: 'border-box', padding: isMobile ? 14 : 22, display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Banner GPS apagado (mismo patrón que el panel). */}
              {gpsOffArr.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--danger-tint)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', fontSize: 12.5, fontWeight: 600 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
                  Alerta GPS: {gpsOffArr.map((u) => `${u.nombre} (${u.rol})`).join(', ')} {gpsOffArr.length > 1 ? 'tienen' : 'tiene'} el GPS DESACTIVADO.
                </div>
              )}

              {/* MAPA (solo en Monitoreo; en Dashboard se expanden las métricas). */}
              {view === 'mapa' && (
                <div style={panelSx}>
                  {/* Barra superior del panel (no glass flotante): chips + fecha + calles + sync. */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                    <Chip on={filter === 'v'} dim={filter && filter !== 'v'} color="var(--info)" dotRadius={99} count={vendCount} label="Vendedores" onClick={() => { setFilter((f) => f === 'v' ? null : 'v'); setPinId(null) }} />
                    <Chip on={filter === 'r'} dim={filter && filter !== 'r'} color="var(--warning)" dotRadius={4} count={repCount} label="Repartidores" onClick={() => { setFilter((f) => f === 'r' ? null : 'r'); setPinId(null) }} />
                    <div style={{ flex: 1, minWidth: 8 }} />
                    {/* Selector de fecha */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 11px', borderRadius: 10, background: esHoy ? 'var(--surface2)' : 'var(--primary)', border: `1px solid ${esHoy ? 'var(--line)' : 'transparent'}`, color: esHoy ? 'var(--muted)' : '#fff' }} title={esHoy ? 'Viendo hoy · en vivo' : 'Viendo un día pasado · histórico'}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
                      <input type="date" value={fecha} max={hoyStr()} onChange={(e) => { setFecha(e.target.value || hoyStr()); setFitDone(false); setPinId(null) }} style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', outline: 'none', colorScheme: isDark ? 'dark' : 'light' }} />
                      {!esHoy && <span onClick={() => { setFecha(hoyStr()); setFitDone(false); setPinId(null) }} style={{ flex: 'none', fontSize: 11, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' }}>Hoy</span>}
                    </div>
                    {/* Toggle "Calles" */}
                    {trails.length > 0 && (
                      <div onClick={() => setSnapOn((v) => !v)} title="Por defecto se muestra el rastro real (GPS). Activá para pegar el trazo a las calles." style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: snapOn ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${snapOn ? 'transparent' : 'var(--line)'}`, color: snapOn ? '#fff' : 'var(--muted)' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h6M9 6a3 3 0 1 0-6 0c0 2 3 5 3 5M9 6c0 2-3 5-3 5m9-5a3 3 0 1 1 6 0c0 2-3 5-3 5m-3-5c0 2 3 5 3 5M6 18h12" /></svg>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Calles</span>
                      </div>
                    )}
                    {/* Toggle "Paradas" (carteles de permanencia) */}
                    {trails.length > 0 && (
                      <div onClick={() => setDwellOn((v) => !v)} title="Muestra un cartel donde la persona estuvo detenida más de 3 minutos, con el tiempo y la batería del equipo." style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: dwellOn ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${dwellOn ? 'transparent' : 'var(--line)'}`, color: dwellOn ? '#fff' : 'var(--muted)' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Paradas</span>
                      </div>
                    )}
                    {/* Toggle "Clientes" (capa de comercios geolocalizados) */}
                    <div onClick={() => setShowClientes((v) => !v)} title="Muestra los clientes geolocalizados de la cartera como puntos en el mapa." style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: showClientes ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${showClientes ? 'transparent' : 'var(--line)'}`, color: showClientes ? '#fff' : 'var(--muted)' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Clientes{showClientes && clientMarkers.length ? ` · ${clientMarkers.length}` : ''}</span>
                    </div>
                    {/* Sync */}
                    <div onClick={doSync} title="Actualizar ubicaciones" style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'var(--surface2)', border: '1px solid var(--line)', color: syncing ? 'var(--primary)' : 'var(--muted)' }}>
                      <div style={{ display: 'grid', placeItems: 'center', animation: syncing ? 'lu-spin .9s linear infinite' : 'none' }}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v5h-5" /></svg></div>
                    </div>
                  </div>

                  {/* Aviso si la carga de ubicaciones falló: antes un error dejaba el mapa vacío y
                      MUDO (no se distinguía de "no hay datos"). Ahora se ve y se puede reintentar. */}
                  {recorridosError && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 14px 12px', background: 'var(--danger-tint)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', fontSize: 12.5, fontWeight: 600 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
                      <span style={{ flex: 1 }}>No se pudieron cargar las ubicaciones{esHoy ? ' de hoy' : ''}. {recorridosError.message || 'Error de red o sesión.'}</span>
                      <button onClick={doSync} style={{ flex: 'none', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reintentar</button>
                    </div>
                  )}

                  {/* Mapa grande */}
                  <div style={{ padding: 0 }}>
                    <LeafletMap
                      theme={theme}
                      height={isMobile ? 380 : 'clamp(420px, 58vh, 680px)'}
                      center={base}
                      trails={leafletTrails.length ? leafletTrails : null}
                      dwells={dwells}
                      markers={mapMarkers}
                      clients={showClientes ? clientMarkers : []}
                      fit={!fitDone}
                      focus={focusData}
                      edgePadding={{ top: 28, right: 28, bottom: 28, left: 28 }}
                      onMarkerClick={(i) => { const m = moversFil[i]; if (m) setPinId(m.id === pinId ? null : m.id) }}
                    />
                  </div>
                </div>
              )}

              {/* MÉTRICAS DEBAJO del mapa (Monitoreo) / expandidas (Dashboard). */}
              <Metricas
                expanded={view === 'dash'}
                isProp={isProp}
                isMobile={isMobile}
                moversArr={moversArr}
                nombres={nombres}
                onSelectUsuario={enfocarUsuario}
              />
            </div>
          )}
        </main>
      </div>

      {/* Modales de alta (se abren desde Clientes / Catálogo) + edición de perfil. */}
      {(modalCliente || modalProducto || modalPerfil) && (
        <Suspense fallback={null}>
          {modalCliente && <NuevoCliente onClose={() => setModalCliente(false)} onToast={showToast} center={null} />}
          {modalProducto && <NuevoProducto onClose={() => setModalProducto(false)} onToast={showToast} />}
          {modalPerfil && <MiPerfilModal onClose={() => setModalPerfil(false)} onToast={showToast} />}
        </Suspense>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 74, right: 22, zIndex: 'var(--z-toast)', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: '11px 15px', display: 'flex', alignItems: 'center', gap: 9, animation: 'lu-rise .2s ease' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{toast}</span>
        </div>
      )}
    </div>
  )
}

// ---- MÉTRICAS (Estado del equipo + Equipo en la calle + KPIs) ----
// Reutiliza EstadoEquipo y replica las tarjetas de PropietarioView / SupervisionMovil.
// `expanded` (vista Dashboard) usa una grilla más ancha para los KPIs.
function Metricas({ expanded, isProp, isMobile, moversArr, nombres, onSelectUsuario }) {
  const kpiCols = isMobile ? '1fr 1fr' : (expanded ? 'repeat(4, 1fr)' : 'repeat(auto-fit, minmax(200px, 1fr))')
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: !isMobile && !expanded ? '1fr 1fr' : '1fr' }}>
      {/* Estado del equipo · por qué no llega la señal. Click → enfoca su recorrido en el mapa. */}
      <div><EstadoEquipo onSelectUsuario={onSelectUsuario} /></div>

      {/* Equipo en la calle (real, en vivo) */}
      <div style={panelSx}>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <span style={label10}>Equipo en la calle</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--deep)' }}>{moversArr.length} en vivo</span>
          </div>
          {moversArr.length === 0 ? (
            <div style={{ padding: '10px 2px', fontSize: 12, color: 'var(--faint)' }}>Nadie está compartiendo ubicación ahora.</div>
          ) : moversArr.map((m) => (
            <div key={m.id} onClick={onSelectUsuario ? () => onSelectUsuario(m.id) : undefined} className={onSelectUsuario ? 'lu-press' : undefined} role={onSelectUsuario ? 'button' : undefined} title={onSelectUsuario ? 'Ver su recorrido en el mapa' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 0', borderBottom: '1px solid var(--line)', cursor: onSelectUsuario ? 'pointer' : 'default' }}>
              <span style={{ width: 12, height: 12, flex: 'none', borderRadius: 99, background: colorPorId(m.id), boxShadow: `0 0 0 4px ${colorPorId(m.id)}22` }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombres[m.id] || m.rol}</div>
                <div style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{m.rol}</div>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>hace {Math.max(0, Math.round((Date.now() - m.ts) / 1000))}s</div>
            </div>
          ))}
        </div>
      </div>

      {/* KPIs próximamente (ocupan todo el ancho de la grilla). */}
      <div style={{ ...panelSx, gridColumn: '1 / -1' }}>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={label10}>{isProp ? 'Métricas de dirección' : 'Indicadores del día'}</div>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 99, fontSize: 10, fontWeight: 700, color: 'var(--info)', background: 'var(--info-tint)' }}>PRÓXIMAMENTE</span>
          </div>
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: kpiCols }}>
            {KPIS_PROX.map((k) => (
              <div key={k.label} style={{ background: 'var(--surface2)', border: '1px dashed var(--line2)', borderRadius: 14, padding: 14, minHeight: 108, display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', lineHeight: 1.25 }}>{k.label}</div>
                <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 600, color: 'var(--faint)' }}>—</span>
                  <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--info)', background: 'var(--info-tint)', padding: '3px 7px', borderRadius: 99 }}>Próx.</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--faint)', lineHeight: 1.3, marginTop: 6 }}>{k.hint}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.5 }}>
            Estos indicadores se completan con la operación real: se arman a partir de los pedidos y las
            entregas que carguen los preventistas. Mientras tanto, seguí al equipo en vivo desde el mapa.
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- piezas chicas ----
const panelSx = { background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: 'var(--shadow)', overflow: 'hidden' }
const label10 = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)' }
const acctItem = { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px', borderRadius: 11, cursor: 'pointer', minHeight: 44, boxSizing: 'border-box', color: 'var(--text)' }
const acctIconBox = { width: 30, height: 30, flex: 'none', borderRadius: 9, background: 'var(--surface2)', color: 'var(--muted)', display: 'grid', placeItems: 'center' }

function Cargando() {
  return <div style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>Cargando…</div>
}

function Chevron() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
}

function themeBtn(active) {
  return { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 38, borderRadius: 9, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, background: active ? 'var(--surface)' : 'transparent', color: active ? 'var(--text)' : 'var(--muted)', boxShadow: active ? 'var(--shadow)' : 'none' }
}

// Grupo del sidebar (título + ítems).
function SideGroup({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ padding: '4px 12px 8px', fontSize: 9.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)' }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{children}</div>
    </div>
  )
}

// Ítem de navegación del sidebar.
function SideItem({ active, label, onClick, children }) {
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 11, cursor: 'pointer', minHeight: 42, boxSizing: 'border-box', color: active ? 'var(--deep)' : 'var(--muted)', background: active ? 'var(--primary-tint)' : 'transparent', border: `1px solid ${active ? 'var(--primary)' : 'transparent'}`, fontWeight: active ? 600 : 500 }}>
      <span style={{ flex: 'none', display: 'grid', placeItems: 'center', color: active ? 'var(--primary)' : 'var(--muted)' }}>{children}</span>
      <span style={{ flex: 1, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </div>
  )
}

// Chip de filtro (variante escritorio: sólido, sin glass flotante).
function Chip({ on, dim, color, dotRadius, count, label, onClick }) {
  return (
    <div onClick={onClick} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 10, cursor: 'pointer', background: on ? color : 'var(--surface2)', border: `1px solid ${on ? 'transparent' : 'var(--line)'}`, color: on ? '#fff' : (dim ? 'var(--faint)' : 'var(--text)') }}>
      <span style={{ width: 8, height: 8, borderRadius: dotRadius, background: on ? '#fff' : color, flex: 'none' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}

// Íconos de las acciones de gestión (idénticos a los del menú "+" de la vista móvil).
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
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{inner}</svg>
}
