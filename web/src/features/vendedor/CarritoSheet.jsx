import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
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
 * Va por `Overlay variant="sheet"` (§7): nunca un overlay a mano.
 *
 * props: { productos, cart, addCart, cartCount, cartKg, cartTotal, onConfirmar, onCerrar }
 */
export default function CarritoSheet({ productos, cart, addCart, cartCount, cartKg, cartTotal, onConfirmar, onCerrar }) {
  // Las líneas salen del carrito y no de la lista de productos: así el orden es el de lo que se fue
  // agregando, que es como el vendedor lo repasa en voz alta con el cliente.
  const lineas = Object.entries(cart)
    .map(([id, qty]) => ({ p: productos.find((x) => x.id === id), qty }))
    .filter((l) => l.p)

  const precio = (p) => (p.oferta && p.precioOferta != null ? p.precioOferta : (p.price || 0))

  return (
    <Overlay
      open
      onClose={onCerrar}
      variant="sheet"
      title="Pedido"
      subtitle={`${cartCount} ${cartCount === 1 ? 'ítem' : 'ítems'} · ${cartKg.toFixed(1).replace('.', ',')} kg`}
      footer={
        <div style={sx('display:flex;flex-direction:column;gap:10px;width:100%')}>
          <div style={sx('display:flex;justify-content:space-between;align-items:baseline;font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>
            <span style={sx('font-size:12.5px;color:var(--muted)')}>Total</span>
            <span style={sx('font-size:21px;font-weight:700;color:var(--text)')}>{fmtPesos(cartTotal)}</span>
          </div>
          <button
            onClick={onConfirmar}
            className="lu-press"
            style={sx('width:100%;min-height:50px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border-radius:12px;font-weight:600;font-size:14.5px;cursor:pointer;border:none')}
          >
            Confirmar pedido y finalizar visita
          </button>
        </div>
      }
    >
      {!lineas.length ? (
        <div style={sx('padding:26px 8px;text-align:center;color:var(--muted);font-size:13px;line-height:1.5')}>
          El pedido está vacío. Agregá productos desde el catálogo o desde la vidriera.
        </div>
      ) : (
        <div style={sx('display:flex;flex-direction:column')}>
          {lineas.map(({ p, qty }) => (
            <div key={p.id} style={sx('display:flex;align-items:center;gap:11px;padding:11px 0;border-bottom:1px solid var(--line)')}>
              {p.imagen
                ? <img src={p.imagen} alt="" style={sx('width:46px;height:46px;flex:none;border-radius:10px;object-fit:cover;background:var(--surface2)')} />
                : <div style={sx('width:46px;height:46px;flex:none;border-radius:10px;background:var(--surface2)')} />}

              <div style={sx('flex:1;min-width:0')}>
                <div style={{ ...sx('font-size:13px;font-weight:500;line-height:1.3'), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</div>
                {/* El subtotal de la línea, que es lo que el cliente pregunta ("¿cuánto van los seis?"). */}
                <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11.5px;color:var(--faint);margin-top:2px')}>
                  {qty} × {fmtPesos(precio(p))} = <span style={sx('color:var(--deep);font-weight:600')}>{fmtPesos(qty * precio(p))}</span>
                </div>
              </div>

              <div style={sx('display:flex;align-items:center;gap:5px;flex:none')}>
                <button onClick={() => addCart(p.id, -1)} className="lu-press"
                  style={sx('width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);font-size:18px;cursor:pointer;user-select:none')}>−</button>
                <div style={sx('min-width:26px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:14px;font-weight:600')}>{qty}</div>
                <button onClick={() => addCart(p.id, 1)} className="lu-press"
                  style={sx('width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--primary);border-radius:10px;background:var(--primary-tint);color:var(--deep);font-size:17px;cursor:pointer;user-select:none')}>+</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Overlay>
  )
}
