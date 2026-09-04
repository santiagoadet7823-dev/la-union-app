import { sx } from '../lib/sx'
import { fmtPesos } from '../lib/format'
import { escaleraDe, precioPara } from '../lib/precios'
import { ImagenVacia, Search } from './icons'
import { propsBusqueda } from './form'
import CantidadInput from './CantidadInput'

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
 * props: { productos, cart, addCart, search, setSearch, catFilter, setCatFilter, onAbrirFicha,
 *          vidActiva, onMostrar, paddingInferior, children }
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
  onAbrirFicha,
  vidActiva = false,
  onMostrar,
  paddingInferior = 180,
  vacioTitulo = 'El catálogo está vacío',
  vacioTexto = 'El administrador todavía no cargó los productos. En cuanto los cargue, vas a poder armar pedidos.',
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
  // La tarjeta entera es un botón sólo cuando hay a dónde ir. Antes esto dependía del chip activo;
  // ahora depende de que el llamador ofrezca la ficha, que es la condición real.
  const tarjetaClickeable = enDestacados && !!onAbrirFicha

  return (
    <>
      <div style={sx('flex:none;padding:12px 14px 8px')}>
        {/* El input va sin borde ni outline a propósito: el foco lo marca este
            contenedor con .lu-campo (:focus-within). Ver index.css. */}
        <div className="lu-campo" style={sx('display:flex;align-items:center;gap:8px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);padding:0 12px;height:44px')}>
          <Search />
          <input {...propsBusqueda} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar producto…" style={sx('flex:1;border:none;outline:none;background:transparent;font-family:Inter,sans-serif;font-size:13.5px;color:var(--text)')} />
        </div>
      </div>

      {children}

      {/* Chips de categoría: scroll horizontal. Ofertas filtra los productos en oferta. */}
      {productos.length > 0 && (
        <div className="lu-chips" style={sx('flex:none;display:flex;gap:7px;overflow-x:auto;padding:2px 14px 10px;scrollbar-width:none;-ms-overflow-style:none')}>
          {chips.map((c) => {
            const on = catFilter === c
            const esOfertas = c === 'Ofertas'
            const esDestacados = c === 'Destacados'
            return (
              <button
                key={c}
                onClick={() => setCatFilter(c)}
                style={{
                  ...sx('flex:none;min-height:32px;padding:0 13px;border-radius:99px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap'),
                  // Destacados apagado ya va con borde de color: es el único chip que hay que
                  // aprender a tocar, y uno gris entre quince categorías grises no se ve.
                  border: `1px solid ${on || esDestacados ? 'var(--primary)' : 'var(--line2)'}`,
                  background: on ? 'var(--primary-tint)' : 'transparent',
                  color: on ? 'var(--deep)' : (esOfertas ? 'var(--warning)' : (esDestacados ? 'var(--primary)' : 'var(--muted)')),
                }}
              >
                {esOfertas ? '★ Ofertas' : (esDestacados ? '◆ Destacados' : c)}
              </button>
            )
          })}
        </div>
      )}

      <div style={{ ...sx('flex:1;overflow-y:auto;padding:0 14px'), paddingBottom: paddingInferior }}>
        {/* Una línea de instrucción, sólo en Destacados. El gesto (tocar la tarjeta para abrirla
            grande / mandarla a la tablet) es nuevo y no se descubre solo: en el resto de la grilla
            tocar una tarjeta no hace nada desde siempre. */}
        {tarjetaClickeable && items.length > 0 && (
          <div style={sx('margin:8px 0 2px;font-size:11.5px;color:var(--muted);line-height:1.45')}>
            Tocá un producto para {vidActiva ? 'mostrárselo grande en la tablet' : 'verlo grande y mostrárselo'}.
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
                  // En Destacados la tarjeta ENTERA abre la ficha: el gesto que se pidió es "tocar el
                  // producto", no "encontrar un botón". En el resto de los filtros la grilla sigue
                  // funcionando como siempre — es la pantalla de toma de pedido y ahí el toque útil
                  // es el stepper, que ya está en la calle.
                  onClick={tarjetaClickeable ? () => onAbrirFicha(p) : undefined}
                  className={tarjetaClickeable ? 'lu-press' : undefined}
                  role={tarjetaClickeable ? 'button' : undefined}
                  style={{
                    ...sx('display:flex;flex-direction:column;background:var(--surface);border-radius:14px;overflow:hidden'),
                    cursor: tarjetaClickeable ? 'pointer' : 'default',
                    // El marco SIEMPRE es el nivel de rentabilidad; el estado "en carrito"
                    // se marca con un anillo (box-shadow) para no pisar ese código de color.
                    border: `2px solid ${rentColor(p.nivel)}`,
                    boxShadow: qty > 0 ? '0 0 0 2px var(--primary)' : 'none',
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
                    {enOferta && (
                      <span style={sx('position:absolute;top:6px;left:6px;background:var(--warning);color:#3d2c00;font-size:9.5px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:99px;box-shadow:0 1px 3px rgba(0,0,0,.25)')}>OFERTA</span>
                    )}
                    {/* El rombo marca el destacado en el resto de los filtros: dentro de Destacados
                        lo son todos y repetirlo 20 veces es ruido. Va abajo de OFERTA cuando hay las
                        dos, que es el caso más común (algo que no rota y encima está en promoción). */}
                    {p.destacado && !enDestacados && (
                      <span style={{ ...sx('position:absolute;left:6px;background:var(--primary);color:var(--on-primary);font-size:9.5px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:99px;box-shadow:0 1px 3px rgba(0,0,0,.25)'), top: enOferta ? 28 : 6 }}>◆</span>
                    )}
                    {qty > 0 && (
                      <span style={sx('position:absolute;top:6px;right:6px;width:22px;height:22px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:99px;font-family:var(--font-mono);font-size:11px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.25)')}>{qty}</span>
                    )}
                    {/* "MIRÁ ESTE": se lo abre grande en la tablet del cliente. Solo aparece con la
                        vidriera viva — fuera de eso no hay a dónde mandarlo. Va abajo a la derecha
                        para no pelear con el contador del carrito, que va arriba. */}
                    {vidActiva && onMostrar && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onMostrar(p) }}
                        className="lu-press"
                        title="Mostrárselo en la tablet"
                        style={sx('position:absolute;right:6px;bottom:6px;width:30px;height:30px;display:grid;place-items:center;border:none;border-radius:9px;background:var(--glass-strong);color:var(--deep);cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.25)')}
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
                                ...sx('padding:1px 5px;border-radius:6px;font-size:9.5px;line-height:1.5;white-space:nowrap'),
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
                      <div style={sx('margin-top:2px;font-size:10.5px;color:var(--faint);font-family:var(--font-mono)')}>
                        {[p.unidades != null ? `×${p.unidades} u` : null, p.kg > 0 ? `${String(p.kg).replace('.', ',')} kg` : null].filter(Boolean).join(' · ')}
                      </div>
                    )}

                    {/* Stepper compacto (es la pantalla de toma de pedido). */}
                    <div style={sx('margin-top:9px;display:flex;align-items:center;justify-content:space-between;gap:6px')}>
                      {/* `stopPropagation` porque en Destacados la tarjeta es un botón: sin esto,
                          tocar el − o el + abriría también la ficha (y con la vidriera viva le
                          mandaría el producto a la tablet cada vez que el vendedor sube una unidad). */}
                      <button onClick={(e) => { e.stopPropagation(); addCart(p.id, -1) }} disabled={qty === 0} style={{ ...sx('width:34px;height:34px;flex:none;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;font-size:18px;user-select:none;background:transparent'), color: qty === 0 ? 'var(--faint)' : 'var(--muted)', cursor: qty === 0 ? 'default' : 'pointer', opacity: qty === 0 ? 0.5 : 1 }}>−</button>
                      <CantidadInput qty={qty} onCambiar={(n) => addCart(p.id, n - qty)} flex />
                      <button onClick={(e) => { e.stopPropagation(); addCart(p.id, 1) }} style={sx('width:34px;height:34px;flex:none;display:grid;place-items:center;background:var(--primary-tint);border:1px solid var(--primary);border-radius:10px;cursor:pointer;color:var(--deep);font-size:17px;user-select:none')}>+</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
