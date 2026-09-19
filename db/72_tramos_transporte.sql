-- 72_tramos_transporte.sql — la "jornada de transporte" como DATO (17/09/2026).
--
-- Pedido del cliente: un botón "Iniciar jornada de transporte" para el vendedor, que suba
-- ubicaciones "más en vivo"; una alerta si se mueve por ruta sin haberlo tocado; el trazo de
-- transporte pintado de otro color en el mapa, con marcas de hora para estimar la velocidad. Y
-- para el repartidor, lo mismo pero abierto solo al marcar el primer "En camino".
--
-- Lo que este archivo NO hace, y por qué:
--   · No cambia la cadencia de captura. Eso vive en el teléfono (`gpsConfig.js` →
--     `uploaderNativo.js` → SharedPreferences). La cadencia rápida de 2 s ya existía; lo que el
--     tramo hace del lado del teléfono es FIJARLA mientras está abierto, igual que
--     `gps_perfil.fijar_cadencia`. Acá solo se guarda desde cuándo hasta cuándo.
--   · No reimplementa la ventana de rastreo (regla 36: ya está tres veces). `vigilancia_transporte`
--     mide movimiento y tramo; `en_ventana` lo sigue diciendo `vigilancia_equipo`, y la Edge
--     Function `alertas-equipo` cruza las dos filas por `id_usuario`.
--   · No agrega columnas a `posiciones` (`speed`/`heading` necesitan APK: van al bloque C del
--     HANDOFF). La velocidad se deriva de hops consecutivos, con un piso de 50 m por hop para que
--     el jitter de ±30 m no cuente como movimiento.
--
-- Cómo se escribe un tramo: lo abre y lo cierra EL TELÉFONO por la cola de escritura
-- (`writeQueue.js`), con `id` generado en el cliente — el `upsert … on conflict (id) do nothing`
-- de la cola hace idempotente el reintento. El índice único parcial de abajo garantiza UN tramo
-- abierto por persona; si dos dispositivos con la misma cuenta abren a la vez, el segundo rebota
-- con 23505 y la cola lo aparta a cuarentena (regla 20), lo cual es correcto: el tramo ya existe.
-- El cron lo cierra (`cierre = 'ventana'`) cuando la persona sale de su ventana de rastreo, y por
-- seguridad a las 14 h (`'cron'`): la ventana sigue mandando, el nativo se pausa fuera de horario
-- aunque el tramo esté abierto (regla 46) y acá solo se cierra el dato.

-- ───────────────────────────────────────────────────────────────────────────────
-- 1. La tabla
-- ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.tramos_transporte (
  id          uuid primary key,                       -- lo genera el TELÉFONO (idempotencia en la cola)
  id_empresa  uuid not null references public.empresas(id) on delete cascade,
  id_usuario  uuid not null references public.perfiles(id) on delete cascade,
  inicio_ts   timestamptz not null,                   -- hora del cliente, como `pedidos.ts_entregado`
  fin_ts      timestamptz,
  origen      text not null check (origen in ('manual', 'reparto')),
  cierre      text check (cierre in ('manual', 'ventana', 'cron')),
  created_at  timestamptz not null default now(),
  check (fin_ts is null or fin_ts >= inicio_ts)
);

-- Un solo tramo abierto por persona. Es también lo que hace que "abrir" sea idempotente del lado
-- del servidor aunque el teléfono mande dos ids distintos.
create unique index if not exists tramos_transporte_abierto_uidx
  on public.tramos_transporte (id_usuario) where fin_ts is null;

-- El panel pide "los tramos de la empresa de tal día".
create index if not exists tramos_transporte_empresa_inicio_idx
  on public.tramos_transporte (id_empresa, inicio_ts);

alter table public.tramos_transporte enable row level security;

-- Calcado de `visitas` (verificado en la base viva el 17/09): el dueño escribe lo suyo, y lo lee
-- él, el admin de su empresa y el encargado que lo tiene a cargo. `marketing` no figura: no ve
-- recorridos, y esto es un recorrido (decisión de privacidad, ver CLAUDE.md §1).
drop policy if exists tramos_ins on public.tramos_transporte;
create policy tramos_ins on public.tramos_transporte
  for insert to authenticated
  with check (id_usuario = auth.uid() and id_empresa = (select mi_empresa()));

