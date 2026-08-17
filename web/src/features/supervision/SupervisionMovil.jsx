import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { useAuth } from '../../context/AuthContext'
import { useTenant } from '../../context/TenantContext'
import { useCatalog } from '../../context/CatalogContext'
import { colorPorId } from '../../lib/colors'
import { glassBlur } from '../../lib/glass'
import { hoyStr } from '../../lib/format'
import { calcularDwells } from './dwells'
import { construirFines, construirInicios, construirLeaflet, construirTrails, limpiarPorUsuario, totalDescartados } from './trazos'
import MetricasEquipo, { kmDeTrazo, metricasParadas } from './MetricasEquipo'
import { fetchSnapRecorridos } from '../../services/recorridos'
import { apilarAtras } from '../../services/atras'
import { GESTION_TITLES, itemsDeGestion } from '../../lib/gestion'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import useRecorridosDelDia from '../../hooks/useRecorridosDelDia'
import useEmpresaBase from '../../hooks/useEmpresaBase'
import useAlertasEquipo from '../../hooks/useAlertasEquipo'
import AlertasEquipo from '../../components/AlertasEquipo'
import SelectorEmpresa from '../../components/SelectorEmpresa'
import LeafletMap from '../../components/LeafletMap'
import BtnInmersivo from '../../components/BtnInmersivo'
import Logo from '../../components/Logo'
import Overlay from '../../components/Overlay'
import HaceSegundos from '../../components/HaceSegundos'
import EstadoEquipo from './components/EstadoEquipo'
import BurbujasEquipo from './components/BurbujasEquipo'
import RailMapa, { RAIL_W } from './components/RailMapa'
import TarjetaPin from './components/TarjetaPin'
import GestionHost from '../../components/GestionHost'
import DespachoGestion from './components/DespachoGestion'
import { App as CapApp } from '@capacitor/app'
import { APP_VERSION } from '../../version'

// Las vistas de gestión (Clientes, Zonas, Catálogo, …) se despachan desde un módulo compartido con
// SupervisionDesktop y PanelDireccion: acá solo se dice CUÁL abrir, no cómo construirla (regla 31).
import InvitarModal from '../../components/InvitarModal'
const NuevoCliente = lazy(() => import('../catalog/NuevoCliente'))
const NuevoProducto = lazy(() => import('../catalog/NuevoProducto'))
const MiPerfilModal = lazy(() => import('../perfil/MiPerfilModal'))

/**
 * Pantalla de SUPERVISIÓN MÓVIL (full-screen, nativa / APK). Implementa el diseño
 * del handoff (SupervisionMovil.dc.html): mapa a pantalla completa como capa base y
 * "chrome" de vidrio flotando encima (header, chips, bottom-nav, bottom-sheet).
 *
 * La ve el ENCARGADO (supervisor operativo) y los gestores (admin/superadmin) en el APK. En web un
 * gestor no llega acá: en PC va a `SupervisionDesktop` y en celular al `PanelDireccion`.
 *
 * El "mapa principal" muestra los RECORRIDOS del día (trazos por persona) + los
 * móviles en vivo como pines. Datos reales por empresa (RLS aísla el tenant).
 *
 * props:
 *   - role         'encargado' | 'admin' | 'superadmin'
 *   - onIrAJornada () => void | null   (solo encargado: volver a "Mi jornada")
 *
 * Las funciones de gestión (Clientes, Zonas, Catálogo, Faltante, Invitar, Usuarios,
 * Empresas) se abren NATIVAS desde el botón "Menú" (GestionHost). Ya no se navega al
 * AdminView de escritorio (PWA) desde la APK.
 */
const REFRESH_MS = 60000
const initials = (n) => (n || '?').split(' ').map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase()

// Métricas del chrome flotante. Antes vivían como literales sueltos (56/64/70/72/84/86/142)
// repetidos en 9 calc() con env(safe-area-*). Los offsets se expresan RELATIVOS a estas
// constantes para que el layout siga siendo coherente si cambia el alto del header/nav.
const NAV_H = 56    // alto de la bottom-nav (sin safe-area)
const HEADER_H = 56 // alto del header glass (sin safe-area)
const PIN_ZOOM_KEY = 'lu-pin-zoom' // tamaño elegido para la tarjeta del pin (1 | 1.5)
const safeTop = (px) => `calc(${px}px + env(safe-area-inset-top))`
const safeBottom = (px) => `calc(${px}px + env(safe-area-inset-bottom))`

const glass = glassBlur // alias local: este archivo lo usa ~10 veces como `...glass`


// Acciones de gestión que abren en pantalla nativa (GestionHost) desde el botón "Menú".
// Reemplazan al viejo "Panel de gestión" (AdminView / PWA). Gate por rol: Usuarios solo
// admin/superadmin; Empresas solo superadmin; el resto para todo gestor (incl. encargado).

