-- 78_usuario_login.sql — Login con nombre de usuario, sin depender de un email real.
-- 29/09/2026.
--
-- 🩸 POR QUÉ EXISTE. Deuda técnica pedida por el dueño: hoy no se puede dar de alta una cuenta sin
-- un email real, y Supabase Auth exige email O teléfono para crear un usuario. SMS/teléfono
-- necesita un proveedor pago; la opción elegida es la que YA tiene un precedente en este mismo
-- repo: `eliminar-usuario` (db/77) crea el perfil "Usuario eliminado" con un email
-- `@dist-at.invalid` — dominio reservado por la RFC 2606, nadie lo puede recibir nunca. Acá se
-- generaliza esa idea para cuentas de VERDAD: `crear-usuario` arma
-- `<usuario>@usuarios.dist-at.invalid` a partir del nombre de usuario que eligió el admin, y el
-- login (AuthContext.signInWithPassword) hace el camino inverso: si lo que se tipeó no tiene
-- `@`, le pega ese mismo dominio antes de mandarlo a `signInWithPassword`.
--
-- Lo que agrega esta migración:
--   1) `perfiles.usuario` — solo para las cuentas que entran por nombre de usuario (las de email
--      real la dejan en null). Único por `lower(usuario)`, formato validado en DOS lugares: acá
--      (CHECK, la garantía real) y en la Edge Function (para devolver un error legible antes de
--      pegarle a la base).
--   2) `perfiles.debe_cambiar_contrasena` — lo prende la Edge Function `resetear-contrasena`
--      (reseteo por un admin, la respuesta a "¿cómo recupera la contraseña alguien sin email?").
--      El front lo lee en el Gate (App.jsx) y bloquea la app con una pantalla de cambio
--      obligatorio hasta que la persona ponga una contraseña propia.
--   3) RPC `marcar_contrasena_cambiada()` — la única forma de apagar el flag de arriba desde el
--      cliente. Hace falta una RPC SECURITY DEFINER porque `perfiles_upd` (db/77 y antes) no deja
--      que nadie —ni el dueño de la fila— actualice su propio perfil por REST directo; el mismo
--      patrón que ya usa `actualizar_mi_perfil`.
--   4) El trigger `perfiles_guarda_cambios` (db/77) suma `usuario` a las columnas que un usuario
--      común nunca puede tocarse a sí mismo. Nadie escribe esta columna desde la UI todavía —solo
--      `crear-usuario`, con `auth.uid()` nulo, que el trigger ya deja pasar—, pero se protege
--      desde ahora para no tener que acordarse el día que se sume una edición de "usuario" al
--      menú Usuarios.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Columna `usuario` + formato + unicidad
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.perfiles add column if not exists usuario text;
comment on column public.perfiles.usuario is
  'Nombre de usuario para cuentas SIN email real. crear-usuario arma el login con <usuario>@usuarios.dist-at.invalid (dominio .invalid, RFC 2606: nunca se entrega nada ahí). NULL en las cuentas que entran con su email de verdad.';

alter table public.perfiles add column if not exists debe_cambiar_contrasena boolean not null default false;
comment on column public.perfiles.debe_cambiar_contrasena is
  'La prende resetear-contrasena (reseteo hecho por un admin). El Gate del front bloquea la app con una pantalla de cambio obligatorio hasta que la persona ponga su propia contraseña.';

-- Mismo criterio de normalización que `codigo_norm` (db/49): todo en minúscula, sin espacios.
-- La Edge Function ya manda el valor normalizado; el CHECK es la garantía de que nunca entra
-- nada distinto, ni siquiera con un `update` directo desde el SQL Editor.
alter table public.perfiles drop constraint if exists perfiles_usuario_formato;
alter table public.perfiles add constraint perfiles_usuario_formato
  check (usuario is null or usuario ~ '^[a-z0-9._-]{3,30}$');

-- Parcial (solo donde usuario IS NOT NULL) a propósito: es un `unique index` común y corriente
-- sobre una columna opcional, no el caso que prohíbe la regla 6 del CLAUDE.md (ese es específico
-- de `posiciones.client_uid` por el `upsert(onConflict:)` que necesita el índice completo).
drop index if exists public.perfiles_usuario_key;
create unique index perfiles_usuario_key on public.perfiles (lower(usuario)) where usuario is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) `usuario` se suma a las columnas sensibles del trigger de db/77
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.perfiles_guarda_cambios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_rol   text;
  v_emp   uuid;
  v_sensible boolean;
