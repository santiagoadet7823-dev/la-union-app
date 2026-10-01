-- db/85 — La jornada de transporte es SOLO del repartidor (01/10/2026).
--
-- Contexto: db/72 (17/09/2026) abrió el "modo transporte" a vendedor, repartidor y encargado, con un
-- botón en el Inicio del vendedor y del repartidor. El dueño lo quiere SÓLO para el reparto: el front
-- (rama fix/transporte-solo-reparto) saca el botón del Inicio del vendedor (que también usa el
-- encargado en su jornada) y deja el tramo sólo en `RepartidorView`.
--
-- Por qué hace falta esta migración: `vigilancia_transporte` (la usa la Edge Function
-- `alertas-equipo` para la alerta "en ruta sin declarar") seguía mirando a vendedores y encargados.
-- Sin botón para declarar, cualquier vendedor que maneje entre pueblos quedaría marcado como
-- "en ruta sin declarar" en cada tanda. El único cambio es el plantel: ('repartidor').
--
-- Todo lo demás es IDÉNTICO a db/72 (cuerpo, firma, SECURITY DEFINER, search_path y grants), copiado
-- tal cual. La Edge Function no cambia: consume las filas que devuelve la función.
--
-- ⚠️ Antes de aplicar: comparar `pg_get_functiondef('public.vigilancia_transporte(integer,numeric,numeric)'::regprocedure)`
-- con db/72 por si alguien la redefinió en vivo; y `select proacl from pg_proc where proname = 'vigilancia_transporte'`
-- antes y después (receta 7-bis: solo service_role).
-- Volver atrás: re-ejecutar el bloque de la función de db/72.

create or replace function public.vigilancia_transporte(
  p_min      integer default 15,
  p_km       numeric default 5,
  p_min_ruta numeric default 3
)
returns table (
  id_usuario     uuid,
  id_empresa     uuid,
  nombre         text,
  rol            text,
  km_neto        numeric,
  km_recorrido   numeric,
  min_a_ruta     numeric,
  kmh_max        numeric,
  desde_ts       timestamptz,
  ultimo_ts      timestamptz,
  lat            double precision,
  lng            double precision,
  en_transporte  boolean,
  tramo_id       uuid,
  tramo_desde    timestamptz,
  sospecha       boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with plantel as (
    select p.id, p.id_empresa, p.nombre, p.rol
    from perfiles p
    where p.activo and p.rol = 'repartidor'  -- db/85: antes ('vendedor','repartidor','encargado')
  ),
  pts as (
    select p.id_usuario, p.lat, p.lng, p.ts,
           lag(p.lat) over w as lat_prev,
           lag(p.lng) over w as lng_prev,
           lag(p.ts)  over w as ts_prev
    from posiciones p
    join plantel pl on pl.id = p.id_usuario
    where p.ts >= now() - make_interval(mins => p_min)
      and (p.accuracy is null or p.accuracy <= 30)
    window w as (partition by p.id_usuario order by p.ts, p.id)
  ),
  hops as (
    select id_usuario, ts, lat, lng,
           case when lat_prev is null then null
                else 2 * 6371000 * asin(least(1, sqrt(
                       power(sin(radians(lat - lat_prev) / 2), 2) +
                       cos(radians(lat_prev)) * cos(radians(lat)) *
                       power(sin(radians(lng - lng_prev) / 2), 2))))
           end as d,
           extract(epoch from (ts - ts_prev)) as dt
    from pts
  ),
  validos as (
    select * from hops
    where d is not null and dt between 2 and 300 and d >= 50
  ),
  agg as (
    select id_usuario,
           round((sum(d) / 1000)::numeric, 2)                                  as km_recorrido,
           round((coalesce(sum(dt) filter (where d / dt >= 11.111), 0) / 60)::numeric, 1) as min_a_ruta,
           round((max(d / dt) * 3.6)::numeric, 0)                                as kmh_max,
           min(ts) filter (where d / dt >= 11.111)                              as desde_ts
    from validos
    group by 1
  ),
  primero as (
    select distinct on (id_usuario) id_usuario, lat, lng
    from pts order by id_usuario, ts asc
  ),
  ultimo as (
    select distinct on (id_usuario) id_usuario, lat, lng, ts
    from pts order by id_usuario, ts desc
  ),
  neto as (
    select u.id_usuario,
           round((2 * 6371000 * asin(least(1, sqrt(
             power(sin(radians(u.lat - f.lat) / 2), 2) +
             cos(radians(f.lat)) * cos(radians(u.lat)) *
             power(sin(radians(u.lng - f.lng) / 2), 2)))) / 1000)::numeric, 2) as km_neto
    from ultimo u join primero f on f.id_usuario = u.id_usuario
  )
  select
    pl.id, pl.id_empresa, pl.nombre, pl.rol,
    coalesce(n.km_neto, 0),
    coalesce(a.km_recorrido, 0),
    coalesce(a.min_a_ruta, 0),
    coalesce(a.kmh_max, 0),
    a.desde_ts,
    u.ts, u.lat, u.lng,
    (t.id is not null),
    t.id, t.inicio_ts,
    (t.id is null and coalesce(n.km_neto, 0) >= p_km and coalesce(a.min_a_ruta, 0) >= p_min_ruta)
  from plantel pl
  left join agg    a on a.id_usuario = pl.id
  left join neto   n on n.id_usuario = pl.id
  left join ultimo u on u.id_usuario = pl.id
  left join lateral (
    select tt.id, tt.inicio_ts from tramos_transporte tt
    where tt.id_usuario = pl.id and tt.fin_ts is null
    limit 1
  ) t on true
  order by pl.id_empresa, pl.nombre;
$$;

-- Receta 7-bis: revocar de los TRES y verificar el ACL real (`select proacl from pg_proc`).
revoke execute on function public.vigilancia_transporte(integer, numeric, numeric) from public;
revoke execute on function public.vigilancia_transporte(integer, numeric, numeric) from anon;
revoke execute on function public.vigilancia_transporte(integer, numeric, numeric) from authenticated;
grant  execute on function public.vigilancia_transporte(integer, numeric, numeric) to service_role;

-- Verificación (no modifica nada):
--   select proacl from pg_proc where proname = 'vigilancia_transporte';           -- solo service_role
--   select distinct rol from public.vigilancia_transporte();                       -- solo 'repartidor'
