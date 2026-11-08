-- 103_wa_control_y_zonas.sql — el asistente de WhatsApp controla visitas y analiza zonas (07/11/2026, plan 40).
--
-- EL PEDIDO. Que Darsh y Javier puedan preguntar "¿cómo viene Juan?", "¿Juan está visitando de verdad?"
-- y "¿qué zona conviene pasar a WhatsApp?", con respuestas sacadas de la base y nunca inventadas.
--
-- LO QUE MOSTRARON LOS DATOS (07/11, últimos 30 días):
--   · El 34 % de los pedidos con distancia se tomó a más de 150 m del comercio. Un umbral fijo
--     acusaría a casi todos: el indicio compara a cada uno contra la mediana del equipo.
--   · Varias personas toman pedidos lejanos desde el MISMO lugar (Joaquín V. González: casi seguro la
--     oficina). Un punto que usan varias personas se informa como "posible oficina o depósito"; uno que
--     usa una sola persona, como "lugar propio".
--   · Los motivos de no compra están vacíos y los repartos no se marcan (0 entregados): esas consultas
--     no se hacen; el asistente contesta que no tiene el dato.
--
-- QUÉ AGREGA:
--   1. `wa_parametros`: 3 costos (km, hora de vendedor, visita) y los umbrales del indicio, por empresa.
--      Tabla aparte y no `app_config`, porque `app_config` la lee la app de todos los vendedores.
--   2. `actividad_diaria(...)`: el cálculo de km, horas y paradas que estaba DENTRO de
--      `metricas_actividad`. Regla 36: una sola versión. `metricas_actividad` pasa a llamarla, y esta
--      migración compara su resultado antes y después para cada perfil que la puede usar.
--   3. `wa_buscar_personas`, `wa_rendimiento`, `wa_control_visitas`, `wa_avisos`, `wa_zonas`, todas con
--      `p_perfil` (db/102): el encargado ve solo a su gente.
--
-- Sin begin/commit: probar con `begin; \i ...; rollback;` y aplicar con `psql -1 -f`.

-- ── 1. Parámetros ────────────────────────────────────────────────────────────────────────────────
create table public.wa_parametros (
  id_empresa           uuid primary key,
  costo_km             numeric,            -- $ por km recorrido (combustible + desgaste)
  costo_hora_vendedor  numeric,            -- $ por hora en calle (sueldo + cargas, prorrateado)
  costo_visita         numeric,            -- $ fijo por visita (viáticos, material)
  lejos_m              int not null default 150,   -- igual que LEJOS_M de PedidosDelDia.jsx
  min_pedidos          int not null default 10,    -- con menos, "pocos datos"
  punto_min_clientes   int not null default 5,     -- un "mismo punto" junta pedidos de N comercios distintos
  updated_at           timestamptz not null default now()
);
comment on table public.wa_parametros is
  'Costos y umbrales del asistente de WhatsApp (db/103). Solo service_role. Los costos en NULL significan '
  '"no cargados": el asistente no estima pesos.';
alter table public.wa_parametros enable row level security;
revoke all on table public.wa_parametros from public, anon, authenticated;
grant all on table public.wa_parametros to service_role;

insert into public.wa_parametros (id_empresa)
select distinct id_empresa from public.wa_asistente_usuarios
on conflict do nothing;

-- ── 2. Actividad diaria (núcleo de `metricas_actividad`) ─────────────────────────────────────────
-- 🔧 Arreglo en el mismo paso: un salto de GPS (un punto a cientos de km) sumaba esos km. En 30 días,
-- Gabriel daba 65.579 km por UN día con 44.446 km, también en Gestión. Los tramos a más de 200 km/h
-- (55,6 m/s) no suman km. Paradas, horario y minutos en movimiento no cambian.
create temp table _act_antes (id_perfil uuid, dia date, id_usuario uuid, km numeric, resto text) on commit drop;

