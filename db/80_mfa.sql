-- 80_mfa.sql — Soporte de base para 2FA TOTP obligatoria (Tarea 2.2, fase 1).
-- 29/09/2026.
--
-- 🩸 QUÉ TRAE Y QUÉ NO. Esta migración deja lista la base para que el front pida TOTP (enroll +
-- challenge + verify son API nativa de Supabase Auth, no hace falta nada nuevo acá) y agrega lo
-- que Supabase NO trae de fábrica: códigos de recuperación, un registro de auditoría y una forma
-- confiable de cerrar sesiones por id de usuario. NO agrega ninguna policy RESTRICTIVE que EXIJA
-- aal2 todavía — eso es la fase 2/3 del plan, con su propio OK porque afecta a todos los usuarios
-- ya activos de una.
--
--   1) `mfa_codigos` — hash (SHA-256) de los 10 códigos de recuperación de cada cuenta. Igual que
--      `codigos_registro` (db/79): sin ninguna policy, nadie entra por PostgREST ni con RLS de por
--      medio — solo `service_role`, desde `mfa-codigos` / `mfa-recuperar`.
--   2) `auditoria_seguridad` — registro de acciones sensibles (reseteo de 2FA por un admin,
--      recuperación por código). Mismo criterio: sin policies, escribe solo service_role. Sin
--      pantalla que lo lea todavía (queda para cuando haga falta auditar algo puntual).
--   3) `cerrar_sesiones_usuario(uuid)` — borra las filas de `auth.sessions` y `auth.refresh_tokens`
--      de un usuario. Resuelve algo que había quedado SIN VERIFICAR en `resetear-contrasena`
--      (db/78): ahí se asumía que cambiar la contraseña alcanzaba para cortar sesiones abiertas en
--      otro teléfono, sin haberlo comprobado. La documentación de Supabase confirma que
--      `auth.sessions` es la fuente de verdad (cada JWT lleva un claim `session_id` que se compara
--      contra esa tabla) y que `refresh_tokens` NO tiene ON DELETE CASCADE desde `sessions` en este
--      proyecto — hay que borrar las dos. Restringida a `service_role`: no tiene ningún chequeo de
--      permiso propio, así que NUNCA debe quedar alcanzable por `authenticated` ni `anon`.
--   4) `listar_factores_mfa(uuid)` — los factores TOTP verificados de un usuario. Hace falta porque
--      `auth.admin.mfa.deleteFactor` pide el `id` de CADA factor, y no hay un método directo para
--      "borrar todos los de este usuario"; el listado normal (`auth.mfa.listFactors()`) es
--      self-service y no sirve para que un admin mire los de otra cuenta. Mismo criterio:
--      `service_role` únicamente.
--   5) `codigos_registro.creado_por` (db/79) pasa a `on delete set null`. Sin esto, cualquier
--      admin/superadmin que alguna vez generó un código de invitación queda con esa fila
--      referenciándolo, y `eliminar-usuario` falla por violación de FK al intentar borrarlo —
--      exactamente el mismo problema que `auditoria_seguridad` tendría si sus dos columnas se
--      dejaran con el `NO ACTION` por defecto (ver punto 2). Se corrige acá porque recién ahora,
--      escribiendo `auditoria_seguridad`, quedó claro el patrón: una tabla de auditoría/referencia
--      NUNCA debería bloquear el borrado de la cuenta que referencia — tiene que sobrevivirla.

create table public.mfa_codigos (
  id         uuid primary key default gen_random_uuid(),
  id_usuario uuid not null references auth.users(id) on delete cascade,
  hash       text not null,
  usado_ts   timestamptz,
  creado_ts  timestamptz not null default now()
);
comment on table public.mfa_codigos is
  'Hash SHA-256 de los códigos de recuperación de 2FA (db/80). Sin policies: solo service_role, desde mfa-codigos / mfa-recuperar.';
