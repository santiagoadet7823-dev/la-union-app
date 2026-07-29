-- 24 · Teléfono de soporte para la pantalla de cuenta pendiente (diseño v1.4 · 28/07/2026)
--
-- ⚠️ Ya APLICADA en la base viva. Este archivo es historia, no fuente de verdad (regla 5).
--
-- Va en DOS lugares porque hay dos situaciones distintas, verificadas contra la base:
--
--   1. Usuario DESACTIVADO: tiene rol e id_empresa, solo está en activo=false. Puede leer su
--      empresa (policy `empresas_sel`: es_superadmin() OR id = mi_empresa()) → se le muestra el
--      teléfono de SU empresa.
--   2. Usuario NUEVO de Google: el trigger `handle_new_user` lo inserta con rol=null y **sin
--      id_empresa**, así que no hay ninguna empresa de la cual sacar un teléfono → cae al global.
--
-- `app_config` sirve de respaldo porque su policy de lectura es `qual = true` (la lee cualquiera,
-- incluso anon), que es exactamente el caso: la consulta alguien que todavía no está habilitado.
--
-- 🩸 Si ninguno de los dos está cargado, la pantalla NO dibuja la línea. Nunca un número de
-- relleno: el diseño traía un `+54 9 351 000-0000` de ejemplo y un número inventado en una
-- pantalla de ayuda es peor que no tener ninguno.

alter table public.empresas   add column if not exists telefono_soporte text;
alter table public.app_config add column if not exists telefono_soporte text;

comment on column public.empresas.telefono_soporte   is 'Contacto del admin de esta empresa, para la pantalla de cuenta pendiente. Se edita en EmpresasView.';
comment on column public.app_config.telefono_soporte is 'Contacto de respaldo para quien todavía no tiene empresa asignada (alta nueva por Google).';
