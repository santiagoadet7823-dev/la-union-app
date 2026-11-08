-- 102_wa_alcance_encargado.sql — el asistente de WhatsApp respeta la jerarquía (07/11/2026, plan 38).
--
-- EL PEDIDO. Sumar a Javier (encargado) al asistente, pero que vea solo a su gente, igual que en la
-- app. Darsh (admin) sigue viendo toda la empresa. Cada número tiene su propia charla: nadie ve lo
-- que pregunta otro (eso ya era así en db/101, porque el historial se lee por `wa_id`).
--
-- POR QUÉ SE TOCA `ids_a_mi_cargo()`. La regla de "a quién veo" vive ahí (db/40) y lee la sesión
-- (`auth.uid()`). El asistente no tiene sesión: necesita la misma regla para un perfil dado. Copiarla
-- sería la regla 36 otra vez —dos versiones que nadie sincroniza—. Por eso la regla se muda a
-- `ids_a_cargo_de(perfil)` y `ids_a_mi_cargo()` pasa a ser `ids_a_cargo_de(auth.uid())`.
-- 🔴 `ids_a_mi_cargo()` la usan las policies de pedidos, posiciones, visitas y perfiles. Esta migración
-- compara, perfil por perfil, lo que devuelve antes y después del cambio, y se cancela sola si un solo
-- resultado difiere.
--
-- QUÉ VE CADA UNO EN EL ASISTENTE (mismo criterio que la app):
--   · admin / superadmin: la empresa entera, como hasta hoy (incluye pedidos sin vendedor).
--   · encargado: pedidos con vendedor O repartidor a su cargo (`pedidos_sel`); clientes dormidos cuya
--     última compra tomó alguien a su cargo (`clientes_dormidos_empresa`); equipo a su cargo.
--   · Búsqueda de clientes y precios: toda la empresa. Los clientes son de la distribuidora (db/40).
--
-- 🔑 `ids_a_cargo_de` y `wa_ve_todo` son solo de `service_role` (regla 7-bis): con EXECUTE, un usuario
-- logueado podría preguntar por perfiles ajenos. `ids_a_mi_cargo()` la sigue pudiendo llamar cualquiera
-- porque es SECURITY DEFINER: corre como su dueño.
--
-- Sin begin/commit: probar con `begin; \i ...; rollback;` y aplicar con `psql -1 -f`.

