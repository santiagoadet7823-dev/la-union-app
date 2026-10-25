-- 95_metricas_ia.sql — capa de datos de SÓLO LECTURA para agentes de IA (25/10/2026, plan 23 fase C).
--
-- 🩸 POR QUÉ. Un agente que diga "Fulano viene visitando menos que su costumbre" o "este producto dejó
-- de venderse" necesita historia, y la base la va perdiendo: `posiciones` se borra a los 45 días
-- (`limpiar_posiciones_viejas`) y los pedidos anulados a los 30 (`purgar_pedidos_anulados`). Por eso:
--
--   1. `metricas_diarias_usuario`: una FOTO por empresa, usuario y día (hora de la empresa). La llena
--      `metricas_calcular(desde, hasta)` todas las noches (cron `metricas-diarias`, 00:15 AR, recalcula
--      los últimos 3 días: un pedido cargado sin señal puede llegar días después). Al recalcular un día
--      cuyas posiciones ya se borraron, se conservan la primera/última actividad que ya tenía.
--   2. Tres RPC que devuelven JSON, para la Edge Function `informe-ia` (token `agente`):
--        ia_resumen_equipo(empresa, desde, hasta, zona?)  cada usuario contra SU promedio de las 4
--                                                         semanas anteriores, con banderas
--        ia_productos_ventas(empresa, desde, hasta)       más vendidos, sin ventas y en caída
--        ia_cambios_catalogo(empresa, desde, hasta)       de `productos_cambios` (db/94)
--      🔑 La empresa la pone la función a partir del TOKEN; por eso estas RPC son sólo de service_role.
--
-- Definiciones (para que el agente no invente):
--   visitas            = visitas del día que no están `cancelado` (incluye `en_curso` sin cerrar)
--   clientes_distintos = clientes distintos de esas visitas
--   sin_pedido         = visitas con estado `sin_pedido`
--   pedidos/monto/kg   = pedidos no anulados por `created_at` (monto_total y peso_total). Son PEDIDOS
--                        tomados, no facturación del ERP.
--   minutos_en_clientes= suma de (salida - entrada) de las visitas cerradas, con tope de 240 por visita
--   primera/última act.= primera y última posición GPS del día
--   promedios por día  = sobre los días HÁBILES del período (lunes a sábado), no sobre los días con
--                        actividad: si alguien no salió, el promedio lo muestra.
--   Banderas: baja_visitas / baja_pedidos / baja_monto (< 70 % de su base), suba_monto (> 130 %),
--   arranque_tarde (primera actividad promedio > 45 min más tarde que su base), sin_actividad (nada en
--   el período y algo en la base). Las de baja piden una base mínima (2 visitas/día, 1 pedido/día,
--   monto > 0) para no marcar a quien casi no tiene historia.

begin;

-- ── 1. La foto diaria ────────────────────────────────────────────────────────────────────────────
create table if not exists public.metricas_diarias_usuario (
  id_empresa          uuid        not null,
  id_usuario          uuid        not null,
  fecha               date        not null,
  rol                 text,
  id_zona             uuid,
  visitas             int         not null default 0,
  clientes_distintos  int         not null default 0,
  sin_pedido          int         not null default 0,
  pedidos             int         not null default 0,
  monto               numeric(14,2) not null default 0,
  kg                  numeric(14,2) not null default 0,
  minutos_en_clientes int         not null default 0,
  posiciones          int         not null default 0,
  primera_actividad   timestamptz,
  ultima_actividad    timestamptz,
  calculado_ts        timestamptz not null default now(),
  primary key (id_empresa, fecha, id_usuario)
);
create index if not exists metricas_diarias_usuario_usuario_idx on public.metricas_diarias_usuario (id_usuario, fecha desc);

alter table public.metricas_diarias_usuario enable row level security;
drop policy if exists metricas_diarias_usuario_sel on public.metricas_diarias_usuario;
create policy metricas_diarias_usuario_sel on public.metricas_diarias_usuario
  for select using (es_superadmin() or (id_empresa = mi_empresa() and mi_rol() = any (array['admin','encargado'])));
revoke all on public.metricas_diarias_usuario from anon;
revoke insert, update, delete, truncate on public.metricas_diarias_usuario from authenticated;

