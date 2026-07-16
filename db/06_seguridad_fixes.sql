-- ============================================================
-- LA UNIÓN — Fixes de seguridad (endurecimiento RLS + storage + RPCs)
-- Fecha: 16/07/2026
--
-- Migración idempotente y reversible. Cierra agujeros detectados en la
-- auditoría sin romper el funcionamiento normal:
--   1) pedidos_upd sin WITH CHECK → permitía reasignar id_empresa a otro tenant.
--   2) items_wr con WITH CHECK débil (solo validaba tenant) → se iguala al USING.
--   3) bucket 'firmas' público + firmas_sel amplio → se hace privado.
--   4) tabla ubicaciones_live huérfana con acceso anon → se elimina.
--   5) RPCs peligrosas ejecutables por anon → se revoca execute.
--
-- La base viva de Supabase ya está endurecida; este archivo versiona esos
-- cambios en el repo. Al final hay un bloque ROLLBACK documentado (NO se
-- ejecuta, es solo referencia para revertir).
-- ============================================================

-- 1) pedidos_upd: agregar WITH CHECK (hoy es null → permite reasignar id_empresa a otro tenant)
drop policy if exists pedidos_upd on public.pedidos;
create policy pedidos_upd on public.pedidos for update
  using (public.es_superadmin() or ((id_empresa = public.mi_empresa())
    and ((public.mi_rol() = any (array['admin','encargado'])) or (id_vendedor = auth.uid()) or (id_repartidor = auth.uid()))))
  with check (public.es_superadmin() or ((id_empresa = public.mi_empresa())
    and ((public.mi_rol() = any (array['admin','encargado'])) or (id_vendedor = auth.uid()) or (id_repartidor = auth.uid()))));

-- 2) pedido_items: endurecer WITH CHECK para igualar el USING (hoy el check solo valida tenant)
drop policy if exists items_wr on public.pedido_items;
create policy items_wr on public.pedido_items for all
  using (exists (select 1 from public.pedidos p where p.id = pedido_items.id_pedido
    and (public.es_superadmin() or ((p.id_empresa = public.mi_empresa())
      and ((public.mi_rol() = any (array['admin','encargado'])) or (p.id_vendedor = auth.uid()) or (p.id_repartidor = auth.uid()))))))
  with check (exists (select 1 from public.pedidos p where p.id = pedido_items.id_pedido
    and (public.es_superadmin() or ((p.id_empresa = public.mi_empresa())
      and ((public.mi_rol() = any (array['admin','encargado'])) or (p.id_vendedor = auth.uid()) or (p.id_repartidor = auth.uid()))))));

-- 3) firmas: quitar el SELECT amplio público (permite listar todo el bucket) y hacerlo privado
drop policy if exists firmas_sel on storage.objects;
update storage.buckets set public = false where id = 'firmas';
-- (firmas_ins para authenticated queda intacta)

-- 4) ubicaciones_live: tabla vacía, huérfana (no la usa el código), con INSERT/UPDATE/SELECT abiertos a anon
drop table if exists public.ubicaciones_live;

-- 5) RPCs peligrosas ejecutables por anon: cualquiera podía disparar la purga de posiciones
--    vía POST /rest/v1/rpc/limpiar_posiciones_viejas sin autenticarse.
--
--    OJO: hay que revocar de PUBLIC, no de anon/authenticated. Postgres concede EXECUTE a PUBLIC
--    por defecto al crear una función (acl "=X/postgres"); anon y authenticated lo heredan de ahí.
--    Un `revoke ... from anon, authenticated` es un NO-OP porque nunca hubo un grant directo a
--    esos roles. Verificado con has_function_privilege() el 16/07/2026.
--
--    postgres y service_role conservan su grant explícito, así que pg_cron (que corre como
--    postgres) sigue ejecutando la purga programada de las 03:30.
revoke execute on function public.limpiar_posiciones_viejas() from public;

--    handle_new_user es una función de trigger: el privilegio EXECUTE se chequea en el
--    CREATE TRIGGER, no en cada disparo. El trigger on_auth_user_created sobre auth.users sigue
--    activo (verificado: tgenabled='O') y el alta de usuarios nuevos no se ve afectada.
revoke execute on function public.handle_new_user() from public;

-- NO tocar mi_empresa/mi_rol/es_admin/es_superadmin: las políticas RLS los invocan como el rol que
-- consulta, así que revocarles EXECUTE rompería TODAS las lecturas protegidas por RLS. El linter de
-- Supabase los marca igual, pero la exposición es nula: operan sobre auth.uid(), que para anon es null.

-- ============================================================
-- ROLLBACK (documentación — NO ejecutar)
--
-- 1) pedidos_upd: volver a la política vieja SIN with check (permisiva en update):
--    drop policy if exists pedidos_upd on public.pedidos;
--    create policy pedidos_upd on public.pedidos for update using (
--      public.es_superadmin() or (id_empresa = public.mi_empresa()
--        and (public.mi_rol() in ('admin','encargado') or id_vendedor = auth.uid() or id_repartidor = auth.uid()))
--    );
--
-- 2) items_wr: volver al WITH CHECK débil (solo tenant):
--    drop policy if exists items_wr on public.pedido_items;
--    create policy items_wr on public.pedido_items for all using (
--      exists (select 1 from public.pedidos p where p.id = id_pedido and (
--        public.es_superadmin() or (p.id_empresa = public.mi_empresa()
--          and (public.mi_rol() in ('admin','encargado') or p.id_vendedor = auth.uid() or p.id_repartidor = auth.uid()))))
--    ) with check (
--      exists (select 1 from public.pedidos p where p.id = id_pedido and (public.es_superadmin() or p.id_empresa = public.mi_empresa()))
--    );
--
-- 3) firmas: volver el bucket a público y recrear el SELECT amplio:
--    update storage.buckets set public = true where id = 'firmas';
--    create policy firmas_sel on storage.objects for select using (bucket_id = 'firmas');
--
-- 4) ubicaciones_live: recrear la tabla (estaba vacía y huérfana; solo si algo la
--    necesitara de nuevo — NO recrear los grants abiertos a anon):
--    create table if not exists public.ubicaciones_live (
--      id_usuario uuid primary key,
--      lat double precision,
--      lng double precision,
--      ts timestamptz default now()
--    );
--
-- 5) RPCs: volver a otorgar execute a PUBLIC (reabre el agujero — NO recomendado):
--    grant execute on function public.limpiar_posiciones_viejas() to public;
--    grant execute on function public.handle_new_user() to public;
-- ============================================================
