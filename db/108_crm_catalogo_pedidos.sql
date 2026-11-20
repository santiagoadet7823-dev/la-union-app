-- =============================================================================
--  db/108 — ARM: catálogo, pedidos del cliente y base de clientes con teléfono
--  (plan 46 del 10/11/2026 + plan 51 del 19-20/11/2026, rediseño de Claude Design)
--
--  QUÉ HACE
--  Lo que necesita el panel del ARM (arm.dist-at.com) para que quien tiene el control de un chat:
--    1. explore el CATÁLOGO (con y sin texto, por categoría y marca, con orden) y arme una selección;
--    2. vea los PEDIDOS del cliente vinculado con su situación calculada acá, en el servidor:
--         abierto · pronto_despacho · en_camino · entregado · no_entregado · anulado;
--    3. corrija o anule un pedido que SIGUE ABIERTO y que nació en el ARM (`origen = 'whatsapp'`);
--    4. tenga el contacto VINCULADO SOLO con el cliente de la base por el teléfono (plan 51);
--    5. vea la BASE DE CLIENTES separando los que tienen teléfono cargado de los que faltan, y cargue
--       el teléfono desde el ARM (plan 51).
--
--  (La 107 está reservada por el plan 45, informe mensual.)
--
--  🔑 "YA SE EXPORTÓ" LO DECIDE LA BASE, NO LA PANTALLA
--  `crm_reemplazar_items_pedido` y `crm_anular_pedido_arm` toman el pedido con `select … for update` y
--  recién ahí miran `exportado_ts`. `tomar_lote_pedidos` hace un `update` de la misma fila, así que las
--  dos operaciones se SERIALIZAN: o la corrección entra antes del lote y viaja corregida al ERP, o el
--  lote entró primero y la corrección se rechaza con 'pedido-exportado'. Los triggers de db/62 son la
--  red de abajo, no la única guarda.
--
--  🔑 CONCURRENCIA ENTRE DOS OPERADORES: `crm_token_pedido` es una huella (md5) de los renglones y el
--  monto. Quien edita manda la huella que vio; si el pedido cambió en el medio → 'pedido-cambio'.
--
--  🔑 TELÉFONO → WHATSAPP. `clientes.telefono` (db/59) es TEXTO LIBRE; `telefono_wa` de db/58 nunca se
--  aplicó. `crm_wa_de_telefono` lo pasa a la forma de Meta (549 + área + número, 13 dígitos) solo
--  cuando no hay que adivinar: 10 dígitos, o 10 con 0 / 54 / 549 adelante. Lo demás (el "15", números
--  de 8 dígitos sin área) devuelve NULL y la pantalla lo marca "revisar". Medido 19/11: 578 de 2.048
--  clientes de LA UNIÓN con teléfono, 572 de 10 dígitos.
--  El vínculo automático solo se hace con UNA coincidencia: dos comercios con el mismo número
--  (6 casos hoy) quedan como sugerencia, nunca se elige uno al azar.
--
--  ⚠️ Cargar un teléfono desde el ARM sube `export_version` del cliente (trigger de db/92): el cliente
--  vuelve a viajar al ERP en el próximo `Clientes.txt` con su teléfono. Es lo esperado.
--
--  Una columna nueva (`crm_contactos.vinculo_origen`) y un trigger; el resto son funciones.
--  Aplicar: rollback de prueba → OK → `psql -1 -f`.
-- =============================================================================

begin;

-- ── 0. Teléfono escrito a mano → wa_id de Meta (o NULL si es ambiguo) ─────────────────────────────
create or replace function public.crm_wa_de_telefono(p text) returns text
language sql immutable parallel safe set search_path = public as $$
  select case
    when d ~ '^549\d{10}$' then d
    when d ~ '^54\d{10}$'  then '549' || substr(d, 3)
    when d ~ '^0\d{10}$'   then '549' || substr(d, 2)
    when d ~ '^\d{10}$'    then '549' || d
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

create index if not exists clientes_wa_tel_idx
  on public.clientes (id_empresa, public.crm_wa_de_telefono(telefono))
  where archivado_ts is null;

-- El cliente de la empresa con ese wa_id, SOLO si es uno.
create or replace function public.crm_cliente_por_wa(p_empresa uuid, p_wa text) returns uuid
language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then (array_agg(c.id))[1] end
    from public.clientes c
   where c.id_empresa = p_empresa and c.archivado_ts is null
     and p_wa is not null and public.crm_wa_de_telefono(c.telefono) = p_wa