create or replace function public.metricas_calcular(p_desde date, p_hasta date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then
    raise exception 'metricas_calcular: rango inválido (% a %)', p_desde, p_hasta;
  end if;

  with emp as (
    select id, coalesce(nullif(export_erp->>'zona_horaria', ''), 'America/Argentina/Salta') as tz,
           (p_desde::timestamp at time zone coalesce(nullif(export_erp->>'zona_horaria', ''), 'America/Argentina/Salta')) as t0,
           ((p_hasta + 1)::timestamp at time zone coalesce(nullif(export_erp->>'zona_horaria', ''), 'America/Argentina/Salta')) as t1
      from empresas
  ),
  vis as (
    select v.id_empresa, v.id_usuario, (v.check_in_ts at time zone e.tz)::date as fecha,
           count(*) filter (where v.estado is distinct from 'cancelado')                          as visitas,
           count(distinct v.id_cliente) filter (where v.estado is distinct from 'cancelado')      as clientes,
           count(*) filter (where v.estado = 'sin_pedido')                                         as sin_pedido,
           coalesce(sum(least(extract(epoch from v.check_out_ts - v.check_in_ts) / 60, 240))
                    filter (where v.estado is distinct from 'cancelado' and v.check_out_ts > v.check_in_ts), 0)::int as minutos
      from visitas v join emp e on e.id = v.id_empresa
     where v.check_in_ts >= e.t0 and v.check_in_ts < e.t1 and v.id_usuario is not null
     group by 1, 2, 3
  ),
  ped as (
    select p.id_empresa, p.id_vendedor as id_usuario, (p.created_at at time zone e.tz)::date as fecha,
           count(*) as pedidos, coalesce(sum(p.monto_total), 0) as monto, coalesce(sum(p.peso_total), 0) as kg
      from pedidos p join emp e on e.id = p.id_empresa
     where p.created_at >= e.t0 and p.created_at < e.t1 and p.estado <> 'Anulado' and p.id_vendedor is not null
     group by 1, 2, 3
  ),
  pos as (
    select x.id_empresa, x.id_usuario, (x.ts at time zone e.tz)::date as fecha,
           count(*) as posiciones, min(x.ts) as primera, max(x.ts) as ultima
      from posiciones x join emp e on e.id = x.id_empresa
     where x.ts >= e.t0 and x.ts < e.t1 and x.id_usuario is not null
     group by 1, 2, 3
  ),
  claves as (
    select id_empresa, id_usuario, fecha from vis
    union select id_empresa, id_usuario, fecha from ped
    union select id_empresa, id_usuario, fecha from pos
  )
  insert into metricas_diarias_usuario as m (
    id_empresa, id_usuario, fecha, rol, id_zona, visitas, clientes_distintos, sin_pedido, pedidos, monto,
    kg, minutos_en_clientes, posiciones, primera_actividad, ultima_actividad, calculado_ts)
  select k.id_empresa, k.id_usuario, k.fecha, pf.rol, pf.id_zona,
         coalesce(vis.visitas, 0), coalesce(vis.clientes, 0), coalesce(vis.sin_pedido, 0),
         coalesce(ped.pedidos, 0), coalesce(ped.monto, 0), coalesce(ped.kg, 0), coalesce(vis.minutos, 0),
         coalesce(pos.posiciones, 0), pos.primera, pos.ultima, now()
    from claves k
    left join vis using (id_empresa, id_usuario, fecha)
    left join ped using (id_empresa, id_usuario, fecha)
    left join pos using (id_empresa, id_usuario, fecha)
    left join perfiles pf on pf.id = k.id_usuario
   where coalesce(pf.sistema, false) = false
  on conflict (id_empresa, fecha, id_usuario) do update set
    rol                 = excluded.rol,
    id_zona             = excluded.id_zona,
    visitas             = excluded.visitas,
    clientes_distintos  = excluded.clientes_distintos,
    sin_pedido          = excluded.sin_pedido,
    pedidos             = excluded.pedidos,
    monto               = excluded.monto,
    kg                  = excluded.kg,
    minutos_en_clientes = excluded.minutos_en_clientes,
    -- las posiciones se borran a los 45 días: un recálculo tardío no pisa lo que ya estaba
    posiciones          = case when excluded.posiciones > 0 then excluded.posiciones else m.posiciones end,
    primera_actividad   = coalesce(excluded.primera_actividad, m.primera_actividad),
    ultima_actividad    = coalesce(excluded.ultima_actividad, m.ultima_actividad),
    calculado_ts        = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.metricas_calcular(date, date) from public, anon, authenticated;
grant  execute on function public.metricas_calcular(date, date) to service_role;

-- Días hábiles (lunes a sábado) entre dos fechas, inclusive.
create or replace function public.ia_dias_habiles(p_desde date, p_hasta date)
returns int
language sql
immutable
as $$
  select count(*)::int from generate_series(p_desde, p_hasta, interval '1 day') d where extract(isodow from d) < 7;
$$;

-- ── 2. Resumen del equipo ────────────────────────────────────────────────────────────────────────
create or replace function public.ia_resumen_equipo(p_empresa uuid, p_desde date, p_hasta date, p_zona uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz  text := coalesce((select nullif(export_erp->>'zona_horaria', '') from empresas where id = p_empresa), 'America/Argentina/Salta');
  v_b0  date := p_desde - 28;
  v_b1  date := p_desde - 1;
  v_np  int  := greatest(public.ia_dias_habiles(p_desde, p_hasta), 1);
  v_nb  int  := greatest(public.ia_dias_habiles(p_desde - 28, p_desde - 1), 1);
  v_out jsonb;
begin
  if p_empresa is null or p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 366 then
    raise exception 'ia_resumen_equipo: rango inválido';
  end if;

  with agg as (
    select m.id_usuario,
           (m.fecha between p_desde and p_hasta) as en_periodo,
           sum(m.visitas) visitas, sum(m.clientes_distintos) clientes, sum(m.sin_pedido) sin_pedido,
           sum(m.pedidos) pedidos, sum(m.monto) monto, sum(m.kg) kg, sum(m.minutos_en_clientes) minutos,
           count(*) filter (where m.visitas > 0 or m.pedidos > 0 or m.posiciones > 0) dias_activos,
           avg(extract(epoch from (m.primera_actividad at time zone v_tz)::time) / 60)
             filter (where m.primera_actividad is not null) arranque_min
      from metricas_diarias_usuario m
     where m.id_empresa = p_empresa and m.fecha between v_b0 and p_hasta
     group by 1, 2
  ),
  u as (
    select pf.id, pf.nombre, pf.rol, pf.id_zona, z.nombre as zona,
           p.visitas pv, p.clientes pc, p.sin_pedido ps, p.pedidos pp, p.monto pm, p.kg pk, p.minutos pmin,
           coalesce(p.dias_activos, 0) pdias, p.arranque_min parr,
           b.visitas bv, b.pedidos bp, b.monto bm, coalesce(b.dias_activos, 0) bdias, b.arranque_min barr
      from perfiles pf
      left join zonas z on z.id = pf.id_zona
      left join agg p on p.id_usuario = pf.id and p.en_periodo
      left join agg b on b.id_usuario = pf.id and not b.en_periodo
     where pf.id_empresa = p_empresa and coalesce(pf.sistema, false) = false
       and (p.id_usuario is not null or b.id_usuario is not null)
       and (p_zona is null or pf.id_zona = p_zona)
  ),
  r as (
    select u.*,
           coalesce(pv, 0)::numeric / v_np as v_dia, coalesce(bv, 0)::numeric / v_nb as bv_dia,
           coalesce(pp, 0)::numeric / v_np as p_dia, coalesce(bp, 0)::numeric / v_nb as bp_dia,
           coalesce(pm, 0)::numeric / v_np as m_dia, coalesce(bm, 0)::numeric / v_nb as bm_dia
      from u
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'zona', p_zona, 'dias_habiles', v_np,
    'base', jsonb_build_object('desde', v_b0, 'hasta', v_b1, 'dias_habiles', v_nb),
    'zona_horaria', v_tz,
    'usuarios', coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'nombre', r.nombre, 'rol', r.rol, 'id_zona', r.id_zona, 'zona', r.zona,
      'periodo', jsonb_build_object(
        'visitas', coalesce(r.pv, 0), 'clientes_distintos', coalesce(r.pc, 0), 'sin_pedido', coalesce(r.ps, 0),
        'pedidos', coalesce(r.pp, 0), 'monto', coalesce(r.pm, 0), 'kg', coalesce(r.pk, 0),
        'minutos_en_clientes', coalesce(r.pmin, 0), 'dias_activos', r.pdias,
        'arranque_promedio', case when r.parr is not null then to_char(make_interval(mins => r.parr::int), 'HH24:MI') end),
      'por_dia',      jsonb_build_object('visitas', round(r.v_dia, 2),  'pedidos', round(r.p_dia, 2),  'monto', round(r.m_dia, 2)),
      'base_por_dia', jsonb_build_object('visitas', round(r.bv_dia, 2), 'pedidos', round(r.bp_dia, 2), 'monto', round(r.bm_dia, 2),
                                         'dias_activos', r.bdias,
                                         'arranque_promedio', case when r.barr is not null then to_char(make_interval(mins => r.barr::int), 'HH24:MI') end),
      'banderas', to_jsonb(array_remove(array[
        case when r.bv_dia >= 2 and r.v_dia < 0.7 * r.bv_dia then 'baja_visitas' end,
        case when r.bp_dia >= 1 and r.p_dia < 0.7 * r.bp_dia then 'baja_pedidos' end,
        case when r.bm_dia > 0  and r.m_dia < 0.7 * r.bm_dia then 'baja_monto' end,
        case when r.bm_dia > 0  and r.m_dia > 1.3 * r.bm_dia then 'suba_monto' end,
        case when r.parr is not null and r.barr is not null and r.parr - r.barr > 45 then 'arranque_tarde' end,
        case when r.pdias = 0 and r.bdias > 0 then 'sin_actividad' end
      ], null))
    ) order by r.nombre), '[]'::jsonb)
  ) into v_out
  from r;
  return v_out;
