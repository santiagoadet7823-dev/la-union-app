import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { useAuth, identidadVisible } from '../../context/AuthContext'
import { useTenant } from '../../context/TenantContext'
import { useDevice } from '../../context/DeviceContext'
import { useCatalog } from '../../context/CatalogContext'
import { colorPorId, tintaTransporte } from '../../lib/colors'
import useTramosTransporte from '../../hooks/useTramosTransporte'
import { GESTION_TITLES, gruposDeGestion } from '../../lib/gestion'
import { hoyStr } from '../../lib/format'
import { calcularDwells } from './dwells'
import { construirFines, construirHitosTransporte, construirInicios, construirLeaflet, construirTrails, hayVelocidadesDeReparto, limpiarPorUsuario, totalDescartados } from './trazos'
import useSnapConectores from './useSnapConectores'
import MetricasEquipo from './MetricasEquipo'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import useRecorridosDelDia, { textoDeErrorRecorridos } from '../../hooks/useRecorridosDelDia'
import HaceSegundos from '../../components/HaceSegundos'
import useEmpresaBase from '../../hooks/useEmpresaBase'
import useAlertasEquipo from '../../hooks/useAlertasEquipo'
import AlertasEquipo, { TarjetaIncidencias } from '../../components/AlertasEquipo'
import SelectorEmpresa from '../../components/SelectorEmpresa'
import PistaBoton from '../../components/PistaBoton'
import LeafletMap from '../../components/LeafletMap'
import BtnInmersivo from '../../components/BtnInmersivo'
import EstadoEquipo from './components/EstadoEquipo'
import BurbujasEquipo from './components/BurbujasEquipo'
import BurbujasParadas from './components/BurbujasParadas'
import RailMapa from './components/RailMapa'
import RailEscritorio from './components/RailEscritorio'
import ListaGestion from './components/ListaGestion'
import DespachoGestion from './components/DespachoGestion'
import MenuCuenta from '../perfil/MenuCuenta'
import { etiquetaRol } from '../../lib/roles'
import { Alerta, AlertaCirculo, Calendario, Check, ChevronDown, Dashboard, Gestion, Mapa, Menu, Pin, Refrescar, Reloj, Truck } from '../../components/icons'
import useCapaCartera from './useCapaCartera'
import LeyendaCartera from './components/LeyendaCartera'
import TarjetaComercio from './components/TarjetaComercio'

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
// Mi perfil y Cambiar contraseña los abre ahora el menú de cuenta único (perfil/MenuCuenta).
// El dashboard con gráficos (ventas + actividad) es el mismo módulo que monta PanelDireccion en
// celular y SupervisionMovil en el APK (regla 31). Lazy: sus hooks pegan tres RPC y la librería de
// gráficos baja aparte; el monitoreo en vivo, que es lo que abre primero, no paga nada de eso.
const DashboardEquipo = lazy(() => import('../dashboard/DashboardEquipo'))

const initials = (n) => (n || '?').split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()

// Ancho del panel contextual de Gestión: el del sidebar que había antes del rail (02/10/2026).
const SIDEBAR_W = 232
// Rail expandido o no, por equipo (localStorage). Mismo criterio que `lu-device`.
const RAIL_KEY = 'lu-rail-escritorio'
const MQ_ANGOSTO = '(max-width: 1099px)'