$$;

-- ── 1. Vínculo automático del contacto ───────────────────────────────────────────────────────────
alter table public.crm_contactos add column if not exists vinculo_origen text
  check (vinculo_origen in ('auto', 'manual'));
comment on column public.crm_contactos.vinculo_origen is
  'Cómo se vinculó con el cliente (db/108): auto = por teléfono al entrar el contacto o al cargarle el teléfono al cliente; manual = lo eligió una persona.';

create or replace function public.crm_contacto_vinculo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.id_cliente is null then
      new.id_cliente := public.crm_cliente_por_wa(new.id_empresa, new.wa_id);
      if new.id_cliente is not null then new.vinculo_origen := 'auto'; end if;
    elsif new.vinculo_origen is null then
      new.vinculo_origen := 'manual';
    end if;
  elsif new.id_cliente is distinct from old.id_cliente
        and new.vinculo_origen is not distinct from old.vinculo_origen then
    new.vinculo_origen := case when new.id_cliente is null then null else 'manual' end;
  end if;
  return new;
end $$;

drop trigger if exists crm_contactos_vinculo on public.crm_contactos;
create trigger crm_contactos_vinculo
  before insert or update of id_cliente on public.crm_contactos
  for each row execute function public.crm_contacto_vinculo();

-- Los contactos que ya existen y tienen una sola coincidencia, se vinculan ahora.
update public.crm_contactos k
   set id_cliente = x.cli, vinculo_origen = 'auto'
  from (select k2.id, public.crm_cliente_por_wa(k2.id_empresa, k2.wa_id) as cli
          from public.crm_contactos k2 where k2.id_cliente is null) x
 where k.id = x.id and x.cli is not null;

-- ── 2. Huella de un pedido (para detectar que otro lo cambió) ────────────────────────────────────
create or replace function public.crm_token_pedido(p_pedido uuid) returns text
language sql stable security definer set search_path = public as $$
  select md5(
    coalesce((select p.monto_total::text from public.pedidos p where p.id = p_pedido), '') || '|' ||
    coalesce((select string_agg(coalesce(i.id_producto::text, i.codigo_producto, i.descripcion) || ':' ||
                                i.cantidad::text || ':' || i.precio_unitario::text, ',' order by
                                coalesce(i.id_producto::text, i.codigo_producto, i.descripcion))
                from public.pedido_items i where i.id_pedido = p_pedido), '')
  )
$$;