-- ── 1. La regla, para un perfil dado ─────────────────────────────────────────────────────────────
create function public.ids_a_cargo_de(p_perfil uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  with yo as (select y.rol, y.id_empresa, coalesce(y.nivel, 0) as nivel from perfiles y where y.id = p_perfil)
  select p.id
  from perfiles p
  where p.id = p_perfil                     -- a uno mismo SIEMPRE
     or case (select rol from yo)
          when 'superadmin' then true
          when 'admin'      then p.id_empresa = (select id_empresa from yo)
          -- `greatest(nivel, 1)`: un encargado en nivel 0 se comporta como uno de nivel 1 (db/40).
          when 'encargado'  then p.id_empresa = (select id_empresa from yo)
                                 and coalesce(p.nivel, 0) < greatest((select nivel from yo), 1)
          else false                        -- vendedor, repartidor, marketing: solo a sí mismos
        end
$function$;

comment on function public.ids_a_cargo_de(uuid) is
  'Ids de perfiles que puede ver el perfil dado (db/40, db/102). Única fuente de la jerarquía: '
  '`ids_a_mi_cargo()` la llama con auth.uid(). Usar como `in (select ids_a_cargo_de(x))`.';

revoke execute on function public.ids_a_cargo_de(uuid) from public, anon, authenticated;
grant execute on function public.ids_a_cargo_de(uuid) to service_role;

-- ── 2. `ids_a_mi_cargo()` delega, con comprobación ───────────────────────────────────────────────
create temp table _antes (id_perfil uuid primary key, ids uuid[]) on commit drop;

do $$
declare r record;
begin
  for r in select id from public.perfiles loop
    perform set_config('request.jwt.claim.sub', r.id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    insert into _antes values (r.id, array(select x from public.ids_a_mi_cargo() x order by 1));
  end loop;
  -- Si `auth.uid()` no hubiera tomado el perfil simulado, todo saldría vacío y la comparación no
  -- probaría nada.
  if not exists (select 1 from _antes where cardinality(ids) > 1) then
    raise exception 'db/102: la simulación de sesión no funcionó; no se compara nada';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function public.ids_a_mi_cargo()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.ids_a_cargo_de((select auth.uid()))
$function$;

comment on function public.ids_a_mi_cargo() is
  'Ids de perfiles que el usuario de la sesión puede ver. La regla está en `ids_a_cargo_de` (db/102). '
  'Usar SIEMPRE como `id_usuario in (select ids_a_mi_cargo())` para que se evalúe una vez por consulta.';

do $$
declare r record; v_dif int := 0;
begin
  for r in select * from _antes loop
    perform set_config('request.jwt.claim.sub', r.id_perfil::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', r.id_perfil, 'role', 'authenticated')::text, true);
    if r.ids is distinct from array(select x from public.ids_a_mi_cargo() x order by 1)
       or r.ids is distinct from array(select x from public.ids_a_cargo_de(r.id_perfil) x order by 1) then
      v_dif := v_dif + 1;
    end if;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  if v_dif > 0 then
    raise exception 'db/102: ids_a_mi_cargo cambió para % perfiles; se cancela', v_dif;
  end if;
  raise notice 'db/102: ids_a_mi_cargo igual para % perfiles', (select count(*) from _antes);
end $$;

-- ── 3. ¿Ve toda la empresa? ──────────────────────────────────────────────────────────────────────
create function public.wa_ve_todo(p_perfil uuid) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from public.perfiles where id = p_perfil and rol in ('admin', 'superadmin'))
$$;

-- ── 4. Consultas con alcance ─────────────────────────────────────────────────────────────────────
-- Las de db/101 cambian de firma (suman `p_perfil`): se borran y se crean de nuevo.
drop function public.wa_ventas(uuid, date, date);
drop function public.wa_ventas_categoria(uuid, date, date);
drop function public.wa_pedido(uuid, text);
drop function public.wa_pedidos_cliente(uuid, uuid);
drop function public.wa_clientes_sin_comprar(uuid, int);
drop function public.wa_equipo(uuid);

-- Pedidos visibles para el perfil: toda la empresa o, si es encargado, los de su gente (`pedidos_sel`).
create function public.wa_pedidos_visibles(p_empresa uuid, p_perfil uuid)
returns setof public.pedidos
language sql stable set search_path = public as $$
  select p.* from public.pedidos p
   where p.id_empresa = p_empresa
     and ((select public.wa_ve_todo(p_perfil))
          or p.id_vendedor   in (select public.ids_a_cargo_de(p_perfil))
          or p.id_repartidor in (select public.ids_a_cargo_de(p_perfil)))
$$;

create function public.wa_ventas(p_empresa uuid, p_desde date, p_hasta date, p_perfil uuid) returns jsonb
language sql stable set search_path = public as $$
  with ped as (
    select p.id_vendedor, p.id_cliente, p.monto_total, p.estado
      from public.wa_pedidos_visibles(p_empresa, p_perfil) p
     where p.created_at >= p_desde::timestamp at time zone 'America/Argentina/Salta'
       and p.created_at <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
  ),
  por as (
    select coalesce(pf.nombre, 'Sin vendedor') as nombre,
           sum(x.monto_total) as monto, count(*) as pedidos, count(distinct x.id_cliente) as clientes
      from ped x left join public.perfiles pf on pf.id = x.id_vendedor
     where x.estado <> 'Anulado'
     group by 1
  )
  select jsonb_build_object(
    'monto',    coalesce((select sum(monto_total) from ped where estado <> 'Anulado'), 0),
    'pedidos',  (select count(*) from ped where estado <> 'Anulado'),
    'clientes', (select count(distinct id_cliente) from ped where estado <> 'Anulado'),
    'anulados', (select count(*) from ped where estado = 'Anulado'),
    'por_vendedor', coalesce((select jsonb_agg(to_jsonb(por) order by por.monto desc nulls last) from por), '[]'::jsonb)
  )
$$;

create function public.wa_ventas_categoria(p_empresa uuid, p_desde date, p_hasta date, p_perfil uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.monto desc), '[]'::jsonb) from (
    select coalesce(nullif(trim(pr.categoria), ''), 'Sin categoría') as categoria,
           coalesce(sum(i.cantidad * i.precio_unitario), 0) as monto,
           count(distinct p.id) as pedidos
      from public.wa_pedidos_visibles(p_empresa, p_perfil) p
      join public.pedido_items i on i.id_pedido = p.id
      left join public.productos pr on pr.id = i.id_producto
     where p.created_at >= p_desde::timestamp at time zone 'America/Argentina/Salta'
       and p.created_at <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
       and p.estado <> 'Anulado'
     group by 1
     order by 2 desc
     limit 15
  ) c
$$;

-- Misma forma que lo que lee `productosVendidos` de `ia_productos_ventas`, que es del informe de IA y
-- no conoce la jerarquía (no se toca). Período anterior del mismo largo, para "en caída".
create function public.wa_productos_ventas(p_empresa uuid, p_desde date, p_hasta date, p_perfil uuid) returns jsonb
language sql stable set search_path = public as $$
  with it as (
    select i.id_producto, (p.created_at >= p_desde::timestamp at time zone 'America/Argentina/Salta') as actual,
           i.cantidad, i.cantidad * i.precio_unitario as monto
      from public.wa_pedidos_visibles(p_empresa, p_perfil) p
      join public.pedido_items i on i.id_pedido = p.id
     where p.estado <> 'Anulado' and i.id_producto is not null
       and p.created_at >= (p_desde - (p_hasta - p_desde + 1))::timestamp at time zone 'America/Argentina/Salta'
       and p.created_at <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
  ),
  v as (
    select pr.descripcion,
           coalesce(sum(it.cantidad) filter (where it.actual), 0)     as cant,
           coalesce(sum(it.monto)    filter (where it.actual), 0)     as monto,
           coalesce(sum(it.cantidad) filter (where not it.actual), 0) as cant_prev,
           coalesce(sum(it.monto)    filter (where not it.actual), 0) as monto_prev
      from it join public.productos pr on pr.id = it.id_producto
     group by pr.id, pr.descripcion
  )
  select jsonb_build_object(
    'mas_vendidos', coalesce((select jsonb_agg(to_jsonb(x) order by x.monto desc) from
      (select descripcion, cant, round(monto, 2) monto from v where cant > 0 order by monto desc limit 10) x), '[]'::jsonb),
    'en_caida', coalesce((select jsonb_agg(to_jsonb(x) order by x.caida desc) from
      (select descripcion, cant, round(monto, 2) monto, round(monto_prev, 2) monto_prev, monto_prev - monto as caida
         from v where cant_prev >= 5 and cant < 0.5 * cant_prev order by monto_prev - monto desc limit 5) x), '[]'::jsonb)
  )
$$;

-- `numero` se guarda como "000687"; se acepta "687". Un pedido ajeno al encargado no aparece.
create function public.wa_pedido(p_empresa uuid, p_numero text, p_perfil uuid) returns jsonb
language sql stable set search_path = public as $$
  select to_jsonb(r) from (
    select p.numero, p.estado, p.monto_total as monto, p.created_at, p.fecha_entrega, p.ts_en_camino,
           p.ts_entregado, p.exportado_ts, p.forma_pago, p.observaciones,
           c.nombre_comercio as cliente, c.codigo as codigo_cliente,
           v.nombre as vendedor, rp.nombre as repartidor,
           (select count(*) from public.pedido_items i where i.id_pedido = p.id) as renglones
      from public.wa_pedidos_visibles(p_empresa, p_perfil) p
      left join public.clientes c on c.id = p.id_cliente
      left join public.perfiles v on v.id = p.id_vendedor
      left join public.perfiles rp on rp.id = p.id_repartidor
     where p.numero = lpad(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), 6, '0')
     limit 1
  ) r
