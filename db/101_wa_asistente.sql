-- 101_wa_asistente.sql — datos del asistente de WhatsApp para el dueño y el encargado (07/11/2026, plan 38).
--
-- POR QUÉ RPC PROPIAS Y NO `metricas_venta_equipo`/`ventas_por_categoria`. Esas leen la identidad de la
-- sesión (`_dash_empresa` → `mi_rol()`): sin sesión de usuario rechazan el pedido, y con un encargado
-- recortan a "su gente". El asistente no tiene sesión: el número autorizado define la empresa, y el
-- usuario decidió que el dueño y el encargado vean lo mismo. Definiciones iguales a las de esas RPC:
-- pedidos no anulados, por `created_at`, en hora de Salta. Son PEDIDOS TOMADOS, no facturación.
--
-- 🔑 Sólo `service_role` (regla 7-bis: revocar de public, anon y authenticated). `p_empresa` la pone la
-- función a partir de `wa_asistente_usuarios`, nunca del mensaje. Devuelven un `jsonb` para que el
-- techo de filas de PostgREST no corte el resultado (db/93).
-- Las RPC son de lectura. Lo único que escribe el asistente son las dos tablas `wa_*`.
--
-- Sin begin/commit: probar con `begin; \i ...; rollback;` y aplicar con `psql -1 -f`. Un `commit` propio
-- cerraría la transacción de la prueba y dejaría la migración aplicada (ya pasó con db/93).

