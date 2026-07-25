-- 11_apk_version.sql — aplicada en vivo el 24/07/2026 (MCP apply_migration).
-- La versión NATIVA del APK (versionName), distinta de app_version que es la del bundle OTA (JS).
-- Sirve para detectar equipos con APK viejo sin los plugins nativos nuevos (ej. <1.5.42 sin push):
-- un equipo puede tener la OTA al día y aun así, con APK viejo, no correr el watchdog nativo.
-- La reporta el propio móvil en cada latido (useEstadoDispositivo.js) vía CapApp.getInfo().version.
-- En web/PWA queda NULL (la PWA no tiene APK).
alter table public.estado_dispositivo add column if not exists apk_version text;
