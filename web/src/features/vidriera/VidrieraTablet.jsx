import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { fotoDe, tocar, desconectar, limpiarFotos, escuchar, pedirCatalogo, fijarPantalla, soltarPantalla } from '../../services/vidrieraTablet'

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
 * 🩸 Y NADA DE `inset:0` ACÁ (18/08/2026). El WebView de la tablet es **Chrome 79** y la forma
 * corta `inset` recién existe desde Chrome 87: el navegador la ignora en silencio, así que una foto
 * `position:absolute` se queda sin sus cuatro offsets y se dibuja donde le parece. No se notó nunca
 * porque el catálogo cargado no tiene imágenes — o sea que iba a aparecer exactamente el día de la
 * prueba con fotos. Va la forma larga (`top/right/bottom/left`), que anda en todas.
 * Ojo: esto son estilos INLINE (`sx()`), y por ahí no pasa ni autoprefixer ni el plugin legacy —
 * eso transpila JS, no propiedades de CSS.
 *
 * props: { sesion, catalogo, onSalir }
 */

// De a cuántas fotos se piden por vez. Tres en paralelo alcanza para que la grilla se vaya llenando
// mientras el cliente mira, sin que la tablet se quede sin aire.
const FOTOS_A_LA_VEZ = 3

// Cuánto silencio antes de que la tablet se ponga a ofrecer sola, y cada cuánto cambia de producto.
// 30 s es el número que se acordó: menos y se dispara mientras el comerciante piensa.
const REPOSO_MS = 30000
const REPOSO_PASO_MS = 6000

// Cada cuánto se vuelcan a la pantalla las fotos que fueron llegando. Ver `encolarFoto`.
const TANDA_FOTOS_MS = 250

// Cuántas tarjetas se dibujan de entrada, y de a cuántas crece al llegar al final del scroll.
// 529 tarjetas de una son ~5.000 nodos en un WebView Chrome 79 con 2 GB de RAM.
const PAGINA = 60

// Alto de la foto de cada tarjeta, en píxeles. Pegado al ancho mínimo de columna (190 px) para que
// se vea cuadrada. Ver el 🩸 de la tarjeta: acá NO va un porcentaje.
const ALTO_FOTO = 190

/**
 * 🩸 `grid-auto-rows:max-content` NO ES DECORATIVO (18/08/2026). Con las filas en `auto` y el
 * contenedor con **altura definida** —que es lo que pasó al poner la raíz en `height:100vh`—, el
 * navegador las colapsaba al alto del texto: medido, **37 px de tarjeta contra los ~303** que
 * corresponden, con la foto recortada por el `overflow:hidden` de la tarjeta.
 *
 * Con 12 productos no pasaba y con 529 sí: es la clase de bug que solo aparece con el catálogo real,
 * y por eso la prueba se hace con 529 y no con tres (regla 50-bis).
 */
const ESTILO_GRILLA = sx('flex:1;overflow-y:auto;padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));grid-auto-rows:max-content;gap:12px;align-content:start')

/**
 * 🩸 UNA TARJETA, MEMOIZADA (18/08/2026). Estaba inline dentro del `map`, así que cualquier cambio
 * de estado de la pantalla —y cada foto que llegaba era uno— volvía a construir las 529.
 *
 * `memo` solo sirve si las props son estables: por eso `onTocar` y `onMover` son `useCallback` del
 * padre y la cantidad entra como número (`cantidad`) y no como el objeto `cant` entero, que cambia
 * de identidad con cada toque del `+` de cualquier producto.
 */
