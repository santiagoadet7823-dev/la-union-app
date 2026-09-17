-- 68 — Métricas de VENTA del equipo para el dashboard (16/09/2026)
--
-- Aplicada en la base viva el 16/09/2026 (MCP, apply_migration). Verificado el ACL real con
-- `select proacl from pg_proc`: `{postgres=X, authenticated=X, service_role=X}` — ni anon ni PUBLIC.
--
-- Por qué. Hasta hoy TODAS las RPC de venta eran por persona (`metricas_venta(p_id_usuario, …)`,
-- `productos_del_vendedor`, `clientes_dormidos`, db/56-57): nacieron para el tablero del vendedor.
-- Para un dashboard del equipo (ventas por día, por vendedor, por categoría, pedidos por estado)
-- eso obligaba a N llamadas —una por persona— o a bajar la tabla `pedidos` entera al navegador y
-- agrupar en JS. Estas tres devuelven agregados y nada más, con la misma forma que
-- `metricas_actividad` (db/40): una fila por día × persona, así el front reusa `lib/comparar.js`
-- (comparación contra el período anterior, sparklines, "sin registro ≠ 0") sin tocar una línea.
--
-- 🔴 EL ALCANCE SE DECIDE ACÁ ADENTRO, NUNCA SE CONFÍA EN EL PARÁMETRO (regla de db/56):
--   · Rol: sólo admin / superadmin / encargado. Un vendedor logueado que pegue un fetch a mano
--     recibe 42501, no los números del equipo.
--   · Empresa: `mi_empresa()`. `p_empresa` sólo se honra si quien llama es superadmin (para el
--     selector de empresa activa, `useTenant`); para cualquier otro rol se ignora en silencio.
--   · Jerarquía: un encargado ve sólo `ids_a_mi_cargo()` (db/40). El admin ve la empresa entera.
--
-- Semántica que hay que conocer para leer los números:
--   · El día es el de `created_at` en America/Argentina/Salta (regla 23: nunca UTC).
--   · `monto` y `pedidos` EXCLUYEN `estado = 'Anulado'` (un pedido anulado no se facturó, db/56).
--     Los anulados se cuentan aparte en `anulados`, porque para el dueño "cuántos se cayeron" es
--     un dato, no ruido.
--   · `clientes` = comercios distintos con al menos un pedido vigente ese día.
--   · `visitas` = check-ins no cancelados (`visitas.estado <> 'cancelado'`), y
--     `visitas_con_pedido` = los que terminaron en 'visitado' (así lo escribe `useJornada.endVisit`:
--     'visitado' es "con pedido", 'sin_pedido' es la no-venta). La efectividad es el cociente y se
--     calcula en el front, que sabe cuándo la base es demasiado chica para un porcentaje.
--   · Techo de 400 días, como las otras dos.
--
-- `ventas_por_categoria` sale de `pedido_items ⨝ productos` por `id_producto`. Un ítem cuyo
-- producto ya no existe (borrado del catálogo) se agrupa como 'Sin categoría' y no se pierde: el
-- monto del pedido es el que se vendió, exista o no hoy la ficha. La categoría vacía también va a
-- 'Sin categoría' para que la torta cierre en 100 %.
--
-- `pedidos_por_estado` cuenta TODOS los estados, anulados incluidos: es justamente la torta que
-- muestra cuántos están pendientes, en camino, entregados y caídos.

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Helper interno: resuelve la empresa y valida rol/rango. No se expone.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._dash_empresa(p_empresa uuid, p_desde date, p_hasta date)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_rol text := mi_rol();
begin
  if v_rol is null or v_rol not in ('admin', 'superadmin', 'encargado') then
    raise exception 'Sin permiso para leer las métricas del equipo.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango de fechas inválido.' using errcode = '22023';
  end if;
  if v_rol = 'superadmin' and p_empresa is not null then
    return p_empresa;
  end if;
  return mi_empresa();
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Ventas por día × vendedor
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.metricas_venta_equipo(p_desde date, p_hasta date, p_empresa uuid default null)
returns table(dia date, id_vendedor uuid, monto numeric, pedidos bigint, clientes bigint,
              visitas bigint, visitas_con_pedido bigint, anulados bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_empresa uuid := _dash_empresa(p_empresa, p_desde, p_hasta);
  v_rol     text := mi_rol();
  v_desde   timestamptz := (p_desde::timestamp)       at time zone 'America/Argentina/Salta';
  v_hasta   timestamptz := ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/Salta';
begin
  return query
  with ped as (
    select (p.created_at at time zone 'America/Argentina/Salta')::date as d,
           p.id_vendedor as u, p.id_cliente, p.monto_total, p.estado
      from public.pedidos p
     where p.id_empresa = v_empresa
       and p.created_at >= v_desde and p.created_at < v_hasta
       and p.id_vendedor is not null
       and (v_rol <> 'encargado' or p.id_vendedor in (select ids_a_mi_cargo()))
  ),
  vis as (
    select (v.check_in_ts at time zone 'America/Argentina/Salta')::date as d,
           v.id_usuario as u, v.estado
      from public.visitas v
     where v.id_empresa = v_empresa
       and v.check_in_ts >= v_desde and v.check_in_ts < v_hasta
       and v.estado <> 'cancelado'
       and (v_rol <> 'encargado' or v.id_usuario in (select ids_a_mi_cargo()))
  ),
  ped_agg as (
    select d, u,
           coalesce(sum(monto_total) filter (where estado <> 'Anulado'), 0) as monto,
           count(*) filter (where estado <> 'Anulado')                      as pedidos,
           count(distinct id_cliente) filter (where estado <> 'Anulado')    as clientes,
           count(*) filter (where estado = 'Anulado')                       as anulados
      from ped group by d, u
  ),
  vis_agg as (
    select d, u,
           count(*)                                        as visitas,
           count(*) filter (where estado = 'visitado')     as visitas_con_pedido
      from vis group by d, u
  )
  select coalesce(a.d, b.d)            as dia,
         coalesce(a.u, b.u)            as id_vendedor,
         coalesce(a.monto, 0)          as monto,
         coalesce(a.pedidos, 0)        as pedidos,
         coalesce(a.clientes, 0)       as clientes,
         coalesce(b.visitas, 0)        as visitas,
         coalesce(b.visitas_con_pedido, 0) as visitas_con_pedido,
         coalesce(a.anulados, 0)       as anulados
    from ped_agg a
    full outer join vis_agg b on b.d = a.d and b.u = a.u
   order by 1, 2;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ventas por categoría / marca (para la torta)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.ventas_por_categoria(p_desde date, p_hasta date, p_empresa uuid default null)
returns table(categoria text, marca text, monto numeric, unidades numeric, pedidos bigint)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_empresa uuid := _dash_empresa(p_empresa, p_desde, p_hasta);
  v_rol     text := mi_rol();
  v_desde   timestamptz := (p_desde::timestamp)       at time zone 'America/Argentina/Salta';
  v_hasta   timestamptz := ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/Salta';
begin
  return query
  select coalesce(nullif(trim(pr.categoria), ''), 'Sin categoría') as categoria,
         coalesce(nullif(trim(pr.marca), ''), 'Sin marca')         as marca,
         coalesce(sum(i.cantidad * i.precio_unitario), 0)          as monto,
         coalesce(sum(i.cantidad), 0)                              as unidades,
         count(distinct p.id)                                      as pedidos
    from public.pedidos p
    join public.pedido_items i on i.id_pedido = p.id
    left join public.productos pr on pr.id = i.id_producto
   where p.id_empresa = v_empresa
     and p.created_at >= v_desde and p.created_at < v_hasta
     and p.estado <> 'Anulado'
     and (v_rol <> 'encargado' or p.id_vendedor in (select ids_a_mi_cargo()))
   group by 1, 2
   order by 3 desc;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Pedidos por estado (para la torta)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pedidos_por_estado(p_desde date, p_hasta date, p_empresa uuid default null)
returns table(estado text, cantidad bigint, monto numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_empresa uuid := _dash_empresa(p_empresa, p_desde, p_hasta);
  v_rol     text := mi_rol();
  v_desde   timestamptz := (p_desde::timestamp)       at time zone 'America/Argentina/Salta';
  v_hasta   timestamptz := ((p_hasta + 1)::timestamp) at time zone 'America/Argentina/Salta';
begin
  return query
  select p.estado, count(*) as cantidad, coalesce(sum(p.monto_total), 0) as monto
    from public.pedidos p
   where p.id_empresa = v_empresa
     and p.created_at >= v_desde and p.created_at < v_hasta
     and (v_rol <> 'encargado' or p.id_vendedor in (select ids_a_mi_cargo()))
   group by p.estado
   order by 2 desc;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Permisos (regla 7-bis: revocar de los TRES, después conceder; verificar `proacl`)
-- ─────────────────────────────────────────────────────────────────────────────
revoke execute on function public._dash_empresa(uuid, date, date) from public, anon, authenticated;
grant  execute on function public._dash_empresa(uuid, date, date) to service_role;
-- El helper lo invocan las tres de abajo, que son SECURITY DEFINER (corren como postgres): no
-- hace falta que `authenticated` lo pueda llamar directo, y así no se lo puede llamar directo.

revoke execute on function public.metricas_venta_equipo(date, date, uuid) from public, anon, authenticated;
revoke execute on function public.ventas_por_categoria(date, date, uuid)  from public, anon, authenticated;
revoke execute on function public.pedidos_por_estado(date, date, uuid)    from public, anon, authenticated;
grant  execute on function public.metricas_venta_equipo(date, date, uuid) to authenticated, service_role;
grant  execute on function public.ventas_por_categoria(date, date, uuid)  to authenticated, service_role;
grant  execute on function public.pedidos_por_estado(date, date, uuid)    to authenticated, service_role;

comment on function public.metricas_venta_equipo(date, date, uuid) is
  'Ventas por día × vendedor para el dashboard (db/68). Scope adentro: rol, empresa, jerarquía.';
comment on function public.ventas_por_categoria(date, date, uuid) is
  'Monto/unidades por categoría y marca en el rango (db/68). Excluye anulados.';
comment on function public.pedidos_por_estado(date, date, uuid) is
  'Cantidad y monto de pedidos por estado en el rango (db/68). Incluye anulados.';

-- Verificación (correr aparte):
--   select proname, proacl from pg_proc
--    where proname in ('_dash_empresa','metricas_venta_equipo','ventas_por_categoria','pedidos_por_estado');
--   select * from metricas_venta_equipo(current_date - 30, current_date);
