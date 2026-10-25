-- 94_productos_cambios.sql — historial de cambios del catálogo (25/10/2026, plan 23 fase B).
--
-- 🩸 POR QUÉ. Hasta hoy, si un precio cambiaba no quedaba rastro de cuándo, de cuánto a cuánto ni por
-- dónde entró: el archivo de precios de la hora (`ingest-precios` → `importar_precios`, db/49/54), la
-- planilla o la edición a mano en la app pisan la misma fila. Desde db/90 se guarda el ARCHIVO; esto
-- guarda el EFECTO, campo por campo. Es lo que va a leer `ia_cambios_catalogo` (fase C).
--
-- Un trigger en `productos` cubre las tres vías sin tocar `importar_precios`, que ya hace UPDATE sólo
-- de las filas que cambian. Se anotan sólo los campos que importan para vender:
--   precio_unitario, precio_oferta, oferta, escalas, descripcion, categoria, habilitado
-- (`habilitado` = `descontinuado_ts is null`). Un alta deja una fila `alta` y un borrado una `borrado`.
-- Lo demás (`fijado_ts`, imagen, peso, rentabilidad…) no deja fila.
--
-- `origen` sale del rol del pedido, no de lo que mande nadie:
--   'endpoint' = service_role (el archivo de precios por internet), 'app' = un usuario con sesión
--   (edición a mano o planilla: desde la base no se distinguen), 'sql' = sin JWT (psql, cron).
-- `id_usuario` = auth.uid() cuando hay sesión.
--
-- Lectura: admin, encargado, marketing y superadmin de la empresa. Nadie escribe a mano.

begin;

create table if not exists public.productos_cambios (
  id          bigint generated always as identity primary key,
  id_empresa  uuid        not null,
  id_producto uuid        not null,            -- sin FK: el historial sobrevive al borrado
  codigo      text,
  campo       text        not null,
  antes       text,
  despues     text,
  ts          timestamptz not null default now(),
  origen      text        not null,
  id_usuario  uuid
);
create index if not exists productos_cambios_empresa_ts_idx  on public.productos_cambios (id_empresa, ts desc);
create index if not exists productos_cambios_producto_ts_idx on public.productos_cambios (id_producto, ts desc);

alter table public.productos_cambios enable row level security;

drop policy if exists productos_cambios_sel on public.productos_cambios;
create policy productos_cambios_sel on public.productos_cambios
  for select using (es_superadmin()
                    or (id_empresa = mi_empresa() and mi_rol() = any (array['admin','encargado','marketing'])));

revoke all on public.productos_cambios from anon;
revoke insert, update, delete, truncate on public.productos_cambios from authenticated;

create or replace function public.productos_registrar_cambio()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol    text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', '');
  v_origen text := case when v_rol = 'service_role' then 'endpoint'
                        when v_rol = 'authenticated' then 'app'
                        when v_rol = '' then 'sql'
                        else v_rol end;
  v_uid    uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into productos_cambios (id_empresa, id_producto, codigo, campo, antes, despues, origen, id_usuario)
    values (new.id_empresa, new.id, new.codigo, 'alta', null, new.precio_unitario::text, v_origen, v_uid);
    return null;
  elsif tg_op = 'DELETE' then
    insert into productos_cambios (id_empresa, id_producto, codigo, campo, antes, despues, origen, id_usuario)
    values (old.id_empresa, old.id, old.codigo, 'borrado', old.precio_unitario::text, null, v_origen, v_uid);
    return null;
  end if;

  insert into productos_cambios (id_empresa, id_producto, codigo, campo, antes, despues, origen, id_usuario)
  select new.id_empresa, new.id, new.codigo, c.campo, c.antes, c.despues, v_origen, v_uid
    from (values
      ('precio_unitario', old.precio_unitario::text,        new.precio_unitario::text),
      ('precio_oferta',   old.precio_oferta::text,          new.precio_oferta::text),
      ('oferta',          old.oferta::text,                 new.oferta::text),
      ('escalas',         old.escalas::text,                new.escalas::text),
      ('descripcion',     old.descripcion,                  new.descripcion),
      ('categoria',       old.categoria,                    new.categoria),
      ('habilitado',      (old.descontinuado_ts is null)::text, (new.descontinuado_ts is null)::text)
    ) as c(campo, antes, despues)
   where c.antes is distinct from c.despues;
  return null;
end;
$$;
revoke execute on function public.productos_registrar_cambio() from public, anon, authenticated;

drop trigger if exists productos_cambios_log on public.productos;
create trigger productos_cambios_log
  after insert or update or delete on public.productos
  for each row execute function public.productos_registrar_cambio();

-- ── Autochequeo (todo se deshace con la excepción final) ─────────────────────────────────────────
do $$
declare
  v_emp uuid := (select id_empresa from productos limit 1);
  v_id  uuid;
  n     int;
begin
  if v_emp is null then return; end if;
  begin
    insert into productos (id_empresa, codigo, descripcion, precio_unitario)
    values (v_emp, 'ZZTEST94', 'Prueba db/94', 100) returning id into v_id;
    -- (1) alta
    select count(*) into n from productos_cambios where id_producto = v_id and campo = 'alta';
    if n <> 1 then raise exception 'db/94 (1) alta: %', n; end if;
    -- (2) un cambio de precio → una fila, con antes y después
    update productos set precio_unitario = 120 where id = v_id;
    select count(*) into n from productos_cambios
     where id_producto = v_id and campo = 'precio_unitario' and antes = '100.00' and despues = '120.00';
    if n <> 1 then raise exception 'db/94 (2) precio: %', n; end if;
    -- (3) un UPDATE que no cambia nada de lo que importa → cero filas
    update productos set fijado_ts = null, precio_unitario = 120 where id = v_id;
    select count(*) into n from productos_cambios where id_producto = v_id;
    if n <> 2 then raise exception 'db/94 (3) sin cambios dejó filas: %', n; end if;
    -- (4) baja + oferta en el mismo UPDATE → dos filas
    update productos set descontinuado_ts = now(), oferta = true where id = v_id;
    select count(*) into n from productos_cambios where id_producto = v_id and campo in ('habilitado','oferta');
    if n <> 2 then raise exception 'db/94 (4) baja+oferta: %', n; end if;
    -- (5) importar_precios con el mismo precio → cero filas; con otro → una, origen del rol
    perform importar_precios(v_emp, '[{"codigo":"ZZTEST94","precio_unitario":120}]'::jsonb, false, null, 'prueba-db94', true);
    select count(*) into n from productos_cambios where id_producto = v_id and campo = 'precio_unitario';
    if n <> 1 then raise exception 'db/94 (5a) importación sin cambio de precio dejó fila: %', n; end if;
    perform importar_precios(v_emp, '[{"codigo":"ZZTEST94","precio_unitario":130}]'::jsonb, false, null, 'prueba-db94', true);
    select count(*) into n from productos_cambios where id_producto = v_id and campo = 'precio_unitario' and despues = '130.00';
    if n <> 1 then raise exception 'db/94 (5b) importación con cambio: %', n; end if;
    -- (6) borrado
    delete from productos where id = v_id;
    select count(*) into n from productos_cambios where id_producto = v_id and campo = 'borrado';
    if n <> 1 then raise exception 'db/94 (6) borrado: %', n; end if;
    raise exception using errcode = 'P0099', message = 'db/94 autochequeo OK';
  exception when sqlstate 'P0099' then
    raise notice '%', sqlerrm;
  end;
end $$;

commit;

-- VERIFICACIÓN:
--   select ts, codigo, campo, antes, despues, origen from productos_cambios order by ts desc limit 30;