-- ── 1. Números autorizados ───────────────────────────────────────────────────────────────────────
create table public.wa_asistente_usuarios (
  wa_id      text primary key check (wa_id ~ '^[0-9]{8,15}$'),  -- tal cual lo manda Meta, sin "+"
  id_perfil  uuid not null references public.perfiles (id),
  id_empresa uuid not null references public.empresas (id),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 2. Registro de mensajes ──────────────────────────────────────────────────────────────────────
-- Evita procesar dos veces un mensaje que Meta reintenta (`wamid` único) y da el historial de la charla.
-- Los audios no se guardan. De un número no autorizado no se guarda el contenido (`texto` queda null).
create table public.wa_mensajes (
  id            bigint generated always as identity primary key,
  wamid         text not null unique,
  wa_id         text not null,
  id_empresa    uuid references public.empresas (id),
  autorizado    boolean not null,
  tipo          text not null,
  texto         text,
  consulta      text,
  argumentos    jsonb,
  respuesta     text,
  estado        text not null default 'recibido'
                check (estado in ('recibido', 'respondido', 'error', 'ignorado')),
  error         text,
  enviados      int not null default 0,
  con_voz       boolean not null default false,
  ms_total      int,
  recibido_ts   timestamptz not null default now(),
  respondido_ts timestamptz
);
create index wa_mensajes_charla_idx on public.wa_mensajes (wa_id, recibido_ts desc);
create index wa_mensajes_envios_idx on public.wa_mensajes (recibido_ts) where enviados > 0;

-- RLS sin policies: sólo entra `service_role`. Por eso marketing tampoco las ve (regla de db/82).
alter table public.wa_asistente_usuarios enable row level security;
alter table public.wa_mensajes enable row level security;
revoke all on public.wa_asistente_usuarios, public.wa_mensajes from public, anon, authenticated;
grant select, insert, update on public.wa_asistente_usuarios, public.wa_mensajes to service_role;

-- ── 3. Búsqueda sin acentos ni mayúsculas ────────────────────────────────────────────────────────
create function public.wa_norm(t text) returns text
language sql immutable set search_path = public as $$
  select translate(lower(coalesce(t, '')), 'áéíóúüñ', 'aeiouun')
$$;

-- Todas las palabras del texto tienen que aparecer. Se escapan % y _ para que sean letras comunes.
-- La "s" final se ignora en palabras largas: "gaseosas" tiene que encontrar "GASEOSA".
create function public.wa_coincide(p_campo text, p_texto text) returns boolean
language sql immutable set search_path = public as $$
  select trim(coalesce(p_texto, '')) <> ''
     and not exists (
       select 1 from regexp_split_to_table(trim(public.wa_norm(p_texto)), '\s+') as palabra
       where public.wa_norm(p_campo) not like '%' || replace(replace(replace(
               case when length(palabra) > 3 then regexp_replace(palabra, 's$', '') else palabra end,
               '\', '\\'), '%', '\%'), '_', '\_') || '%'
     )
$$;

-- ── 4. Ventas ────────────────────────────────────────────────────────────────────────────────────
create function public.wa_ventas(p_empresa uuid, p_desde date, p_hasta date) returns jsonb
language sql stable set search_path = public as $$
  with ped as (
    select p.id_vendedor, p.id_cliente, p.monto_total, p.estado
      from public.pedidos p
     where p.id_empresa = p_empresa
       and p.created_at >= p_desde::timestamp at time zone 'America/Argentina/Salta'
       and p.created_at <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
  ),
  por as (
    select coalesce(pf.nombre, 'Sin vendedor') as nombre,
           sum(x.monto_total) as monto, count(*) as pedidos, count(distinct x.id_cliente) as clientes
      from ped x left join public.perfiles pf on pf.id = x.id_vendedor
     where x.estado <> 'Anulado'
     group by 1
  )
  select jsonb_build_object(
    'monto',    coalesce((select sum(monto_total) from ped where estado <> 'Anulado'), 0),
    'pedidos',  (select count(*) from ped where estado <> 'Anulado'),
    'clientes', (select count(distinct id_cliente) from ped where estado <> 'Anulado'),
    'anulados', (select count(*) from ped where estado = 'Anulado'),
    'por_vendedor', coalesce((select jsonb_agg(to_jsonb(por) order by por.monto desc nulls last) from por), '[]'::jsonb)
  )
$$;

create function public.wa_ventas_categoria(p_empresa uuid, p_desde date, p_hasta date) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.monto desc), '[]'::jsonb) from (
    select coalesce(nullif(trim(pr.categoria), ''), 'Sin categoría') as categoria,
           coalesce(sum(i.cantidad * i.precio_unitario), 0) as monto,
           count(distinct p.id) as pedidos
      from public.pedidos p
      join public.pedido_items i on i.id_pedido = p.id
      left join public.productos pr on pr.id = i.id_producto
     where p.id_empresa = p_empresa
       and p.created_at >= p_desde::timestamp at time zone 'America/Argentina/Salta'
       and p.created_at <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
       and p.estado <> 'Anulado'
     group by 1
     order by 2 desc
     limit 15
  ) c
$$;

-- ── 5. Pedidos ───────────────────────────────────────────────────────────────────────────────────
-- `numero` se guarda como "000687"; se acepta "687".
create function public.wa_pedido(p_empresa uuid, p_numero text) returns jsonb
language sql stable set search_path = public as $$
  select to_jsonb(r) from (
    select p.numero, p.estado, p.monto_total as monto, p.created_at, p.fecha_entrega, p.ts_en_camino,
           p.ts_entregado, p.exportado_ts, p.forma_pago, p.observaciones,
           c.nombre_comercio as cliente, c.codigo as codigo_cliente,
           v.nombre as vendedor, rp.nombre as repartidor,
           (select count(*) from public.pedido_items i where i.id_pedido = p.id) as renglones
      from public.pedidos p
      left join public.clientes c on c.id = p.id_cliente
      left join public.perfiles v on v.id = p.id_vendedor
      left join public.perfiles rp on rp.id = p.id_repartidor
     where p.id_empresa = p_empresa
       and p.numero = lpad(regexp_replace(coalesce(p_numero, ''), '\D', '', 'g'), 6, '0')
     limit 1
  ) r
$$;

create function public.wa_buscar_clientes(p_empresa uuid, p_texto text) returns jsonb
language sql stable set search_path = public as $$
  with hallados as (
    select c.id, c.codigo, c.nombre_comercio, c.localidad,
           (c.codigo_norm = public.codigo_norm(p_texto)) as por_codigo
      from public.clientes c
     where c.id_empresa = p_empresa
       and c.archivado_ts is null
       and (c.codigo_norm = public.codigo_norm(p_texto) or public.wa_coincide(c.nombre_comercio, p_texto))
  )
  select jsonb_build_object(
    'total', (select count(*) from hallados),
    'clientes', coalesce((select jsonb_agg(to_jsonb(h)) from
      (select * from hallados order by por_codigo desc, nombre_comercio limit 6) h), '[]'::jsonb)
  )
$$;

create function public.wa_pedidos_cliente(p_empresa uuid, p_cliente uuid) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) from (
    select p.numero, p.estado, p.monto_total as monto, p.created_at, p.fecha_entrega
      from public.pedidos p
     where p.id_empresa = p_empresa and p.id_cliente = p_cliente
     order by p.created_at desc
     limit 5
  ) r
$$;

create function public.wa_clientes_sin_comprar(p_empresa uuid, p_dias int) returns jsonb
language sql stable set search_path = public as $$
  with ultimo as (
    select c.id, c.codigo, c.nombre_comercio, c.localidad,
           max(p.created_at) filter (where p.estado <> 'Anulado') as ultima
      from public.clientes c
      left join public.pedidos p on p.id_cliente = c.id and p.id_empresa = p_empresa
     where c.id_empresa = p_empresa and c.archivado_ts is null
     group by c.id
  ),
  dormidos as (
    select * from ultimo where ultima is not null and ultima < now() - make_interval(days => greatest(p_dias, 1))
  )
  select jsonb_build_object(
    'dias', greatest(p_dias, 1),
    'total', (select count(*) from dormidos),
    'nunca_compraron', (select count(*) from ultimo where ultima is null),
    'clientes', coalesce((select jsonb_agg(to_jsonb(d)) from
      (select codigo, nombre_comercio, localidad, ultima from dormidos order by ultima desc limit 10) d), '[]'::jsonb)
  )
$$;

-- ── 6. Productos ─────────────────────────────────────────────────────────────────────────────────
-- Devuelve las columnas crudas: el precio lo decide `precioPara` (regla 52), no este SQL.
create function public.wa_buscar_productos(p_empresa uuid, p_texto text) returns jsonb
language sql stable set search_path = public as $$
  with coinciden as (
    select pr.codigo, pr.descripcion, pr.precio_unitario, pr.oferta, pr.precio_oferta, pr.escalas,
           pr.marca, pr.categoria, pr.unidad_venta, pr.descontinuado_ts
      from public.productos pr
     where pr.id_empresa = p_empresa
       and (pr.codigo_norm = public.codigo_norm(p_texto)
            or public.wa_coincide(concat_ws(' ', pr.descripcion, pr.marca), p_texto))
  )
  select jsonb_build_object(
    'total', (select count(*) from coinciden where descontinuado_ts is null),
    'productos', coalesce((select jsonb_agg(to_jsonb(h)) from
      (select * from coinciden where descontinuado_ts is null order by descripcion limit 8) h), '[]'::jsonb),
    -- Un producto dado de baja no es lo mismo que uno que no existe: se dice cuál es.
    'de_baja', coalesce((select jsonb_agg(b.descripcion) from
      (select descripcion from coinciden where descontinuado_ts is not null order by descripcion limit 3) b), '[]'::jsonb)
  )
$$;

-- ── 7. Equipo en calle ───────────────────────────────────────────────────────────────────────────
create function public.wa_equipo(p_empresa uuid) returns jsonb
language sql stable set search_path = public as $$
  with hoy as (
    select (now() at time zone 'America/Argentina/Salta')::date::timestamp at time zone 'America/Argentina/Salta' as desde
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.en_ventana desc, r.minutos_silencio nulls last), '[]'::jsonb) from (
    select e.nombre, e.rol, e.en_ventana, e.minutos_silencio, e.ultimo_ts,
           (select count(*) from public.pedidos p, hoy
             where p.id_vendedor = e.id_usuario and p.created_at >= hoy.desde and p.estado <> 'Anulado') as pedidos_hoy,
           (select coalesce(sum(p.monto_total), 0) from public.pedidos p, hoy
             where p.id_vendedor = e.id_usuario and p.created_at >= hoy.desde and p.estado <> 'Anulado') as monto_hoy,
           (select count(*) from public.visitas v, hoy
             where v.id_usuario = e.id_usuario and v.check_in_ts >= hoy.desde and v.estado <> 'cancelado') as visitas_hoy
      from public.vigilancia_equipo() e
     where e.id_empresa = p_empresa
  ) r
$$;

-- ── 8. Permisos (regla 7-bis) ────────────────────────────────────────────────────────────────────
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname ~ '^wa_'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── 9. Limpieza a los 90 días (también figura en infra/selfhost/cron_jobs.sql) ───────────────────
select cron.schedule('wa-mensajes-limpieza', '50 3 * * *',
  $$ delete from public.wa_mensajes where recibido_ts < now() - interval '90 days'; $$);

notify pgrst, 'reload schema';