do $$
declare r record;
begin
  for r in select id from public.perfiles where rol in ('admin', 'superadmin', 'encargado') and activo loop
    perform set_config('request.jwt.claim.sub', r.id::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', r.id, 'role', 'authenticated')::text, true);
    insert into _act_antes
    select r.id, m.dia, m.id_usuario, m.km, concat_ws('|', m.puntos, m.primer_ts, m.ultimo_ts, m.minutos_movimiento, m.paradas)
      from public.metricas_actividad(current_date - 30, current_date) m;
  end loop;
  if not exists (select 1 from _act_antes) then
    raise exception 'db/103: la simulación de sesión no devolvió actividad; no se compara nada';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Copia textual del cálculo de db/33 (ver ese archivo para el porqué de cada umbral). `p_usuarios`
-- NULL = toda la empresa.
create function public.actividad_diaria(p_empresa uuid, p_desde date, p_hasta date, p_usuarios uuid[])
returns table(dia date, id_usuario uuid, km numeric, puntos integer, primer_ts timestamptz,
              ultimo_ts timestamptz, minutos_movimiento integer, paradas integer)
language sql stable set search_path = public as $$
  with base as (
    select
      p.id_usuario                                       as u,
      (p.ts at time zone 'America/Argentina/Salta')::date as d,
      p.ts                                               as t,
      p.id                                               as pid,
      p.lat, p.lng
    from posiciones p
    where p.id_empresa = p_empresa
      and p.ts >= ((p_desde::timestamp)       at time zone 'America/Argentina/Salta')
      and p.ts <  (((p_hasta + 1)::timestamp) at time zone 'America/Argentina/Salta')
      and p.id_usuario is not null
      and (p.accuracy is null or p.accuracy <= 30)
      and (p_usuarios is null or p.id_usuario = any(p_usuarios))
  ),
  seg as (
    select d, u, t,
      lag(t)   over w as t_prev,
      lag(lat) over w as lat_prev,
      lag(lng) over w as lng_prev,
      lat, lng
    from base
    window w as (partition by u, d order by t, pid)
  ),
  dist as (
    select d, u, t, t_prev, extract(epoch from (t - t_prev)) as seg,
      case
        when lat_prev is null then null
        else 2 * 6371000 * asin(least(1, sqrt(
               power(sin(radians(lat - lat_prev) / 2), 2) +
               cos(radians(lat_prev)) * cos(radians(lat)) *
               power(sin(radians(lng - lng_prev) / 2), 2)
             )))
      end as metros
    from seg
  ),
  marca as (
    select d, u, t, t_prev, metros,
           case when metros is null or metros >= 40 then 1 else 0 end as rompe
    from dist
  ),
  grupos as (
    select d, u, t, t_prev, metros, rompe,
           sum(rompe) over (partition by u, d order by t rows between unbounded preceding and current row) as g
    from marca
  ),
  racimos as (
    select d, u, g, min(t) as ini, max(t) as fin from grupos group by d, u, g
  ),
  paradas_dia as (
    select d, u, count(*)::int as n, sum(extract(epoch from (fin - ini)))::numeric as seg_parado
    from racimos where fin - ini >= interval '5 minutes' group by d, u
  ),
  totales as (
    select d, u,
           coalesce(sum(metros) filter (where metros >= 9 and metros <= 55.6 * greatest(seg, 1)), 0) / 1000.0 as km_dia,
           count(*)::int as n_puntos, min(t) as t_ini, max(t) as t_fin
    from dist group by d, u
  )
  select tt.d, tt.u, round(tt.km_dia::numeric, 3), tt.n_puntos, tt.t_ini, tt.t_fin,
         greatest(0, floor((extract(epoch from (tt.t_fin - tt.t_ini)) - coalesce(pd.seg_parado, 0)) / 60))::int,
         coalesce(pd.n, 0)
  from totales tt
  left join paradas_dia pd on pd.d = tt.d and pd.u = tt.u
  order by tt.d, tt.u
$$;

comment on function public.actividad_diaria(uuid, date, date, uuid[]) is
  'Km, puntos, horario, minutos en movimiento y paradas por persona y día (db/33, extraído en db/103). '
  'Sin control de permisos: solo service_role y funciones SECURITY DEFINER que ya controlaron.';

create or replace function public.metricas_actividad(p_desde date, p_hasta date)
returns table(dia date, id_usuario uuid, km numeric, puntos integer, primer_ts timestamptz,
              ultimo_ts timestamptz, minutos_movimiento integer, paradas integer)
language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_rol     text := mi_rol();
  v_empresa uuid := mi_empresa();
begin
  if v_rol is null or v_rol not in ('admin', 'superadmin', 'encargado') then
    raise exception 'Sin permiso para leer las métricas del equipo.' using errcode = '42501';
  end if;
  if p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango de fechas inválido.' using errcode = '22023';
  end if;
  -- db/40 — JERARQUIA: esta función saltea RLS, así que el recorte va acá. El cálculo vive en
  -- `actividad_diaria` (db/103).
  return query
  select * from public.actividad_diaria(
    v_empresa, p_desde, p_hasta,
    case when v_rol = 'encargado' then array(select ids_a_mi_cargo()) end);
end;
$function$;

revoke all on function public.actividad_diaria(uuid, date, date, uuid[]) from public, anon, authenticated;
grant execute on function public.actividad_diaria(uuid, date, date, uuid[]) to service_role;

do $$
declare r record; v_dif int := 0; v_bajan int := 0; v_km_antes numeric; v_km_despues numeric;
begin
  create temp table _act_despues (like _act_antes) on commit drop;
  for r in select distinct id_perfil from _act_antes loop
    perform set_config('request.jwt.claim.sub', r.id_perfil::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', r.id_perfil, 'role', 'authenticated')::text, true);
    insert into _act_despues
    select r.id_perfil, m.dia, m.id_usuario, m.km, concat_ws('|', m.puntos, m.primer_ts, m.ultimo_ts, m.minutos_movimiento, m.paradas)
      from public.metricas_actividad(current_date - 30, current_date) m;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  -- Mismas filas y mismo resto; los km solo pueden bajar.
  select count(*) into v_dif from (
    (select id_perfil, dia, id_usuario, resto from _act_antes except select id_perfil, dia, id_usuario, resto from _act_despues)
    union all
    (select id_perfil, dia, id_usuario, resto from _act_despues except select id_perfil, dia, id_usuario, resto from _act_antes)
    union all
    (select a.id_perfil, a.dia, a.id_usuario, a.resto from _act_antes a join _act_despues d using (id_perfil, dia, id_usuario)
      where d.km > a.km)
  ) x;
  if v_dif > 0 then
    raise exception 'db/103: metricas_actividad cambió en % filas fuera de los km; se cancela', v_dif;
  end if;
  select count(*) filter (where d.km < a.km), sum(a.km), sum(d.km) into v_bajan, v_km_antes, v_km_despues
    from _act_antes a join _act_despues d using (id_perfil, dia, id_usuario);
  raise notice 'db/103: metricas_actividad igual salvo km: % filas bajan (km % → %)', v_bajan, v_km_antes, v_km_despues;
end $$;

-- ── 3. Personas ──────────────────────────────────────────────────────────────────────────────────
-- Gente que el perfil puede ver, por nombre. No incluye usuarios de sistema.
create function public.wa_buscar_personas(p_empresa uuid, p_texto text, p_perfil uuid) returns jsonb
language sql stable set search_path = public as $$
  with hallados as (
    select pf.id, pf.nombre, pf.rol
      from public.perfiles pf
     where pf.id_empresa = p_empresa
       and pf.activo and not coalesce(pf.sistema, false)
       and pf.rol in ('vendedor', 'repartidor', 'encargado', 'admin')
       and ((select public.wa_ve_todo(p_perfil)) or pf.id in (select public.ids_a_cargo_de(p_perfil)))
       and public.wa_coincide(pf.nombre, p_texto)
  )
  select jsonb_build_object(
    'total', (select count(*) from hallados),
    'personas', coalesce((select jsonb_agg(to_jsonb(h) order by h.nombre) from (select * from hallados limit 6) h), '[]'::jsonb)
  )
$$;

-- ── 4. Rendimiento contra sus 4 semanas anteriores ───────────────────────────────────────────────
-- Tasas POR DÍA TRABAJADO (un día con visita o pedido): así una semana con feriado no parece baja.
-- `p_persona` NULL = todos los que el perfil ve y tuvieron actividad.
create function public.wa_rendimiento(p_empresa uuid, p_desde date, p_hasta date, p_perfil uuid, p_persona uuid)
returns jsonb
language sql stable set search_path = public as $$
  with gente as (
    select pf.id, pf.nombre from public.perfiles pf
     where pf.id_empresa = p_empresa and pf.activo and not coalesce(pf.sistema, false)
       and (p_persona is null or pf.id = p_persona)
       and ((select public.wa_ve_todo(p_perfil)) or pf.id in (select public.ids_a_cargo_de(p_perfil)))
  ),
  ev as (   -- un evento por visita o pedido, con su día y si cae en el período o en la base
    select v.id_usuario as u, (v.check_in_ts at time zone 'America/Argentina/Salta')::date as d,
           v.check_in_ts as t, 'visita' as tipo, v.estado, 0::numeric as monto, v.id_cliente
      from public.visitas v
     where v.id_empresa = p_empresa and v.estado <> 'cancelado'
       and v.id_usuario in (select id from gente)
       and v.check_in_ts >= (p_desde - 28)::timestamp at time zone 'America/Argentina/Salta'
       and v.check_in_ts <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
    union all
    select p.id_vendedor, (p.created_at at time zone 'America/Argentina/Salta')::date,
           p.created_at, 'pedido', p.estado, p.monto_total, p.id_cliente
      from public.pedidos p
     where p.id_empresa = p_empresa and p.estado <> 'Anulado'
       and p.id_vendedor in (select id from gente)
       and p.created_at >= (p_desde - 28)::timestamp at time zone 'America/Argentina/Salta'
       and p.created_at <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
  ),
  dia as (
    select u, d, d >= p_desde as actual,
           count(*) filter (where tipo = 'visita')                         as visitas,
           count(*) filter (where tipo = 'visita' and estado = 'sin_pedido') as sin_pedido,
           count(*) filter (where tipo = 'pedido')                          as pedidos,
           coalesce(sum(monto) filter (where tipo = 'pedido'), 0)           as monto,
           count(distinct id_cliente) filter (where tipo = 'pedido')        as clientes,
           -- minutos desde medianoche del primer movimiento del día
           extract(epoch from (min(t) at time zone 'America/Argentina/Salta')::time) / 60 as arranque_min
      from ev
     group by u, d
  ),
  r as (
    select g.id, g.nombre,
      count(*) filter (where actual)                               as dias,
      coalesce(sum(visitas)    filter (where actual), 0)           as visitas,
      coalesce(sum(sin_pedido) filter (where actual), 0)           as sin_pedido,
      coalesce(sum(pedidos)    filter (where actual), 0)           as pedidos,
      coalesce(sum(monto)      filter (where actual), 0)           as monto,
      coalesce(sum(clientes)   filter (where actual), 0)           as clientes,
      round(avg(arranque_min)  filter (where actual))              as arranque_min,
      count(*) filter (where not actual)                           as dias_base,
      coalesce(sum(visitas)    filter (where not actual), 0)       as visitas_base,
      coalesce(sum(pedidos)    filter (where not actual), 0)       as pedidos_base,
      coalesce(sum(monto)      filter (where not actual), 0)       as monto_base,
      round(avg(arranque_min)  filter (where not actual))          as arranque_base
    from gente g left join dia on dia.u = g.id
    group by g.id, g.nombre
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.monto desc), '[]'::jsonb)
    from r where r.dias > 0 or r.dias_base > 0
$$;

-- ── 5. Control de visitas ────────────────────────────────────────────────────────────────────────
-- Dónde se tomaron los pedidos respecto del comercio. Solo pedidos con GPS confiable (accuracy ≤ 30 m)
-- y distancia calculada (`distancia_m` NULL = sin dato, db/43). El "punto principal" es la celda de
-- ~100 m (3 decimales) desde donde salieron pedidos lejanos para más comercios distintos. Se marca
-- `compartido` si en los últimos 60 días otra persona tomó pedidos lejanos a menos de 300 m de ahí.
create function public.wa_control_visitas(p_empresa uuid, p_desde date, p_hasta date, p_perfil uuid, p_persona uuid)
returns jsonb
language sql stable set search_path = public as $$
  with prm as (
    select coalesce(lejos_m, 150) as lejos_m, coalesce(min_pedidos, 10) as min_pedidos,
           coalesce(punto_min_clientes, 5) as punto_min_clientes
      from (select 1) x left join public.wa_parametros w on w.id_empresa = p_empresa
  ),
  ped as (
    select p.id_vendedor as u, p.id_cliente, p.distancia_m, p.lat, p.lng,
           (p.created_at at time zone 'America/Argentina/Salta')::date as d,
           (p.distancia_m is not null and coalesce(p.accuracy, 0) <= 30) as con_dato,
           round(p.lat::numeric, 3) || ',' || round(p.lng::numeric, 3) as celda
      from public.wa_pedidos_visibles(p_empresa, p_perfil) p
     where p.estado <> 'Anulado' and p.id_vendedor is not null
       and p.created_at >= p_desde::timestamp at time zone 'America/Argentina/Salta'
       and p.created_at <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
  ),
  -- Para "compartido" se mira toda la empresa: saber que la oficina es oficina no expone a nadie.
  lejanos_60 as (
    select p.id_vendedor, p.lat, p.lng
      from public.pedidos p, prm
     where p.id_empresa = p_empresa and p.estado <> 'Anulado' and p.lat is not null
       and p.distancia_m > prm.lejos_m and coalesce(p.accuracy, 0) <= 30
       and p.created_at >= now() - interval '60 days'
  ),
  por as (
    select u,
           count(*)                                                  as pedidos,
           count(*) filter (where con_dato)                          as con_dato,
           count(*) filter (where con_dato and distancia_m > (select lejos_m from prm)) as lejos,
           round(percentile_cont(0.5) within group (order by distancia_m) filter (where con_dato)) as mediana_m
      from ped group by u
  ),
  punto as (
    select distinct on (u) u, celda, count(*) as pedidos, count(distinct id_cliente) as clientes,
           count(distinct d) as dias, round(percentile_cont(0.5) within group (order by distancia_m)) as mediana_m,
           avg(lat) as lat, avg(lng) as lng
      from ped
     where con_dato and distancia_m > (select lejos_m from prm)
     group by u, celda
     order by u, count(distinct id_cliente) desc, count(*) desc
  ),
  act as (
    select a.id_usuario as u, count(*) as dias, round(sum(a.km), 1) as km,
           round(sum(extract(epoch from (a.ultimo_ts - a.primer_ts))) / 3600.0, 1) as horas,
           sum(a.paradas) as paradas
      from public.actividad_diaria(p_empresa, p_desde, p_hasta, array(select u from por)) a
     group by a.id_usuario
  ),
  vis as (
    select v.id_usuario as u, count(*) as visitas,
           count(*) filter (where c.lat is not null and v.lat is not null and coalesce(v.accuracy, 0) <= 30
             and 2 * 6371000 * asin(least(1, sqrt(power(sin(radians(v.lat - c.lat) / 2), 2)
                 + cos(radians(c.lat)) * cos(radians(v.lat)) * power(sin(radians(v.lng - c.lng) / 2), 2))))
                 > (select lejos_m from prm)) as check_in_lejos
      from public.visitas v join public.clientes c on c.id = v.id_cliente
     where v.id_empresa = p_empresa and v.estado <> 'cancelado'
       and v.id_usuario in (select u from por)
       and v.check_in_ts >= p_desde::timestamp at time zone 'America/Argentina/Salta'
       and v.check_in_ts <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
     group by v.id_usuario
  ),
  fila as (
    select pf.id, pf.nombre, pf.rol, por.pedidos, por.con_dato, por.lejos, por.mediana_m,
           case when por.con_dato > 0 then round(100.0 * por.lejos / por.con_dato) end as pct_lejos,
           pt.pedidos as punto_pedidos, pt.clientes as punto_clientes, pt.dias as punto_dias,
           pt.mediana_m as punto_mediana_m,
           -- Compartido: otra persona cargó pedidos lejanos a menos de 300 m de ese lugar (la celda de
           -- 100 m sola partía la misma oficina en celdas distintas: medido el 07/11 en J. V. González).
           exists (select 1 from lejanos_60 o
                    where o.id_vendedor <> por.u
                      and 2 * 6371000 * asin(least(1, sqrt(power(sin(radians(o.lat - pt.lat) / 2), 2)
                          + cos(radians(pt.lat)) * cos(radians(o.lat)) * power(sin(radians(o.lng - pt.lng) / 2), 2)))) < 300)
             as punto_compartido,
           act.dias as dias_gps, act.km, act.horas, act.paradas,
           vis.visitas, vis.check_in_lejos
      from por
      join public.perfiles pf on pf.id = por.u
      left join punto pt on pt.u = por.u
      left join act on act.u = por.u
      left join vis on vis.u = por.u
     where p_persona is null or por.u = p_persona
  )
  select jsonb_build_object(
    'lejos_m', (select lejos_m from prm),
    'min_pedidos', (select min_pedidos from prm),
    'punto_min_clientes', (select punto_min_clientes from prm),
    -- Mediana del equipo visible, solo con quienes tienen datos suficientes.
    'pct_equipo', (select round(percentile_cont(0.5) within group (order by 100.0 * lejos / con_dato))
                     from por where con_dato >= (select min_pedidos from prm)),
    'personas', coalesce((select jsonb_agg(to_jsonb(f) order by f.pct_lejos desc nulls last) from fila f), '[]'::jsonb)
  )
$$;

-- ── 6. Avisos del equipo ─────────────────────────────────────────────────────────────────────────
create function public.wa_avisos(p_empresa uuid, p_desde date, p_hasta date, p_perfil uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.total desc), '[]'::jsonb) from (
    select pf.nombre,
           count(*)                                         as total,
           count(*) filter (where a.tipo = 'sin_reportar')  as sin_reportar,
           count(*) filter (where a.tipo = 'quieto')        as quieto,
           count(*) filter (where a.tipo = 'transporte_sin_declarar') as transporte,
           max(a.minutos)                                   as max_minutos
      from public.alertas_equipo a join public.perfiles pf on pf.id = a.id_usuario
     where a.id_empresa = p_empresa
       and a.desde >= p_desde::timestamp at time zone 'America/Argentina/Salta'
       and a.desde <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
       and ((select public.wa_ve_todo(p_perfil)) or a.id_usuario in (select public.ids_a_cargo_de(p_perfil)))
       -- Solo gente que trabaja: las cuentas de prueba o duplicadas también generan avisos de "sin reportar".
       and pf.activo and not coalesce(pf.sistema, false)
       and (exists (select 1 from public.pedidos p where p.id_vendedor = a.id_usuario and p.created_at >= now() - interval '60 days')
            or exists (select 1 from public.visitas v where v.id_usuario = a.id_usuario and v.check_in_ts >= now() - interval '60 days'))
     group by pf.nombre
  ) r
