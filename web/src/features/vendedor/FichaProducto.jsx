import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { escaleraDe, precioPara } from '../../lib/precios'
import { ImagenVacia } from '../../components/icons'
import Overlay from '../../components/Overlay'

/**
 * EL PRODUCTO, GRANDE, DEL LADO DEL VENDEDOR.
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
 * ⚠️ EL PRECIO SALE DE `precioPara`, NUNCA DE UNA CUENTA ACÁ (regla 52). Esta pantalla se le muestra
 * al comerciante: si dijera un número distinto del de la tablet o del carrito, el error se descubre
 * con la persona enfrente. Y se resuelve CONTRA LA CANTIDAD, porque con escalones el precio de 6 no
 * es el precio de 1.
 *
 * ⚠️ VA POR `Overlay variant="sheet"`, como `CarritoSheet` (regla del repo: nunca un overlay a
 * mano). De ahí salen gratis el z-index por token, el Escape, el scroll-lock y —lo que importa en el
 * APK— el registro en la pila de `services/atras.js`: sin eso el botón ATRÁS de Android cerraría la
 * app en vez de la ficha (reglas 26 y 27).
 *
 * El carrito es el MISMO de la grilla (`cart` + `addCart` de `useJornada`): no hay un segundo estado
 * del pedido que pueda desincronizarse, igual que en `CarritoSheet`.
 *
 * props: { producto, cart, addCart, puedeMostrar, onMostrar, onCerrar }
 */
export default function FichaProducto({ producto, cart, addCart, puedeMostrar, onMostrar, onCerrar }) {
  if (!producto) return null

  const qty = cart[producto.id] || 0
  // La escalera se muestra contra la cantidad que HAY en el pedido; el precio grande, contra lo que
  // se llevaría al tocar el botón (mínimo 1). Con 0 en el carrito, mostrar el precio del escalón 0
  // sería mostrar el precio de no comprar nada.
  const pr = precioPara(producto, Math.max(1, qty))
  const escalones = escaleraDe(producto)

  return (
    <Overlay
      open
      onClose={onCerrar}
      variant="sheet"
      alto="medio"
      title={producto.name}
      subtitle={[producto.marca, producto.codigo].filter(Boolean).join(' · ') || undefined}
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
              <button onClick={() => addCart(producto.id, -1)} disabled={qty === 0} style={{ ...sx('width:42px;height:46px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;font-size:20px;user-select:none;background:transparent'), color: qty === 0 ? 'var(--faint)' : 'var(--muted)', cursor: qty === 0 ? 'default' : 'pointer', opacity: qty === 0 ? 0.5 : 1 }}>−</button>
              <div style={{ ...sx('min-width:34px;text-align:center;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:16px;font-weight:600'), color: qty > 0 ? 'var(--deep)' : 'var(--faint)' }}>{qty}</div>
              <button onClick={() => addCart(producto.id, 1)} style={sx('width:42px;height:46px;display:grid;place-items:center;background:var(--primary-tint);border:1px solid var(--primary);border-radius:12px;cursor:pointer;color:var(--deep);font-size:19px;user-select:none')}>+</button>
            </div>
            <button
              className="lu-press"
              onClick={() => { addCart(producto.id, 1); onCerrar() }}
              style={sx('flex:1;min-height:46px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-size:13.5px;font-weight:600;cursor:pointer')}
            >
              {qty > 0 ? 'Sumar uno más' : 'Sumar al pedido'}
            </button>
          </div>
        </div>
      }
    >
      {/* Foto grande. Caja cuadrada con el fallback de `padding-top` en vez de `aspect-ratio`, que no
          existe en los WebView viejos del parque (mismo criterio que la grilla). */}
      <div style={sx('position:relative;width:100%;padding-top:78%;border-radius:14px;overflow:hidden;background:var(--surface2)')}>
        {producto.imagen ? (
          <img src={producto.imagen} alt="" style={sx('position:absolute;inset:0;width:100%;height:100%;object-fit:contain')} />
        ) : (
          <div style={sx('position:absolute;inset:0;display:grid;place-items:center;color:var(--faint)')}>
            <ImagenVacia size={44} />
          </div>
        )}
        {producto.oferta && producto.precioOferta != null && (
          <span style={sx('position:absolute;top:9px;left:9px;background:var(--warning);color:#3d2c00;font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:3px 9px;border-radius:99px')}>OFERTA</span>
        )}
        {producto.destacado && (
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

      {(producto.unidades != null || producto.kg > 0 || producto.unidadVenta) && (
        <div style={sx('margin-top:4px;font-size:12px;color:var(--faint);font-family:var(--font-mono)')}>
          {[
            producto.unidadVenta || null,
            producto.unidades != null ? `bulto de ${producto.unidades}` : null,
            producto.kg > 0 ? `${String(producto.kg).replace('.', ',')} kg` : null,
          ].filter(Boolean).join(' · ')}
        </div>
      )}

      {/* LA ESCALERA, que acá es el argumento de venta y no un adorno: es lo que deja decir "si te
          llevás seis te sale mil setecientos cincuenta" con el número a la vista de los dos. */}
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
                    ...sx('display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 11px;border-radius:10px;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px'),
                    background: activo ? 'var(--success-tint)' : 'var(--surface2)',
                    color: activo ? 'var(--success)' : 'var(--muted)',
                    fontWeight: activo ? 700 : 500,
                  }}
                >
                  <span>desde {e.desde} u.</span>
                  <span>{fmtPesos(e.precio)} c/u</span>
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
  )
}
