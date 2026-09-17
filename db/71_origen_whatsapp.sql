-- 71_origen_whatsapp.sql — el bot de ventas por WhatsApp como TERCER origen de un pedido (17/09/2026).
--
-- `pedidos.origen` distingue desde db/43 cómo se tomó el pedido: 'celular' (la app del vendedor) o
-- 'vidriera' (la tablet). El bot que va a vender por WhatsApp es un origen más, y es TODO lo que
-- el bot necesita de la base para que la app lo reconozca: la fila de `pedidos` es la misma de
-- siempre (líneas, exportación al ERP, ticket), sólo que con `origen = 'whatsapp'`.
--
-- El contrato completo con el bot está en DOCUMENTACION_FUNCIONAL.md ("Pedidos del bot"):
--   origen = 'whatsapp' · id_vendedor = clientes.id_vendedor del comercio (así el vendedor lo ve en
--   SU cartera y no va a visitar un comercio que ya compró) · id_visita = null · lat/lng = null.

alter table public.pedidos drop constraint if exists pedidos_origen_check;
alter table public.pedidos add constraint pedidos_origen_check
  check (origen is null or origen in ('celular', 'vidriera', 'whatsapp'));
