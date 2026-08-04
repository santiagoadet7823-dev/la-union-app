-- db/29 — Telemetría de captura de 1.9.0 + diagnóstico de notificaciones (04/08/2026).
--
-- ⚠️ Aplicado en la base viva el 04/08/2026 (migración `telemetria_190_y_notif_permiso`). Este
-- archivo es el REGISTRO, no la fuente de verdad: regla 5.
--
-- 🩸 POR QUÉ: el APK 1.9.0 tomó un WakeLock parcial y dejó de re-pedir updates a cada rato, y
-- `UploaderGpsPlugin.estado()` YA devuelve `intervalo`, `repedidos`, `silencioMax` y `fixesRed`
-- desde entonces. Pero no había dónde guardarlos, así que el latido los tiraba: la pregunta central
-- de 1.9.0 ("¿el WakeLock arregló los silencios, o hay que ir al carril de red?") no se podía
-- responder con un select. Sin estas columnas la verificación de campo es una opinión.
--
-- `notif_permiso` es la otra mitad, y del otro problema: en Android 13+ una negativa a
-- POST_NOTIFICATIONS queda pegada, `initPush` registra igual (a propósito: los mensajes de datos
-- del watchdog no dependen del permiso), así que el teléfono tiene token, el servidor cuenta
-- "enviado" y en la pantalla no aparece nada. Hoy eso es invisible desde acá.
--
-- `aviso_version` cierra el paso manual del release: `push-actualizacion` solo le manda a quien
-- está atrasado Y todavía no fue avisado de ESTA versión, y la sella al mandar → exactamente un
-- aviso por teléfono y por versión, sin depender de que alguien se acuerde de correr un SQL.
alter table public.estado_dispositivo
  add column if not exists gps_intervalo_ms    bigint,
  add column if not exists gps_repedidos       integer,
  add column if not exists gps_silencio_max_ms bigint,
  add column if not exists gps_fixes_red       integer,
  add column if not exists notif_permiso       text,
  add column if not exists aviso_version       text;

comment on column public.estado_dispositivo.gps_intervalo_ms is
  'Cadencia PEDIDA al proveedor (ms). Se contrasta contra la entregada, que sale de posiciones.';
comment on column public.estado_dispositivo.gps_repedidos is
  'Cuántas veces se re-pidió requestLocationUpdates hoy. Cada re-pedido reinicia la agenda de entrega: en decenas está bien, en cientos hay churn.';
comment on column public.estado_dispositivo.gps_silencio_max_ms is
  'El silencio más largo del día sin un solo fix. Es lo que decide si el WakeLock alcanzó.';
comment on column public.estado_dispositivo.gps_fixes_red is
  'Fixes triangulados por antenas/WiFi durante un silencio (accuracy > 30). Van punteados y fuera de los km.';
comment on column public.estado_dispositivo.notif_permiso is
  'granted | denied | prompt — resultado de PushNotifications.checkPermissions(). Sin esto, "no me llegan las notificaciones" es una conjetura.';
comment on column public.estado_dispositivo.aviso_version is
  'Última versión de la que YA se le avisó a este teléfono. La sella push-actualizacion; evita repetir el cartel.';

-- No hace falta tocar RLS: `estado_dispositivo` ya tiene las policies por usuario/empresa y estas
-- columnas viajan en el mismo upsert del latido (`useEstadoDispositivo`).
--
-- Consulta de verificación, al día siguiente de que los teléfonos actualicen:
--   select p.nombre, d.app_version, d.notif_permiso,
--          d.gps_intervalo_ms, d.gps_repedidos,
--          round(d.gps_silencio_max_ms / 60000.0, 1) as silencio_max_min, d.gps_fixes_red
--   from public.estado_dispositivo d join public.perfiles p on p.id = d.id_usuario
--   order by d.gps_silencio_max_ms desc nulls last;
