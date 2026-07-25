-- 13_track_days.sql — aplicada en vivo el 24/07/2026 (MCP apply_migration).
-- Días de la semana en que corre la jornada de rastreo (1=Lunes … 7=Domingo, ISO 8601).
-- NULL o array vacío = TODOS los días (retrocompatible: antes la jornada no distinguía día, solo hora).
-- Lo edita el superadmin en EmpresasView. Se combina con track_start/track_end vía dentroDeHorario()
-- en src/services/tracking.js — la hora sigue mandando; el día solo agrega un filtro extra.
-- Pedido del cliente 24/07/2026: jornada Lun–Sáb (track_days = {1,2,3,4,5,6}). El VALOR lo setea el
-- superadmin desde la UI; esta migración solo agrega la columna (no cambia la config viva).
alter table public.app_config add column if not exists track_days int[];
