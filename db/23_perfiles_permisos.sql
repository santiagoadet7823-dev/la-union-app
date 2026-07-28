-- 23_perfiles_permisos.sql — Permisos extra por usuario (28/07/2026).
--
-- EL PEDIDO: que un VENDEDOR pueda editar las fotos del catálogo sin dejar de ser vendedor.
--
-- POR QUÉ NO UN ROL NUEVO ('marketing'): los roles de esta app son EXCLUYENTES. `RoleRouter`
-- (App.jsx) es un if/else — un usuario con rol 'marketing' dejaría de entrar por la rama de
-- vendedor y perdería la vista de jornada, el `GpsGate` y la captura de GPS; además desaparecería
-- del equipo (`usePerfilesEquipo` filtra por rol) y del mapa. El rol define QUÉ ES la persona;
-- esto es otra cosa: qué MÁS puede hacer.
--
-- Un array y no un boolean porque ya se ven más casos del mismo tipo (revisar duplicados, cargar
-- precios); con un boolean cada uno sería otra columna y otra migración.

alter table public.perfiles add column if not exists permisos text[] not null default '{}';

comment on column public.perfiles.permisos is
  'Permisos EXTRA, además de los que da el rol. Hoy: ''catalogo'' (editar productos y fotos).';

-- Helper para las policies. Misma familia que mi_rol() / mi_empresa(): SECURITY DEFINER porque lo
-- invocan políticas RLS como el rol que consulta, y STABLE para que el planner lo evalúe una vez.
--
-- 🚨 NUNCA revocarle EXECUTE a esta función (regla 8 de CLAUDE.md). Si se revoca, toda policy que
-- la use deja de evaluarse y se cae la escritura de catálogo entera. El linter de Supabase la va a
-- marcar igual que a mi_rol(): ignorarlo, la exposición es nula (solo lee la fila de auth.uid()).
create or replace function public.mis_permisos()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(permisos, '{}') from public.perfiles where id = auth.uid();
$$;

-- Regla 7: se revoca de PUBLIC, que es de donde Postgres lo concede por defecto.
revoke execute on function public.mis_permisos() from public;
grant  execute on function public.mis_permisos() to authenticated;

-- El cuello de botella REAL. Sin esto, un vendedor con el permiso sube la foto a Storage (las
-- policies de storage.objects son `to authenticated`, sin filtro de rol) pero NO puede escribir
-- `productos.imagen_url`, así que la foto queda huérfana y la app se ve rota sin decir por qué.
drop policy if exists productos_wr on public.productos;
create policy productos_wr on public.productos
  for all
  using (
    es_superadmin()
    or (id_empresa = mi_empresa()
        and (mi_rol() = any (array['admin', 'encargado'])
             or 'catalogo' = any (mis_permisos())))
  )
  with check (
    es_superadmin()
    or (id_empresa = mi_empresa()
        and (mi_rol() = any (array['admin', 'encargado'])
             or 'catalogo' = any (mis_permisos())))
  );
