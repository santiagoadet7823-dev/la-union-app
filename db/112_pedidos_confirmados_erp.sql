alter table public.pedidos
  add column if not exists erp_estado        text,
  add column if not exists erp_confirmado_ts timestamptz,
  add column if not exists erp_total         numeric(14,2),
  add column if not exists erp_comprobantes  text[],
  add column if not exists erp_diferencias   integer;

alter table public.pedidos drop constraint if exists pedidos_erp_estado_check;
alter table public.pedidos add constraint pedidos_erp_estado_check
  check (erp_estado is null or erp_estado in ('igual', 'modificado'));

create index if not exists pedidos_empresa_numero_idx on public.pedidos (id_empresa, numero);

create index if not exists pedidos_erp_estado_idx
  on public.pedidos (id_empresa, erp_estado) where erp_estado is not null;

create table if not exists public.ingestas_pedidos_erp (
  id               bigint generated always as identity primary key,
  id_empresa       uuid not null references public.empresas(id) on delete cascade,
  id_usuario       uuid references public.perfiles(id) on delete set null,
  ts               timestamptz not null default now(),
  probar           boolean not null default false,
  ip               text,
  agente           text,
  equipo           text,
  version_agente   text,
  ruta_origen      text,
  bytes            integer,
  sha256_cliente   text,
  sha256_servidor  text,
  archivo          text,
  filas            integer,
  pedidos          integer,
  iguales          integer,
  modificados      integer,
  rechazados       integer,
  resultado        text not null,
  detalle          jsonb
);

create index if not exists ingestas_pedidos_erp_empresa_ts_idx
  on public.ingestas_pedidos_erp (id_empresa, ts desc);

alter table public.ingestas_pedidos_erp enable row level security;
drop policy if exists ingestas_pedidos_erp_sel on public.ingestas_pedidos_erp;
create policy ingestas_pedidos_erp_sel on public.ingestas_pedidos_erp
  for select using (es_superadmin() or (id_empresa = mi_empresa() and es_admin()));

create table if not exists public.pedido_lineas_erp (
  id               bigint generated always as identity primary key,
  id_empresa       uuid not null references public.empresas(id) on delete cascade,
  id_pedido        uuid not null references public.pedidos(id) on delete cascade,
  comprobante      text not null default '',
  renglon          integer not null,
  codigo_producto  text not null,
  id_producto      uuid references public.productos(id) on delete set null,
  descripcion      text,
  cantidad         numeric not null check (cantidad >= 0),
  precio_unitario  numeric not null check (precio_unitario >= 0),
  recibido_ts      timestamptz not null default now(),
  id_ingesta       bigint references public.ingestas_pedidos_erp(id) on delete set null
);

create index if not exists pedido_lineas_erp_pedido_idx on public.pedido_lineas_erp (id_pedido);

alter table public.pedido_lineas_erp enable row level security;
drop policy if exists pedido_lineas_erp_sel on public.pedido_lineas_erp;
create policy pedido_lineas_erp_sel on public.pedido_lineas_erp
  for select using (
    exists (
      select 1 from public.pedidos p
       where p.id = pedido_lineas_erp.id_pedido
         and (es_superadmin() or (p.id_empresa = mi_empresa()
              and (p.id_vendedor in (select ids_a_mi_cargo()) or p.id_repartidor in (select ids_a_mi_cargo()))))
    )
    and (select mi_rol()) is distinct from 'marketing'
  );

revoke all on public.pedido_lineas_erp from anon;
revoke insert, update, delete on public.pedido_lineas_erp from authenticated;
grant select on public.pedido_lineas_erp to authenticated;
revoke all on public.ingestas_pedidos_erp from anon;
revoke insert, update, delete on public.ingestas_pedidos_erp from authenticated;
grant select on public.ingestas_pedidos_erp to authenticated;

create or replace function public.pedido_erp_protegido()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('distat.erp_bypass', true), '') = 'on' then return new; end if;
  if new.erp_estado        is distinct from old.erp_estado
  or new.erp_confirmado_ts is distinct from old.erp_confirmado_ts
  or new.erp_total         is distinct from old.erp_total
  or new.erp_comprobantes  is distinct from old.erp_comprobantes
  or new.erp_diferencias   is distinct from old.erp_diferencias
  then
    raise exception 'confirmacion-erp-no-editable';
  end if;
  return new;
end $$;

drop trigger if exists pedidos_erp_protegido on public.pedidos;
create trigger pedidos_erp_protegido
  before update on public.pedidos
  for each row execute function public.pedido_erp_protegido();

