import { useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import Overlay from '../../components/Overlay'

/**
 * ¿TICKET NUEVO O CORRIJO EL QUE YA HICE?
 *
 * 🩸 POR QUÉ (04/09/2026, corrección del vendedor sobre 1.24.0). La edición de pedidos salió, pero
 * el único camino para llegar a ella era el menú de cuenta → "Mis pedidos" → abrir → Corregir.
 * O sea: cuatro toques y una pantalla que no es la del trabajo. El vendedor lo dijo en el momento
 * exacto en que importa — **está parado en el comercio** y el comerciante le agrega dos cajones.
 *
 * Y había un agujero peor del lado de `InicioTab`: una vez que el cliente pasaba a "Visitado", su
 * botón de check-in **se convertía en un pill inerte**. No existía forma de volver a entrar a ese
 * comercio en el resto de la jornada.
 *
 * Esta hoja aparece **sólo cuando hay algo que decidir**: si el comercio no tiene un pedido
 * Pendiente, el check-in sigue siendo un toque y esto no se ve nunca. Un diálogo que pregunta
 * cuando hay una sola respuesta posible es un toque de más, todos los días.
 *
 * 🔴 LA VENTANA LA DECIDE `estado === 'Pendiente'`, y acá se repite SOLO para no ofrecer un botón
 * que la base va a rechazar. El cerrojo de verdad son `items_upd` / `items_del` (db/55): una guarda
 * que sólo vive en el cliente es un cartel, no una guarda.
 *
 * props: { comercio, ultimoPedido, onNuevo, onEditar, onCerrar }
 */

/** "hace 20 min" / "hace 3 h" / "ayer" — cuánto hace que se tomó ese pedido. */
function haceCuanto(ts) {
  const ms = Date.now() - new Date(ts).getTime()
  const min = Math.round(ms / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  return d === 1 ? 'ayer' : `hace ${d} días`
}

export default function ElegirTicketSheet({ comercio, ultimoPedido, onNuevo, onEditar, onCerrar }) {
  // El estado de "abierto" vive ADENTRO para que la animación de salida tenga tiempo de correr: si
  // el padre desmontara con `{cond && <Overlay/>}`, el sheet desaparecería de golpe (§7).
  const [abierto, setAbierto] = useState(true)
  const cerrar = () => setAbierto(false)

  const editable = ultimoPedido?.estado === 'Pendiente'
  const unidades = (ultimoPedido?.lineas || []).reduce((a, l) => a + (l.cantidad || 0), 0)

  return (
    <Overlay
      open={abierto}
      onClose={onCerrar}
      variant="modal"
      // `modal` y no `sheet`, por el mismo motivo que `SinPedidoSheet`: una hoja inferior queda
      // tapada por la botonera del vendedor.
      contained
      title={comercio?.name || 'Comercio'}
      subtitle="Ya hay un pedido de este comercio"
    >
      <div style={sx('display:flex;flex-direction:column;gap:9px')}>
        {/* El pedido que ya existe, con lo justo para reconocerlo: número, cuándo y cuánto. */}
        <div style={sx('padding:11px 12px;border:1px solid var(--line2);border-radius:12px;background:var(--surface2)')}>
          <div style={sx('display:flex;align-items:baseline;justify-content:space-between;gap:8px')}>
            <span style={sx('font-family:var(--font-mono);font-size:12.5px;font-weight:700')}>
              {ultimoPedido?.numero ? `#${ultimoPedido.numero}` : 'Sin número todavía'}
            </span>
            <span style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:15px;font-weight:700')}>
              {fmtPesos(ultimoPedido?.monto_total)}
            </span>
          </div>
          <div style={sx('font-size:11px;color:var(--muted);margin-top:3px')}>
            {unidades} u · {haceCuanto(ultimoPedido?.created_at)}
            {ultimoPedido?.estado && ultimoPedido.estado !== 'Pendiente' ? ` · ${ultimoPedido.estado}` : ''}
          </div>
        </div>

        {editable ? (
          <button
            onClick={() => { cerrar(); onEditar() }}
            className="lu-press"
            style={sx('width:100%;min-height:50px;display:grid;place-items:center;border:1px solid var(--primary);border-radius:12px;background:var(--primary-tint);color:var(--deep);font-size:14px;font-weight:700;cursor:pointer')}
          >
            Corregir ese pedido
          </button>
        ) : (
          /* Ya salió a la calle: se dice por qué no se puede tocar, en vez de esconder la opción y
             que parezca que la app se olvidó del pedido. */
          <div style={sx('padding:10px 12px;border:1px solid var(--line2);border-radius:11px;font-size:11.5px;color:var(--muted);line-height:1.55')}>
            Este pedido ya está <b style={sx('color:var(--text)')}>{ultimoPedido?.estado}</b>, así que
            no se puede corregir. Lo que le agregue el comerciante ahora va en un ticket nuevo.
          </div>
        )}

        <button
          onClick={() => { cerrar(); onNuevo() }}
          className="lu-press"
          style={{
            ...sx('width:100%;min-height:50px;display:grid;place-items:center;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;border:none'),
            background: editable ? 'transparent' : 'var(--primary)',
            color: editable ? 'var(--text)' : 'var(--on-primary)',
            border: editable ? '1px solid var(--line2)' : 'none',
          }}
        >
          Abrir un ticket nuevo
        </button>
      </div>
    </Overlay>
  )
}
