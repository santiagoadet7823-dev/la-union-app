import { useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { precioPara } from '../../lib/precios'
import Overlay from '../../components/Overlay'

/**
 * EL PEDIDO ARMADO, ABIERTO PARA TOCARLO.
 *
 * 🩸 POR QUÉ EXISTE (19/08/2026). La barra del carrito mostraba el total y el botón de confirmar, y
 * nada más: **para cambiar una cantidad había que encontrar el producto otra vez en una grilla de
 * 529** — y para ver qué llevaba el cliente, recordarlo. Lo reportó el cliente con la vidriera
 * andando, que es cuando se nota: el comercio señala cinco cosas seguidas en la tablet y el vendedor
 * necesita repasar la lista con él antes de cerrar.
 *
 * Es la MISMA fuente que la grilla (`cart` + `addCart` de `useJornada`): no hay un segundo estado
 * del pedido que pueda desincronizarse. Tocar el − hasta cero saca la línea, igual que en la grilla.
 *
 * 🩸 QUÉ SE SUMÓ EL 19/08/2026, y por qué:
 *
 *  · **Vaciar el pedido.** Corregir un error de tipeo obligaba a sacar producto por producto. Va con
 *    "Deshacer" y no con un diálogo de confirmación porque el error real es el DEDO, no la decisión:
 *    un diálogo frena al que sí quería vaciar y no salva al que no quería.
 *  · **Quitar una línea de un toque.** Sacar un producto de 8 unidades eran 8 toques al `−`.
 *  · **Intención de compra.** Lo que entró al carrito y salió es la señal comercial más fuerte que
 *    genera una visita —lo iba a llevar y se arrepintió— y hasta hoy se evaporaba. Se muestra al pie
 *    con un `+` que lo devuelve al pedido con la cantidad que tenía, para poder preguntar por él
 *    mientras el comerciante está enfrente.
 *
 * Va por `Overlay variant="sheet"` (§7): nunca un overlay a mano. Con `alto="medio"` porque con dos
 * o tres ítems la hoja quedaba pegada abajo, encimada con la botonera del sistema.
 *
 * props: { productos, cart, quitados, addCart, quitarLinea, vaciar, deshacer, recuperar,
 *          cartCount, cartKg, cartTotal, cartAhorro, onConfirmar, onCerrar }
 */
export default function CarritoSheet({
  productos, cart, quitados = {}, addCart, quitarLinea, vaciar, deshacer, recuperar,
  cartCount, cartKg, cartTotal, cartAhorro = 0, onConfirmar, onCerrar,
}) {
  // "Se vació" es local del sheet y no del hook: es un estado de PRESENTACIÓN (mostrar la tira de
  // deshacer), y el respaldo real de lo vaciado vive en `useJornada`.
  const [deshacible, setDeshacible] = useState(false)

  // Las líneas salen del carrito y no de la lista de productos: así el orden es el de lo que se fue
  // agregando, que es como el vendedor lo repasa en voz alta con el cliente.
  const lineas = Object.entries(cart)
    .map(([id, qty]) => ({ p: productos.find((x) => x.id === id), qty }))
    .filter((l) => l.p)
    // 🩸 EL PRECIO SALE DE `lib/precios.js`, NO DE ACÁ (27/08/2026). Este archivo tenía una COPIA
    // independiente del `precioEfectivo` de `useJornada`: el subtotal de cada renglón se recalculaba
    // con ella mientras el total del pie llegaba ya calculado como prop. Con un precio plano las dos
    // daban lo mismo; con escalones por cantidad, la primera que quedara desactualizada haría que el
    // pie no sumara los renglones que están arriba — y ese total es el que se guarda como
    // `pedidos.monto_total`.
    //
    // `pr` se resuelve una vez por renglón acá y no dentro del JSX: el mismo objeto alimenta el
    // subtotal, el ahorro y el empujón, y así los tres no se pueden contradecir.
    .map((l) => ({ ...l, pr: precioPara(l.p, l.qty) }))

  // Intención de compra: lo que salió del pedido. Lo más reciente primero — es lo que el vendedor
  // acaba de escuchar y sobre lo que todavía puede repreguntar.
  const intencion = Object.entries(quitados)
    .map(([id, q]) => ({ p: productos.find((x) => x.id === id), cantidad: q.cantidad, ts: q.ts }))
    .filter((l) => l.p)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))

  function alVaciar() {
    vaciar?.()
    setDeshacible(true)
  }
  function alDeshacer() {
    deshacer?.()
    setDeshacible(false)
  }

  return (
    <Overlay
      open
      onClose={onCerrar}
      variant="sheet"
      alto="medio"
      title="Pedido"
      subtitle={`${cartCount} ${cartCount === 1 ? 'ítem' : 'ítems'} · ${cartKg.toFixed(1).replace('.', ',')} kg`}
      footer={
        <div style={sx('display:flex;flex-direction:column;gap:10px;width:100%')}>
          {/* La tira de deshacer ocupa el lugar del total mientras está: si el pedido se vació,
              el total es 0 y no hay nada que informar ahí. */}
          {deshacible ? (
            <div style={sx('display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 12px;border-radius:12px;background:var(--surface2);border:1px solid var(--line)')}>
              <span style={sx('font-size:12.5px;color:var(--muted)')}>Se vació el pedido</span>
              <button
                onClick={alDeshacer}
                className="lu-press"
                style={sx('border:none;background:transparent;color:var(--primary);font-size:13px;font-weight:600;cursor:pointer;padding:4px 6px')}
              >Deshacer</button>
            </div>
          ) : (
            <div style={sx('display:flex;flex-direction:column;gap:2px')}>
              <div style={sx('display:flex;justify-content:space-between;align-items:baseline;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                <span style={sx('font-size:12.5px;color:var(--muted)')}>Total</span>
                <span style={sx('font-size:21px;font-weight:700;color:var(--text)')}>{fmtPesos(cartTotal)}</span>
              </div>
              {/* El ahorro del pedido entero. Es el número que el vendedor le dice al comerciante
                  para cerrar, y el que justifica haber empujado a llevar más. */}
              {cartAhorro > 0 && (
                <div style={sx('display:flex;justify-content:space-between;align-items:baseline;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
                  <span style={sx('font-size:11.5px;color:var(--muted)')}>Ahorra por cantidad</span>
                  <span style={sx('font-size:13px;font-weight:600;color:var(--success)')}>{fmtPesos(cartAhorro)}</span>
                </div>
              )}
            </div>
          )}

          <button
            onClick={onConfirmar}
            disabled={!lineas.length}
            className="lu-press"
            style={{
              ...sx('width:100%;min-height:50px;display:grid;place-items:center;border-radius:12px;font-weight:600;font-size:14.5px;border:none'),
              background: lineas.length ? 'var(--primary)' : 'var(--surface2)',
              color: lineas.length ? 'var(--on-primary)' : 'var(--faint)',
              cursor: lineas.length ? 'pointer' : 'default',
            }}
          >
            Confirmar pedido y finalizar visita
          </button>

          {/* Secundario y separado del confirmar: son el gesto opuesto y no van a la misma altura
              ni con el mismo peso visual. */}
          {lineas.length > 0 && (
            <button
              onClick={alVaciar}
              style={sx('width:100%;min-height:38px;display:grid;place-items:center;background:transparent;border:none;color:var(--muted);font-size:12.5px;cursor:pointer')}
            >Vaciar el pedido</button>
          )}
        </div>
      }
    >
      {!lineas.length ? (
        <div style={sx('padding:26px 8px;text-align:center;color:var(--muted);font-size:13px;line-height:1.5')}>
          El pedido está vacío. Agregá productos desde el catálogo o desde la vidriera.
        </div>
      ) : (
        <div style={sx('display:flex;flex-direction:column')}>
          {lineas.map(({ p, qty, pr }) => (
            <div key={p.id} style={sx('display:flex;align-items:center;gap:11px;padding:11px 0;border-bottom:1px solid var(--line)')}>
              {p.imagen
                ? <img src={p.imagen} alt="" style={sx('width:46px;height:46px;flex:none;border-radius:10px;object-fit:cover;background:var(--surface2)')} />
                : <div style={sx('width:46px;height:46px;flex:none;border-radius:10px;background:var(--surface2)')} />}

              <div style={sx('flex:1;min-width:0')}>
                <div style={{ ...sx('font-size:13px;font-weight:500;line-height:1.3'), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>
                {/* El subtotal de la línea, que es lo que el cliente pregunta ("¿cuánto van los seis?"). */}
                <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11.5px;color:var(--faint);margin-top:2px')}>
                  {qty} × {fmtPesos(pr.precio)} = <span style={sx('color:var(--deep);font-weight:600')}>{fmtPesos(qty * pr.precio)}</span>
                  {pr.ahorroTotal > 0 && (
                    <span style={sx('color:var(--success)')}> · ahorra {fmtPesos(pr.ahorroTotal)}</span>
                  )}
                </div>
                {/* 🩸 EL EMPUJÓN. Es lo único de esta pantalla que no describe lo que ya pasó: le
                    da al vendedor la frase exacta para decirle al comerciante. Sin esto, el
                    descuento por volumen sólo lo descubre quien ya pensaba comprar de más. */}
                {pr.siguiente && (
                  <div style={sx('font-size:11px;color:var(--primary);margin-top:3px')}>
                    {pr.siguiente.faltan} más y {pr.precio === pr.siguiente.precio ? 'mejora' : `paga ${fmtPesos(pr.siguiente.precio)} c/u`}
                  </div>
                )}
              </div>

              <div style={sx('display:flex;align-items:center;gap:5px;flex:none')}>
                <button onClick={() => addCart(p.id, -1)} className="lu-press"
                  style={sx('width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);font-size:18px;cursor:pointer;user-select:none')}>−</button>
                <div style={sx('min-width:26px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14px;font-weight:600')}>{qty}</div>
                <button onClick={() => addCart(p.id, 1)} className="lu-press"
                  style={sx('width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--primary);border-radius:10px;background:var(--primary-tint);color:var(--deep);font-size:17px;cursor:pointer;user-select:none')}>+</button>
                {/* Sacar la línea entera. Con 8 unidades, el − son 8 toques. */}
                <button
                  onClick={() => { quitarLinea?.(p.id); setDeshacible(true) }}
                  className="lu-press"
                  aria-label={`Quitar ${p.name} del pedido`}
                  style={sx('width:30px;height:34px;display:grid;place-items:center;border:none;background:transparent;color:var(--faint);cursor:pointer')}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* INTENCIÓN DE COMPRA. Va al pie y no arriba: es contexto, no la tarea. Se muestra igual con
          el pedido vacío — ahí es cuando más sirve, porque significa que el cliente miró y sacó
          todo, y todavía se le puede preguntar por qué. */}
      {intencion.length > 0 && (
        <div style={sx('margin-top:16px;padding-top:14px;border-top:1px dashed var(--line2)')}>
          <div style={sx('display:flex;align-items:center;gap:7px;margin-bottom:9px')}>
            <span style={sx('width:6px;height:6px;flex:none;border-radius:99px;background:var(--warning)')} />
            <span style={sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;color:var(--muted)')}>INTENCIÓN DE COMPRA</span>
          </div>
          <div style={sx('font-size:11.5px;color:var(--faint);line-height:1.45;margin-bottom:10px')}>
            Lo sacó del pedido. Tocá el + para volver a sumarlo con la cantidad que tenía.
          </div>
          <div style={sx('display:flex;flex-direction:column;gap:7px')}>
            {intencion.map(({ p, cantidad }) => (
              <div key={p.id} style={sx('display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line);border-radius:11px;background:var(--surface2)')}>
                <div style={{ ...sx('flex:1;min-width:0;font-size:12.5px;line-height:1.3'), display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>
                <div style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11.5px;color:var(--muted)')}>{cantidad} u</div>
                <button
                  onClick={() => recuperar?.(p.id)}
                  className="lu-press"
                  aria-label={`Volver a sumar ${p.name}`}
                  style={sx('width:30px;height:30px;flex:none;display:grid;place-items:center;border:1px solid var(--primary);border-radius:9px;background:var(--primary-tint);color:var(--deep);font-size:16px;cursor:pointer;user-select:none')}
                >+</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Overlay>
  )
}
