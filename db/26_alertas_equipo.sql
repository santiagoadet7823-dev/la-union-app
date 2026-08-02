-- 26 · Vigilancia del equipo: avisar al supervisor cuando alguien deja de reportar o queda quieto.
--
-- ⚠️ Este archivo es el REGISTRO de lo que se aplicó en la base viva el 30/07/2026, no la fuente de
-- verdad (regla 5 de CLAUDE.md). Ya está aplicado. No re-ejecutarlo a ciegas.
--
-- El diseño en una línea: **la detección vive en SQL y la Edge Function solo manda los push.**
-- Motivo: una función pura se verifica con un `select` contra la base viva, sin desplegar nada y sin
-- esperar a que corra un cron. En un repo sin tests eso no es un lujo, es la única verificación real
-- que existe.

-- ---------------------------------------------------------------------------------------------
-- 1) Umbrales configurables (globales, igual que la ventana de rastreo que ya vive acá).
-- ---------------------------------------------------------------------------------------------
alter table public.app_config
  add column if not exists alertas_activas    boolean not null default true,
  add column if not exists alerta_silencio_min integer not null default 30,
  add column if not exists alerta_quieto_min   integer not null default 120;

comment on column public.app_config.alerta_silencio_min is
  'Minutos sin reportar posiciones, DENTRO de la ventana de rastreo, que abren un aviso al supervisor.';
comment on column public.app_config.alerta_quieto_min is
  'Minutos en el mismo lugar (radio de 40 m) que abren un aviso. Solo cuenta si la persona SIGUE reportando.';

-- ---------------------------------------------------------------------------------------------
-- 2) Diagnóstico del teléfono. Lo llena el servicio nativo (APK 1.7.0+); antes de eso queda null.
--
--    Sirve para EXPLICAR un silencio, no para detectarlo: el teléfono solo puede contar que estuvo
--    sin red cuando vuelve a tener red. Desde el servidor, "apagado", "modo avión" y "sin cobertura"
--    son indistinguibles mientras están pasando — en los tres casos no llega nada.
-- ---------------------------------------------------------------------------------------------
alter table public.estado_dispositivo
  add column if not exists red         text,          -- 'ok' | 'sin-red' | 'avion'
  add column if not exists red_desde   timestamptz,   -- desde cuándo está así
  add column if not exists apagado_ts  timestamptz,   -- último apagado detectado (best-effort)
  add column if not exists arranque_ts timestamptz;   -- último BOOT_COMPLETED

