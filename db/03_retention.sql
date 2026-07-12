-- ============================================================
-- LA UNIÓN — Retención de posiciones GPS (plan gratuito, 500MB)
--
-- Aplicar manualmente en el SQL Editor de Supabase (este repo no tiene tooling
-- de migraciones; mismo patrón que db/schema.sql y db/02_saas.sql).
--
-- ANTES de correr el cron.schedule(...) de abajo, habilitar la extensión pg_cron:
--   Supabase Dashboard → Database → Extensions → buscar "pg_cron" → Enable.
-- Si no está disponible en tu plan/proyecto, la función limpiar_posiciones_viejas()
-- igual sirve — se puede invocar manualmente o desde otro disparador externo
-- mientras tanto.
-- ============================================================

-- Borra posiciones GPS con más de 7 días de antigüedad.
create or replace function public.limpiar_posiciones_viejas() returns void
  language sql security definer set search_path = public as $$
  delete from public.posiciones where ts < now() - interval '7 days';
$$;

-- Corre una vez por día a las 03:30 (fuera de la ventana de rastreo habitual,
-- 07:30-22:00), para minimizar contención con el uso normal de la app.
select cron.schedule(
  'limpiar_posiciones_viejas_diario',
  '30 3 * * *',
  $$ select public.limpiar_posiciones_viejas(); $$
);

-- Nota sobre índices: NO se agrega un índice nuevo sobre `ts`. El índice compuesto
-- existente (id_usuario, ts desc) no ayuda a este WHERE ts < X sin filtrar por
-- usuario, pero el borrado corre una sola vez por día — un índice nuevo costaría
-- espacio (cuenta contra los 500MB) y overhead de escritura en cada insert de GPS
-- durante todo el día, peor que un seq scan nocturno único.