-- ── 3. Pedidos del cliente vinculado a una conversación ──────────────────────────────────────────
-- Conversación `demo`: si el contacto está vinculado con un cliente REAL se muestran sus pedidos reales
-- en solo lectura (así la demostración enseña la situación de verdad), más los tickets confirmados de
-- la demo como "DEMO-…", que nunca se editan.
create or replace function public.crm_pedidos_cliente(p_conv uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c        public.crm_conversaciones;
  v_cli    uuid;
  v_res    jsonb;
  v_demo   jsonb := '[]'::jsonb;
begin
  if public.crm_acceso() is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  select * into c from public.crm_conversaciones
   where id = p_conv and id_empresa in (select public.crm_empresas());
  if c.id is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;

  if c.demo then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'numero', coalesce(t.numero_pedido, 'DEMO'), 'estado', 'Pendiente', 'origen', 'whatsapp',
             'created_at', t.confirmado_ts, 'monto_total', t.total, 'situacion', 'abierto', 'editable_arm', false,
             'motivo_bloqueo', 'Pedido de demostración: no existe en el sistema real.', 'demo', true,
             'items', t.items) order by t.confirmado_ts desc), '[]'::jsonb)
      into v_demo
      from public.crm_tickets t
     where t.id_conversacion = c.id and t.estado = 'confirmado';
  end if;

  select ct.id_cliente into v_cli from public.crm_contactos ct where ct.id = c.id_contacto;
  if v_cli is null then
    return v_demo;
  end if;

  with base as (
    select p.*,
           case
             when p.estado = 'Anulado' then 'anulado'
             when p.estado = 'Entregado' then 'entregado'
             when p.estado = 'No entregado' then 'no_entregado'
             when p.estado = 'En camino' or (p.exportado_ts is not null and p.id_repartidor is not null) then 'en_camino'
             when p.exportado_ts is not null then 'pronto_despacho'
             else 'abierto'
           end as situacion
      from public.pedidos p
     where p.id_cliente = v_cli
       and p.id_empresa = c.id_empresa
       and p.estado <> 'Sin pedido'
       and (p.exportado_ts is null or p.created_at >= now() - interval '30 days')
     order by p.created_at desc
     limit 40
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'numero', b.numero, 'estado', b.estado, 'origen', b.origen,
           'created_at', b.created_at, 'monto_total', b.monto_total, 'fecha_entrega', b.fecha_entrega,
           'exportado_ts', b.exportado_ts, 'export_lote', b.export_lote,
           'ts_en_camino', b.ts_en_camino, 'ts_entregado', b.ts_entregado,
           'vendedor_nombre', (select pf.nombre from public.perfiles pf where pf.id = b.id_vendedor),
           'repartidor_nombre', (select pf.nombre from public.perfiles pf where pf.id = b.id_repartidor),
           'situacion', b.situacion,
           'editable_arm', (not c.demo and b.situacion = 'abierto' and b.origen = 'whatsapp'),
           'motivo_bloqueo', case
               when b.situacion <> 'abierto' then null
               when b.origen is distinct from 'whatsapp'
                 then 'Lo tomó ' || coalesce((select pf.nombre from public.perfiles pf where pf.id = b.id_vendedor), 'un vendedor')
                      || ' en la app: corregilo desde allí.'
               when c.demo then 'Conversación de demostración: solo lectura.'
               end,
           'token', public.crm_token_pedido(b.id),
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                        'id_producto', i.id_producto, 'codigo', i.codigo_producto, 'descripcion', i.descripcion,
                        'cantidad', i.cantidad, 'cantidad_entregada', i.cantidad_entregada,
                        'precio_unitario', i.precio_unitario,
                        'subtotal', round(i.cantidad * i.precio_unitario, 2)) order by i.descripcion)
                      from public.pedido_items i where i.id_pedido = b.id), '[]'::jsonb)
         ) order by b.created_at desc), '[]'::jsonb)
    into v_res
    from base b;
  return v_demo || v_res;
end $$;

-- ── 4. Catálogo ──────────────────────────────────────────────────────────────────────────────────
-- Con texto: las mismas reglas que `crm_buscar_productos_de` (db/104): todas las palabras tienen que
-- aparecer, o el código exacto. Sin texto: recorre el catálogo. Orden: relevancia | ofertas | precio | nombre.
drop function if exists public.crm_catalogo(text, text, text, int, int, uuid);
create or replace function public.crm_catalogo(
  p_texto text default null, p_categoria text default null, p_marca text default null,
  p_limite int default 40, p_offset int default 0, p_empresa uuid default null, p_orden text default 'relevancia')
returns table (id uuid, codigo text, descripcion text, marca text, categoria text, precio_unitario numeric,
               oferta boolean, precio_oferta numeric, escalas jsonb, unidades int, unidad_venta text,
               peso_kg numeric, imagen_url text, total_filas bigint)
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_emp uuid;
  v_t   text := lower(btrim(coalesce(p_texto, '')));