-- ---------------------------------------------------------------------------------------------
-- 3) vigilancia_equipo(): una fila por persona rastreada, con todo lo necesario para decidir.
--
--    `en_ventana` es el espejo EXACTO de dentroDeHorario() (src/services/tracking.js:73-89),
--    incluido el detalle de que un usuario con categoría de rastreo activa IGNORA el
--    `track_enabled` global (cfgOverride devuelve `enabled: true`, tracking.js:46). Si eso alguna
--    vez cambia en el JS, hay que cambiarlo acá también: son dos implementaciones del mismo
--    contrato y no hay nada que las mantenga sincronizadas.
--
--    `minutos_silencio` se mide desde el ÚLTIMO de estos dos: el último punto que mandó, o el
--    momento en que abrió su ventana de hoy. Con eso, una sola métrica cubre los dos casos que le
--    importan al supervisor —"dejó de reportar" y "nunca arrancó"— y nadie recibe un aviso porque
--    alguien está de vacaciones desde el martes.
--
--    `minutos_quieto` se mide contra el último punto, NO contra now(): si dejó de reportar también
--    está trivialmente "quieto", y ese caso ya lo cubre el silencio. Quién decide es la Edge
--    Function, que solo abre un aviso de quieto si la persona SIGUE reportando.
--
--    La expresión de haversine y el corte de 40 m son los MISMOS que usa metricas_actividad
--    (db/21), para que dos pantallas no midan la misma parada distinto. Esta base no tiene PostGIS
--    ni earthdistance (verificado 30/07/2026), así que la fórmula va escrita.
-- ---------------------------------------------------------------------------------------------
create or replace function public.vigilancia_equipo(
  p_min_silencio integer default 30,
  p_min_quieto   integer default 120
)
returns table (
  id_usuario       uuid,
  id_empresa       uuid,
  nombre           text,
  rol              text,
  ultimo_ts        timestamptz,
  minutos_silencio integer,
  lat              double precision,
  lng              double precision,
  quieto_desde     timestamptz,
  minutos_quieto   integer,
  en_ventana       boolean,
  red              text,
  red_desde        timestamptz,
  arranque_ts      timestamptz,
  apagado_ts       timestamptz
)
language sql
stable
security definer
set search_path = 'public'
as $$
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
    -- Regla 23: hora y día en LOCAL, nunca UTC. Salta es UTC−3 sin horario de verano.
    select (now() at time zone 'America/Argentina/Salta') as l
  ),
  plantel as (
    select
      p.id, p.id_empresa, p.nombre, p.rol,
      (c.id is not null and c.activo) as override,
      c.hora_inicio, c.hora_fin, c.dias
    from perfiles p
    left join categorias_rastreo c on c.id = p.id_categoria_rastreo
    where p.activo and p.rol in ('vendedor', 'repartidor', 'encargado')
  ),
  ventana as (
    select
      pl.id, pl.id_empresa, pl.nombre, pl.rol,
      -- El override manda sobre el global, con los mismos fallbacks que cfgOverride().
      case when pl.override then true else cfg.g_enabled end as habilitado,
      coalesce(case when pl.override then nullif(pl.hora_inicio, '') end, cfg.g_start) as v_start,
      coalesce(case when pl.override then nullif(pl.hora_fin,    '') end, cfg.g_end)   as v_end,
      coalesce(
        case when pl.override and array_length(pl.dias, 1) > 0 then pl.dias end,
        cfg.g_days
      ) as v_days
    from plantel pl
    cross join cfg
  ),
  eval as (
    select
      v.*,
      a.l,
      split_part(v.v_start, ':', 1)::int * 60 + split_part(v.v_start, ':', 2)::int as m_start,
      split_part(v.v_end,   ':', 1)::int * 60 + split_part(v.v_end,   ':', 2)::int as m_end,
      extract(hour from a.l)::int * 60 + extract(minute from a.l)::int             as m_cur,
      extract(isodow from a.l)::int                                               as dow
    from ventana v
    cross join ahora a
  ),
  flags as (
    select
      e.*,
      (
        e.habilitado
        and (e.v_days is null or e.dow = any(e.v_days))
        and (case when e.m_start <= e.m_end
                  then e.m_cur >= e.m_start and e.m_cur <= e.m_end
                  -- Cruce de medianoche ('22:00'–'06:00'): igual que la rama else del JS.
                  else e.m_cur >= e.m_start or  e.m_cur <= e.m_end
             end)
      ) as en_ventana,
      -- Último momento en que ABRIÓ su ventana. Si el minuto de inicio todavía no llegó hoy, el
      -- que corresponde es el de ayer (el caso del cruce de medianoche).
      ((case when e.m_cur >= e.m_start then e.l::date else e.l::date - 1 end)
         + make_interval(mins => e.m_start)) at time zone 'America/Argentina/Salta' as abrio_ts
    from eval e
  ),
  pts as (
    select p.id_usuario, p.lat, p.lng, p.ts
    from posiciones p
    join flags f on f.id = p.id_usuario
    where p.id_usuario is not null
      and p.ts >= f.abrio_ts
  ),
  ult as (
    select distinct on (id_usuario) id_usuario, lat, lng, ts
    from pts
    order by id_usuario, ts desc
  ),
  lejos as (
    -- El punto MÁS RECIENTE que estuvo a más de 40 m de donde está ahora: desde ahí está quieto.
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
    f.id,
    f.id_empresa,
    f.nombre,
    f.rol,
    u.ts,
    greatest(0, floor(extract(epoch from (now() - greatest(coalesce(u.ts, f.abrio_ts), f.abrio_ts))) / 60))::int,
    u.lat,
    u.lng,
    coalesce(l.ts_lejos, f.abrio_ts),
    case when u.ts is null then 0
         else greatest(0, floor(extract(epoch from (u.ts - coalesce(l.ts_lejos, f.abrio_ts))) / 60))::int
    end,
    f.en_ventana,
    ed.red,
    ed.red_desde,
    ed.arranque_ts,
    ed.apagado_ts
  from flags f
  left join ult u                  on u.id_usuario  = f.id
  left join lejos l                on l.id_usuario  = f.id
  left join estado_dispositivo ed  on ed.id_usuario = f.id
  order by f.id_empresa, f.nombre;
$$;

comment on function public.vigilancia_equipo(integer, integer) is
  'Estado de vigilancia por persona rastreada: silencio, permanencia y ventana horaria vigente. La '
  'usa la Edge Function alertas-equipo. Los parámetros están para poder auditarla a mano con otros '
  'umbrales; la función no decide nada, solo mide.';

-- 🚨 Regla 7: `from public`, NUNCA `from anon, authenticated` (eso es un no-op: heredan de PUBLIC).
-- Esta función es security definer y cruza empresas: si `authenticated` pudiera ejecutarla,
-- cualquier vendedor vería el plantel completo de todos los tenants.
revoke execute on function public.vigilancia_equipo(integer, integer) from public;
grant  execute on function public.vigilancia_equipo(integer, integer) to service_role;

-- ---------------------------------------------------------------------------------------------
-- 4) Los incidentes son FILAS, no eventos.
--
--    🔑 El índice único parcial de más abajo ES el antirrebote. Con un solo incidente abierto por
--    persona y por tipo, el cron puede correr cada 10 minutos sin mandar 6 avisos por hora, y no
--    hace falta ningún estado en la Edge Function. Si algún día se le saca el `where`, el equipo
--    empieza a recibir un push cada 10 minutos por la misma persona.
-- ---------------------------------------------------------------------------------------------
create table if not exists public.alertas_equipo (
  id           uuid primary key default gen_random_uuid(),
  id_empresa   uuid not null references public.empresas(id) on delete cascade,
  id_usuario   uuid not null references public.perfiles(id) on delete cascade,
  tipo         text not null check (tipo in ('sin_reportar', 'quieto')),
  desde        timestamptz not null,
  detectada_ts timestamptz not null default now(),
  avisada_ts   timestamptz,
  resuelta_ts  timestamptz,
  minutos      integer,
  lat          double precision,
  lng          double precision,
  -- Por qué pasó, cuando el teléfono lo pudo contar (sin internet / modo avión / se reinició).
  -- Va como texto y no como tipo aparte a propósito: es la EXPLICACIÓN de un incidente, no otro
  -- incidente. Un aviso de "sin red" además del de silencio serían dos push por el mismo hecho.
  motivo       text,
  vista_por    uuid[] not null default '{}'::uuid[]
);