$$;

create function public.wa_pedidos_cliente(p_empresa uuid, p_cliente uuid, p_perfil uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) from (
    select p.numero, p.estado, p.monto_total as monto, p.created_at, p.fecha_entrega
      from public.wa_pedidos_visibles(p_empresa, p_perfil) p
     where p.id_cliente = p_cliente
     order by p.created_at desc
     limit 5
  ) r
$$;

-- Encargado: solo los comercios cuya ÚLTIMA compra la tomó alguien a su cargo (`clientes_dormidos_empresa`).
create function public.wa_clientes_sin_comprar(p_empresa uuid, p_dias int, p_perfil uuid) returns jsonb
language sql stable set search_path = public as $$
  with ultimo as (
    select distinct on (c.id) c.id, c.codigo, c.nombre_comercio, c.localidad,
           p.created_at as ultima, p.id_vendedor
      from public.clientes c
      left join public.pedidos p on p.id_cliente = c.id and p.id_empresa = p_empresa and p.estado <> 'Anulado'
     where c.id_empresa = p_empresa and c.archivado_ts is null
     order by c.id, p.created_at desc nulls last
  ),
  mios as (
    select * from ultimo
     where (select public.wa_ve_todo(p_perfil)) or id_vendedor in (select public.ids_a_cargo_de(p_perfil))
  ),
  dormidos as (
    select * from mios where ultima is not null and ultima < now() - make_interval(days => greatest(p_dias, 1))
  )
  select jsonb_build_object(
    'dias', greatest(p_dias, 1),
    'total', (select count(*) from dormidos),
    -- Un comercio que nunca compró no es de nadie: solo lo cuenta quien ve toda la empresa.
    'nunca_compraron', case when (select public.wa_ve_todo(p_perfil))
                            then (select count(*) from ultimo where ultima is null) else 0 end,
    'clientes', coalesce((select jsonb_agg(to_jsonb(d)) from
      (select codigo, nombre_comercio, localidad, ultima from dormidos order by ultima desc limit 10) d), '[]'::jsonb)
  )