begin
  if public.crm_acceso() is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  select e into v_emp from public.crm_empresas() e
   where p_empresa is null or e = p_empresa
   order by (e = public.mi_empresa()) desc limit 1;
  if v_emp is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;

  return query
    select pr.id, pr.codigo, pr.descripcion, pr.marca, pr.categoria, pr.precio_unitario, pr.oferta,
           pr.precio_oferta, pr.escalas, pr.unidades, pr.unidad_venta, pr.peso_kg, pr.imagen_url,
           count(*) over () as total_filas
      from public.productos pr
     where pr.id_empresa = v_emp
       and pr.descontinuado_ts is null
       and (nullif(btrim(coalesce(p_categoria, '')), '') is null or coalesce(pr.categoria, '') = p_categoria)
       and (nullif(btrim(coalesce(p_marca, '')), '') is null or coalesce(pr.marca, '') = p_marca)
       and (v_t = '' or pr.codigo_norm = v_t or pr.codigo = v_t
            or not exists (select 1 from regexp_split_to_table(v_t, '\s+') w
                            where w <> '' and lower(pr.descripcion) not like '%' || w || '%'))
     order by (v_t <> '' and pr.codigo = v_t) desc,
              case when p_orden = 'ofertas' then (pr.oferta and coalesce(pr.precio_oferta, 0) > 0) end desc nulls last,
              case when p_orden = 'precio' then coalesce(nullif(pr.precio_oferta, 0), pr.precio_unitario) end asc nulls last,
              case when p_orden = 'nombre' then pr.descripcion end asc,
              case when v_t <> '' then similarity(lower(pr.descripcion), v_t) end desc nulls last,
              pr.categoria nulls last, pr.descripcion
     limit least(greatest(coalesce(p_limite, 40), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end $$;

-- Categorías y marcas con cuántos productos tiene cada par (la pantalla arma los contadores y la
-- lista de marcas de la categoría elegida). '' = sin categoría / sin marca.
create or replace function public.crm_catalogo_filtros(p_empresa uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid;
begin
  if public.crm_acceso() is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  select e into v_emp from public.crm_empresas() e
   where p_empresa is null or e = p_empresa
   order by (e = public.mi_empresa()) desc limit 1;
  if v_emp is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.productos pr where pr.id_empresa = v_emp and pr.descontinuado_ts is null),
    'pares', coalesce((select jsonb_agg(jsonb_build_object('c', q.c, 'm', q.m, 'n', q.n) order by q.c, q.m) from (
        select coalesce(pr.categoria, '') c, coalesce(pr.marca, '') m, count(*) n
          from public.productos pr
         where pr.id_empresa = v_emp and pr.descontinuado_ts is null
         group by 1, 2) q), '[]'::jsonb));
end $$;

-- ── 5. Corregir / anular un pedido abierto del ARM (solo service_role: las llama `crm-ticket`) ───
-- Devuelve { ok, ... } y nunca lanza por reglas de negocio: la función de borde traduce el código.
create or replace function public.crm_reemplazar_items_pedido(
  p_pedido uuid, p_empresa uuid, p_token text, p_items jsonb, p_monto numeric, p_peso numeric)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.pedidos;
begin
  select * into v from public.pedidos where id = p_pedido and id_empresa = p_empresa for update;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'pedido-inexistente'); end if;
  if v.exportado_ts is not null then
    return jsonb_build_object('ok', false, 'error', 'pedido-exportado', 'export_lote', v.export_lote);
  end if;
  if v.origen is distinct from 'whatsapp' then return jsonb_build_object('ok', false, 'error', 'pedido-ajeno'); end if;
  if v.estado <> 'Pendiente' or v.id_repartidor is not null then
    return jsonb_build_object('ok', false, 'error', 'pedido-no-editable', 'estado', v.estado);
  end if;
  if p_token is distinct from public.crm_token_pedido(p_pedido) then
    return jsonb_build_object('ok', false, 'error', 'pedido-cambio');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('ok', false, 'error', 'pedido-sin-renglones');
  end if;

  delete from public.pedido_items where id_pedido = p_pedido;
  insert into public.pedido_items (id, id_pedido, id_producto, descripcion, cantidad, precio_unitario, peso_kg, codigo_producto)
  select gen_random_uuid(), p_pedido,
         case when exists (select 1 from public.productos pr where pr.id = r.id_producto) then r.id_producto end,
         r.descripcion, coalesce(r.cantidad, 0), coalesce(r.precio_unitario, 0), coalesce(r.peso_kg, 0), r.codigo_producto
    from jsonb_populate_recordset(null::public.pedido_items, p_items) r;
  update public.pedidos set monto_total = p_monto, peso_total = p_peso where id = p_pedido;
  return jsonb_build_object('ok', true, 'numero', v.numero, 'token', public.crm_token_pedido(p_pedido));
end $$;

