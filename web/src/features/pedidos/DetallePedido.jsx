import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import Overlay from '../../components/Overlay'
import usePerfilesEquipo from '../../hooks/usePerfilesEquipo'
import { asignarRepartidor } from '../repartidor/useEntregas'
import { anularPedido, borrarPedido } from './anularPedido'

/**
 * UN PEDIDO ABIERTO, con sus líneas y sus acciones.
 *
 * 🩸 VIVE EN SU PROPIO ARCHIVO porque lo abren DOS pantallas: la de gestión (`PedidosView`, para el
 * encargado y el admin) y la del vendedor (`MisPedidosSheet`). Es exactamente el caso de la regla
 * 31 — dos copias del mismo detalle divergen a la primera corrección, y la que se olvide de
 * arreglarse es la que va a mostrar mal un pedido anulado.
 *
 * Lo que cambia entre las dos NO es el detalle, es quién puede qué, y eso entra por props (`rol`)
 * y lo decide la base. Acá no hay una sola condición de permiso que no sea para **no ofrecer** un
 * botón que RLS va a rechazar.
 *
 * props: { detalle: {pedido, lineas} | null, rol, userId, onCerrar, onToast, onRecargar, onTicket, onEditar }
 */

/** Fecha + hora corta, en hora local. Compartida por las dos pantallas de pedidos. */
export function fmtFecha(ts) {
  const d = new Date(ts)
  return `${d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
}

export default function DetallePedido({ detalle, rol, userId, onCerrar, onToast, onRecargar, onTicket, onEditar }) {
  const [motivo, setMotivo] = useState('')
  const [confirmandoBorrado, setConfirmandoBorrado] = useState(false)
  const [trabajando, setTrabajando] = useState(false)
  // Sólo los repartidores del equipo. El hook ya trae vendedor/repartidor/encargado activos y con
  // el scope de empresa puesto, así que acá alcanza con quedarse con el rol que corresponde.
  // Devuelve el array directo, no un objeto: ojo al destructurar.
  const equipo = usePerfilesEquipo()
  const repartidores = (equipo || []).filter((u) => u.rol === 'repartidor')
  const [asignando, setAsignando] = useState(false)

  const pedido = detalle?.pedido || null
  const lineas = detalle?.lineas || []
  const anulado = pedido?.estado === 'Anulado'
  // Un pedido que todavía no subió no se puede anular contra la base: la fila no existe allá. Se
  // dice, en vez de ofrecer un botón que no haría nada.
  const sinSubir = !!pedido?.sinSubir
  // Los dos cerrojos del borrado son de `pedidos_del` (db/45); acá se repiten SOLO para no ofrecer
  // un botón que la base va a rechazar en silencio — un DELETE que RLS bloquea afecta cero filas y
  // vuelve con éxito, así que sin esto la pantalla diría "borrado" sobre algo que sigue ahí.
  const puedeBorrar = rol === 'superadmin' && anulado && !sinSubir
  // 🔑 LA VENTANA DE EDICIÓN (03/09/2026): sólo mientras el pedido sigue Pendiente. Cuando el
  // repartidor lo pasa a "En camino" se cierra — nadie corrige lo que ya salió a la calle. Acá se
  // repite la condición de `items_upd`/`items_del` (db/55) SOLO para no ofrecer un botón que la base
  // va a rechazar en silencio; el cerrojo de verdad está allá.
  // Un pedido sin subir tampoco: sus líneas todavía no existen en la base para editarlas.
  const puedeEditar = !!onEditar && !anulado && !sinSubir && pedido?.estado === 'Pendiente'

  // Al cambiar de pedido se limpia el formulario. Sin esto, el motivo tipeado para uno quedaría
  // cargado al abrir el siguiente y se anularía el equivocado con el texto del anterior.
  useEffect(() => { setMotivo(''); setConfirmandoBorrado(false) }, [pedido?.id])

  async function alAnular() {
    setTrabajando(true)
    try {
      await anularPedido(pedido, motivo, userId)
      onToast?.(`Pedido ${pedido.numero ? '#' + pedido.numero : ''} anulado`)
      onCerrar()
      onRecargar?.()
    } catch (e) {
      onToast?.('No se pudo anular: ' + (e?.message || 'sin conexión'))
    } finally { setTrabajando(false) }
  }

  /**
   * Le pone (o le saca) el repartidor al pedido. **Es el eslabón que faltaba en toda la app**: la
   * columna `id_repartidor` existe desde el día uno y no había una sola línea que la escribiera, así
   * que `RepartidorView` no podía tener nunca nada que mostrar.
   *
   * No hace falta migración: verificado contra la base viva, para un `admin` `ids_a_mi_cargo()` es
   * su empresa entera, así que el `USING` y el `WITH CHECK` de `pedidos_upd` se cumplen por
   * `id_vendedor` antes y después del cambio. Un `encargado` sólo puede asignar los pedidos de su
   * propia gente, que es exactamente lo que corresponde.
   */
  async function alAsignar(idRepartidor) {
    setAsignando(true)
    try {
      await asignarRepartidor(pedido, idRepartidor)
      const quien = repartidores.find((r) => r.id === idRepartidor)?.nombre
      onToast?.(idRepartidor ? `Asignado a ${quien || 'el repartidor'}` : 'Sin repartidor asignado')
      onRecargar?.()
    } catch (e) {
      onToast?.('No se pudo asignar: ' + (e?.message || 'sin conexión'))
    } finally { setAsignando(false) }
  }

  async function alBorrar() {
    setTrabajando(true)
    try {
      await borrarPedido(pedido)
      onToast?.('Pedido borrado definitivamente')
      onCerrar()
      onRecargar?.()
    } catch (e) {
      onToast?.('No se pudo borrar: ' + (e?.message || 'sin conexión'))
    } finally { setTrabajando(false) }
  }

  return (
    <Overlay
      open={!!detalle}
      onClose={onCerrar}
      variant="sheet"
      alto="medio"
      title={`Pedido ${pedido?.numero ? '#' + pedido.numero : ''}`}
      subtitle={pedido ? `${pedido.comercio?.name || 'Comercio'} · ${fmtPesos(pedido.monto_total)}` : ''}
      footer={
        pedido && (
          <div style={sx('display:flex;flex-direction:column;gap:9px;width:100%')}>
            {puedeEditar && (
              <button
                onClick={() => onEditar(detalle)}
                className="lu-press"
                style={sx('width:100%;min-height:46px;display:grid;place-items:center;border:1px solid var(--primary);border-radius:12px;background:transparent;color:var(--primary);font-size:13.5px;font-weight:600;cursor:pointer')}
              >Corregir el pedido</button>
            )}

            <button
              onClick={() => onTicket?.(detalle)}
              className="lu-press"
              style={sx('width:100%;min-height:46px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:12px;background:transparent;color:var(--text);font-size:13.5px;font-weight:600;cursor:pointer')}
            >Ver e imprimir el ticket</button>

            {!anulado && !sinSubir && (
              <>
                <input
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  placeholder="Por qué se anula (obligatorio)"
                  style={sx('width:100%;padding:11px 12px;border:1px solid var(--line2);border-radius:12px;background:var(--surface2);color:var(--text);font-size:13px')}
                />
                <button
                  onClick={alAnular}
                  disabled={!motivo.trim() || trabajando}
                  className="lu-press"
                  style={{
                    ...sx('width:100%;min-height:46px;display:grid;place-items:center;border:none;border-radius:12px;font-size:13.5px;font-weight:600'),
                    background: motivo.trim() && !trabajando ? 'var(--danger)' : 'var(--surface2)',
                    color: motivo.trim() && !trabajando ? '#fff' : 'var(--faint)',
                    cursor: motivo.trim() && !trabajando ? 'pointer' : 'default',
                  }}
                >Anular el pedido</button>
              </>
            )}

            {/* Borrar de verdad. Dos toques, y el segundo nombra el pedido: es la única acción de
                toda la app que destruye datos sin vuelta atrás. */}
            {puedeBorrar && (
              confirmandoBorrado ? (
                <div style={sx('display:flex;gap:8px')}>
                  <button
                    onClick={() => setConfirmandoBorrado(false)}
                    style={sx('flex:1;min-height:42px;border:1px solid var(--line2);border-radius:12px;background:transparent;color:var(--muted);font-size:13px;cursor:pointer')}
                  >Mejor no</button>
                  <button
                    onClick={alBorrar}
                    disabled={trabajando}
                    style={sx('flex:1;min-height:42px;border:none;border-radius:12px;background:var(--danger);color:#fff;font-size:13px;font-weight:600;cursor:pointer')}
                  >Borrar #{pedido.numero}</button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmandoBorrado(true)}
                  style={sx('width:100%;min-height:38px;display:grid;place-items:center;background:transparent;border:none;color:var(--muted);font-size:12px;cursor:pointer')}
                >Borrar definitivamente (no se puede deshacer)</button>
              )
            )}
          </div>
        )
      }
    >
      {pedido && (
        <div>
          {sinSubir && (
            <div style={sx('margin-bottom:12px;padding:10px 12px;border:1px solid var(--warning);border-radius:11px;font-size:12px;line-height:1.55;color:var(--text)')}>
              <b>Todavía no subió.</b> Está guardado en el teléfono y se manda solo cuando vuelva la
              señal. Hasta entonces no se puede anular ni imprimir con número.
            </div>
          )}

          {anulado && (
            <div style={sx('margin-bottom:12px;padding:10px 12px;border:1px solid var(--danger);border-radius:11px;font-size:12px;line-height:1.55;color:var(--text)')}>
              <b style={sx('color:var(--danger)')}>PEDIDO ANULADO.</b>{' '}
              {pedido.motivo_anulacion || 'Sin motivo registrado.'}
              {pedido.anulado_ts && (
                <div style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint);margin-top:4px')}>
                  {fmtFecha(pedido.anulado_ts)}
                </div>
              )}
              {/* Los pedidos anulados antes del 20/08/2026 no tienen firma, y la pantalla lo dice
                  en vez de dejar un renglón vacío que se lea como "no lo anuló nadie". */}
              {!pedido.anulado_por && (
                <div style={sx('font-size:10.5px;color:var(--faint);margin-top:3px')}>
                  Sin registro de quién lo anuló (anterior al 20/08/2026).
                </div>
              )}
            </div>
          )}

          <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.7;margin-bottom:10px')}>
            <div><b style={sx('color:var(--text)')}>{pedido.nombreVendedor || '—'}</b> · {fmtFecha(pedido.created_at)}</div>
            <div>{[pedido.comercio?.codigo, pedido.comercio?.loc].filter(Boolean).join(' · ') || 'Sin datos del comercio'}</div>
            <div>
              {pedido.origen === 'vidriera' ? 'Tomado con la tablet' : 'Tomado en el celular'}
              {/* La distancia informa; no acusa. El GPS de estos equipos miente hasta 30 m, y el
                  comercio puede no tener ubicación registrada — ahí no hay nada que medir. */}
              {pedido.distancia_m != null
                ? ` · a ${Math.round(pedido.distancia_m)} m del comercio`
                : ' · sin distancia de referencia'}
            </div>
          </div>

          {/* ── Reparto ───────────────────────────────────────────────────────────────────────
              No aparece en un pedido anulado: no se reparte lo que no se factura. */}
          {!anulado && (
            <div style={sx('margin-bottom:12px;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:var(--surface2)')}>
              <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:7px')}>Reparto</div>
              {repartidores.length === 0 ? (
                // Un selector vacío es peor que ningún selector: promete algo y no se puede usar.
                <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.5')}>
                  No hay ningún repartidor activo en el equipo. Se dan de alta desde <b>Usuarios</b>.
                </div>
              ) : (
                <>
                  <select
                    value={pedido.id_repartidor || ''}
                    disabled={asignando}
                    onChange={(e) => alAsignar(e.target.value || null)}
                    style={sx('width:100%;padding:10px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px')}
                  >
                    <option value="">Sin asignar</option>
                    {repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                  </select>
                  <div style={sx('margin-top:6px;font-size:11px;color:var(--faint);line-height:1.45')}>
                    Le aparece en su hoja de entregas del día y entra en su recorrido óptimo.
                  </div>
                </>
              )}
            </div>
          )}

          {lineas.map((l) => (
            <div key={l.id} style={sx('display:flex;align-items:center;gap:10px;padding:9px 0;border-top:1px solid var(--line)')}>
              <div style={sx('flex:1;min-width:0;font-size:12.5px;line-height:1.35')}>{l.descripcion}</div>
              <div style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:11.5px;color:var(--muted)')}>
                {l.cantidad} × {fmtPesos(l.precio_unitario)}
              </div>
              <div style={sx('flex:none;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:13px;font-weight:600;min-width:74px;text-align:right')}>
                {fmtPesos(l.cantidad * l.precio_unitario)}
              </div>
            </div>
          ))}

          {!lineas.length && (
            <div style={sx('padding:16px 0;color:var(--faint);font-size:12px')}>
              Este pedido no tiene líneas guardadas.
            </div>
          )}
        </div>
      )}
    </Overlay>
  )
}