export default function SupervisionMovil({ role = 'encargado', onIrAJornada = null }) {
  const { theme, isDark, toggleTheme } = useTheme()
  const { perfil, user, idEmpresa, permisos, signOut } = useAuth()
  const { nombres, fotos, roles, plantel, movers, gpsOff, mqttOn } = useEquipoEnVivo()
  // 🚨 SCOPE de LECTURA (regla 11): todo lo que CONSULTA usa `idEmpresaActiva`; la escritura de
  // GPS sigue clavada a `useAuth().idEmpresa` en GpsContext, que esta pantalla no toca.
  const { idEmpresaActiva, puedeCambiarScope, empresasDisponibles, setEmpresaActiva, esOverride, nombreActiva } = useTenant()
  const base = useEmpresaBase(idEmpresaActiva) // dónde abre el mapa (depósito de la empresa)
  // Incidentes abiertos del equipo (los abre el cron `alertas-equipo`, acá solo se leen).
  const avisos = useAlertasEquipo()
  const [section, setSection] = useState('mapa') // 'mapa' | 'dash'
  const [filter, setFilter] = useState(null)     // null | 'v' | 'r'
  const [pinId, setPinId] = useState(null)
  const [foco, setFoco] = useState(null)         // { id, nonce } — usuario a enfocar en el mapa
  const [acctOpen, setAcctOpen] = useState(false)
  const [plusOpen, setPlusOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [snapped, setSnapped] = useState({})     // { id: [{lat,lng}] } pegado a calles
  // 🩸 PRENDIDO POR DEFECTO desde el 03/08/2026 (antes arrancaba en crudo). Con un motor por modo
  // (ALGO 8) el snap ya cubre el día entero y no solo las caminatas, así que el trazo que se abre
  // es el que sigue la calle. Apagarlo devuelve el rastro crudo en un toque, y sigue siendo el que
  // hay que mirar para discutir un dato: el pegado es una reconstrucción plausible, no la medición.
  const [snapOn, setSnapOn] = useState(true)
  const [dwellOn, setDwellOn] = useState(true)   // carteles de permanencia sobre el mapa (default: encendidos)
  // Cartel de parada AMPLIADO (índice dentro de `dwells`) o null. Uno a la vez, y NO se persiste
  // —a diferencia de `pinK`—: ampliar una parada es el gesto de "mirá ésta", no una preferencia
  // que alguien quiera encontrarse mañana. Se limpia solo al cambiar de día o de filtro, porque
  // ahí el índice ya no apunta a la misma parada.
  const [dwellSel, setDwellSel] = useState(null)
  const [showClientes, setShowClientes] = useState(false) // capa de clientes geolocalizados (default: apagada)
  const [fitDone, setFitDone] = useState(false)  // encuadrar el mapa solo la 1ª vez
  const [fecha, setFecha] = useState(hoyStr)      // día visualizado en el mapa (default hoy)
  const [gestion, setGestion] = useState(null)   // vista de gestión abierta (Clientes, Zonas, …) o null
  const [apkVer, setApkVer] = useState(null)     // versión nativa del APK (para distinguir el fix nativo del OTA)
  const [modalCliente, setModalCliente] = useState(false)
  const [modalProducto, setModalProducto] = useState(false)
  const [modalPerfil, setModalPerfil] = useState(false)
  const [datePop, setDatePop] = useState(false)  // fallback: popover con el <input date> inline
  const [inmersivo, setInmersivo] = useState(false) // mapa a pantalla completa, sin chrome
  // SEGUIMIENTO: id de la persona a la que la cámara se queda pegada, o null.
  //
  // Es el SEGUNDO zoom del mapa, distinto del que ya había: tocar una burbuja encuadra TODO el
  // recorrido del día (`foco`), esto va a donde la persona está AHORA y se mueve con ella. Se
  // suelta tocando el botón de nuevo o arrastrando el mapa (LeafletMap escucha `dragstart`).
  const [seguirId, setSeguirId] = useState(null)
  // Sello del ÚLTIMO enganche pedido a mano (ver `alternarSeguir`). Viaja en `seguir.nonce`.
  const [seguirNonce, setSeguirNonce] = useState(0)
  // Escala de la tarjeta del pin: 1 (como siempre) o 1,5. Se PERSISTE porque no es una
  // preferencia del momento: el que necesita el tamaño grande lo necesita todos los días.
  // Leer 14,5 px a un brazo de distancia, con sol de frente y el teléfono en una mano, no se
  // puede — de ahí el pedido (28/07/2026).
  const [pinK, setPinK] = useState(() => {
    try { return localStorage.getItem(PIN_ZOOM_KEY) === '1.5' ? 1.5 : 1 } catch (_) { return 1 }
  })
  const toastRef = useRef(null)
  const dateRef = useRef(null)                   // <input type="date"> oculto (picker nativo)

  // Ítems del menú de gestión visibles para el rol actual.
  const gestionItems = useMemo(() => itemsDeGestion(role, permisos), [role, permisos])

  const esHoy = fecha === hoyStr()

  // ---- Recorridos del día elegido (trazos por persona). Auto-refresh incremental solo si es hoy. ----
  const { byUser: byUserCrudo, reload: recargarPosiciones, error: recorridosError } = useRecorridosDelDia(fecha, idEmpresaActiva, esHoy)

  // 🩸 EL RECORRIDO SE LIMPIA UNA SOLA VEZ Y DE ACÁ SALE TODO (30/07/2026): trazos, km, paradas y
  // el resumen del pin. Si alguna de esas cuatro leyera `byUserCrudo`, contaría un recorrido que
  // no existió — y es exactamente lo que pasaba: el 29/07 un vendedor figuraba con **524,8 km**
  // porque cuatro fixes falsos lo mandaban 127 km al norte y lo traían de vuelta. Su día real
  // fueron 17,9 km. Ver `limpiarTrazo` en lib/geo.js para el detalle de los dos filtros.
  //
  // `segmentos` (para dibujar) y `points` (para medir) salen de la MISMA pasada a propósito: son
  // dos vistas del mismo recorrido limpio, no dos cálculos que se puedan desincronizar.
  const byUser = useMemo(() => limpiarPorUsuario(byUserCrudo), [byUserCrudo])

  // Los descartes se REPORTAN. Un filtro silencioso que empieza a comerse puntos buenos es
  // indistinguible de uno que funciona bien; con esto queda el rastro en consola para poder
  // contrastarlo contra la base. Va en efecto y no en el memo para no loguear dos veces en StrictMode.
  const descartados = useMemo(() => totalDescartados(byUser), [byUser])
  useEffect(() => {
    if (descartados) console.info(`[recorridos] ${fecha}: ${descartados} punto(s) descartados por salto imposible`)
  }, [descartados, fecha])

  // Cartera geolocalizada → capa de contexto en el mapa (toggle). Memoizada: referencia estable
  // entre ticks para que LeafletMap no la redibuje cada segundo.
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
  // El "hace Xs" en vivo ya NO se refresca desde acá. Antes había un setInterval de 1 s
  // que hacía tick() sobre este componente y re-renderizaba el árbol entero (header,
  // rail, bottom-nav y el sheet completo) una vez por segundo, compitiendo con las
  // animaciones. Ahora cada etiqueta se refresca sola: ver components/HaceSegundos.jsx.
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

  // Click en una persona (lista del dashboard o del informe de estado) → cerrar el sheet,
  // volver al mapa y encuadrar SU recorrido del día. Si no tiene recorrido, cae a su
  // posición en vivo; si no hay ninguna, avisa. El nonce fuerza el re-enfoque aunque sea
  // el mismo usuario.
  const enfocarUsuario = useCallback((id) => {
    setSection('mapa')
    setPinId(id)
    setFoco({ id, nonce: Date.now() })
    // 🩸 Enfocar a OTRO suelta el seguimiento (03/08/2026). El foco hace un `flyToBounds` de 0,6 s
    // sobre el recorrido de la persona nueva, pero el seguimiento mueve la cámara EN CADA FRAME
    // desde adentro de la animación del pin (`alFrame` → `panTo`): el primer frame del que se venía
    // siguiendo cancelaba el vuelo, así que tocar a alguien no llevaba el mapa a su recorrido.
    // Pedir ver el recorrido de otro ES dejar de estar pegado al anterior; mismo criterio que
    // arrastrar el mapa, que ya lo suelta (LeafletMap escucha `dragstart`).
    setSeguirId((s) => (s && id && s !== id ? null : s))
  }, [])

  // Puntos a encuadrar para el usuario enfocado: su recorrido (byUser) o, si no tiene, su
  // último punto en vivo (movers). El toast de "sin recorrido" se dispara en un efecto aparte
  // para no correr efectos secundarios dentro del render.
  const focusData = useMemo(() => {
    if (!foco) return null
    const pts = byUser[foco.id]?.points
    if (pts && pts.length) return { points: pts, nonce: foco.nonce }
    const mv = movers[foco.id]
    if (mv) return { points: [{ lat: mv.lat, lng: mv.lng }], nonce: foco.nonce }
    return { points: [], nonce: foco.nonce }
  }, [foco, byUser, movers])

  // A quién centrar/seguir: el enfocado si hay uno, si no el móvil con la señal MÁS FRESCA.
  //
  // El fallback importa: sin nadie seleccionado el botón igual tiene que hacer algo útil, y "el que
  // acaba de reportar" es lo más cerca de "lo que está pasando ahora" que se puede elegir solo.
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

  // Coordenada que consume LeafletMap. Sale de `movers` y no del objetivo memoizado para que cada
  // posición nueva reenganche la cámara: eso es lo que da la sensación de "en vivo".
  const seguirData = useMemo(() => {
    if (!seguirId) return null
    const m = movers[seguirId]
    return m ? { id: seguirId, lat: m.lat, lng: m.lng, ts: m.ts, nonce: seguirNonce } : null
  }, [seguirId, seguirNonce, movers])

  const alternarSeguir = useCallback(() => {
    if (seguirId) { setSeguirId(null); return }
    if (!objetivoSeguir) { showToast('Nadie está reportando ubicación ahora'); return }
    setSeguirId(objetivoSeguir.id)
    // 🩸 El sello del enganche. Sin esto, apretar el botón no cambia ninguna coordenada y el efecto
    // de cámara de LeafletMap no llega a correr: con la persona quieta, "Centrar" no hacía nada
    // (reportado el 03/08/2026 como "hago zoom, toco centrar y el seguimiento ya no funciona").
    setSeguirNonce(Date.now())
    setPinId(objetivoSeguir.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seguirId, objetivoSeguir])

  // Cambiar de día suelta el seguimiento: en un día pasado no hay nada "en vivo" a lo que pegarse.
  useEffect(() => { if (!esHoy) setSeguirId(null) }, [esHoy])

  // Aviso si la persona enfocada no tiene nada que mostrar hoy (ni recorrido ni señal viva).
  useEffect(() => {
    if (foco && focusData && focusData.points.length === 0) showToast('Sin recorrido de esa persona hoy')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco && foco.nonce])

  // Trazos (>=2 puntos) filtrados por chip. La lógica vive en ./trazos, compartida con Desktop.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trails = useMemo(() => construirTrails(byUser, pasaFiltro), [byUser, filter])

  // Paradas → carteles sobre el mapa. La lógica vive en ./dwells (compartida con Desktop,
  // que antes no los tenía porque estaban cableados solo acá). Mismo filtro por chip y mismo
  // color por persona que los trazos.
  //
  // `useDeferredValue`: detectar paradas sobre una jornada real (2.982 puntos) cuesta ~250 ms
  // en una PC → 1,5-2 s en un teléfono, y corría en el mismo render que el trazo: el mapa
  // entero se congelaba esperando los carteles. Diferido, React pinta el recorrido primero y
  // recalcula los carteles en un render de baja prioridad. Los carteles aparecen un instante
  // después en vez de retrasar TODO. No se puede decimar los puntos como atajo: el detector
  // necesita la densidad para medir cuánto duró cada parada.
  const byUserDiferido = useDeferredValue(byUser)
  const dwells = useMemo(
    () => (dwellOn ? calcularDwells(byUserDiferido, pasaFiltro, cartera) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [byUserDiferido, filter, dwellOn, cartera]
  )
  // `dwellSel` es un ÍNDICE dentro de `dwells`. Cambiar de día o de filtro rehace la lista entera,
  // así que ese índice pasa a señalar otra parada — la de otra persona, en otro lugar. Limpiarlo en
  // un efecto (y no en cada handler) cubre también los caminos que se agreguen después.
  useEffect(() => { setDwellSel(null) }, [fecha, filter, dwellOn])

  // Móviles en vivo → pines clickeables (marcadores del mapa). Solo tienen sentido HOY
  // (son la posición "ahora"); en un día pasado se muestran únicamente los recorridos.
  // Memoizado: sin esto el array salía nuevo en cada render del padre (cambio de filtro, de
  // sección, de modo inmersivo) y le llegaba distinto a LeafletMap aunque nada hubiera cambiado.
  const mapMarkers = useMemo(() => (esHoy ? moversFil.map((m) => ({
    id: m.id, lat: m.lat, lng: m.lng, label: initials(nombres[m.id] || m.rol),
    color: colorPorId(m.id), labelColor: '#fff', title: nombres[m.id] || m.rol,
    // Burbuja de perfil (Life360): foto del perfil o iniciales, con frescura por ts.
    bubble: true, foto: fotos[m.id], ts: m.ts,
    selected: m.id === pinId,
  })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [esHoy, movers, filter, nombres, fotos, pinId])
  // Geometría final del mapa (simplificación, snap, foco y conectores de hueco): ./trazos.
  // Memoizado: sin esto se rehace en cada render, y el padre re-renderiza con cada posición que
  // llega por Realtime.
  const leafletTrails = useMemo(
    () => construirLeaflet({ trails, snapped, snapOn, focoId: foco?.id || null }),
    [trails, snapOn, snapped, foco]
  )
  // Marcador "▶ 08:47" en el arranque de cada jornada (./trazos, compartido con Desktop). Sale de
  // `trails`, así que ya viene filtrado por chip y con los puntos limpios. Barato (una entrada por
  // persona), pero memoizado igual: el padre re-renderiza con cada posición que llega por Realtime.
  const inicios = useMemo(() => construirInicios(trails), [trails])
  // Y su simétrico "■ 17:20" en el último punto del día. ⚠️ Último punto RECIBIDO, no fin declarado.
  const fines = useMemo(() => construirFines(trails), [trails])
  const pin = moversArr.find((m) => m.id === pinId) || null

  // % de batería del móvil seleccionado. El `pin` sale de `movers` (useEquipoEnVivo), cuyo
  // select NO trae `bateria`, así que la sacamos del último punto con dato del recorrido del
  // día (byUser). Se recorre de atrás para adelante porque el último fix puede no tenerlo.
  //
  // GUARD DE FRESCURA (24/07/2026): solo se acepta batería de puntos de los últimos 30 min. Sin esto,
  // cuando los puntos recientes venían con `bateria=null` (el uploader nativo <1.5.48 no la mandaba),
  // el escaneo hacia atrás encontraba un valor de HORAS antes y mostraba una batería rancia y falsa
  // (Gabriel figuraba 92% teniendo 78%). Al pasar la ventana → null (no se muestra nada, ni "—" ni "0%").
  const pinBateria = useMemo(() => {
    const pts = (pinId && byUser[pinId]?.points) || null
    if (!pts) return null
    const limite = Date.now() - 30 * 60000
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i]
      const t = p?.ts ? new Date(p.ts).getTime() : 0
      if (t && t < limite) break // ya entramos en puntos viejos: nada fresco → sin dato
      const b = p?.bateria
      if (b !== null && b !== undefined) return b
    }
    return null
  }, [pinId, byUser])

  // Alterna el tamaño de la tarjeta del pin y lo deja guardado.
  const togglePinK = useCallback(() => {
    setPinK((k) => {
      const nuevo = k === 1 ? 1.5 : 1
      // Modo privado / almacenamiento lleno: el tamaño igual vale para esta sesión.
      try { localStorage.setItem(PIN_ZOOM_KEY, String(nuevo)) } catch (_) { /* no pasa nada */ }
      return nuevo
    })
  }, [])

  // Resumen del día de la persona del pin: km recorridos y paradas. Solo se calcula con la
  // tarjeta AMPLIADA — agrandarla sirve para mostrar más, no solo para mostrar lo mismo más
  // grande. Y el detector de paradas cuesta ~250 ms sobre una jornada real (ver MetricasEquipo),
  // así que no puede correr mientras la tarjeta está chica.
  const pinResumen = useMemo(() => {
    if (!pinId || pinK === 1) return null
    const pts = byUser[pinId]?.points
    if (!pts || pts.length < 2) return null
    return { km: kmDeTrazo(pts), paradas: metricasParadas(pts) }
  }, [pinId, pinK, byUser])

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

  // Tocar un aviso de la campanita → ver a esa persona en el mapa.
  //
  // Los incidentes son SIEMPRE de hoy (la ventana de rastreo se cierra a la noche), así que si se
  // está mirando un día pasado hay que volver: enfocar sobre otra fecha mostraría un recorrido que
  // no es el del aviso, y sería peor que no hacer nada.
  const enfocarAviso = (a) => {
    if (!a) return
    if (fecha !== hoyStr()) cambiarFecha(hoyStr())
    enfocarUsuario(a.id_usuario)
  }

  function doSync() {
    if (syncing) return
    setSyncing(true)
    Promise.resolve(recargarPosiciones()).finally(() => setTimeout(() => { setSyncing(false); showToast('Ubicaciones actualizadas · hace 0s') }, 700))
  }

  const nombre = perfil?.nombre || user?.email || 'Usuario'
  const roleLabel = { encargado: 'Encargado', admin: 'Administrador', superadmin: 'Superadmin' }[role] || 'Supervisión'
  const title = section === 'mapa' ? 'Monitoreo en vivo' : 'Dashboard total'
  const cerrarTodo = () => { setPlusOpen(false); setAcctOpen(false); setDatePop(false); setPinId(null) }

  // Modo INMERSIVO: el mapa a pantalla completa, sin header, sin rail y sin bottom-nav.
  //
  // Al entrar se cierra todo lo que esté abierto (si no, un popover quedaría flotando sobre un
  // mapa sin el chrome que le da referencia) y se fuerza la sección 'mapa': entrar en inmersivo
  // desde el Dashboard mostraría el sheet tapando justo lo que se quería ver.
  //
  // La tarjeta del pin NO se oculta: es información sobre lo que el usuario acaba de tocar, no un
  // control. Ocultarla haría que tocar un móvil en inmersivo no tuviera ningún efecto visible.
  const entrarInmersivo = () => { cerrarTodo(); setSection('mapa'); setInmersivo(true) }

  // Botón ATRÁS de Android. Esta pantalla no apilaba nada, así que el atrás minimizaba la app
  // (services/atras.js con pila vacía → minimizeApp, regla 27). En inmersivo eso sería
  // desconcertante: la salida natural de "pantalla completa" es el atrás.
  useEffect(() => {
    if (!inmersivo) return
    return apilarAtras(() => setInmersivo(false))
  }, [inmersivo])

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, background: 'var(--map-bg)', color: 'var(--text)', fontFamily: 'var(--font-body)', overflow: 'hidden', userSelect: 'none' }}>

      {/* ===== CAPA 0 · MAPA =====
          isolation:isolate crea un stacking context propio → confina los z-index internos
          de Leaflet (panes/controles 200–1000) DEBAJO del chrome (header/chips/nav), si no
          el mapa tapa los menús. */}
      <div style={{ position: 'absolute', top: inmersivo ? 0 : safeTop(HEADER_H), bottom: inmersivo ? 0 : safeBottom(NAV_H), left: 0, right: 0, isolation: 'isolate' }}>
        <LeafletMap
          theme={theme}
          height="100%"
          radius={0}
          center={base}
          trails={leafletTrails.length ? leafletTrails : null}
          markers={mapMarkers}
          clients={showClientes ? clientMarkers : []}
          dwells={dwells}
          dwellSel={dwellSel}
          onDwellClick={(i) => setDwellSel((s) => (s === i ? null : i))}
          inicios={inicios}
          fines={fines}
          // Prop suelta (no dentro de `dwells`): con el foco adentro, cada toque en una persona
          // recalcularía `calcularDwells` — ~250 ms por persona-día. Ver el 🩸 en LeafletMap.
          focoId={foco?.id || null}
          fit={!fitDone}
          focus={focusData}
          seguir={seguirData}
          onSeguirCancelado={() => setSeguirId(null)}
          // Reserva para el chrome que flota encima. A la derecha, el rail MÁS media burbuja: el
          // encuadre mide la COORDENADA y la burbuja de perfil mide 130 px de ancho, así que una
          // persona encuadrada justo contra el borde quedaba con su burbuja metida abajo de los
          // botones. Abajo, la columna de la tarjeta + las burbujas del equipo (§2).
          edgePadding={{
            top: 16,
            right: RAIL_W + 24 + 65,
            bottom: 24 + (pin ? (pinK > 1 ? 150 : 84) : 0) + (inmersivo ? 96 : 0),
            left: 16,
          }}
          onMarkerClick={(i) => { const m = moversFil[i]; if (m) { setPinId(m.id); setPlusOpen(false); setAcctOpen(false) } }}
        />

        {/* estado vacío / de ERROR del overlay. Antes un fallo de carga se veía IGUAL que "no hay
            datos" (mapa vacío mudo): ahora se distingue y se puede reintentar. */}
        {recorridosError ? (
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 250, textAlign: 'center', background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--danger)', borderRadius: 16, padding: '20px 18px', boxShadow: 'var(--shadow-lg)' }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14, color: 'var(--danger)' }}>No se pudieron cargar las ubicaciones</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>{recorridosError.message || 'Error de red o de sesión.'}</div>
            <button onClick={() => recargarPosiciones()} style={{ marginTop: 12, padding: '8px 16px', borderRadius: 10, border: '1px solid var(--danger)', background: 'transparent', color: 'var(--danger)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Reintentar</button>
          </div>
        ) : !mapMarkers.length && !trails.length && (
          <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 240, textAlign: 'center', background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 16, padding: '20px 18px', boxShadow: 'var(--shadow-lg)' }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}><path d="M12 21s-7-6.7-7-11a7 7 0 0 1 14 0c0 4.3-7 11-7 11Z" /><circle cx="12" cy="10" r="2.4" /></svg>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 14 }}>{esHoy ? 'Sin personal en la calle' : 'Sin recorridos ese día'}</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.4 }}>{esHoy ? 'Cuando vendedores o repartidores inicien jornada, aparecerán acá en vivo.' : 'No hay recorridos registrados para la fecha elegida. Probá con otro día o volvé a “Hoy”.'}</div>
          </div>
        )}
      </div>

      {/* ===== HEADER GLASS ===== */}
      {!inmersivo && (
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 'var(--z-chrome)', background: 'var(--glass-bg)', ...glass, borderBottom: '0.5px solid var(--glass-brd)', paddingTop: 'env(safe-area-inset-top)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px 11px' }}>
          <Logo size={34} radius={11} />
          <div style={{ textAlign: 'center', lineHeight: 1.15 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15 }}>{title}</div>
            <div style={{ fontSize: 9.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 1 }}>
              <span style={{ width: 5, height: 5, borderRadius: 99, background: mqttOn ? 'var(--success)' : 'var(--faint)', animation: mqttOn ? 'lu-blink 2s infinite' : 'none' }} />{roleLabel} · en vivo
            </div>
            {/* Mirando OTRA empresa: el aviso va en el header y no escondido en un menú, porque de
                otro modo es facilísimo sacar conclusiones sobre el equipo equivocado. */}
            {esOverride && (
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.04em', color: 'var(--warning)', fontFamily: 'var(--font-mono)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>
                {nombreActiva || 'otra empresa'}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Campanita de avisos: quién dejó de reportar y quién lleva demasiado parado. El push
                ya se lo mandó `alertas-equipo`, pero esto es el registro — y en la PWA de escritorio
                es lo ÚNICO que hay, porque una web no recibe FCM. */}
            <AlertasEquipo
              alertas={avisos.alertas}
              sinVer={avisos.sinVer}
              nombres={nombres}
              onMarcarVista={avisos.marcarVista}
              onEnfocar={enfocarAviso}
            />
            <div onClick={() => { setAcctOpen((v) => !v); setPlusOpen(false); setPinId(null) }} style={{ width: 34, height: 34, borderRadius: 99, background: 'var(--tlight)', color: 'var(--deep)', border: `1.5px solid ${acctOpen ? 'var(--primary)' : 'var(--line2)'}`, display: 'grid', placeItems: 'center', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 12.5, position: 'relative' }}>
              {initials(nombre)}
              <span style={{ position: 'absolute', bottom: -1, right: -1, width: 9, height: 9, borderRadius: 99, background: 'var(--success)', border: '2px solid var(--glass-bg)' }} />
            </div>
          </div>
        </div>
      </div>
      )}

      {/* ===== PANEL DE CUENTA ===== */}
      {acctOpen && (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-popover)' }}>
          <div onClick={() => setAcctOpen(false)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'var(--scrim)' }} />
          <div style={{ position: 'absolute', top: safeTop(HEADER_H + 8), right: 12, left: 56, background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }} className="lu-rise">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 15px 13px' }}>
              <div style={{ width: 46, height: 46, flex: 'none', borderRadius: 14, background: 'var(--tlight)', color: 'var(--deep)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>{initials(nombre)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombre}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 1 }}>{roleLabel} · {user?.email || ''}</div>
                <div style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>App v{APP_VERSION}{apkVer ? ` · APK ${apkVer}` : ''}</div>
              </div>
            </div>
            <div style={{ height: '0.5px', background: 'var(--glass-brd)' }} />
            {/* Selector de empresa (solo superadmin con más de una). Va en el menú de cuenta y no
                en el rail: es una decisión de sesión, no un control del mapa que se toque seguido. */}
            {puedeCambiarScope && (
              <div style={{ padding: '10px 12px 4px' }}>
                <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>Estás mirando</div>
                <SelectorEmpresa style={{ width: '100%' }} />
              </div>
            )}
            <div style={{ padding: 6 }}>
              {onIrAJornada && (
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
      {Object.values(gpsOff).length > 0 && section === 'mapa' && !inmersivo && (
        <div style={{ position: 'absolute', top: safeTop(HEADER_H + 16), left: 14, right: 14, zIndex: 'var(--z-chrome)', background: 'var(--danger-tint)', ...glass, border: '0.5px solid var(--danger)', color: 'var(--danger)', borderRadius: 12, padding: '9px 12px', fontSize: 11.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, boxShadow: 'var(--shadow-lg)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
          {Object.values(gpsOff).map((u) => `${u.nombre} (${u.rol})`).join(', ')} · GPS desactivado
        </div>
      )}

      {/* ===== RAIL DE CONTROLES (vertical, abajo a la derecha) =====
          El markup vive en ./components/RailMapa (regla 31: lo comparten esta pantalla, su modo
          inmersivo y el mapa del panel de dirección).

          🩸 EN INMERSIVO YA NO DESAPARECE (30/07/2026). Antes todo el rail estaba envuelto en
          `{!inmersivo && …}`, así que al abrir el mapa a pantalla completa se iban los botones de
          clientes, paradas, calles y el selector de fecha — justo cuando el mapa es lo único que
          se está mirando. Ahora pasa a modo `compacto`: quedan los controles de LECTURA y se van
          los de operación (filtros por rol, sincronizar). */}
      <RailMapa
        compacto={inmersivo}
        style={{ position: 'absolute', right: 12, bottom: safeBottom(inmersivo ? 14 + RAIL_W + 8 : NAV_H + 14), zIndex: 'var(--z-chrome)' }}
        filter={filter}
        vendCount={vendCount}
        repCount={repCount}
        onFiltro={(f) => { setFilter(f); setPinId(null) }}
        fecha={fecha}
        esHoy={esHoy}
        isDark={isDark}
        dateRef={dateRef}
        onAbrirFecha={abrirFecha}
        onCambiarFecha={cambiarFecha}
        hayTrazos={trails.length > 0}
        snapOn={snapOn}
        onSnap={() => setSnapOn((v) => !v)}
        dwellOn={dwellOn}
        onDwell={() => setDwellOn((v) => !v)}
        showClientes={showClientes}
        clientesCount={clientMarkers.length}
        onClientes={() => setShowClientes((v) => !v)}
        seguirActivo={!!seguirId}
        puedeSeguir={!!objetivoSeguir}
        nombreSeguido={objetivoSeguir ? (nombres[objetivoSeguir.id] || null) : null}
        onSeguir={alternarSeguir}
        syncing={syncing}
        onSync={doSync}
        onInmersivo={entrarInmersivo}
      />

      {/* En inmersivo queda ESTE botón y nada más. Se posiciona contra el borde real de la
          pantalla (ya no hay bottom-nav que lo empuje) respetando la safe-area. */}
      {inmersivo && (
        <BtnInmersivo
          activo
          onToggle={() => setInmersivo(false)}
          style={{ position: 'absolute', right: 12, bottom: safeBottom(14), zIndex: 'var(--z-chrome)' }}
        />
      )}

      {/* ===== CHROME DE ABAJO: UNA SOLA COLUMNA =====
          🩸 03/08/2026. Antes eran DOS piezas absolutas independientes —la tarjeta del pin y las
          burbujas del equipo— cada una adivinando las medidas de la otra y del rail. La tarjeta
          había quedado con `right: 14` (todo el ancho) y `--z-popover`, que son las medidas de
          cuando el rail DESAPARECÍA en pantalla completa; el 30/07 se lo hizo quedar y esto no se
          actualizó. Resultado: a pantalla completa la tarjeta tapaba los dos botones de abajo del
          rail —está 100 puntos de z por encima— y además se montaba sobre las burbujas.

          Como columna, el ancho del rail queda reservado POR CONSTRUCCIÓN en los dos modos y nada
          puede pisar a nada: son hermanas en un flujo, no capas superpuestas. No hay dos números
          que se puedan desincronizar otra vez.

          `pointerEvents:'none'` en el contenedor (regla 30): ocupa todo el ancho a esta altura y
          sin esto se tragaría los toques del mapa donde no hay contenido. Cada hija se lo vuelve
          a encender. */}
      <div style={{
        position: 'absolute', left: 14, right: RAIL_W + 24,
        bottom: safeBottom(inmersivo ? 14 : NAV_H + 14),
        zIndex: 'var(--z-chrome)', pointerEvents: 'none',
        display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start',
      }}>
        {/* TARJETA DEL PIN — quién es el móvil que se acaba de tocar. En inmersivo se mantiene (es
            información sobre lo que el usuario acaba de tocar, no un control). El contenido vive en
            ./components/TarjetaPin; acá queda solo dónde va.

            El `key` es el que hace la animación: al cambiar `pinK`, React remonta la tarjeta y
            `lu-rise` se vuelve a ejecutar, o sea que "vuelve a entrar" con su nuevo tamaño. */}
        {pin && (
          <TarjetaPin
            key={`pin-${pin.id}-${pinK}`}
            pin={pin}
            nombre={nombres[pin.id]}
            bateria={pinBateria}
            resumen={pinResumen}
            k={pinK}
            onToggle={togglePinK}
            onClose={() => setPinId(null)}
            style={{ alignSelf: 'stretch', pointerEvents: 'auto' }}
          />
        )}

        {/* BURBUJAS DEL EQUIPO (solo en inmersivo): con el chrome escondido, es el único acceso al
            enfoque por persona. */}
        {inmersivo && (
          <BurbujasEquipo
            movers={moversFil}
            nombres={nombres}
            fotos={fotos}
            byUser={byUser}
            focoId={foco?.id || null}
            onSelect={(id) => (foco?.id === id ? setFoco(null) : enfocarUsuario(id))}
            style={{ alignSelf: 'stretch' }}
          />
        )}
      </div>

      {/* Fallback final del selector de fecha: WebView sin showPicker() ni click() programático
          → input inline visible para que el usuario lo toque él mismo. */}
      {datePop && (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-popover)' }}>
          <div onClick={() => setDatePop(false)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'var(--scrim)' }} />
          <div style={{ position: 'absolute', right: RAIL_W + 20, bottom: safeBottom(NAV_H + 14), background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', padding: '10px 12px' }} className="lu-rise">
            <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 6 }}>Fecha</div>
            <input
              type="date" value={fecha} max={hoyStr()} autoFocus
              onChange={(e) => cambiarFecha(e.target.value)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text)', fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-body)', outline: 'none', minHeight: 32, colorScheme: isDark ? 'dark' : 'light' }}
            />
          </div>
        </div>
      )}

      {/* ===== BOTTOM NAV ===== */}
      {!inmersivo && (
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 'var(--z-chrome)', background: 'var(--glass-bg)', ...glass, borderTop: '0.5px solid var(--glass-brd)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'space-around', padding: '8px 10px 8px' }}>
          <NavBtn active={section === 'mapa'} label="Mapa" onClick={() => { setSection('mapa'); cerrarTodo() }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 20 3 17V4l6 3 6-3 6 3v13l-6-3-6 3z" /><path d="M9 7v13M15 4v13" /></svg>
          </NavBtn>
          <NavBtn active={section === 'dash'} label="Dashboard" onClick={() => { setSection('dash'); setPlusOpen(false); setAcctOpen(false); setPinId(null) }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><rect x="7" y="12" width="3" height="6" rx="1" /><rect x="12.5" y="8" width="3" height="10" rx="1" /><rect x="18" y="5" width="3" height="13" rx="1" /></svg>
          </NavBtn>
          <NavBtn active={plusOpen} label="Menú" onClick={() => { setPlusOpen((v) => !v); setPinId(null); setAcctOpen(false) }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h11M3 18h11" /><path d="M18 15v6M15 18h6" /></svg>
          </NavBtn>
        </div>
      </div>
      )}

      {/* ===== MENÚ "+" (encargado) ===== */}
      {plusOpen && (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-popover)' }}>
          <div onClick={() => setPlusOpen(false)} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, background: 'var(--scrim)' }} />
          <div style={{ position: 'absolute', right: 12, bottom: safeBottom(NAV_H + 28), width: 236, maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 18, boxShadow: 'var(--shadow-lg)', padding: 7 }} className="lu-rise">
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

      {/* ===== BOTTOM-SHEET · DASHBOARD =====
           Antes esto entraba con `lu-rise .26s` = translateY(18px). Un panel que ocupa
           el 78% de la pantalla deslizando 18 píxeles se lee como un parpadeo, no como
           una hoja que sube — era la animación "fea" del dashboard. Ahora usa el Overlay
           compartido (variant="sheet" → translateY(100%) con la curva de drawer iOS), y
           además gana lo que ningún overlay de la app tenía: animación de SALIDA. */}
      <Overlay
        open={section === 'dash'}
        onClose={() => setSection('mapa')}
        variant="sheet"
        glass
        title="Dashboard"
        subtitle="Jornada en curso"
      >
      {/* Informe: por qué no llega la señal (lo ve también el panel de dirección). Click en una
          persona → cierra el sheet y encuadra su recorrido. */}
      <div style={{ marginBottom: 10 }}><EstadoEquipo onSelectUsuario={enfocarUsuario} /></div>

      {/* Equipo en la calle (real) */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 14, marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <span style={sheetLabel}>Equipo en la calle</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, color: 'var(--deep)' }}>{moversArr.length} en vivo</span>
        </div>
        {moversArr.length === 0 ? (
          <div style={{ padding: '10px 2px', fontSize: 12, color: 'var(--faint)' }}>Nadie está compartiendo ubicación ahora.</div>
        ) : moversArr.map((m) => (
          <div key={m.id} onClick={() => enfocarUsuario(m.id)} className="lu-press" role="button" title="Ver su recorrido en el mapa" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
            <span style={{ width: 12, height: 12, flex: 'none', borderRadius: 99, background: colorPorId(m.id), boxShadow: `0 0 0 4px ${colorPorId(m.id)}22` }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nombres[m.id] || m.rol}</div>
              <div style={{ fontSize: 10, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{m.rol}</div>
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}><HaceSegundos ts={m.ts} /></div>
          </div>
        ))}
      </div>

      {/* Métricas reales del día: km + tiempo de parada por persona (Feature B). */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={sheetLabel}>Rendimiento del día</span>
          <span style={{ fontSize: 10, color: 'var(--faint)' }}>km · tiempo de parada</span>
        </div>
        <MetricasEquipo byUser={byUser} nombres={nombres} pasaFiltro={pasaFiltro} filter={filter} onSelect={enfocarUsuario} />
      </div>
      </Overlay>

      {/* ===== GESTIÓN (pantalla nativa, abierta desde el botón "Menú") ===== */}
      {/* 'invitar' NO usa GestionHost: es una ventana flotante (InvitarModal), se maneja abajo. */}
      {gestion && gestion !== 'invitar' && (
        <GestionHost title={GESTION_TITLES[gestion]} onClose={() => { setGestion(null); setModalCliente(false); setModalProducto(false) }}>
          <DespachoGestion
            vista={gestion}
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
              onVerEnMapa: (id) => { setGestion(null); enfocarUsuario(id) },
            }}
            onToast={showToast}
            onNuevoCliente={() => setModalCliente(true)}
            onNuevoProducto={() => setModalProducto(true)}
            onEditarProducto={(p) => setModalProducto(p)}
          />
        </GestionHost>
      )}

      {/* Invitar: ventana flotante con el QR de descarga (encargado/admin/superadmin). */}
      <InvitarModal open={gestion === 'invitar'} onClose={() => setGestion(null)} onToast={showToast} />

      {/* Modales de alta (se abren desde Clientes / Catálogo). Van por Overlay, que
          los pone en --z-modal (500), por encima del GestionHost (--z-screen, 400). */}
      {(modalCliente || modalProducto || modalPerfil) && (
        <Suspense fallback={null}>
          {modalCliente && <NuevoCliente onClose={() => setModalCliente(false)} onToast={showToast} center={null} />}
          {/* `true` = alta; un objeto producto = edición (mismo patrón que AdminView). */}
          {modalProducto && <NuevoProducto onClose={() => setModalProducto(false)} onToast={showToast} producto={modalProducto === true ? null : modalProducto} />}
          {modalPerfil && <MiPerfilModal onClose={() => setModalPerfil(false)} onToast={showToast} />}
        </Suspense>
      )}

      {/* ===== TOAST ===== */}
      {toast && (
        <div style={{ position: 'absolute', top: safeTop(HEADER_H + 14), left: 16, right: 16, zIndex: 'var(--z-toast)', background: 'var(--glass-strong)', ...glass, border: '0.5px solid var(--glass-brd)', borderRadius: 13, boxShadow: 'var(--shadow-lg)', padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 9 }} className="lu-rise">
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

/** Un dato del resumen del día en la tarjeta ampliada del pin. `px` escala con `pinK`. */
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
    invitar: <><circle cx="9" cy="8" r="3.2" /><path d="M4 21c0-3.4 2.4-5.5 5-5.5s5 2.1 5 5.5" /><path d="M18 8v6M15 11h6" /></>,
    usuarios: <><circle cx="9" cy="8" r="3" /><path d="M2.5 21c0-3.3 2.9-5.5 6.5-5.5s6.5 2.2 6.5 5.5" /><path d="M17 7.7a3 3 0 0 1 0 5.6" /></>,
    empresas: <><path d="M3 21V7l8-4 8 4v14" /><path d="M9 21v-6h6v6" /></>,
  }[k]
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{inner}</svg>
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
function NavBtn({ active, label, onClick, children }) {
  return (
    <div onClick={onClick} className="lu-press" style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '5px 0', cursor: 'pointer', color: active ? 'var(--primary)' : 'var(--muted)', transition: 'transform 160ms cubic-bezier(.23,1,.32,1), color 160ms cubic-bezier(.23,1,.32,1)' }}>
      {children}
      <span style={{ fontSize: 10, fontWeight: 600 }}>{label}</span>
    </div>
  )
}