create or replace function public.pedido_comparacion_erp(p_pedido uuid)
returns table (
  codigo            text,
  descripcion       text,
  cantidad_tomada   numeric,
  cantidad_erp      numeric,
  precio_tomado     numeric,
  precio_erp        numeric,
  diferencia        text
)
language sql
stable
security invoker
set search_path = public
as $$
  with t as (
    select public.codigo_norm(coalesce(nullif(btrim(i.codigo_producto), ''), pr.codigo)) as k,
           min(coalesce(nullif(btrim(i.codigo_producto), ''), pr.codigo)) as codigo,
           min(i.descripcion) as descripcion,
           sum(i.cantidad) as cant,
           case when sum(i.cantidad) > 0
                then round(sum(i.cantidad * i.precio_unitario) / sum(i.cantidad), 2)
                else max(i.precio_unitario) end as precio
      from public.pedido_items i
      left join public.productos pr on pr.id = i.id_producto
     where i.id_pedido = p_pedido
     group by 1
  ), e as (
    select public.codigo_norm(l.codigo_producto) as k,
           min(l.codigo_producto) as codigo,
           min(l.descripcion) as descripcion,
           sum(l.cantidad) as cant,
           case when sum(l.cantidad) > 0
                then round(sum(l.cantidad * l.precio_unitario) / sum(l.cantidad), 2)
                else max(l.precio_unitario) end as precio
      from public.pedido_lineas_erp l
     where l.id_pedido = p_pedido
     group by 1
  )
  select coalesce(t.codigo, e.codigo),
         coalesce(t.descripcion, e.descripcion),
         coalesce(t.cant, 0),
         coalesce(e.cant, 0),
         t.precio,
         e.precio,
         case
           when t.k is null then 'agregado'
           when e.k is null or e.cant = 0 then 'quitado'
           when e.cant < t.cant - 0.0001 then 'reducido'
           when e.cant > t.cant + 0.0001 then 'aumentado'
           when abs(coalesce(e.precio, 0) - coalesce(t.precio, 0)) > 0.01 then 'precio'
           else 'igual'
         end
    from t full join e on e.k = t.k
   order by coalesce(t.descripcion, e.descripcion), coalesce(t.codigo, e.codigo)
$$;

revoke all on function public.pedido_comparacion_erp(uuid) from public, anon;
grant execute on function public.pedido_comparacion_erp(uuid) to authenticated, service_role;

