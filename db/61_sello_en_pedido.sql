-- =============================================================================
--  db/61 — CON QUE PRECIOS SE TOMO ESTE PEDIDO (10/09/2026)
--
--  QUE RESUELVE
--  Pedido del cliente, textual: "agregar al ticket el horario de actualizacion
--  de precios que esta trabajando, porque si lo esta trabajando offline hay que
--  poder identificar hace cuanto tiempo actualizo el catalogo para que sepan si
--  hubo un error".
--
--  El caso real es el vendedor que perdio senal a la manana y siguio tomando
--  pedidos toda la tarde con el catalogo que tenia bajado. Los precios que le
--  dijo al comerciante eran los de ayer, y hoy no hay forma de saberlo mirando
--  el pedido: la fila no guarda ningun rastro de que lista de precios se uso.
--
--  🔑 POR QUE SON DOS COLUMNAS Y NO UNA. Son dos preguntas distintas:
--
--    · `sello_precios_ts` — cuando el ERP cambio la lista por ultima vez. Sale
--      de la RPC `sello_precios()` (db/53), que es `max(ts)` de
--      `ingestas_precios` SOLO de las ingestas que movieron algo. El emisor
--      manda una vez por hora aunque el archivo sea identico, asi que el
--      `max(ts)` a secas diria siempre "hace 20 minutos" y no serviria de nada.
--
--    · `catalogo_ts` — cuando ESTE telefono bajo el catalogo. Es el dato que de
--      verdad contesta la pregunta del cliente. Un telefono offline puede tener
--      una lista de anteayer mientras el servidor actualizo hace una hora, y esa
--      DISTANCIA entre las dos fechas es la senal. Con una sola no se ve.
--
--  🩸 SE CONGELAN EN LA FILA, NO SE CONSULTAN AL IMPRIMIR. Es la misma
--  disciplina que ya rige `precio_unitario` y `descripcion` en `pedido_items`
--  (se copian al confirmar) y `created_at` en la cabecera (lo estampa el
--  telefono, no `now()`). Los tickets se REIMPRIMEN despues desde "Mis pedidos"
--  y desde gestion: una consulta en vivo pondria la fecha de precios de HOY en
--  un ticket de la semana pasada, que es exactamente lo contrario de lo que se
--  pidio. Un comprobante dice lo que valia cuando se emitio.
--
--  ⚠️ NULLABLES, Y NO SE RELLENAN HACIA ATRAS. Los pedidos anteriores a esta
--  migracion no tienen el dato y no hay de donde sacarlo: inventarlo con la
--  fecha de importacion mas cercana seria escribir en un comprobante un numero
--  que nadie midio. El ticket simplemente no dibuja el bloque cuando faltan.
--  Los telefonos con un bundle viejo tampoco las mandan, y tienen que poder
--  seguir insertando pedidos sin error: por eso nullables y sin default.
--
--  🔴 ESTA MIGRACION VA ANTES QUE LA OTA QUE LAS ESCRIBE. Si el bundle nuevo
--  llegara primero, el insert fallaria con 42703 (columna inexistente) — un
--  codigo que NO esta en CODIGOS_PERMANENTES de services/sync/writeQueue.js, o
--  sea que la cola hace `break` y reintenta para siempre. No se perderia ningun
--  pedido, pero se taparia la cola entera de escrituras detras del primero.
--
--  RLS: no se toca. Las policies de `pedidos` (db/45, db/55) son por fila, no
--  por columna; dos columnas nuevas quedan cubiertas por lo que ya existe.
-- =============================================================================

alter table public.pedidos
  add column if not exists sello_precios_ts timestamptz,
  add column if not exists catalogo_ts      timestamptz;

comment on column public.pedidos.sello_precios_ts is
  'Cuando el ERP cambio la lista de precios por ultima vez, segun sello_precios() (db/53), '
  'al momento de tomar este pedido. Congelado: no se recalcula al reimprimir el ticket.';

comment on column public.pedidos.catalogo_ts is
  'Cuando el telefono que tomo este pedido bajo el catalogo por ultima vez. La distancia '
  'contra sello_precios_ts delata a un vendedor que trabajo offline con precios viejos.';
