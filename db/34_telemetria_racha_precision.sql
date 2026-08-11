-- 34 — La racha de descartes por precisión, y telemetría que no dependa del WebView (11/08/2026)
--
-- Aplicado contra la base viva por MCP el 11/08/2026. Lo estrena el APK 1.13.3+: hasta que ese APK
-- esté en la calle las dos columnas quedan en NULL, y eso está bien.
--
-- ── 1. fix_desc_precision_racha ─────────────────────────────────────────────────────────────────
-- `fix_desc_precision` dice cuántos fixes se tiraron EN TOTAL, y eso no distingue el goteo normal
-- (un fix malo suelto entre buenos) de la falla que costó 39,6 km de ruta: una RACHA entera sin un
-- solo fix usable. Alejandro mercado el 11/08 tenía 66 % de descarte y `gps_silencio_max_ms` de
-- 0,3 min — ninguno de los dos números decía que había estado media hora sin poder guardar nada.
-- Un número alto acá con silencio bajo = los fixes llegan y ninguno sirve.
alter table public.estado_dispositivo
  add column if not exists fix_desc_precision_racha integer;

comment on column public.estado_dispositivo.fix_desc_precision_racha is
  'Descartes por precisión CONSECUTIVOS, el peor del día. Lo escribe UploaderGpsService (1.13.3+): un número alto con silencio bajo = los fixes llegan y ninguno sirve.';

-- ── 2. telemetria_ts ────────────────────────────────────────────────────────────────────────────
-- Separa CUÁNDO se midió de cuándo llegó. Hasta 1.13.2 los contadores `fix_*` viajaban solo en el
-- latido del JS, que muere cuando el WebView se congela: el 11/08 los últimos latidos del parque
-- eran de las 07:37, 09:05, 09:47 y 11:17 mientras esos mismos cuatro teléfonos seguían subiendo
-- puntos hasta las 14:45 por el carril nativo. O sea que **justo cuando un teléfono falla, el
-- diagnóstico deja de llegar**, y una tabla que compara contadores entre personas está comparando
-- cortes de horas distintas sin decirlo (Orlando a las 07:37 daba 30 % de descarte; al cierre, 0 %).
--
-- Desde 1.13.3 los escribe también `ingest-posiciones`, que corre con cada lote (cada 5-10 s con
-- red), y sella este timestamp del lado del servidor.
--
-- ⚠️ Ese upsert toca SOLO los campos que produce el servicio nativo. `fcm_token`, `bg_ok`, `permiso`
-- y compañía siguen siendo del JS: un upsert que los mandara en null los borraría, que es
-- exactamente el bug del token FCM nulo. Por eso la lista de campos en la Edge Function es explícita
-- y corta, y un valor null se OMITE en vez de escribirse.
alter table public.estado_dispositivo
  add column if not exists telemetria_ts timestamptz;

comment on column public.estado_dispositivo.telemetria_ts is
  'Momento en que el SERVICIO NATIVO midió los contadores fix_*. Distinto de updated_at (el latido del JS).';
