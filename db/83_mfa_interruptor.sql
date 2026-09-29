-- 83_mfa_interruptor.sql — Interruptor de la 2FA obligatoria. 29/09/2026.
--
-- 🩸 POR QUÉ EXISTE. El gate de 2FA de `App.jsx` (Tarea 2.2, db/80) mandaba a `MfaActivar` a
-- CUALQUIER cuenta sin factor, y no dependía de ninguna configuración: "estaba apagada" solo porque
-- todavía no se había desplegado el front. Hoy ninguna cuenta tiene un factor (auth.mfa_factors
-- vacía), así que publicar ese front habría frenado a todo el equipo en la pantalla de activación
-- en el primer arranque —exactamente lo que el dueño pidió evitar hasta que la OTA de la 2.2.D
-- (la sesión en SQLite) haya llegado a todos los teléfonos.
--
-- Mismo criterio que `politica_version` (db/81): activarla es UNA fila, no un deploy.
--   update public.app_config set mfa_obligatoria = true;    -- exigir 2FA a quien no tenga factor
--   update public.app_config set mfa_obligatoria = false;   -- volver atrás, sin desplegar nada
--
-- Qué NO apaga: quien YA tiene un factor verificado sigue pasando por `MfaVerificar` en cada sesión
-- nueva, con el interruptor prendido o no. Eso es opt-in ya hecho, no una imposición nueva.
--
-- default false + not null: una fila vieja o un `insert` que no nombre la columna queda APAGADO.
-- Es el sentido correcto de fallar para un control que puede frenar la jornada entera.
--
-- ⚠️ ANTES de prender el interruptor (ver HANDOFF_PLAN_SEGURIDAD.md): que la OTA con la sesión en
-- SQLite (2.2.D) haya llegado a todos los teléfonos, y resolver el arranque degradado —sin red y
-- con el espejo de sesión, `getAuthenticatorAssuranceLevel` puede devolver aal1/aal1 y mandar a
-- `MfaActivar` a alguien que en realidad ya tiene factor.

alter table public.app_config
  add column if not exists mfa_obligatoria boolean not null default false;

comment on column public.app_config.mfa_obligatoria is
  'true = toda cuenta sin factor TOTP debe activarlo para entrar (Gate → MfaActivar). false (default) = no se exige; quien ya tiene un factor igual lo verifica.';

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
--   select mfa_obligatoria from public.app_config;   -- false
--   select column_default, is_nullable from information_schema.columns
--    where table_name = 'app_config' and column_name = 'mfa_obligatoria';  -- false / NO
-- ─────────────────────────────────────────────────────────────────────────────