create unique index if not exists alertas_equipo_abierta_uidx
  on public.alertas_equipo (id_usuario, tipo)
  where resuelta_ts is null;

create index if not exists alertas_equipo_empresa_idx
  on public.alertas_equipo (id_empresa, detectada_ts desc);

alter table public.alertas_equipo enable row level security;

-- Lectura: los que supervisan esa empresa, y el superadmin. Mismo criterio que posiciones_sel.
drop policy if exists alertas_sel on public.alertas_equipo;
create policy alertas_sel on public.alertas_equipo for select
  using (
    (select es_superadmin())
    or (id_empresa = (select mi_empresa())
        and (select mi_rol()) = any (array['admin', 'encargado', 'propietario']))
  );

-- Escritura desde el cliente: SOLO para marcarla como vista. No hay policy de INSERT ni de DELETE
-- porque los incidentes los crea la Edge Function con el service_role, que no pasa por RLS.
drop policy if exists alertas_upd on public.alertas_equipo;
create policy alertas_upd on public.alertas_equipo for update
  using (
    id_empresa = (select mi_empresa())
    and (select mi_rol()) = any (array['admin', 'encargado', 'propietario'])
  )
  with check (
    id_empresa = (select mi_empresa())
    and (select mi_rol()) = any (array['admin', 'encargado', 'propietario'])
  );

