/**
 * LA PAPELERA DE PEDIDOS — cuánto le queda a lo anulado antes de que se vaya solo.
 *
 * 🩸 VIVE EN SU PROPIO ARCHIVO porque lo usan DOS pantallas: la de gestión (`PedidosView`) y la del
 * vendedor (`MisPedidosSheet`). Es el caso de la regla 31 — dos copias de la misma cuenta divergen a
 * la primera corrección, y acá "divergir" significa que una pantalla diga "quedan 3 días" y la otra
 * "quedan 4" sobre el mismo pedido.
 *
 * 🔴 LA CUENTA VA SOBRE `anulado_srv_ts`, NO SOBRE `anulado_ts`. No es un detalle: son dos relojes
 * distintos y sólo uno manda.
 *
 *  · `anulado_ts` lo escribe el TELÉFONO, y está bien que así sea (`anularPedido.js`): una anulación
 *    hecha sin señal sube horas después, y lo que importa mostrar es cuándo se DECIDIÓ.
 *  · `anulado_srv_ts` lo pone la base (`db/63`), y es el único que usa la purga.
 *
 * Si esta cuenta usara el del teléfono, la pantalla prometería una fecha que el servidor no va a
 * cumplir — un equipo con el reloj corrido mostraría "quedan 20 días" sobre algo que la purga se
 * lleva esta noche. La pantalla tiene que contar con el mismo reloj que borra.
 */

/** Días de gracia. Es el mismo número que el cron de `db/63` le pasa a `purgar_pedidos_anulados`. */
export const DIAS_PAPELERA = 30

const MS_POR_DIA = 24 * 60 * 60 * 1000

/**
 * Cuántos días le quedan al pedido en la papelera.
 *
 * Devuelve `null` —no un número— cuando no hay `anulado_srv_ts`. Pasa con los pedidos anulados antes
 * de `db/63` que todavía no recibieron el backfill, y con una anulación que está en la cola y aún no
 * llegó a la base. Un `null` se muestra como "sin fecha"; inventar un 30 ahí sería prometer un plazo
 * que nadie está contando.
 *
 * @param {object} pedido fila de `pedidos` (necesita `anulado_srv_ts`)
 * @returns {number|null} días restantes, nunca negativo
 */
export function diasQueQuedan(pedido) {
  const ts = pedido?.anulado_srv_ts
  if (!ts) return null
  const vence = new Date(ts).getTime() + DIAS_PAPELERA * MS_POR_DIA
  if (Number.isNaN(vence)) return null
  return Math.max(0, Math.ceil((vence - Date.now()) / MS_POR_DIA))
}

/**
 * El renglón que se le muestra a la persona.
 *
 * Se redacta acá y no en cada pantalla para que las dos digan exactamente lo mismo. "Se elimina hoy"
 * en vez de "quedan 0 días": el cero se lee como "ya pasó" y todavía no pasó — el cron corre a las
 * 03:40 (`db/63`).
 */
export function textoPapelera(pedido) {
  const dias = diasQueQuedan(pedido)
  if (dias === null) return 'Sin fecha de eliminación'
  if (dias === 0) return 'Se elimina hoy'
  if (dias === 1) return 'Se elimina mañana'
  return `Se elimina en ${dias} días`
}

/** `true` cuando queda una semana o menos: la pantalla lo pinta de otro color. */
export function porVencer(pedido) {
  const dias = diasQueQuedan(pedido)
  return dias !== null && dias <= 7
}
