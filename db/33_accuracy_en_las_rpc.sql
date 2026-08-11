-- 33 — Las RPC que miden movimiento tienen que mirar `accuracy` (11/08/2026)
--
-- 🩸 POR QUÉ AHORA. Hasta 1.13.2 el servicio nativo descartaba todo fix peor que 30 m, así que en
-- `posiciones` casi no existían filas imprecisas (364 en 57.242, todas del carril de triangulación
-- de 1.9.0) y ninguna RPC necesitaba filtrarlas. Desde 1.13.3 el techo de CAPTURA sube a 120 m
-- —porque tirarlos estaba vaciando recorridos enteros: Alejandro mercado perdió 39,6 km de ruta en
-- un día con el 66 % de sus fixes descartados— y el que decide qué se CONFÍA pasa a ser el
-- consumidor, no el teléfono.
--
-- El lado JS ya estaba preparado: `limpiarTrazo` (lib/geo.js) manda todo lo que supere
-- ACCURACY_MAX_M al carril `aproximados` —punteado, fuera de los km y fuera del snap (regla 40)— y
-- `kmDePuntos` suma solo lo bueno. El lado SQL NO: estas dos funciones calculan movimiento con
-- todas las filas.
--
-- Sin este archivo, subir el techo de captura habría causado dos regresiones silenciosas:
--
--   1. `metricas_actividad` — los km del panel se inflan con el jitter de fixes de 120 m. El piso
--      de 9 m de db/32 no alcanza: 120 m de error dan saltos de 40-200 m, muy por encima del piso.
--
--   2. `vigilancia_equipo` — LA PEOR, porque es la que manda push al supervisor:
--      · el umbral de "se movió" son 40 m, y un fix de 120 m los supera solo, así que un teléfono
--        parado parecería en movimiento y **el aviso de QUIETO dejaría de dispararse**;
--      · `ult` tomaría un punto de ±120 m como la ubicación en vivo de la persona;
--      · y sobre todo, un teléfono que solo entrega basura (justo el que hay que detectar) contaría
--        como "reportando bien" y **el aviso de SIN REPORTAR también dejaría de dispararse**.
--        Con el filtro puesto pasa lo contrario y es lo correcto: si solo llegan fixes de 400 m, la
--        persona figura sin reportar y el supervisor se entera.
--
-- ⚠️ EL 30 DE ACÁ ES `ACCURACY_MAX_M` DE `src/services/gpsConfig.js`. Son dos runtimes que no pueden
-- compartir módulo (Postgres y el bundle); si se toca uno hay que tocar el otro. Mismo caso que
-- HUECO_MS ↔ GAP_MS de segmentar.ts (regla 49). El que SÍ se mueve por OTA es el otro techo
-- (ACCURACY_CAPTURA_MAX_M) y ese no aparece en la base para nada.
--
-- ⚠️ `accuracy is null` se conserva a propósito. Hoy no hay ninguna fila así, pero el campo estuvo
-- ausente entre 1.9.0 y el 08/08/2026 y nadie lo notó porque en JS `NaN > 30` es `false` en
-- silencio. Un `accuracy <= 30` pelado da NULL para esas filas y las EXCLUYE, o sea que borraría
-- días históricos enteros de las métricas. Ausente = se conserva, igual que en el JS.

-- ── 1. metricas_actividad ────────────────────────────────────────────────────────────────────────
-- Cambio único: el filtro de precisión en `base`. Todo lo que viene después (km, paradas, minutos
-- de movimiento y el conteo de puntos) hereda el mismo carril que dibuja el mapa, así que el número
-- del panel y el del recorrido dejan de poder divergir.

