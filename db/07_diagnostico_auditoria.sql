-- ============================================================
-- 07 · Diagnóstico remoto + auditoría de app_config
-- Aplicado a la base viva el 19/07/2026 (migración `diagnostico_y_auditoria_appconfig`).
--
-- ADITIVO: no toca ninguna policy ni ningún índice existente. Reversible (ver el
-- bloque ROLLBACK al final).
--
-- OJO con la numeración: PLAN_SAAS.md reservaba el 07 para `corporaciones`. Este
-- archivo se adelantó por una urgencia de campo, así que la migración de
-- corporaciones pasa a 08 y las siguientes corren un número.
-- ============================================================

-- ── 1) Telemetría que no se veía en remoto ──────────────────────────────────
-- cuarentena_pendiente: puntos aislados por la cola (bundle 1.5.27+). Sin esto no
-- hay forma de saber desde el panel si un teléfono está aislando puntos.
alter table public.estado_dispositivo add column if not exists cuarentena_pendiente integer;

-- gps_error: el motivo REAL del fallo de GPS. Hasta ahora `permiso` solo decía
-- 'denegado' sin decir por qué, y eso dejó sin cerrar el caso del 18/07/2026: un
-- recorrido entero sin capturar, con la app viva y latiendo.
alter table public.estado_dispositivo add column if not exists gps_error text;

-- ── 2) Auditoría de app_config ──────────────────────────────────────────────
-- El 18/07/2026 a las 20:50 local algo cambió esta fila en plena salida y no hubo
-- manera de saber qué ni quién. Un cambio en la ventana horaria apaga el rastreo de
-- TODA la operación: no puede ser invisible.
create table if not exists public.app_config_historial (
  id          bigint generated always as identity primary key,
  ts          timestamptz not null default now(),
  quien       uuid,
  campo       text not null,
  valor_viejo text,
  valor_nuevo text
);

alter table public.app_config_historial enable row level security;

drop policy if exists app_config_historial_sel on public.app_config_historial;
create policy app_config_historial_sel on public.app_config_historial
  for select using (public.es_superadmin());
-- Sin policy de INSERT a propósito: escribe solo el trigger, que es SECURITY DEFINER.

create or replace function public.registrar_cambio_app_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.track_enabled is distinct from old.track_enabled then
    insert into public.app_config_historial(quien, campo, valor_viejo, valor_nuevo)
    values (auth.uid(), 'track_enabled', old.track_enabled::text, new.track_enabled::text);
  end if;
  if new.track_start is distinct from old.track_start then
    insert into public.app_config_historial(quien, campo, valor_viejo, valor_nuevo)
    values (auth.uid(), 'track_start', old.track_start, new.track_start);
  end if;
  if new.track_end is distinct from old.track_end then
    insert into public.app_config_historial(quien, campo, valor_viejo, valor_nuevo)
    values (auth.uid(), 'track_end', old.track_end, new.track_end);
  end if;
  if new.bundle_version is distinct from old.bundle_version then
    insert into public.app_config_historial(quien, campo, valor_viejo, valor_nuevo)
    values (auth.uid(), 'bundle_version', old.bundle_version, new.bundle_version);
  end if;
  return new;
end $$;

-- Regla 7 de CLAUDE.md: revocar de PUBLIC, NUNCA de anon/authenticated (es un no-op,
-- porque Postgres concede EXECUTE a PUBLIC por defecto y esos roles lo heredan).
-- Es función de trigger: el EXECUTE se chequea al crear el trigger, no en cada disparo,
-- así que revocarlo no rompe la auditoría.
revoke execute on function public.registrar_cambio_app_config() from public;

drop trigger if exists app_config_auditoria on public.app_config;
create trigger app_config_auditoria
  after update on public.app_config
  for each row execute function public.registrar_cambio_app_config();

-- ============================================================
-- ROLLBACK (no se ejecuta; está acá para poder revertir sin pensarlo)
-- ============================================================
-- drop trigger if exists app_config_auditoria on public.app_config;
-- drop function if exists public.registrar_cambio_app_config();
-- drop table if exists public.app_config_historial;
-- alter table public.estado_dispositivo drop column if exists cuarentena_pendiente;
-- alter table public.estado_dispositivo drop column if exists gps_error;
