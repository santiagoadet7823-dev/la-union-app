-- 14_instalado_ts.sql — aplicada en vivo el 24/07/2026 (MCP apply_migration).
-- Fecha real de instalación del APK en el dispositivo (PackageManager.firstInstallTime, epoch → ISO).
-- La reporta el latido (useEstadoDispositivo) leyendo el plugin nativo InfoApp (android/.../InfoAppPlugin.java).
-- NULL en PWA/web (no hay APK) o si el equipo todavía no corrió el JS nuevo. Para mostrar
-- "instalada hace X" en supervisión (EstadoEquipo). Pedido del cliente 24/07/2026.
alter table public.estado_dispositivo add column if not exists instalado_ts timestamptz;