create or replace function public.crm_anular_pedido_arm(
  p_pedido uuid, p_empresa uuid, p_motivo text, p_perfil uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.pedidos;
begin
  select * into v from public.pedidos where id = p_pedido and id_empresa = p_empresa for update;
  if v.id is null then return jsonb_build_object('ok', false, 'error', 'pedido-inexistente'); end if;
  if v.exportado_ts is not null then
    return jsonb_build_object('ok', false, 'error', 'pedido-exportado', 'export_lote', v.export_lote);
  end if;
  if v.origen is distinct from 'whatsapp' then return jsonb_build_object('ok', false, 'error', 'pedido-ajeno'); end if;
  if v.estado <> 'Pendiente' or v.id_repartidor is not null then
    return jsonb_build_object('ok', false, 'error', 'pedido-no-editable', 'estado', v.estado);
  end if;
  update public.pedidos
     set estado = 'Anulado', motivo_anulacion = left(coalesce(nullif(btrim(p_motivo), ''), 'Anulado desde el ARM'), 300),
         anulado_por = p_perfil, anulado_ts = now()
   where id = p_pedido;
  return jsonb_build_object('ok', true, 'numero', v.numero);
end $$;

-- ── 6. Sugerencias de cliente para un contacto sin vincular ──────────────────────────────────────
-- Primero los que tienen ESE teléfono (si son varios, por eso no se vinculó solo); después los que se
-- parecen por el nombre que el cliente tiene en WhatsApp.
create or replace function public.crm_sugerencias_cliente(p_conv uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  c     public.crm_conversaciones;
  k     public.crm_contactos;
  v_nom text;
  v_n   int;
begin
  if public.crm_acceso() is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  select * into c from public.crm_conversaciones
   where id = p_conv and id_empresa in (select public.crm_empresas());
  if c.id is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  select * into k from public.crm_contactos where id = c.id_contacto;
  v_nom := lower(btrim(coalesce(k.nombre_perfil, '')));

  select count(*) into v_n from public.clientes cl
   where cl.id_empresa = c.id_empresa and cl.archivado_ts is null
     and public.crm_wa_de_telefono(cl.telefono) = k.wa_id;

  return jsonb_build_object(
    'coinciden_telefono', v_n,
    'sugerencias', coalesce((select jsonb_agg(s order by s.orden, s.sim desc, s.nombre) from (
        select cl.id, cl.codigo, cl.nombre_comercio as nombre, coalesce(cl.direccion, cl.localidad) as dir,
               z.nombre as zona, cl.telefono,
               case when public.crm_wa_de_telefono(cl.telefono) = k.wa_id then 'telefono' else 'nombre' end as motivo,
               case when public.crm_wa_de_telefono(cl.telefono) = k.wa_id then 0 else 1 end as orden,
               case when v_nom = '' then 0 else similarity(lower(cl.nombre_comercio), v_nom) end as sim
          from public.clientes cl
          left join public.zonas z on z.id = cl.id_zona
         where cl.id_empresa = c.id_empresa and cl.archivado_ts is null
           and (public.crm_wa_de_telefono(cl.telefono) = k.wa_id
                or (length(v_nom) >= 3 and similarity(lower(cl.nombre_comercio), v_nom) >= 0.25))
         order by orden, sim desc
         limit 5) s), '[]'::jsonb));
end $$;

-- ── 7. Base de clientes: con teléfono / sin teléfono / a revisar ─────────────────────────────────
-- estado_tel: ok (sirve para WhatsApp) · revisar (cargado pero ambiguo) · repetido (mismo número en
-- más de un cliente: no se vincula solo) · sin (vacío).
create or replace function public.crm_clientes_base(
  p_empresa uuid default null, p_filtro text default 'todos', p_texto text default null,
  p_limite int default 100, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_emp uuid;
  v_t   text := lower(btrim(coalesce(p_texto, '')));
  v_d   text := regexp_replace(coalesce(p_texto, ''), '\D', '', 'g');
  v_res jsonb;
begin
  if public.crm_acceso() is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  select e into v_emp from public.crm_empresas() e
   where p_empresa is null or e = p_empresa
   order by (e = public.mi_empresa()) desc limit 1;
  if v_emp is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;

  with b as (
    select cl.id, cl.codigo, cl.nombre_comercio, cl.direccion, cl.localidad, z.nombre as zona,
           pf.nombre as vendedor, cl.telefono, public.crm_wa_de_telefono(cl.telefono) as wa
      from public.clientes cl
      left join public.zonas z on z.id = cl.id_zona
      left join public.perfiles pf on pf.id = cl.id_vendedor
     where cl.id_empresa = v_emp and cl.archivado_ts is null
  ), r as (
    select b.*,
           case when nullif(btrim(coalesce(b.telefono, '')), '') is null then 'sin'
                when b.wa is null then 'revisar'
                when count(*) over (partition by b.wa) > 1 then 'repetido'
                else 'ok' end as estado_tel
      from b
  ), f as (
    select r.* from r
     where (coalesce(p_filtro, 'todos') = 'todos'
            or (p_filtro = 'con' and r.estado_tel <> 'sin')
            or r.estado_tel = p_filtro)
       and (v_t = '' or lower(r.nombre_comercio) like '%' || v_t || '%' or lower(coalesce(r.codigo, '')) like v_t || '%'
            or (length(v_d) >= 3 and regexp_replace(coalesce(r.telefono, ''), '\D', '', 'g') like '%' || v_d || '%'))
  )
  select jsonb_build_object(
    'totales', (select jsonb_build_object(
        'activos', count(*),
        'con', count(*) filter (where estado_tel <> 'sin'),
        'ok', count(*) filter (where estado_tel = 'ok'),
        'revisar', count(*) filter (where estado_tel = 'revisar'),
        'repetido', count(*) filter (where estado_tel = 'repetido'),
        'sin', count(*) filter (where estado_tel = 'sin')) from r),
    'filtrados', (select count(*) from f),
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'codigo', x.codigo, 'nombre', x.nombre_comercio, 'direccion', x.direccion,
        'localidad', x.localidad, 'zona', x.zona, 'vendedor', x.vendedor, 'telefono', x.telefono,
        'wa', x.wa, 'estado_tel', x.estado_tel,
        'en_arm', exists (select 1 from public.crm_contactos k where k.id_cliente = x.id)) order by x.nombre_comercio)
      from (select * from f order by nombre_comercio
             limit least(greatest(coalesce(p_limite, 100), 1), 5000)
            offset greatest(coalesce(p_offset, 0), 0)) x), '[]'::jsonb))
    into v_res;
  return v_res;