end;
$$;

-- ── 3. Productos: más vendidos, sin ventas, en caída ─────────────────────────────────────────────
create or replace function public.ia_productos_ventas(p_empresa uuid, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz  text := coalesce((select nullif(export_erp->>'zona_horaria', '') from empresas where id = p_empresa), 'America/Argentina/Salta');
  v_len int  := p_hasta - p_desde + 1;
  t0 timestamptz; t1 timestamptz; t_prev timestamptz;
  v_out jsonb;
begin
  if p_empresa is null or p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 366 then
    raise exception 'ia_productos_ventas: rango inválido';
  end if;
  t0     := p_desde::timestamp at time zone v_tz;
  t1     := (p_hasta + 1)::timestamp at time zone v_tz;
  t_prev := (p_desde - v_len)::timestamp at time zone v_tz;

  with it as (
    select i.id_producto, (p.created_at >= t0) as actual, i.cantidad, i.cantidad * i.precio_unitario as monto,
           p.id as id_pedido, p.id_cliente
      from pedido_items i join pedidos p on p.id = i.id_pedido
     where p.id_empresa = p_empresa and p.estado <> 'Anulado'
       and p.created_at >= t_prev and p.created_at < t1 and i.id_producto is not null
  ),
  v as (
    select id_producto,
           coalesce(sum(cantidad) filter (where actual), 0)     as cant,
           coalesce(sum(monto)    filter (where actual), 0)     as monto,
           count(distinct id_pedido)  filter (where actual)     as pedidos,
           count(distinct id_cliente) filter (where actual)     as clientes,
           coalesce(sum(cantidad) filter (where not actual), 0) as cant_prev,
           coalesce(sum(monto)    filter (where not actual), 0) as monto_prev
      from it group by 1
  ),
  pr as (
    select pr.id, pr.codigo, pr.descripcion, pr.categoria, pr.marca, pr.precio_unitario,
           (pr.descontinuado_ts is null) as habilitado,
           coalesce(v.cant, 0) cant, coalesce(v.monto, 0) monto, coalesce(v.pedidos, 0) pedidos,
           coalesce(v.clientes, 0) clientes, coalesce(v.cant_prev, 0) cant_prev, coalesce(v.monto_prev, 0) monto_prev
      from productos pr left join v on v.id_producto = pr.id
     where pr.id_empresa = p_empresa
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'periodo_anterior', jsonb_build_object('desde', p_desde - v_len, 'hasta', p_desde - 1),
    'nota', 'monto = cantidad x precio del renglón en pedidos no anulados; son pedidos tomados, no facturación',
    'mas_vendidos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.monto desc), '[]'::jsonb) from (
        select codigo, descripcion, categoria, cant, round(monto, 2) monto, pedidos, clientes, cant_prev, round(monto_prev, 2) monto_prev
          from pr where cant > 0 order by monto desc limit 25) x),
    'sin_ventas_total', (select count(*) from pr where habilitado and cant = 0),
    'sin_ventas', (select coalesce(jsonb_agg(to_jsonb(x) order by x.monto_prev desc, x.codigo), '[]'::jsonb) from (
        select codigo, descripcion, categoria, precio_unitario, cant_prev, round(monto_prev, 2) monto_prev
          from pr where habilitado and cant = 0 order by monto_prev desc, codigo limit 100) x),
    'en_caida', (select coalesce(jsonb_agg(to_jsonb(x) order by x.caida_monto desc), '[]'::jsonb) from (
        select codigo, descripcion, categoria, cant, cant_prev, round(monto, 2) monto, round(monto_prev, 2) monto_prev,
               round(monto_prev - monto, 2) caida_monto
          from pr where cant_prev >= 5 and cant < 0.5 * cant_prev order by monto_prev - monto desc limit 50) x)
  ) into v_out;
  return v_out;
