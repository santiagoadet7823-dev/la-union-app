import { enqueueMutacion, flushMutaciones } from '../../services/sync/writeQueue'
import { frenarSiExportado } from './exportado'

/**
 * ANULAR Y BORRAR UN PEDIDO.
 *
 * Las dos acciones viven acá y no adentro de la pantalla por la regla §7: nada de
 * `supabase.from().update()` desde un componente. Todo lo que escribe pasa por la cola, que es lo
 * que hace que un encargado sin señal en el depósito no pierda la anulación que acaba de hacer.
 *
 * 🩸 ANULAR ≠ BORRAR, Y LA DIFERENCIA ES DELIBERADA (decisión del dueño, 20/08/2026):
 *
 *  · **Anular** deja el pedido donde está, con el motivo y la firma de quién lo hizo. No suma a las
 *    ventas ni a los reportes, pero se puede ver, contar y reimprimir. Es lo que hacen el vendedor,
 *    el encargado y el admin.
 *  · **Borrar** destruye la fila y sus líneas. Solo el superadmin, y solo sobre algo YA anulado —
 *    los dos cerrojos están en `pedidos_del` (`db/45`), no acá: una guarda que solo viva en el
 *    cliente no es una guarda, es un cartel.
 *
 * Por qué importa la asimetría: un pedido borrado no se distingue de uno que nunca existió. Si
 * cualquiera pudiera borrar, "vendí poco esta semana" y "borré lo que no me convenía" serían la
 * misma fila vacía. Con la anulación, el rastro queda y `anulado_por` contesta quién.
 */

/**
 * Marca el pedido como anulado.
 *
 * `motivo` es obligatorio del lado de la pantalla (el botón no se habilita sin él) y no acá: la
 * validación va donde está la persona, para poder decirle qué falta en vez de fallar en silencio.
 *
 * @param {object} pedido  la fila que se está mirando (necesita `id`)
 * @param {string} motivo  por qué se anula
 * @param {string} userId  quién lo anula — va a `anulado_por`
 */
export async function anularPedido(pedido, motivo, userId) {
  // Un pedido que ya salió a facturación no se anula desde acá: el archivo del ERP no tiene cómo
  // comunicar una anulación, así que quedaría anulado de este lado y facturado del otro. Ver
  // `exportado.js` — y ojo, la guarda va antes de encolar, no después.
  frenarSiExportado(pedido)

  const payload = {
    estado: 'Anulado',
    motivo_anulacion: String(motivo || '').trim().slice(0, 300),
    anulado_por: userId || null,
    // La hora la pone el cliente y no `now()` de la base: la anulación puede subir horas después si
    // quien la hizo estaba sin señal, y lo que interesa es CUÁNDO se decidió, no cuándo llegó.
    anulado_ts: new Date().toISOString(),
  }
  // `op_uid` con el id del pedido y el verbo: si alguien toca dos veces, la cola guarda dos
  // entradas idénticas y la segunda es un no-op (el update deja la fila igual). Lo que no puede
  // pasar es que una anulación pise una anulación de otro con distinto motivo, y por eso el uid
  // lleva también el timestamp.
  await enqueueMutacion({
    op_uid: `${pedido.id}:anular:${payload.anulado_ts}`,
    table: 'pedidos',
    op: 'update',
    id: pedido.id,
    payload,
    verificar: true, // cero filas afectadas = cuarentena, no "listo" (ver borrarPedido)
  })
  flushMutaciones()
  // Se devuelve la fila como queda: la pantalla la APLICA a su lista (usePedidos.aplicar) y no relee.
  return { ...pedido, ...payload }
}

/**
 * Borra el pedido definitivamente. Las líneas se van solas: la FK de `pedido_items` es
 * `on delete cascade` (verificado en la base viva), y un borrado en cascada no pasa por la RLS de
 * la tabla hija — por eso no hace falta encolar nada para ellas.
 *
 * 🔴 UNA OPERACIÓN QUE RLS RECHAZA **NO DA ERROR**: `delete().eq('id', …)` sobre una fila que la
 * policy esconde afecta cero filas y vuelve con éxito. Lo mismo pasa con el `update` de anular. O
 * sea que la cola no se enteraba, no reintentaba, y la pantalla mostraría "listo" sobre algo que no
 * pasó. Hasta el 13/09/2026 la defensa era una RELECTURA completa de las dos listas después de cada
 * acción (dos consultas paginadas, spinner, y sin red la lista quedaba VACÍA con la mutación todavía
 * en cola). Ahora la verificación vive en la cola: `verificar: true` hace que el request pida las
 * filas afectadas y que cero vaya a cuarentena (`SIN_FILAS`, ver writeQueue.js), donde
 * `AvisoCuarentena` lo muestra. La pantalla aplica el resultado local y no relee.
 */
export async function borrarPedido(pedido) {
  await enqueueMutacion({
    op_uid: `${pedido.id}:borrar`,
    table: 'pedidos',
    op: 'delete',
    id: pedido.id,
    verificar: true,
  })
  flushMutaciones()
}