end $$;

-- Cargar o corregir el teléfono de un cliente desde el ARM (permiso 'operar'). Si con el número nuevo
-- un contacto de WhatsApp sin vincular coincide (y es el único cliente con ese número), se vincula.
create or replace function public.crm_cliente_telefono(p_cliente uuid, p_telefono text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_emp uuid;
  v_tel text := nullif(left(btrim(coalesce(p_telefono, '')), 40), '');
  v_wa  text;
  v_n   int := 0;
begin
  if public.crm_acceso() is distinct from 'operar' then
    return jsonb_build_object('ok', false, 'error', 'solo-lectura');
  end if;
  select cl.id_empresa into v_emp from public.clientes cl
   where cl.id = p_cliente and cl.archivado_ts is null and cl.id_empresa in (select public.crm_empresas());
  if v_emp is null then
    return jsonb_build_object('ok', false, 'error', 'cliente-inexistente');
  end if;

  update public.clientes set telefono = v_tel where id = p_cliente;
  v_wa := public.crm_wa_de_telefono(v_tel);

  if v_wa is not null and public.crm_cliente_por_wa(v_emp, v_wa) = p_cliente then
    update public.crm_contactos k set id_cliente = p_cliente, vinculo_origen = 'auto'
     where k.id_empresa = v_emp and k.wa_id = v_wa and k.id_cliente is null;
    get diagnostics v_n = row_count;
  end if;

  return jsonb_build_object('ok', true, 'telefono', v_tel, 'wa', v_wa,
    'estado_tel', case when v_tel is null then 'sin' when v_wa is null then 'revisar'
                       when public.crm_cliente_por_wa(v_emp, v_wa) is null then 'repetido' else 'ok' end,
    'vinculados', v_n);
end $$;

-- ── 8. Permisos (regla 7-bis: revocar de los TRES y verificar proacl) ───────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public.crm_token_pedido(uuid)',
    'public.crm_cliente_por_wa(uuid, text)',
    'public.crm_contacto_vinculo()',
    'public.crm_reemplazar_items_pedido(uuid, uuid, text, jsonb, numeric, numeric)',
    'public.crm_anular_pedido_arm(uuid, uuid, text, uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.crm_wa_de_telefono(text)',
    'public.crm_pedidos_cliente(uuid)',
    'public.crm_catalogo(text, text, text, int, int, uuid, text)',
    'public.crm_catalogo_filtros(uuid)',
    'public.crm_sugerencias_cliente(uuid)',
    'public.crm_clientes_base(uuid, text, text, int, int)',
    'public.crm_cliente_telefono(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';

commit;