create or replace function public.metricas_actividad(p_desde date, p_hasta date)
returns table(dia date, id_usuario uuid, km numeric, puntos integer, primer_ts timestamp with time zone, ultimo_ts timestamp with time zone, minutos_movimiento integer, paradas integer)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  v_rol text := mi_rol();
begin
  if v_rol is null or v_rol not in ('admin', 'superadmin', 'encargado') then
    raise exception 'Sin permiso para leer las métricas del equipo.' using errcode = '42501';
  end if;

  if p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango de fechas inválido.' using errcode = '22023';
  end if;

  return query
  with base as (
    select
      p.id_usuario                                       as u,
      (p.ts at time zone 'America/Argentina/Salta')::date as d,
      p.ts                                               as t,
      p.id                                               as pid,
      p.lat, p.lng
    from posiciones p
    where p.id_empresa = mi_empresa()
      and p.ts >= ((p_desde::timestamp)       at time zone 'America/Argentina/Salta')
      and p.ts <  (((p_hasta + 1)::timestamp) at time zone 'America/Argentina/Salta')
      and p.id_usuario is not null
      -- 🩸 Solo el carril de CONFIANZA (db/33). Espeja ACCURACY_MAX_M de gpsConfig.js.
      and (p.accuracy is null or p.accuracy <= 30)
  ),
  seg as (
    select
      d, u, t,
      lag(t)   over w as t_prev,
      lag(lat) over w as lat_prev,
      lag(lng) over w as lng_prev,
      lat, lng
    from base
    window w as (partition by u, d order by t, pid)
  ),
  dist as (
    select
      d, u, t, t_prev,
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
    select d, u, g, min(t) as ini, max(t) as fin
    from grupos
    group by d, u, g
  ),
  paradas_dia as (
    select d, u,
           count(*)::int                                 as n,
           sum(extract(epoch from (fin - ini)))::numeric as seg_parado
    from racimos
    where fin - ini >= interval '5 minutes'
    group by d, u
  ),
  totales as (
    select d, u,
           -- 🩸 PISO DE RUIDO (db/32): por debajo de 9 m no hubo movimiento, hubo jitter.
           coalesce(sum(metros) filter (where metros >= 9), 0) / 1000.0 as km_dia,
           count(*)::int                     as n_puntos,
           min(t)                            as t_ini,
           max(t)                            as t_fin
    from dist
    group by d, u
  )
  select
    tt.d,
    tt.u,
    round(tt.km_dia::numeric, 3),
    tt.n_puntos,
    tt.t_ini,
    tt.t_fin,
    greatest(0, floor((extract(epoch from (tt.t_fin - tt.t_ini)) - coalesce(pd.seg_parado, 0)) / 60))::int,
    coalesce(pd.n, 0)
  from totales tt
  left join paradas_dia pd on pd.d = tt.d and pd.u = tt.u
  order by tt.d, tt.u;
end;
$function$;

-- ── 2. vigilancia_equipo ─────────────────────────────────────────────────────────────────────────
-- Cambio único: el mismo filtro en `pts`. De ahí salen `ult` (la última posición conocida),
-- `lejos` (el detector de movimiento con umbral de 40 m) y los minutos de silencio, o sea las tres
-- entradas de los dos avisos.

