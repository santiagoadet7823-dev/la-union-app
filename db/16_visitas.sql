-- 16_visitas.sql — Actualización 1.6.x (27/07/2026).
-- Tabla de check-in / check-out del vendedor en cada comercio. Sostiene:
--   • Feature B (tiempo real de parada = check_out_ts - check_in_ts, exacto por visita)
--   • Feature C (persistir el check-in que hoy solo vive en memoria en useJornada.js)
-- El id se genera EN EL CLIENTE y la write queue hace upsert(onConflict:'id', ignoreDuplicates)
-- para el check-in y update().eq('id') para el check-out: reintentar NO duplica (regla writeQueue).
-- RLS espeja a `posiciones`: la ESCRITURA usa la identidad del usuario (id_usuario=auth.uid()),
-- nunca un scope de empresa activo (regla 11 del CLAUDE.md).

create table if not exists public.visitas (
  id            uuid primary key,                       -- generado en el cliente
  id_empresa    uuid not null references public.empresas(id),
  id_usuario    uuid not null references public.perfiles(id),
  id_cliente    uuid not null references public.clientes(id),
  check_in_ts   timestamptz not null default now(),
  check_out_ts  timestamptz,                            -- null mientras la visita está en curso
  lat           double precision,                       -- ubicación desde donde se hizo el check-in
  lng           double precision,
  accuracy      double precision,
  estado        text not null default 'en_curso'
                  check (estado in ('en_curso','visitado','sin_pedido','cancelado')),
  monto         numeric,
  motivo        text,
  created_at    timestamptz not null default now()
);

create index if not exists visitas_empresa_ts_idx on public.visitas (id_empresa, check_in_ts desc);
create index if not exists visitas_usuario_ts_idx on public.visitas (id_usuario, check_in_ts desc);

alter table public.visitas enable row level security;

-- INSERT: solo el propio usuario dentro de su empresa de identidad.
drop policy if exists visitas_ins on public.visitas;
create policy visitas_ins on public.visitas
  for insert to authenticated
  with check (id_usuario = auth.uid() and id_empresa = (select mi_empresa()));

-- SELECT: superadmin ve todo; cada usuario ve lo suyo; gestión ve el de su empresa.
-- Forma (select mi_empresa()) escalar como en posiciones_sel (paginable, regla 10).
drop policy if exists visitas_sel on public.visitas;
create policy visitas_sel on public.visitas
  for select to authenticated
  using (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa())
        and (select mi_rol()) = any (array['admin','encargado','propietario']))
  );

-- UPDATE: el usuario cierra su propia visita (check-out); gestión de la empresa también.
drop policy if exists visitas_upd on public.visitas;
create policy visitas_upd on public.visitas
  for update to authenticated
  using (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa())
        and (select mi_rol()) = any (array['admin','encargado']))
  )
  with check (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa())
        and (select mi_rol()) = any (array['admin','encargado']))
  );
