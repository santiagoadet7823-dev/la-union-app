-- 21_metricas_actividad.sql — Rol PROPIETARIO, entrega de diseño v1.3 (28/07/2026).
--
-- Agregado de actividad por (día, usuario) para el dashboard del dueño.
--
-- POR QUÉ EN LA BASE Y NO EN EL CLIENTE: `useRecorridosDelDia` baja UN día de `posiciones`
-- paginando de a 1.000 filas. El dashboard del dueño tiene horizontes de semana y mes: al 28/07
-- un mes son ~150.000 filas (37.569 en solo 8 días, con picos de 11.259 en un día). Bajar eso a
-- un teléfono barato por datos móviles no es una opción. La agregación va donde están los datos.
--
-- SEGURIDAD:
--   - `security definer` porque salta RLS a propósito: el propietario tiene SELECT sobre
--     `posiciones` pero la agregación necesita recorrer la empresa entera sin paginar.
--   - El alcance de tenant va ADENTRO (`id_empresa = mi_empresa()`), NO por parámetro. Si la
--     empresa la eligiera el cliente, cualquier usuario autenticado podría pedir la actividad de
--     otra distribuidora. Es el mismo criterio de la regla 11 de CLAUDE.md.
--   - Guarda de rol: solo quien ya puede ver el equipo. Un vendedor no tiene por qué leer los
--     kilómetros de sus compañeros.
--
-- FECHAS: el día se bucketea en `America/Argentina/Salta`, no en UTC. Es el equivalente SQL de la
-- regla 23 (`hoyStr()`): en UTC los días se corren de 21:00 a 24:00 y la jornada del martes a la
-- noche aparecería como miércoles. Ese bug ya vació el mapa de Supervisión una vez.

create or replace function public.metricas_actividad(p_desde date, p_hasta date)
returns table (
  dia                 date,
  id_usuario          uuid,
  km                  numeric,
  puntos              integer,
  primer_ts           timestamptz,
  ultimo_ts           timestamptz,
  minutos_movimiento  integer,
  paradas             integer
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_rol text := mi_rol();
begin
  if v_rol is null or v_rol not in ('propietario', 'admin', 'superadmin', 'encargado') then
    raise exception 'Sin permiso para leer las métricas del equipo.' using errcode = '42501';
  end if;

  -- Techo de ventana: 400 días. No es una regla de negocio, es un tope para que un parámetro
  -- absurdo (o un bug de cliente) no dispare un scan de años sobre `posiciones`.
  if p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango de fechas inválido.' using errcode = '22023';
  end if;

  return query
  with base as (
    select
      p.id_usuario                                              as u,
      (p.ts at time zone 'America/Argentina/Salta')::date        as d,
      p.ts                                                      as t,
      p.id                                                      as pid,
      p.lat, p.lng
    from posiciones p
    where p.id_empresa = mi_empresa()
      and p.ts >= ((p_desde::timestamp)     at time zone 'America/Argentina/Salta')
      and p.ts <  (((p_hasta + 1)::timestamp) at time zone 'America/Argentina/Salta')
      and p.id_usuario is not null
  ),
  -- Segmento = punto actual contra el anterior de la MISMA persona en el MISMO día.
  --
  -- El desempate por `pid` no es decorativo: sin un orden TOTAL, dos filas con el mismo `ts`
  -- quedan en orden indefinido y el `lag` puede emparejar mal. Es el mismo motivo por el que
  -- `useRecorridosDelDia` ordena por (ts, id) al paginar.
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
  -- Haversine a mano: la base no tiene PostGIS ni earthdistance (verificado 28/07/2026).
  -- Radio 6371000 m, el mismo que usa `distanciaMetros` en el cliente, así que `sum(metros)/1000`
  -- da EXACTAMENTE lo que da `kmDeTrazo()` sobre los mismos puntos. Esa igualdad es la prueba de
  -- que la RPC no inventa nada: se puede contrastar contra la pantalla de Supervisión.
  --
  -- Igual que `kmDeTrazo`, NO se filtra el jitter: suma todos los tramos consecutivos. Si algún
  -- día se agrega un umbral, hay que agregarlo en los dos lados a la vez o los números divergen.
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
  -- Un tramo "rompe" la quietud si se alejó 40 m o más del fix anterior. 40 m es el mismo radio
  -- que `DWELL_RADIO_M` en dwell.js y que `STATIONARY_R` en la Edge Function: umbral ya calibrado.
  marca as (
    select d, u, t, t_prev, metros,
           case when metros is null or metros >= 40 then 1 else 0 end as rompe
    from dist
  ),
  -- Islas: los puntos consecutivos que no rompieron comparten grupo. Cada grupo es un racimo
  -- de fixes en el mismo lugar; si duró 5 minutos o más, es una parada.
  --
  -- 🩸 ESTO NO ES EL MISMO ALGORITMO QUE `detectarParadas` (dwell.js), y a propósito. Aquel usa
  -- una ventana deslizante con centro por MEDIANA (robusta a outliers) y no es reproducible en
  -- SQL sin un procedural caro. Este es un gap-and-island: más simple, un poco más generoso al
  -- cortar. Los conteos pueden diferir en ±1 parada sobre una jornada. Por eso el dashboard del
  -- dueño lee SIEMPRE esta RPC (también para "hoy") y nunca mezcla las dos fuentes: si un
  -- horizonte se calculara en el cliente y otro acá, el total de la semana no cerraría con la
  -- suma de sus días y el dueño vería una pantalla que se contradice a sí misma.
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
           count(*)::int                                as n,
           sum(extract(epoch from (fin - ini)))::numeric as seg_parado
    from racimos
    -- 5 minutos: es el rótulo que lee el dueño ("Paradas de 5 min o más"). OJO: `DWELL_MIN_MS`
    -- del cliente son 3 min, un umbral distinto para otra cosa (los carteles del mapa). La lista
    -- "Dónde estuvo parado" del detalle de persona filtra a 5 min para que coincida con este conteo.
    where fin - ini >= interval '5 minutes'
    group by d, u
  ),
  totales as (
    select d, u,
           coalesce(sum(metros), 0) / 1000.0 as km_dia,
           count(*)::int                     as n_puntos,
           min(t)                            as t_ini,
           max(t)                            as t_fin
    from dist
    group by d, u
  )
  -- Tiempo en movimiento = jornada MENOS lo que estuvo parado.
  --
  -- 🩸 El primer intento fue "sumar los tramos que se alejaron 40 m o más del fix anterior", y daba
  -- números absurdos: 24 minutos de movimiento en un día de 357 km. El motivo es que 40 m es el
  -- umbral para cortar un racimo, no para decidir si alguien se está moviendo — a 15 s de cadencia,
  -- caminando o en tránsito lento, cada tramo mide 20 m y quedaba clasificado como quieto. Restar
  -- las paradas al total es además la definición literal del diseñador: "porción de la jornada con
  -- desplazamiento, sobre el total entre el primer y el último punto".
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
$$;

-- Regla 7: se revoca de PUBLIC (que es de donde Postgres lo concede por defecto y de donde anon y
-- authenticated lo heredan). Revocar "from anon, authenticated" sería un NO-OP.
revoke execute on function public.metricas_actividad(date, date) from public;
revoke execute on function public.metricas_actividad(date, date) from anon;
grant  execute on function public.metricas_actividad(date, date) to authenticated;
