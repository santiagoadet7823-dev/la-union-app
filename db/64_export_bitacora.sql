-- 64_export_bitacora.sql — El lote y su registro nacen juntos.
-- 11/09/2026.
--
-- 🩸 EL SÍNTOMA: `exportaciones_pedidos` VACÍA, con 20 pedidos marcados como exportados.
--
-- Medido el 11/09/2026 sobre la base viva: cero filas en la bitácora, veinte pedidos con
-- `exportado_ts` puesto, y cuatro `duplicate key value violates unique constraint
-- "exportaciones_pedidos_lote_uidx"` en los logs de Postgres. O sea: el sistema marcaba pedidos
-- como facturados y no dejaba constancia de haberlo hecho.
--
-- Importa más de lo que parece porque `exportado_ts` es lo que CONGELA un pedido: no se puede
-- corregir ni anular. Un pedido congelado por una exportación que no figura en ningún lado es un
-- pedido que nadie puede tocar y sobre el que nadie puede explicar por qué.
--
-- SON DOS BUGS, Y SE TAPABAN ENTRE ELLOS:
--
--  1. **La reposición insertaba un lote repetido.** Bajar de nuevo un lote ya emitido
--     (`?repetir=1` o `?lote=N`, el caso "el archivo se me perdió") terminaba igual que una bajada
--     normal, en el `registrar({ lote, … })` del final. Insertar otra fila con el mismo
--     `(id_empresa, lote)` choca contra el índice único. Esos son los cuatro duplicados.
--  2. **Nadie miraba si el insert había fallado.** `registrar()` envuelve el insert en un
--     `try/catch`, pero `supabase-js` NO LANZA: devuelve `{ error }`. El catch no se ejecuta nunca y
--     el error se descartaba en silencio. Es exactamente el bug que el comentario de esa misma
--     función dice estar evitando ("un pedido rechazado también deja fila… 'cero errores
--     registrados' se leía como 'está todo bien'").
--
-- 🔴 Y ADEMÁS SE REALIMENTABA. `tomar_lote_pedidos` calcula el próximo lote con
-- `max(lote) + 1 from exportaciones_pedidos`. Con la bitácora vacía eso da **1, siempre**. Así que
-- cada bajada nueva reservaba otra vez el lote 1, volvía a chocar contra el índice único, no
-- registraba nada, y dejaba la tabla vacía para que la siguiente repitiera el ciclo — mientras los
-- pedidos SÍ se marcaban, porque eso pasa dentro de la RPC y esa parte funcionaba.
--
-- EL ARREGLO: la fila de bitácora se crea **dentro de la misma transacción** que marca los pedidos,
-- en la propia RPC. O hay lote y hay registro, o no hay ninguno de los dos — el cursor de
-- exportación y su rastro dejan de poder separarse. La Edge Function pasa a COMPLETAR esa fila
-- (bytes, filas, ip, agente) con un update, y a registrar la reposición como un evento aparte con
-- `lote = null`, que el índice único no alcanza (es `where lote is not null`).

create or replace function public.tomar_lote_pedidos(
  p_empresa uuid,
  p_usuario uuid default null,
  p_marcar  boolean default true
)
returns table (id_pedido uuid, lote bigint)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lote bigint;
begin
  perform set_config('distat.export_bypass', 'on', true);
  perform pg_advisory_xact_lock(hashtext('export_pedidos:' || p_empresa::text));

  select coalesce(max(e.lote), 0) + 1 into v_lote
    from public.exportaciones_pedidos e
   where e.id_empresa = p_empresa;

  -- Modo prueba: mira qué saldría, no marca ni reserva número. Sin bitácora, porque no pasó nada.
  if not p_marcar then
    return query
      select p.id, v_lote from public.pedidos p
       where p.id_empresa = p_empresa and p.exportado_ts is null
         and p.estado <> 'Anulado'
         and exists (select 1 from public.pedido_items i where i.id_pedido = p.id)
       order by p.created_at;
    return;
  end if;

  return query
    with tomados as (
      update public.pedidos p
         set exportado_ts = now(), export_lote = v_lote
       where p.id_empresa = p_empresa and p.exportado_ts is null
         and p.estado <> 'Anulado'
         and exists (select 1 from public.pedido_items i where i.id_pedido = p.id)
      returning p.id, p.created_at
    ),
    -- 🔑 ACÁ NACE EL REGISTRO, pegado al UPDATE de arriba. Es un CTE que escribe, así que Postgres
    -- lo ejecuta aunque nadie lea su resultado. El `having count(*) > 0` evita la fila fantasma
    -- cuando no había nada para tomar: un lote reservado sobre cero pedidos rompería la numeración
    -- para siempre (el `max(lote) + 1` de la próxima vuelta lo contaría igual).
    registro as (
      insert into public.exportaciones_pedidos (id_empresa, id_usuario, lote, pedidos, ids, origen)
      select p_empresa, p_usuario, v_lote, count(*)::int, array_agg(t.id), 'endpoint'
        from tomados t
      having count(*) > 0
    )
    select t.id, v_lote from tomados t order by t.created_at;
end
$fn$;

revoke execute on function public.tomar_lote_pedidos(uuid, uuid, boolean) from public;
revoke execute on function public.tomar_lote_pedidos(uuid, uuid, boolean) from anon;
revoke execute on function public.tomar_lote_pedidos(uuid, uuid, boolean) from authenticated;
grant  execute on function public.tomar_lote_pedidos(uuid, uuid, boolean) to service_role;


-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--   -- después de la próxima bajada real: tiene que haber UNA fila por lote, y los ids adentro
--   select lote, pedidos, array_length(ids, 1) as n_ids, origen, error, ts
--     from public.exportaciones_pedidos order by ts desc;
--
--   -- ningún pedido marcado sin su lote en la bitácora (0 filas)
--   select p.numero, p.export_lote
--     from public.pedidos p
--    where p.export_lote is not null
--      and not exists (select 1 from public.exportaciones_pedidos e
--                       where e.id_empresa = p.id_empresa and e.lote = p.export_lote);
