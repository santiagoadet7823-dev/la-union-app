import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos, kgFmt, horaActual } from '../../lib/format'
import { Truck, Check, Pin } from '../../components/icons'
import Logo from '../../components/Logo'
import Overlay from '../../components/Overlay'
import { useGps } from '../../context/GpsContext'
import { useAuth } from '../../context/AuthContext'
import { useEntregas, marcarEstado, guardarEntregado, MOTIVO_CHIPS, MOTIVO_POR_DEFECTO } from './useEntregas'
import { obtenerRutaOptimaTSP } from '../../services/routing'
import { Route } from '../../components/icons'

const ORDER = { pendiente: 0, en_camino: 1, entregado: 2 }
const hoy = () => new Date().toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()

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
  const [deliveries, setDeliveries] = useState([])
  useEffect(() => { setDeliveries(entregas) }, [entregas])
  const [modal, setModal] = useState(null) // id
  const [step, setStep] = useState('cant')
  const [qty, setQty] = useState({})
  const [motivos, setMotivos] = useState({})
  const [hasInk, setHasInk] = useState(false)
  const [toast, setToast] = useState(null)
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

  // El repartidor emite su ubicación en vivo (GPS del contexto) para que el Admin lo siga.
  const { pos: livePos, error: gpsError, request: pedirGps } = useGps()
  const nombre = perfilAuth?.nombre || 'Repartidor'

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
    ctx.strokeStyle = '#0B2B2A'
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
    const paradas = deliveries.filter((d) => d.status !== 'entregado' && d.lat != null && d.lng != null)
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
    const e = ORDER[a.status] - ORDER[b.status]
    if (e !== 0) return e
    if (recorrido && a.status !== 'entregado') {
      const pa = recorrido.orden[a.id], pb = recorrido.orden[b.id]
      if (pa != null && pb != null) return pa - pb
      if (pa != null) return -1
      if (pb != null) return 1
    }
    return a.tomado.localeCompare(b.tomado)
  })
  const porEntregar = deliveries.filter((d) => d.status !== 'entregado').length
  const progressPct = deliveries.length ? Math.round(((deliveries.length - porEntregar) / deliveries.length) * 100) : 0
  const md = deliveries.find((d) => d.id === modal)
  // 🩸 El Overlay sigue montado durante los ~240 ms de la animación de salida, pero
  // `md` se vuelve undefined en el mismo frame en que `modal` pasa a null. Sin
  // retener el último valor, el cuerpo del modal reventaría contra `md.items` justo
  // al cerrar. Vale para cualquier overlay cuyo contenido derive del estado que lo abre.
  const mdRef = useRef(md)
  if (md) mdRef.current = md
  const mdView = md || mdRef.current

  return (
    <div className="lu-mob" style={sx('height:100%;min-height:600px;display:flex;flex-direction:column;background:var(--bg-app);font-family:Inter,system-ui,sans-serif;color:var(--text);overflow:hidden;position:relative')}>
      {/* HEADER */}
      <div style={sx('flex:none;padding:16px 16px 12px;background:var(--surface);border-bottom:1px solid var(--line)')}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between')}>
          <div style={sx('display:flex;align-items:center;gap:8px')}>
            <Logo size={26} radius={8} />
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:14px;letter-spacing:.04em')}>DisT-At</div>
          </div>
          <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--faint)')}>{nombre} · {hoy()}</div>
        </div>
        <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-top:12px')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:18px')}>Hoja de entregas</div>
          <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;color:var(--muted)')}>
            <span style={sx('color:var(--text);font-weight:600')}>{porEntregar}</span> de {deliveries.length} por entregar
          </div>
        </div>
        <div style={sx('margin-top:10px;height:5px;border-radius:99px;background:var(--surface2);overflow:hidden;border:1px solid var(--line)')}>
          <div style={{ ...sx('height:100%;border-radius:99px;background:var(--success);transition:width .4s'), width: `${progressPct}%` }} />
        </div>

        {/* GPS en vivo — el repartidor envía su ubicación al panel aunque no vea el mapa */}
        {!livePos ? (
          <button
            onClick={() => pedirGps().catch(() => {})}
            style={sx('width:100%;margin-top:12px;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:13px;cursor:pointer')}
          >
            <Pin size={16} />
            {gpsError ? 'Reintentar — activar ubicación' : 'Activar GPS · enviar mi ubicación al panel'}
          </button>
        ) : (
          <div style={sx('margin-top:12px;display:flex;align-items:center;gap:8px;font-size:11px;color:var(--success);font-family:var(--font-mono)')}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: 'var(--success)', animation: 'lu-blink 1.6s infinite' }} />
            Enviando ubicación en vivo · {livePos.lat.toFixed(5)}, {livePos.lng.toFixed(5)}
          </div>
        )}

        {/* El recorrido óptimo. Va en el header y no flotando sobre la lista: es una decisión que se
            toma UNA vez al arrancar el reparto, no algo que se toque todo el tiempo. */}
        {deliveries.filter((d) => d.status !== 'entregado' && d.lat != null).length >= 2 && (
          <>
            <button
              onClick={calcularRecorrido}
              disabled={calculando}
              className="lu-press"
              style={{ ...sx('width:100%;margin-top:10px;min-height:46px;display:flex;align-items:center;justify-content:center;gap:8px;border-radius:12px;font-weight:600;font-size:13.5px;cursor:pointer'), border: '1px solid var(--line2)', background: recorrido ? 'var(--surface)' : 'var(--surface2)', color: 'var(--deep)', opacity: calculando ? 0.6 : 1 }}
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
            {deliveries.some((d) => d.status !== 'entregado' && d.lat == null) && (
              <div style={sx('margin-top:6px;font-size:11px;color:var(--faint);line-height:1.45')}>
                {deliveries.filter((d) => d.status !== 'entregado' && d.lat == null).length} comercio(s) sin ubicación quedan al final: no se pueden ordenar sin coordenadas.
              </div>
            )}
          </>
        )}
      </div>

      {/* LISTA */}
      <div style={sx('flex:1;overflow-y:auto;padding:12px 14px 28px')}>
        {cargandoEntregas && deliveries.length === 0 && (
          <div style={sx('margin-top:20px;padding:26px;text-align:center;color:var(--faint);font-size:13px')}>Buscando tus entregas de hoy…</div>
        )}
        {errorEntregas && (
          <div style={sx('margin-top:20px;padding:14px;border:1px solid var(--danger);border-radius:14px;color:var(--danger);font-size:12.5px;line-height:1.5')}>
            No se pudo leer tu hoja de entregas: {errorEntregas}
            <button onClick={recargar} style={sx('display:block;margin-top:10px;min-height:42px;padding:0 16px;border:1px solid var(--danger);border-radius:10px;background:transparent;color:var(--danger);font-size:12.5px;font-weight:600;cursor:pointer')}>Reintentar</button>
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
        {sorted.map((d) => {
          const arts = d.items.reduce((a, it) => a + it.gen, 0)
          const pill = d.status === 'pendiente' ? ['Pendiente', 'var(--warning)', 'var(--warning-tint)', 'none']
            : d.status === 'en_camino' ? ['En camino', 'var(--info)', 'var(--info-tint)', 'lu-blink 1.6s infinite']
            : ['Entregado', 'var(--success)', 'var(--success-tint)', 'none']
          return (
            <div key={d.id} style={{ ...sx('background:var(--surface);border-radius:16px;box-shadow:var(--shadow);padding:14px;margin-bottom:10px'), border: `1px solid ${d.status === 'en_camino' ? 'var(--info)' : 'var(--line)'}` }}>
              <div style={sx('display:flex;justify-content:space-between;align-items:flex-start;gap:8px')}>
                <div style={sx('min-width:0')}>
                  <div style={sx('font-weight:600;font-size:15px')}>{d.client}</div>
                  <div style={sx('font-size:11px;color:var(--faint);margin-top:2px')}><span style={sx('font-family:var(--font-mono)')}>{d.numero}</span>{d.loc ? ' · ' + d.loc : ''}</div>
                </div>
                <div style={{ ...sx('flex:none;display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;font-size:11px;font-weight:600'), background: pill[2], color: pill[1] }}>
                  <span style={{ ...sx('width:6px;height:6px;border-radius:99px'), background: pill[1], animation: pill[3] }} />{pill[0]}
                </div>
              </div>
              <div style={sx('display:grid;grid-template-columns:1fr 1fr 1.3fr;gap:8px;margin:12px 0;padding:10px 12px;background:var(--surface2);border:1px solid var(--line);border-radius:12px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                <Mini label="Artículos" value={arts} />
                <Mini label="Peso" value={`${kgFmt(d.kg)} kg`} />
                <Mini label="Monto" value={fmtPesos(d.monto)} color="var(--deep)" />
              </div>
              <div style={sx('display:flex;gap:12px;font-size:11px;color:var(--faint);font-family:var(--font-mono);font-variant-numeric:tabular-nums;margin-bottom:2px')}>
                <span>Tomado {d.tomado}</span>
                {d.entregado && <span style={sx('color:var(--success)')}>Entregado {d.entregado}</span>}
              </div>
              {d.status === 'pendiente' && (
                <button onClick={() => { setStatus(d.id, 'en_camino'); marcarEstado(d, 'en_camino').catch(() => showToast('Se guardó local: sube al volver la señal')); showToast(`${d.numero} marcado en camino`) }} style={sx('width:100%;margin-top:10px;min-height:52px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--info-tint);border:1px solid var(--info);color:var(--info);border-radius:12px;font-weight:600;font-size:15px;cursor:pointer')}>
                  <Truck />Marcar en camino
                </button>
              )}
              {d.status === 'en_camino' && (
                <button onClick={() => openModal(d)} style={sx('width:100%;margin-top:10px;min-height:52px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:15px;cursor:pointer;border:none')}>
                  <Check color="currentColor" w={2.2} size={18} />Confirmar entrega
                </button>
              )}
              {d.status === 'entregado' && (
                <div style={sx('margin-top:10px;display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--success);background:var(--success-tint);border-radius:12px')}>
                  <div style={sx('flex:none;width:92px;height:44px;background:#F7FCFB;border:1px solid var(--line2);border-radius:8px;display:grid;place-items:center;overflow:hidden')}>
                    {d.firma ? <img src={d.firma} alt="firma" style={sx('width:100%;height:100%;object-fit:contain')} />
                      : <svg viewBox="0 0 92 44" style={sx('width:100%;height:100%')}><path d="M12 30 C20 12, 28 34, 36 22 S52 10, 58 26 S74 34, 82 18" fill="none" stroke="#0B2B2A" strokeWidth="1.6" strokeLinecap="round" /></svg>}
                  </div>
                  <div>
                    <div style={sx('font-size:12.5px;font-weight:600;color:var(--success)')}>Entrega registrada</div>
                    {/* Honesto a propósito: la entrega y las cantidades SÍ se guardan; la firma
                        todavía no sube (ver el comentario del botón de confirmar). Decir
                        "conformidad registrada" cuando la imagen se pierde al recargar es prometer
                        un respaldo que no existe. */}
                    <div style={sx('font-size:11px;color:var(--muted);margin-top:2px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{d.entregado} · firma sólo en este teléfono</div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
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
            <button type="button" onClick={() => setModal(null)} className="lu-press" style={sx('flex:none;min-height:50px;padding:0 16px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r-md);font-weight:600;font-size:var(--fs-sm);color:var(--muted);cursor:pointer;background:transparent')}>Cancelar</button>
            <button type="button" onClick={() => { setStep('firma'); setHasInk(false) }} className="lu-press" style={sx('flex:1;min-height:50px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:var(--r-md);font-weight:600;font-size:var(--fs-md);cursor:pointer;border:none')}>Continuar a firma</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => setStep('cant')} className="lu-press" style={sx('flex:none;min-height:50px;padding:0 16px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r-md);font-weight:600;font-size:var(--fs-sm);color:var(--muted);cursor:pointer;background:transparent')}>Atrás</button>
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
                // Primero el estado y después las líneas: la cola es FIFO y corta al primer fallo, así
                // que si una línea rebota el pedido igual queda cerrado y el faltante se reintenta solo.
                marcarEstado(md, 'entregado')
                  .then(() => guardarEntregado(md, qty, motivos))
                  .catch(() => showToast('Se guardó local: sube al volver la señal'))
                showToast(`${md.numero} entregado${faltantes > 0 ? ` · ${faltantes} u. a reporte de faltante` : ' · completo'}`)
              }}
              style={{ ...sx('flex:1;min-height:50px;display:grid;place-items:center;border-radius:var(--r-md);font-weight:600;font-size:var(--fs-md);border:none'), background: hasInk ? 'var(--primary)' : 'var(--surface2)', color: hasInk ? 'var(--on-primary)' : 'var(--faint)', cursor: hasInk ? 'pointer' : 'not-allowed' }}
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
                          <div style={sx('display:flex;align-items:center;gap:2px')}>
                            <button onClick={() => setQty((v) => ({ ...v, [k]: Math.max(0, (v[k] ?? it.gen) - 1) }))} style={stepBtn}>−</button>
                            <div style={{ ...sx('width:38px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:16px;font-weight:600'), color: short ? 'var(--warning)' : 'var(--text)' }}>{del}</div>
                            <button onClick={() => setQty((v) => ({ ...v, [k]: Math.min(it.gen, (v[k] ?? it.gen) + 1) }))} style={stepBtn}>+</button>
                          </div>
                        </div>
                        {short && (
                          <div style={sx('margin-top:10px;padding-top:10px;border-top:1px dashed var(--line2)')}>
                            <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--warning);margin-bottom:7px')}>Faltan {it.gen - del} u. — motivo</div>
                            <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
                              {MOTIVO_CHIPS.map((label) => {
                                const on = motivo === label
                                return (
                                  <div key={label} onClick={() => setMotivos((v) => ({ ...v, [i]: label }))} style={{ ...sx('padding:8px 13px;border-radius:99px;font-size:12px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--warning)' : 'var(--line2)'}`, background: on ? 'var(--warning-tint)' : 'var(--surface)', color: on ? 'var(--warning)' : 'var(--muted)' }}>{label}</div>
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
                <div style={sx('position:relative;border:1px solid var(--line2);border-radius:var(--r-lg);overflow:hidden;background:#F7FCFB')}>
                  <canvas ref={initCanvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} style={sx('display:block;width:100%;height:210px;touch-action:none;cursor:crosshair')} />
                  <div style={sx('position:absolute;left:24px;right:24px;bottom:42px;border-bottom:1.5px dashed #C9E0DE;pointer-events:none')} />
                  {!hasInk && <div style={sx('position:absolute;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;pointer-events:none;color:#93A9A7;font-size:14px;font-weight:500')}>Firmá acá</div>}
                </div>
                <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-top:8px')}>
                  <div style={sx('font-size:var(--fs-xs);color:var(--faint);font-family:var(--font-mono)')}>{kgFmt(mdView.kg)} kg · {fmtPesos(mdView.monto)}</div>
                  <button type="button" onClick={clearSig} className="lu-press" style={sx('min-height:38px;padding:0 14px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r-sm);font-size:var(--fs-sm);font-weight:600;color:var(--muted);cursor:pointer;background:transparent')}>Limpiar</button>
                </div>
              </>
            )}
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

const stepBtn = { ...sx('width:42px;height:42px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;cursor:pointer;color:var(--muted);font-size:19px;user-select:none;background:transparent') }

function Mini({ label, value, color }) {
  return (
    <div>
      <div style={sx('font-size:9.5px;color:var(--faint);font-family:Inter,sans-serif;text-transform:uppercase;letter-spacing:.06em')}>{label}</div>
      <div style={{ ...sx('font-size:15px;font-weight:600;margin-top:1px'), color: color || 'inherit' }}>{value}</div>
    </div>
  )
}
