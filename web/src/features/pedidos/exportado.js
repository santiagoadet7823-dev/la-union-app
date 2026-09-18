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

/**
 * POR QUÉ UN PEDIDO VIVO TODAVÍA NO SALIÓ AL ERP: `'cliente'` (el comercio no tiene código),
 * `'vendedor'` (quien lo tomó no tiene código de vendedor) o `null` (va a salir en el próximo lote,
 * o ya salió). Espejo exacto de `pedido_exportable` en db/74, que es lo que la RPC del canal mira
 * para dejarlo afuera: si esto y aquello dijeran cosas distintas, la lista marcaría "retenido" un
 * pedido que sí salió, o al revés.
 *
 * 🔴 EXISTE POR EL LOTE 3 (18/09/2026): 19 pedidos salieron con vendedor `002` (ningún perfil tenía
 * código) y uno sin cliente. Desde db/74 esos pedidos no se mandan; esto es lo que hace visible que
 * quedaron esperando, y qué dato hay que cargar para que salgan (Usuarios → "Código ERP", o el
 * código del comercio en Clientes).
 *
 * @param {object} pedido  fila de la lista (`comercio.codigo`, `codigoVendedor`, `exportado_ts`, `estado`)
 * @returns {'cliente'|'vendedor'|null}
 */
export function motivoRetencion(pedido) {
  if (!pedido || pedido.exportado_ts || pedido.estado === 'Anulado') return null
  if (!String(pedido.comercio?.codigo || '').trim()) return 'cliente'
  if (!pedido.codigoVendedor) return 'vendedor'
  return null
}

export const TEXTO_RETENCION = {
  cliente: 'sin código de cliente',
  vendedor: 'sin código de vendedor',
}
