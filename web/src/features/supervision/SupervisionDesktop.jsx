import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useTenant } from '../../context/TenantContext'
import { useDevice } from '../../context/DeviceContext'
import { useCatalog } from '../../context/CatalogContext'
import { colorPorId } from '../../lib/colors'
import { GESTION_TITLES, itemsDeGestion } from '../../lib/gestion'
import { hoyStr } from '../../lib/format'
import { calcularDwells } from './dwells'
import { construirFines, construirInicios, construirLeaflet, construirTrails, limpiarPorUsuario, totalDescartados } from './trazos'
import MetricasEquipo from './MetricasEquipo'
import { fetchSnapRecorridos } from '../../services/recorridos'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import useRecorridosDelDia from '../../hooks/useRecorridosDelDia'
import useEmpresaBase from '../../hooks/useEmpresaBase'
import useAlertasEquipo from '../../hooks/useAlertasEquipo'
import AlertasEquipo from '../../components/AlertasEquipo'
import SelectorEmpresa from '../../components/SelectorEmpresa'
import PistaBoton from '../../components/PistaBoton'
import LeafletMap from '../../components/LeafletMap'
import BtnInmersivo from '../../components/BtnInmersivo'
import Logo from '../../components/Logo'
import EstadoEquipo from './components/EstadoEquipo'
import BurbujasEquipo from './components/BurbujasEquipo'
import BurbujasParadas from './components/BurbujasParadas'
import RailMapa from './components/RailMapa'
import DespachoGestion from './components/DespachoGestion'
import ThemeToggle from '../../components/ThemeToggle'
import { Alerta, AlertaCirculo, Calendario, Check, ChevronRight, GestIcon, LogOut, Mapa, Menu, Pin, Profile, Refrescar, Reloj, Smartphone } from '../../components/icons'
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
 *   - role         'admin' | 'superadmin' | 'encargado'
 *   - vista        'panel' | 'jornada' | null   (solo informativo para el encargado)
 *   - onIrAJornada () => void | null   (solo encargado: volver a "Mi jornada")
 */

// Las vistas de gestión se despachan desde el módulo compartido con SupervisionMovil y
// PanelDireccion (regla 31). Acá se renderiza INLINE, sin GestionHost: el sidebar tiene que
// seguir visible al lado, y por eso lo que se comparte es el despacho y no el contenedor.
const NuevoCliente = lazy(() => import('../catalog/NuevoCliente'))
const NuevoProducto = lazy(() => import('../catalog/NuevoProducto'))
const MiPerfilModal = lazy(() => import('../perfil/MiPerfilModal'))

const REFRESH_MS = 60000
const initials = (n) => (n || '?').split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()

const SIDEBAR_W = 232

