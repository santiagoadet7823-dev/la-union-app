import { useEffect, useRef, useState } from 'react'
import { useCatalog } from '../../context/CatalogContext'
import { useGps } from '../../context/GpsContext'
import { uid } from '../../lib/uid'
import { supabase } from '../../services/supabase'
import { enqueueMutacion, flushMutaciones } from '../../services/sync/writeQueue'

const now = () => {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// status de la visita (UI) → estado permitido por visitas.estado_check (db/16).
const estadoVisita = (status) => (['visitado', 'sin_pedido', 'cancelado'].includes(status) ? status : 'visitado')

/**
 * Máquina de estado de la jornada del vendedor: navegación por tabs, visita en curso
 * (check-in/timer), carrito del pedido, estado de cada cliente (visitado / sin pedido)
 * y el toast. Dueña única de esta lógica para que las pestañas (tabs/*) sean de solo
 * presentación. Lee el catálogo real para derivar clientes/productos.
 */
export function useJornada() {
  const { productos: PRODUCTS, clientes: cartera, loading: catLoading } = useCatalog()
  // Identidad + posición en vivo para el check-in geolocalizado (Feature C). `pos` es la
  // posición ya adquirida por el watch (sin prompt); id/idEmpresa vienen del perfil real.
  const { pos, id: userId, idEmpresa } = useGps()
  const [tab, setTab] = useState('inicio')
  const [visit, setVisit] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const [cart, setCart] = useState({})
  const [sheet, setSheet] = useState(false)
  const [motivo, setMotivo] = useState(null)
  const [visitState, setVisitState] = useState({}) // { [idCliente]: {status, hora, monto, motivo} }
  const [toast, setToast] = useState(null)
  // Estado de UI que en el monolito vivía en el componente padre (siempre montado),
  // así que persistía al cambiar de pestaña. Vive acá para conservar ese comportamiento
  // (las pestañas se montan/desmontan por render condicional).
  const [search, setSearch] = useState('')       // buscador de productos (VisitaCatalogo)
  const [catFilter, setCatFilter] = useState('Todos') // chip de categoría activo (VisitaCatalogo)
  const [routeCalc, setRouteCalc] = useState(false) // ruta calculada (RutaTab)
  const [rutaInfo, setRutaInfo] = useState(null)  // métricas de la ruta (RutaTab)
  const timerRef = useRef(null)
  const toastRef = useRef(null)
  const visitaActualRef = useRef(null) // id de la fila `visitas` en curso (para cerrar en check-out)

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
    registrarCheckIn(id)
  }

  // Persiste el check-in en `visitas` (offline-safe por la write queue) y, si el comercio no
  // tiene ubicación y hay un fix GPS, la guarda vía la RPC reclamar_y_ubicar_cliente (Feature C).
  // La RPC (SECURITY DEFINER) reclama el cliente y fija lat/lng en una operación segura; NO se
  // usa updateCliente() acá porque encolaría un UPDATE de clientes que la RLS rechaza para
  // comercios sin dueño y taponaría la cola (mismo riesgo que la cola de posiciones).
  async function registrarCheckIn(idCliente) {
    if (!userId || !idEmpresa) return // sesión aún no lista: el check-in local ya quedó registrado
    const vid = uid()
    visitaActualRef.current = vid
    const p = pos
    try {
      await enqueueMutacion({
        op_uid: vid, table: 'visitas', op: 'insert',
        payload: {
          id: vid, id_empresa: idEmpresa, id_usuario: userId, id_cliente: idCliente,
          check_in_ts: new Date().toISOString(), estado: 'en_curso',
          lat: p?.lat ?? null, lng: p?.lng ?? null, accuracy: p?.accuracy ?? null,
        },
      })
      flushMutaciones() // subir ya si hay red; si no, queda en cola
    } catch (_) { /* la visita queda en cola igual */ }

    // Ubicar/reclamar el comercio (best-effort, requiere red). El fix igual quedó guardado en
    // la visita, así que la ubicación no se pierde aunque esto falle offline.
    const cli = cartera.find((c) => c.id === idCliente)
    if (p && cli && cli.lat == null) {
      try {
        const { error } = await supabase.rpc('reclamar_y_ubicar_cliente', { p_id: idCliente, p_lat: p.lat, p_lng: p.lng })
        if (!error) showToast('Ubicación del comercio guardada')
      } catch (_) { /* offline o sin permiso: se puede reintentar en la próxima visita */ }
    }
  }

  // Cierra la visita en curso en `visitas` (check-out): estado + hora de salida + monto.
  function cerrarVisita(status, extra) {
    const vid = visitaActualRef.current
    if (!vid) return
    visitaActualRef.current = null
    enqueueMutacion({
      op_uid: uid(), table: 'visitas', op: 'update', id: vid,
      payload: { check_out_ts: new Date().toISOString(), estado: estadoVisita(status), monto: extra?.monto ?? null },
    }).then(() => flushMutaciones()).catch(() => {})
  }

  function endVisit(status, extra) {
    clearInterval(timerRef.current)
    cerrarVisita(status, extra)
    setVisitState((v) => ({ ...v, [visit]: { status, hora: now(), ...extra } }))
    setVisit(null); setSeconds(0); setCart({}); setSheet(false); setMotivo(null); setTab('inicio')
  }
  function cancelVisit() {
    clearInterval(timerRef.current)
    cerrarVisita('cancelado')
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
  const clients = cartera.map((c) => ({ id: c.id, name: c.name, loc: c.loc, codigo: c.codigo, lat: c.lat, lng: c.lng, activo: c.activo, idVendedor: c.idVendedor, ...(visitState[c.id] || { status: 'pendiente' }) }))
  const nextId = (clients.find((c) => c.status === 'pendiente') || {}).id
  const done = clients.filter((c) => c.status !== 'pendiente').length
  const conPedido = clients.filter((c) => c.status === 'visitado')
  const montoHoy = conPedido.reduce((a, c) => a + (c.monto || 0), 0)
  const visitC = clients.find((c) => c.id === visit)

  // --- carrito ---
  const prodById = (id) => PRODUCTS.find((p) => p.id === id)
  // Precio que se cobra: el de oferta cuando el producto está en oferta y tiene precio_oferta.
  const precioEfectivo = (p) => (p && p.oferta && p.precioOferta != null ? p.precioOferta : (p?.price || 0))
  const entries = Object.entries(cart)
  const cartCount = entries.reduce((a, [, v]) => a + v, 0)
  const cartKg = entries.reduce((a, [id, v]) => a + v * (prodById(id)?.kg || 0), 0)
  const cartTotal = entries.reduce((a, [id, v]) => a + v * precioEfectivo(prodById(id)), 0)
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  // --- ruta / metas ---
  const pend = clients.map((c, i) => ({ c, i })).filter((x) => x.c.status === 'pendiente')
  const pendingCoords = pend.map((x) => x.c).filter((c) => c.lat != null).map((c) => ({ lat: c.lat, lng: c.lng }))
  const meta = Math.min(100, Math.round((montoHoy / 900000) * 100))
  const efect = done ? Math.round((conPedido.length / done) * 100) : 0

  return {
    tab, setTab,
    visit, seconds, cart, sheet, setSheet, motivo, setMotivo,
    search, setSearch, catFilter, setCatFilter, routeCalc, setRouteCalc, rutaInfo, setRutaInfo,
    catLoading, PRODUCTS,
    clients, nextId, done, conPedido, montoHoy, visitC,
    cartCount, cartKg, cartTotal, timer,
    pend, pendingCoords, meta, efect,
    toast, showToast, startVisit, endVisit, cancelVisit, addCart,
  }
}
