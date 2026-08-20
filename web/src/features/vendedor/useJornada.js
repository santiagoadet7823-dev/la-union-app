import { useEffect, useRef, useState } from 'react'
import { useCatalog } from '../../context/CatalogContext'
import { useGps } from '../../context/GpsContext'
import { uid } from '../../lib/uid'
import { hoyStr } from '../../lib/format'
import { persistence } from '../../services/persistence'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { supabase } from '../../services/supabase'
import { enqueueMutacion, flushMutaciones } from '../../services/sync/writeQueue'
import { useVidriera } from '../vidriera/useVidriera'

const now = () => {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// status de la visita (UI) → estado permitido por visitas.estado_check (db/16).
const estadoVisita = (status) => (['visitado', 'sin_pedido', 'cancelado'].includes(status) ? status : 'visitado')

/**
 * 🩸 LA JORNADA ABIERTA SE PERSISTE (19/08/2026). Todo esto vivía SOLO en memoria de React, y eso
 * era un agujero con dos mitades:
 *
 *  1. **El check-out no llegaba nunca.** `visitaActualRef` es un ref; con cualquier recarga del
 *     WebView volvía a `null`, y `cerrarVisita` sale temprano cuando no lo tiene. Medido contra la
 *     base viva: **52 visitas, 33 `en_curso`, 19 `cancelado`, CERO `visitado` y CERO con monto** —
 *     o sea que en toda la vida del módulo no se guardó una sola venta. Y desde 1.12.1 la OTA se
 *     aplica sola (regla 48), así que recargar no es un accidente raro: es rutina.
 *  2. **El carrito se borraba delante del comerciante.** `cart` era `useState({})`: una recarga a
 *     mitad de una visita tiraba el pedido armado, sin un solo aviso.
 *
 * Se guarda por el puerto `persistence` (localStorage en web, SQLite en la APK) — el mismo que
 * sostiene la cola de posiciones. La fecha va adentro a propósito: una jornada de ayer NO se
 * restaura, porque `visitState` es "lo hecho HOY" y resucitarlo mentiría sobre el día en curso.
 */
const K_JORNADA = 'lu-jornada-abierta'

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
  const { pos, id: userId, nombre: nombreUsuario, idEmpresa } = useGps()
  const [tab, setTab] = useState('inicio')
  const [visit, setVisit] = useState(null)
  const [seconds, setSeconds] = useState(0)
  const [cart, setCart] = useState({})
  // INTENCIÓN DE COMPRA: lo que entró al carrito y salió. Antes se evaporaba —`addCart` con la
  // cantidad en cero hacía `delete next[id]` y no quedaba rastro— y es la señal comercial más
  // fuerte que genera una visita: lo iba a llevar y se arrepintió. Forma: { [id]: {cantidad, ts} }.
  const [quitados, setQuitados] = useState({})
  // El comprobante recién confirmado, para poder imprimirlo. Vive acá y no en la pestaña porque
  // `endVisit` vuelve a "Inicio" y eso desmonta `VisitaCatalogo`. Lo dibuja `VendedorView`.
  const [ticket, setTicket] = useState(null)
  const [sheet, setSheet] = useState(false)
  const [motivo, setMotivo] = useState(null)
  const [visitState, setVisitState] = useState({}) // { [idCliente]: {status, hora, monto, motivo} }
  const [toast, setToast] = useState(null)
  // Estado de UI que en el monolito vivía en el componente padre (siempre montado),
  // así que persistía al cambiar de pestaña. Vive acá para conservar ese comportamiento
  // (las pestañas se montan/desmontan por render condicional).
  const [search, setSearch] = useState('')       // buscador de productos (VisitaCatalogo)
  const [catFilter, setCatFilter] = useState('Todos') // chip de categoría activo (VisitaCatalogo)
  // Buscador de CLIENTES (InicioTab). Vive acá y no en la pestaña por el mismo motivo que los dos
  // de arriba: InicioTab se monta y se desmonta con el cambio de pestaña, así que un estado local
  // se perdería cada vez que el vendedor va a la ruta y vuelve — justo en medio de una búsqueda.
  const [buscaCli, setBuscaCli] = useState('')
  const [soloPendientes, setSoloPendientes] = useState(false)
  const [routeCalc, setRouteCalc] = useState(false) // ruta calculada (RutaTab)
  const [rutaInfo, setRutaInfo] = useState(null)  // métricas de la ruta (RutaTab)
  const timerRef = useRef(null)
  const toastRef = useRef(null)
  const visitaActualRef = useRef(null) // id de la fila `visitas` en curso (para cerrar en check-out)
  const visitaTsRef = useRef(null)      // epoch del check-in, para reanudar el timer tras una recarga
  // 🩸 EL CERO FALSO DE LA DISTANCIA. Si el comercio no tenía ubicación, el check-in se la asigna
  // con las coordenadas de donde está el vendedor (`reclamar_y_ubicar_cliente`). A partir de ahí
  // "distancia al comercio" da ~0 POR CONSTRUCCIÓN y no prueba absolutamente nada. Cuando pasa,
  // el pedido se guarda con `distancia_m = null`: no saber es un dato, un 0 inventado es mentira.
  const ubicadoEnEstaVisitaRef = useRef(false)
  const carritoPrevioRef = useRef(null) // respaldo para el "Deshacer" de vaciar el pedido
  // Hasta que no terminó de leerse lo guardado NO se escribe: el primer render tiene el estado
  // vacío, y guardarlo pisaría la jornada que se está por restaurar. Este es el orden que hace
  // que la persistencia arregle el bug en vez de causar uno nuevo.
  const restauradoRef = useRef(false)

  useEffect(() => () => { clearInterval(timerRef.current); clearTimeout(toastRef.current) }, [])

  // --- restaurar la jornada abierta (una sola vez, al montar) ---
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const g = await persistence.get(K_JORNADA, null)
        // Solo si es de HOY. Una jornada de ayer se descarta entera: `visitState` significa "lo
        // hecho hoy" y restaurarlo mentiría sobre el día en curso.
        if (vivo && g && g.fecha === hoyStr()) {
          visitaActualRef.current = g.visitaId || null
          visitaTsRef.current = g.visitaTs || null
          if (g.visit) setVisit(g.visit)
          if (g.cart) setCart(g.cart)
          if (g.quitados) setQuitados(g.quitados)
          if (g.visitState) setVisitState(g.visitState)
          // El timer se reanuda desde el check-in real, no desde cero: si el WebView se recargó a
          // los 12 minutos, mostrar 00:00 haría creer que la visita recién empieza.
          if (g.visit && g.visitaTs) {
            const pasado = Math.max(0, Math.round((Date.now() - g.visitaTs) / 1000))
            setSeconds(pasado)
            clearInterval(timerRef.current)
            timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
          }
        }
      } catch (_) { /* si no se puede leer, se arranca limpio: nunca romper el arranque */ }
      restauradoRef.current = true
    })()
    return () => { vivo = false }
  }, [])

  // --- guardar la jornada abierta ante cualquier cambio ---
  useEffect(() => {
    if (!restauradoRef.current) return
    persistence.set(K_JORNADA, {
      fecha: hoyStr(),
      visit,
      visitaId: visitaActualRef.current,
      visitaTs: visitaTsRef.current,
      cart,
      quitados,
      visitState,
    }).catch(() => {})
  }, [visit, cart, quitados, visitState])

  function showToast(msg) {
    clearTimeout(toastRef.current)
    setToast(msg)
    toastRef.current = setTimeout(() => setToast(null), 2800)
  }
  function startVisit(id) {
    clearInterval(timerRef.current)
    setSeconds(0)
    visitaTsRef.current = Date.now()
    ubicadoEnEstaVisitaRef.current = false
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
    setVisit(id); setCart({}); setQuitados({}); setTab('catalogo')
    carritoPrevioRef.current = null
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
      ubicadoEnEstaVisitaRef.current = true // ver el comentario del ref: invalida la distancia de hoy
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

  // Estado que hay que soltar al terminar una visita, cierre como cierre. Va en un solo lugar
  // porque son cuatro piezas y olvidarse de una arrastra basura a la visita siguiente: el carrito
  // del comercio anterior, su intención de compra, o un "Deshacer" que restituye un pedido ajeno.
  function limpiarVisita() {
    visitaTsRef.current = null
    carritoPrevioRef.current = null
    ubicadoEnEstaVisitaRef.current = false
    setVisit(null); setSeconds(0); setCart({}); setQuitados({}); setSheet(false); setMotivo(null); setTab('inicio')
  }
  function endVisit(status, extra) {
    clearInterval(timerRef.current)
    cerrarVisita(status, extra)
    setVisitState((v) => ({ ...v, [visit]: { status, hora: now(), ...extra } }))
    limpiarVisita()
  }
  function cancelVisit() {
    clearInterval(timerRef.current)
    cerrarVisita('cancelado')
    limpiarVisita()
  }
  function addCart(id, d) {
    setCart((c) => {
      const previa = c[id] || 0
      const q = Math.max(0, previa + d)
      const next = { ...c }
      if (q === 0) delete next[id]; else next[id] = q
      // Si salió del carrito teniendo algo, queda anotado como intención de compra. Si vuelve a
      // entrar, deja de estarlo: la lista es "lo que NO terminó en el pedido", no un histórico.
      if (q === 0 && previa > 0) {
        setQuitados((v) => ({ ...v, [id]: { cantidad: previa, ts: Date.now() } }))
      } else if (q > 0) {
        setQuitados((v) => { if (!(id in v)) return v; const n = { ...v }; delete n[id]; return n })
      }
      return next
    })
  }

  /** Saca una línea entera del pedido de un toque (en vez de N toques al `−`). */
  function quitarDelCarrito(id) {
    const previa = cart[id] || 0
    if (!previa) return
    carritoPrevioRef.current = { ...cart }
    setCart((c) => { const n = { ...c }; delete n[id]; return n })
    setQuitados((v) => ({ ...v, [id]: { cantidad: previa, ts: Date.now() } }))
  }

  /**
   * Vacía el pedido entero. Va con "Deshacer" y no con una confirmación sola porque el error real
   * es el dedo, no la decisión: un diálogo frena al que quiso vaciar y no salva al que no quiso.
   * El respaldo vive en un ref —no en estado— para que no dispare renders ni se persista.
   */
  function vaciarCarrito() {
    if (!Object.keys(cart).length) return
    carritoPrevioRef.current = { ...cart }
    // Lo vaciado también es intención de compra: el cliente lo había pedido.
    setQuitados((v) => {
      const n = { ...v }
      for (const [id, q] of Object.entries(cart)) n[id] = { cantidad: q, ts: Date.now() }
      return n
    })
    setCart({})
  }

  /** Restituye lo último que se vació o se quitó. Devuelve false si no hay nada que restituir. */
  function deshacerCarrito() {
    const previo = carritoPrevioRef.current
    if (!previo) return false
    carritoPrevioRef.current = null
    setCart(previo)
    setQuitados((v) => { const n = { ...v }; for (const id of Object.keys(previo)) delete n[id]; return n })
    return true
  }

  /** Devuelve al pedido algo que estaba en "intención de compra", con la cantidad que tenía. */
  function recuperarQuitado(id) {
    const q = quitados[id]
    if (!q) return
    setCart((c) => ({ ...c, [id]: (c[id] || 0) + q.cantidad }))
    setQuitados((v) => { const n = { ...v }; delete n[id]; return n })
  }

  // --- clientes (cartera real) + estado de visita del día ---
  const clients = cartera.map((c) => ({ id: c.id, name: c.name, loc: c.loc, codigo: c.codigo, lat: c.lat, lng: c.lng, activo: c.activo, idVendedor: c.idVendedor, ...(visitState[c.id] || { status: 'pendiente' }) }))
  const nextId = (clients.find((c) => c.status === 'pendiente') || {}).id
  const done = clients.filter((c) => c.status !== 'pendiente').length
  const conPedido = clients.filter((c) => c.status === 'visitado')
  const montoHoy = conPedido.reduce((a, c) => a + (c.monto || 0), 0)
  const visitC = clients.find((c) => c.id === visit)

  /**
   * 🩸 LA LISTA QUE SE DIBUJA, FILTRADA (11/08/2026). No es un extra: son **1.803 clientes
   * vigentes** en una sola columna, sin paginar ni virtualizar, y el vendedor tenía que scrollearlos
   * para encontrar al que está por visitar. El encargado además no podía cargar ubicaciones por lo
   * mismo — el lápiz existe desde el 08/08 pero llegar hasta la tarjeta era imposible.
   *
   * **Este problema ya estaba diagnosticado y resuelto… en la otra pantalla.** `ClientesTab` (la de
   * gestión) tiene el buscador desde hace tiempo, con un comentario que dice textualmente que sin
   * filtrar no hay forma de encontrar nada. La del vendedor —la única que un vendedor tiene— nunca
   * lo recibió. Se copia el CRITERIO, no el código: los mismos tres campos (nombre, código y
   * localidad), para que buscar lo mismo dé lo mismo en las dos pantallas.
   *
   * El orden NO se toca: la numeración de las tarjetas y "Próxima parada" salen de `clients`, así
   * que filtrar no puede reordenar la jornada. `idx` conserva el número original de cada cliente
   * para que el 07 siga siendo el 07 con el buscador puesto.
   */
  const clientsFiltrados = (() => {
    const q = buscaCli.trim().toLowerCase()
    if (!q && !soloPendientes) return clients.map((c, i) => ({ ...c, idx: i }))
    return clients
      .map((c, i) => ({ ...c, idx: i }))
      .filter((c) => {
        if (soloPendientes && c.status !== 'pendiente') return false
        if (!q) return true
        return (c.name || '').toLowerCase().includes(q)
          || (c.codigo || '').toLowerCase().includes(q)
          || (c.loc || '').toLowerCase().includes(q)
      })
  })()

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

  /**
   * 🩸 LA SESIÓN DE VIDRIERA VIVE ACÁ (18/08/2026), no en la pestaña del catálogo.
   *
   * Estaba en `VisitaCatalogo`, y `VendedorView` monta esa pestaña como
   * `{j.tab === 'catalogo' && <VisitaCatalogo/>}`: **cambiar de pestaña la desmonta**, y el hook
   * cierra el hotspot al desmontar. O sea que el vendedor iba a Inicio para hacer el próximo
   * check-in y ahí mismo perdía la tablet — que es exactamente lo que se reportó de la primera
   * jornada. Acá arriba sobrevive a las pestañas Y a las visitas: al cambiar de cliente solo se
   * republica el catálogo con el comercio nuevo.
   *
   * El freno para que esto no deje el AP prendido toda la tarde vive dentro del hook
   * (`INACTIVA_MS`), no acá.
   */
  const vid = useVidriera({ productos: PRODUCTS, comercio: visitC, cart })

  /**
   * 🩸 EL PEDIDO SE GUARDA (19/08/2026). Hasta acá la app tomaba pedidos y no persistía **ninguno**:
   * `pedidos` y `pedido_items` existían con RLS completa desde `schema.sql` y no las tocaba una sola
   * línea de código. Lo único que se escribía era `visitas.monto`, un escalar — y los ítems, las
   * cantidades, los precios y los kg se descartaban al confirmar. Ver `db/43`.
   *
   * Va por la write queue (§7: nunca `supabase.from().insert()` desde un componente) en DOS
   * mutaciones y en este orden, que no es casual: la policy `items_ins` exige que el pedido padre
   * ya exista, y la cola es FIFO y corta al primer fallo. Las dos son idempotentes —`upsert` por
   * `id` con `ignoreDuplicates`— así que un reintento no duplica ni el pedido ni sus líneas, y el
   * número de pedido tampoco se consume dos veces (lo asigna un trigger BEFORE INSERT).
   *
   * `created_at` se estampa ACÁ y no se deja en el `now()` de la base: el pedido puede subir horas
   * después si el vendedor estaba sin señal, y entonces la hora de la base sería la de la subida.
   * La hora del pedido es la del comercio.
   */
  async function guardarPedido({ idCliente, idVisita, monto, kg }) {
    if (!userId || !idEmpresa || !idCliente) return null
    const lineas = Object.entries(cart)
      .map(([id, cantidad]) => ({ p: prodById(id), cantidad }))
      .filter((l) => l.p && l.cantidad > 0)
    if (!lineas.length) return null
    // El `numero` lo asigna un trigger BEFORE INSERT en la base, así que acá todavía no se conoce
    // — y no se puede esperar: el pedido puede subir horas después si el vendedor está sin señal.
    // El ticket que se imprime en el momento sale de estos datos locales, no de una relectura.

    const idPedido = uid()
    const p = pos
    const cli = cartera.find((c) => c.id === idCliente)

    // Distancia al comercio. NULL cuando no hay fix, cuando el comercio no tiene ubicación, o
    // cuando esa ubicación se cargó en esta misma visita (ver `ubicadoEnEstaVisitaRef`).
    let distancia = null
    if (p && cli && cli.lat != null && cli.lng != null && !ubicadoEnEstaVisitaRef.current) {
      distancia = Math.round(distanciaMetros({ lat: p.lat, lng: p.lng }, { lat: cli.lat, lng: cli.lng }))
    }

    // Intención de compra: lo que salió del carrito + lo que el cliente miró en la tablet y no
    // pidió. 🔴 Esto NUNCA vuelve a la tablet: es lectura del vendedor y de los reportes.
    const intencion = [
      ...Object.entries(quitados).map(([id, q]) => ({ id_producto: id, cantidad_previa: q.cantidad, origen: 'sacado' })),
      ...(vid.mirados || [])
        .filter((m) => !(cart[m.id] > 0) && !(m.id in quitados))
        .map((m) => ({ id_producto: m.id, cantidad_previa: 0, origen: 'mirado' })),
    ]

    const cabecera = {
      id: idPedido,
      id_empresa: idEmpresa,
      id_vendedor: userId,
      id_cliente: idCliente,
      id_visita: idVisita || null,
      estado: 'Pendiente',
      monto_total: monto,
      peso_total: kg,
      created_at: new Date().toISOString(),
      lat: p?.lat ?? null,
      lng: p?.lng ?? null,
      accuracy: p?.accuracy ?? null,
      distancia_m: distancia,
      origen: vid.activa ? 'vidriera' : 'celular',
      intencion,
    }

    const items = lineas.map(({ p: prod, cantidad }) => ({
      id: uid(),
      id_pedido: idPedido,
      id_producto: prod.id,
      // La descripción se COPIA, no se referencia: el ticket de hace seis meses tiene que seguir
      // diciendo lo que se vendió aunque marketing le haya cambiado el nombre o lo haya borrado.
      descripcion: prod.name,
      cantidad,
      precio_unitario: precioEfectivo(prod),
      peso_kg: prod.kg || 0,
    }))

    try {
      // 🔴 EL ORDEN NO ES INTERCAMBIABLE. La policy `items_ins` exige que el pedido padre exista, y
      // la cola es FIFO y corta al primer fallo: al revés, las líneas rebotarían por RLS y
      // taponarían la cola detrás suyo.
      await enqueueMutacion({ op_uid: idPedido, table: 'pedidos', op: 'insert', payload: cabecera })
      await enqueueMutacion({ op_uid: idPedido + ':items', table: 'pedido_items', op: 'insert', payload: items })
      flushMutaciones()
    } catch (_) { /* queda en cola; la cola es la que garantiza que no se pierda */ }

    // Se devuelve lo ARMADO y no un id: el ticket se imprime en el momento, y si el vendedor está
    // sin señal el pedido todavía no existe en la base para releerlo.
    return { pedido: cabecera, lineas: items, comercio: cli }
  }

  /**
   * Confirma el pedido y cierra la visita. Es el único camino: antes había dos botones que hacían
   * `endVisit('visitado', { monto })` cada uno por su lado y ninguno guardaba el pedido.
   */
  async function confirmarPedido() {
    const idCliente = visit
    const idVisita = visitaActualRef.current
    const monto = cartTotal
    const kg = cartKg
    const guardado = await guardarPedido({ idCliente, idVisita, monto, kg })
    endVisit('visitado', { monto, idPedido: guardado?.pedido?.id || null })
    // El ticket vive en el hook y no en la pestaña: `endVisit` vuelve a "Inicio" y eso DESMONTA
    // `VisitaCatalogo`, así que un ticket que colgara de ahí desaparecería en el mismo frame en
    // que se crea. Lo dibuja `VendedorView`, que está siempre montado.
    if (guardado) setTicket({ ...guardado, vendedor: { nombre: nombreUsuario } })
    return guardado
  }

  return {
    vid,
    tab, setTab,
    visit, seconds, cart, quitados, sheet, setSheet, motivo, setMotivo, ticket, setTicket,
    search, setSearch, catFilter, setCatFilter, routeCalc, setRouteCalc, rutaInfo, setRutaInfo,
    catLoading, PRODUCTS,
    clients, clientsFiltrados, buscaCli, setBuscaCli, soloPendientes, setSoloPendientes,
    nextId, done, conPedido, montoHoy, visitC,
    cartCount, cartKg, cartTotal, timer,
    pend, pendingCoords, meta, efect,
    toast, showToast, startVisit, endVisit, cancelVisit, addCart,
    quitarDelCarrito, vaciarCarrito, deshacerCarrito, recuperarQuitado, confirmarPedido,
  }
}
