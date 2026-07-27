-- 18_categorias_rastreo.sql — Actualización 1.6.x (27/07/2026).
-- Feature D: horarios de rastreo PARTICULARES por usuario, vía categorías reutilizables.
-- Hoy el horario es 100% global (app_config.track_start/end/days, "es global para toda la
-- operación"). Con esto, un usuario puede tener su propia ventana (ej. Ma/Ju 18:00–24:00).
-- El motor dentroDeHorario() (src/services/tracking.js) YA soporta días y cruce de medianoche,
-- así que 'hora_fin' admite '24:00'. La categoría es reutilizable entre usuarios.
--
-- Resolución en runtime: getTrackConfig(userId) usa la categoría del perfil si existe; si no,
-- cae al app_config global. perfiles.id_categoria_rastreo NULL = sigue el horario global.

create table if not exists public.categorias_rastreo (
  id           uuid primary key default gen_random_uuid(),
  id_empresa   uuid not null references public.empresas(id),
  nombre       text not null,
  dias         int[],                         -- 1=Lun … 7=Dom (ISO). NULL/vacío = todos los días
  hora_inicio  text not null default '07:30',
  hora_fin     text not null default '22:00', -- admite '24:00' (ventana que cruza medianoche)
  activo       boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.categorias_rastreo enable row level security;

drop policy if exists categorias_rastreo_sel on public.categorias_rastreo;
create policy categorias_rastreo_sel on public.categorias_rastreo
  for select to authenticated
  using ((select es_superadmin()) or id_empresa = (select mi_empresa()));

drop policy if exists categorias_rastreo_wr on public.categorias_rastreo;
create policy categorias_rastreo_wr on public.categorias_rastreo
  for all to authenticated
  using (
    (select es_superadmin())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = any (array['admin','superadmin']))
  )
  with check (
    (select es_superadmin())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = any (array['admin','superadmin']))
  );

-- Asignación por usuario. NULL = usa el horario global de app_config.
alter table public.perfiles
  add column if not exists id_categoria_rastreo uuid
  references public.categorias_rastreo(id) on delete set null;
