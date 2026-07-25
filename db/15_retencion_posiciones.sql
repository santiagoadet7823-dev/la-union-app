-- 15_retencion_posiciones.sql — aplicada en vivo el 24/07/2026 (MCP apply_migration).
-- Retención de posiciones: con la cadencia "casi en vivo" (10 s, gpsConfig.NEAR_LIVE_MS) la tabla
-- crece ~3.780 filas/vendedor/día. Sin poda, el disco de Supabase se llena en meses.
-- Se conservan 60 DÍAS de historial (decisión del cliente 24/07/2026).
-- REVERSIBLE: cambiar el intervalo del job, o `select cron.unschedule('poda-posiciones-60d')` para apagarlo.
--
-- OJO: si el cliente pide volver a bajar la cadencia (subir NEAR_LIVE_MS a 15 s por batería), esto no
-- se toca; solo cambia el ritmo de crecimiento.

-- Índice por ts: antes NO existía (la poda y las consultas por día recorrían la tabla entera). Btree
-- plano, NO parcial — la regla 6 aplica al índice de client_uid, este es otro y es seguro.
create index if not exists posiciones_ts_idx on public.posiciones (ts);

-- Job nocturno (03:30 UTC = 00:30 AR, fuera de la jornada). cron.schedule hace upsert por nombre:
-- re-ejecutar no duplica el job.
select cron.schedule(
  'poda-posiciones-60d',
  '30 3 * * *',
  $$delete from public.posiciones where ts < now() - interval '60 days'$$
);
