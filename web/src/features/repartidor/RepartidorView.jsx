import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos, kgFmt, horaActual } from '../../lib/format'
import { Truck, Check, Pin } from '../../components/icons'
import Overlay from '../../components/Overlay'
import { PildoraEstado } from '../../components/ui'
import BotonTransporte from '../../components/BotonTransporte'
import { useTransporte } from '../../hooks/useTransporte'
import { useGps } from '../../context/GpsContext'
import { useAuth } from '../../context/AuthContext'
import { useEntregas, marcarEstado, guardarEntregado, MOTIVO_CHIPS, MOTIVO_POR_DEFECTO } from './useEntregas'
import { obtenerRutaOptimaTSP } from '../../services/routing'
import MapaEntregas from './MapaEntregas'
import { Route } from '../../components/icons'

/**
 * 🎨 REDISEÑO C10 (01/10/2026, hoja "Hoja de Entregas" 2c + 2d y "Mapa del Repartidor" 3c).
 *
 * El repartidor no navega un inventario: hace un RECORRIDO con una sola parada activa a la vez.
 * Hasta hoy todas las entregas eran tarjetas iguales y la que importaba se distinguía por un borde
 * de 1 px. Ahora la parada actual ocupa media pantalla (cliente y dirección grandes, cuántos
 * artículos bajar, CTA de 56 px en el arco del pulgar) y el resto del día va en renglones.
 *
 * Qué se sacó y por qué (3c, "si le aparece el mapa piensa que lo vigilan"): el logo y el nombre
 * repetidos (06 §2.1), la barra de progreso y las COORDENADAS CRUDAS del GPS. Eran para
 * tranquilizar a la oficina, no para él; queda "Parada N de M" y una línea honesta de que la
 * ubicación se comparte. Peso y monto bajan a un renglón con "Ver detalle".
 *
 * El orden: la entrega EN CAMINO va primero (es la actual), después las pendientes (en el orden
 * del recorrido si se calculó), y al final las cerradas — no entregadas y entregadas. Antes
 * "En camino" iba DESPUÉS de las pendientes y `no_entregado` no tenía lugar en el mapa: el
 * `sort` comparaba `undefined` y daba NaN, así que un pedido que la oficina marcara "No
 * entregado" desordenaba la lista entera.
 */
const ORDER = { en_camino: 0, pendiente: 1, no_entregado: 2, entregado: 3 }
// Abierta = todavía hay que hacer algo. "No entregado" está CERRADA: no cuenta como entrega, pero
// tampoco es trabajo pendiente para el recorrido (la oficina decide si se reprograma).
const abierta = (d) => d.status === 'pendiente' || d.status === 'en_camino'

