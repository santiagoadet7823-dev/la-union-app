-- 93_clientes_lote_json.sql — el lote de clientes viaja ENTERO a `export-clientes` (25/10/2026, plan 24).
--
-- 🩸 POR QUÉ. PostgREST corta en `max-rows` (1000, `PGRST_DB_MAX_ROWS`) las filas que devuelve una
-- RPC `returns table`. `tomar_lote_clientes` (db/92) MARCA todo el lote adentro de la función y
-- después PostgREST entrega sólo las primeras 1000 filas: con el primer lote (la cartera completa,
-- 2029 ALTA) quedaban 1029 clientes marcados como enviados que el ERP nunca recibía. Lo vio el
-- `?probar=1` del 25/10 (X-Clientes: 1000) antes del primer envío real; `probar` no marca nada.
--
-- Arreglo: dos envoltorios que devuelven el lote como UN `jsonb` (un valor escalar no pasa por
-- `max-rows`), en el mismo orden de la RPC original (`with ordinality`). La lógica sigue en db/92.
-- `export-clientes` llama a estos; las originales quedan para SQL directo.

begin;

create or replace function public.tomar_lote_clientes_json(p_empresa uuid, p_usuario uuid, p_marcar boolean default true)
returns jsonb
language sql
volatile
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id_cliente', t.id_cliente, 'id_baja', t.id_baja, 'tipo', t.tipo, 'lote', t.lote) order by t.n), '[]'::jsonb)
    from public.tomar_lote_clientes(p_empresa, p_usuario, p_marcar) with ordinality as t(id_cliente, id_baja, tipo, lote, n);
$$;
revoke execute on function public.tomar_lote_clientes_json(uuid, uuid, boolean) from public, anon, authenticated;
grant  execute on function public.tomar_lote_clientes_json(uuid, uuid, boolean) to service_role;

create or replace function public.repetir_lote_clientes_json(p_empresa uuid, p_lote bigint default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id_cliente', t.id_cliente, 'id_baja', t.id_baja, 'tipo', t.tipo, 'lote', t.lote) order by t.n), '[]'::jsonb)
    from public.repetir_lote_clientes(p_empresa, p_lote) with ordinality as t(id_cliente, id_baja, tipo, lote, n);
$$;
revoke execute on function public.repetir_lote_clientes_json(uuid, bigint) from public, anon, authenticated;
grant  execute on function public.repetir_lote_clientes_json(uuid, bigint) to service_role;

notify pgrst, 'reload schema';

commit;

-- VERIFICACIÓN (sin marcar nada):
--   select jsonb_array_length(public.tomar_lote_clientes_json('<id_empresa>', null, false));
