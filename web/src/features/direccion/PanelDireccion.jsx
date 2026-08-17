import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useTenant } from '../../context/TenantContext'
import { useTheme } from '../../context/ThemeContext'
import { useCatalog } from '../../context/CatalogContext'
import Overlay from '../../components/Overlay'
import LeafletMap from '../../components/LeafletMap'
import Logo from '../../components/Logo'
import HaceSegundos from '../../components/HaceSegundos'
import AlertasEquipo from '../../components/AlertasEquipo'
import MiCuenta from '../perfil/MiCuenta'
import useMetricasActividad from '../../hooks/useMetricasActividad'
import useDiagnosticoEquipo, { DIAG_RECIENTE_MS } from '../../hooks/useDiagnosticoEquipo'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import useRecorridosDelDia from '../../hooks/useRecorridosDelDia'
import useEmpresaBase from '../../hooks/useEmpresaBase'
import useAlertasEquipo from '../../hooks/useAlertasEquipo'
import { construirFines, construirInicios, construirLeaflet, construirTrails, limpiarPorUsuario } from '../supervision/trazos'
import { calcularDwells } from '../supervision/dwells'
import BurbujasEquipo from '../supervision/components/BurbujasEquipo'
import RailMapa, { RAIL_W } from '../supervision/components/RailMapa'
import BtnInmersivo from '../../components/BtnInmersivo'
import { fetchSnapRecorridos } from '../../services/recorridos'
import { apilarAtras } from '../../services/atras'
import { sx } from '../../lib/sx'
import { colorPorId } from '../../lib/colors'
import { hoyStr, initials, fmtDuracion } from '../../lib/format'
import { compararDia, compararRango, serieParaBarras } from '../../lib/comparar'
import { titular as generarTitular, periodoTxt, horizonteInicial } from './titulares'
import KpiCard from './components/KpiCard'
import MiniKpi from './components/MiniKpi'
import FilaEquipo from './components/FilaEquipo'
import SinDatoBloque from './components/SinDatoBloque'
import SheetPersona from './components/SheetPersona'
import GestionHost from '../../components/GestionHost'
import InvitarModal from '../../components/InvitarModal'
// Las pantallas de gestión (incluido el informe) salen del MISMO despacho que las dos
// supervisiones: acá solo se decide cuál abrir. Todas son lazy adentro del módulo, así que el
// chunk inicial de esta pantalla sigue siendo el pulso del período y nada más.
import DespachoGestion from '../supervision/components/DespachoGestion'
import { GESTION_TITLES, itemsDeGestion } from '../../lib/gestion'

// Modales de alta que abren Clientes y Catálogo. Van por Overlay (--z-modal, 500), o sea por
// encima del GestionHost (--z-screen, 400) — mismo apilamiento que en SupervisionMovil.
const NuevoCliente = lazy(() => import('../catalog/NuevoCliente'))
const NuevoProducto = lazy(() => import('../catalog/NuevoProducto'))

/**
 * PANEL DE DIRECCIÓN — la pantalla de `admin`/`superadmin` EN CELULAR (web/PWA).
 * Entrega de diseño v1.3, secciones 4d/4e.
 *
 * ES UN SCROLL ÚNICO Y EMPIEZA POR LOS NÚMEROS. Quien abre esto no viene a explorar un mapa, viene
 * a saber si el negocio funciona hoy; el mapa es contexto, no titular. Acá es una tarjeta más del
 * scroll y se abre a pantalla completa con un toque.
 *
 * Ese orden además elimina las 6 capas de chrome con `backdrop-filter` que flotaban sobre Leaflet,
 * que es el efecto más caro que existe en un teléfono de gama baja (regla 28 y el bug del
 * 20/07/2026). En el inicio no hay una sola capa sobre el mapa.
 *
 * 🩸 HISTORIA (leerla antes de "simplificar" el ruteo). Esta pantalla nació como el dashboard del
 * rol `propietario`, creado para el dueño de la distribuidora. Ese rol se borró el 08/08/2026
 * (`db/31`) sin haber tenido nunca un solo perfil: el dueño usa `admin`, que ya tenía exactamente
 * los mismos permisos de lectura. Lo que NO se tiró fue la pantalla, porque el problema que
 * resuelve seguía intacto — un admin que abre la PWA en un teléfono caía en `SupervisionDesktop`,
 * la consola de escritorio colapsada a una columna. Antes de eso reemplazó a `PropietarioView.jsx`,
 * que era código muerto y nadie vio jamás.
 *
 * QUIÉN LA VE (`decidirPanelDireccion` en App.jsx, único lugar que sabe la regla):
 * web/PWA + pantalla de celular + rol de gestión. En el APK los gestores siguen en
 * `SupervisionMovil`, y el `encargado` —supervisor de campo, no dirección— nunca entra acá.
 *
 * CASI TODO ES LECTURA. Los únicos controles son el selector de horizonte, el grupo colapsable, el
 * detalle de persona, el mapa completo, el menú de cuenta y —desde que la usa `admin`— el botón
 * "Menú" de gestión, que abre las mismas pantallas que las dos supervisiones a través del despacho
 * compartido (`supervision/components/DespachoGestion`, regla 31).
 */
const HORIZONTES = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
]

