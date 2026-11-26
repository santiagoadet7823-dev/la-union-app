-- 116_monitoreo_dispositivos.sql — Plan 54 (26/11/2026): monitoreo de teléfonos designados por el superadmin.
--
-- Carteles en el teléfono (batería < umbral hasta volver al umbral, ahorro de energía, ubicación apagada,
-- permiso, puntos sin subir, versión vieja, temperatura), push con la app cerrada, alerta al superadmin,
-- "se apagó por batería" y el tablero "Salud del parque".
--
-- Decisión del usuario: SOLO teléfonos con APK piloto (>= 1.46.1). Aunque el superadmin designe a alguien
-- con el APK del parque, ni el teléfono ni el servidor hacen nada (`monitoreo_vigente`).

create or replace function public._apk_ge(p_version text, p_min int[])
returns boolean
language sql
immutable
as $$
  select case
    when p_version is null or p_version !~ '^\d+(\.\d+)*$' then false
    else string_to_array(p_version, '.')::int[] >= p_min
  end;
$$;

create table if not exists public.dispositivo_monitoreo (
  id_usuario        uuid primary key references public.perfiles(id) on delete cascade,
  id_empresa        uuid not null references public.empresas(id) on delete cascade,
  activo            boolean not null default true,
  bateria_min       integer not null default 40 check (bateria_min between 5 and 95),
  aviso_ahorro      boolean not null default true,
  avisos_extra      boolean not null default true,
  push              boolean not null default true,
  alerta_superadmin boolean not null default true,
  temp_max          numeric(4,1) not null default 45 check (temp_max between 30 and 70),
  nota              text,
  creado_por        uuid references public.perfiles(id) on delete set null,
  updated_at        timestamptz not null default now()
);

alter table public.dispositivo_monitoreo enable row level security;

drop policy if exists dispositivo_monitoreo_sel on public.dispositivo_monitoreo;
create policy dispositivo_monitoreo_sel on public.dispositivo_monitoreo
  for select using (es_superadmin() or id_usuario = auth.uid());
drop policy if exists dispositivo_monitoreo_ins on public.dispositivo_monitoreo;
create policy dispositivo_monitoreo_ins on public.dispositivo_monitoreo
  for insert with check (es_superadmin());
drop policy if exists dispositivo_monitoreo_upd on public.dispositivo_monitoreo;
create policy dispositivo_monitoreo_upd on public.dispositivo_monitoreo
  for update using (es_superadmin()) with check (es_superadmin());
drop policy if exists dispositivo_monitoreo_del on public.dispositivo_monitoreo;
create policy dispositivo_monitoreo_del on public.dispositivo_monitoreo
  for delete using (es_superadmin());

revoke all on public.dispositivo_monitoreo from anon;
grant select, insert, update, delete on public.dispositivo_monitoreo to authenticated;

alter table public.estado_dispositivo
  add column if not exists bateria_pct     integer,
  add column if not exists cargando        boolean,
  add column if not exists bateria_ts      timestamptz,
  add column if not exists bateria_temp    numeric(4,1),
  add column if not exists bateria_critica boolean;

create table if not exists public.dispositivo_alertas (
  id          bigint generated always as identity primary key,
  id_usuario  uuid not null references public.perfiles(id) on delete cascade,
  id_empresa  uuid not null references public.empresas(id) on delete cascade,
  tipo        text not null check (tipo in ('bateria_critica', 'ahorro', 'ubicacion_apagada', 'permiso_ubicacion',
                'sin_subir', 'version_vieja', 'temperatura', 'apagado_bateria', 'sin_senal')),
  origen      text not null default 'telefono' check (origen in ('telefono', 'servidor')),
  abierta_ts  timestamptz not null default now(),
  cerrada_ts  timestamptz,
  bateria_pct integer,
  bateria_cierre integer,
  detalle     jsonb,
  push_ts     timestamptz,
  push_n      integer not null default 0,
  aviso_admin_ts timestamptz
);

create unique index if not exists dispositivo_alertas_abierta_uidx
  on public.dispositivo_alertas (id_usuario, tipo) where cerrada_ts is null;
create index if not exists dispositivo_alertas_usuario_ts_idx
  on public.dispositivo_alertas (id_usuario, abierta_ts desc);

alter table public.dispositivo_alertas enable row level security;
drop policy if exists dispositivo_alertas_sel on public.dispositivo_alertas;
create policy dispositivo_alertas_sel on public.dispositivo_alertas
  for select using (es_superadmin());
