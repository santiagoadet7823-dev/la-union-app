-- 69 — `metricas_actividad`: `mi_empresa()` resuelta una vez, no por fila (16/09/2026)
--
-- Aplicada en la base viva el 16/09/2026 (MCP, apply_migration). Misma firma, mismo resultado,
-- mismos permisos (`create or replace` conserva el ACL: postgres, authenticated, service_role).
--
-- Por qué. Al montar el dashboard con gráficos, el horizonte "semana" (35 días de RPC) daba
-- 57014 "canceling statement due to statement timeout" (8 s del rol `authenticated`), y partido
-- en tramos de 7 días TAMBIÉN: medido desde el navegador, un tramo de 7 días tardaba > 8 s, uno
-- de 4 días 6,1 s, uno de 1 día 1,9 s. Con `explain analyze` sobre la CTE `base`: el filtro
-- `p.id_empresa = mi_empresa()` aparece en el `Filter` del index scan, o sea que `mi_empresa()`
-- —SQL, SECURITY DEFINER, no inlineable— se ejecutaba UNA VEZ POR FILA: 135.000 llamadas por
-- semana, cada una un `select` a `perfiles` y un `auth.uid()` que parsea el JSON de los claims.
-- Hoisted a una variable, medido DESDE EL NAVEGADOR (PostgREST, superadmin) sobre las mismas
-- 135.129 filas: 7 días **> 8.000 ms (timeout) → 649-1.582 ms**; 1 día 1.880 → 144-342 ms. Por
-- el MCP (sin JWT real, claims sintéticos) la diferencia era menor (4,95 → 3,32 s): el costo por
-- fila de `auth.uid()` es mucho mayor con un JWT de verdad, y por eso "en la base anda" no era
-- una medición válida del problema.
--
-- Cambio único: `v_empresa uuid := mi_empresa()` en el `declare` y `p.id_empresa = v_empresa` en
-- el `where`. Es el mismo patrón que ya usan `metricas_venta` (db/56) y db/68.
--
-- ⚠️ Lo que sigue costando y NO se tocó: cada día de la empresa son ~18.000 filas de `posiciones`
-- que se leen enteras para sumar 60 filas de salida. El arreglo de fondo es materializar el
-- agregado por día (una tabla `metricas_actividad_dia` que un cron llene a la madrugada para el
-- día cerrado) y que la RPC sólo calcule HOY. Queda propuesto en PROPUESTAS_ADMIN.md. Mientras
-- tanto, el cliente pide el histórico en tramos de 7 días (~1-1,6 s cada uno) y lo cachea día
-- por día (`useMetricasActividad`, 16/09/2026), así un día pasado se calcula una sola vez por
-- usuario.

create or replace function public.metricas_actividad(p_desde date, p_hasta date)
returns table(dia date, id_usuario uuid, km numeric, puntos integer,
              primer_ts timestamp with time zone, ultimo_ts timestamp with time zone,
              minutos_movimiento integer, paradas integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rol     text := mi_rol();
  -- db/69: resuelta UNA vez. En el `where` se evaluaba por fila (ver encabezado).
  v_empresa uuid := mi_empresa();
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
    where p.id_empresa = v_empresa
      and p.ts >= ((p_desde::timestamp)       at time zone 'America/Argentina/Salta')
      and p.ts <  (((p_hasta + 1)::timestamp) at time zone 'America/Argentina/Salta')
      and p.id_usuario is not null
      -- Solo el carril de CONFIANZA (db/33). Espeja ACCURACY_MAX_M de gpsConfig.js.
      and (p.accuracy is null or p.accuracy <= 30)
      -- 🔴 db/40 — JERARQUÍA. Esta función saltea RLS, así que el recorte va acá o no va.
      and (v_rol <> 'encargado' or p.id_usuario in (select ids_a_mi_cargo()))
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
