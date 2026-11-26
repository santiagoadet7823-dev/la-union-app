-- 114_comercios_articulo_y_novedades.sql — plan 53 (26/11/2026).
--
-- 1. `consolidado_articulo_detalle(p_ids, p_clave)`: al tocar un artículo en el consolidado de Pedidos,
--    los renglones de ESE artículo en los pedidos dados (para saber qué comercios lo pidieron y cuándo,
--    y rastrear una mala entrega). Misma clave y mismo criterio que `consolidado_articulos` (db/105):
--    sin anulados, SECURITY INVOKER (la RLS de pedidos/pedido_items decide qué se ve).
--    Devuelve [[id_pedido, cantidad, cantidad_entregada, importe], …]; la cabecera del pedido
--    (comercio, fecha, vendedor, estado) ya la tiene la pantalla.
--
-- 2. `entrega_novedades`: lo que el repartidor anota al entregar (pago mixto, devolución, algo roto,
--    cambio pedido por el cliente, otro, o el motivo de "No pude entregar"), con montos y hasta 2 fotos.
--    Tabla aparte y no `pedidos.observaciones`: esa columna es del vendedor, viaja al ERP y el trigger
--    `pedido_exportado_congelado` la bloquea después de exportar, que es justo cuando se reparte.
--    Insertar: quien puede ver el pedido como repartidor (o el superadmin). Leer: quien ve el pedido.
--
-- 3. Bucket privado `novedades-entrega`: ruta `<empresa>/<id_pedido>/<archivo>.jpg`. Leer y subir solo
--    si el pedido de la ruta es visible para quien lo pide (RLS de pedidos) y es de su empresa.
--
-- Sin begin/commit: probar con `begin; \i ...; rollback;` y aplicar con `psql -1 -f`.

-- ── 1 ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.consolidado_articulo_detalle(p_ids uuid[], p_clave text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_array(
           r.id_pedido, trim_scale(r.cantidad), trim_scale(r.cantidad_entregada),
           trim_scale(r.importe)) order by r.id_pedido), '[]'::jsonb)
  from (
    select i.id_pedido,
           sum(i.cantidad)                                   as cantidad,
           sum(i.cantidad_entregada)                         as cantidad_entregada,
           sum(i.cantidad * coalesce(i.precio_unitario, 0))  as importe
    from public.pedidos p
    join public.pedido_items i on i.id_pedido = p.id
    where p.id = any(p_ids)
      and p.estado <> 'Anulado'
      and coalesce('p:' || i.id_producto::text,
                   'c:' || nullif(btrim(i.codigo_producto), ''),
                   'd:' || upper(btrim(coalesce(i.descripcion, '')))) = p_clave
    group by i.id_pedido
  ) r
$$;

comment on function public.consolidado_articulo_detalle(uuid[], text) is
  'Plan 53: renglones de un artículo (clave de consolidado_articulos) en los pedidos dados, sumados por pedido. SECURITY INVOKER.';

revoke all on function public.consolidado_articulo_detalle(uuid[], text) from public, anon;
grant execute on function public.consolidado_articulo_detalle(uuid[], text) to authenticated;

-- ── 2 ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.entrega_novedades (
  id                  uuid primary key default gen_random_uuid(),
  id_empresa          uuid not null references public.empresas(id),
  id_pedido           uuid not null references public.pedidos(id) on delete cascade,
  id_repartidor       uuid references public.perfiles(id),
  tipos               text[] not null default '{}',
  monto_efectivo      numeric(14,2),
  monto_transferencia numeric(14,2),
  detalle             text,
  fotos               text[] not null default '{}',
  created_at          timestamptz not null default now(),
  constraint entrega_novedades_tipos_check check (
    tipos <@ array['pago_mixto','devolucion','rotura','cambio_cliente','otro',
                   'no_entregado_cerrado','no_entregado_ausente','no_entregado_rechazo','no_entregado_otro']::text[]),
  constraint entrega_novedades_algo_check check (cardinality(tipos) > 0 or coalesce(btrim(detalle), '') <> ''),
  constraint entrega_novedades_montos_check check (coalesce(monto_efectivo, 0) >= 0 and coalesce(monto_transferencia, 0) >= 0),
  constraint entrega_novedades_fotos_check check (cardinality(fotos) <= 2),
  constraint entrega_novedades_detalle_check check (char_length(coalesce(detalle, '')) <= 1000)
);

