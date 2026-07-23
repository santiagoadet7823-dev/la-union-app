-- 09_categorias.sql
-- ⚠️ DOCUMENTACIÓN. Ya aplicado en la base VIVA (migración `tabla_categorias`, 2026-07-22).
-- NO re-ejecutar a ciegas (los db/*.sql no son la fuente de verdad; ver 00_LEER_PRIMERO.md).
--
-- Categorías de producto gestionables por empresa. productos.categoria SIGUE siendo texto
-- (sin FK): esta tabla solo alimenta el selector del alta/edición y el gestor de categorías.
-- Renombrar propaga el texto a productos; quitar manda sus productos a 'Otros' (lógica en la app).

create table if not exists public.categorias (
  id uuid primary key default gen_random_uuid(),
  id_empresa uuid references public.empresas(id),
  nombre text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_categorias_empresa on public.categorias(id_empresa);

alter table public.categorias enable row level security;

-- Mismo patrón de aislamiento por empresa que zonas (helpers es_superadmin/mi_empresa/mi_rol).
drop policy if exists categorias_sel on public.categorias;
create policy categorias_sel on public.categorias for select
  using (es_superadmin() or (id_empresa = mi_empresa()));

drop policy if exists categorias_wr on public.categorias;
create policy categorias_wr on public.categorias for all
  using (es_superadmin() or ((id_empresa = mi_empresa()) and (mi_rol() = any (array['admin','encargado','superadmin']))))
  with check (es_superadmin() or ((id_empresa = mi_empresa()) and (mi_rol() = any (array['admin','encargado','superadmin']))));