end;
$$;

-- ── 4. Cambios del catálogo (db/94) ──────────────────────────────────────────────────────────────
create or replace function public.ia_cambios_catalogo(p_empresa uuid, p_desde date, p_hasta date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tz text := coalesce((select nullif(export_erp->>'zona_horaria', '') from empresas where id = p_empresa), 'America/Argentina/Salta');
  t0 timestamptz; t1 timestamptz;
  v_total int;
  v_out jsonb;
begin
  if p_empresa is null or p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 366 then
    raise exception 'ia_cambios_catalogo: rango inválido';
  end if;
  t0 := p_desde::timestamp at time zone v_tz;
  t1 := (p_hasta + 1)::timestamp at time zone v_tz;
  select count(*) into v_total from productos_cambios where id_empresa = p_empresa and ts >= t0 and ts < t1;

  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta, 'total', v_total, 'truncado', v_total > 500,
    'resumen', (select coalesce(jsonb_agg(jsonb_build_object('campo', campo, 'origen', origen, 'cambios', n) order by n desc), '[]'::jsonb)
                  from (select campo, origen, count(*) n from productos_cambios
                         where id_empresa = p_empresa and ts >= t0 and ts < t1 group by 1, 2) s),
    'cambios', (select coalesce(jsonb_agg(jsonb_build_object(
                   'ts', to_char(c.ts at time zone v_tz, 'YYYY-MM-DD HH24:MI'), 'codigo', c.codigo,
                   'descripcion', pr.descripcion, 'campo', c.campo, 'antes', c.antes, 'despues', c.despues,
                   'origen', c.origen) order by c.ts desc), '[]'::jsonb)
                  from (select * from productos_cambios
                         where id_empresa = p_empresa and ts >= t0 and ts < t1 order by ts desc limit 500) c
                  left join productos pr on pr.id = c.id_producto)
  ) into v_out;
  return v_out;