create index mfa_codigos_usuario_idx on public.mfa_codigos (id_usuario) where usado_ts is null;
alter table public.mfa_codigos enable row level security;
revoke all on table public.mfa_codigos from public;
revoke all on table public.mfa_codigos from anon;
revoke all on table public.mfa_codigos from authenticated;

create table public.auditoria_seguridad (
  id         uuid primary key default gen_random_uuid(),
  id_usuario uuid references auth.users(id) on delete set null,  -- a quién le pasó
  id_actor   uuid references auth.users(id) on delete set null,  -- quién lo hizo (puede ser la misma persona)
  accion     text not null,
  detalle    jsonb,
  creado_ts  timestamptz not null default now()
);
comment on table public.auditoria_seguridad is
  'Registro de acciones de seguridad sensibles (reseteo de 2FA, recuperación por código). Sin policies: solo service_role escribe. Sin pantalla de lectura todavía.';
alter table public.auditoria_seguridad enable row level security;
revoke all on table public.auditoria_seguridad from public;
revoke all on table public.auditoria_seguridad from anon;
revoke all on table public.auditoria_seguridad from authenticated;

create or replace function public.cerrar_sesiones_usuario(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from auth.refresh_tokens where user_id = p_id::text;
  delete from auth.sessions where user_id = p_id;
end;
$$;
comment on function public.cerrar_sesiones_usuario(uuid) is
  'Cierra TODAS las sesiones de un usuario (auth.sessions + auth.refresh_tokens, sin FK entre sí en este proyecto). Sin chequeo de permiso propio — service_role únicamente, nunca anon/authenticated.';
revoke execute on function public.cerrar_sesiones_usuario(uuid) from public;
revoke execute on function public.cerrar_sesiones_usuario(uuid) from anon;
revoke execute on function public.cerrar_sesiones_usuario(uuid) from authenticated;
grant execute on function public.cerrar_sesiones_usuario(uuid) to service_role;

create or replace function public.listar_factores_mfa(p_id uuid)
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select id from auth.mfa_factors where user_id = p_id and status = 'verified';
$$;
comment on function public.listar_factores_mfa(uuid) is
  'IDs de los factores TOTP verificados de un usuario, para admin.mfa.deleteFactor (que pide id + userId de a uno). service_role únicamente.';
revoke execute on function public.listar_factores_mfa(uuid) from public;
revoke execute on function public.listar_factores_mfa(uuid) from anon;
revoke execute on function public.listar_factores_mfa(uuid) from authenticated;
grant execute on function public.listar_factores_mfa(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Fix retroactivo de db/79: codigos_registro.creado_por a on delete set null
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.codigos_registro drop constraint if exists codigos_registro_creado_por_fkey;
alter table public.codigos_registro add constraint codigos_registro_creado_por_fkey
  foreign key (creado_por) references auth.users(id) on delete set null;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
--   select proacl from pg_proc where proname in ('cerrar_sesiones_usuario','listar_factores_mfa');
--   -- Las dos: SOLO postgres=X y service_role=X. Ni anon ni authenticated en ninguna.
--
--   select count(*) from pg_policies where tablename in ('mfa_codigos','auditoria_seguridad');
--   -- 0.
--
--   select has_table_privilege('authenticated', 'public.mfa_codigos', 'SELECT');        -- false
--   select has_table_privilege('authenticated', 'public.auditoria_seguridad', 'SELECT'); -- false
--
--   select conname, confdeltype from pg_constraint
--    where conrelid in ('public.auditoria_seguridad'::regclass, 'public.codigos_registro'::regclass)
--      and contype = 'f';
--   -- confdeltype = 'n' (set null) en las tres: auditoria_seguridad.id_usuario, .id_actor,
--   -- codigos_registro.creado_por. Antes del fix, codigos_registro daba 'a' (no action).
-- ─────────────────────────────────────────────────────────────────────────────
