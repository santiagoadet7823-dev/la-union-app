import { useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { escaleraDe, precioPara } from '../../lib/precios'
import CantidadInput from '../../components/CantidadInput'
import ConfirmarDobleToque from '../../components/ConfirmarDobleToque'
import { ImagenVacia } from '../../components/icons'
import Overlay from '../../components/Overlay'

/**
 * EL PRODUCTO, GRANDE, DEL LADO DEL VENDEDOR. **Es el zoom de la tarjeta del catálogo.**
 *
 * 🩸 POR QUÉ EXISTE (28/08/2026, con el filtro "Destacados"). La grilla es de dos columnas: la foto
 * mide ~170 px y la descripción se corta a dos renglones. Para lo que el vendedor ya vende alcanza
 * —el comerciante sabe lo que le está pidiendo—, pero los destacados son justamente los productos
 * que el comercio NO conoce: ahí la miniatura no vende nada.
 *
 * 🔴 Y RESUELVE EL CASO SIN TABLET, QUE ES LA MAYORÍA DE LAS VISITAS. La forma "obvia" hubiera sido
 * mandar el destacado a la tablet y nada más, pero la vidriera necesita hotspot, pareo y una tablet
 * del lado del comercio. Sin eso, "tocá el producto y mostráselo" no tenía dónde pasar. Esta ficha
 * es esa pantalla: el vendedor da vuelta el celular y muestra la foto, el precio y la escalera.
 * Con la vidriera viva, además, se abre en la tablet — las dos cosas juntas, no una o la otra.
 *
 * 🩸 09/09/2026 — DE HOJA INFERIOR A ZOOM CENTRADO, y no es un cambio de gusto. La reunión con La
 * Unión pidió que "cada recuadro de producto tenga una animación que al tocarlo se haga un zoom y se
 * ponga en el centro de la pantalla, no cubriendo toda la pantalla pero sí aumentando su tamaño por
 * lo menos 50%". Un bottom-sheet entra desde abajo y se pega al borde inferior: por más grande que
 * sea, NO se lee como la misma tarjeta ampliada, que es lo que hace entender el gesto. Un modal
 * centrado con `animacion="zoom"` (arranca en `scale(.72)`, ver index.css) sí. El ancho de 340 px
 * contra los ~170 de la tarjeta de la grilla es 2× de ancho y ~4× de área, y el `maxHeight:92vh` de
 * `Overlay` garantiza el "no cubriendo toda la pantalla".
 *
 * ⚠️ EL PRECIO SALE DE `precioPara`, NUNCA DE UNA CUENTA ACÁ (regla 52). Esta pantalla se le muestra
 * al comerciante: si dijera un número distinto del de la tablet o del carrito, el error se descubre
 * con la persona enfrente. Y se resuelve CONTRA LA CANTIDAD, porque con escalones el precio de 6 no
 * es el precio de 1.
 *
 * ⚠️ VA POR `Overlay`, como `CarritoSheet` (regla del repo: nunca un overlay a mano). De ahí salen
 * gratis el z-index por token, el Escape, el scroll-lock y —lo que importa en el APK— el registro en
 * la pila de `services/atras.js`: sin eso el botón ATRÁS de Android cerraría la app en vez de la
 * ficha (reglas 26 y 27). También de ahí sale el cierre de UN TOQUE en el fondo, que es el que se
 * pidió en la reunión.
 *
 * El carrito es el MISMO de la grilla (`cart` + `addCart` de `useJornada`): no hay un segundo estado
 * del pedido que pueda desincronizarse, igual que en `CarritoSheet`.
 *
 * 🔑 SE MONTA SIEMPRE, con `producto` en null cuando está cerrada. Es lo que pide `Overlay` para
 * poder animar su propia salida (ver el 🚨 de su encabezado); el `{cond && <Ficha/>}` que había
 * antes en `VisitaCatalogo` la arrancaba del árbol en el mismo frame y la salida no corría nunca.
 *
 * props: { producto, cart, addCart, puedeMostrar, onMostrar, onCerrar }
 */

// Cuánto dura la "tanda" de toques sobre un mismo botón de la escalera. 800 ms es el rango del
// doble-click de los sistemas operativos (400-500 ms) con margen para un dedo grueso sobre una
// pantalla con protector: por debajo de eso, el segundo toque de alguien apurado ya cuenta como
// tanda nueva y el cartel no aparece nunca — que es exactamente lo que hay que evitar.
const VENTANA_TOQUES = 800

export default function FichaProducto({ producto, cart, addCart, puedeMostrar, onMostrar, onCerrar }) {
  // El último producto visto, para poder seguir dibujando la ficha durante la animación de salida
  // (cuando el padre ya puso `producto` en null). Sin esto la ficha se vaciaría a mitad de la
  // animación y se vería el parpadeo que `Overlay` justamente vino a sacar.
  const ultimo = useRef(null)

  // La tanda en curso: `{ desde, toques }`. Va en un ref y NO en estado porque cambia dentro del
  // mismo gesto y no tiene que redibujar nada — lo único que se pinta es el cartel, que sí es
  // estado. `timer` es el temporizador de la ventana.
  const tanda = useRef(null)
  const timer = useRef(null)
  const [confirmar, setConfirmar] = useState(null)   // { desde, toques } | null

  const idActual = producto?.id

  // 🔑 LA TANDA SE REINICIA AL CAMBIAR DE PRODUCTO (y al cerrar). El cliente pidió el cartel "en
  // todos los productos, no solo en el primero… como un protocolo de selección de cada producto":
  // arrastrar el contador de un producto al siguiente haría que el primer toque sobre el segundo
  // abriera el cartel hablando de la tanda del anterior.
  useEffect(() => {
    clearTimeout(timer.current)
    timer.current = null
    tanda.current = null
    setConfirmar(null)
  }, [idActual])

  // El temporizador no puede sobrevivir al desmontaje: dispararía sobre un componente muerto.
  useEffect(() => () => clearTimeout(timer.current), [])

  if (producto) ultimo.current = producto
  const p = producto || ultimo.current
  if (!p) return null

  const qty = cart[p.id] || 0
  // La escalera se muestra contra la cantidad que HAY en el pedido; el precio grande, contra lo que
  // se llevaría al tocar el botón (mínimo 1). Con 0 en el carrito, mostrar el precio del escalón 0
  // sería mostrar el precio de no comprar nada.
  const pr = precioPara(p, Math.max(1, qty))
  const escalones = escaleraDe(p)

  /**
   * 🩸 EL PROTOCOLO DE CARGA POR TANDA (09/09/2026, pedido textual de la reunión).
   *
   * Toque 1  → carga las unidades del escalón AL INSTANTE. Sin fricción: es el camino normal y el
   *            que el vendedor va a hacer cien veces por día.
   * Toque 2+ → **no suma nada** y abre el cartel. Acá está el punto: un toque de más sobre un botón
   *            que carga de a seis no es un error de una unidad que se ve y se corrige, son SEIS
   *            metidas en un pedido de veinte renglones. La respuesta del vendedor decide: "Solo 6"
   *            deja lo cargado, "Sí, 12" suma la diferencia.
   *
   * La ventana se REINICIA en cada toque, así tres toques rápidos proponen 18 y no 12 — "se cargan
   * las cantidades que vaya apretando el vendedor", que fue como se pidió.
   *
   * ⚠️ `addCart` es un DELTA, no la cantidad final (`useJornada.js`). Todo lo de acá suma deltas.
   */
  function tocarEscalon(esc) {
    const t = tanda.current
    if (!t || t.desde !== esc.desde) {
      // Tanda nueva (o cambió de escalón): carga y arranca a contar.
      addCart(p.id, esc.desde)
      tanda.current = { desde: esc.desde, toques: 1 }
    } else {
      t.toques += 1
      setConfirmar({ desde: t.desde, toques: t.toques })
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { tanda.current = null; timer.current = null }, VENTANA_TOQUES)
  }

  // Cerrar la tanda sin sumar nada más. Es también lo que pasa al cerrar el cartel por afuera:
  // un cartel de confirmación no puede terminar agregando mercadería al pedido.
  function soloLaPrimera() {
    clearTimeout(timer.current)
    timer.current = null
    tanda.current = null
    setConfirmar(null)
  }

  function todasLasTandas() {
    // Sólo el faltante: la primera tanda ya entró al carrito en el toque 1.
    if (confirmar) addCart(p.id, confirmar.desde * (confirmar.toques - 1))
    soloLaPrimera()
  }

  return (
    <>
      <Overlay
        open={!!producto}
        onClose={onCerrar}
        variant="modal"
        animacion="zoom"
        maxWidth={340}
        title={p.name}
        subtitle={[p.marca, p.codigo].filter(Boolean).join(' · ') || undefined}
        footer={
          <div style={sx('display:flex;flex-direction:column;gap:9px;width:100%')}>
            {/* El botón de la tablet va ARRIBA del de sumar y no al revés: el orden de la conversación
                es mostrar primero y sumar después de que el comerciante diga que sí. Sólo aparece con
                la vidriera viva — sin tablet pareada no hay a dónde mandarlo. */}
            {puedeMostrar && (
              <button className="lu-press" onClick={onMostrar} style={sx('width:100%;min-height:46px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--primary);background:var(--primary-tint);color:var(--deep);border-radius:12px;font-size:13.5px;font-weight:600;cursor:pointer')}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 21h8" /></svg>
                Mostrárselo en la tablet
              </button>
            )}
            <div style={sx('display:flex;align-items:center;gap:9px')}>
              <div style={sx('display:flex;align-items:center;gap:6px;flex:none')}>
                <button onClick={() => addCart(p.id, -1)} disabled={qty === 0} style={{ ...sx('width:42px;height:46px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-size:20px;user-select:none;background:transparent'), color: qty === 0 ? 'var(--faint)' : 'var(--muted)', cursor: qty === 0 ? 'default' : 'pointer', opacity: qty === 0 ? 0.5 : 1 }}>−</button>
                <CantidadInput qty={qty} onCambiar={(n) => addCart(p.id, n - qty)} alto={46} fuente={16} minAncho={34} />
                <button onClick={() => addCart(p.id, 1)} style={sx('width:42px;height:46px;display:grid;place-items:center;background:var(--primary-tint);border:1px solid var(--primary);border-radius:12px;cursor:pointer;color:var(--deep);font-size:19px;user-select:none')}>+</button>
              </div>
              <button
                className="lu-press"
                onClick={() => { addCart(p.id, 1); onCerrar() }}
                style={sx('flex:1;min-height:46px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-size:13.5px;font-weight:600;cursor:pointer')}
              >
                {qty > 0 ? 'Sumar uno más' : 'Sumar al pedido'}
              </button>
            </div>
          </div>
        }
      >
        {/* Foto grande. Caja con el fallback de `padding-top` en vez de `aspect-ratio`, que no existe
            en los WebView viejos del parque (mismo criterio que la grilla).
            🩸 09/09/2026 — bajó de 78% a 62%: con los botones de carga en cada renglón de la escalera
            el bloque de precios creció ~25 px por escalón, y en un teléfono chico con cinco escalones
            el precio grande quedaba abajo del pliegue. La foto sigue siendo lo más grande de la
            ficha, que es lo que importa. */}
        <div style={sx('position:relative;width:100%;padding-top:62%;border-radius:14px;overflow:hidden;background:var(--surface2)')}>
          {p.imagen ? (
            <img src={p.imagen} alt="" style={sx('position:absolute;inset:0;width:100%;height:100%;object-fit:contain')} />
          ) : (
            <div style={sx('position:absolute;inset:0;display:grid;place-items:center;color:var(--faint)')}>
              <ImagenVacia size={44} />
            </div>
          )}
          {p.oferta && p.precioOferta != null && (
            <span style={sx('position:absolute;top:9px;left:9px;background:var(--warning);color:#3d2c00;font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:3px 9px;border-radius:99px')}>OFERTA</span>
          )}
          {p.destacado && (
            <span style={sx('position:absolute;top:9px;right:9px;background:var(--primary);color:var(--on-primary);font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:3px 9px;border-radius:99px')}>DESTACADO</span>
          )}
        </div>

        {/* `object-fit:contain` y no `cover`: en la grilla el recorte no importa porque la miniatura es
            una pista, pero acá el comerciante está MIRANDO el producto y un envase cortado al medio se
            lee como otra cosa. */}

        <div style={sx('margin-top:14px;display:flex;align-items:baseline;gap:9px;flex-wrap:wrap;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
          {pr.conDescuento && <span style={sx('font-size:14px;color:var(--faint);text-decoration:line-through')}>{fmtPesos(pr.base)}</span>}
          <span style={{ ...sx('font-size:26px;font-weight:700'), color: pr.conDescuento ? 'var(--success)' : 'var(--deep)' }}>{fmtPesos(pr.precio)}</span>
          <span style={sx('font-size:12px;color:var(--muted)')}>c/u</span>
        </div>

        {(p.unidades != null || p.kg > 0 || p.unidadVenta) && (
          <div style={sx('margin-top:4px;font-size:12px;color:var(--faint);font-family:var(--font-mono)')}>
            {[
              p.unidadVenta || null,
              p.unidades != null ? `bulto de ${p.unidades}` : null,
              p.kg > 0 ? `${String(p.kg).replace('.', ',')} kg` : null,
            ].filter(Boolean).join(' · ')}
          </div>
        )}

        {/* LA ESCALERA, que acá es el argumento de venta y no un adorno: es lo que deja decir "si te
            llevás seis te sale mil setecientos cincuenta" con el número a la vista de los dos.
            🩸 09/09/2026 — cada renglón CARGA. Antes era un cartel informativo: el vendedor leía
            "desde 6 u.", cerraba la ficha y volvía a tocar el + seis veces. El pedido de la reunión
            fue que "aparezca un botón al lado derecho para agregar esa cantidad que indica al
            carrito". El precio del renglón no se recalcula al tocarlo: lo resuelve `precioPara`
            contra la cantidad total del carrito, así que el escalón se aplica solo. */}
        {escalones.length > 0 && (
          <div style={sx('margin-top:14px')}>
            <div style={sx('font-size:10px;font-weight:600;letter-spacing:.07em;color:var(--muted);margin-bottom:7px')}>PRECIO POR CANTIDAD</div>
            <div style={sx('display:flex;flex-direction:column;gap:5px')}>
              {escalones.map((e) => {
                const activo = qty >= e.desde
                return (
                  <div
                    key={e.desde}
                    style={{
                      ...sx('display:flex;align-items:center;gap:8px;padding:5px 5px 5px 11px;border-radius:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px'),
                      background: activo ? 'var(--success-tint)' : 'var(--surface2)',
                      color: activo ? 'var(--success)' : 'var(--muted)',
                      fontWeight: activo ? 700 : 500,
                    }}
                  >
                    <span style={sx('flex:1;min-width:0')}>desde {e.desde} u.</span>
                    <span style={sx('flex:none')}>{fmtPesos(e.precio)} c/u</span>
                    {/* 44 px de alto: es el mínimo táctil del resto de la app, y acá importa más que
                        en ningún lado porque el error de puntería en este botón cuesta un bulto
                        entero. El texto sale del escalón, nunca de una constante. */}
                    <button
                      className="lu-press"
                      onClick={() => tocarEscalon(e)}
                      aria-label={`Agregar ${e.desde} unidades al pedido`}
                      style={sx('flex:none;min-width:66px;height:44px;padding:0 12px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px;font-weight:700;cursor:pointer;user-select:none')}
                    >
                      +{e.desde} u.
                    </button>
                  </div>
                )
              })}
            </div>
            {/* El empujón sale de `precioPara` y no de una cuenta acá: sólo se ofrece si de verdad
                mejora lo que se está pagando (con una oferta más barata que el escalón siguiente,
                invitar a llevar más sería mentirle). */}
            {pr.siguiente && (
              <div style={sx('margin-top:8px;font-size:12px;color:var(--primary);font-weight:600')}>
                {pr.siguiente.faltan} más y cada uno sale {fmtPesos(pr.siguiente.precio)}
              </div>
            )}
          </div>
        )}

        {qty > 0 && (
          <div style={sx('margin-top:14px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px;display:flex;justify-content:space-between')}>
            <span style={sx('color:var(--muted)')}>{qty} en el pedido</span>
            <span style={sx('font-weight:700;color:var(--text)')}>{fmtPesos(pr.precio * qty)}</span>
          </div>
        )}
      </Overlay>

      {/* Va FUERA del `Overlay` de la ficha y no adentro: los dos son portales a `document.body`, y
          al renderizarse después éste queda encima con el mismo `--z-modal`. Adentro del cuerpo
          scrolleable de la ficha, en cambio, quedaría atrapado en su stacking context. */}
      <ConfirmarDobleToque
        abierto={!!confirmar}
        unidades={confirmar?.desde || 0}
        toques={confirmar?.toques || 2}
        onSolo={soloLaPrimera}
        onTodas={todasLasTandas}
      />
    </>
  )
}
