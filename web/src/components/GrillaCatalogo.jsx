import { useState } from 'react'
import { sx } from '../lib/sx'
import { fmtPesos } from '../lib/format'
import { escaleraDe, precioPara } from '../lib/precios'
import { ImagenVacia, Search } from './icons'
import { propsBusqueda } from './form'
import CantidadInput from './CantidadInput'
import { Chip } from './ui'
import FichaProducto from '../features/vendedor/FichaProducto'

/**
 * EL CATÁLOGO DEL VENDEDOR: buscador + chips de categoría + grilla de 2 columnas.
 *
 * 🩸 POR QUÉ SE EXTRAJO (04/09/2026). Vivía entero adentro de `VisitaCatalogo` y no se podía usar en
 * ningún otro lado. Cuando se agregó la EDICIÓN de un pedido, la pantalla nueva terminó con un
 * buscador y una lista de resultados — y con eso el vendedor perdió las tres cosas que hacen que
 * esta grilla funcione: la **cantidad tipeable** (`CantidadInput`, que evita 24 toques para un
 * fardo), las **escalas de precio por volumen** (el dato que hace vender más, agregado el 27/08) y
 * el **marco de rentabilidad**. El reporte del vendedor fue literal: "no puedo agregar la cantidad
 * exacta y no veo las funciones del catálogo".
 *
 * O sea que la alternativa real no era "extraer o no": era extraer, o tener DOS catálogos que
 * divergen — la regla 31, que en este repo ya se pagó dos veces con las supervisiones.
 *
 * 🔑 NO SABE NADA DE LA VISITA. Recibe `productos`, un `cart` con forma `{ idProducto: cantidad }` y
 * un `addCart(id, delta)`. Con eso sirve igual para tomar un pedido nuevo (donde el carrito es el de
 * `useJornada`) que para editar uno existente (donde el carrito son sólo los renglones que se
 * agregan hoy). Todo lo que la ataba a la jornada —el header de la visita, la barra de confirmar, el
 * carrito, la vidriera— se quedó en `VisitaCatalogo`.
 *
 * ⚠️ LA VIDRIERA ENTRA POR PROPS OPCIONALES (`vidActiva` + `onMostrar`). Sin ellas el botón "mirá
 * este" no se dibuja, que es exactamente lo que ya hacía la condición `vid.activa`.
 *
 * `children` se dibuja ENTRE el buscador y los chips: es donde `VisitaCatalogo` mete "repetir el
 * último pedido" y "lo que más lleva", que son de la visita y no del catálogo.
 *
 * 🩸 EL ZOOM DEL PRODUCTO VIVE ACÁ DESDE EL 09/09/2026, no en el llamador. Lo montábamos en
 * `VisitaCatalogo`, así que la pantalla de EDICIÓN de un pedido —el otro consumidor de esta
 * grilla— se quedó sin él sin que nadie lo notara: exactamente la divergencia que este componente
 * vino a terminar hace cinco días. El estado del zoom no sabe nada de la visita (es un id de
 * producto), así que no había ninguna razón para tenerlo afuera.
 *
 * props: { productos, cart, addCart, search, setSearch, catFilter, setCatFilter, onProductoAbierto,
 *          vidActiva, onMostrar, paddingInferior, accionBuscador, scrollPropio, children }
 *
 * (02/10/2026) `scrollPropio` (por defecto `true`): la grilla scrollea sola y el buscador y los chips
 * quedan quietos arriba. Con `false` la grilla crece con su contenido y scrollea el CONTENEDOR del
 * llamador, así lo de arriba se va con el scroll. Lo usa `VisitaCatalogo` cuando con letra grande no
 * le queda lugar a la grilla (informe 09 del emulador). Lleva `data-grilla` para que el llamador mida
 * dónde empieza.
 */

