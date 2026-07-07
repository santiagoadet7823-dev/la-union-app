-- ============================================================
-- Distribuidora LA UNIÓN — Esquema de producción (Supabase / Postgres)
-- Aplica: tablas + RLS + Realtime + Storage de firmas.
-- ============================================================

-- ---------- Perfiles (extiende auth.users) ----------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  rol text not null default 'vendedor' check (rol in ('vendedor','repartidor','admin')),
  vehiculo text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Helper: ¿el usuario actual es admin? (security definer para evitar recursión en RLS)
create or replace function public.es_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

-- Trigger: crear perfil automáticamente al registrarse
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, rol)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre', new.email),
    coalesce(new.raw_user_meta_data->>'rol', 'vendedor')
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Clientes ----------
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  nombre_comercio text not null,
  lat double precision,
  lng double precision,
  localidad text,
  dias_visita text,
  frecuencia text,
  geofence_radio int default 75,
  horario text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- Productos ----------
create table if not exists public.productos (
  id uuid primary key default gen_random_uuid(),
  codigo text unique,
  descripcion text not null,
  precio_unitario numeric(12,2) default 0,
  peso_kg numeric(10,2) default 0,
  categoria text
);

-- ---------- Pedidos ----------
create table if not exists public.pedidos (
  id uuid primary key default gen_random_uuid(),
  numero text,
  id_vendedor uuid references public.perfiles(id),
  id_cliente uuid references public.clientes(id),
  estado text not null default 'Pendiente'
    check (estado in ('Pendiente','En camino','Entregado','No entregado','Sin pedido')),
  monto_total numeric(12,2) default 0,
  peso_total numeric(10,2) default 0,
  ts_entrada timestamptz,
  ts_salida timestamptz,
  minutos int,
  ts_en_camino timestamptz,
  ts_entregado timestamptz,
  id_repartidor uuid references public.perfiles(id),
  firma_url text,
  motivo_no_venta text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pedidos_vendedor on public.pedidos(id_vendedor);
create index if not exists idx_pedidos_repartidor on public.pedidos(id_repartidor);
create index if not exists idx_pedidos_estado on public.pedidos(estado);

-- ---------- Items de pedido ----------
create table if not exists public.pedido_items (
  id uuid primary key default gen_random_uuid(),
  id_pedido uuid not null references public.pedidos(id) on delete cascade,
  id_producto uuid references public.productos(id),
  descripcion text,
  cantidad int not null default 0,
  cantidad_entregada int,
  motivo_faltante text,
  precio_unitario numeric(12,2) default 0,
  peso_kg numeric(10,2) default 0
);
create index if not exists idx_items_pedido on public.pedido_items(id_pedido);

-- ---------- Posiciones GPS (en vivo + breadcrumbs) ----------
create table if not exists public.posiciones (
  id bigint generated always as identity primary key,
  id_usuario uuid references public.perfiles(id),
  rol text,
  lat double precision not null,
  lng double precision not null,
  ts timestamptz not null default now()
);
create index if not exists idx_posiciones_usuario_ts on public.posiciones(id_usuario, ts desc);

-- ---------- Rutas / planes ----------
create table if not exists public.rutas (
  id uuid primary key default gen_random_uuid(),
  fecha date not null default current_date,
  id_usuario uuid references public.perfiles(id),
  objetivo text,
  orden_paradas jsonb,
  estado text default 'planificada',
  created_at timestamptz not null default now()
);

-- ============================================================
-- RLS
-- ============================================================
alter table public.perfiles      enable row level security;
alter table public.clientes      enable row level security;
alter table public.productos     enable row level security;
alter table public.pedidos       enable row level security;
alter table public.pedido_items  enable row level security;
alter table public.posiciones    enable row level security;
alter table public.rutas         enable row level security;

-- perfiles: cada quien el suyo; admin todos
create policy perfiles_sel on public.perfiles for select using (id = auth.uid() or public.es_admin());
create policy perfiles_upd on public.perfiles for update using (id = auth.uid() or public.es_admin());

-- clientes / productos: lectura a autenticados; escritura admin
create policy clientes_sel on public.clientes for select using (auth.role() = 'authenticated');
create policy clientes_wr  on public.clientes for all using (public.es_admin()) with check (public.es_admin());
create policy productos_sel on public.productos for select using (auth.role() = 'authenticated');
create policy productos_wr  on public.productos for all using (public.es_admin()) with check (public.es_admin());

-- pedidos: vendedor los suyos, repartidor los asignados, admin todos
create policy pedidos_sel on public.pedidos for select
  using (public.es_admin() or id_vendedor = auth.uid() or id_repartidor = auth.uid());
create policy pedidos_ins on public.pedidos for insert
  with check (id_vendedor = auth.uid() or public.es_admin());
create policy pedidos_upd on public.pedidos for update
  using (public.es_admin() or id_vendedor = auth.uid() or id_repartidor = auth.uid());

-- items: acceso heredado del pedido padre
create policy items_sel on public.pedido_items for select using (
  exists (select 1 from public.pedidos p where p.id = id_pedido
    and (public.es_admin() or p.id_vendedor = auth.uid() or p.id_repartidor = auth.uid())));
create policy items_wr on public.pedido_items for all using (
  exists (select 1 from public.pedidos p where p.id = id_pedido
    and (public.es_admin() or p.id_vendedor = auth.uid() or p.id_repartidor = auth.uid())))
  with check (
  exists (select 1 from public.pedidos p where p.id = id_pedido
    and (public.es_admin() or p.id_vendedor = auth.uid() or p.id_repartidor = auth.uid())));

-- posiciones: inserto la mía; admin lee todas
create policy posiciones_ins on public.posiciones for insert with check (id_usuario = auth.uid());
create policy posiciones_sel on public.posiciones for select using (public.es_admin() or id_usuario = auth.uid());

-- rutas: la mía; admin todo
create policy rutas_sel on public.rutas for select using (public.es_admin() or id_usuario = auth.uid());
create policy rutas_wr  on public.rutas for all using (public.es_admin()) with check (public.es_admin());

-- ============================================================
-- Realtime
-- ============================================================
alter publication supabase_realtime add table public.posiciones;
alter publication supabase_realtime add table public.pedidos;

-- ============================================================
-- Storage: bucket de firmas (lectura pública, escritura autenticada)
-- ============================================================
insert into storage.buckets (id, name, public) values ('firmas', 'firmas', true)
  on conflict (id) do nothing;
create policy firmas_ins on storage.objects for insert to authenticated with check (bucket_id = 'firmas');
create policy firmas_sel on storage.objects for select using (bucket_id = 'firmas');