const Tarjeta = memo(function Tarjeta({ p, url, acusado, cantidad, onTocar, onMover }) {
  const enOferta = p.oferta && p.precioOferta != null
  return (
          <div
            onClick={() => onTocar(p)}
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
            {/* 🩸 ALTURA EXPLÍCITA, ni `aspect-ratio` ni `padding-top:100%` (18/08/2026).
                `aspect-ratio` no existe en Chrome 79, que es el WebView de esta tablet. Y el truco
                del `padding-top` porcentual **no aporta altura cuando el navegador dimensiona la
                fila del grid**: los porcentajes se resuelven a cero al calcular el tamaño
                intrínseco, así que la fila salía del alto del texto y la foto quedaba recortada por
                el `overflow:hidden` de la tarjeta. Medido: 37 px de tarjeta contra los ~310 que
                corresponden. Con `height` en píxeles el problema no existe, y `ALTO_FOTO` está
                pegado al ancho mínimo de columna, así que se sigue viendo cuadrada.
                ⚠️ Y `flex:none` NO es decorativo: la tarjeta es un contenedor flex en columna, así
                que un alto fijo igual se **encoge** si la fila del grid queda más baja (el default
                es `flex-shrink:1`). Sin esto, la foto medía 0 px con el `height:190px` puesto — que
                es exactamente lo que pasó al fijar el alto de la pantalla. */}
            <div style={{ ...sx('position:relative;width:100%;flex:none;background:var(--surface2)'), height: ALTO_FOTO }}>
              {url ? (
                <img src={url} alt="" loading="lazy" style={sx('position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover')} />
              ) : (
                <div style={sx('position:absolute;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;color:var(--faint)')}>
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
                  <button onClick={(e) => onMover(e, p.id, -1)} className="lu-press"
                    style={sx('width:38px;height:38px;flex:none;display:grid;place-items:center;border:none;border-radius:10px;background:transparent;color:var(--muted);font-size:21px;cursor:pointer;user-select:none')}>−</button>
                  <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:16px;font-weight:700')}>{cantidad}</span>
                  <button onClick={(e) => onMover(e, p.id, 1)} className="lu-press"
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
})

export default function VidrieraTablet({ sesion, catalogo, onSalir }) {
  /**
   * El catálogo llega como prop del emparejamiento, pero puede REEMPLAZARSE en vivo: si el servidor
   * avisa `resync` (se le cayeron eventos del buffer y no puede decir cuáles), la tablet vuelve a
   * pedirlo entero. Por eso vive en estado y no se lee de la prop directamente.
   */
  const [catalogoVivo, setCatalogoVivo] = useState(catalogo)
  useEffect(() => { setCatalogoVivo(catalogo) }, [catalogo])
  const productos = catalogoVivo?.productos || []
  const orden = catalogoVivo?.orden || []
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
  // Espejo de `cant` para las callbacks estables (ver `alTocar`).
  const cantRef = useRef(cant)
  cantRef.current = cant
  /**
   * 🩸 EL CARRITO ESPEJO (18/08/2026). Lo manda el celular por el canal `emitir()`, que existía
   * desde el primer día y no tenía un solo consumidor. El cliente ve el pedido armándose y el
   * total, como la pantalla de una caja: es lo que saca el "¿cuánto me dijiste que era?" del final.
   *
   * Llega YA RESUELTO (nombre, cantidad, subtotal). La tablet no sabe de dónde sale un precio y no
   * tiene que saberlo — misma frontera que el catálogo.
   */
  const [pedido, setPedido] = useState(null)  // { items, unidades, total } o null
  // Producto abierto a pantalla completa: lo abre un toque del cliente o un "mirá este" del vendedor.
  const [ficha, setFicha] = useState(null)
  /**
   * 🩸 VIDRIERA EN REPOSO (18/08/2026). A los 30 s sin que nadie toque, la tablet deja de ser una
   * grilla quieta y se pone a ofrecer: ofertas y destacados, uno por vez y grande.
   *
   * El criterio de qué mostrar **no viaja**: se usa `orden`, que el celular ya calculó (ofertas
   * primero, después por rentabilidad) y mandó resuelto. La tablet muestra el resultado sin saber
   * nunca por qué ese producto va antes que el otro — misma frontera que el resto de la pantalla.
   *
   * Se apaga con cualquier toque, y no se enciende si hay una ficha abierta o si el vendedor está
   * cargando el pedido: en los dos casos hay una conversación en curso y esto la interrumpiría.
   */
  const [reposo, setReposo] = useState(0)   // 0 = despierta; >0 = índice del carrusel + 1
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
  // Cuántas salieron del disco y cuántas hubo que bajar. Va al log, no a la pantalla: es la única
  // forma de comprobar "se baja una sola vez" sin abrir la tablet, y el cliente no tiene por qué
  // ver un contador de diagnóstico mientras elige productos.
  const cuenta = useRef({ cache: 0, red: 0 })
  // Lo prende el botón "Actualizar fotos": vuelve a pedirlas aunque el archivo esté.
  const forzarRef = useRef(false)
  const [refrescando, setRefrescando] = useState(false)

  /**
   * 🩸 LA TABLET QUEDA FIJADA EN LA APP MIENTRAS LA USA EL CLIENTE (18/08/2026). Se la damos en la
   * mano a alguien que no es empleado nuestro: no tiene por qué poder irse al navegador o a los
   * ajustes, ni sin querer ni queriendo.
   *
   * Se suelta SIEMPRE al desmontar, en el mismo `useEffect` que corta el enlace: una tablet trabada
   * en una app es, para el cliente, una tablet rota. Sin Device Owner el fijado igual es blando
   * (Android avisa y se sale con Atrás + Recientes), que para esto alcanza.
   */
  useEffect(() => {
    fijarPantalla()
    return () => { vivo.current = false; soltarPantalla(); desconectar() }
  }, [])

  /**
   * 🩸 LAS FOTOS SE VUELCAN EN TANDAS, NO DE A UNA (18/08/2026). Cada `setFotos` era un render de la
   * pantalla entera: con 529 productos, **529 renders**, y hasta hoy cada uno de esos renders además
   * volvía a ordenar los 529 (ver el memo de `ordenados`). Eso era el "va trabado" de la tablet —
   * el hardware ayudaba, pero el trabajo se lo estaba dando el código.
   *
   * Se juntan en un ref y se vuelcan cada TANDA_MS: ~20 renders en vez de 529, con la grilla
   * llenándose igual de a poco a la vista.
   */
  const pendientes = useRef({})
  const tandaRef = useRef(null)
  const encolarFoto = useCallback((id, url) => {
    pendientes.current[id] = url
    if (tandaRef.current) return
    tandaRef.current = setTimeout(() => {
      tandaRef.current = null
      const tanda = pendientes.current
      pendientes.current = {}
      if (vivo.current) setFotos((f) => ({ ...f, ...tanda }))
    }, TANDA_FOTOS_MS)
  }, [])
  useEffect(() => () => clearTimeout(tandaRef.current), [])

  /**
   * 🩸 PODA AL RECIBIR EL CATÁLOGO (18/08/2026). Desde hoy las fotos viven en `filesDir` y no en el
   * caché, porque el caché lo borraba Android justo cuando más falta hacía. El costo de esa decisión
   * es que ahora hay que barrer a mano: el nombre del archivo lleva la versión, así que cada foto
   * que marketing reemplaza deja la anterior tirada para siempre en una tablet de 2 GB.
   *
   * Acá es el único momento en que se sabe qué archivos son "los de ahora".
   */
  useEffect(() => {
    if (!productos.length) return
    limpiarFotos(productos).then((n) => { if (n) console.log(`[vidriera] fotos viejas borradas: ${n}`) })
  }, [catalogoVivo]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * 🩸 TODO LO DERIVADO VA MEMOIZADO (18/08/2026), y no es prolijidad: era un costo CUADRÁTICO.
   *
   * Estas cuatro líneas estaban sueltas en el cuerpo del componente, o sea que se recalculaban en
   * CADA render — y el componente re-renderizaba una vez por cada foto que terminaba de bajar. Con
   * 529 productos eso es ordenar 529 elementos, 529 veces. Es el mismo patrón que la regla 50
   * (`detectarParadas`): un costo que nadie escribió a propósito y que crece solo con el catálogo.
   *
   * Ordenados como decidió el celular. Los que no estén en `orden` van al final, por si el snapshot
   * y la lista quedan desalineados: mejor mostrarlos que perderlos.
   */
  const ordenados = useMemo(() => {
    const pos = new Map(orden.map((id, i) => [id, i]))
    return productos.slice().sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9))
  }, [productos, orden])

  // Los valores del eje activo, en el orden en que aparecen (o sea: lo más destacado primero).
  const chips = useMemo(() => {
    const valores = [...new Set(ordenados.map((p) => (eje === 'marca' ? p.marca : p.categoria)).filter(Boolean))]
    const hayOfertas = ordenados.some((p) => p.oferta)
    return ['Todos', ...(hayOfertas ? ['Ofertas'] : []), ...valores]
  }, [ordenados, eje])

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return ordenados.filter((p) => {
      if (q && !(p.nombre || '').toLowerCase().includes(q) && !(p.marca || '').toLowerCase().includes(q)) return false
      if (filtro === 'Ofertas') return p.oferta
      if (filtro !== 'Todos' && (eje === 'marca' ? p.marca : p.categoria) !== filtro) return false
      return true
    })
  }, [ordenados, busca, filtro, eje])

  /**
   * 🩸 LA GRILLA CRECE AL SCROLLEAR (18/08/2026). Dibujar los 529 productos de una son ~5.000 nodos
   * en un WebView Chrome 79 con 2 GB — y el cliente ve seis a la vez. Se dibujan `PAGINA` y se suma
   * otra tanda cuando el centinela del final entra en pantalla.
   *
   * `IntersectionObserver` existe desde Chrome 51, así que la tablet lo tiene. Y el contador del
   * encabezado sigue diciendo el TOTAL real: el cliente nunca ve "hay menos productos".
   *
   * Se reinicia cuando cambia lo que se está mirando — si no, buscar algo después de haber bajado
   * mucho dejaría dibujadas 500 tarjetas de una lista de cuatro.
   */
  const [cuantas, setCuantas] = useState(PAGINA)
  useEffect(() => { setCuantas(PAGINA) }, [busca, filtro, eje, catalogoVivo])
  const visibles = useMemo(() => lista.slice(0, cuantas), [lista, cuantas])
  /**
   * Crece al acercarse al final. Es un `scroll` pasivo sobre la grilla y NO un
   * `IntersectionObserver`, por dos razones:
   *
   *  1. El que scrollea es el CONTENEDOR, no la ventana (la raíz está en `height:100vh;overflow:
   *     hidden`). Un observador contra el viewport no se entera nunca — medido: el centinela quedaba
   *     700 px por debajo y la grilla no crecía jamás. Habría que pasarle `root`, que es un detalle
   *     fácil de perder en el próximo refactor.
   *  2. 🩸 Y sobre todo: **`IntersectionObserver` no entrega callbacks con el documento oculto**,
   *     igual que `rAF` (regla 35). Un `scroll` sí. Acá eso además es lo que hace la diferencia
   *     entre poder probarlo y tener que creerle.
   *
   * El cálculo es una resta: no hace falta medir nada del layout que no esté ya en el evento.
   */
  const grillaRef = useRef(null)
  useEffect(() => {
    const g = grillaRef.current
    if (!g) return
    const alScrollear = () => {
      if (g.scrollTop + g.clientHeight < g.scrollHeight - 600) return
      setCuantas((c) => (c < listaRef.current.length ? c + PAGINA : c))
    }
    g.addEventListener('scroll', alScrollear, { passive: true })
    return () => g.removeEventListener('scroll', alScrollear)
  }, [])
  // La lista se lee de un ref para que el listener se registre UNA vez: volver a suscribirse con
  // cada tecla del buscador es justo el trabajo que esta pantalla no tiene para gastar.
  const listaRef = useRef(lista)
  listaRef.current = lista

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
        const { url, cache } = await fotoDe(sesion, p.id, p.fotoV, forzarRef.current)
        if (cancelado || !vivo.current) return
        if (url) cuenta.current[cache ? 'cache' : 'red']++
        encolarFoto(p.id, url)
      }
    }
    cuenta.current = { cache: 0, red: 0 }
    Promise.all(Array.from({ length: FOTOS_A_LA_VEZ }, obrero)).then(() => {
      const { cache, red } = cuenta.current
      if (cache || red) console.log(`[vidriera] fotos: ${cache} del disco · ${red} bajadas`)
    })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogoVivo, refrescando])

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

  /**
   * Eventos del celular. `escuchar` cuelga un long-poll y devuelve la función para cortarlo.
   *
   * `resync` significa "te perdiste eventos y no puedo decirte cuáles": se vuelve a pedir el
   * catálogo entero, porque seguir con un estado incompleto que PARECE completo es peor que
   * recargar. Es la misma decisión que ya toma el servidor cuando descarta eventos viejos.
   */
  useEffect(() => {
    const off = escuchar(sesion, ({ eventos, resync }) => {
      if (!vivo.current) return
      if (resync) { pedirCatalogo(sesion).then((c) => { if (vivo.current && c) setCatalogoVivo(c) }).catch(() => {}) }
      for (const raw of eventos || []) {
        let ev = raw
        if (typeof raw === 'string') { try { ev = JSON.parse(raw) } catch (_) { continue } }
        if (!ev || typeof ev !== 'object') continue
        if (ev.t === 'carrito') setPedido({ items: ev.items || [], unidades: ev.unidades || 0, total: ev.total || 0 })
        // "Mirá este": el vendedor le abre un producto. Si no está en el catálogo de la tablet
        // (entró después del snapshot), no se hace nada — mejor que abrir una ficha vacía.
        if (ev.t === 'destacar') {
          const p = productos.find((x) => String(x.id) === String(ev.id))
          if (p) setFicha(p)
        }
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sesion])

  // El stepper no manda nada: solo prepara el número. Se manda al tocar la tarjeta.
  const mover = useCallback((e, id, d) => {
    e.stopPropagation() // sin esto, tocar el + también dispararía el envío de la tarjeta
    setCant((c) => ({ ...c, [id]: Math.max(1, Math.min(999, (c[id] || 1) + d)) }))
  }, [])

  /**
   * El reloj del reposo. Se rearma con cada toque de la pantalla (el `onPointerDown` del contenedor)
   * y con cada cambio de estado que signifique "acá está pasando algo".
   *
   * ⚠️ Nada de `requestAnimationFrame`: con el documento oculto no dispara (regla 35), y esto es
   * justo una pantalla que se queda sola. `setInterval` sí corre.
   */
  useEffect(() => {
    if (ficha) return                       // hay una ficha abierta: alguien está mirando algo
    if (reposo) return                      // ya está en reposo; el carrusel lo maneja el otro efecto
    const t = setTimeout(() => { if (vivo.current) setReposo(1) }, REPOSO_MS)
    return () => clearTimeout(t)
  }, [ficha, reposo, tocado, pedido])

  // El carrusel: avanza mientras siga en reposo.
  useEffect(() => {
    if (!reposo) return
    const i = setInterval(() => { if (vivo.current) setReposo((r) => (r ? r + 1 : r)) }, REPOSO_PASO_MS)
    return () => clearInterval(i)
  }, [reposo])

  // Los que se ofrecen solos: lo que está en oferta y, si no alcanza, lo primero del orden que
  // mandó el celular. Con foto, porque un carrusel de recuadros grises no vende nada.
  const enVidriera = (() => {
    const conFoto = ordenados.filter((p) => fotos[p.id])
    const ofertas = conFoto.filter((p) => p.oferta)
    return (ofertas.length >= 3 ? ofertas : conFoto).slice(0, 12)
  })()

  const alTocar = useCallback(async (p) => {
    // 🩸 EL TOQUE ABRE LA FICHA, ADEMÁS DE AVISAR (18/08/2026). Hasta hoy tocar una tarjeta solo
    // mandaba el aviso al celular: el cliente señalaba a ciegas, con una foto de 190 px y el nombre
    // cortado a dos renglones. Las dos cosas pasan juntas —el vendedor ve "está mirando X" en el
    // mismo momento en que el cliente lo tiene grande—, que es justo la conversación que la tablet
    // viene a facilitar.
    setFicha(p)
    // El acuse se muestra ANTES de que el envío termine: el cliente tiene que sentir que su toque
    // pasó algo, y esperar la ida y vuelta por WiFi se siente como que la tablet no responde.
    setTocado(p.id)
    setTimeout(() => { if (vivo.current) setTocado((t) => (t === p.id ? null : t)) }, 1800)
    try { if (navigator.vibrate) navigator.vibrate(18) } catch (_) { /* sin motor de vibración */ }
    await tocar(sesion, p, cantRef.current[p.id] || 1)
    // `cantRef` y no `cant`: si esta callback cambiara de identidad con cada toque del `+`, se
    // rompería el `memo` de las 529 tarjetas — que es justo lo que vinimos a arreglar.
  }, [sesion])

  return (
    <div
      // Cualquier toque despierta la vidriera. Va en `onPointerDown` (no en `onClick`) para que la
      // pantalla vuelva en el momento en que el dedo baja, no cuando se completa un click.
      onPointerDown={() => { if (reposo) setReposo(0) }}
      /**
       * 🩸 `height`, NO `min-height` (18/08/2026). Con `min-height:100vh` el contenedor CRECE con el
       * contenido, así que el `flex:1;overflow-y:auto` de la grilla nunca llega a acotar nada: el
       * que scrollea es el documento entero y se van con él el encabezado y los filtros. Eso era el
       * "los botones de arriba se pierden al deslizar" de la primera jornada. Con altura fija, el
       * único que scrollea es la grilla — y de paso es la condición para que el centinela del final
       * pueda detectar dónde termina.
       */
      style={sx('height:100vh;overflow:hidden;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text)')}
    >
      <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;background:var(--surface);border-bottom:1px solid var(--line)')}>
        <div>
          <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)')}>Catálogo</div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:19px')}>
            {catalogoVivo?.comercio?.nombre || 'Productos'}
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
        <div ref={grillaRef} style={ESTILO_GRILLA}>
          {visibles.map((p) => (
            <Tarjeta
              key={p.id}
              p={p}
              url={fotos[p.id]}
              acusado={tocado === p.id}
              cantidad={cant[p.id] || 1}
              onTocar={alTocar}
              onMover={mover}
            />
          ))}

        </div>
      )}

      {/* ===== BARRA DEL PEDIDO (carrito espejo) ==================================================
          Solo aparece cuando hay algo. El cliente ve lo que el vendedor va cargando y el total,
          como la pantalla de una caja: es lo que saca el "¿cuánto me dijiste que era?" del final.
          Es de LECTURA. Acá no se edita el pedido — el pedido es del vendedor, y dos personas
          editando lo mismo desde dos pantallas es una discusión, no una función. */}
      {pedido && pedido.items.length > 0 && (
        <div className="lu-rise" style={sx('flex:none;border-top:1px solid var(--line);background:var(--surface);padding:11px 16px;display:flex;align-items:center;gap:14px')}>
          <div style={sx('flex:none;font-size:10.5px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--faint)')}>Su pedido</div>
          <div className="lu-chips" style={sx('flex:1;min-width:0;display:flex;gap:7px;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none')}>
            {pedido.items.map((i) => (
              <span key={i.id} style={sx('flex:none;padding:5px 11px;border-radius:99px;border:1px solid var(--line2);font-size:12px;white-space:nowrap')}>
                <b style={sx('font-family:var(--font-mono)')}>{i.cantidad}×</b> {i.nombre}
              </span>
            ))}
          </div>
          <div style={sx('flex:none;text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
            <div style={sx('font-size:10.5px;color:var(--faint)')}>{pedido.unidades} u</div>
            <div style={sx('font-size:19px;font-weight:700;color:var(--deep)')}>{fmtPesos(pedido.total)}</div>
          </div>
        </div>
      )}

      {/* ===== VIDRIERA EN REPOSO =================================================================
          A los 30 s sin que nadie toque. Un producto por vez, grande, sobre fondo lleno: a dos
          metros del mostrador una grilla de 190 px no se lee, y una tablet apagada no ofrece nada.
          Cualquier toque la despierta (`onPointerDown` del contenedor de arriba).
          El criterio de qué mostrar NO viaja: sale de `orden`, que el celular mandó ya resuelto. */}
      {reposo > 0 && enVidriera.length > 0 && (() => {
        const p = enVidriera[(reposo - 1) % enVidriera.length]
        const oferta = p.oferta && p.precioOferta != null
        return (
          <div style={sx('position:fixed;top:0;right:0;bottom:0;left:0;z-index:var(--z-screen);background:var(--bg-app);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:22px;padding:40px')}>
            {/* `key` por producto: sin eso React reusa el nodo y la entrada no se vuelve a animar,
                así que el carrusel cambiaría de foto de golpe, sin transición. */}
            <div key={p.id} className="lu-rise" style={sx('display:flex;flex-direction:column;align-items:center;gap:20px;max-width:640px;width:100%')}>
              {/* padding-top y no `aspect-ratio`: el WebView de la tablet es Chrome 79, igual que
                  en las tarjetas de la grilla. */}
              <div style={sx('width:min(380px,60vh);padding-top:min(380px,60vh);position:relative;border-radius:24px;overflow:hidden;background:var(--surface2);box-shadow:var(--shadow-lg)')}>
                <img src={fotos[p.id]} alt="" style={sx('position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover')} />
                {oferta && (
                  <span style={sx('position:absolute;top:14px;left:14px;background:var(--warning);color:#3d2c00;font-size:13px;font-weight:700;letter-spacing:.06em;padding:6px 15px;border-radius:99px')}>OFERTA</span>
                )}
              </div>
              <div style={sx('text-align:center')}>
                <div style={sx('font-family:var(--font-display);font-weight:600;font-size:27px;line-height:1.3')}>{p.nombre}</div>
                <div style={sx('margin-top:12px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                  {oferta ? (
                    <span>
                      <span style={sx('font-size:19px;color:var(--faint);text-decoration:line-through;margin-right:12px')}>{fmtPesos(p.precio)}</span>
                      <span style={sx('font-size:38px;font-weight:700;color:var(--warning)')}>{fmtPesos(p.precioOferta)}</span>
                    </span>
                  ) : (
                    <span style={sx('font-size:38px;font-weight:700;color:var(--deep)')}>{fmtPesos(p.precio)}</span>
                  )}
                </div>
              </div>
            </div>
            <div style={sx('font-size:13.5px;color:var(--faint)')}>Tocá la pantalla para volver al catálogo</div>
          </div>
        )
      })()}

      {/* ===== FICHA GRANDE =======================================================================
          La abre el toque del cliente o un "mirá este" del vendedor. Foto grande, precio grande, y
          la cantidad se cambia sin volver a la grilla.
          No sale de `Overlay.jsx` a propósito: esto no vive dentro del marco de la app — es la
          pantalla completa de la tablet del cliente, sin AppShell, sin header y sin scroll-lock que
          coordinar. `Overlay` es para la app del vendedor. */}
      {ficha && (
        <div
          onClick={() => setFicha(null)}
          style={sx('position:fixed;top:0;right:0;bottom:0;left:0;z-index:var(--z-modal);background:var(--scrim);display:grid;place-items:center;padding:28px')}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="lu-rise"
            style={sx('width:min(760px,100%);max-height:100%;overflow:auto;display:flex;gap:24px;background:var(--surface);border-radius:22px;box-shadow:var(--shadow-lg);padding:22px')}
          >
            <div style={sx('flex:none;width:300px;max-width:42vw')}>
              <div style={sx('position:relative;width:100%;padding-top:100%;background:var(--surface2);border-radius:16px;overflow:hidden')}>
                {fotos[ficha.id] ? (
                  <img src={fotos[ficha.id]} alt="" style={sx('position:absolute;top:0;right:0;bottom:0;left:0;width:100%;height:100%;object-fit:cover')} />
                ) : (
                  <div style={sx('position:absolute;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;color:var(--faint)')}>
                    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                  </div>
                )}
              </div>
            </div>

            <div style={sx('flex:1;min-width:0;display:flex;flex-direction:column')}>
              <div style={sx('display:flex;align-items:flex-start;justify-content:space-between;gap:12px')}>
                <div style={sx('font-family:var(--font-display);font-weight:600;font-size:24px;line-height:1.25')}>{ficha.nombre}</div>
                <button onClick={() => setFicha(null)} className="lu-press"
                  style={sx('flex:none;width:44px;height:44px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;background:transparent;color:var(--muted);font-size:22px;cursor:pointer')}>×</button>
              </div>
              {ficha.marca && <div style={sx('margin-top:5px;font-size:13px;color:var(--faint)')}>{ficha.marca}</div>}

              <div style={sx('margin-top:16px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                {ficha.oferta && ficha.precioOferta != null ? (
                  <div style={sx('display:flex;align-items:baseline;gap:11px;flex-wrap:wrap')}>
                    <span style={sx('font-size:16px;color:var(--faint);text-decoration:line-through')}>{fmtPesos(ficha.precio)}</span>
                    <span style={sx('font-size:30px;font-weight:700;color:var(--warning)')}>{fmtPesos(ficha.precioOferta)}</span>
                  </div>
                ) : (
                  <span style={sx('font-size:30px;font-weight:700;color:var(--deep)')}>{fmtPesos(ficha.precio)}</span>
                )}
              </div>

              {(ficha.unidades != null || ficha.kg > 0) && (
                <div style={sx('margin-top:7px;font-size:13px;color:var(--faint);font-family:var(--font-mono)')}>
                  {[ficha.unidades != null ? `×${ficha.unidades} u` : null, ficha.kg > 0 ? `${String(ficha.kg).replace('.', ',')} kg` : null].filter(Boolean).join(' · ')}
                </div>
              )}

              <div style={sx('flex:1')} />

              <div style={sx('margin-top:20px;display:flex;align-items:center;gap:12px')}>
                <div style={sx('flex:none;display:flex;align-items:center;gap:10px;padding:5px;border:1px solid var(--line2);border-radius:14px')}>
                  <button onClick={(e) => mover(e, ficha.id, -1)} className="lu-press"
                    style={sx('width:48px;height:48px;display:grid;place-items:center;border:none;border-radius:11px;background:transparent;color:var(--muted);font-size:25px;cursor:pointer;user-select:none')}>−</button>
                  <span style={sx('min-width:38px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:20px;font-weight:700')}>{cant[ficha.id] || 1}</span>
                  <button onClick={(e) => mover(e, ficha.id, 1)} className="lu-press"
                    style={sx('width:48px;height:48px;display:grid;place-items:center;border:none;border-radius:11px;background:var(--primary-tint);color:var(--deep);font-size:24px;cursor:pointer;user-select:none')}>+</button>
                </div>
                {/* Vuelve a avisar con la cantidad de ahora. Sigue siendo una PROPUESTA: el pedido
                    lo arma el vendedor en su celular. Por eso dice "pedir" y no "agregar". */}
                <button
                  onClick={async () => { const p = ficha; setFicha(null); await tocar(sesion, p, cant[p.id] || 1) }}
                  className="lu-press"
                  style={sx('flex:1;min-height:58px;border:none;border-radius:14px;background:var(--primary);color:var(--on-primary);font-size:15px;font-weight:600;cursor:pointer')}
                >
                  Pedir {cant[ficha.id] || 1}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