// "11:58:04" — la hora de la última carga de ubicaciones, con segundos como en la hoja.
const horaConSegundos = (ts) => {
  const d = new Date(ts)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

export default function SupervisionDesktop({ role = 'admin', vista = null, onIrAJornada = null }) {
  const { theme, isDark } = useTheme()
  const { perfil, user, idEmpresa, permisos } = useAuth()
  const { isMobile } = useDevice()
  const { nombres, fotos, roles, plantel, movers, gpsOff, mqttOn } = useEquipoEnVivo()
  // Incidentes abiertos del equipo (los abre el cron `alertas-equipo`, acá solo se leen).
  const avisos = useAlertasEquipo()
  // 🚨 SCOPE de LECTURA (regla 11). La escritura de GPS no pasa por esta pantalla.
  const { idEmpresaActiva, puedeCambiarScope, empresasDisponibles, setEmpresaActiva, esOverride, nombreActiva } = useTenant()
  const base = useEmpresaBase(idEmpresaActiva) // dónde abre el mapa (depósito de la empresa)

  const [view, setView] = useState('mapa') // 'mapa' | 'dash' | <clave de gestión>
  // Horizonte del dashboard (hoy / semana / mes). Antes no existía en PC: la vista sólo expandía
  // las tarjetas del día. Se guarda acá, no adentro del dashboard, para que sobreviva al cambio
  // de vista (ir a Pedidos y volver no debería resetearlo).
  const [horizonteDash, setHorizonteDash] = useState('semana')
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
  // Hitos de velocidad del reparto: apagados por defecto, se prenden con el chip "Velocidad" (01/10/2026).
  const [velocidadOn, setVelocidadOn] = useState(false)
  const [pinId, setPinId] = useState(null)
  const [foco, setFoco] = useState(null)       // { id, nonce } — usuario a enfocar en el mapa
  const [acctOpen, setAcctOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false) // rail + panel como drawer en mobile
  const [railAbierto, setRailAbierto] = useState(() => { try { return localStorage.getItem(RAIL_KEY) === '1' } catch { return false } })
  const [panelGestion, setPanelGestion] = useState(true) // panel contextual de Gestión a la vista
  const ultimaGestionRef = useRef(null)
  // Topbar angosto (< 1100 px, sin llegar al drawer): con el panel de Gestión abierto quedan ~600 px
  // y las migas se partían en tres renglones. Se esconden la hora, el nombre de la cuenta y el rótulo
  // de empresa fijo; el selector (quien puede cambiarla) y la campanita quedan siempre.
  const [angosto, setAngosto] = useState(() => !!window.matchMedia?.(MQ_ANGOSTO).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(MQ_ANGOSTO)
    if (!mq) return undefined
    const f = () => setAngosto(mq.matches)
    mq.addEventListener?.('change', f)
    return () => mq.removeEventListener?.('change', f)
  }, [])
  const railRef = useRef(null)
  const [toast, setToast] = useState(null)
  const [syncing, setSyncing] = useState(false)
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
  const toastRef = useRef(null)
  const dateRef = useRef(null) // <input type="date"> del rail compacto (modo inmersivo)

  // Ítems de gestión visibles para el rol. Sale de la tabla compartida (`lib/gestion.js`), igual
  // que en SupervisionMovil y en PanelDireccion: si queda vacía, la sección no se dibuja.
  // Ítems de gestión del rol, en Operación / Equipo / Sistema (lib/gestion.js, 01/10/2026): el
  // sidebar los rotula igual que el destino Gestión de la APK y del panel de dirección.
  const gestionGrupos = useMemo(() => gruposDeGestion(role, permisos), [role, permisos])
  const esGestion = !!GESTION_TITLES[view]
  const esHoy = fecha === hoyStr()

  // ---- Recorridos del día elegido (misma lógica que la vista móvil). ----
  const { byUser: byUserCrudo, reload: recargarPosiciones, error: recorridosError, updatedAt: recorridosAt } = useRecorridosDelDia(fecha, idEmpresaActiva, true) // rol SIEMPRE (01/10/2026): con `esHoy` el historial venía sin rol y ni el chip Vend./Rep. ni la velocidad del reparto funcionaban en días pasados

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
  const { clientes: cartera, zonas } = useCatalog()
  // Capa de cartera: apagada → por zona → por estado de hoy. Ver `useCapaCartera`.
  // Con una persona enfocada la capa es SU cartera (18/09/2026) — salvo un repartidor, que no tiene
  // cartera: seguirlo con la capa vacía sería un bug nuevo, así que para él se sigue dibujando todo.
  const focoCartera = foco?.id && roles[foco.id] !== 'repartidor' ? foco.id : null
  const { modoClientes, alternarClientes, clientMarkers, clientesCount, conteoEstado, zonasEnMapa, sinUbicar: sinUbicarCartera, comercioSel, elegirComercio, soltarComercio } =
    useCapaCartera({ cartera, zonas, idEmpresa: idEmpresaActiva, fecha, isDark, focoId: focoCartera })

  // Conectores de hueco largo (Edge Function `snap-recorridos`). Hasta el 13/09/2026 esto era un
  // `setInterval` de 60 s que la invocaba también mirando días pasados; ahora se pide sólo cuando
  // aparece un hueco candidato — ver useSnapConectores.js. Falla suave → recta.
  const snapped = useSnapConectores({ byUser, fecha, idEmpresa: idEmpresaActiva })
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
  // Tramos de TRANSPORTE del día (17/09/2026, db/72): el lapso en que cada persona declaró estar
  // en ruta se pinta en tinta y lleva hitos de hora con la velocidad media. Ver trazos.js.
  const { porUsuario: tramos, abiertos: transporteAbierto } = useTramosTransporte(fecha, idEmpresaActiva)
  const tinta = tintaTransporte(theme)
  const leafletTrails = useMemo(
    () => construirLeaflet({ trails, snapped, focoId: foco?.id || null, tramos, tinta }),
    [trails, snapped, foco, tramos, tinta]
  )
  const hayVelocidad = useMemo(() => hayVelocidadesDeReparto(trails, tramos), [trails, tramos])
  const hitos = useMemo(
    () => (velocidadOn ? construirHitosTransporte(trails, tramos, tinta) : []),
    [velocidadOn, trails, tramos, tinta]
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

  const nombre = perfil?.nombre || identidadVisible(user?.email) || 'Usuario'
  const roleLabel = role ? etiquetaRol(role) : 'Supervisión' // tabla única: lib/roles.js
  // Título + migas del topbar (hoja SupervisionEscritorio: "Supervisión › Gestión › Equipo").
  const grupoActual = esGestion ? gestionGrupos.find((g) => g.items.some((it) => it.key === view))?.titulo : null
  const title = esGestion ? GESTION_TITLES[view] : (view === 'mapa' ? 'Mapa en vivo' : 'Dashboard')
  const migas = esGestion
    ? ['Supervisión', 'Gestión', grupoActual].filter(Boolean)
    : view === 'dash'
      ? ['Supervisión', `Ventas y actividad · ${horizonteDash === 'hoy' ? 'hoy' : horizonteDash === 'semana' ? 'esta semana' : 'este mes'}`]
      : ['Supervisión', roleLabel]

  // Elegir una sección desde el rail o el panel (cierra el drawer y el menú de cuenta).
  const irA = (k) => { setView(k); setPinId(null); setAcctOpen(false); setDrawerOpen(false) }

  // Gestión en el rail: desde otra sección abre la ÚLTIMA pantalla de gestión que se usó (o la
  // primera del rol) con el panel a la vista; estando ya en Gestión, muestra u oculta el panel para
  // devolverle ese ancho a la pantalla. En el drawer el panel está siempre al lado del rail.
  const irGestion = () => {
    if (esGestion && !isMobile) { setPanelGestion((v) => !v); return }
    const primera = gestionGrupos[0]?.items[0]?.key
    const destino = GESTION_TITLES[ultimaGestionRef.current] && gestionGrupos.some((g) => g.items.some((it) => it.key === ultimaGestionRef.current))
      ? ultimaGestionRef.current
      : primera
    if (!destino) return
    setPanelGestion(true)
    irA(destino)
  }
  useEffect(() => { if (esGestion) ultimaGestionRef.current = view }, [esGestion, view])

  // Rail contraído (72) o expandido (208), recordado en este equipo. Igual que la hoja: arranca
  // contraído, que es lo que le deja el ancho al mapa.
  const alternarRail = () => setRailAbierto((v) => {
    const n = !v
    try { localStorage.setItem(RAIL_KEY, n ? '1' : '0') } catch { /* sin storage: no se recuerda */ }
    return n
  })

  // Drawer (pantallas chicas): al abrir, el foco va al rail; Escape lo cierra.
  useEffect(() => {
    if (!drawerOpen) return undefined
    railRef.current?.focus({ preventScroll: true })
    const onKey = (e) => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const gpsOffArr = Object.values(gpsOff)

  // Destinos del rail (02/10/2026, bloque C7). Los mismos de la barra inferior de la APK: Mapa ·
  // Dashboard · Gestión (la cuenta vive arriba a la derecha). Gestión no se dibuja si el rol no
  // tiene ninguna pantalla, igual que antes con los grupos del sidebar.
  const nAvisos = avisos.alertas.length
  const destinosRail = [
    { k: 'mapa', etiqueta: 'Mapa', Icono: Mapa, activo: view === 'mapa', badge: nAvisos, badgeAria: `${nAvisos} incidencia${nAvisos === 1 ? '' : 's'} abierta${nAvisos === 1 ? '' : 's'}`, onClick: () => irA('mapa') },
    { k: 'dash', etiqueta: 'Dashboard', Icono: Dashboard, activo: view === 'dash', onClick: () => irA('dash') },
    ...(gestionGrupos.length
      ? [{ k: 'gestion', etiqueta: 'Gestión', Icono: Gestion, activo: esGestion, expandido: isMobile ? undefined : (esGestion && panelGestion), onClick: irGestion }]
      : []),
  ]

  // Panel contextual de Gestión: la lista agrupada COMPARTIDA con la APK y el panel de dirección
  // (`ListaGestion`, regla 31), con la pantalla abierta marcada. Ancho = el del sidebar viejo.
  const panelGestionNodo = gestionGrupos.length > 0 && (
    <aside id="panel-gestion" aria-label="Gestión" style={{ flex: 'none', width: SIDEBAR_W, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface)', borderRight: '1px solid var(--line)' }}>
      <div style={{ flex: 'none', minHeight: 60, boxSizing: 'border-box', display: 'flex', alignItems: 'center', padding: '0 16px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 17 }}>Gestión</div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 10px 16px' }}>
        <ListaGestion rol={role} permisos={permisos} activa={esGestion ? view : null} chevron={false} onAbrir={irA} />
      </div>
    </aside>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: 'var(--bg-app)', color: 'var(--text)', fontFamily: 'var(--font-body)' }}>

      {/* ===== RAIL + PANEL CONTEXTUAL (02/10/2026, bloque C7) =====
          Era un sidebar de 232 px siempre abierto (logo + Monitoreo / Dashboard / los tres grupos de
          Gestión) que le quitaba ese ancho al mapa todo el tiempo. Ahora: rail oscuro de 72 px con los
          destinos y, SOLO dentro de Gestión, el panel de 232 con la lista agrupada. En Mapa y en
          Dashboard el ancho es todo del contenido.
          En pantallas chicas (isMobile) los dos van juntos en el drawer de la hamburguesa. */}
      {isMobile ? (
        <>
          {drawerOpen && (
            <div onClick={() => setDrawerOpen(false)} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-sheet)', background: 'var(--scrim)' }} />
          )}
          <div
            inert={drawerOpen ? undefined : true}
            style={{ position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 'var(--z-sheet)', display: 'flex', maxWidth: 'calc(100vw - 40px)', transform: drawerOpen ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .22s ease', boxShadow: drawerOpen ? 'var(--shadow-lg)' : 'none' }}
          >
            <RailEscritorio destinos={destinosRail} navRef={railRef} style={{ height: '100%' }} />
            {panelGestionNodo}
          </div>
        </>
      ) : (
        <div style={{ flex: 'none', display: 'flex', position: 'sticky', top: 0, height: '100vh', alignSelf: 'flex-start' }}>
          <RailEscritorio destinos={destinosRail} abierto={railAbierto} onAlternar={alternarRail} navRef={railRef} />
          {esGestion && panelGestion && panelGestionNodo}
        </div>
      )}

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
            vez se saca ese isolate, este header vuelve a necesitar un z-index > 1000.
            02/10/2026 (C7): la campanita, el selector de empresa y "Actualizar" vinieron de la barra
            del mapa: tienen que verse en TODAS las secciones (06 D6/D7), no solo en Monitoreo. */}
        <header style={{ flex: 'none', minHeight: 60, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, padding: isMobile ? '8px 12px' : '8px 16px', background: 'var(--surface)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 'var(--z-chrome)' }}>
          {/* Hamburguesa (solo mobile) */}
          {isMobile && (
            <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Menú" aria-expanded={drawerOpen} title="Menú" style={{ flex: 'none', display: 'grid', placeItems: 'center', width: 44, height: 44, padding: 0, border: '1px solid var(--line)', borderRadius: 12, background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}>
              <Menu size={20} />
            </button>
          )}

          {/* Migas + título de la sección activa */}
          <div style={{ flex: 1, minWidth: 96, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {!isMobile && (
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {migas.join(' › ')}
              </div>
            )}
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
          </div>

          {/* "En línea · hh:mm:ss": el punto dice si hay tiempo real (MQTT) y la hora, cuándo llegó
              la última carga de ubicaciones. El texto cambia con el estado: no es solo el color. */}
          {!isMobile && (
            <div title={mqttOn ? 'Recibiendo posiciones en tiempo real' : 'Sin tiempo real: las posiciones se actualizan cada minuto'} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 10px', borderRadius: 99, background: mqttOn ? 'var(--success-tint)' : 'var(--surface2)', color: mqttOn ? 'var(--success)' : 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
              <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 99, background: mqttOn ? 'var(--success)' : 'var(--faint)', animation: mqttOn ? 'lu-blink 2s infinite' : 'none' }} />
              {mqttOn ? 'En línea' : 'Sin tiempo real'}{recorridosAt && !angosto ? ` · ${horaConSegundos(recorridosAt)}` : ''}
            </div>
          )}

          {/* Actualizar ubicaciones: solo donde hay ubicaciones (Mapa y Dashboard). */}
          {!esGestion && (
            <button type="button" onClick={doSync} aria-label="Actualizar ubicaciones" title="Actualizar ubicaciones" style={{ flex: 'none', width: 44, height: 44, padding: 0, borderRadius: 12, display: 'grid', placeItems: 'center', cursor: 'pointer', background: 'var(--surface2)', border: '1px solid var(--line)', color: syncing ? 'var(--primary)' : 'var(--muted)' }}>
              <span style={{ display: 'grid', placeItems: 'center', animation: syncing ? 'lu-spin .9s linear infinite' : 'none' }}><Refrescar size={18} /></span>
            </button>
          )}

          {/* Empresa que se mira. Quien puede cambiarla (superadmin con más de una) tiene el
              selector; el resto ve el nombre, sin control. No cambia identidad. */}
          {puedeCambiarScope ? (
            <SelectorEmpresa compacto={isMobile} style={{ height: 44, borderRadius: 12 }} />
          ) : (!isMobile && !angosto && nombreActiva && (
            <div style={{ flex: 'none', minHeight: 44, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '4px 12px', borderRadius: 12, border: '1px solid var(--line)', lineHeight: 1.2, maxWidth: 220 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)' }}>Empresa</span>
              <span style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombreActiva}</span>
            </div>
          ))}

          {/* Campanita de avisos del equipo. En esta pantalla NO es un complemento del push: es el
              único canal. Una PWA de escritorio no recibe FCM, así que sin esto el admin que trabaja
              en la PC no se entera de nada. */}
          <AlertasEquipo
            alertas={avisos.alertas}
            sinVer={avisos.sinVer}
            nombres={nombres}
            onMarcarVista={avisos.marcarVista}
            onEnfocar={enfocarAviso}
            style={{ borderRadius: 12 }}
          />

          {/* Cuenta: avatar + nombre + rol, con el menú de cuenta único (perfil/MenuCuenta). En la
              PC va como popover de 340 px; en un celular (encargado en la PWA, que cae acá) como
              hoja inferior. El popover es `position:fixed` en --z-popover: no depende de este
              header (ver el comentario de arriba sobre el isolate de LeafletMap). */}
          <button type="button" onClick={() => setAcctOpen((v) => !v)} aria-label={`Mi cuenta · ${nombre}`} aria-haspopup="dialog" aria-expanded={acctOpen} style={{ flex: 'none', minHeight: 44, display: 'flex', alignItems: 'center', gap: 9, padding: isMobile ? 4 : '4px 10px 4px 5px', boxSizing: 'border-box', borderRadius: 12, border: `1px solid ${acctOpen ? 'var(--primary)' : 'var(--line)'}`, background: 'var(--surface2)', color: 'var(--text)', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
            <span aria-hidden="true" style={{ flex: 'none', width: 34, height: 34, borderRadius: 99, background: 'var(--tlight)', color: 'var(--deep)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12 }}>{initials(nombre)}</span>
            {!isMobile && !angosto && (
              <>
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2, maxWidth: 160 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</span>
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{roleLabel}</span>
                </span>
                <span aria-hidden="true" style={{ display: 'grid' }}><ChevronDown size={14} /></span>
              </>
            )}
          </button>
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
              onIrA={irA}
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
                    {/* El selector de empresa, la campanita y "Actualizar" se mudaron al topbar el
                        02/10/2026 (C7): se ven en todas las secciones, no solo acá. */}
                    {/* Selector de fecha */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 11px', borderRadius: 10, background: esHoy ? 'var(--surface2)' : 'var(--primary)', border: `1px solid ${esHoy ? 'var(--line)' : 'transparent'}`, color: esHoy ? 'var(--muted)' : 'var(--on-primary)' }} title={esHoy ? 'Viendo hoy · en vivo' : 'Viendo un día pasado · histórico'}>
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
                      <div onClick={() => setDwellOn((v) => !v)} title="Muestra un cartel donde la persona estuvo detenida más de 3 minutos, con el tiempo y la batería del equipo." style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: dwellOn ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${dwellOn ? 'transparent' : 'var(--line)'}`, color: dwellOn ? 'var(--on-primary)' : 'var(--muted)' }}>
                        <Reloj size={15} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Paradas</span>
                      </div>
                      </PistaBoton>
                    )}
                    {/* Chip "Velocidad" (01/10/2026): hitos "10:42 · 78 km/h" del tramo de transporte de
                        los REPARTIDORES. A pedido y sólo si algún repartidor tuvo tramo ese día. */}
                    {hayVelocidad && (
                      <div onClick={() => setVelocidadOn((v) => !v)} role="button" aria-pressed={velocidadOn} title={velocidadOn ? 'Ocultar la velocidad del reparto' : 'Mostrar la velocidad del reparto: hora y km/h cada 10 minutos de transporte (se ven al acercar el mapa)'} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: velocidadOn ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${velocidadOn ? 'transparent' : 'var(--line)'}`, color: velocidadOn ? 'var(--on-primary)' : 'var(--muted)' }}>
                        <Truck size={15} />
                        <span style={{ fontSize: 12, fontWeight: 600 }}>Velocidad</span>
                      </div>
                    )}
                    {/* Capa de cartera, tres posiciones: apagada → por zona → por estado de hoy.
                        En escritorio el chip tiene lugar para DECIR en cuál está, así que lo dice
                        con todas las letras en vez de dejarlo en el color como hace el rail. */}
                    <div
                      onClick={alternarClientes}
                      title={
                        modoClientes === 'zona' ? (esHoy ? 'Cada comercio con el color de su zona. Tocá para ver el estado de hoy.' : 'Cada comercio con el color de su zona. Tocá para ver cómo vino ese día.')
                          : modoClientes === 'estado' ? (esHoy ? 'Cada comercio según cómo viene hoy: visitado, sin pedido, sin visitar. Tocá para ocultar.' : 'Cada comercio según cómo vino ese día: visitado, sin pedido, sin visitar. Tocá para ocultar.')
                            : 'Muestra los clientes geolocalizados de la cartera como puntos en el mapa.'
                      }
                      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: modoClientes === 'estado' ? 'var(--success)' : modoClientes === 'zona' ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${modoClientes !== 'off' ? 'transparent' : 'var(--line)'}`, color: modoClientes === 'estado' ? 'var(--on-success)' : modoClientes !== 'off' ? 'var(--on-primary)' : 'var(--muted)' }}
                    >
                      {modoClientes === 'estado' ? <Check size={15} /> : <Pin size={15} />}
                      <span style={{ fontSize: 12, fontWeight: 600 }}>
                        {modoClientes === 'estado' ? (esHoy ? 'Estado de hoy' : 'Estado del día') : 'Clientes'}{modoClientes !== 'off' && clientesCount ? ` · ${clientesCount}` : ''}
                      </span>
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
                      style={{ display: 'flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 10, cursor: 'pointer', background: seguirId ? 'var(--primary)' : 'var(--surface2)', border: `1px solid ${seguirId ? 'transparent' : 'var(--line)'}`, color: seguirId ? 'var(--on-primary)' : (objetivoSeguir ? 'var(--muted)' : 'var(--faint)') }}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.2" /><path d="M12 2v3.2M12 18.8V22M22 12h-3.2M5.2 12H2" /><circle cx="12" cy="12" r="8" /></svg>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{seguirId ? 'Siguiendo' : 'Centrar'}</span>
                    </div>
                    </PistaBoton>
                    {/* Pantalla completa */}
                    <BtnInmersivo activo={false} onToggle={() => { setInmersivo(true); setAcctOpen(false); setDrawerOpen(false) }} style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--surface2)', border: '1px solid var(--line)', boxShadow: 'none', backdropFilter: 'none', WebkitBackdropFilter: 'none', color: 'var(--muted)' }} />
                  </div>
                  )}

                  {/* Aviso si la carga de ubicaciones falló: antes un error dejaba el mapa vacío y
                      MUDO (no se distinguía de "no hay datos"). Ahora se ve y se puede reintentar.
                      Con puntos YA en pantalla (falló un tick de 60 s, no la carga) el aviso es chico y
                      ámbar: el mapa está bien, sólo no se actualizó. El rojo queda para el mapa vacío. */}
                  {recorridosError && (Object.keys(byUserCrudo).length ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 14px 12px', background: 'var(--warning-tint)', border: '1px solid var(--warning)', color: 'var(--text)', borderRadius: 12, padding: '8px 14px', fontSize: 12.5, fontWeight: 600 }}>
                      <AlertaCirculo size={16} color="var(--warning)" style={{ flex: 'none' }} />
                      <span style={{ flex: 1 }}>Ubicaciones sin actualizar{recorridosAt ? <> (<HaceSegundos ts={recorridosAt} />)</> : ''}. {textoDeErrorRecorridos(recorridosError)}</span>
                      <button onClick={doSync} style={{ flex: 'none', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--line2)', background: 'transparent', color: 'var(--deep)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reintentar</button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 14px 12px', background: 'var(--danger-tint)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '10px 14px', fontSize: 12.5, fontWeight: 600 }}>
                      <AlertaCirculo size={16} style={{ flex: 'none' }} />
                      <span style={{ flex: 1 }}>No se pudieron cargar las ubicaciones{esHoy ? ' de hoy' : ''}. {textoDeErrorRecorridos(recorridosError)}</span>
                      <button onClick={doSync} style={{ flex: 'none', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Reintentar</button>
                    </div>
                  ))}

                  {/* Mapa grande */}
                  <div style={inmersivo ? { flex: 1, minHeight: 0, position: 'relative' } : { padding: 0, position: 'relative' }}>
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
                      hitos={hitos}
                      // Prop suelta (no dentro de `dwells`): con el foco adentro, cada toque en una
                      // persona recalcularía `calcularDwells` — ~250 ms por persona-día.
                      focoId={foco?.id || null}
                      markers={mapMarkers}
                      clients={clientMarkers}
                      fit={!fitDone}
                      focus={focusData}
                      seguir={seguirData}
                      onSeguirCancelado={() => setSeguirId(null)}
                      // +65 a la derecha = media burbuja: el encuadre mide la COORDENADA y la
                      // burbuja de perfil mide 130 px de ancho, así que una persona encuadrada
                      // contra el borde quedaba con su burbuja abajo del rail.
                      edgePadding={{ top: 28, right: (inmersivo ? 28 + 44 + 16 : 28) + 65, bottom: inmersivo ? 28 + 96 : 28, left: 28 }}
                      onMarkerClick={(i) => { const m = moversFil[i]; if (m) { setPinId(m.id === pinId ? null : m.id); soltarComercio() } }}
                      // Tocar un comercio de la capa de cartera: abre su tarjeta (quién lo visitó y
                      // a qué hora) y suelta al móvil tocado.
                      onClientClick={(i) => { elegirComercio(i); setPinId(null) }}
                    />
                    {/* Referencia de colores de la capa de cartera (sólo en modo estado), corrida
                        a la derecha del control de zoom de Leaflet. */}
                    <LeyendaCartera modo={modoClientes} conteo={conteoEstado} zonasEnMapa={zonasEnMapa} sinUbicar={sinUbicarCartera} fecha={fecha} esHoy={esHoy} isDark={isDark} conTransporte={Object.keys(tramos).length > 0} deQuien={focoCartera ? nombres[focoCartera] : null} />
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
                        hayVelocidad={hayVelocidad}
                        velocidadOn={velocidadOn}
                        onVelocidad={() => setVelocidadOn((v) => !v)}
                        modoClientes={modoClientes}
                        clientesCount={clientesCount}
                        onClientes={alternarClientes}
                        seguirActivo={!!seguirId}
                        puedeSeguir={!!objetivoSeguir}
                        nombreSeguido={objetivoSeguir ? (nombres[objetivoSeguir.id] || null) : null}
                        onSeguir={alternarSeguir}
                      />
                    )}

                    {/* ===== CHROME DE ABAJO A LA IZQUIERDA: UNA SOLA COLUMNA =====
                        🩸 17/09/2026. Eran TRES piezas absolutas independientes —la tarjeta del
                        comercio (`bottom:132`), las paradas (`bottom:74`) y las burbujas del equipo
                        (`bottom:16`)— cada una adivinando la altura de las otras. Pero `BurbujasEquipo`
                        dibuja ARRIBA de los avatares la tarjeta de la persona tocada ("15.2 km · 22
                        paradas · última señal"), que queda a ~64 px del piso: justo donde caían los
                        números de las paradas. El cliente lo vio en la PWA de la computadora. Y con
                        vendedores Y repartidores la fila de equipo es doble, así que el 74 volvería a
                        quedar corto.

                        Es el mismo bug que SupervisionMovil arregló el 03/08/2026 y de la misma forma:
                        una columna, las piezas como hermanas en un flujo, nada puede pisar a nada. El
                        orden es el del gesto: abajo elegís a quién, arriba a dónde (paradas), y lo que
                        tocaste en el mapa (el comercio) queda arriba de todo.

                        `right: 76` reserva el rail compacto (44 + 16 + 16); fuera de inmersivo no hay
                        rail, pero la tarjeta del comercio topea en 380 y no lo nota.

                        `pointerEvents:'none'` en la columna (regla 30): ocupa todo el ancho a esta
                        altura y sin esto se tragaría los toques del mapa donde no hay contenido.
                        Cada hija se lo vuelve a encender. */}
                    <div style={{
                      position: 'absolute', left: 16, right: 76, bottom: 16,
                      zIndex: 'var(--z-chrome)', pointerEvents: 'none',
                      display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start',
                    }}>
                      {/* Tarjeta del comercio tocado en la capa de cartera: quién lo visitó y a
                          qué hora. */}
                      {comercioSel && (
                        <TarjetaComercio
                          key={`com-${comercioSel.id}`}
                          c={comercioSel}
                          modo={modoClientes}
                          nombres={nombres}
                          esHoy={esHoy}
                          isDark={isDark}
                          onClose={soltarComercio}
                          style={{ maxWidth: 380, pointerEvents: 'auto' }}
                        />
                      )}
                      {/* Paradas de la persona tocada. El componente devuelve null sin foco, así
                          que no hace falta otra condición. */}
                      {inmersivo && (
                        <BurbujasParadas
                          dwells={dwells}
                          focoId={foco?.id || null}
                          sel={dwellSel}
                          onIr={irAParada}
                          style={{ alignSelf: 'stretch' }}
                        />
                      )}
                      {/* Burbujas del equipo: en inmersivo se oculta la barra de filtros y las
                          métricas de abajo, así que este es el único acceso al enfoque por persona. */}
                      {inmersivo && (
                        <BurbujasEquipo
                          movers={moversFil}
                          nombres={nombres}
                          fotos={fotos}
                          byUser={byUser}
                          transporte={transporteAbierto}
                          focoId={foco?.id || null}
                          onSelect={(id) => (foco?.id === id ? setFoco(null) : enfocarUsuario(id))}
                          style={{ alignSelf: 'stretch' }}
                        />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* MÉTRICAS DEBAJO del mapa (Monitoreo) / expandidas (Dashboard). */}
              {view === 'dash' && (
                <Suspense fallback={<div style={{ padding: 24, color: 'var(--faint)', fontSize: 12.5 }}>Cargando el dashboard…</div>}>
                  <div style={{ marginBottom: 16 }}>
                    <DashboardEquipo layout="grid" horizonte={horizonteDash} onHorizonte={setHorizonteDash} nombres={nombres} onAbrirPersona={enfocarUsuario} activo={!!idEmpresaActiva} />
                  </div>
                </Suspense>
              )}
              <Metricas
                expanded={view === 'dash'}
                isMobile={isMobile}
                moversArr={moversArr}
                nombres={nombres}
                byUser={byUser}
                filter={filter}
                pasaFiltro={pasaFiltro}
                onSelectUsuario={enfocarUsuario}
                incidencias={
                  <TarjetaIncidencias
                    alertas={avisos.alertas}
                    nombres={nombres}
                    onMarcarVista={avisos.marcarVista}
                    onEnfocar={enfocarAviso}
                  />
                }
              />
            </div>
          )}
        </main>
      </div>

      <MenuCuenta
        open={acctOpen}
        onClose={() => setAcctOpen(false)}
        onToast={showToast}
        presentacion={isMobile ? 'hoja' : 'popover'}
        onIrAJornada={onIrAJornada}
      />

      {/* Modales de alta (se abren desde Clientes / Catálogo). */}
      {(modalCliente || modalProducto) && (
        <Suspense fallback={null}>
          {modalCliente && <NuevoCliente onClose={() => setModalCliente(false)} onToast={showToast} center={null} />}
          {/* `true` = alta; un objeto producto = edición (mismo patrón que AdminView). */}
          {modalProducto && <NuevoProducto onClose={() => setModalProducto(false)} onToast={showToast} producto={modalProducto === true ? null : modalProducto} />}
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
// `incidencias` (02/10/2026, C7): la tarjeta de la hoja SupervisionEscritorio, arriba de "Equipo en la
// calle" en la columna derecha — lo que está mal AHORA queda junto a quién está en la calle.
function Metricas({ expanded, isMobile, moversArr, nombres, byUser, filter, pasaFiltro, onSelectUsuario, incidencias = null }) {
  const dosColumnas = !isMobile && !expanded
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: dosColumnas ? '1fr 1fr' : '1fr' }}>
      {/* En una sola columna las incidencias van primero. */}
      {!dosColumnas && incidencias}

      {/* Estado del equipo · por qué no llega la señal. Click → enfoca su recorrido en el mapa. */}
      <div><EstadoEquipo onSelectUsuario={onSelectUsuario} /></div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {dosColumnas && incidencias}
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

// Chip de filtro (variante escritorio: sólido, sin glass flotante).
function Chip({ on, dim, color, dotRadius, count, label, onClick }) {
  return (
    <div onClick={onClick} style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 7, padding: '8px 13px', borderRadius: 10, cursor: 'pointer', background: on ? color : 'var(--surface2)', border: `1px solid ${on ? 'transparent' : 'var(--line)'}`, color: on ? 'var(--on-primary)' : (dim ? 'var(--faint)' : 'var(--text)') }}>
      <span style={{ width: 8, height: 8, borderRadius: dotRadius, background: on ? 'var(--on-primary)' : color, flex: 'none' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
      <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  )
}