// Color del marco según el nivel de rentabilidad (1..4). Es un código privado para el
// vendedor: ve el color, NUNCA el número. Sin nivel → borde neutro. Ver index.css (--rent-*).
export const rentColor = (nivel) => (nivel >= 1 && nivel <= 4 ? `var(--rent-${nivel})` : 'var(--line)')

export default function GrillaCatalogo({
  productos = [],
  cart = {},
  addCart,
  search = '',
  setSearch,
  catFilter = 'Todos',
  setCatFilter,
  onProductoAbierto,
  vidActiva = false,
  onMostrar,
  paddingInferior = 180,
  vacioTitulo = 'El catálogo está vacío',
  vacioTexto = 'El administrador todavía no cargó los productos. En cuanto los cargue, vas a poder armar pedidos.',
  accionBuscador = null,
  scrollPropio = true,
  children,
}) {
  const CATS = [...new Set(productos.map((p) => p.cat))]
  const hayOfertas = productos.some((p) => p.oferta)
  const hayDestacados = productos.some((p) => p.destacado)
  /* Fila de chips: Destacados (si hay) · Todos · Ofertas (si hay) · una por categoría.
   *
   * 🩸 DESTACADOS VA PRIMERO Y ES DELIBERADO (28/08/2026, pedido del cliente). Es lo que la
   * distribuidora quiere empujar —baja rotación, sobrestock— y lo que un vendedor nunca ofrece solo,
   * porque vende lo que el comercio le pide. Puesto en cuarto lugar sería un chip que nadie toca.
   *
   * ⚠️ Pero el filtro por DEFECTO sigue siendo 'Todos': aparecer primero no es estar seleccionado.
   * Arrancar en Destacados escondería los 529 productos detrás de un puñado, justo cuando el
   * comerciante empieza a dictar el pedido.
   *
   * Si no hay ninguno marcado el chip no existe, mismo criterio que Ofertas: un filtro que siempre
   * da vacío enseña a ignorar la fila entera.
   */
  const chips = [...(hayDestacados ? ['Destacados'] : []), 'Todos', ...(hayOfertas ? ['Ofertas'] : []), ...CATS]

  const q = search.trim().toLowerCase()
  const items = productos.filter((p) => {
    if (q && !p.name.toLowerCase().includes(q)) return false
    if (catFilter === 'Destacados') return p.destacado
    if (catFilter === 'Ofertas') return p.oferta
    if (catFilter !== 'Todos' && p.cat !== catFilter) return false
    return true
  })

  const enDestacados = catFilter === 'Destacados'

  // El producto abierto en grande. Se guarda el ID y no el objeto: el catálogo se reemplaza entero
  // en cada mutación (una foto nueva, un precio corregido) y un objeto capturado acá se quedaría
  // mostrando el precio viejo con el comerciante mirando la pantalla.
  const [zoomId, setZoomId] = useState(null)
  const zoom = zoomId ? productos.find((x) => x.id === zoomId) : null

  /**
   * 🩸 TOCAR LA TARJETA ABRE EL ZOOM, EN TODOS LOS FILTROS (09/09/2026, reunión con La Unión).
   *
   * Acá decía `enDestacados && !!onAbrirFicha`: el gesto existía sólo dentro del chip "Destacados",
   * que es donde nació el 28/08. En los otros filtros —o sea, en el 95% del tiempo que el vendedor
   * pasa en esta pantalla— tocar un producto no hacía nada, y el pedido del cliente fue justamente
   * que **cada** recuadro respondiera al toque. Un gesto que funciona en un filtro y en el de al
   * lado no, es peor que no tenerlo: enseña que la pantalla no responde.
   *
   * ⚠️ Lo que esto vuelve OBLIGATORIO es el `stopPropagation` del stepper y del `CantidadInput`.
   * Antes eran una precaución de un solo filtro; ahora, sin ellos, tocar el + o el número abriría
   * el zoom encima en CUALQUIER pantalla del catálogo.
   */
  const abrirZoom = (p) => {
    setZoomId(p.id)
    // El llamador se entera para hacer lo suyo (hoy: espejarlo en la tablet del comerciante).
    // Ya no es él quien abre — si no hay nadie escuchando, el zoom se abre igual.
    onProductoAbierto?.(p)
  }

  return (
    <>
      {/* `accionBuscador` es un slot opcional a la derecha del buscador (hoy: el botón de pantalla
          completa del vendedor). Va acá y no flotando en una esquina porque el buscador es lo único
          que NO se esconde en modo inmersivo: el botón queda siempre en el mismo lugar, entrando y
          saliendo, que es la condición para que se aprenda. Sin la prop, el layout es el de antes. */}
      <div style={sx('flex:none;padding:12px 14px 8px;display:flex;align-items:center;gap:8px')}>
        {/* El input va sin borde ni outline a propósito: el foco lo marca este
            contenedor con .lu-campo (:focus-within). Ver index.css. */}
        {/* (01/10/2026, C10) `min-height` en vez de `height` y letra de 16: con menos de 16 px
            Safari de iPhone hace zoom de la página al enfocar el buscador (brief v2 §4.6). */}
        <div className="lu-campo" style={sx('flex:1;min-width:0;display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line2);border-radius:var(--r-md);padding:0 12px;min-height:44px')}>
          <Search />
          <input {...propsBusqueda} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" style={sx('flex:1;min-width:0;min-height:42px;border:none;outline:none;background:transparent;font-family:Inter,sans-serif;font-size:16px;color:var(--text)')} />
        </div>
        {accionBuscador}
      </div>

      {children}

      {/* Chips de categoría: scroll horizontal. Ofertas filtra los productos en oferta.
          🎨 (01/10/2026, C10) Pasan a ser el `Chip` de components/ui: el área táctil es de 44 px
          (antes 32) aunque la píldora visible mida 36, y el elegido lleva ✓ además del tinte (el
          estado no depende sólo del color). La fila lleva `flex:none` por lo que explica el JSDoc
          de `Chip`: con letra grande la columna la aplastaba hasta hacerla desaparecer.
          ⚠️ Destacados apagado iba con BORDE de acento ("es el único chip que hay que aprender a
          tocar, y uno gris entre quince categorías grises no se ve"). `Chip` no tiene borde por
          variante, así que esa señal la sigue dando el ◆ en el color de acento (y el ★ de Ofertas en
          ocre): un glifo de color, no un chip gris más. */}
      {productos.length > 0 && (
        <div className="lu-chips" style={sx('flex:none;display:flex;gap:8px;overflow-x:auto;padding:0 14px 6px;scrollbar-width:none;-ms-overflow-style:none')}>
          {chips.map((c) => {
            const esOfertas = c === 'Ofertas'
            const esDestacados = c === 'Destacados'
            return (
              <Chip key={c} seleccionado={catFilter === c} onClick={() => setCatFilter(c)}>
                {esOfertas
                  ? <><span aria-hidden="true" style={sx('color:var(--warning)')}>★</span> Ofertas</>
                  : esDestacados
                    ? <><span aria-hidden="true" style={sx('color:var(--primary)')}>◆</span> Destacados</>
                    : c}
              </Chip>
            )
          })}
        </div>
      )}

      <div data-grilla="" style={{ ...sx(scrollPropio ? 'flex:1;overflow-y:auto;padding:0 14px' : 'flex:none;padding:0 14px'), paddingBottom: paddingInferior }}>
        {/* Una línea de instrucción. Ahora que el gesto vale en toda la grilla se muestra siempre:
            tocar una tarjeta no hizo nada durante meses, así que el vendedor ya aprendió que no se
            tocan. Esconderla justo cuando el gesto se generalizó sería esconder lo nuevo. */}
        {items.length > 0 && (
          <div style={sx('margin:8px 0 2px;font-size:11.5px;color:var(--muted);line-height:1.45')}>
            Tocá un producto para {vidActiva ? 'verlo grande y mostrárselo en la tablet' : 'verlo grande'}.
          </div>
        )}
        {productos.length === 0 ? (
          <div style={sx('text-align:center;padding:34px 18px;margin-top:12px;background:var(--surface);border:1px solid var(--line);border-radius:14px')}>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;margin-bottom:4px')}>{vacioTitulo}</div>
            <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>{vacioTexto}</div>
          </div>
        ) : items.length === 0 ? (
          <div style={sx('text-align:center;padding:28px 18px;margin-top:12px;background:var(--surface);border:1px solid var(--line);border-radius:14px')}>
            <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5')}>No hay productos que coincidan con el filtro.</div>
          </div>
        ) : (
          <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:6px')}>
            {items.map((p) => {
              const qty = cart[p.id] || 0
              const escalones = escaleraDe(p)
              // 🩸 EL PRECIO SALE DE `precioPara` (regla 52). Esta tarjeta era una de las copias que
              // el encabezado de `lib/precios.js` marca como pendientes: imprimía `p.price` y
              // `p.precioOferta` crudos, así que con escalones mostraba el precio de lista mientras
              // el carrito cobraba el del escalón — dos números distintos en la misma pantalla, con
              // el comerciante mirando. Se resuelve contra la cantidad que hay en el pedido (mínimo
              // 1): con 0 en el carrito, el precio del "escalón 0" sería el precio de no comprar.
              const pr = precioPara(p, Math.max(1, qty))
              const enOferta = pr.motivo === 'oferta'
              return (
                <div
                  key={p.id}
                  // La tarjeta ENTERA abre el zoom: el gesto que se pidió es "tocar el producto", no
                  // "encontrar un botón". Ver `abrirZoom` arriba para por qué ya no depende del filtro.
                  onClick={() => abrirZoom(p)}
                  className="lu-press"
                  role="button"
                  style={{
                    ...sx('display:flex;flex-direction:column;background:var(--surface);border-radius:14px;overflow:hidden'),
                    cursor: 'pointer',
                    // El marco SIEMPRE es el nivel de rentabilidad; el estado "en carrito"
                    // se marca con un anillo (box-shadow) para no pisar ese código de color. El aro interior
                    // (--bg-app) los separa: con el acento azul acero el anillo se fundía con el marco azul
                    // del nivel 2 (30/09/2026).
                    border: `2px solid ${rentColor(p.nivel)}`,
                    boxShadow: qty > 0 ? '0 0 0 2px var(--bg-app), 0 0 0 4px var(--primary)' : 'none',
                  }}
                >
                  {/* Foto: caja cuadrada con fallback padding-top (aspect-ratio no está en
                      WebViews viejos). object-fit:cover recorta sin deformar. */}
                  <div style={sx('position:relative;width:100%;padding-top:100%;background:var(--surface2)')}>
                    {p.imagen ? (
                      <img src={p.imagen} alt="" loading="lazy" style={sx('position:absolute;inset:0;width:100%;height:100%;object-fit:cover')} />
                    ) : (
                      <div style={sx('position:absolute;inset:0;display:grid;place-items:center;color:var(--faint)')}>
                        <ImagenVacia size={30} />
                      </div>
                    )}
                    {/* (01/10/2026, C10) Rótulos de la foto a 11 px: el mínimo del brief (decisión
                        15). A 9,5 no se leían al sol. */}
                    {enOferta && (
                      <span style={sx('position:absolute;top:6px;left:6px;background:var(--warning);color:var(--on-warning);font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:99px;box-shadow:0 1px 3px rgba(0,0,0,.25)')}>OFERTA</span>
                    )}
                    {/* El rombo marca el destacado en el resto de los filtros: dentro de Destacados
                        lo son todos y repetirlo 20 veces es ruido. Va abajo de OFERTA cuando hay las
                        dos, que es el caso más común (algo que no rota y encima está en promoción). */}
                    {p.destacado && !enDestacados && (
                      <span style={{ ...sx('position:absolute;left:6px;background:var(--primary);color:var(--on-primary);font-size:11px;font-weight:700;letter-spacing:.04em;padding:2px 7px;border-radius:99px;box-shadow:0 1px 3px rgba(0,0,0,.25)'), top: enOferta ? 31 : 6 }}>◆</span>
                    )}
                    {/* 🎨 CONTADOR "EN EL CARRITO" (01/10/2026, decisión 14 del dueño: número en tinta
                        con punto de estado). Antes era un círculo de acento lleno con el número en
                        blanco: con el acento azul acero se confundía con el ◆ de destacado y con el
                        marco azul del nivel 2. Ahora es superficie + número en `--text` + punto de
                        acento, como la hoja 1h. `min-width`/`min-height` y no medidas fijas: con
                        "120" o con letra grande el contador crece en vez de cortar el número. */}
                    {qty > 0 && (
                      <span
                        title={`${qty} en el pedido`}
                        style={sx('position:absolute;top:6px;right:6px;min-height:24px;min-width:24px;box-sizing:border-box;padding:0 8px 0 6px;display:flex;align-items:center;gap:5px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:var(--r-sm);font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;font-weight:700;box-shadow:0 0 0 2px var(--surface)')}
                      >
                        <span aria-hidden="true" style={sx('flex:none;width:7px;height:7px;border-radius:var(--r-pill);background:var(--primary)')} />{qty}
                      </span>
                    )}
                    {/* "MIRÁ ESTE": se lo abre grande en la tablet del cliente. Solo aparece con la
                        vidriera viva — fuera de eso no hay a dónde mandarlo. Va abajo a la derecha
                        para no pelear con el contador del carrito, que va arriba. */}
                    {vidActiva && onMostrar && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onMostrar(p) }}
                        className="lu-press"
                        title="Mostrárselo en la tablet"
                        aria-label="Mostrárselo en la tablet"
                        // 44×44 (antes 30): es un objetivo táctil como cualquier otro (brief v2 §4.3).
                        style={sx('position:absolute;right:6px;bottom:6px;width:44px;height:44px;display:grid;place-items:center;border:none;border-radius:var(--r-md);background:var(--glass-strong);color:var(--deep);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.25)')}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 21h8" /></svg>
                      </button>
                    )}
                  </div>

                  <div style={sx('flex:1;display:flex;flex-direction:column;padding:9px 10px 10px')}>
                    {/* Descripción: máximo 2 renglones. */}
                    <div style={{ ...sx('font-size:12.5px;font-weight:500;line-height:1.3;min-height:2.6em'), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>

                    <div style={sx('margin-top:5px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                      {pr.conDescuento ? (
                        <div style={sx('display:flex;align-items:baseline;gap:6px;flex-wrap:wrap')}>
                          <span style={sx('font-size:11px;color:var(--faint);text-decoration:line-through')}>{fmtPesos(pr.base)}</span>
                          <span style={{ ...sx('font-size:14px;font-weight:700'), color: enOferta ? 'var(--warning)' : 'var(--success)' }}>{fmtPesos(pr.precio)}</span>
                        </div>
                      ) : (
                        <span style={sx('font-size:14px;font-weight:700;color:var(--deep)')}>{fmtPesos(pr.precio)}</span>
                      )}
                    </div>

                    {/* LA ESCALERA. Estática: no se recalcula al mover el stepper, y el tramo que
                        aplica se resalta. El vendedor tiene que poder decir "si te llevás seis te
                        sale mil setecientos cincuenta" sin tocar nada — es el dato que vende. */}
                    {escalones.length > 0 && (
                      <div style={sx('margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                        {escalones.map((e) => {
                          const activo = qty >= e.desde
                          return (
                            <span
                              key={e.desde}
                              style={{
                                // 11 px (antes 9,5): mínimo del brief. Con dos escalones largos la
                                // fila parte en dos renglones (`flex-wrap`), no se corta.
                                ...sx('padding:1px 5px;border-radius:6px;font-size:11px;line-height:1.5;white-space:nowrap'),
                                background: activo ? 'var(--success-tint)' : 'var(--surface2)',
                                color: activo ? 'var(--success)' : 'var(--muted)',
                                fontWeight: activo ? 700 : 500,
                              }}
                            >{e.desde}+ {fmtPesos(e.precio)}</span>
                          )
                        })}
                      </div>
                    )}

                    {(p.unidades != null || p.kg > 0) && (
                      <div style={sx('margin-top:2px;font-size:11px;color:var(--faint);font-family:var(--font-mono)')}>
                        {[p.unidades != null ? `×${p.unidades} u` : null, p.kg > 0 ? `${String(p.kg).replace('.', ',')} kg` : null].filter(Boolean).join(' · ')}
                      </div>
                    )}

                    {/* STEPPER (es la pantalla de toma de pedido).
                        🎨 (01/10/2026, C10, hoja "Catálogo Vendedor" 1h/1i) Pasa de botones de 34×34
                        a − y + de 44×52 con 8 px entre controles (brief v2 §4.3: 44 mínimo y 8 de
                        separación entre objetivos contiguos), y el número a una caja de 52 que abre
                        el teclado numérico (`CantidadInput caja`). El + va lleno de acento: es la
                        acción frecuente. En la tarjeta de 161 px el número queda en ~33 px de ancho:
                        excepción documentada en la hoja (alcanza para tres cifras). `stretch` y no
                        `center`: si la letra grande agranda el número, los tres crecen juntos. */}
                    <div style={sx('margin-top:9px;display:flex;align-items:stretch;gap:8px')}>
                      {/* `stopPropagation` porque la tarjeta ENTERA es un botón: sin esto, tocar el
                          − o el + abriría también el zoom encima (y con la vidriera viva le mandaría
                          el producto a la tablet cada vez que el vendedor sube una unidad).
                          🔴 Desde el 09/09/2026 esto ya no es la precaución de un solo filtro: la
                          tarjeta es tocable en toda la grilla, así que sin estas tres líneas el
                          stepper queda inservible en la pantalla entera, no en un rincón. */}
                      <button type="button" aria-label="Quitar una unidad" onClick={(e) => { e.stopPropagation(); addCart(p.id, -1) }} disabled={qty === 0} style={{ ...sx('width:44px;min-height:52px;flex:none;display:grid;place-items:center;padding:0;border:1px solid var(--line2);border-radius:var(--r-md);font-size:19px;user-select:none;background:transparent;font-family:inherit'), color: qty === 0 ? 'var(--faint)' : 'var(--muted)', cursor: qty === 0 ? 'default' : 'pointer', opacity: qty === 0 ? 0.5 : 1 }}>−</button>
                      <CantidadInput qty={qty} onCambiar={(n) => addCart(p.id, n - qty)} flex caja alto={52} minAncho={0} />
                      <button type="button" aria-label="Agregar una unidad" onClick={(e) => { e.stopPropagation(); addCart(p.id, 1) }} style={sx('width:44px;min-height:52px;flex:none;display:grid;place-items:center;padding:0;background:var(--primary);border:1px solid var(--primary);border-radius:var(--r-md);cursor:pointer;color:var(--on-primary);font-size:19px;font-weight:600;user-select:none;font-family:inherit')}>+</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* EL ZOOM. Se monta SIEMPRE (con `producto` en null cuando está cerrado) para que `Overlay`
          pueda animar su propia salida — ver el 🚨 de su encabezado. Cierra con un toque en el
          fondo, con la ✕ y con el ATRÁS de Android, todo heredado de `Overlay`. */}
      <FichaProducto
        producto={zoom}
        cart={cart}
        addCart={addCart}
        puedeMostrar={vidActiva && !!onMostrar}
        onMostrar={() => zoom && onMostrar?.(zoom)}
        onCerrar={() => setZoomId(null)}
      />
    </>
  )
}
