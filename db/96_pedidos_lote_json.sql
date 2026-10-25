-- 96_pedidos_lote_json.sql — el lote de pedidos viaja ENTERO a `export-pedidos` (25/10/2026).
--
-- 🩸 POR QUÉ. Lo mismo que db/93 con los clientes: PostgREST corta en `max-rows` (1000) las filas de
-- una RPC `returns table`, y `tomar_lote_pedidos` (db/62/64/74) MARCA todo el lote adentro. Con más de
-- 1000 pedidos juntos (la PC del ERP apagada varios días) los que pasaban del 1000 quedaban marcados
-- como exportados sin llegar nunca al ERP. El lote más grande hasta hoy fue de 76: no pasó, pero
-- podía pasar.
--
-- Arreglo: envoltorio que devuelve el lote como UN `jsonb`, en el mismo orden (`with ordinality`).
-- La lógica sigue en `tomar_lote_pedidos`; `export-pedidos` llama a éste.

begin;

create or replace function public.tomar_lote_pedidos_json(p_empresa uuid, p_usuario uuid default null, p_marcar boolean default true)
returns jsonb
language sql
volatile
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id_pedido', t.id_pedido, 'lote', t.lote) order by t.n), '[]'::jsonb)
    from public.tomar_lote_pedidos(p_empresa, p_usuario, p_marcar) with ordinality as t(id_pedido, lote, n);
$$;
revoke execute on function public.tomar_lote_pedidos_json(uuid, uuid, boolean) from public, anon, authenticated;
grant  execute on function public.tomar_lote_pedidos_json(uuid, uuid, boolean) to service_role;

notify pgrst, 'reload schema';

commit;

-- VERIFICACIÓN (sin marcar nada):
--   select jsonb_array_length(public.tomar_lote_pedidos_json('<id_empresa>', null, false));