drop policy if exists tramos_sel on public.tramos_transporte;
create policy tramos_sel on public.tramos_transporte
  for select
  using (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  );

-- El UPDATE lo usa el teléfono para cerrar (fin_ts, cierre). El supervisor también puede cerrar
-- desde el panel si alguien se olvidó — misma regla que `visitas_upd`.
drop policy if exists tramos_upd on public.tramos_transporte;
create policy tramos_upd on public.tramos_transporte
  for update
  using (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  )
  with check (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  );

grant select, insert, update on public.tramos_transporte to authenticated;
grant all on public.tramos_transporte to service_role;

-- ───────────────────────────────────────────────────────────────────────────────
-- 2. El tercer tipo de aviso, y sus umbrales
-- ───────────────────────────────────────────────────────────────────────────────
-- `alertas_equipo_abierta_uidx (id_usuario, tipo) where resuelta_ts is null` ya dedupea el tipo
-- nuevo (regla 33): no hay nada que agregar en la función.
alter table public.alertas_equipo drop constraint if exists alertas_equipo_tipo_check;
alter table public.alertas_equipo
  add constraint alertas_equipo_tipo_check
  check (tipo in ('sin_reportar', 'quieto', 'transporte_sin_declarar'));

-- Al lado de `alerta_silencio_min` / `alerta_quieto_min` (db/26). Decidido con el cliente el
-- 17/09: dispara la velocidad de RUTA sostenida, no cualquier movimiento en vehículo — un vendedor
-- yendo en auto de comercio a comercio dentro del pueblo no tiene que sonar.
alter table public.app_config
  add column if not exists alerta_transporte_km  numeric default 5,   -- km NETOS en la ventana
  add column if not exists alerta_transporte_min integer default 15;  -- largo de la ventana (min)

-- ───────────────────────────────────────────────────────────────────────────────
-- 3. `vigilancia_transporte` — ¿quién se mueve por ruta sin tramo abierto?
-- ───────────────────────────────────────────────────────────────────────────────
-- Devuelve UNA fila por persona rastreable (mismo plantel que `vigilancia_equipo`), con lo medido
-- en los últimos `p_min` minutos sobre el carril de CONFIANZA (accuracy ≤ 30, regla 18-bis):
--   · km_neto      — distancia entre el primer y el último punto de la ventana. Es lo que separa
--                    "fue de un pueblo a otro" de "dio vueltas por el pueblo".
--   · km_recorrido — suma de hops válidos.
--   · min_a_ruta   — minutos acumulados de hops a ≥ 40 km/h. Espejo de `VEL_RUTA_MPS` (11 m/s,
--                    gpsConfig.js): si ese umbral cambia, cambia acá.
--   · kmh_max      — velocidad máxima medida en un hop válido (informativo, va en el motivo).
--   · desde_ts     — primer hop a velocidad de ruta (el `desde` del aviso).
--   · en_transporte / tramo_id / tramo_desde — si hay tramo abierto.
--   · sospecha     — la decisión, para verificarla con un `select` sin desplegar nada:
--                    km_neto ≥ p_km AND min_a_ruta ≥ p_min_ruta AND no hay tramo abierto.
--
-- Hop válido: dt entre 2 s y 5 min (un hueco más largo no dice a qué velocidad fue) y d ≥ 50 m
-- (`MIN_MOVE_RUTA_M`: por debajo puede ser jitter de un teléfono parado con accuracy 20-30 m).
-- ⚠️ El haversine lleva la guarda `case when lat_prev is null then null` (gotcha de Postgres:
-- `least(1, NULL)` devuelve 1 → `asin(1)` = 20.015 km por fila; ver regla 18-bis).
--
-- SECURITY DEFINER y solo `service_role`, como `vigilancia_equipo`: cruza empresas.
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
    where p.activo and p.rol in ('vendedor', 'repartidor', 'encargado')
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