export default function SupervisionDesktop({ role = 'admin', vista = null, onIrAJornada = null }) {
  const { theme, isDark } = useTheme()
  const { perfil, user, idEmpresa, permisos, signOut } = useAuth()
  const { isMobile, setMode } = useDevice()
  const { nombres, fotos, roles, plantel, movers, gpsOff, mqttOn } = useEquipoEnVivo()
  // Incidentes abiertos del equipo (los abre el cron `alertas-equipo`, acá solo se leen).
  const avisos = useAlertasEquipo()
  // 🚨 SCOPE de LECTURA (regla 11). La escritura de GPS no pasa por esta pantalla.
  const { idEmpresaActiva, puedeCambiarScope, empresasDisponibles, setEmpresaActiva, esOverride, nombreActiva } = useTenant()
  const base = useEmpresaBase(idEmpresaActiva) // dónde abre el mapa (depósito de la empresa)

  const [view, setView] = useState('mapa') // 'mapa' | 'dash' | <clave de gestión>
  const [filter, setFilter] = useState(null) // null | 'v' | 'r'
  /* 🩸 LAS PARADAS ARRANCAN APAGADAS (18/08/2026), y es por velocidad, no por gusto.
   *
   * `calcularDwells` corre el detector de paradas sobre la jornada de CADA persona: ~250 ms por
   * persona-día, o sea unos 2,5 s de hilo principal con el equipo completo, justo mientras el mapa
   * se está pintando. Encendido por defecto, eso se paga SIEMPRE — incluso cuando el que abre
   * quiere ver dónde está la gente ahora y no dónde estuvo.
   *
   * Como el botón deja de estar prendido, hay que decir que existe: `RailMapa` muestra una etiqueta
   * al lado que late unos segundos y se va (ver `PistaRail`). */
  const [dwellOn, setDwellOn] = useState(false)
  const [showClientes, setShowClientes] = useState(false) // capa de clientes geolocalizados (default: apagada)
  const [pinId, setPinId] = useState(null)
  const [foco, setFoco] = useState(null)       // { id, nonce } — usuario a enfocar en el mapa
  const [acctOpen, setAcctOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false) // sidebar como drawer en mobile
  const [toast, setToast] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [snapped, setSnapped] = useState({}) // { id: [{lat,lng}] } pegado a calles
  const [, tick] = useState(0)
  const [fitDone, setFitDone] = useState(false)
  const [inmersivo, setInmersivo] = useState(false) // mapa a pantalla completa, sin sidebar ni topbar
  const [fecha, setFecha] = useState(hoyStr)
  // SEGUIMIENTO: id de la persona a la que la cámara se queda pegada, o null. Es el segundo zoom
  // (el primero, encuadrar TODO el recorrido, lo hace `foco` al tocar una burbuja).
  const [seguirId, setSeguirId] = useState(null)
  // Sello del ÚLTIMO enganche pedido a mano (ver `alternarSeguir`). Viaja en `seguir.nonce`.
  const [seguirNonce, setSeguirNonce] = useState(0)
  const [modalCliente, setModalCliente] = useState(false)
  const [modalProducto, setModalProducto] = useState(false)
  const [modalPerfil, setModalPerfil] = useState(false)
  const toastRef = useRef(null)
  const dateRef = useRef(null) // <input type="date"> del rail compacto (modo inmersivo)

  // Ítems de gestión visibles para el rol. Sale de la tabla compartida (`lib/gestion.js`), igual
  // que en SupervisionMovil y en PanelDireccion: si queda vacía, la sección no se dibuja.
  const gestionItems = useMemo(() => itemsDeGestion(role, permisos), [role, permisos])
  const esGestion = !!GESTION_TITLES[view]
  const esHoy = fecha === hoyStr()

  // ---- Recorridos del día elegido (misma lógica que la vista móvil). ----
  const { byUser: byUserCrudo, reload: recargarPosiciones, error: recorridosError } = useRecorridosDelDia(fecha, idEmpresaActiva, esHoy)

  // 🩸 El recorrido se limpia UNA vez y de acá salen trazos, km y paradas — ver ./trazos.js. Sobre
  // los puntos crudos, el 29/07/2026 un vendedor figuraba con 524,8 km (cuatro fixes falsos lo
  // mandaban 127 km al norte y lo traían); su día real fueron 17,9 km.
  const byUser = useMemo(() => limpiarPorUsuario(byUserCrudo), [byUserCrudo])
  const descartados = useMemo(() => totalDescartados(byUser), [byUser])
  useEffect(() => {
    if (descartados) console.info(`[recorridos] ${fecha}: ${descartados} punto(s) descartados por salto imposible`)
  }, [descartados, fecha])

  // Cartera geolocalizada → capa de contexto en el mapa (toggle). Memoizada para que su
  // referencia sea estable entre ticks y LeafletMap no la re-dibuje cada segundo.
  const { clientes: cartera } = useCatalog()
  const clientMarkers = useMemo(
    () => (cartera || []).filter((c) => c.lat != null && c.lng != null).map((c) => ({ lat: c.lat, lng: c.lng, nombre: c.name || c.nombre_comercio })),
    [cartera]
  )

  // Snap-to-road: geometría pegada a calles (Edge Function con cache). Falla suave → crudo.
  const cargarSnap = useCallback(async () => {
    if (!idEmpresaActiva) return
    const s = await fetchSnapRecorridos({ fecha, desde: new Date(fecha + 'T00:00:00').toISOString(), hasta: new Date(fecha + 'T23:59:59').toISOString() })
    setSnapped(s)
  }, [idEmpresaActiva, fecha])

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
  // Escape sale de pantalla completa. Es el gesto que espera cualquiera en escritorio, y acá
  // importa más que en otras capas: el panel inmersivo tapa la sidebar, así que sin esto el único
  // camino de vuelta es encontrar el botón. Mismo patrón que GestionHost.
  useEffect(() => {
    if (!inmersivo) return
    const onKey = (e) => { if (e.key === 'Escape') setInmersivo(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inmersivo])

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
    // Enfocar a OTRO suelta el seguimiento: si no, el paneo por frame de la animación del pin que
    // se venía siguiendo cancela el vuelo hacia el recorrido pedido. Ver SupervisionMovil.
    setSeguirId((s) => (s && id && s !== id ? null : s))
  }, [])

  // Tocar un aviso de la campanita. Los incidentes son SIEMPRE de hoy, así que si se está mirando
  // un día pasado hay que volver: si no, el foco encuadraría un recorrido que no es el del aviso.
  const enfocarAviso = useCallback((a) => {
    if (!a) return
    setFecha((f) => (f === hoyStr() ? f : hoyStr()))
    setFitDone(false)
    enfocarUsuario(a.id_usuario)
  }, [enfocarUsuario])

  /**
   * Ir a una parada (click en `BurbujasParadas`). Espejo exacto del de SupervisionMovil: abre su
   * cartel, suelta el seguimiento —que si no cancela el vuelo— y vuela con un `nonce` nuevo, que es
   * lo que permite volver dos veces a la misma parada (regla 41).
   *
   * ⚠️ Los dos tienen que hacer LO MISMO. Es el caso que la regla 31 viene señalando: los carteles
   * de parada existieron solo en Movil durante versiones enteras porque acá quedó sin portar.
   */
  const irAParada = useCallback((i, d) => {
    setDwellSel(i)
    setSeguirId(null)
    setFoco((f) => ({ id: f?.id || d.id, nonce: Date.now(), points: [{ lat: d.lat, lng: d.lng }] }))
  }, [])

  const focusData = useMemo(() => {
    if (!foco) return null
    // Puntos EXPLÍCITOS: el camino de "ir a esta parada". Ver el comentario en SupervisionMovil.
    if (foco.points) return { points: foco.points, nonce: foco.nonce }
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

  // A quién centrar/seguir: el enfocado, o el móvil con la señal más fresca (así el botón sirve
  // aunque no haya nadie seleccionado). Espejo exacto de SupervisionMovil.
  const objetivoSeguir = useMemo(() => {
    const cand = foco?.id ? movers[foco.id] : null
    if (cand) return { id: foco.id, lat: cand.lat, lng: cand.lng, ts: cand.ts }
    let mejor = null
    for (const [id, m] of Object.entries(movers)) {
      if (!pasaFiltro(m.rol)) continue
      if (!mejor || (m.ts || 0) > (mejor.ts || 0)) mejor = { id, lat: m.lat, lng: m.lng, ts: m.ts }
    }
    return mejor
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco, movers, filter])

  // Sale de `movers` (no del objetivo memoizado) para que cada posición nueva reenganche la cámara.
  const seguirData = useMemo(() => {
    if (!seguirId) return null
    const m = movers[seguirId]
    return m ? { id: seguirId, lat: m.lat, lng: m.lng, ts: m.ts, nonce: seguirNonce } : null
  }, [seguirId, seguirNonce, movers])

  const alternarSeguir = useCallback(() => {
    if (seguirId) { setSeguirId(null); return }
    if (!objetivoSeguir) { showToast('Nadie está reportando ubicación ahora'); return }
    setSeguirId(objetivoSeguir.id)
    // 🩸 El sello del enganche: sin esto, con la persona quieta el botón no movía la cámara. Ver el
    // comentario del efecto de seguimiento en LeafletMap.
    setSeguirNonce(Date.now())
    setPinId(objetivoSeguir.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seguirId, objetivoSeguir])

  // En un día pasado no hay nada "en vivo" a lo que pegarse.
  useEffect(() => { if (!esHoy) setSeguirId(null) }, [esHoy])

  // El rail compacto del modo inmersivo comparte estos dos con la barra de chips.
  const cambiarFecha = useCallback((v) => {
    setFecha(v || hoyStr()); setFitDone(false); setPinId(null)
  }, [])
  const abrirFecha = useCallback(() => {
    const el = dateRef.current
    if (!el) return
    try { if (typeof el.showPicker === 'function') { el.showPicker(); return } } catch { /* fallback */ }
    try { el.focus({ preventScroll: true }); el.click() } catch { /* sin picker: queda el de la barra */ }
  }, [])

  // Trazos (>=2 puntos) filtrados por chip. Compartido con Movil en ./trazos.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trails = useMemo(() => construirTrails(byUser, pasaFiltro), [byUser, filter])

  // Paradas → carteles sobre el mapa. Misma lógica exacta que Movil (./dwells): hasta 1.5.7
  // los carteles existían solo en la vista móvil, así que en la PWA de escritorio no aparecían.
  // `useDeferredValue`: ver la nota en SupervisionMovil — el detector cuesta ~250 ms sobre una
  // jornada real y bloqueaba el pintado del trazo. Diferido, el mapa aparece primero.
  const byUserDiferido = useDeferredValue(byUser)
  const dwells = useMemo(
    () => (dwellOn ? calcularDwells(byUserDiferido, pasaFiltro, cartera) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byUserDiferido, filter, dwellOn, cartera]
  )
  // Cartel de parada ampliado (índice dentro de `dwells`) o null. Ver la nota en SupervisionMovil:
  // el índice deja de ser válido cuando cambia la lista, por eso se limpia en un efecto.
  const [dwellSel, setDwellSel] = useState(null)
  useEffect(() => { setDwellSel(null) }, [fecha, filter, dwellOn])

  // Móviles en vivo → pines clickeables. Solo tienen sentido HOY (posición "ahora").
  // Memoizado: este componente re-renderiza una vez por segundo (el tick de "hace Xs"), y sin
  // memo el array salía nuevo en cada uno. Ver el bloque de firmas de LeafletMap.jsx.
  const mapMarkers = useMemo(() => (esHoy ? moversFil.map((m) => ({
    id: m.id, lat: m.lat, lng: m.lng, label: initials(nombres[m.id] || m.rol),
    color: colorPorId(m.id), labelColor: '#fff', title: nombres[m.id] || m.rol,
    // Burbuja de perfil (Life360): foto del perfil o iniciales, con frescura por ts.
    bubble: true, foto: fotos[m.id], ts: m.ts,
    selected: m.id === pinId,
  })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [esHoy, movers, filter, nombres, fotos, pinId])
  // Geometría final del mapa: ./trazos, la MISMA que usa Movil. El bloque que estaba acá era una
  // copia y ya había divergido (le faltó `simplificarTrazo` del 26/07 hasta el 28/07, y era una
  // IIFE suelta que se recalculaba una vez por segundo con el tick de "hace Xs"). El `useMemo`
  // sigue siendo obligatorio por ese mismo tick.
  const leafletTrails = useMemo(
    () => construirLeaflet({ trails, snapped, focoId: foco?.id || null }),
    [trails, snapped, foco]
  )
  // Marcador "▶ 08:47" en el arranque de cada jornada (./trazos, el MISMO que usa Movil). El
  // `useMemo` es obligatorio por el tick de "hace Xs", que re-renderiza esto una vez por segundo.
  const inicios = useMemo(() => construirInicios(trails), [trails])
  // Y su simétrico "■ 17:20" en el último punto del día. ⚠️ Último punto RECIBIDO, no fin declarado.
  const fines = useMemo(() => construirFines(trails), [trails])

  function doSync() {
    if (syncing) return
    setSyncing(true)
    Promise.resolve(recargarPosiciones()).finally(() => setTimeout(() => { setSyncing(false); showToast('Ubicaciones actualizadas · hace 0s') }, 700))
  }

  const nombre = perfil?.nombre || user?.email || 'Usuario'
  const roleLabel = { encargado: 'Encargado', admin: 'Administrador', superadmin: 'Superadmin' }[role] || 'Supervisión'
  const title = esGestion ? GESTION_TITLES[view] : (view === 'mapa' ? 'Monitoreo en vivo' : 'Dashboard total')
  const subtitle = esGestion ? 'Gestión' : (view === 'mapa' ? `${roleLabel} · en vivo` : 'Indicadores del día')

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
              <Mapa size={18} />
            </SideItem>
            <SideItem active={view === 'dash'} label="Dashboard" onClick={() => irA('dash')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" rx="1" /><rect x="12.5" y="8" width="3" height="10" rx="1" /><rect x="18" y="5" width="3" height="13" rx="1" /></svg>
            </SideItem>
          </SideGroup>

          {/* Gestión: no se dibuja si el rol no tiene ninguna pantalla habilitada. */}
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
            <Smartphone size={17} />
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
              <Menu size={18} />
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
                    {onIrAJornada && (
                      <div onClick={() => { setAcctOpen(false); onIrAJornada() }} style={acctItem}>
                        <div style={acctIconBox}><Mapa size={15} /></div>
                        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Ir a mi jornada</span>
                        <ChevronRight />
                      </div>
                    )}
                    <div onClick={() => { setAcctOpen(false); setModalPerfil(true) }} style={acctItem}>
                      <div style={acctIconBox}><Profile size={15} /></div>
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>Mi perfil</span>
                      <ChevronRight />
                    </div>
                  </div>
                  <div style={{ height: 1, background: 'var(--line)' }} />
                  <div style={{ padding: '13px 15px' }}>
                    <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 9 }}>Apariencia</div>
                    <ThemeToggle />
                  </div>
                  <div style={{ height: 1, background: 'var(--line)' }} />
                  <div onClick={() => signOut()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', cursor: 'pointer', color: 'var(--danger)' }}>
                    <LogOut size={16} />
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
            <DespachoGestion
              vista={view}
              reportes={{
                fecha,
                onFecha: setFecha,
                byUser,
                nombres,
                cartera,
                pasaFiltro,
                filter,
                plantelIds: plantel,
                roles,
                onVerEnMapa: (id) => { setView('mapa'); enfocarUsuario(id) },
              }}
              onToast={showToast}
              onNuevoCliente={() => setModalCliente(true)}
              onNuevoProducto={() => setModalProducto(true)}
              onEditarProducto={(p) => setModalProducto(p)}
              invitarInline
              onCerrarInvitar={() => setView('mapa')}
            />
          ) : (
            <div style={{ maxWidth: 1500, width: '100%', margin: '0 auto', boxSizing: 'border-box', padding: isMobile ? 14 : 22, display: 'flex', flexDirection: 'column', gap: 16 }}>

              {/* Banner GPS apagado (mismo patrón que el panel). */}
              {gpsOffArr.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--danger-tint)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', fontSize: 12.5, fontWeight: 600 }}>
                  <Alerta size={16} style={{ flex: 'none' }} />
                  Alerta GPS: {gpsOffArr.map((u) => `${u.nombre} (${u.rol})`).join(', ')} {gpsOffArr.length > 1 ? 'tienen' : 'tiene'} el GPS DESACTIVADO.
                </div>
              )}

              {/* MAPA (solo en Monitoreo; en Dashboard se expanden las métricas). */}
              {view === 'mapa' && (
                /* En INMERSIVO el panel sale del flujo y tapa sidebar, topbar y métricas con una
                   sola capa, en vez de ocultar cada pieza por separado. Es el mismo elemento de
                   React (no se remonta), así que el mapa conserva el pan y el zoom donde estaba —
                   remontarlo lo devolvería al centro por defecto, porque `fitDone` ya es true. */
                <div style={inmersivo
                  ? { position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', background: 'var(--surface)', display: 'flex', flexDirection: 'column' }
                  : panelSx}>
                  {/* Barra superior del panel (no glass flotante): chips + fecha + calles + sync. */}
                  {!inmersivo && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid var(--line)' }}>
                    <Chip on={filter === 'v'} dim={filter && filter !== 'v'} color="var(--info)" dotRadius={99} count={vendCount} label="Vendedores" onClick={() => { setFilter((f) => f === 'v' ? null : 'v'); setPinId(null) }} />
                    <Chip on={filter === 'r'} dim={filter && filter !== 'r'} color="var(--warning)" dotRadius={4} count={repCount} label="Repartidores" onClick={() => { setFilter((f) => f === 'r' ? null : 'r'); setPinId(null) }} />
                    <div style={{ flex: 1, minWidth: 8 }} />
                    {/* Empresa que se mira (solo superadmin con más de una). No cambia identidad. */}
                    <SelectorEmpresa />
                    {/* Selector de fecha */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 11px', borderRadius: 10, background: esHoy ? 'var(--surface2)' : 'var(--primary)', border: `1px solid ${esHoy ? 'var(--line)' : 'transparent'}`, color: esHoy ? 'var(--muted)' : '#fff' }} title={esHoy ? 'Viendo hoy · en vivo' : 'Viendo un día pasado · histórico'}>
                      <Calendario size={14} style={{ flex: 'none' }} />
                      <input type="date" value={fecha} max={hoyStr()} onChange={(e) => cambiarFecha(e.target.value)} style={{ background: 'transparent', border: 'none', color: 'inherit', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)', outline: 'none', colorScheme: isDark ? 'dark' : 'light' }} />
                      {!esHoy && <span onClick={() => cambiarFecha(hoyStr())} style={{ flex: 'none', fontSize: 11, fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' }}>Hoy</span>}
                    </div>
                    {/* 🩸 El toggle "Calles" se retiró el 18/08/2026. Los encargados no entendían qué
                        prendía y lo confundían con otros controles, y el pegado de tramos en sí
                        dejó de aplicarse (ver el 🩸 de `trazos.js`). */}
                    {/* Toggle "Paradas" (carteles de permanencia) */}
                    {trails.length > 0 && (
                      <PistaBoton texto="Paradas" lado="abajo">
                      <div onClick={() => setDwellOn((v) => !v)} title="Muestra un cartel donde la persona estuvo detenida más de 3 minutos, con el tiempo y la batería del equipo." style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: dwellOn ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${dwellOn ? 'transparent' : 'var(--line)'}`, color: dwellOn ? '#fff' : 'var(--muted)' }}>
                        <Reloj size={15} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Paradas</span>
                      </div>
                      </PistaBoton>
                    )}
                    {/* Toggle "Clientes" (capa de comercios geolocalizados) */}
                    <div onClick={() => setShowClientes((v) => !v)} title="Muestra los clientes geolocalizados de la cartera como puntos en el mapa." style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: showClientes ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${showClientes ? 'transparent' : 'var(--line)'}`, color: showClientes ? '#fff' : 'var(--muted)' }}>
                      <Pin size={15} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>Clientes{showClientes && clientMarkers.length ? ` · ${clientMarkers.length}` : ''}</span>
                    </div>
                    {/* Centrar y SEGUIR la última posición. Es el segundo zoom: tocar una burbuja
                        encuadra todo el recorrido; esto va a donde está ahora y se queda pegado.
                        Arrastrar el mapa lo suelta (LeafletMap escucha `dragstart`). */}
                    <PistaBoton texto="Seguir" lado="abajo">
                    <div
                      onClick={alternarSeguir}
                      title={seguirId
                        ? `Siguiendo a ${nombres[seguirId] || 'el móvil'} · tocá para soltar`
                        : (objetivoSeguir ? `Centrar en la última posición${objetivoSeguir && nombres[objetivoSeguir.id] ? ' de ' + nombres[objetivoSeguir.id] : ''} y seguirla` : 'Nadie está reportando ahora')}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: seguirId ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${seguirId ? 'transparent' : 'var(--line)'}`, color: seguirId ? '#fff' : (objetivoSeguir ? 'var(--muted)' : 'var(--faint)') }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3.2M12 18.8V22M22 12h-3.2M5.2 12H2" /><circle cx="12" cy="12" r="8" /></svg>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{seguirId ? 'Siguiendo' : 'Centrar'}</span>
                    </div>
                    </PistaBoton>
                    {/* Campanita de avisos del equipo. En esta pantalla NO es un complemento del
                        push: es el único canal. Una PWA de escritorio no recibe FCM, así que sin
                        esto el admin que trabaja en la PC no se entera de nada. */}
                    <AlertasEquipo
                      alertas={avisos.alertas}
                      sinVer={avisos.sinVer}
                      nombres={nombres}
                      onMarcarVista={avisos.marcarVista}
                      onEnfocar={enfocarAviso}
                      style={{ width: 36, height: 36, borderRadius: 10 }}
                    />
                    {/* Sync */}
                    <div onClick={doSync} title="Actualizar ubicaciones" style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'var(--surface2)', border: '1px solid var(--line)', color: syncing ? 'var(--primary)' : 'var(--muted)' }}>
                      <div style={{ display: 'grid', placeItems: 'center', animation: syncing ? 'lu-spin .9s linear infinite' : 'none' }}><Refrescar size={17} /></div>
                    </div>
                    {/* Pantalla completa */}
                    <BtnInmersivo activo={false} onToggle={() => { setInmersivo(true); setAcctOpen(false); setDrawerOpen(false) }} style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--line)', boxShadow: 'none', backdropFilter: 'none', WebkitBackdropFilter: 'none', color: 'var(--muted)' }} />
                  </div>
                  )}

                  {/* Aviso si la carga de ubicaciones falló: antes un error dejaba el mapa vacío y
                      MUDO (no se distinguía de "no hay datos"). Ahora se ve y se puede reintentar. */}
                  {recorridosError && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 14px 12px', background: 'var(--danger-tint)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', fontSize: 12.5, fontWeight: 600 }}>
                      <AlertaCirculo size={16} style={{ flex: 'none' }} />
                      <span style={{ flex: 1 }}>No se pudieron cargar las ubicaciones{esHoy ? ' de hoy' : ''}. {recorridosError.message || 'Error de red o sesión.'}</span>
                      <button onClick={doSync} style={{ flex: 'none', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reintentar</button>
                    </div>
                  )}

                  {/* Mapa grande */}
                  <div style={inmersivo ? { flex: 1, minHeight: 0, position: 'relative' } : { padding: 0 }}>
                    <LeafletMap
                      theme={theme}
                      height={inmersivo ? '100%' : (isMobile ? 380 : 'clamp(420px, 58vh, 680px)')}
                      radius={inmersivo ? 0 : 16}
                      center={base}
                      trails={leafletTrails.length ? leafletTrails : null}
                      dwells={dwells}
                      dwellSel={dwellSel}
                      onDwellClick={(i) => setDwellSel((s) => (s === i ? null : i))}
                      inicios={inicios}
                      fines={fines}
                      // Prop suelta (no dentro de `dwells`): con el foco adentro, cada toque en una
                      // persona recalcularía `calcularDwells` — ~250 ms por persona-día.
                      focoId={foco?.id || null}
                      markers={mapMarkers}
                      clients={showClientes ? clientMarkers : []}
                      fit={!fitDone}
                      focus={focusData}
                      seguir={seguirData}
                      onSeguirCancelado={() => setSeguirId(null)}
                      // +65 a la derecha = media burbuja: el encuadre mide la COORDENADA y la
                      // burbuja de perfil mide 130 px de ancho, así que una persona encuadrada
                      // contra el borde quedaba con su burbuja abajo del rail.
                      edgePadding={{ top: 28, right: (inmersivo ? 28 + 44 + 16 : 28) + 65, bottom: inmersivo ? 28 + 96 : 28, left: 28 }}
                      onMarkerClick={(i) => { const m = moversFil[i]; if (m) setPinId(m.id === pinId ? null : m.id) }}
                    />
                    {/* 🩸 ABAJO a la derecha, no arriba (28/07/2026). Estaba en `top:16` y ahí
                        vive el selector de capas de Leaflet ('topright', LeafletMap.jsx): en
                        pantalla completa se superponían y el botón de salir quedaba tapado.
                        Además es la misma esquina que usa SupervisionMovil, que es lo que pide
                        el comentario de BtnInmersivo.jsx: un solo control, un solo lugar. */}
                    {inmersivo && (
                      <BtnInmersivo activo onToggle={() => setInmersivo(false)} style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 'var(--z-chrome)' }} />
                    )}

                    {/* 🩸 En pantalla completa la barra de chips de arriba desaparece, así que sin
                        esto también acá se perdían clientes, paradas, calles y la fecha justo al
                        maximizar el mapa (mismo bug que en SupervisionMovil, 30/07/2026). El rail
                        compacto trae solo los controles de LECTURA. */}
                    {inmersivo && (
                      <RailMapa
                        compacto
                        style={{ position: 'absolute', right: 16, bottom: 16 + 44 + 10, zIndex: 'var(--z-chrome)' }}
                        fecha={fecha}
                        esHoy={esHoy}
                        isDark={isDark}
                        dateRef={dateRef}
                        onAbrirFecha={abrirFecha}
                        onCambiarFecha={cambiarFecha}
                        hayTrazos={trails.length > 0}
                        dwellOn={dwellOn}
                        onDwell={() => setDwellOn((v) => !v)}
                        showClientes={showClientes}
                        clientesCount={clientMarkers.length}
                        onClientes={() => setShowClientes((v) => !v)}
                        seguirActivo={!!seguirId}
                        puedeSeguir={!!objetivoSeguir}
                        nombreSeguido={objetivoSeguir ? (nombres[objetivoSeguir.id] || null) : null}
                        onSeguir={alternarSeguir}
                      />
                    )}

                    {/* Burbujas del equipo: en inmersivo se oculta la barra de filtros y las
                        métricas de abajo, así que este es el único acceso al enfoque por
                        persona. Abajo a la izquierda; la derecha es del botón de salir. */}
                    {inmersivo && (
                      <BurbujasEquipo
                        movers={moversFil}
                        nombres={nombres}
                        fotos={fotos}
                        byUser={byUser}
                        focoId={foco?.id || null}
                        onSelect={(id) => (foco?.id === id ? setFoco(null) : enfocarUsuario(id))}
                        style={{ position: 'absolute', left: 16, right: 76, bottom: 16, zIndex: 'var(--z-chrome)' }}
                      />
                    )}
                    {/* Paradas de la persona tocada. Va ARRIBA de la tira de equipo (bottom mayor)
                        porque es la continuación del gesto: primero elegís a quién, después a dónde.
                        El componente devuelve null sin foco, así que no hace falta otra condición. */}
                    {inmersivo && (
                      <BurbujasParadas
                        dwells={dwells}
                        focoId={foco?.id || null}
                        sel={dwellSel}
                        onIr={irAParada}
                        style={{ position: 'absolute', left: 16, right: 76, bottom: 74, zIndex: 'var(--z-chrome)' }}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* MÉTRICAS DEBAJO del mapa (Monitoreo) / expandidas (Dashboard). */}
              <Metricas
                expanded={view === 'dash'}
                isMobile={isMobile}
                moversArr={moversArr}
                nombres={nombres}
                byUser={byUser}
                filter={filter}
                pasaFiltro={pasaFiltro}
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
          {/* `true` = alta; un objeto producto = edición (mismo patrón que AdminView). */}
          {modalProducto && <NuevoProducto onClose={() => setModalProducto(false)} onToast={showToast} producto={modalProducto === true ? null : modalProducto} />}
          {modalPerfil && <MiPerfilModal onClose={() => setModalPerfil(false)} onToast={showToast} />}
        </Suspense>
      )}

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 74, right: 22, zIndex: 'var(--z-toast)', background: 'var(--surface)', border: '1px solid var(--line2)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: '11px 15px', display: 'flex', alignItems: 'center', gap: 9, animation: 'lu-rise .2s ease' }}>
          <Check size={16} color="var(--success)" />
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{toast}</span>
        </div>
      )}
    </div>
  )
}

// ---- MÉTRICAS (Estado del equipo + Equipo en la calle + KPIs) ----
// Reutiliza EstadoEquipo y replica las tarjetas de PropietarioView / SupervisionMovil.
// `expanded` (vista Dashboard) usa una grilla más ancha para los KPIs.
function Metricas({ expanded, isMobile, moversArr, nombres, byUser, filter, pasaFiltro, onSelectUsuario }) {
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

      {/* Métricas reales del día por usuario: km + tiempo de parada (Feature B). */}
      <div style={{ ...panelSx, gridColumn: '1 / -1' }}>
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={label10}>Rendimiento del día</div>
            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>km recorridos y tiempo de parada por persona</span>
          </div>
          <MetricasEquipo byUser={byUser} nombres={nombres} pasaFiltro={pasaFiltro} filter={filter} onSelect={onSelectUsuario} />
          <div style={{ marginTop: 12, fontSize: 11, color: 'var(--faint)', lineHeight: 1.5 }}>
            Los tiempos de parada se estiman por GPS (una parada = ≥3 min quieto). Cuando los
            preventistas registren check-in/check-out en los comercios, el tiempo por visita será exacto.
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