create or replace function public.vigilancia_equipo(p_min_silencio integer default 30, p_min_quieto integer default 120)
returns table(id_usuario uuid, id_empresa uuid, nombre text, rol text, ultimo_ts timestamp with time zone, minutos_silencio integer, lat double precision, lng double precision, quieto_desde timestamp with time zone, minutos_quieto integer, en_ventana boolean, red text, red_desde timestamp with time zone, arranque_ts timestamp with time zone, apagado_ts timestamp with time zone)
language sql
stable security definer
set search_path to 'public'
as $function$
  with cfg as (
    select
      coalesce(track_enabled, true)              as g_enabled,
      coalesce(nullif(track_start, ''), '07:30') as g_start,
      coalesce(nullif(track_end,   ''), '22:00') as g_end,
      case when track_days is not null and array_length(track_days, 1) > 0
           then track_days end                   as g_days
    from app_config
    limit 1
  ),
  ahora as (
    select (now() at time zone 'America/Argentina/Salta') as l
  ),
  plantel as (
    select p.id, p.id_empresa, p.nombre, p.rol
    from perfiles p
    where p.activo and p.rol in ('vendedor', 'repartidor', 'encargado')
  ),
  vent as (
    select pl.id,
           coalesce(nullif(c.hora_inicio, ''), '07:30') as v_start,
           coalesce(nullif(c.hora_fin,    ''), '22:00') as v_end,
           case when array_length(c.dias, 1) > 0 then c.dias end as v_days,
           true as propia
    from plantel pl
    join perfiles_categorias_rastreo pc on pc.id_usuario = pl.id
    join categorias_rastreo c on c.id = pc.id_categoria
    where c.activo
    union all
    select pl.id, cfg.g_start, cfg.g_end, cfg.g_days, false
    from plantel pl cross join cfg
    where not exists (
      select 1 from perfiles_categorias_rastreo pc2
      join categorias_rastreo c2 on c2.id = pc2.id_categoria
      where pc2.id_usuario = pl.id and c2.activo
    )
  ),
  vf as (
    select
      v.id, v.propia,
      ((v.v_days is null or extract(isodow from a.l)::int = any(v.v_days))
       and (case when split_part(v.v_start, ':', 1)::int * 60 + split_part(v.v_start, ':', 2)::int
                 <= split_part(v.v_end, ':', 1)::int * 60 + split_part(v.v_end, ':', 2)::int
                 then extract(hour from a.l)::int * 60 + extract(minute from a.l)::int
                        >= split_part(v.v_start, ':', 1)::int * 60 + split_part(v.v_start, ':', 2)::int
                  and extract(hour from a.l)::int * 60 + extract(minute from a.l)::int
                        <= split_part(v.v_end, ':', 1)::int * 60 + split_part(v.v_end, ':', 2)::int
                 else extract(hour from a.l)::int * 60 + extract(minute from a.l)::int
                        >= split_part(v.v_start, ':', 1)::int * 60 + split_part(v.v_start, ':', 2)::int
                   or extract(hour from a.l)::int * 60 + extract(minute from a.l)::int
                        <= split_part(v.v_end, ':', 1)::int * 60 + split_part(v.v_end, ':', 2)::int
            end)) as dentro,
      ((case when extract(hour from a.l)::int * 60 + extract(minute from a.l)::int
                  >= split_part(v.v_start, ':', 1)::int * 60 + split_part(v.v_start, ':', 2)::int
             then a.l::date else a.l::date - 1 end)
       + make_interval(mins => split_part(v.v_start, ':', 1)::int * 60 + split_part(v.v_start, ':', 2)::int)
      ) at time zone 'America/Argentina/Salta' as abrio_ts
    from vent v cross join ahora a
  ),
  flags as (
    select
      pl.id, pl.id_empresa, pl.nombre, pl.rol,
      ((bool_or(vf.propia) or cfg.g_enabled) and bool_or(vf.dentro)) as en_ventana,
      max(vf.abrio_ts) as abrio_ts
    from plantel pl
    join vf on vf.id = pl.id
    cross join cfg
    group by pl.id, pl.id_empresa, pl.nombre, pl.rol, cfg.g_enabled
  ),
  pts as (
    select p.id_usuario, p.lat, p.lng, p.ts
    from posiciones p
    join flags f on f.id = p.id_usuario
    where p.id_usuario is not null
      and p.ts >= f.abrio_ts
      -- 🩸 Solo el carril de CONFIANZA (db/33). Un fix de ±120 m supera solo el umbral de 40 m de
      -- `lejos`, así que sin esto un teléfono PARADO parecería moverse y el aviso de quieto no
      -- saldría nunca. Y un teléfono que solo entrega basura contaría como "reportando bien".
      and (p.accuracy is null or p.accuracy <= 30)
  ),
  ult as (
    select distinct on (id_usuario) id_usuario, lat, lng, ts
    from pts
    order by id_usuario, ts desc
  ),
  lejos as (
    select p.id_usuario, max(p.ts) as ts_lejos
    from pts p
    join ult u on u.id_usuario = p.id_usuario
    where 2 * 6371000 * asin(least(1, sqrt(
            power(sin(radians(p.lat - u.lat) / 2), 2) +
            cos(radians(u.lat)) * cos(radians(p.lat)) *
            power(sin(radians(p.lng - u.lng) / 2), 2)
          ))) > 40
    group by 1
  )
  select
    f.id, f.id_empresa, f.nombre, f.rol, u.ts,
    greatest(0, floor(extract(epoch from (now() - greatest(coalesce(u.ts, f.abrio_ts), f.abrio_ts))) / 60))::int,
    u.lat, u.lng,
    coalesce(l.ts_lejos, f.abrio_ts),
    case when u.ts is null then 0
         else greatest(0, floor(extract(epoch from (u.ts - coalesce(l.ts_lejos, f.abrio_ts))) / 60))::int
    end,
    f.en_ventana, ed.red, ed.red_desde, ed.arranque_ts, ed.apagado_ts
  from flags f
  left join ult u                  on u.id_usuario  = f.id
  left join lejos l                on l.id_usuario  = f.id
  left join estado_dispositivo ed  on ed.id_usuario = f.id
  order by f.id_empresa, f.nombre;
$function$;

-- ── 3. Permisos ─────────────────────────────────────────────────────────────────────────────────
-- 🚨 Regla 7-bis: `create or replace` sobre una función existente CONSERVA su ACL, pero Supabase
-- tiene un ALTER DEFAULT PRIVILEGES que da EXECUTE explícito a anon/authenticated, y un grant
-- explícito NO se va con un revoke a PUBLIC. Se re-aplica el criterio de cada una y se VERIFICA el
-- `proacl` real (abajo), en vez de asumir.
--
-- `metricas_actividad` la llama el panel con la sesión del usuario y ya valida el rol adentro
-- (raise 42501), así que necesita EXECUTE para `authenticated` y no para `anon`.
revoke execute on function public.metricas_actividad(date, date) from public;
revoke execute on function public.metricas_actividad(date, date) from anon;
grant  execute on function public.metricas_actividad(date, date) to authenticated;

-- `vigilancia_equipo` es SECURITY DEFINER y CRUZA EMPRESAS (devuelve el plantel de todos los
-- tenants con nombres, roles y coordenadas). La llama SOLO el cron/Edge Function con service_role.
revoke execute on function public.vigilancia_equipo(integer, integer) from public;
revoke execute on function public.vigilancia_equipo(integer, integer) from anon;
revoke execute on function public.vigilancia_equipo(integer, integer) from authenticated;
grant  execute on function public.vigilancia_equipo(integer, integer) to service_role;

-- Verificación obligatoria del ACL (regla 7-bis): vigilancia_equipo NO puede mostrar
-- `anon=X` ni `authenticated=X`.
--   select proname, proacl from pg_proc
--   where proname in ('metricas_actividad','vigilancia_equipo');
