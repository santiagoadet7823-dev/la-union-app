import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { precioPara } from '../../lib/precios'
import { btnPrimario, btnSecundario } from '../../lib/botones'

/**
 * EL CARTEL DE "EL CLIENTE ESTÁ MIRANDO ESTO", flotando sobre lo que el vendedor tenga abierto.
 *
 * 🩸 Salió de dentro de la hoja del QR el 19/08/2026. Ahí solo se veía con esa ventana abierta, y el
 * vendedor la cierra todo el tiempo —para buscar en su catálogo, para revisar el pedido, para
 * hablar—: o sea que el aviso aparecía justo cuando no lo estaba mirando. Ahora vive al nivel de la
 * pantalla de la visita y se ve siempre.
 *
 * 🩸 El toque del cliente NO entra solo al carrito. El pedido es del vendedor, y su cliente puede
 * estar señalando para preguntar un precio, no para comprar. Por eso hay un botón.
 *
 * ⚠️ `pointerEvents:'none'` en el contenedor y `'auto'` solo en la tarjeta (regla 30): esto es un
 * flotante con `left`/`right` fijos y se tragaría los toques de la grilla en toda esa franja.
 *
 * 🩸 Y VA `fixed` CON `--z-aviso`, NO `absolute` CON UN NÚMERO (18/08/2026). En la primera jornada
 * real el vendedor estaba mirando el pedido y el cliente tocó otro producto: el aviso no llegó
 * nunca. Llevaba `z-index:6` —un literal suelto— contra los **300** de `--z-sheet` que usa
 * `CarritoSheet`; no había competencia. Y `absolute` además lo recortaba el contenedor de la
 * pestaña. Ahora se ve sobre todo lo que el vendedor tenga abierto, que es literalmente lo que dice
 * la primera línea de este comentario y hasta hoy era mentira.
 */
export default function AvisoVidriera({ aviso, comercio, onSumar, onDescartar }) {
  if (!aviso) return null
  const n = aviso._cant || 1
  // 🩸 EL PRECIO SALE DE `precios.js`, NO DE UNA CUENTA A MANO (28/08/2026, regla 52).
  //
  // Acá decía `aviso.oferta && aviso.precioOferta != null ? aviso.precioOferta : aviso.price`. Era
  // el ÚNICO de los 11 lugares de la regla 52 que quedó sin migrar cuando se agregaron los
  // escalones —y está nombrado en la regla, que es lo que más duele—, así que este cartel
  // **ignoraba los descuentos por cantidad**.
  //
  // El fallo, con el comerciante enfrente: el cliente toca en la tablet un producto con escalón a
  // partir de 6 y pone 6. La tablet muestra $1.750 c/u, este cartel mostraba `6 × $1.850 = $11.100`,
  // el vendedor tocaba "Sumar 6" y el carrito —que sí usa `precioDe`— cobraba $10.500. Tres números
  // distintos para el mismo producto, y el del medio era el que la persona leía en voz alta.
  //
  // La cantidad importa: `precioPara` resuelve el escalón CONTRA `n`, no contra 1.
  const { precio, base, conDescuento } = precioPara(aviso, n)

  return (
    <div style={sx('position:fixed;left:12px;right:12px;bottom:calc(150px + env(safe-area-inset-bottom,0px));z-index:var(--z-aviso);pointer-events:none;display:flex;justify-content:center')}>
      <div className="lu-rise" style={{
        ...sx('width:100%;padding:12px;border-radius:16px;background:var(--surface);box-shadow:var(--shadow-lg)'),
        border: '1.5px solid var(--primary)',
        pointerEvents: 'auto',
      }}>
        <div style={sx('display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px')}>
          <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--primary)')}>
            El cliente está mirando{comercio?.name ? ` · ${comercio.name}` : ''}
          </div>
          <button onClick={onDescartar} aria-label="Descartar"
            style={sx('width:26px;height:26px;flex:none;display:grid;place-items:center;border:none;background:transparent;color:var(--faint);font-size:18px;cursor:pointer')}>×</button>
        </div>

        <div style={sx('display:flex;align-items:center;gap:11px')}>
          {aviso.imagen
            ? <img src={aviso.imagen} alt="" style={sx('width:52px;height:52px;flex:none;border-radius:12px;object-fit:cover;background:var(--surface2)')} />
            : <div style={sx('width:52px;height:52px;flex:none;border-radius:12px;background:var(--surface2)')} />}
          <div style={sx('flex:1;min-width:0')}>
            <div style={{ ...sx('font-size:13px;font-weight:500;line-height:1.3'), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{aviso.name}</div>
            <div style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px;font-weight:700;color:var(--deep);margin-top:2px')}>
              {n > 1 && <span style={sx('color:var(--muted);font-weight:600')}>{n} × </span>}
              {/* Con descuento se muestra tachado el de lista: es la misma señal que la grilla y la
                  tablet, y sin ella el número más bajo parece un error de precio. */}
              {conDescuento && <span style={sx('color:var(--faint);font-weight:500;text-decoration:line-through;margin-right:5px')}>{fmtPesos(base)}</span>}
              {fmtPesos(precio)}
              {n > 1 && <span style={sx('color:var(--muted);font-weight:600')}> = {fmtPesos(n * precio)}</span>}
            </div>
          </div>
        </div>

        <div style={sx('display:flex;gap:8px;margin-top:11px')}>
          <button className="lu-press" onClick={() => onSumar(aviso, n)} style={{ ...btnPrimario, flex: 1, minHeight: 44 }}>
            Sumar {n > 1 ? `${n} al carrito` : 'al carrito'}
          </button>
          <button className="lu-press" onClick={onDescartar} style={{ ...btnSecundario, minHeight: 44, padding: '0 16px' }}>Después</button>
        </div>
      </div>
    </div>
  )
}