-- ---------------------------------------------------------------------------------------------
-- 5) El cron. NO se escribe a mano: se DERIVA del de push-heartbeat cambiándole la URL, para no
--    copiar la credencial del header a ningún lado (regla 25 — referenciar por ubicación, nunca
--    transcribir el valor).
--
--    ⚠️ `timeout_milliseconds` es obligatorio: el default de pg_net son 5 s y esta función manda
--    los push en serie. El cron de push-heartbeat llevaba desde que existe sin pasarlo — se
--    corrigió en la misma pasada (30/07/2026).
--
--    El comando termina en " ) " (con espacios), no en "));": de ahí el regexp anclado al final.
-- ---------------------------------------------------------------------------------------------
-- select cron.schedule(
--   'alertas-equipo-10min', '*/10 * * * *',
--   (select regexp_replace(
--             replace(command, '/push-heartbeat', '/alertas-equipo'),
--             '\)\s*$', ', timeout_milliseconds := 60000)')
--      from cron.job where jobname = 'push-heartbeat-30min')
-- );
--
-- -- y el arreglo del timeout que le faltaba al heartbeat:
-- select cron.schedule(
--   'push-heartbeat-30min', '*/30 * * * *',
--   (select regexp_replace(command, '\)\s*$', ', timeout_milliseconds := 60000)')
--      from cron.job where jobname = 'push-heartbeat-30min')
-- );

-- ---------------------------------------------------------------------------------------------
-- 6) Hallazgo de la verificación (30/07/2026), anotado acá porque se va a repetir:
--
--    La primera corrida real devolvió `fallidos: 1` con **404 NotRegistered**. Había un token FCM
--    muerto guardado en `estado_dispositivo` (un teléfono con la app 1.6.6 y sin latido desde el
--    día anterior). Un token muerto no se cura solo: queda ahí para siempre, desperdicia un envío
--    por cada aviso, y —lo peor— deja `fallidos` clavado en un número > 0, que es exactamente lo
--    que hace que nadie note una falla de verdad.
--
--    La función ahora los borra (`fcm_token = null`) cuando FCM responde 404/NotRegistered o
--    INVALID_ARGUMENT. Se vuelve a llenar solo cuando ese teléfono abre la app y se registra.
--    Un fallo de RED no cuenta como token muerto: eso se reintenta.
-- ---------------------------------------------------------------------------------------------

-- ---------------------------------------------------------------------------------------------
-- 7) 🚨 HALLAZGO DE SEGURIDAD (30/07/2026) — la regla 7 estaba INCOMPLETA para funciones nuevas.
--
--    La regla dice: "`revoke execute ... from public`, nunca `from anon, authenticated`", porque
--    Postgres concede EXECUTE a PUBLIC por defecto y anon/authenticated lo HEREDAN — revocarles a
--    ellos es un no-op. Todo eso es cierto.
--
--    Lo que NO contempla: Supabase tiene un `ALTER DEFAULT PRIVILEGES` que le da EXECUTE
--    **EXPLÍCITO** a `anon` y `authenticated` sobre CADA función nueva creada en `public`. Un
--    grant explícito no se va con un revoke a PUBLIC.
--
--    Medido acá mismo: después del `revoke ... from public` de la sección 3, el ACL de
--    `vigilancia_equipo` seguía siendo `anon=X | authenticated=X | service_role=X`. Como es
--    SECURITY DEFINER y cruza empresas, **cualquier vendedor logueado podía leer el plantel
--    completo de todos los tenants**: nombres, roles, última posición y coordenadas.
--
--    Regla corregida: en una función security definer que no deba ser pública hay que revocar de
--    los TRES. El revoke a PUBLIC sigue siendo obligatorio — es el que tapa el agujero heredado.
--
--      revoke execute on function public.vigilancia_equipo(integer, integer) from public;
--      revoke execute on function public.vigilancia_equipo(integer, integer) from anon;
--      revoke execute on function public.vigilancia_equipo(integer, integer) from authenticated;
--      grant  execute on function public.vigilancia_equipo(integer, integer) to service_role;
--
--    Estado final verificado: `postgres=X | service_role=X` y nada más.