create index if not exists entrega_novedades_pedido_idx on public.entrega_novedades (id_pedido);
create index if not exists entrega_novedades_empresa_ts_idx on public.entrega_novedades (id_empresa, created_at desc);

alter table public.entrega_novedades enable row level security;

-- Leer: quien ve el pedido (pedidos_sel ya aplica superadmin / empresa / a cargo).
drop policy if exists entrega_novedades_sel on public.entrega_novedades;
create policy entrega_novedades_sel on public.entrega_novedades for select to authenticated
using (exists (select 1 from public.pedidos p where p.id = entrega_novedades.id_pedido));

-- Insertar: el repartidor del pedido (o quien lo tiene a cargo) en su empresa; el superadmin siempre.
drop policy if exists entrega_novedades_ins on public.entrega_novedades;
create policy entrega_novedades_ins on public.entrega_novedades for insert to authenticated
with check (
  public.es_superadmin()
  or (
    id_empresa = public.mi_empresa()
    and exists (select 1 from public.pedidos p
                where p.id = entrega_novedades.id_pedido
                  and p.id_empresa = public.mi_empresa()
                  and p.id_repartidor in (select public.ids_a_mi_cargo()))
  )
);

-- Completar las fotos después (la novedad se guarda sin red y las fotos suben cuando vuelve).
drop policy if exists entrega_novedades_upd on public.entrega_novedades;
create policy entrega_novedades_upd on public.entrega_novedades for update to authenticated
using (
  public.es_superadmin()
  or (id_empresa = public.mi_empresa() and id_repartidor = auth.uid())
)
with check (
  public.es_superadmin()
  or (id_empresa = public.mi_empresa() and id_repartidor = auth.uid())
);

grant select, insert, update on public.entrega_novedades to authenticated;
revoke all on public.entrega_novedades from anon;

comment on table public.entrega_novedades is
  'Plan 53: novedades que anota el repartidor al entregar (pago mixto, devolución, rotura, cambio, motivo de no entrega), con montos y hasta 2 fotos del bucket novedades-entrega.';

-- ── 3 ─────────────────────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('novedades-entrega', 'novedades-entrega', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- El pedido de la ruta (`<empresa>/<id_pedido>/…`) tiene que ser de su empresa y visible para quien
-- pide (la consulta a pedidos corre con su RLS). Security invoker a propósito.
create or replace function public.puede_ver_novedad_objeto(p_name text)
returns boolean language sql stable security invoker set search_path = public, storage
as $$
  select case
    when (storage.foldername(p_name))[2] !~ '^[0-9a-f-]{36}$' then false
    else exists (
      select 1 from public.pedidos p
      where p.id = ((storage.foldername(p_name))[2])::uuid
        and p.id_empresa::text = (storage.foldername(p_name))[1]
        and (public.es_superadmin() or p.id_empresa = public.mi_empresa()))
  end
$$;
revoke execute on function public.puede_ver_novedad_objeto(text) from public;
grant execute on function public.puede_ver_novedad_objeto(text) to authenticated;

drop policy if exists novedades_entrega_sel on storage.objects;
create policy novedades_entrega_sel on storage.objects for select to authenticated
  using (bucket_id = 'novedades-entrega' and public.puede_ver_novedad_objeto(name));

drop policy if exists novedades_entrega_ins on storage.objects;
create policy novedades_entrega_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'novedades-entrega' and public.puede_ver_novedad_objeto(name));

notify pgrst, 'reload schema';
