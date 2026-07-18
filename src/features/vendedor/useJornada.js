import { useEffect, useRef, useState } from 'react'
import { useCatalog } from '../../context/CatalogContext'

const now = () => {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

/**
 * Máquina de estado de la jornada del vendedor: navegación por tabs, visita en curso
 * (check-in/timer), carrito del pedido, estado de cada cliente (visitado / sin pedido)
 * y el toast. Dueña única de esta lógica para que las pestañas (tabs/*) sean de solo
 * presentación. Lee el catálogo real para derivar clientes/productos.
 */
export function useJornada() {
  const { productos: PRODUCTS, clientes: cartera, loading: catLoading } = useCatalog()
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
  const [routeCalc, setRouteCalc] = useState(false) // ruta calculada (RutaTab)
  const [rutaInfo, setRutaInfo] = useState(null)  // métricas de la ruta (RutaTab)
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
  function cancelVisit() {
    clearInterval(timerRef.current)
    setVisit(null); setSeconds(0); setCart({}); setTab('inicio')
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
  const entries = Object.entries(cart)
  const cartCount = entries.reduce((a, [, v]) => a + v, 0)
  const cartKg = entries.reduce((a, [id, v]) => a + v * (prodById(id)?.kg || 0), 0)
  const cartTotal = entries.reduce((a, [id, v]) => a + v * (prodById(id)?.price || 0), 0)
  const timer = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

  // --- ruta / metas ---
  const pend = clients.map((c, i) => ({ c, i })).filter((x) => x.c.status === 'pendiente')
  const pendingCoords = pend.map((x) => x.c).filter((c) => c.lat != null).map((c) => ({ lat: c.lat, lng: c.lng }))
  const meta = Math.min(100, Math.round((montoHoy / 900000) * 100))
  const efect = done ? Math.round((conPedido.length / done) * 100) : 0

  return {
    tab, setTab,
    visit, seconds, cart, sheet, setSheet, motivo, setMotivo,
    search, setSearch, routeCalc, setRouteCalc, rutaInfo, setRutaInfo,
    catLoading, PRODUCTS,
    clients, nextId, done, conPedido, montoHoy, visitC,
    cartCount, cartKg, cartTotal, timer,
    pend, pendingCoords, meta, efect,
    toast, showToast, startVisit, endVisit, cancelVisit, addCart,
  }
}