revoke all on public.dispositivo_alertas from anon, authenticated;
grant select on public.dispositivo_alertas to authenticated;

create or replace function public.monitoreo_vigente(p_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.dispositivo_monitoreo m
      join public.estado_dispositivo e on e.id_usuario = m.id_usuario
     where m.id_usuario = p_usuario
       and m.activo
       and public._apk_ge(e.apk_version, array[1,46,1])
  );
$$;

create or replace function public.monitoreo_marcar(
  p_tipo text,
  p_abierta boolean,
  p_bateria integer default null,
  p_detalle jsonb default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_emp uuid;
begin
  if v_uid is null then raise exception 'sin-sesion'; end if;
  if p_tipo not in ('bateria_critica', 'ahorro', 'ubicacion_apagada', 'permiso_ubicacion', 'sin_subir',
                    'version_vieja', 'temperatura') then
    raise exception 'tipo-invalido';
  end if;
  if not public.monitoreo_vigente(v_uid) then return 'no-monitoreado'; end if;
  select id_empresa into v_emp from public.perfiles where id = v_uid;

  if p_abierta then
    insert into public.dispositivo_alertas (id_usuario, id_empresa, tipo, origen, bateria_pct, detalle)
    values (v_uid, v_emp, p_tipo, 'telefono', p_bateria, p_detalle)
    on conflict (id_usuario, tipo) where cerrada_ts is null do nothing;
    return 'abierta';
  end if;

  update public.dispositivo_alertas
     set cerrada_ts = now(), bateria_cierre = p_bateria
   where id_usuario = v_uid and tipo = p_tipo and cerrada_ts is null;
  return 'cerrada';
end $$;

revoke all on function public.monitoreo_marcar(text, boolean, integer, jsonb) from public, anon;
grant execute on function public.monitoreo_marcar(text, boolean, integer, jsonb) to authenticated;
revoke all on function public.monitoreo_vigente(uuid) from public, anon;
grant execute on function public.monitoreo_vigente(uuid) to authenticated;

create or replace function public.vigilancia_monitoreo()
returns table (
  id_usuario uuid,
  id_empresa uuid,
  nombre text,
  bateria_min integer,
  push boolean,
  alerta_superadmin boolean,
  aviso_ahorro boolean,
  fcm_token text,
  apk_version text,
  bateria integer,
  cargando boolean,
  ahorro boolean,
  en_ventana boolean,
  ultima_senal timestamptz,
  minutos_silencio integer,
  bateria_critica boolean,
  apagado_bateria boolean,
  sin_senal boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with m as (
    select mo.*, e.fcm_token, e.apk_version, e.bateria_pct, e.cargando, e.bateria_ts, e.ts as latido_ts
      from public.dispositivo_monitoreo mo
      join public.estado_dispositivo e on e.id_usuario = mo.id_usuario
     where mo.activo and public._apk_ge(e.apk_version, array[1,46,1])
  ),
  ult as (
    select m.id_usuario, p.ts, p.bateria
      from m
      cross join lateral (
        select ps.ts, ps.bateria from public.posiciones ps
         where ps.id_usuario = m.id_usuario
         order by ps.ts desc limit 1
      ) p
  ),
  v as (
    select ve.id_usuario, ve.en_ventana from public.vigilancia_equipo() ve
  ),
  calc as (
    select m.id_usuario, m.id_empresa, pf.nombre, m.bateria_min, m.push, m.alerta_superadmin, m.aviso_ahorro,
           m.fcm_token, m.apk_version,
           case when m.bateria_ts is not null and (u.ts is null or m.bateria_ts >= u.ts)
                then m.bateria_pct else u.bateria::int end as bateria,
           m.cargando,
           coalesce(a.ahorro_energia, false) as ahorro,
           coalesce(v.en_ventana, false) as en_ventana,
           greatest(u.ts, m.latido_ts) as ultima_senal
      from m
      join public.perfiles pf on pf.id = m.id_usuario
      left join ult u on u.id_usuario = m.id_usuario
      left join v on v.id_usuario = m.id_usuario
      left join public.dispositivo_ahorro a on a.id_usuario = m.id_usuario
  )
  select c.id_usuario, c.id_empresa, c.nombre, c.bateria_min, c.push, c.alerta_superadmin, c.aviso_ahorro,
         c.fcm_token, c.apk_version, c.bateria, c.cargando, c.ahorro, c.en_ventana, c.ultima_senal,
         (extract(epoch from now() - c.ultima_senal) / 60)::int as minutos_silencio,
         (c.bateria is not null and c.bateria < c.bateria_min and now() - c.ultima_senal < interval '20 minutes')
           as bateria_critica,
         (c.en_ventana and c.bateria is not null and c.bateria <= 5 and not coalesce(c.cargando, false)
           and now() - c.ultima_senal >= interval '15 minutes') as apagado_bateria,
         (c.en_ventana and (c.bateria is null or c.bateria > 5)
           and now() - c.ultima_senal >= interval '30 minutes') as sin_senal
    from calc c;
$$;

revoke all on function public.vigilancia_monitoreo() from public, anon, authenticated;

create or replace function public.salud_parque()
returns table (
  id_usuario uuid,
  nombre text,
  empresa text,
  modelo text,
  apk_version text,
  app_version text,
  bateria integer,
  cargando boolean,
  bateria_temp numeric,
  ahorro boolean,
  latido_ts timestamptz,
  ultimo_punto_ts timestamptz,
  puntos_hoy integer,
  pct_menos_8m integer,
  huecos_5min integer,
  hueco_max_min integer,
  alertas_abiertas text[],
  monitoreado boolean,
  vigente boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_desde timestamptz := ((now() at time zone 'America/Argentina/Salta')::date)::timestamp
                          at time zone 'America/Argentina/Salta';
begin
  if not public.es_superadmin() then raise exception 'solo-superadmin'; end if;
  return query
  with base as (
    select e.id_usuario, pf.nombre, em.nombre as empresa, e.modelo, e.apk_version, e.app_version,
           e.bateria_pct, e.cargando, e.bateria_temp, e.ts as latido_ts,
           mo.id_usuario is not null and mo.activo as monitoreado,
           coalesce(mo.activo, false) and public._apk_ge(e.apk_version, array[1,46,1]) as vigente
      from public.estado_dispositivo e
      join public.perfiles pf on pf.id = e.id_usuario
      left join public.empresas em on em.id = pf.id_empresa
      left join public.dispositivo_monitoreo mo on mo.id_usuario = e.id_usuario
     where public._apk_ge(e.apk_version, array[1,46,1]) or mo.id_usuario is not null
  ),
  pts as (
    select ps.id_usuario, ps.ts, ps.accuracy, ps.bateria,
           ps.ts - lag(ps.ts) over (partition by ps.id_usuario order by ps.ts) as gap
      from public.posiciones ps
     where ps.ts >= v_desde and ps.id_usuario in (select b.id_usuario from base b)
  ),
  agg as (
    select p.id_usuario, count(*)::int as n, max(p.ts) as ult,
           (100.0 * count(*) filter (where p.accuracy < 8) / nullif(count(*), 0))::int as pct8,
           count(*) filter (where p.gap > interval '5 minutes')::int as huecos,
           (extract(epoch from max(p.gap)) / 60)::int as hmax,
           (array_agg(p.bateria order by p.ts desc))[1]::int as bat_pt
      from pts p group by p.id_usuario
  )
  select b.id_usuario, b.nombre, b.empresa, b.modelo, b.apk_version, b.app_version,
         coalesce(b.bateria_pct, a.bat_pt), b.cargando, b.bateria_temp,
         coalesce(da.ahorro_energia, false), b.latido_ts, a.ult, coalesce(a.n, 0), a.pct8,
         coalesce(a.huecos, 0), a.hmax,
         (select array_agg(al.tipo order by al.abierta_ts) from public.dispositivo_alertas al
           where al.id_usuario = b.id_usuario and al.cerrada_ts is null),
         b.monitoreado, b.vigente
    from base b
    left join agg a on a.id_usuario = b.id_usuario
    left join public.dispositivo_ahorro da on da.id_usuario = b.id_usuario
   order by b.monitoreado desc, b.nombre;
end $$;

revoke all on function public.salud_parque() from public, anon;
grant execute on function public.salud_parque() to authenticated;

select cron.unschedule('monitoreo-dispositivos-5min')
 where exists (select 1 from cron.job where jobname = 'monitoreo-dispositivos-5min');
select cron.schedule('monitoreo-dispositivos-5min', '*/5 * * * *',
  $$ select public._cron_llamar_funcion('monitoreo-dispositivos'); $$);