create or replace function public.importar_pedidos_erp(
  p_empresa uuid,
  p_usuario uuid,
  p_filas   jsonb,
  p_probar  boolean default false,
  p_meta    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ingesta     bigint;
  v_num         text;
  v_ped         record;
  v_res         jsonb := '[]'::jsonb;
  v_motivo      text;
  v_dif         integer;
  v_estado      text;
  v_iguales     integer := 0;
  v_modificados integer := 0;
  v_rechazados  integer := 0;
  v_sin_ref     integer := 0;
  v_comps       text[];
begin
  if jsonb_typeof(p_filas) is distinct from 'array' then
    raise exception 'filas-invalidas';
  end if;

  insert into public.ingestas_pedidos_erp (
    id_empresa, id_usuario, probar, ip, agente, equipo, version_agente, ruta_origen, bytes,
    sha256_cliente, sha256_servidor, archivo, filas, resultado)
  values (
    p_empresa, p_usuario, p_probar, p_meta->>'ip', p_meta->>'agente', p_meta->>'equipo',
    p_meta->>'version_agente', p_meta->>'ruta_origen', nullif(p_meta->>'bytes', '')::integer,
    p_meta->>'sha256_cliente', p_meta->>'sha256_servidor', p_meta->>'archivo',
    jsonb_array_length(p_filas), 'procesando')
  returning id into v_ingesta;

  create temp table if not exists _erp_filas (
    numero text, id_ms text, cliente text, comprobante text, renglon integer,
    codigo text, cantidad numeric, precio numeric
  ) on commit drop;
  truncate _erp_filas;

  insert into _erp_filas
  select substring(f->>'referencia' from '(?i)pedido\s*0*(\d+)'),
         btrim(f->>'id_ms'),
         btrim(f->>'cliente'),
         coalesce(btrim(f->>'comprobante'), ''),
         nullif(f->>'renglon', '')::integer,
         btrim(f->>'codigo'),
         nullif(f->>'cantidad', '')::numeric,
         nullif(f->>'precio', '')::numeric
    from jsonb_array_elements(p_filas) f;

  select count(*) into v_sin_ref from _erp_filas where numero is null;

  for v_num in select distinct numero from _erp_filas where numero is not null order by 1 loop
    v_motivo := null;
    select p.id, p.numero, p.estado, p.exportado_ts, p.created_at, c.codigo as cliente_codigo
      into v_ped
      from public.pedidos p
      left join public.clientes c on c.id = p.id_cliente
     where p.id_empresa = p_empresa
       and p.numero = lpad(v_num, 6, '0')
     limit 1;

    if v_ped.id is null then
      v_motivo := 'pedido-inexistente';
    elsif v_ped.estado = 'Anulado' then
      v_motivo := 'pedido-anulado';
    elsif v_ped.exportado_ts is null then
      v_motivo := 'pedido-no-exportado';
    elsif v_ped.estado in ('En camino', 'Entregado', 'No entregado') then
      v_motivo := 'pedido-en-reparto';
    elsif exists (select 1 from _erp_filas
                   where numero = v_num and id_ms is distinct from
                         (floor(extract(epoch from v_ped.created_at) * 1000))::bigint::text) then
      v_motivo := 'campo-1-distinto';
    elsif exists (select 1 from _erp_filas
                   where numero = v_num
                     and public.codigo_norm(cliente) is distinct from public.codigo_norm(v_ped.cliente_codigo)) then
      v_motivo := 'cliente-distinto';
    elsif exists (select 1 from _erp_filas
                   where numero = v_num
                     and (codigo is null or codigo = '' or cantidad is null or cantidad < 0
                          or precio is null or precio < 0 or renglon is null)) then
      v_motivo := 'renglon-invalido';
    end if;

    if v_motivo is not null then
      v_rechazados := v_rechazados + 1;
      v_res := v_res || jsonb_build_object('pedido', v_num, 'resultado', 'rechazado', 'motivo', v_motivo);
      continue;
    end if;

    perform set_config('distat.erp_bypass', 'on', true);

    delete from public.pedido_lineas_erp l
     where l.id_pedido = v_ped.id
       and l.comprobante in (select distinct comprobante from _erp_filas where numero = v_num);

    insert into public.pedido_lineas_erp (
      id_empresa, id_pedido, comprobante, renglon, codigo_producto, id_producto, descripcion,
      cantidad, precio_unitario, id_ingesta)
    select p_empresa, v_ped.id, f.comprobante, f.renglon, f.codigo, pr.id, pr.descripcion,
           f.cantidad, f.precio, v_ingesta
      from _erp_filas f
      left join public.productos pr
        on pr.id_empresa = p_empresa and pr.codigo_norm = public.codigo_norm(f.codigo)
     where f.numero = v_num;

    select count(*) filter (where diferencia <> 'igual') into v_dif
      from public.pedido_comparacion_erp(v_ped.id);
    v_estado := case when v_dif = 0 then 'igual' else 'modificado' end;

    select array_agg(distinct comprobante order by comprobante) filter (where comprobante <> '')
      into v_comps
      from public.pedido_lineas_erp where id_pedido = v_ped.id;

    update public.pedidos
       set erp_estado = v_estado,
           erp_confirmado_ts = now(),
           erp_total = (select round(coalesce(sum(cantidad * precio_unitario), 0), 2)
                          from public.pedido_lineas_erp where id_pedido = v_ped.id),
           erp_comprobantes = v_comps,
           erp_diferencias = v_dif
     where id = v_ped.id;

    perform set_config('distat.erp_bypass', 'off', true);

    if v_estado = 'igual' then v_iguales := v_iguales + 1; else v_modificados := v_modificados + 1; end if;
    v_res := v_res || jsonb_build_object(
      'pedido', v_ped.numero, 'resultado', v_estado, 'diferencias', v_dif,
      'detalle', (select coalesce(jsonb_agg(jsonb_build_object(
                    'codigo', c.codigo, 'tomado', c.cantidad_tomada, 'erp', c.cantidad_erp,
                    'diferencia', c.diferencia)), '[]'::jsonb)
                    from public.pedido_comparacion_erp(v_ped.id) c where c.diferencia <> 'igual'));
  end loop;

  update public.ingestas_pedidos_erp
     set pedidos = v_iguales + v_modificados + v_rechazados,
         iguales = v_iguales,
         modificados = v_modificados,
         rechazados = v_rechazados,
         resultado = case when v_iguales + v_modificados + v_rechazados = 0 then 'sin-pedidos'
                          when v_rechazados > 0 then 'con-rechazos' else 'ok' end,
         detalle = jsonb_build_object('pedidos', v_res, 'filas_sin_referencia', v_sin_ref)
   where id = v_ingesta;

  if p_probar then
    raise exception using errcode = 'P0001', message = 'probar', detail = jsonb_build_object(
      'probar', true, 'pedidos', v_iguales + v_modificados + v_rechazados, 'iguales', v_iguales,
      'modificados', v_modificados, 'rechazados', v_rechazados,
      'filas_sin_referencia', v_sin_ref, 'resultado', v_res)::text;
  end if;

  return jsonb_build_object(
    'ingesta', v_ingesta, 'pedidos', v_iguales + v_modificados + v_rechazados, 'iguales', v_iguales,
    'modificados', v_modificados, 'rechazados', v_rechazados,
    'filas_sin_referencia', v_sin_ref, 'resultado', v_res);
end $$;

revoke all on function public.importar_pedidos_erp(uuid, uuid, jsonb, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.importar_pedidos_erp(uuid, uuid, jsonb, boolean, jsonb) to service_role;

create or replace function public.importar_pedidos_erp_probar(
  p_empresa uuid,
  p_usuario uuid,
  p_filas   jsonb,
  p_meta    jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_det text;
begin
  begin
    perform public.importar_pedidos_erp(p_empresa, p_usuario, p_filas, true, p_meta);
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_det = pg_exception_detail;
    if sqlerrm <> 'probar' then raise; end if;
    return v_det::jsonb;
  end;
  return null;
end $$;

revoke all on function public.importar_pedidos_erp_probar(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.importar_pedidos_erp_probar(uuid, uuid, jsonb, jsonb) to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('ingestas-pedidos-erp', 'ingestas-pedidos-erp', false, 10485760)
on conflict (id) do nothing;
