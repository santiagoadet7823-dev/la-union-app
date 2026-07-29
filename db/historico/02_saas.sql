-- ⚠ VER db/00_LEER_PRIMERO.md ANTES DE APLICAR — puede reabrir agujeros de seguridad en una base con datos.
-- ============================================================
-- LA UNIÓN — Migración a SaaS multi-tenant + roles ampliados
-- (empresas, id_empresa, RLS por tenant, roles, purga de prueba)
-- ============================================================

-- ---------- Empresas (tenants) ----------
create table if not exists public.empresas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  activo boolean not null default false,   -- palanca de "suscripción" (P2P, la controla el superadmin)
  created_at timestamptz not null default now()
);
alter table public.empresas enable row level security;

-- ---------- Perfiles: multi-tenant + roles + pendiente por defecto ----------
alter table public.perfiles add column if not exists id_empresa uuid references public.empresas(id);
alter table public.perfiles add column if not exists email text;
alter table public.perfiles alter column rol drop not null;
alter table public.perfiles alter column rol drop default;
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check
  check (rol in ('superadmin','admin','encargado','vendedor','repartidor'));
alter table public.perfiles alter column activo set default false;

-- ---------- Helpers RLS ----------
create or replace function public.mi_empresa() returns uuid
  language sql security definer stable set search_path = public as $$
  select id_empresa from public.perfiles where id = auth.uid();
$$;
create or replace function public.mi_rol() returns text
  language sql security definer stable set search_path = public as $$
  select rol from public.perfiles where id = auth.uid();
$$;
create or replace function public.es_superadmin() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'superadmin');
$$;
create or replace function public.es_admin() returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol in ('admin','superadmin'));
$$;

-- ---------- Trigger: nuevo usuario queda PENDIENTE (sin rol, inactivo) ----------
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, email, rol, activo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', new.email),
    new.email, null, false
  )
  on conflict (id) do nothing;
  return new;
end; $$;

-- ---------- id_empresa en tablas de datos ----------
alter table public.clientes   add column if not exists id_empresa uuid references public.empresas(id);
alter table public.productos  add column if not exists id_empresa uuid references public.empresas(id);
alter table public.pedidos    add column if not exists id_empresa uuid references public.empresas(id);
alter table public.posiciones add column if not exists id_empresa uuid references public.empresas(id);
alter table public.rutas      add column if not exists id_empresa uuid references public.empresas(id);

-- ============================================================
-- RLS (reemplazo por scope de empresa)
-- ============================================================

-- empresas
drop policy if exists empresas_sel on public.empresas;
create policy empresas_sel on public.empresas for select
  using (public.es_superadmin() or id = public.mi_empresa());
drop policy if exists empresas_all on public.empresas;
create policy empresas_all on public.empresas for all
  using (public.es_superadmin()) with check (public.es_superadmin());

-- perfiles
drop policy if exists perfiles_sel on public.perfiles;
create policy perfiles_sel on public.perfiles for select using (
  id = auth.uid() or public.es_superadmin()
  or (id_empresa = public.mi_empresa() and public.mi_rol() in ('admin','encargado'))
);
drop policy if exists perfiles_upd on public.perfiles;
create policy perfiles_upd on public.perfiles for update using (
  public.es_superadmin() or (id_empresa = public.mi_empresa() and public.mi_rol() = 'admin') or id = auth.uid()
) with check (
  public.es_superadmin() or (id_empresa = public.mi_empresa() and public.mi_rol() = 'admin') or id = auth.uid()
);

-- clientes
drop policy if exists clientes_sel on public.clientes;
drop policy if exists clientes_wr on public.clientes;
create policy clientes_sel on public.clientes for select
  using (public.es_superadmin() or id_empresa = public.mi_empresa());
create policy clientes_wr on public.clientes for all
  using (public.es_superadmin() or id_empresa = public.mi_empresa())
  with check (public.es_superadmin() or id_empresa = public.mi_empresa());

-- productos
drop policy if exists productos_sel on public.productos;
drop policy if exists productos_wr on public.productos;
create policy productos_sel on public.productos for select
  using (public.es_superadmin() or id_empresa = public.mi_empresa());
create policy productos_wr on public.productos for all
  using (public.es_superadmin() or (id_empresa = public.mi_empresa() and public.mi_rol() in ('admin','encargado')))
  with check (public.es_superadmin() or (id_empresa = public.mi_empresa() and public.mi_rol() in ('admin','encargado')));

-- pedidos
drop policy if exists pedidos_sel on public.pedidos;
drop policy if exists pedidos_ins on public.pedidos;
drop policy if exists pedidos_upd on public.pedidos;
create policy pedidos_sel on public.pedidos for select using (
  public.es_superadmin() or (id_empresa = public.mi_empresa()
    and (public.mi_rol() in ('admin','encargado') or id_vendedor = auth.uid() or id_repartidor = auth.uid()))
);
create policy pedidos_ins on public.pedidos for insert with check (
  id_empresa = public.mi_empresa() and (id_vendedor = auth.uid() or public.es_admin())
);
create policy pedidos_upd on public.pedidos for update using (
  public.es_superadmin() or (id_empresa = public.mi_empresa()
    and (public.mi_rol() in ('admin','encargado') or id_vendedor = auth.uid() or id_repartidor = auth.uid()))
);

-- pedido_items (heredan del pedido)
drop policy if exists items_sel on public.pedido_items;
drop policy if exists items_wr on public.pedido_items;
create policy items_sel on public.pedido_items for select using (
  exists (select 1 from public.pedidos p where p.id = id_pedido and (
    public.es_superadmin() or (p.id_empresa = public.mi_empresa()
      and (public.mi_rol() in ('admin','encargado') or p.id_vendedor = auth.uid() or p.id_repartidor = auth.uid()))))
);
create policy items_wr on public.pedido_items for all using (
  exists (select 1 from public.pedidos p where p.id = id_pedido and (
    public.es_superadmin() or (p.id_empresa = public.mi_empresa()
      and (public.mi_rol() in ('admin','encargado') or p.id_vendedor = auth.uid() or p.id_repartidor = auth.uid()))))
) with check (
  exists (select 1 from public.pedidos p where p.id = id_pedido and (public.es_superadmin() or p.id_empresa = public.mi_empresa()))
);

-- posiciones
drop policy if exists posiciones_ins on public.posiciones;
drop policy if exists posiciones_sel on public.posiciones;
create policy posiciones_ins on public.posiciones for insert
  with check (id_usuario = auth.uid() and id_empresa = public.mi_empresa());
create policy posiciones_sel on public.posiciones for select using (
  public.es_superadmin() or id_usuario = auth.uid()
  or (id_empresa = public.mi_empresa() and public.mi_rol() in ('admin','encargado'))
);

-- rutas
drop policy if exists rutas_sel on public.rutas;
drop policy if exists rutas_wr on public.rutas;
create policy rutas_sel on public.rutas for select using (
  public.es_superadmin() or (id_empresa = public.mi_empresa()
    and (public.mi_rol() in ('admin','encargado') or id_usuario = auth.uid()))
);
create policy rutas_wr on public.rutas for all
  using (public.es_superadmin() or (id_empresa = public.mi_empresa() and public.mi_rol() = 'admin'))
  with check (public.es_superadmin() or (id_empresa = public.mi_empresa() and public.mi_rol() = 'admin'));