export default function PanelDireccion() {
  const { idEmpresa, perfil, rol, permisos } = useAuth()
  const { theme, isDark } = useTheme()
  // El default depende de la hora: antes de las 11 "hoy" casi no tiene datos y un dueño que abre
  // a las 8:30 vería 4 km y sacaría una conclusión falsa sobre un día que recién empieza.
  const [horizonte, setHorizonte] = useState(() => horizonteInicial())
  const [personaSel, setPersonaSel] = useState(null)
  const [mapaAbierto, setMapaAbierto] = useState(false)
  // Pantalla de gestión abierta (clave de GESTION_ITEMS) o null. El informe de jornada es una más
  // de la lista: el botón del cuerpo abre 'reportes', el mismo que el menú.
  const [gestion, setGestion] = useState(null)
  const [menuAbierto, setMenuAbierto] = useState(false)
  const [modalCliente, setModalCliente] = useState(false)
  const [modalProducto, setModalProducto] = useState(false)
  const [toast, setToast] = useState(null)
  const [cuentaAbierta, setCuentaAbierta] = useState(false)
  // ---- Estado del MAPA a pantalla completa. Antes no existía ninguno de estos: el mapa se abría
  // en un sheet de 60vh con cuatro props y sin un solo control.
  const [snapped, setSnapped] = useState({})
  const [snapOn, setSnapOn] = useState(true) // pegado a calles por defecto (03/08/2026, ver SupervisionMovil)
  const [dwellOn, setDwellOn] = useState(true)
  const [dwellSel, setDwellSel] = useState(null)
  const [showClientes, setShowClientes] = useState(false)
  const [foco, setFoco] = useState(null)      // { id, nonce } — persona enfocada
  const [seguirId, setSeguirId] = useState(null)
  // Sello del ÚLTIMO enganche pedido a mano (ver `alternarSeguir`). Viaja en `seguir.nonce`.
  const [seguirNonce, setSeguirNonce] = useState(0)
  const [fitDone, setFitDone] = useState(false)
  const dateRef = useRef(null)

  // Día que se está mirando EN EL MAPA. El resto de la pantalla sigue gobernado por `horizonte`
  // (hoy/semana/mes), que es agregado; el mapa es de un día concreto y ahora se puede elegir cuál.
  const [fechaMapa, setFechaMapa] = useState(hoyStr)
  const esHoy = fechaMapa === hoyStr()

  const m = useMetricasActividad(horizonte, !!idEmpresa)
  const { filas: diag } = useDiagnosticoEquipo()
  const { movers, nombres, fotos, roles, plantel } = useEquipoEnVivo()
  const { idEmpresaActiva } = useTenant()
  const base = useEmpresaBase(idEmpresaActiva)
  const avisos = useAlertasEquipo()
  const { clientes: cartera } = useCatalog()
  // Trazos del día para el mapa y para el detalle de persona. Es la ÚNICA consulta que baja puntos
  // crudos: los números salen todos de la RPC agregada.
  const { byUser: byUserCrudo } = useRecorridosDelDia(fechaMapa, idEmpresaActiva, esHoy)

  // 🩸 EL RECORRIDO CRUDO MIENTE — regla 22-bis (30/07/2026).
  //
  // Hasta hoy esta pantalla armaba sus `trails` directo desde `byUser` sin pasar por `trazos.js`:
  // sin filtro de saltos imposibles, sin corte por huecos, sin conectores punteados y sin
  // simplificar. O sea que el dueño —el único que mira esto para sacar conclusiones— era
  // justamente el que veía los teleports. El 29/07/2026 un vendedor figuraba con 524,8 km porque
  // cuatro fixes falsos lo mandaban 127 km al norte y lo traían; su día real fueron 17,9 km.
  const byUser = useMemo(() => limpiarPorUsuario(byUserCrudo), [byUserCrudo])

  const ahora = Date.now()

  // ---- Personas: se parten en dos listas, y esa partición es la decisión ética de la pantalla.
  // Quien no reportó NO aparece con 0 km junto a los demás, porque un 0 se lee "no trabajó" cuando
  // la verdad es "no sabemos". Sale de la lista y va al bloque colapsable con su diagnóstico.
  const { activos, sinDatos } = useMemo(() => {
    const act = []
    const sin = []
    for (const d of diag) {
      const met = m.porUsuario[d.id]
      const mov = movers[d.id]
      const enCalle = !!(mov && ahora - mov.ts < DIAG_RECIENTE_MS)
      if (met && met.puntos > 0) {
        act.push({
          id: d.id, nombre: d.nombre || nombres[d.id] || 'Móvil', rol: d.rol,
          km: met.km, paradas: met.paradas, minutos: met.minutos,
          ultimoTs: met.ultimoTs ? new Date(met.ultimoTs).getTime() : null,
          enCalle, tieneDatos: true,
          motivo: d.motivo, ota: d.ota, otaAtrasada: d.otaAtrasada, cola: d.cola,
          permiso: d.permiso, bgOk: d.bgOk, ultimoLatidoMs: d.ultimoLatidoMs,
        })
      } else {
        sin.push({ ...d, nombre: d.nombre || nombres[d.id] || 'Móvil', tieneDatos: false, km: 0, paradas: 0, minutos: 0, enCalle })
      }
    }

    // 🩸 QUIEN TUVO ACTIVIDAD APARECE, tenga el rol que tenga (30/07/2026).
    //
    // `diag` sale de `usePerfilesEquipo`, que filtra a `rol in (vendedor, repartidor, encargado)`.
    // Ese filtro está bien para el informe técnico —es el plantel que SE RASTREA— pero acá dejaba
    // fuera a cualquier admin o superadmin que saliera a la calle con la app: sus km
    // se contaban en el total, su trazo se dibujaba en el mapa, y en la lista "Equipo" no estaban.
    // La pregunta que responde esta pantalla es "quién tuvo actividad hoy", no "quién figura en el
    // plantel". `usePerfilesEquipo` NO se toca: lo comparte EstadoEquipo en las dos supervisiones.
    const yaEsta = new Set([...act, ...sin].map((p) => p.id))
    for (const [id, met] of Object.entries(m.porUsuario)) {
      if (yaEsta.has(id) || !met || !met.puntos) continue
      const mov = movers[id]
      act.push({
        id, nombre: nombres[id] || 'Móvil', rol: mov?.rol || null,
        km: met.km, paradas: met.paradas, minutos: met.minutos,
        ultimoTs: met.ultimoTs ? new Date(met.ultimoTs).getTime() : null,
        enCalle: !!(mov && ahora - mov.ts < DIAG_RECIENTE_MS), tieneDatos: true,
        // Sin fila en el plantel no hay diagnóstico de teléfono: se muestra la actividad y nada más.
        // Es honesto — inventar un "todo OK" sería peor que dejarlo vacío.
        fueraDelPlantel: true,
      })
    }

    act.sort((a, b) => b.km - a.km)
    return { activos: act, sinDatos: sin }
  }, [diag, m.porUsuario, movers, nombres, ahora])

  const enCalleAhora = activos.filter((p) => p.enCalle).length
  const maxKm = activos.reduce((mx, p) => Math.max(mx, p.km), 0)

  // ---- Contexto de cada número. Para "hoy" se compara contra el mismo día de las 4 semanas
  // anteriores; para semana/mes, contra los períodos equivalentes previos.
  const cmp = useMemo(() => {
    const f = horizonte === 'hoy'
      ? (serie) => compararDia(serie, m.hasta)
      : (serie) => compararRango(serie, m.desde, m.hasta)
    return { km: f(m.serieKm), paradas: f(m.serieParadas), minutos: f(m.serieMinutos) }
  }, [horizonte, m.serieKm, m.serieParadas, m.serieMinutos, m.desde, m.hasta])

  const barras = useMemo(() => serieParaBarras(m.serieKm, m.hasta, m.barras), [m.serieKm, m.hasta, m.barras])

  const { titular, subtitular } = generarTitular({
    horizonte,
    enCalle: enCalleAhora,
    conDatos: activos.length,
    sinDatos: sinDatos.length,
    unicoNombre: activos.length === 1 ? activos[0].nombre : null,
    ultimoCierreTs: m.ultimoCierreTs,
    km: cmp.km,
  })

  // Frescura del dato: es parte del dato. Si el último punto tiene más de 5 minutos, el chip pasa
  // a ámbar y aparece el banner — lo que se está viendo no es "ahora".
  const ultimaSenal = useMemo(() => {
    let t = null
    for (const p of activos) if (p.ultimoTs && (!t || p.ultimoTs > t)) t = p.ultimoTs
    return t
  }, [activos])
  const desactualizado = ultimaSenal != null && ahora - ultimaSenal > DIAG_RECIENTE_MS

  // ---- Geometría del mapa. Sale ENTERA de features/supervision/trazos.js: es exactamente la
  // misma que ven las dos supervisiones, así que no se puede volver a desincronizar (regla 31).
  const SIN_FILTRO = useCallback(() => true, []) // el dueño no filtra por rol: ve a todo el equipo
  const trails = useMemo(() => construirTrails(byUser, SIN_FILTRO), [byUser, SIN_FILTRO])
  const leafletTrails = useMemo(
    () => construirLeaflet({ trails, snapped, snapOn, focoId: foco?.id || null }),
    [trails, snapped, snapOn, foco]
  )
  // Hitos "▶ 08:47" y "■ 17:20". Las dos supervisiones ya los mostraban y acá faltaban: era una
  // omisión y no una decisión, así que el dueño veía el mismo trazo sin saber a qué hora empezó ni
  // cuándo dejó de reportar — que es justo lo que un dueño mira. ⚠️ El fin es el último punto
  // RECIBIDO, no un cierre declarado (no existe botón de finalizar jornada).
  const inicios = useMemo(() => construirInicios(trails), [trails])
  const fines = useMemo(() => construirFines(trails), [trails])

  // Burbujas de las personas en vivo: SIN ESTO el mapa dibuja polilíneas de color anónimas y no
  // hay nada, en ninguna parte de la pantalla, que diga de quién es cada una. Ese era el "no se
  // ven los usuarios que tuvieron actividad en el día".
  // Array estable de móviles en vivo: lo consumen las burbujas y el índice de `onMarkerClick`,
  // que tiene que apuntar a la MISMA lista que dibuja los pines.
  const moversArr = useMemo(() => Object.values(movers), [movers])

  const mapMarkers = useMemo(() => (esHoy ? moversArr.map((mv) => ({
    // `id`: es lo que le permite al mapa conservar el marcador entre refrescos y animarlo en vez de
    // recrearlo en el destino (LeafletMap, capa de pines vivos).
    id: mv.id, lat: mv.lat, lng: mv.lng, label: initials(nombres[mv.id] || mv.rol),
    color: colorPorId(mv.id), labelColor: '#fff', title: nombres[mv.id] || mv.rol,
    bubble: true, foto: fotos[mv.id], ts: mv.ts,
  })) : []), [esHoy, moversArr, nombres, fotos])

  const clientMarkers = useMemo(
    () => (cartera || []).filter((c) => c.lat != null && c.lng != null).map((c) => ({ lat: c.lat, lng: c.lng, nombre: c.name || c.nombre_comercio })),
    [cartera]
  )

  const dwells = useMemo(
    () => (dwellOn ? calcularDwells(byUser, SIN_FILTRO, cartera) : []),
    [byUser, dwellOn, cartera, SIN_FILTRO]
  )

  const focusData = useMemo(() => {
    if (!foco) return null
    const pts = byUser[foco.id]?.points
    if (pts && pts.length) return { points: pts, nonce: foco.nonce }
    const mv = movers[foco.id]
    if (mv) return { points: [{ lat: mv.lat, lng: mv.lng }], nonce: foco.nonce }
    return { points: [], nonce: foco.nonce }
  }, [foco, byUser, movers])

  const objetivoSeguir = useMemo(() => {
    const cand = foco?.id ? movers[foco.id] : null
    if (cand) return { id: foco.id, lat: cand.lat, lng: cand.lng, ts: cand.ts }
    let mejor = null
    for (const [id, mv] of Object.entries(movers)) {
      if (!mejor || (mv.ts || 0) > (mejor.ts || 0)) mejor = { id, lat: mv.lat, lng: mv.lng, ts: mv.ts }
    }
    return mejor
  }, [foco, movers])

  const seguirData = useMemo(() => {
    if (!seguirId) return null
    const mv = movers[seguirId]
    return mv ? { id: seguirId, lat: mv.lat, lng: mv.lng, ts: mv.ts, nonce: seguirNonce } : null
  }, [seguirId, seguirNonce, movers])

  // Snap-to-road (toggle "Calles"). Solo se pide cuando el mapa está abierto: el dueño abre esta
  // pantalla muchas veces por día y el ruteo es un recurso donado (FOSSGIS).
  useEffect(() => {
    if (!mapaAbierto || !idEmpresaActiva) return
    let vivo = true
    fetchSnapRecorridos({
      fecha: fechaMapa,
      desde: new Date(fechaMapa + 'T00:00:00').toISOString(),
      hasta: new Date(fechaMapa + 'T23:59:59').toISOString(),
    }).then((s) => { if (vivo) setSnapped(s) }).catch(() => {})
    return () => { vivo = false }
  }, [mapaAbierto, idEmpresaActiva, fechaMapa])

  // Encuadrar solo la primera vez que hay datos; después se preserva el zoom/pan del usuario.
  useEffect(() => {
    if (fitDone) return
    if (Object.keys(byUser).length || Object.keys(movers).length) setFitDone(true)
  }, [byUser, movers, fitDone])

  useEffect(() => { setDwellSel(null) }, [fechaMapa, dwellOn])
  useEffect(() => { if (!esHoy) setSeguirId(null) }, [esHoy])

  const cambiarFechaMapa = useCallback((v) => {
    setFechaMapa(v || hoyStr())
    setFitDone(false)
    setFoco(null)
  }, [])

  const abrirFechaMapa = useCallback(() => {
    const el = dateRef.current
    if (!el) return
    try { if (typeof el.showPicker === 'function') { el.showPicker(); return } } catch { /* fallback */ }
    try { el.focus({ preventScroll: true }); el.click() } catch { /* sin picker */ }
  }, [])

  const alternarSeguir = useCallback(() => {
    if (seguirId) { setSeguirId(null); return }
    // 🩸 El `setSeguirNonce` no es redundante con el nonce del foco: sin él, con la persona quieta
    // el efecto de cámara de LeafletMap no corre y el botón no hace nada (03/08/2026).
    if (objetivoSeguir) { setSeguirId(objetivoSeguir.id); setSeguirNonce(Date.now()); setFoco({ id: objetivoSeguir.id, nonce: Date.now() }) }
  }, [seguirId, objetivoSeguir])

  // Enfocar a una persona (o `null` para soltar). Enfocar a OTRA suelta el seguimiento: si no, el
  // paneo por frame de la animación del pin que se venía siguiendo cancela el vuelo hacia el
  // recorrido pedido y el mapa nunca llega. Ver el 🩸 de SupervisionMovil.
  const enfocarPersona = useCallback((id) => {
    setFoco(id ? { id, nonce: Date.now() } : null)
    // `id &&`: soltar el foco (tocar de nuevo la burbuja) NO suelta el seguimiento — lo que lo
    // suelta es pedir el recorrido de OTRA persona, que es cuando las dos cámaras se pelean.
    setSeguirId((s) => (s && id && s !== id ? null : s))
  }, [])

  const personaSheet = personaSel
    ? activos.find((p) => p.id === personaSel) || sinDatos.find((p) => p.id === personaSel) || null
    : null

  const mostrarToast = useCallback((msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2600)
  }, [])

  // Pantallas de gestión que este usuario puede abrir. Sale de la MISMA tabla que las dos
  // supervisiones (`lib/gestion.js`), así que un permiso nuevo aparece en los tres canales o en
  // ninguno. Para un admin sale completa; el filtro por rol y por `permisos` ya vive allá.
  const gestionItems = useMemo(() => itemsDeGestion(rol, permisos), [rol, permisos])

  // El botón atrás de Android cierra el menú antes que la app (reglas 26-27).
  useEffect(() => {
    if (!menuAbierto) return
    return apilarAtras(() => setMenuAbierto(false))
  }, [menuAbierto])

  return (
    <div style={sx('position:fixed;inset:0;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text)')}>
      {/* ---- Header fijo. Sin bottom-nav, sin tabs: no hay segundo nivel del que volver. ---- */}
      <div style={sx('flex:none;padding:calc(env(safe-area-inset-top,0px) + 10px) 18px 10px;border-bottom:1px solid var(--line);background:var(--surface);display:flex;flex-direction:column;gap:9px')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;gap:10px')}>
          <Logo size={22} />
          <div style={sx('display:flex;align-items:center;gap:10px')}>
            <span style={{
              ...sx('display:flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:var(--fs-xs)'),
              color: desactualizado ? 'var(--warning)' : 'var(--success)',
            }}>
              <span style={{ ...sx('width:6px;height:6px;border-radius:var(--r-pill)'), background: desactualizado ? 'var(--warning)' : 'var(--success)' }} />
              {ultimaSenal ? <HaceSegundos ts={ultimaSenal} /> : 'sin señal'}
            </span>
            {/* Avisos del equipo: quién dejó de reportar y quién lleva demasiado parado. Al dueño
                le importa lo mismo que al encargado, y en la PWA esto es lo único que hay. */}
            <AlertasEquipo
              alertas={avisos.alertas}
              sinVer={avisos.sinVer}
              nombres={nombres}
              onMarcarVista={avisos.marcarVista}
              onEnfocar={(a) => {
                if (fechaMapa !== hoyStr()) cambiarFechaMapa(hoyStr())
                enfocarPersona(a.id_usuario)
                setMapaAbierto(true)
              }}
            />
            {/* Gestión. Va como un ícono más del header y no como una barra propia: esta pantalla
                se lee de arriba hacia abajo y el menú es un desvío, no un destino. Si el rol no
                tiene ninguna pantalla habilitada, el botón no existe. */}
            {gestionItems.length > 0 && (
              <button
                onClick={() => setMenuAbierto(true)}
                className="lu-press"
                aria-label="Menú de gestión"
                style={sx('width:36px;height:36px;flex:none;display:grid;place-items:center;border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface2);color:var(--muted);cursor:pointer')}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              </button>
            )}
            {/* El diseño no previó acceso a la cuenta: sin esto el dueño se queda sin editar su
                perfil, sin cambiar el tema y —sobre todo— sin poder cerrar sesión. */}
            <button
              onClick={() => setCuentaAbierta(true)}
              className="lu-press"
              aria-label="Mi cuenta"
              style={sx('width:36px;height:36px;flex:none;border-radius:var(--r-md);border:1px solid var(--line2);background:var(--surface2);color:var(--deep);font-family:var(--font-display);font-size:var(--fs-sm);font-weight:700;cursor:pointer')}
            >
              {initials(perfil?.nombre || perfil?.email || '?')}
            </button>
          </div>
        </div>

        <div style={sx('display:flex;gap:4px;padding:3px;border-radius:var(--r-md);background:var(--surface2);border:1px solid var(--line)')}>
          {HORIZONTES.map((h) => {
            const activo = h.id === horizonte
            return (
              <button
                key={h.id}
                onClick={() => setHorizonte(h.id)}
                className="lu-press"
                aria-pressed={activo}
                style={{
                  // 44 px, no los 36 del mockup: es el único control real de la pantalla y el
                  // mínimo táctil del propio brief son 44.
                  ...sx('flex:1;min-height:44px;display:flex;align-items:center;justify-content:center;border-radius:var(--r-sm);font-size:var(--fs-sm);font-weight:600;border:none;cursor:pointer'),
                  background: activo ? 'var(--surface)' : 'transparent',
                  color: activo ? 'var(--text)' : 'var(--muted)',
                  boxShadow: activo ? 'var(--shadow)' : 'none',
                }}
              >
                {h.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* ---- Cuerpo ---- */}
      <div style={sx('flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 18px calc(env(safe-area-inset-bottom,0px) + 28px)')}>
        {m.error ? (
          <Error onReintentar={m.reload} mensaje={m.error.message} />
        ) : m.loading ? (
          <Skeleton />
        ) : (
          <>
            <div style={sx('padding-top:18px')}>
              <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);letter-spacing:.14em;text-transform:uppercase;color:var(--faint);font-weight:600')}>
                {periodoTxt(horizonte, { desde: m.desde, hasta: m.hasta })}
              </div>
              <h1 style={sx('font-family:var(--font-display);font-size:28px;font-weight:700;line-height:1.14;margin:8px 0 0;letter-spacing:-.01em')}>
                {titular}
              </h1>
              <div style={sx('font-size:var(--fs-md);color:var(--muted);line-height:1.5;margin-top:7px')}>{subtitular}</div>
            </div>

            {desactualizado && (
              <div style={sx('margin-top:14px;padding:11px 13px;border-radius:var(--r-md);background:var(--warning-tint);display:flex;gap:9px;align-items:flex-start')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" style={{ flex: 'none', marginTop: 1 }}>
                  <path d="M2 8.8a16 16 0 0 1 20 0M5 12.5a11 11 0 0 1 14 0M8.5 16.2a6 6 0 0 1 7 0M12 20h.01" />
                  <path d="M2 2l20 20" />
                </svg>
                <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
                  <b style={sx('color:var(--text)')}>Sin señal reciente.</b> Lo que ves no es del momento.
                  Se actualiza solo cuando vuelva la conexión de los teléfonos.
                </div>
              </div>
            )}

            <div style={sx('margin-top:16px')}>
              <KpiCard
                label="Km recorridos"
                valor={m.total.km.toFixed(1)}
                unidad="km"
                comp={cmp.km}
                barras={barras}
                barrasLabel={horizonte === 'hoy' ? 'últimos 8 días' : 'día por día'}
              />
            </div>

            <div style={sx('margin-top:11px;display:grid;grid-template-columns:1fr 1fr;gap:11px')}>
              <MiniKpi label="Paradas de 5 min o más" valor={String(m.total.paradas)} comp={cmp.paradas} />
              <MiniKpi label="Tiempo en movimiento" valor={fmtDuracion(m.total.minutos * 60000)} comp={cmp.minutos} />
            </div>

            {/* Mapa: una tarjeta del scroll, sin interacción y sin una sola capa flotante encima.
                Todo el bloque es un único target táctil que lo abre a pantalla completa. */}
            <div
              onClick={() => setMapaAbierto(true)}
              className="lu-press"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter') setMapaAbierto(true) }}
              style={sx('margin-top:11px;position:relative;height:172px;border-radius:var(--r-card);overflow:hidden;border:1px solid var(--line);cursor:pointer;background:var(--map-bg)')}
            >
              <LeafletMap theme={theme} trails={leafletTrails.length ? leafletTrails : null} height="100%" interactive={false} basemapControl={false} fit />
              <div style={sx('position:absolute;left:12px;top:12px;background:var(--glass-strong);border:.5px solid var(--glass-brd);border-radius:var(--r-sm);padding:5px 9px;font-family:var(--font-mono);font-size:var(--fs-xs);font-weight:600;color:var(--text);pointer-events:none')}>
                {enCalleAhora} de {activos.length + sinDatos.length} en la calle
              </div>
              <div style={sx('position:absolute;right:12px;bottom:12px;min-height:36px;display:flex;align-items:center;padding:0 12px;background:var(--glass-strong);border:.5px solid var(--glass-brd);border-radius:var(--r-md);font-size:var(--fs-sm);font-weight:600;color:var(--text);pointer-events:none')}>
                Abrir el mapa
              </div>
            </div>

            <div style={sx('margin-top:22px;display:flex;justify-content:space-between;align-items:baseline;gap:10px')}>
              <h2 style={sx('font-family:var(--font-display);font-size:var(--fs-lg);font-weight:600;margin:0')}>Equipo</h2>
              <span style={sx('font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--faint)')}>por km recorridos</span>
            </div>

            {activos.length === 0 ? (
              <div style={sx('margin-top:10px;padding:14px;border-radius:var(--r-lg);background:var(--surface2);border:1px solid var(--line);font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
                Nadie registró actividad en este período.
              </div>
            ) : (
              <div style={sx('margin-top:10px;display:flex;flex-direction:column;gap:8px')}>
                {activos.map((p) => (
                  <FilaEquipo key={p.id} persona={p} maxKm={maxKm} onAbrir={() => setPersonaSel(p.id)} />
                ))}
              </div>
            )}

            <SinDatoBloque personas={sinDatos} onAbrir={setPersonaSel} />

            {/* El informe del día, completo. Va DESPUÉS de la lista de equipo y no arriba: el dueño
                abre esta pantalla para el pulso del período, y el detalle hora por hora de un día
                es el paso siguiente, no el primero. */}
            <button
              type="button"
              className="lu-press"
              onClick={() => setGestion('reportes')}
              style={sx('margin-top:14px;width:100%;min-height:46px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);color:var(--text);font-size:var(--fs-sm);font-weight:600;cursor:pointer')}
            >
              Ver el informe de la jornada
            </button>

            {/* La explicación de que no hay ventas va acá abajo, chica y al final. NO es un cartel
                de "PRÓXIMAMENTE" ni una grilla de guiones: la pantalla de hoy está completa con lo
                que hay, y el bloque de venta entrará arriba cuando existan pedidos. */}
            <div style={sx('margin-top:20px;padding:13px 15px;border-radius:var(--r-md);background:var(--surface2);border:1px dashed var(--line2);font-size:var(--fs-sm);color:var(--muted);line-height:1.6')}>
              Todavía no hay pedidos cargados en el sistema, así que no hay números de venta. Cuando el
              módulo arranque, aparecen como una tarjeta más arriba de estas, sin cambiar nada de lo que ya ves.
            </div>
          </>
        )}
      </div>

      {/* ---- Capas ----
          `puntos` van LIMPIOS (byUser ya pasó por limpiarPorUsuario): si acá entrara el crudo, el
          mini-mapa del detalle volvería a dibujar los teleports que el mapa grande ya no dibuja, y
          las dos vistas de la misma persona se contradirían. */}
      <SheetPersona
        open={!!personaSel}
        persona={personaSheet}
        puntos={personaSel ? byUser[personaSel]?.points : null}
        serieKm={m.serieKmPorUsuario}
        hasta={m.hasta}
        tema={theme}
        clientes={cartera}
        onClose={() => setPersonaSel(null)}
      />

      {/* ===== GESTIÓN =====
          Mismo contenedor full-screen que usa SupervisionMovil (header con atrás, Escape y botón
          físico de Android), y el MISMO despacho: una sola definición de qué pantalla es cada
          clave, compartida por las tres vistas (regla 31).
          'invitar' queda afuera: es una ventana flotante, no una pantalla. */}
      {gestion && gestion !== 'invitar' && (
        <GestionHost
          title={GESTION_TITLES[gestion] || 'Informe de jornada'}
          onClose={() => { setGestion(null); setModalCliente(false); setModalProducto(false) }}
        >
          <DespachoGestion
            vista={gestion}
            reportes={{
              fecha: fechaMapa,
              onFecha: setFechaMapa,
              byUser,
              nombres,
              cartera,
              plantelIds: plantel,
              roles,
              onVerEnMapa: (id) => { setGestion(null); setMapaAbierto(true); enfocarPersona(id) },
            }}
            onToast={mostrarToast}
            onNuevoCliente={() => setModalCliente(true)}
            onNuevoProducto={() => setModalProducto(true)}
            onEditarProducto={(p) => setModalProducto(p)}
          />
        </GestionHost>
      )}

      <InvitarModal open={gestion === 'invitar'} onClose={() => setGestion(null)} onToast={mostrarToast} />

      {(modalCliente || modalProducto) && (
        <Suspense fallback={null}>
          {modalCliente && <NuevoCliente onClose={() => setModalCliente(false)} onToast={mostrarToast} center={null} />}
          {/* `true` = alta; un objeto producto = edición (mismo patrón que las supervisiones). */}
          {modalProducto && (
            <NuevoProducto
              onClose={() => setModalProducto(false)}
              onToast={mostrarToast}
              producto={modalProducto === true ? null : modalProducto}
            />
          )}
        </Suspense>
      )}

      {mapaAbierto && (
        <MapaCompleto
          theme={theme}
          isDark={isDark}
          onClose={() => setMapaAbierto(false)}
          base={base}
          leafletTrails={leafletTrails}
          trails={trails}
          mapMarkers={mapMarkers}
          moversArr={moversArr}
          clientMarkers={clientMarkers}
          showClientes={showClientes}
          setShowClientes={setShowClientes}
          dwells={dwells}
          inicios={inicios}
          fines={fines}
          dwellOn={dwellOn}
          setDwellOn={setDwellOn}
          dwellSel={dwellSel}
          setDwellSel={setDwellSel}
          snapOn={snapOn}
          setSnapOn={setSnapOn}
          fitDone={fitDone}
          focusData={focusData}
          foco={foco}
          onEnfocar={enfocarPersona}
          seguirData={seguirData}
          objetivoSeguir={objetivoSeguir}
          onSeguir={alternarSeguir}
          soltarSeguir={() => setSeguirId(null)}
          fechaMapa={fechaMapa}
          esHoy={esHoy}
          dateRef={dateRef}
          onAbrirFecha={abrirFechaMapa}
          onCambiarFecha={cambiarFechaMapa}
          byUser={byUser}
          nombres={nombres}
          fotos={fotos}
        />
      )}

      {menuAbierto && (
        <Overlay open onClose={() => setMenuAbierto(false)} variant="sheet" title="Gestión">
          <div style={sx('display:flex;flex-direction:column;gap:2px;padding-bottom:4px')}>
            {gestionItems.map((it) => (
              <button
                key={it.key}
                className="lu-press"
                onClick={() => { setMenuAbierto(false); setGestion(it.key) }}
                style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;min-height:52px;padding:0 4px;background:none;border:none;border-radius:var(--r-md);color:var(--text);font-size:var(--fs-md);font-weight:500;text-align:left;cursor:pointer')}
              >
                {it.label}
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            ))}
          </div>
        </Overlay>
      )}

      {cuentaAbierta && (
        <Overlay open onClose={() => setCuentaAbierta(false)} variant="sheet" title="Mi cuenta">
          {/* 🩸 `showDeviceToggle` NO es opcional acá. Esta pantalla se elige por ANCHO de
              viewport, así que un admin en una ventana angosta de PC entra al panel y sin este
              switch se queda sin ninguna forma de volver a la consola de escritorio. */}
          <MiCuenta showDeviceToggle />
        </Overlay>
      )}

      {toast && (
        <div
          className="lu-rise"
          style={{
            ...sx('position:fixed;left:16px;right:16px;display:flex;align-items:center;gap:9px;padding:11px 14px;border-radius:13px;background:var(--glass-strong);border:0.5px solid var(--glass-brd);box-shadow:var(--shadow-lg);font-size:var(--fs-sm);font-weight:500'),
            bottom: 'calc(18px + env(safe-area-inset-bottom,0px))',
            zIndex: 'var(--z-toast)',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none' }}>
            <path d="M20 6 9 17l-5-5" />
          </svg>
          {toast}
        </div>
      )}
    </div>
  )
}

/**
 * Mapa a pantalla completa: la ÚNICA pantalla del rol donde el mapa se opera. Tiene exactamente
 * dos piezas flotantes (la barra de arriba y la nota de abajo) y son las únicas de todo el rol.
 *
 * El estado "abierto" vive adentro para que el overlay pueda animar su salida: si el padre lo
 * desmontara de golpe, se iría sin transición (gotcha 1 de Overlay en CLAUDE.md §7).
 */
function MapaCompleto({ theme, onClose, ...p }) {
  // El botón ATRÁS de Android cierra el mapa en vez de minimizar la app (reglas 26-27).
  useEffect(() => apilarAtras(onClose), [onClose])

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 'var(--z-screen)', background: 'var(--map-bg)', isolation: 'isolate' }} className="lu-rise">
      <LeafletMap
        theme={theme}
        height="100%"
        radius={0}
        center={p.base}
        trails={p.leafletTrails.length ? p.leafletTrails : null}
        markers={p.mapMarkers}
        clients={p.showClientes ? p.clientMarkers : []}
        dwells={p.dwells}
        dwellSel={p.dwellSel}
        onDwellClick={(i) => p.setDwellSel((s) => (s === i ? null : i))}
        inicios={p.inicios}
        fines={p.fines}
        // Prop suelta (no dentro de `dwells`): con el foco adentro, cada toque en una persona
        // recalcularía `calcularDwells` — ~250 ms por persona-día. Ver el 🩸 en LeafletMap.
        focoId={p.foco?.id || null}
        fit={!p.fitDone}
        focus={p.focusData}
        seguir={p.seguirData}
        onSeguirCancelado={p.soltarSeguir}
        // Reserva a la derecha el ancho del rail y abajo el de las burbujas, para que el encuadre
        // no meta el recorrido debajo de los controles.
        // El `right` lleva media burbuja de más (65): el encuadre mide la COORDENADA y la burbuja
        // de perfil mide 130 px de ancho, así que una persona encuadrada contra el borde quedaba
        // con su burbuja metida abajo del rail.
        edgePadding={{ top: 16, right: RAIL_W + 24 + 65, bottom: 96, left: 16 }}
        onMarkerClick={(i) => { const mk = p.moversArr[i]; if (mk) p.onEnfocar(mk.id) }}
      />

      {/* Cerrar: mismo control y misma esquina que el "salir de pantalla completa" de las dos
          supervisiones (BtnInmersivo), para que el gesto se aprenda una sola vez. */}
      <BtnInmersivo
        activo
        onToggle={onClose}
        style={{ position: 'absolute', right: 12, bottom: 'calc(14px + env(safe-area-inset-bottom,0px))', zIndex: 'var(--z-chrome)' }}
      />

      {/* Rail COMPACTO: fecha, calles, paradas, clientes y centrar/seguir. El dueño no filtra por
          rol ni sincroniza a mano — esos controles no son de esta pantalla. */}
      <RailMapa
        compacto
        style={{ position: 'absolute', right: 12, bottom: `calc(14px + ${RAIL_W + 8}px + env(safe-area-inset-bottom,0px))`, zIndex: 'var(--z-chrome)' }}
        fecha={p.fechaMapa}
        esHoy={p.esHoy}
        isDark={p.isDark}
        dateRef={p.dateRef}
        onAbrirFecha={p.onAbrirFecha}
        onCambiarFecha={p.onCambiarFecha}
        hayTrazos={p.trails.length > 0}
        snapOn={p.snapOn}
        onSnap={() => p.setSnapOn((v) => !v)}
        dwellOn={p.dwellOn}
        onDwell={() => p.setDwellOn((v) => !v)}
        showClientes={p.showClientes}
        clientesCount={p.clientMarkers.length}
        onClientes={() => p.setShowClientes((v) => !v)}
        seguirActivo={!!p.seguirData}
        puedeSeguir={!!p.objetivoSeguir}
        nombreSeguido={p.objetivoSeguir ? (p.nombres[p.objetivoSeguir.id] || null) : null}
        onSeguir={p.onSeguir}
      />

      {/* Burbujas del equipo: es el único acceso al enfoque por persona con el mapa a pantalla
          completa, y lo que le pone nombre a cada trazo de color. */}
      <BurbujasEquipo
        movers={p.moversArr}
        nombres={p.nombres}
        fotos={p.fotos}
        byUser={p.byUser}
        focoId={p.foco?.id || null}
        onSelect={(id) => (p.foco?.id === id ? p.onEnfocar(null) : p.onEnfocar(id))}
        style={{ position: 'absolute', left: 12, right: 12 + RAIL_W + 12, bottom: 'calc(14px + env(safe-area-inset-bottom,0px))', zIndex: 'var(--z-chrome)' }}
      />

      {/* Cartel de estado vacío: distinguir "no hay datos ese día" de "el mapa se rompió". */}
      {!p.mapMarkers.length && !p.trails.length && (
        <div style={sx('position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:240px;text-align:center;background:var(--glass-strong);border:.5px solid var(--glass-brd);border-radius:var(--r-lg);padding:20px 18px;box-shadow:var(--shadow-lg)')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-md)')}>
            {p.esHoy ? 'Nadie en la calle todavía' : 'Sin recorridos ese día'}
          </div>
          <div style={sx('font-size:var(--fs-xs);color:var(--muted);margin-top:4px;line-height:1.45')}>
            {p.esHoy ? 'Cuando el equipo salga, sus recorridos aparecen acá en vivo.' : 'Probá con otro día o volvé a “Hoy”.'}
          </div>
        </div>
      )}
    </div>
  )
}

/** Silueta de la pantalla real mientras carga, no un spinner genérico. */
function Skeleton() {
  return (
    <div style={sx('padding-top:18px')} aria-busy="true" aria-label="Cargando la actividad">
      <div className="lu-sk" style={sx('height:11px;width:45%')} />
      <div className="lu-sk" style={sx('height:30px;width:85%;margin-top:12px')} />
      <div className="lu-sk" style={sx('height:16px;width:70%;margin-top:10px')} />
      <div className="lu-sk" style={sx('height:120px;margin-top:18px;border-radius:var(--r-card)')} />
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:11px')}>
        <div className="lu-sk" style={sx('height:82px;border-radius:var(--r-lg)')} />
        <div className="lu-sk" style={sx('height:82px;border-radius:var(--r-lg)')} />
      </div>
      <div className="lu-sk" style={sx('height:150px;margin-top:11px;border-radius:var(--r-card)')} />
      <div style={sx('margin-top:16px;font-size:var(--fs-sm);color:var(--faint)')}>Trayendo la actividad…</div>
    </div>
  )
}

/**
 * Estado de error. El diseño no lo previó, pero la pantalla anterior sí lo tenía y perderlo sería
 * un retroceso: sin esto, una consulta caída se ve idéntica a "no trabajó nadie", que es el peor
 * malentendido posible en una pantalla que mide el trabajo de personas.
 */
function Error({ mensaje, onReintentar }) {
  return (
    <div style={sx('margin-top:24px;padding:16px;border-radius:var(--r-lg);background:var(--danger-tint);border:1px solid var(--danger)')}>
      <div style={sx('font-size:var(--fs-md);font-weight:600;color:var(--danger)')}>No pudimos traer la actividad</div>
      <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.55;margin-top:6px')}>
        Puede ser la conexión. Los datos están guardados: no se perdió nada.
      </div>
      {mensaje && <div style={sx('font-family:var(--font-mono);font-size:var(--fs-2xs);color:var(--faint);margin-top:8px;word-break:break-word')}>{mensaje}</div>}
      <button
        onClick={onReintentar}
        className="lu-press"
        style={sx('margin-top:12px;min-height:44px;padding:0 20px;border-radius:var(--r-md);border:none;background:var(--primary);color:var(--on-primary);font-size:var(--fs-md);font-weight:600;cursor:pointer')}
      >
        Reintentar
      </button>
    </div>
  )
}