begin
  -- Service role (crear-usuario, eliminar-usuario, resetear-contrasena, crons): no hay persona a
  -- quien limitar.
  if v_uid is null then return new; end if;

  v_sensible :=
       new.rol                  is distinct from old.rol
    or new.activo               is distinct from old.activo
    or new.id_empresa           is distinct from old.id_empresa
    or new.nivel                is distinct from old.nivel
    or new.numero               is distinct from old.numero
    or new.codigo_erp           is distinct from old.codigo_erp
    or new.permisos             is distinct from old.permisos
    or new.id_categoria_rastreo is distinct from old.id_categoria_rastreo
    or new.color_trazo          is distinct from old.color_trazo
    or new.gps_perfil           is distinct from old.gps_perfil
    or new.sistema              is distinct from old.sistema
    or new.usuario              is distinct from old.usuario;
  if not v_sensible then return new; end if;

  -- El marcador "Usuario eliminado" no se edita desde la app.
  if old.sistema or new.sistema then
    raise exception 'perfil-de-sistema';
  end if;

  select rol, id_empresa into v_rol, v_emp from public.perfiles where id = v_uid;

  -- La propia cuenta: ni desactivarse ni cambiarse el rol (brief v1.5 §6 P5).
  if old.id = v_uid and (new.activo is distinct from old.activo or new.rol is distinct from old.rol) then
    raise exception 'propia-cuenta';
  end if;

  if v_rol = 'superadmin' then
    null;
  elsif v_rol = 'admin' then
    if old.rol = 'superadmin' or new.rol = 'superadmin' then
      raise exception 'sin-permiso-superadmin';
    end if;
    if new.color_trazo is distinct from old.color_trazo or new.gps_perfil is distinct from old.gps_perfil then
      raise exception 'solo-superadmin';
    end if;
    -- Mover de empresa es del superadmin. La única excepción es adoptar un pendiente que entró con
    -- Google y todavía no tiene empresa (la RLS ya exige que el destino sea la del admin).
    if new.id_empresa is distinct from old.id_empresa
       and not (old.id_empresa is null and new.id_empresa = v_emp) then
      raise exception 'solo-superadmin';
    end if;
  else
    raise exception 'sin-permiso';
  end if;

  -- Nunca dejar el sistema sin un superadmin activo.
  if old.rol = 'superadmin' and old.activo
     and (new.rol is distinct from 'superadmin' or not new.activo)
     and not exists (select 1 from public.perfiles p
                      where p.rol = 'superadmin' and p.activo and p.id <> old.id) then
    raise exception 'ultimo-superadmin';
  end if;

  return new;
end;
$$;

revoke execute on function public.perfiles_guarda_cambios() from public;
revoke execute on function public.perfiles_guarda_cambios() from anon;
revoke execute on function public.perfiles_guarda_cambios() from authenticated;

-- El trigger ya existe (db/77); create or replace de la función alcanza, no hace falta recrearlo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Autoservicio: apagar el flag de cambio obligatorio
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.marcar_contrasena_cambiada()
returns void
language sql
security definer
set search_path = public
as $$
  update public.perfiles set debe_cambiar_contrasena = false where id = auth.uid();
$$;

revoke execute on function public.marcar_contrasena_cambiada() from public;
revoke execute on function public.marcar_contrasena_cambiada() from anon;
grant execute on function public.marcar_contrasena_cambiada() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
--   select proname, proacl from pg_proc
--    where proname in ('perfiles_guarda_cambios','marcar_contrasena_cambiada');
--   -- Ninguna con anon ni authenticated para perfiles_guarda_cambios (es del trigger, no se llama
--   -- directo); marcar_contrasena_cambiada SÍ con authenticated (autoservicio) y sin anon.
--
--   -- Formato y unicidad:
--   insert into public.perfiles (id, usuario) values (gen_random_uuid(), 'Mal Formato');  -- debe fallar (mayúsculas)
--   -- (rollback)
--
--   -- Como un vendedor (tiene que fallar con 'sin-permiso', igual que cualquier otra columna
--   -- sensible — usuario no se edita desde ningún lado todavía, esto es defensa en profundidad):
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<id vendedor>","role":"authenticated"}', true);
--   update public.perfiles set usuario = 'nuevo' where id = '<id vendedor>';
--   rollback;
-- ─────────────────────────────────────────────────────────────────────────────
