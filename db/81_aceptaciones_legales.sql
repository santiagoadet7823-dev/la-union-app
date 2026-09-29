-- 81_aceptaciones_legales.sql — Registro de aceptación de la política de privacidad (Tarea 2.3).
-- 29/09/2026.
--
-- 🩸 EL GATE ARRANCA APAGADO A PROPÓSITO. `app_config.politica_version` empieza en NULL, y mientras
-- sea NULL el Gate del front (App.jsx) NO le pide nada a nadie — ver AuthContext.cargarPolitica.
-- El borrador (`_interno/seguridad/POLITICA_DE_PRIVACIDAD_v2_BORRADOR.md`) todavía necesita revisión
-- legal; esta migración deja la CAÑERÍA lista (tabla, RPC, columnas) sin activar nada. Activarlo es
-- una fila (`update app_config set politica_version = '2', politica_url = '...'`), el día que
-- corresponda — con el mismo criterio de "no tocar producción sin OK" que el resto del proyecto.
--
-- `politica_url` es A PROPÓSITO una URL externa, no texto bundleado en la app: dónde vive el texto
-- final ya aprobado (sitio propio, página del abogado, lo que se decida) no es una decisión técnica,
-- y bundlear el BORRADOR sin aprobar en el JS público de la app sería publicarlo antes de tiempo.
--
-- `aceptaciones_legales` guarda quién aceptó qué versión, cuándo, desde dónde: exactamente lo que la
-- política (§11-bis del borrador) le promete a la persona que la acepta. A diferencia de
-- `codigos_registro`/`mfa_codigos`, ACÁ sí hay una policy de SELECT para el propio usuario —esa
-- transparencia es parte de lo que el documento promete, así que tiene que poder verificarse.

alter table public.app_config add column if not exists politica_version text;
comment on column public.app_config.politica_version is
  'Versión vigente de la política de privacidad que hay que aceptar. NULL = gate de aceptación apagado (todavía no se publicó una versión definitiva).';
alter table public.app_config add column if not exists politica_url text;
comment on column public.app_config.politica_url is
  'Dónde leer el texto completo de la versión vigente. Externa a propósito: no se bundlea el borrador sin aprobar en el JS público de la app.';

create table public.aceptaciones_legales (
  id           uuid primary key default gen_random_uuid(),
  id_usuario   uuid not null references auth.users(id) on delete cascade,
  documento    text not null,  -- 'politica_privacidad'; deja lugar a otro documento el día que haga falta
  version      text not null,
  aceptado_ts  timestamptz not null default now(),
  plataforma   text,           -- 'android' | 'web'
  version_app  text
);
comment on table public.aceptaciones_legales is
  'Registro de aceptación de documentos legales (Tarea 2.3, db/81). Se escribe SOLO vía aceptar_documento(), nunca por insert directo.';
create unique index aceptaciones_legales_usuario_doc_ver_key
  on public.aceptaciones_legales (id_usuario, documento, version);

alter table public.aceptaciones_legales enable row level security;
-- Transparencia: cada quien ve SUS propias aceptaciones (lo que la política le promete), nada más.
create policy aceptaciones_legales_sel on public.aceptaciones_legales
  for select
  to authenticated
  using ((select auth.uid()) = id_usuario);
-- Sin policy de insert/update/delete: el insert va SOLO por la RPC (SECURITY DEFINER), que valida
-- la versión vigente server-side en vez de confiar en lo que mande el cliente.
revoke insert, update, delete on table public.aceptaciones_legales from public;
revoke insert, update, delete on table public.aceptaciones_legales from anon;
revoke insert, update, delete on table public.aceptaciones_legales from authenticated;

create or replace function public.aceptar_documento(p_documento text, p_plataforma text default null, p_version_app text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version text;
begin
  if auth.uid() is null then
    raise exception 'no-auth';
  end if;
  if p_documento = 'politica_privacidad' then
    select politica_version into v_version from public.app_config limit 1;
  else
    raise exception 'documento-desconocido';
  end if;
  if v_version is null then
    raise exception 'sin-version-vigente';
  end if;
  insert into public.aceptaciones_legales (id_usuario, documento, version, plataforma, version_app)
  values (auth.uid(), p_documento, v_version, p_plataforma, p_version_app)
  on conflict (id_usuario, documento, version) do nothing;
end;
$$;
comment on function public.aceptar_documento(text, text, text) is
  'La versión a aceptar la decide el SERVIDOR (lee app_config.politica_version), nunca el cliente — evita que alguien "acepte" una versión vieja o inventada.';
revoke execute on function public.aceptar_documento(text, text, text) from public;
revoke execute on function public.aceptar_documento(text, text, text) from anon;
grant execute on function public.aceptar_documento(text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
--   select proacl from pg_proc where proname = 'aceptar_documento';
--   -- authenticated=X, SIN anon.
--
--   select policyname, cmd, roles from pg_policies where tablename = 'aceptaciones_legales';
--   -- 1 fila: aceptaciones_legales_sel, SELECT, {authenticated}. Nada de insert/update/delete.
--
--   select has_table_privilege('authenticated', 'public.aceptaciones_legales', 'INSERT'); -- false
--
--   select politica_version, politica_url from public.app_config;
--   -- las dos NULL hasta que se decida publicar (gate apagado a propósito).
-- ─────────────────────────────────────────────────────────────────────────────
