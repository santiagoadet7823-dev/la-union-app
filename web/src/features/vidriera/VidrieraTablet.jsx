import { useCallback, useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { fotoDe, tocar, desconectar } from '../../services/vidrieraTablet'

/**
 * LA VIDRIERA que ve el CLIENTE en la tablet. Recibe el catálogo ya filtrado por el celular del
 * vendedor y no vuelve a pedirle nada a nadie: no hay sesión, no hay Supabase, no hay internet.
 *
 * 🔴 ACÁ NO LLEGA LA RENTABILIDAD, y no es porque esta pantalla la esconda: `snapshotCatalogo`
 * (`services/vidriera.js`) arma el payload campo por campo y `nivel` no está. El marco de color que
 * el vendedor ve en SU catálogo es un código privado suyo. Si algún día alguien agrega el campo al
 * snapshot "para ordenar acá", el cliente ve el margen. El orden ya viene resuelto en `orden`,
 * calculado en el celular justo para no tener que mandar el criterio.
 *
 * ⚠️ Las fotos se piden DE A UNA y a medida que se necesitan, no todas al montar. Son ~13 MB para
 * 626 productos y la tablet tiene 2 GB de RAM con recolección de basura en cadena al arrancar
 * (medido el 18/08/2026 en la `Cidea CM915`). Se guardan en el caché y se muestran por ruta de
 * archivo — nunca en base64, que las infla un 33 % y las deja en el DOM.
 *
 * props: { sesion, catalogo, onSalir }
 */

// De a cuántas fotos se piden por vez. Tres en paralelo alcanza para que la grilla se vaya llenando
// mientras el cliente mira, sin que la tablet se quede sin aire.
const FOTOS_A_LA_VEZ = 3

export default function VidrieraTablet({ sesion, catalogo, onSalir }) {
  const productos = catalogo?.productos || []
  const orden = catalogo?.orden || []
  const [fotos, setFotos] = useState({})    // { [id]: url | null }
  const [tocado, setTocado] = useState(null) // id del último tocado (para el acuse)
  /**
   * 🩸 CANTIDADES (19/08/2026). En la primera prueba real el cliente podía señalar el producto pero
   * no decir CUÁNTOS, así que el vendedor tenía que preguntarlo en voz alta — justo la fricción que
   * la tablet venía a sacar. El número vive acá y viaja con el toque.
   *
   * Es una PROPUESTA, no el pedido: el cartel del celular la muestra y el vendedor confirma. Por eso
   * la tarjeta no dice "agregado" sino "se lo mostramos".
   */
  const [cant, setCant] = useState({}) // { [id]: n }
  /**
   * 🩸 BUSCADOR Y FILTROS (19/08/2026, pedido del cliente con la vidriera ya en uso). Son 529
   * productos en una grilla: sin filtrar, encontrar algo puntual es scrollear delante del cliente.
   * El catálogo del vendedor ya tenía buscador por el mismo motivo — acá se copia el CRITERIO, no
   * el código: mismos campos (nombre y marca) para que buscar lo mismo dé lo mismo en las dos
   * pantallas.
   *
   * `eje` alterna qué muestran los chips: hay ~10 categorías y 28 marcas, y dos filas de chips
   * sobre una tablet de 800 px se comen el espacio que necesita la grilla, que es de lo que se
   * trata la pantalla.
   */
  const [busca, setBusca] = useState('')
  const [eje, setEje] = useState('categoria') // 'categoria' | 'marca'
  const [filtro, setFiltro] = useState('Todos')
  const vivo = useRef(true)
  const pedidas = useRef(new Set())
  // Lo prende el botón "Actualizar fotos": vuelve a pedirlas aunque el archivo esté.
  const forzarRef = useRef(false)
  const [refrescando, setRefrescando] = useState(false)

  useEffect(() => () => { vivo.current = false; desconectar() }, [])

  // Ordenados como decidió el celular. Los que no estén en `orden` van al final, por si el snapshot
  // y la lista quedan desalineados: mejor mostrarlos que perderlos.
  const ordenados = (() => {
    const pos = new Map(orden.map((id, i) => [id, i]))
    return productos.slice().sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9))
  })()

  // Los valores del eje activo, en el orden en que aparecen (o sea: lo más destacado primero).
  const valores = [...new Set(ordenados.map((p) => (eje === 'marca' ? p.marca : p.categoria)).filter(Boolean))]
  const hayOfertas = ordenados.some((p) => p.oferta)
  const chips = ['Todos', ...(hayOfertas ? ['Ofertas'] : []), ...valores]

  const q = busca.trim().toLowerCase()
  const lista = ordenados.filter((p) => {
    if (q && !(p.nombre || '').toLowerCase().includes(q) && !(p.marca || '').toLowerCase().includes(q)) return false
    if (filtro === 'Ofertas') return p.oferta
    if (filtro !== 'Todos' && (eje === 'marca' ? p.marca : p.categoria) !== filtro) return false
    return true
  })

  /**
   * Bajar las fotos de a poco, en el orden en que se van a ver.
   *
   * ⚠️ Va sobre `ordenados` (el catálogo COMPLETO) y no sobre `lista` (lo filtrado). Con el buscador
   * puesto, `lista` son cuatro productos: si el efecto mirara eso, las fotos se bajarían solo de lo
   * que está buscando en ese momento y al limpiar el filtro la grilla quedaría gris. Y como `lista`
   * cambia con cada tecla, tampoco puede estar en las dependencias — se re-dispararía la descarga
   * entera mientras el cliente escribe.
   */
  useEffect(() => {
    let cancelado = false
    const conFoto = ordenados.filter((p) => p.foto && !pedidas.current.has(p.id))
    const obrero = async () => {
      while (!cancelado && conFoto.length) {
        const p = conFoto.shift()
        if (!p || pedidas.current.has(p.id)) continue
        pedidas.current.add(p.id)
        const url = await fotoDe(sesion, p.id, p.fotoV, forzarRef.current)
        if (cancelado || !vivo.current) return
        setFotos((f) => ({ ...f, [p.id]: url }))
      }
    }
    Promise.all(Array.from({ length: FOTOS_A_LA_VEZ }, obrero))
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogo, refrescando])

  /**
   * Volver a pedir TODAS las fotos. No hace falta en el uso normal —cada una se baja una sola vez y
   * se reconoce por su versión—, pero sí cuando una descarga quedó cortada por la mitad y el
   * producto se quedó sin imagen. Es el botón, no un automatismo: son ~20 MB.
   */
  const actualizarFotos = useCallback(() => {
    forzarRef.current = true
    pedidas.current = new Set()
    setFotos({})
    setRefrescando((v) => !v)
    setTimeout(() => { forzarRef.current = false }, 1000)
  }, [])

  // El stepper no manda nada: solo prepara el número. Se manda al tocar la tarjeta.
  const mover = useCallback((e, id, d) => {
    e.stopPropagation() // sin esto, tocar el + también dispararía el envío de la tarjeta
    setCant((c) => ({ ...c, [id]: Math.max(1, Math.min(999, (c[id] || 1) + d)) }))
  }, [])

  const alTocar = useCallback(async (p) => {
    // El acuse se muestra ANTES de que el envío termine: el cliente tiene que sentir que su toque
    // pasó algo, y esperar la ida y vuelta por WiFi se siente como que la tablet no responde.
    setTocado(p.id)
    setTimeout(() => { if (vivo.current) setTocado((t) => (t === p.id ? null : t)) }, 1800)
    try { if (navigator.vibrate) navigator.vibrate(18) } catch (_) { /* sin motor de vibración */ }
    await tocar(sesion, p, cant[p.id] || 1)
  }, [sesion, cant])

  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text)')}>
      <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;background:var(--surface);border-bottom:1px solid var(--line)')}>
        <div>
          <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)')}>Catálogo</div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:19px')}>
            {catalogo?.comercio?.nombre || 'Productos'}
          </div>
        </div>
        <div style={sx('display:flex;align-items:center;gap:14px')}>
          <div style={sx('font-family:var(--font-mono);font-size:12px;color:var(--faint)')}>
            {lista.length === ordenados.length ? `${lista.length} productos` : `${lista.length} de ${ordenados.length}`}
          </div>
          <button onClick={actualizarFotos} className="lu-press" title="Volver a bajar las fotos"
            style={sx('min-height:40px;padding:0 12px;border-radius:var(--r-md);border:1px solid var(--line2);background:transparent;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer')}>
            Actualizar fotos
          </button>
          {onSalir && (
            <button onClick={onSalir} className="lu-press"
              style={sx('min-height:40px;padding:0 14px;border-radius:var(--r-md);border:1px solid var(--line2);background:transparent;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer')}>
              Terminar
            </button>
          )}
        </div>
      </div>

      {/* Buscar y filtrar. Campos y toques grandes: esto lo usa un comerciante de pie. */}
      {ordenados.length > 0 && (
        <div style={sx('flex:none;padding:12px 14px 8px;display:flex;flex-direction:column;gap:9px;background:var(--surface);border-bottom:1px solid var(--line)')}>
          <div style={sx('display:flex;gap:9px;align-items:center')}>
            <div className="lu-campo" style={sx('flex:1;display:flex;align-items:center;gap:9px;background:var(--bg-app);border:1px solid var(--line2);border-radius:var(--r-md);padding:0 14px;height:50px')}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar producto o marca…"
                style={sx('flex:1;border:none;outline:none;background:transparent;font-family:Inter,sans-serif;font-size:15px;color:var(--text)')}
              />
              {busca && (
                <button onClick={() => setBusca('')} className="lu-press"
                  style={sx('width:32px;height:32px;flex:none;display:grid;place-items:center;border:none;background:transparent;color:var(--faint);font-size:19px;cursor:pointer')}>×</button>
              )}
            </div>
            {/* Qué eje filtran los chips. Cambiarlo resetea el filtro: un valor de marca no existe
                entre las categorías, y dejarlo puesto mostraría la grilla vacía sin motivo visible. */}
            <div style={sx('flex:none;display:flex;border:1px solid var(--line2);border-radius:var(--r-md);overflow:hidden')}>
              {[['categoria', 'Categorías'], ['marca', 'Marcas']].map(([k, etiqueta]) => (
                <button key={k} onClick={() => { setEje(k); setFiltro('Todos') }} className="lu-press"
                  style={{
                    ...sx('height:50px;padding:0 15px;border:none;font-size:13px;font-weight:600;cursor:pointer'),
                    background: eje === k ? 'var(--primary-tint)' : 'transparent',
                    color: eje === k ? 'var(--deep)' : 'var(--muted)',
                  }}>
                  {etiqueta}
                </button>
              ))}
            </div>
          </div>

          <div className="lu-chips" style={sx('display:flex;gap:8px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none;-ms-overflow-style:none')}>
            {chips.map((c) => {
              const on = filtro === c
              const esOferta = c === 'Ofertas'
              return (
                <button key={c} onClick={() => setFiltro(c)} className="lu-press"
                  style={{
                    ...sx('flex:none;min-height:40px;padding:0 16px;border-radius:99px;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap'),
                    border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`,
                    background: on ? 'var(--primary-tint)' : 'transparent',
                    color: on ? 'var(--deep)' : (esOferta ? 'var(--warning)' : 'var(--muted)'),
                  }}>
                  {esOferta ? '★ Ofertas' : c}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {!lista.length ? (
        <div style={sx('flex:1;display:grid;place-items:center;padding:40px;text-align:center;color:var(--muted);font-size:14px;line-height:1.5')}>
          {ordenados.length
            ? <span>No hay productos que coincidan.<br />Probá con otra palabra o tocá <b>Todos</b>.</span>
            : 'El vendedor todavía no tiene productos cargados en su catálogo.'}
        </div>
      ) : (
        <div style={sx('flex:1;overflow-y:auto;padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:12px;align-content:start')}>
          {lista.map((p) => {
            const url = fotos[p.id]
            const enOferta = p.oferta && p.precioOferta != null
            const acusado = tocado === p.id
            return (
              <div
                key={p.id}
                onClick={() => alTocar(p)}
                className="lu-press"
                role="button"
                style={{
                  ...sx('display:flex;flex-direction:column;background:var(--surface);border-radius:16px;overflow:hidden;cursor:pointer'),
                  // El marco es NEUTRO. En el catálogo del vendedor este borde lleva el color de la
                  // rentabilidad; acá no hay tal dato y no debe haberlo nunca.
                  border: `1px solid ${acusado ? 'var(--primary)' : 'var(--line)'}`,
                  boxShadow: acusado ? '0 0 0 2px var(--primary-tint)' : 'var(--shadow)',
                  transition: 'border-color 180ms cubic-bezier(.23,1,.32,1), box-shadow 180ms cubic-bezier(.23,1,.32,1)',
                }}
              >
                {/* padding-top en vez de aspect-ratio: el WebView de la tablet es Chrome 79. */}
                <div style={sx('position:relative;width:100%;padding-top:100%;background:var(--surface2)')}>
                  {url ? (
                    <img src={url} alt="" loading="lazy" style={sx('position:absolute;inset:0;width:100%;height:100%;object-fit:cover')} />
                  ) : (
                    <div style={sx('position:absolute;inset:0;display:grid;place-items:center;color:var(--faint)')}>
                      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                    </div>
                  )}
                  {enOferta && (
                    <span style={sx('position:absolute;top:8px;left:8px;background:var(--warning);color:#3d2c00;font-size:10px;font-weight:700;letter-spacing:.05em;padding:3px 8px;border-radius:99px')}>OFERTA</span>
                  )}
                  {acusado && (
                    <div className="lu-rise" style={sx('position:absolute;left:8px;right:8px;bottom:8px;padding:7px 10px;border-radius:12px;background:var(--primary);color:var(--on-primary);font-size:11.5px;font-weight:600;text-align:center')}>
                      Listo, se lo mostramos
                    </div>
                  )}
                  {/* Cuántos quiere. Toques grandes: esto lo usa un comerciante de pie, con una
                      mano, sobre una tablet apoyada en el mostrador. */}
                  {!acusado && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={sx('position:absolute;left:8px;right:8px;bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:6px;padding:4px;border-radius:12px;background:var(--glass-strong);border:1px solid var(--line)')}
                    >
                      <button onClick={(e) => mover(e, p.id, -1)} className="lu-press"
                        style={sx('width:38px;height:38px;flex:none;display:grid;place-items:center;border:none;border-radius:10px;background:transparent;color:var(--muted);font-size:21px;cursor:pointer;user-select:none')}>−</button>
                      <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:16px;font-weight:700')}>{cant[p.id] || 1}</span>
                      <button onClick={(e) => mover(e, p.id, 1)} className="lu-press"
                        style={sx('width:38px;height:38px;flex:none;display:grid;place-items:center;border:none;border-radius:10px;background:var(--primary-tint);color:var(--deep);font-size:20px;cursor:pointer;user-select:none')}>+</button>
                    </div>
                  )}
                </div>

                <div style={sx('flex:1;display:flex;flex-direction:column;padding:11px 12px 13px')}>
                  <div style={{ ...sx('font-size:13.5px;font-weight:500;line-height:1.35;min-height:2.7em'), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {p.nombre}
                  </div>
                  <div style={sx('margin-top:7px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                    {enOferta ? (
                      <div style={sx('display:flex;align-items:baseline;gap:7px;flex-wrap:wrap')}>
                        <span style={sx('font-size:12px;color:var(--faint);text-decoration:line-through')}>{fmtPesos(p.precio)}</span>
                        <span style={sx('font-size:16px;font-weight:700;color:var(--warning)')}>{fmtPesos(p.precioOferta)}</span>
                      </div>
                    ) : (
                      <span style={sx('font-size:16px;font-weight:700;color:var(--deep)')}>{fmtPesos(p.precio)}</span>
                    )}
                  </div>
                  {(p.unidades != null || p.kg > 0) && (
                    <div style={sx('margin-top:3px;font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>
                      {[p.unidades != null ? `×${p.unidades} u` : null, p.kg > 0 ? `${String(p.kg).replace('.', ',')} kg` : null].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
