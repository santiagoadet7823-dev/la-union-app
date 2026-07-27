-- 20_propietario_rol.sql — Actualización 1.6.x (27/07/2026).
-- Resuelve la deuda §8 #3 de la auditoría: el rol 'propietario' se usa en el código (App.jsx,
-- AppShell, SupervisionMovil/Desktop) y ya aparece en varias policies RLS vivas (clientes_sel,
-- posiciones_sel, estado_disp_sel, etc.), PERO estaba fuera del check constraint de perfiles.rol,
-- así que no se podía dar de alta un propietario desde UsuariosView.
-- Cambio ADITIVO y seguro: agrega 'propietario' a los valores permitidos; ninguna fila existente
-- se invalida (todas ya usan roles válidos).

alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check
  check (rol = any (array['superadmin','admin','encargado','vendedor','repartidor','propietario']));