end;
$$;

revoke execute on function public.ia_resumen_equipo(uuid, date, date, uuid) from public, anon, authenticated;
revoke execute on function public.ia_productos_ventas(uuid, date, date)    from public, anon, authenticated;
revoke execute on function public.ia_cambios_catalogo(uuid, date, date)    from public, anon, authenticated;
grant  execute on function public.ia_resumen_equipo(uuid, date, date, uuid) to service_role;
grant  execute on function public.ia_productos_ventas(uuid, date, date)    to service_role;
grant  execute on function public.ia_cambios_catalogo(uuid, date, date)    to service_role;

-- ── 5. El token del agente ───────────────────────────────────────────────────────────────────────
alter table public.ingesta_tokens drop constraint if exists ingesta_tokens_proposito_chk;
alter table public.ingesta_tokens add constraint ingesta_tokens_proposito_chk
  check (proposito = any (array['gps','precios','pedidos','clientes','agente']));

-- ── 6. Cron nocturno: 03:15 UTC = 00:15 AR, recalcula los últimos 3 días ─────────────────────────
select cron.schedule('metricas-diarias', '15 3 * * *',
  $c$select public.metricas_calcular(((now() at time zone 'America/Argentina/Salta')::date - 3),
                                     ((now() at time zone 'America/Argentina/Salta')::date - 1))$c$);

notify pgrst, 'reload schema';

commit;

-- CARGA INICIAL (una vez, después de aplicar): desde el primer dato hasta ayer.
--   select public.metricas_calcular('2026-09-10', (now() at time zone 'America/Argentina/Salta')::date - 1);
-- VERIFICACIÓN:
--   select fecha, rol, visitas, pedidos, monto from metricas_diarias_usuario where id_usuario = '<id>' order by fecha desc;
--   select public.ia_resumen_equipo('<id_empresa>', current_date - 7, current_date - 1);