$$;

create function public.wa_equipo(p_empresa uuid, p_perfil uuid) returns jsonb
language sql stable set search_path = public as $$
  with hoy as (
    select (now() at time zone 'America/Argentina/Salta')::date::timestamp at time zone 'America/Argentina/Salta' as desde
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.en_ventana desc, r.minutos_silencio nulls last), '[]'::jsonb) from (
    select e.nombre, e.rol, e.en_ventana, e.minutos_silencio, e.ultimo_ts,
           (select count(*) from public.pedidos p, hoy
             where p.id_vendedor = e.id_usuario and p.created_at >= hoy.desde and p.estado <> 'Anulado') as pedidos_hoy,
           (select coalesce(sum(p.monto_total), 0) from public.pedidos p, hoy
             where p.id_vendedor = e.id_usuario and p.created_at >= hoy.desde and p.estado <> 'Anulado') as monto_hoy,
           (select count(*) from public.visitas v, hoy
             where v.id_usuario = e.id_usuario and v.check_in_ts >= hoy.desde and v.estado <> 'cancelado') as visitas_hoy
      from public.vigilancia_equipo() e
     where e.id_empresa = p_empresa
       and ((select public.wa_ve_todo(p_perfil)) or e.id_usuario in (select public.ids_a_cargo_de(p_perfil)))
  ) r
$$;

-- ── 5. Permisos (regla 7-bis) ────────────────────────────────────────────────────────────────────
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname ~ '^wa_'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- Ninguna función del asistente ni `ids_a_cargo_de` puede quedar abierta a anon o authenticated.
do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname ~ '^wa_' or p.proname = 'ids_a_cargo_de')
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  ) then
    raise exception 'db/102: quedó una función wa_*/ids_a_cargo_de ejecutable por anon o authenticated';
  end if;
  -- Y `ids_a_mi_cargo` tiene que seguir abierta: las policies la llaman como el rol que consulta.
  if not has_function_privilege('authenticated', 'public.ids_a_mi_cargo()', 'execute') then
    raise exception 'db/102: ids_a_mi_cargo perdió EXECUTE para authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
