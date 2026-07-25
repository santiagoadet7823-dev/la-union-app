-- 12_color_trazo.sql — aplicada en vivo el 24/07/2026 (MCP apply_migration).
-- Color del trazo/marcador del usuario en el mapa. NULL = usar el color automático por hash
-- (colorPorId en src/lib/colors.js). Hex '#RRGGBB'.
-- Lo edita SOLO el superadmin desde UsuariosView. NO hace falta policy nueva: la policy viva
-- `perfiles_upd` ya es `es_superadmin() OR (mi_rol()='admin' AND id_empresa=mi_empresa())`, así que
-- el superadmin ya puede actualizar perfiles. El gate a superadmin está en la UI (igual que el
-- resto del ABM de usuarios). Verificado contra la base viva antes de aplicar (regla 5).
alter table public.perfiles add column if not exists color_trazo text;