// Abre el navegador GPS del teléfono (Google Maps o el que esté). Con coordenada va directo; sin
// ella (el 70 % de la cartera todavía no está geolocalizada) se busca por la dirección. Es un
// enlace común: en el APK lo atiende la app de mapas y en la PWA una pestaña nueva.
function urlNavegar(d) {
  if (d.lat != null && d.lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`
  if (d.loc) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.loc)}`
  return null
}

export default function RepartidorView() {
  /**
   * 🩸 LAS ENTREGAS AHORA SON REALES (22/08/2026). Acá decía `useState([])` con un comentario que
   * prometía "los pedidos asignados, próxima etapa" — y esa etapa nunca llegó, así que la pantalla
   * vivía mostrando "no tenés entregas asignadas" para siempre. Ver `useEntregas`.
   *
   * El estado local sigue existiendo porque la pantalla lo toca de inmediato (marcar en camino,
   * confirmar) sin esperar a la red: la mutación va por la cola y puede tardar. Lo que cambia es que
   * ahora ARRANCA con lo que hay en la base, y no vacío.
   */
  const { perfil: perfilAuth } = useAuth()
  const { entregas, cargando: cargandoEntregas, error: errorEntregas, recargar } = useEntregas(perfilAuth?.id)
  /**
   * Jornada de transporte del REPARTIDOR (17/09/2026, decidido con el cliente): se abre sola con el
   * primer "En camino" del día y, por si nunca lo marcó, también al confirmar una entrega. Con el
   * tramo abierto el GPS queda a cadencia fija y desaparece el salto en el mapa al arrancar después
   * de descargar (ver `NEAR_LIVE_TRANSPORTE_MS`). `abrir` es idempotente: si ya está, no hace nada.
   * El botón de abajo muestra el estado y deja terminarlo (o abrirlo a mano si sale sin pedidos).
   */
  const { abrir: abrirTransporte } = useTransporte()
  const [deliveries, setDeliveries] = useState([])
  useEffect(() => { setDeliveries(entregas) }, [entregas])
  const [modal, setModal] = useState(null) // id
  const [step, setStep] = useState('cant')
  const [qty, setQty] = useState({})
  const [motivos, setMotivos] = useState({})
  const [hasInk, setHasInk] = useState(false)
  const [toast, setToast] = useState(null)
  // La parada que el repartidor eligió hacer AHORA, fuera del orden (tocó un renglón de "Después").
  // Él conoce la zona mejor que el algoritmo. Es sólo de esta pantalla: no se guarda en ningún
  // lado (ver "Reordenar paradas" en el informe del bloque C10: persistirlo necesita base).
  const [elegidaId, setElegidaId] = useState(null)
  // Hojas secundarias: el remito completo ("Ver detalle") y la confirmación de "No pude entregar".
  // Guardan el ID, y el cuerpo retiene el último valor para la animación de salida (ver `mdView`).
  const [detalleId, setDetalleId] = useState(null)
  const [noPudeId, setNoPudeId] = useState(null)
  /**
   * El recorrido óptimo. `{ orden: {idPedido: posición}, km, min }` o null.
   *
   * 🩸 NO SE PERSISTE, y no es un olvido. La tabla `rutas` existe con su `orden_paradas jsonb`,
   * pero `rutas_wr` es sólo de `admin`: guardarlo desde acá exigiría una migración para darle
   * escritura al repartidor, y todavía no hay nadie que necesite leer ese orden después. Se calcula
   * cuando lo pide y se va con la pantalla.
   */
  const [recorrido, setRecorrido] = useState(null)
  const [calculando, setCalculando] = useState(false)
  /**
   * El mapa arranca PLEGADO y se recuerda (17/09/2026). Es un pedido explícito de pantalla: la hoja
   * de entregas es una lista de trabajo y el repartidor la recorre de arriba abajo; un mapa de
   * 60 vh fijo arriba le empuja la primera entrega fuera de cuadro todas las mañanas. Desplegado,
   * es la vista de "por dónde sigo".
   */
  const [mapaAbierto, setMapaAbierto] = useState(() => {
    try { return localStorage.getItem('lu-reparto-mapa') === 'on' } catch (_) { return false }
  })
  const alternarMapa = () => setMapaAbierto((v) => {
    try { localStorage.setItem('lu-reparto-mapa', v ? 'off' : 'on') } catch (_) { /* igual funciona */ }
    return !v
  })

  // El repartidor emite su ubicación en vivo (GPS del contexto) para que el Admin lo siga.
  const { pos: livePos, error: gpsError, request: pedirGps } = useGps()

  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const drawing = useRef(false)
  const toastRef = useRef(null)

  useEffect(() => () => clearTimeout(toastRef.current), [])

  function showToast(msg) {
    clearTimeout(toastRef.current)
    setToast(msg)
    toastRef.current = setTimeout(() => setToast(null), 2800)
  }
  function setStatus(id, status, extra) {
    setDeliveries((ds) => ds.map((d) => (d.id === id ? { ...d, status, ...extra } : d)))
  }
  function openModal(d) {
    // Indexado por id de LÍNEA y no por posición en el array: la posición cambia si la lista se
    // reordena o si llega una recarga a mitad de la entrega, y ahí las cantidades se aplicarían al
    // producto equivocado — delante del cliente y sin que nada se vea raro.
    const q = {}
    d.items.forEach((it) => { q[it.idLinea] = it.gen })
    setQty(q); setMotivos({}); setHasInk(false); setStep('cant'); setModal(d.id)
  }

  // --- signature pad ---
  const initCanvas = (el) => {
    canvasRef.current = el
    if (!el) { ctxRef.current = null; return }
    const w = el.offsetWidth || 340
    el.width = w * 2
    el.height = 420
    const ctx = el.getContext('2d')
    ctx.scale(2, 2)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    // Tinta y papel FIJOS (no `--text`/`--surface`): la firma se guarda como imagen con el lienzo
    // transparente, así que la tinta tiene que ser oscura también con el tema oscuro puesto.
    // (01/10/2026, C10) El valor sale del token `--firma-tinta` de index.css, que NO sigue al
    // tema; un `<canvas>` no entiende `var(--x)`, así que se lee resuelto. El literal queda sólo
    // de respaldo por si el token no estuviera (es el mismo valor).
    ctx.strokeStyle = getComputedStyle(el).getPropertyValue('--firma-tinta').trim() || '#2E3A44'
    ctxRef.current = ctx
    drawing.current = false
  }
  const posOf = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const down = (e) => {
    if (!ctxRef.current) return
    e.target.setPointerCapture?.(e.pointerId)
    drawing.current = true
    const [x, y] = posOf(e)
    ctxRef.current.beginPath()
    ctxRef.current.moveTo(x, y)
    if (!hasInk) setHasInk(true)
  }
  const move = (e) => {
    if (!drawing.current || !ctxRef.current) return
    const [x, y] = posOf(e)
    ctxRef.current.lineTo(x, y)
    ctxRef.current.stroke()
  }
  const up = () => { drawing.current = false }
  const clearSig = () => {
    if (canvasRef.current && ctxRef.current) ctxRef.current.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
    setHasInk(false)
  }

  /**
   * El recorrido óptimo de las entregas pendientes.
   *
   * 🔑 Reusa `obtenerRutaOptimaTSP`, **el mismo motor que ya está en producción** en el botón
   * "Calcular ruta óptima" del vendedor (`RutaTab`). Lo único que cambia es de dónde salen las
   * paradas: acá son los comercios de los pedidos asignados, allá los clientes por visitar. El
   * ruteo no se escribe de nuevo — `services/routing/index.js` es el único punto de swap, por diseño.
   *
   * `source=first` con la posición del repartidor adelante: el orden óptimo arranca donde está
   * parado, no en un depósito teórico. Y `roundtrip=false`, porque nadie tiene que volver al punto
   * de partida al terminar el reparto.
   */
  async function calcularRecorrido() {
    const paradas = deliveries.filter((d) => abierta(d) && d.lat != null && d.lng != null)
    if (!livePos) { showToast('Hace falta el GPS para ordenar el recorrido'); return }
    if (paradas.length < 2) { showToast('Con menos de dos paradas ubicadas no hay nada que ordenar'); return }
    setCalculando(true)
    try {
      const r = await obtenerRutaOptimaTSP([livePos, ...paradas.map((d) => ({ lat: d.lat, lng: d.lng }))], { roundtrip: false })
      // `orden[i]` es la posición de la parada `i` en la secuencia óptima. El índice 0 es el
      // repartidor, así que las paradas arrancan en 1.
      const pos = {}
      paradas.forEach((d, i) => { pos[d.id] = r.orden[i + 1] ?? i + 1 })
      setRecorrido({ orden: pos, km: r.distancia / 1000, min: Math.round(r.duracion / 60), sin: 0 })
    } catch (_) {
      // Sin señal no hay ruteo por calles. Se dice, no se inventa un orden por distancia recta:
      // en una ciudad con río o vías en el medio, la recta miente y el reparto sale peor.
      showToast('Sin conexión para calcular el recorrido. Reintentá con señal.')
    } finally { setCalculando(false) }
  }

  // --- derivados ---
  /**
   * El orden de la lista. Sin recorrido calculado manda el estado y después la hora en que se tomó
   * el pedido; con recorrido calculado, las pendientes se ordenan por el camino óptimo y las
   * entregadas caen al fondo igual.
   */
  const sorted = [...deliveries].sort((a, b) => {
    const e = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9)
    if (e !== 0) return e
    if (recorrido && abierta(a)) {
      const pa = recorrido.orden[a.id], pb = recorrido.orden[b.id]
      if (pa != null && pb != null) return pa - pb
      if (pa != null) return -1
      if (pb != null) return 1
    }
    return (a.tomado || '').localeCompare(b.tomado || '')
  })
  const abiertas = sorted.filter(abierta)
  const cerradas = sorted.filter((d) => !abierta(d))
  // La parada actual: la que eligió a mano (si sigue abierta), si no la primera abierta — que por
  // el orden de arriba es la que está EN CAMINO, o la próxima del recorrido.
  const actual = abiertas.find((d) => d.id === elegidaId) || abiertas[0] || null
  const despues = abiertas.filter((d) => d !== actual)
  // "Parada N de M": N es la que se está haciendo (las cerradas + 1). Con todo cerrado no hay N.
  const paradaN = actual ? cerradas.length + 1 : null
  const md = deliveries.find((d) => d.id === modal)
  // 🩸 El Overlay sigue montado durante los ~240 ms de la animación de salida, pero
  // `md` se vuelve undefined en el mismo frame en que `modal` pasa a null. Sin
  // retener el último valor, el cuerpo del modal reventaría contra `md.items` justo
  // al cerrar. Vale para cualquier overlay cuyo contenido derive del estado que lo abre.
  const mdRef = useRef(md)
  if (md) mdRef.current = md
  const mdView = md || mdRef.current
  // Mismo patrón para las dos hojas nuevas.
  const det = deliveries.find((d) => d.id === detalleId)
  const detRef = useRef(det)
  if (det) detRef.current = det
  const detView = det || detRef.current
  const np = deliveries.find((d) => d.id === noPudeId)
  const npRef = useRef(np)
  if (np) npRef.current = np
  const npView = np || npRef.current

  function marcarEnCamino(d) {
    setStatus(d.id, 'en_camino')
    abrirTransporte('reparto').catch(() => {})
    marcarEstado(d, 'en_camino').catch(() => showToast('Se guardó local: sube al volver la señal'))
    showToast(`${d.numero} marcado en camino`)
  }

  /**
   * "NO PUDE ENTREGAR" (hoja 2d, pregunta 6): un camino de primera clase al lado de "Navegar", no
   * escondido. Usa el estado `No entregado`, que ya existe en el CHECK de `pedidos.estado` (db/43)
   * y en `marcarEstado`, y que la oficina ya ve y filtra en Pedidos. No pide firma y no cuenta
   * como entrega.
   * ⚠️ LO QUE NO HACE, a propósito: guardar el MOTIVO (comercio cerrado / cliente ausente /
   * rechazo total / no pude llegar) ni la foto de respaldo de la hoja. `pedidos` no tiene una
   * columna para eso — `motivo_no_venta` es "por qué el comercio no compró" (vendedor) y
   * `motivo_anulacion` es otra cosa — y agregarla es una migración. Ofrecer cuatro botones que no
   * se guardan sería prometer un respaldo que no existe (el mismo criterio que la firma, abajo).
   */
  function confirmarNoEntregado(d) {
    setStatus(d.id, 'no_entregado')
    setNoPudeId(null)
    if (elegidaId === d.id) setElegidaId(null)
    marcarEstado(d, 'no_entregado').catch(() => showToast('Se guardó local: sube al volver la señal'))
    showToast(`${d.numero} quedó como no entregado`)
  }

  const arts = (d) => d.items.reduce((a, it) => a + it.gen, 0)
  const nav = actual ? urlNavegar(actual) : null

  return (
    <div className="lu-mob" style={sx('height:100%;min-height:600px;display:flex;flex-direction:column;background:var(--bg-app);font-family:Inter,system-ui,sans-serif;color:var(--text);overflow:hidden;position:relative')}>
      {/* HEADER — sin logo ni nombre repetidos (06 §2.1) y sin barra de progreso: "Parada N de M"
          dice lo mismo en el idioma del repartidor. */}
      <div style={sx('flex:none;padding:14px 16px 12px;background:var(--surface);border-bottom:1px solid var(--line)')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:18px')}>Hoja de entregas</div>
          <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted)')}>
            {paradaN
              ? <>Parada <b style={sx('color:var(--text);font-size:14px')}>{paradaN}</b> de {deliveries.length}</>
              : deliveries.length ? 'Todo cerrado' : null}
          </div>
        </div>

        {/* GPS en vivo — el repartidor envía su ubicación al panel aunque no vea el mapa.
            (3c) Sin coordenadas crudas: "-24.78912, -65.41023" no le sirve a él y sí le dice
            "te estamos mirando". Una línea gris y honesta, sin banner ni radar. */}
        {!livePos ? (
          <button
            onClick={() => pedirGps().catch(() => {})}
            style={sx('width:100%;margin-top:12px;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer')}
          >
            <Pin size={16} />
            {gpsError ? 'Reintentar — activar ubicación' : 'Activar GPS · enviar mi ubicación al panel'}
          </button>
        ) : (
          <div style={sx('margin-top:8px;display:flex;align-items:center;gap:7px;font-size:11px;color:var(--muted);line-height:1.4')}>
            <span aria-hidden="true" style={{ flex: 'none', width: 6, height: 6, borderRadius: 99, background: 'var(--success)', animation: 'lu-blink 2.4s infinite' }} />
            Compartiendo tu ubicación con el panel
          </div>
        )}

        <BotonTransporte style={{ marginTop: 12 }} />

        {/* El recorrido óptimo. Va en el header y no flotando sobre la lista: es una decisión que se
            toma UNA vez al arrancar el reparto, no algo que se toque todo el tiempo. */}
        {abiertas.filter((d) => d.lat != null).length >= 2 && (
          <>
            <button
              onClick={calcularRecorrido}
              disabled={calculando}
              className="lu-press"
              style={{ ...sx('width:100%;margin-top:10px;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer'), border: '1px solid var(--line2)', background: recorrido ? 'var(--surface)' : 'var(--surface2)', color: 'var(--deep)', opacity: calculando ? 0.6 : 1 }}
            >
              <Route />{calculando ? 'Calculando…' : recorrido ? 'Recalcular recorrido' : 'Ordenar por recorrido óptimo'}
            </button>
            {recorrido && (
              <div style={sx('margin-top:7px;display:flex;gap:6px;flex-wrap:wrap;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11px;color:var(--muted)')}>
                <span style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:9px;padding:5px 9px')}>{recorrido.km.toFixed(1).replace('.', ',')} km</span>
                <span style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:9px;padding:5px 9px')}>~{recorrido.min} min</span>
                <span style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:9px;padding:5px 9px')}>desde donde estás</span>
              </div>
            )}
            {/* Las entregas sin ubicación NO entran en el cálculo y hay que decirlo: el 70 % de la
                cartera todavía no está geolocalizada, así que este caso es la norma, no la excepción. */}
            {abiertas.some((d) => d.lat == null) && (
              <div style={sx('margin-top:6px;font-size:11px;color:var(--faint);line-height:1.45')}>
                {abiertas.filter((d) => d.lat == null).length} comercio(s) sin ubicación quedan al final: no se pueden ordenar sin coordenadas.
              </div>
            )}
          </>
        )}
      </div>

      {/* LISTA */}
      <div style={sx('flex:1;overflow-y:auto;padding:12px 12px 28px')}>
        {/* EL MAPA DE LAS ENTREGAS. Va DENTRO del scroll y plegado por defecto: la hoja de
            entregas es la vista principal de este rol y el mapa es el complemento, no al revés.
            Sólo aparece si hay algo que dibujar — con la cartera sin geolocalizar del todo, un
            mapa vacío sería una promesa incumplida arriba de la pantalla. */}
        {deliveries.some((d) => d.lat != null) && (
          <>
            <button
              onClick={alternarMapa}
              className="lu-press"
              aria-expanded={mapaAbierto}
              style={sx('width:100%;margin-bottom:10px;min-height:48px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--line2);border-radius:12px;background:var(--surface);color:var(--deep);font-weight:600;font-size:14px;cursor:pointer')}
            >
              <Pin size={15} />{mapaAbierto ? 'Ocultar el mapa' : 'Ver las entregas en el mapa'}
            </button>
            {mapaAbierto && (
              <div style={sx('margin-bottom:12px')}>
                <MapaEntregas entregas={deliveries} recorrido={recorrido} onAbrir={openModal} />
              </div>
            )}
          </>
        )}

        {cargandoEntregas && deliveries.length === 0 && (
          <div style={sx('margin-top:20px;padding:26px;text-align:center;color:var(--faint);font-size:13px')}>Buscando tus entregas de hoy…</div>
        )}
        {errorEntregas && (
          <div style={sx('margin-top:20px;padding:14px;border:1px solid var(--danger);border-radius:14px;color:var(--danger);font-size:12.5px;line-height:1.5')}>
            No se pudo leer tu hoja de entregas: {errorEntregas}
            <button onClick={recargar} style={sx('display:block;margin-top:10px;min-height:44px;padding:0 16px;border:1px solid var(--danger);border-radius:10px;background:transparent;color:var(--danger);font-size:12.5px;font-weight:600;cursor:pointer')}>Reintentar</button>
          </div>
        )}
        {!cargandoEntregas && !errorEntregas && deliveries.length === 0 && (
          <div style={sx('margin-top:20px;background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:34px 20px;text-align:center')}>
            <div style={sx('width:52px;height:52px;margin:0 auto 12px;border-radius:99px;background:var(--surface2);display:grid;place-items:center')}>
              <Truck />
            </div>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:4px')}>No tenés entregas asignadas</div>
            <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>Cuando el panel te asigne pedidos vas a verlos acá. Mientras, tu ubicación se envía en vivo al panel.</div>
          </div>
        )}

        {/* LA PARADA ACTUAL (2c). Se distingue por tamaño, posición y tipografía, no por un borde:
            se lee desde el asiento, a contraluz. El estado va en PALABRAS ("ENTREGA EN CURSO"),
            no sólo en el color del rótulo. */}
        {actual && (
          <div style={sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-xl);padding:16px;box-shadow:var(--shadow-lg)')}>
            <div style={{ ...sx('font-family:var(--font-mono);font-size:11px;letter-spacing:.14em;font-weight:600'), color: actual.status === 'en_camino' ? 'var(--info)' : 'var(--deep)' }}>
              {actual.status === 'en_camino' ? '» ENTREGA EN CURSO' : 'PRÓXIMA ENTREGA'}
            </div>
            <div style={sx('font-family:var(--font-display);font-weight:700;font-size:23px;line-height:1.15;margin-top:6px;word-break:break-word')}>{actual.client}</div>
            <div style={sx('font-size:14px;color:var(--muted);margin-top:4px;word-break:break-word')}>
              {actual.loc || 'Sin dirección cargada'} · <span style={sx('font-family:var(--font-mono)')}>{actual.numero}</span>
            </div>
            <div style={sx('display:flex;align-items:baseline;flex-wrap:wrap;gap:8px;margin-top:12px')}>
              <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:26px;font-weight:700')}>{arts(actual)}</span>
              <span style={sx('font-size:14px;color:var(--muted)')}>artículos · {actual.items.length} {actual.items.length === 1 ? 'línea' : 'líneas'}</span>
            </div>
            {/* Peso y monto no cambian ninguna decisión del repartidor (el camión ya está cargado):
                bajan a un renglón, a un toque del remito completo. "Ver detalle" es un botón de
                44 aunque se vea como un enlace. */}
            <div style={sx('display:flex;align-items:center;flex-wrap:wrap;column-gap:4px;margin-top:2px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--faint)')}>
              <span>{kgFmt(actual.kg)} kg · {fmtPesos(actual.monto)}</span>
              <button type="button" onClick={() => setDetalleId(actual.id)} style={sx('min-height:44px;min-width:44px;padding:0 6px;border:0;background:transparent;font-family:var(--font-body);font-size:13px;font-weight:600;color:var(--deep);text-decoration:underline;text-underline-offset:3px;cursor:pointer')}>Ver detalle</button>
            </div>

            {/* UN solo control primario, siempre en el mismo lugar: 56 px de alto y ancho completo,
                con aire alrededor para que un dedo con guante no caiga en otro control. */}
            {actual.status === 'pendiente' && (
              <button type="button" onClick={() => marcarEnCamino(actual)} className="lu-press" style={sx('width:100%;margin-top:12px;min-height:56px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--info-tint);border:1px solid var(--info);color:var(--info);border-radius:14px;font-weight:600;font-size:16px;cursor:pointer')}>
                <Truck />Salir hacia esta parada
              </button>
            )}
            {actual.status === 'en_camino' && (
              <button type="button" onClick={() => openModal(actual)} className="lu-press" style={sx('width:100%;margin-top:12px;min-height:56px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border-radius:14px;font-weight:600;font-size:16px;cursor:pointer;border:none')}>
                <Check color="currentColor" w={2.2} size={18} />Confirmar entrega
              </button>
            )}
            <div style={sx('display:flex;gap:8px;margin-top:8px')}>
              {nav ? (
                <a href={nav} target="_blank" rel="noopener noreferrer" className="lu-press" style={sx('flex:1;min-width:0;min-height:48px;display:flex;align-items:center;justify-content:center;gap:7px;padding:0 8px;border-radius:12px;border:1px solid var(--line2);font-size:14px;font-weight:600;color:var(--muted);text-decoration:none;text-align:center')}>
                  <Route />Navegar
                </a>
              ) : (
                <button type="button" disabled title="Sin dirección ni ubicación cargada" style={sx('flex:1;min-width:0;min-height:48px;padding:0 8px;border-radius:12px;border:1px solid var(--line);background:transparent;font-size:14px;font-weight:600;color:var(--faint);opacity:.6')}>Sin dirección</button>
              )}
              <button type="button" onClick={() => setNoPudeId(actual.id)} className="lu-press" style={sx('flex:1;min-width:0;min-height:48px;padding:0 8px;border-radius:12px;border:1px solid var(--line2);background:transparent;font-size:14px;font-weight:600;color:var(--danger);cursor:pointer;line-height:1.2')}>No pude entregar</button>
            </div>
          </div>
        )}

        {/* DESPUÉS: el resto del recorrido, como renglones. Tocar uno lo vuelve la parada actual
            (la cambia sólo en esta pantalla): el repartidor conoce la zona. */}
        {despues.length > 0 && (
          <>
            <div style={sx('font-family:var(--font-mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:600;margin:16px 4px 4px')}>
              Después · {despues.length} {despues.length === 1 ? 'parada' : 'paradas'}
            </div>
            {despues.map((d, i) => (
              <button key={d.id} type="button" onClick={() => setElegidaId(d.id)} className="lu-press"
                aria-label={`Hacer ahora la entrega de ${d.client}`}
                style={sx('width:100%;min-height:52px;display:flex;align-items:center;gap:10px;padding:6px 4px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--text);font-family:inherit;text-align:left;cursor:pointer')}>
                <span style={sx('flex:none;min-width:26px;min-height:26px;border-radius:8px;background:var(--surface2);border:1px solid var(--line);display:grid;place-items:center;font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted)')}>
                  {/* Por POSICIÓN en pantalla, siempre: sigue a "Parada N de M". El número del recorrido
                      (`recorrido.orden`) cuenta desde otra base y podía repetir el de la actual. */}
                  {paradaN + i + 1}
                </span>
                <span style={sx('flex:1;min-width:0')}>
                  <span style={sx('display:block;font-size:14px;font-weight:600;word-break:break-word')}>{d.client}</span>
                  <span style={sx('display:block;font-size:11px;color:var(--faint);word-break:break-word')}>{d.loc || 'Sin dirección'}</span>
                  {/* Si eligió otra parada a mano, la que estaba EN CAMINO cae acá: no puede perder
                      el estado de vista (el pedido sigue "En camino" en la base). */}
                  {d.status === 'en_camino' && <PildoraEstado tipo="info" style={{ marginTop: 3 }}>En camino</PildoraEstado>}
                </span>
                <span style={sx('flex:none;font-family:var(--font-mono);font-size:12px;color:var(--muted)')}>{arts(d)} art.</span>
              </button>
            ))}
          </>
        )}

        {/* CERRADAS: entregadas y no entregadas, distintas por GLIFO y texto además del color
            (`PildoraEstado`), así al final del día no se confunden. */}
        {cerradas.length > 0 && (
          <>
            <div style={sx('font-family:var(--font-mono);font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);font-weight:600;margin:16px 4px 4px')}>
              Cerradas · {cerradas.length}
            </div>
            {cerradas.map((d) => (
              <div key={d.id} style={sx('display:flex;align-items:center;gap:10px;min-height:52px;padding:6px 4px;border-bottom:1px solid var(--line)')}>
                {d.status === 'entregado' && (
                  // La firma va sobre su papel fijo (tokens `--firma-*`): es la misma imagen en los
                  // dos temas, tinta oscura sobre claro.
                  <span style={sx('flex:none;width:64px;height:36px;background:var(--firma-papel);border:1px solid var(--line2);border-radius:8px;display:grid;place-items:center;overflow:hidden')}>
                    {d.firma ? <img src={d.firma} alt="firma" style={sx('width:100%;height:100%;object-fit:contain')} />
                      : <svg viewBox="0 0 92 44" aria-hidden="true" style={sx('width:100%;height:100%')}><path d="M12 30 C20 12, 28 34, 36 22 S52 10, 58 26 S74 34, 82 18" fill="none" stroke="var(--firma-tinta)" strokeWidth="1.6" strokeLinecap="round" /></svg>}
                  </span>
                )}
                <span style={sx('flex:1;min-width:0')}>
                  <span style={sx('display:block;font-size:13.5px;font-weight:600;word-break:break-word')}>{d.client}</span>
                  <span style={sx('display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:3px')}>
                    {d.status === 'entregado'
                      ? <PildoraEstado tipo="ok">Entregado{d.entregado ? ` ${d.entregado}` : ''}</PildoraEstado>
                      : <PildoraEstado tipo="aviso">No entregado</PildoraEstado>}
                    {/* Honesto a propósito: la entrega y las cantidades SÍ se guardan; la firma
                        todavía no sube (ver el comentario del botón de confirmar). Decir
                        "conformidad registrada" cuando la imagen se pierde al recargar es prometer
                        un respaldo que no existe. */}
                    {d.status === 'entregado' && <span style={sx('font-size:11px;color:var(--muted)')}>firma sólo en este teléfono</span>}
                  </span>
                </span>
                {/* Un "No pude entregar" tocado sin querer, con guantes, no puede ser definitivo
                    desde la calle: vuelve a "en camino" y a la parada actual. */}
                {d.status === 'no_entregado' && (
                  <button type="button" onClick={() => { setElegidaId(d.id); marcarEnCamino(d) }} className="lu-press" style={sx('flex:none;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--line2);background:transparent;font-size:13px;font-weight:600;color:var(--muted);cursor:pointer')}>Reintentar</button>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* MODAL DE ENTREGA — wizard de 2 pasos (cantidades → firma).
          `contained`: vive dentro del marco de teléfono en escritorio, sin portal. */}
      <Overlay
        open={!!md}
        onClose={() => setModal(null)}
        variant="sheet"
        contained
        title={step === 'cant' ? 'Verificación de cantidades' : 'Firma de conformidad'}
        subtitle={mdView ? `${mdView.numero} · ${mdView.client}` : ''}
        aside={
          <div style={sx('display:flex;gap:4px;align-items:center;margin-top:6px')}>
            <span style={sx('width:22px;height:4px;border-radius:var(--r-pill);background:var(--primary)')} />
            <span style={{ ...sx('width:22px;height:4px;border-radius:var(--r-pill)'), background: step === 'firma' ? 'var(--primary)' : 'var(--line2)' }} />
          </div>
        }
        footer={step === 'cant' ? (
          <>
            <button type="button" onClick={() => setModal(null)} className="lu-press" style={sx('flex:none;min-height:56px;padding:0 16px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r-md);font-weight:600;font-size:var(--fs-md);color:var(--muted);cursor:pointer;background:transparent')}>Cancelar</button>
            <button type="button" onClick={() => { setStep('firma'); setHasInk(false) }} className="lu-press" style={sx('flex:1;min-height:56px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:var(--r-md);font-weight:600;font-size:16px;cursor:pointer;border:none')}>Continuar a firma</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setStep('cant')} className="lu-press" style={sx('flex:none;min-height:56px;padding:0 16px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r-md);font-weight:600;font-size:var(--fs-md);color:var(--muted);cursor:pointer;background:transparent')}>Atrás</button>
            <button
              type="button"
              className="lu-press"
              onClick={() => {
                if (!hasInk || !md) return
                // ⚠️ LA FIRMA TODAVÍA NO SUBE, y es deliberado. Guardarla exige tocar `firmas_ins`, que
                // sigue siendo `to authenticated` SIN alcance por empresa (deuda conocida): tal como
                // está, cualquiera de cualquier distribuidora podría pisar la firma de otra. Eso es una
                // migración de seguridad con su propia verificación, no un detalle de esta pantalla.
                // Hasta entonces la firma se dibuja, se muestra y se pierde al recargar — y el cartel
                // de abajo lo dice, porque una conformidad que se cree guardada y no lo está es peor
                // que no tenerla.
                const firma = canvasRef.current ? canvasRef.current.toDataURL('image/png') : null
                const faltantes = md.items.reduce((a, it, i) => { const k = it.idLinea ?? i; return a + (it.gen - (qty[k] ?? it.gen)) }, 0)
                setStatus(md.id, 'entregado', { entregado: horaActual(), firma })
                setModal(null)
                // Red por si nunca marcó "en camino": desde acá arranca hacia la próxima entrega, y es
                // justo el arranque después de descargar el que dejaba el salto en el mapa.
                abrirTransporte('reparto').catch(() => {})
                // Primero el estado y después las líneas: la cola es FIFO y corta al primer fallo, así
                // que si una línea rebota el pedido igual queda cerrado y el faltante se reintenta solo.
                marcarEstado(md, 'entregado')
                  .then(() => guardarEntregado(md, qty, motivos))
                  .catch(() => showToast('Se guardó local: sube al volver la señal'))
                showToast(`${md.numero} entregado${faltantes > 0 ? ` · ${faltantes} u. a reporte de faltante` : ' · completo'}`)
              }}
              style={{ ...sx('flex:1;min-height:56px;display:grid;place-items:center;border-radius:var(--r-md);font-weight:600;font-size:16px;border:none'), background: hasInk ? 'var(--primary)' : 'var(--surface2)', color: hasInk ? 'var(--on-primary)' : 'var(--faint)', cursor: hasInk ? 'pointer' : 'not-allowed' }}
            >Confirmar entrega</button>
          </>
        )}
      >
            {mdView && step === 'cant' && (
              <>
                <div style={sx('font-size:12px;color:var(--muted);margin-bottom:10px')}>Verificá lo que entregás. Si es menos que lo pedido, indicá el motivo — alimenta el <b>reporte de faltante</b>.</div>
                <div>
                  {mdView.items.map((it, i) => {
                    const k = it.idLinea ?? i
                    const del = qty[k] ?? it.gen
                    const short = del < it.gen
                    // Mismo default que usa el guardado (ver `MOTIVO_POR_DEFECTO`): si esto y aquello
                    // se separan, la pantalla vuelve a mostrar un motivo que no se persiste.
                    const motivo = motivos[k] || MOTIVO_POR_DEFECTO
                    return (
                      <div key={i} style={{ ...sx('background:var(--surface);border-radius:14px;padding:12px;margin-bottom:8px'), border: `1px solid ${short ? 'var(--warning)' : 'var(--line)'}` }}>
                        <div style={sx('display:flex;align-items:center;gap:10px')}>
                          <div style={sx('flex:1;min-width:0')}>
                            <div style={sx('font-size:13px;font-weight:500')}>{it.name}</div>
                            <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono);font-variant-numeric:tabular-nums;margin-top:2px')}>Pedido: {it.gen} u.</div>
                          </div>
                          {/* (01/10/2026, C10) − y + de 44 con 8 px entre controles (brief v2 §4.3). */}
                          <div style={sx('display:flex;align-items:center;gap:8px')}>
                            <button type="button" aria-label="Entrega una unidad menos" onClick={() => setQty((v) => ({ ...v, [k]: Math.max(0, (v[k] ?? it.gen) - 1) }))} style={stepBtn}>−</button>
                            <div style={{ ...sx('width:38px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:16px;font-weight:600'), color: short ? 'var(--warning)' : 'var(--text)' }}>{del}</div>
                            <button type="button" aria-label="Entrega una unidad más" onClick={() => setQty((v) => ({ ...v, [k]: Math.min(it.gen, (v[k] ?? it.gen) + 1) }))} style={stepBtn}>+</button>
                          </div>
                        </div>
                        {short && (
                          <div style={sx('margin-top:10px;padding-top:10px;border-top:1px dashed var(--line2)')}>
                            <div style={sx('font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--warning);margin-bottom:7px')}>Faltan {it.gen - del} u. — motivo</div>
                            <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
                              {MOTIVO_CHIPS.map((label) => {
                                const on = motivo === label
                                return (
                                  // 🩸 (01/10/2026, C10) Acá decía `[i]: label` — la POSICIÓN de la línea — mientras
                                  // el chip elegido se lee con `motivos[k]` y `guardarEntregado` guarda
                                  // `motivos[it.idLinea]`. Con líneas reales (que siempre traen `idLinea`) el toque
                                  // no hacía nada visible y se guardaba siempre "Sin stock": el motivo que alimenta
                                  // el reporte de faltante mentía. Además: <button> de 44 con ✓ (no un div inerte
                                  // para TalkBack, y el elegido no depende sólo del color).
                                  <button type="button" key={label} aria-pressed={on} onClick={() => setMotivos((v) => ({ ...v, [k]: label }))} style={{ ...sx('min-height:44px;padding:0 14px;display:inline-flex;align-items:center;gap:5px;border-radius:99px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit'), border: `1px solid ${on ? 'var(--warning)' : 'var(--line2)'}`, background: on ? 'var(--warning-tint)' : 'var(--surface)', color: on ? 'var(--warning)' : 'var(--muted)' }}>{on && <Check size={14} color="currentColor" w={2} />}{label}</button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            {mdView && step === 'firma' && (
              <>
                <div style={sx('font-size:12px;color:var(--muted);margin-bottom:10px')}>Entregá el teléfono al receptor para que firme la conformidad.</div>
                {/* EL PAPEL DE FIRMA: tinta oscura sobre claro en LOS DOS temas (hoja 2d). Los colores
                    son los tokens `--firma-*` de index.css, que no siguen al tema — antes eran cuatro
                    hex escritos acá (`#FCFBF8`, `#B0C2C6`, `#5A6D76` y la tinta del canvas). Alto de
                    210: nadie firma bien en una franja de 44. */}
                <div style={sx('position:relative;border:1.5px dashed var(--firma-guia);border-radius:var(--r-lg);overflow:hidden;background:var(--firma-papel)')}>
                  <canvas ref={initCanvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} style={sx('display:block;width:100%;height:210px;touch-action:none;cursor:crosshair')} />
                  <div style={sx('position:absolute;left:24px;right:24px;bottom:42px;border-bottom:1.5px dashed var(--firma-guia);pointer-events:none')} />
                  {!hasInk && <div style={sx('position:absolute;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;pointer-events:none;color:var(--firma-texto);font-size:14px;font-weight:500')}>Dibujá la firma con el dedo</div>}
                </div>
                <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:8px')}>
                  <div style={sx('font-size:var(--fs-xs);color:var(--faint);font-family:var(--font-mono)')}>{kgFmt(mdView.kg)} kg · {fmtPesos(mdView.monto)}</div>
                  <button type="button" onClick={clearSig} className="lu-press" style={sx('min-height:44px;padding:0 14px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r-sm);font-size:var(--fs-sm);font-weight:600;color:var(--muted);cursor:pointer;background:transparent')}>Limpiar</button>
                </div>
              </>
            )}
      </Overlay>

      {/* EL REMITO COMPLETO ("Ver detalle"): sólo lectura, línea por línea. */}
      <Overlay
        open={!!det}
        onClose={() => setDetalleId(null)}
        variant="sheet"
        contained
        title="Detalle de la entrega"
        subtitle={detView ? `${detView.numero} · ${detView.client}` : ''}
      >
        {detView && (
          <>
            {detView.items.map((it, i) => (
              <div key={it.idLinea ?? i} style={sx('display:flex;align-items:baseline;justify-content:space-between;gap:12px;min-height:44px;padding:8px 0;border-bottom:1px solid var(--line)')}>
                <span style={sx('flex:1;min-width:0;font-size:14px;word-break:break-word')}>{it.name}</span>
                <span style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14px;font-weight:600')}>{it.gen} u.</span>
              </div>
            ))}
            <div style={sx('margin-top:10px;display:flex;flex-wrap:wrap;gap:4px 12px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted)')}>
              <span>{kgFmt(detView.kg)} kg</span>
              <span>{fmtPesos(detView.monto)}</span>
              {detView.tomado && <span>Tomado {detView.tomado}</span>}
            </div>
          </>
        )}
      </Overlay>

      {/* "NO PUDE ENTREGAR": confirmación de un paso (ver `confirmarNoEntregado`). */}
      <Overlay
        open={!!np}
        onClose={() => setNoPudeId(null)}
        variant="sheet"
        contained
        title="No se pudo entregar"
        subtitle={npView ? `${npView.numero} · ${npView.client}` : ''}
        footer={
          <>
            <button type="button" onClick={() => setNoPudeId(null)} className="lu-press" style={sx('flex:none;min-height:56px;padding:0 16px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r-md);font-weight:600;font-size:var(--fs-md);color:var(--muted);cursor:pointer;background:transparent')}>Volver</button>
            <button type="button" onClick={() => np && confirmarNoEntregado(np)} className="lu-press" style={sx('flex:1;min-height:56px;display:grid;place-items:center;background:var(--danger);color:var(--on-danger);border-radius:var(--r-md);font-weight:600;font-size:16px;cursor:pointer;border:none')}>Marcar como no entregado</button>
          </>
        }
      >
        <div style={sx('font-size:14px;color:var(--muted);line-height:1.55')}>
          El pedido queda como <b style={sx('color:var(--text)')}>No entregado</b>: no pide firma y no cuenta como entrega. La oficina lo ve en Pedidos y decide si se reprograma.
          <div style={sx('margin-top:8px')}>Si te equivocaste, desde <b style={sx('color:var(--text)')}>Cerradas</b> lo podés volver a intentar.</div>
        </div>
      </Overlay>

      {toast && (
        <div style={sx('position:absolute;top:14px;left:14px;right:14px;z-index:var(--z-toast);background:var(--surface);border:1px solid var(--line2);border-radius:12px;box-shadow:var(--shadow-lg);padding:11px 14px;display:flex;align-items:center;gap:9px')}>
          <Check color="var(--success)" />
          <span style={sx('font-size:12.5px;font-weight:500')}>{toast}</span>
        </div>
      )}
    </div>
  )
}

const stepBtn = { ...sx('width:44px;height:44px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;cursor:pointer;color:var(--muted);font-size:19px;user-select:none;background:transparent') }