$$;

-- ── 7. Zonas: costo de atenderlas y candidatas a WhatsApp ────────────────────────────────────────
-- Ventana fija: últimos 30 días. Km y horas de cada día de cada persona se reparten entre las zonas
-- según cuántas visitas hizo en cada una ese día. "Listo para WhatsApp": compró 3 o más veces en
-- 60 días (compra pareja) y tiene teléfono cargado. Ahorro: esas visitas pasan a 1 cada 30 días, al
-- costo promedio por visita de la zona. Todo es estimación y la plantilla lo dice.
-- Encargado: solo zonas cuyo vendedor está a su cargo.
create function public.wa_zonas(p_empresa uuid, p_perfil uuid, p_texto text) returns jsonb
language sql stable set search_path = public as $$
  with prm as (
    select w.costo_km, w.costo_hora_vendedor, w.costo_visita
      from (select 1) x left join public.wa_parametros w on w.id_empresa = p_empresa
  ),
  rango as (select (current_date - 29) as desde, current_date as hasta),
  zon as (
    select z.id, z.nombre, z.numero, pf.nombre as vendedor
      from public.zonas z left join public.perfiles pf on pf.id = z.id_vendedor
     where z.id_empresa = p_empresa
       and ((select public.wa_ve_todo(p_perfil)) or z.id_vendedor in (select public.ids_a_cargo_de(p_perfil)))
       and (coalesce(trim(p_texto), '') = ''
            or public.wa_coincide(z.nombre, p_texto)
            or z.numero::text = regexp_replace(p_texto, '\D', '', 'g')
            or public.wa_coincide(coalesce(pf.nombre, ''), p_texto))
  ),
  vis as (
    select v.id_usuario as u, (v.check_in_ts at time zone 'America/Argentina/Salta')::date as d,
           c.id_zona, v.id_cliente
      from public.visitas v join public.clientes c on c.id = v.id_cliente, rango
     where v.id_empresa = p_empresa and v.estado <> 'cancelado'
       and v.check_in_ts >= rango.desde::timestamp at time zone 'America/Argentina/Salta'
  ),
  act as (
    select a.dia, a.id_usuario, a.km, extract(epoch from (a.ultimo_ts - a.primer_ts)) / 3600.0 as horas
      from rango, public.actividad_diaria(p_empresa, rango.desde, rango.hasta, null) a
  ),
  reparto as (   -- km y horas de cada (persona, día) repartidos por visitas a cada zona
    select v.id_zona,
           sum(a.km    / nullif(t.n, 0)) as km,
           sum(a.horas / nullif(t.n, 0)) as horas
      from vis v
      join (select u, d, count(*) as n from vis group by u, d) t on t.u = v.u and t.d = v.d
      join act a on a.id_usuario = v.u and a.dia = v.d
     group by v.id_zona
  ),
  ped as (
    select c.id_zona, p.id_cliente, p.monto_total, p.created_at
      from public.pedidos p join public.clientes c on c.id = p.id_cliente
     where p.id_empresa = p_empresa and p.estado <> 'Anulado'
       and p.created_at >= now() - interval '60 days'
  ),
  cli as (
    select c.id_zona, c.id,
           (c.telefono is not null and trim(c.telefono) <> '') as con_tel,
           (select count(*) from ped where ped.id_cliente = c.id) as compras_60,
           (select count(*) from vis where vis.id_cliente = c.id) as visitas_30
      from public.clientes c
     where c.id_empresa = p_empresa and c.archivado_ts is null and c.id_zona in (select id from zon)
  ),
  z as (
    select zon.id, zon.nombre, zon.numero, zon.vendedor,
           (select count(*) from cli where cli.id_zona = zon.id) as clientes,
           (select count(*) from cli where cli.id_zona = zon.id and cli.con_tel) as con_telefono,
           (select count(*) from cli where cli.id_zona = zon.id and cli.compras_60 >= 3) as compran_parejo,
           (select count(*) from cli where cli.id_zona = zon.id and cli.compras_60 >= 3 and cli.con_tel) as listos_wa,
           (select coalesce(sum(greatest(cli.visitas_30 - 1, 0)), 0) from cli
             where cli.id_zona = zon.id and cli.compras_60 >= 3 and cli.con_tel) as visitas_ahorrables,
           (select count(*) from vis where vis.id_zona = zon.id) as visitas,
           (select coalesce(sum(monto_total), 0) from ped
             where ped.id_zona = zon.id and ped.created_at >= now() - interval '30 days') as monto,
           (select count(*) from ped
             where ped.id_zona = zon.id and ped.created_at >= now() - interval '30 days') as pedidos,
           round(coalesce(rp.km, 0), 1) as km, round(coalesce(rp.horas, 0), 1) as horas
      from zon left join reparto rp on rp.id_zona = zon.id
  ),
  zc as (
    select z.*,
           case when (select costo_km from prm) is not null and (select costo_hora_vendedor from prm) is not null
                     and (select costo_visita from prm) is not null
                then round(z.km * (select costo_km from prm) + z.horas * (select costo_hora_vendedor from prm)
                           + z.visitas * (select costo_visita from prm)) end as costo
      from z
  )
  select jsonb_build_object(
    'con_costos', (select costo_km is not null and costo_hora_vendedor is not null and costo_visita is not null from prm),
    'zonas', coalesce((select jsonb_agg(to_jsonb(x) order by x.orden desc nulls last) from (
      select zc.*,
             case when zc.monto > 0 then round(100.0 * zc.costo / zc.monto, 1) end as costo_sobre_venta,
             case when zc.visitas > 0 then round(zc.costo * zc.visitas_ahorrables / zc.visitas) end as ahorro,
             -- Orden: costo sobre venta si hay costos; si no, km por cada $100.000 vendidos.
             coalesce(case when zc.monto > 0 then zc.costo / zc.monto end,
                      case when zc.monto > 0 then zc.km / zc.monto end) as orden
        from zc where zc.clientes > 0) x), '[]'::jsonb)
  )
$$;

-- ── 8. Permisos (regla 7-bis) ────────────────────────────────────────────────────────────────────
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname ~ '^wa_' or p.proname = 'actividad_diaria')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

do $$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname ~ '^wa_' or p.proname in ('ids_a_cargo_de', 'actividad_diaria'))
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  ) then
    raise exception 'db/103: quedó una función del asistente ejecutable por anon o authenticated';
  end if;
  if has_table_privilege('anon', 'public.wa_parametros', 'select')
     or has_table_privilege('authenticated', 'public.wa_parametros', 'select') then
    raise exception 'db/103: wa_parametros quedó legible por anon o authenticated';
  end if;
  if not has_function_privilege('authenticated', 'public.metricas_actividad(date,date)', 'execute') then
    raise exception 'db/103: metricas_actividad perdió EXECUTE para authenticated';
  end if;
end $$;

notify pgrst, 'reload schema';
