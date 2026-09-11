/**
 * UN PEDIDO YA ENVIADO A FACTURACIÓN NO SE REESCRIBE.
 *
 * 🩸 POR QUÉ (10/09/2026, db/62). Desde que existe el canal hacia el ERP, un pedido puede estar ya
 * facturándose del otro lado. Editarlo o anularlo acá no le avisa a nadie: el archivo de 25 campos
 * no tiene ningún campo para comunicar una corrección ni una anulación, así que los dos sistemas
 * quedarían diciendo cosas distintas sin que nada falle. La corrección se hace en el sistema de
 * gestión, que es donde está la factura.
 *
 * 🔴 POR QUÉ LA GUARDA ESTÁ ACÁ Y NO SÓLO EN LA BASE. La base también lo impide —hay un trigger en
 * db/62 que congela lo facturado—, pero eso NO alcanza: las escrituras de esta app van por la write
 * queue, **que es FIFO y corta al primer fallo**. Una edición que la base rechaza no se pierde sola:
 * tapona la cola y se lleva puesto todo lo que venga detrás, incluidos los pedidos nuevos de un
 * vendedor que está en la calle. El trigger es la red de seguridad; el que no deja encolar es éste.
 *
 * Lo que el repartidor hace DESPUÉS de facturar —marcar en camino, confirmar la entrega, anotar un
 * faltante— sigue permitido y no pasa por acá: el reparto ocurre después de la facturación, no antes.
 */

export const MSG_EXPORTADO =
  'Este pedido ya se envió a facturación. La corrección se hace en el sistema de gestión.'

/** @param {object} pedido fila de `pedidos` (necesita `exportado_ts`) */
export function yaExportado(pedido) {
  return !!pedido?.exportado_ts
}

/** Lanza con el mensaje que la pantalla puede mostrar tal cual. */
export function frenarSiExportado(pedido) {
  if (yaExportado(pedido)) throw new Error(MSG_EXPORTADO)
}
