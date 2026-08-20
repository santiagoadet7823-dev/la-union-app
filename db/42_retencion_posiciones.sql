-- 42_retencion_posiciones.sql — UNA sola política de retención (19/08/2026).
--
-- EL HALLAZGO. Había TRES cron jobs borrando de `posiciones`, con tres intervalos distintos, y
-- nadie podía decir cuál era la política real. Verificado contra `cron.job` en la base viva:
--
--   jobid 1 · 03:10 · delete from posiciones where ts < now() - interval '30 days'
--   jobid 3 · 03:30 · select limpiar_posiciones_viejas()   ← por dentro: interval '7 days'
--   jobid 5 · 03:30 · delete from posiciones where ts < now() - interval '60 days'
--
-- Gana el más estricto, así que la retención efectiva era de **7 días** y los otros dos no borraban
-- nunca nada: existían solo para hacer creer que había 30 o 60. Medido el 19/08: la tabla tenía
-- 135.740 filas y **8 días** de historia (12/08 al 19/08). Cualquier informe de más de una semana
-- atrás ya no existía, y eso incluye a Reportes, que lee `posiciones` por fecha.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- POR QUÉ 45 DÍAS Y NO 30 NI 60 — la cuenta, no la intuición
-- ─────────────────────────────────────────────────────────────────────────────
-- Con 9 equipos entran ~20.000 filas/día. La tabla pesa 42 MB con 135.740 filas (18 MB de datos +
-- 24 MB de índices) → **~325 bytes por fila entre datos e índices**. Entonces:
--
--   30 días →   600.000 filas → ~195 MB   cómodo, pero una exportación mensual corrida tarde
--                                          se pierde parte del mes que venía a respaldar
--   45 días →   900.000 filas → ~293 MB   ← ELEGIDO
--   60 días → 1.200.000 filas → ~390 MB   el 78 % de los 500 MB del plan Free, con UN solo cliente
--
-- 45 le da a la exportación mensual **15 días de gracia**: se puede correr el día 15 y el mes
-- anterior sigue entero. 60 no compraba nada más que eso y dejaba la base sin aire.
--
-- 🔴 ESTA CUENTA VALE PARA UN TENANT. Con una segunda distribuidora hay que rehacerla ANTES de
-- sumarla, no después. El respaldo mensual por empresa se baja desde
-- `features/gestion/RespaldoDatos.jsx`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La política, en un solo lugar
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.limpiar_posiciones_viejas()
returns void
language sql
security definer
set search_path to 'public'
as $function$
  delete from public.posiciones where ts < now() - interval '45 days';
$function$;

comment on function public.limpiar_posiciones_viejas() is
  'ÚNICA política de retención de `posiciones`: 45 días. La llama el cron jobid 3, todos los días '
  'a las 03:30. No agregar otro job que borre de esta tabla — hasta el 19/08/2026 había tres con '
  'intervalos distintos y la política real terminaba siendo la del más estricto, sin que figurara '
  'en ningún lado. Si hay que cambiar el plazo, se cambia ACÁ, y se rehace la cuenta de MB del '
  'encabezado de db/42.';

-- 🚨 Regla 7 + 7-bis: revocar de los TRES. Borra filas salteando RLS; solo la llama el cron.
revoke execute on function public.limpiar_posiciones_viejas() from public;
revoke execute on function public.limpiar_posiciones_viejas() from anon;
revoke execute on function public.limpiar_posiciones_viejas() from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Los dos jobs que sobran
-- ─────────────────────────────────────────────────────────────────────────────
-- Se DESPROGRAMAN, no se desactivan: un job inactivo sigue apareciendo en `cron.job` y vuelve a
-- confundir al próximo que mire. El jobid 3 (`limpiar_posiciones_viejas`) queda como el único.
select cron.unschedule(jobid) from cron.job
 where command ilike '%delete from public.posiciones%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 🩸 EL ÍNDICE QUE **NO** SE BORRA — y por qué se creía que sí
-- ─────────────────────────────────────────────────────────────────────────────
-- El plan de esta migración decía que `posiciones_ts_idx` (btree sobre `ts`, 3,8 MB) era redundante
-- con `idx_posiciones_usuario_ts (id_usuario, ts)`, porque "toda consulta de la app filtra por
-- persona". El razonamiento era plausible y **es falso**. Medido antes de tocarlo:
--
--   indexrelname                 idx_scan     idx_tup_read
--   posiciones_ts_idx             305.992      851.604.300   ← el MÁS usado de la tabla
--   posiciones_client_uid_uidx    265.709           12.365
--   posiciones_pkey               131.046        3.599.396
--   idx_posiciones_usuario_ts      54.971       77.344.340
--
-- O sea que el "redundante" se usa **5,6 veces más** que aquel con el que se lo iba a reemplazar.
-- Borrarlo habría degradado el barrido de retención y todo lo que consulta por rango de tiempo sin
-- filtrar por persona. Se queda, y la única forma de haberlo sabido era mirar `pg_stat_user_indexes`
-- en vez de razonar sobre el esquema. (Regla 49: contrastar la hipótesis contra los datos.)
--
-- ⚠️ `posiciones_client_uid_uidx` NO SE TOCA JAMÁS (regla 6). Si deja de ser único, o se vuelve
-- parcial, el upsert de posiciones revienta con 42P10 y **se cae todo el GPS en silencio**.

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Verificación (correr a mano después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
--   select jobid, schedule, command from cron.job order by jobid;
--   -- esperado: UN solo job que toque `posiciones` (el 3)
--
--   select min(ts), max(ts), count(*) from public.posiciones;
--   -- la ventana debería empezar a crecer hasta llegar a 45 días
--
--   select pg_size_pretty(pg_total_relation_size('public.posiciones'));
--   -- vigilar que no pase de ~300 MB; si pasa, rehacer la cuenta del encabezado
