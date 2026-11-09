-- 104_crm.sql — CRM de WhatsApp de DisT-At en crm.dist-at.com (09/11/2026, plan 41).
--
-- EL PEDIDO. Que cada distribuidora vea en vivo lo que sus clientes hablan con el bot de ventas por
-- WhatsApp, pueda tomar el control de la conversación (con el cartel "Controlado por {nombre}" para que
-- dos personas no se pisen), editar y confirmar el ticket del pedido y pedirle a la IA local que retome.
--
-- QUÉ AGREGA:
--   1. `wa_numeros`: qué número de Meta es de qué empresa y para qué (consultas | ventas). El token NO se
--      guarda acá: `token_ref` es el nombre del secreto en Vault (regla 25).
--   2. `crm_contactos`, `crm_conversaciones`, `crm_mensajes`, `crm_tickets`, `crm_parametros`.
--   3. Acceso por permiso explícito en `perfiles.permisos`: 'crm' (operar) o 'crm_ver' (solo mirar; es lo
--      que tiene Javier en la demostración). El superadmin opera siempre. El rol solo NO da acceso: así un
--      encargado puede quedar en solo lectura.
--   4. Lectura por RLS (`id_empresa in (select crm_empresas())`, regla 10) + RESTRICTIVE sin marketing.
--      NINGUNA escritura directa desde el navegador: solo RPC que validan empresa, permiso y quién tiene
--      el control. Lo que toca a Meta (enviar, ticket, IA) lo hacen funciones con service_role.
--   5. Realtime en conversaciones, mensajes y tickets. Bucket privado `crm-media` (<empresa>/<conv>/...).
--   6. `crm_buscar_productos`: búsqueda con pg_trgm para el editor de tickets y para el bot de ventas.
--
-- EXCEPCIÓN A LA REGLA 7-bis (documentada): `crm_acceso()` y `crm_empresas()` las usan las policies, así
-- que `authenticated` necesita EXECUTE (igual que `mi_empresa`, regla 8). Solo devuelven datos del propio
-- usuario. Las RPC de acción también van a `authenticated` porque las llama el CRM; cada una valida todo
-- adentro. Las de uso interno (`crm_acceso_de`, `crm_puede_operar`) son solo service_role.
--
-- Sin begin/commit: probar con `begin; \i ...; rollback;` y aplicar con `psql -1 -f`.

-- ── 0. Extensión para buscar productos por parecido ──────────────────────────────────────────────
create extension if not exists pg_trgm with schema extensions;

-- ── 1. Números de WhatsApp por empresa ──────────────────────────────────────────────────────────
create table public.wa_numeros (
  id               uuid primary key default gen_random_uuid(),
  id_empresa       uuid not null references public.empresas(id),
  phone_number_id  text not null unique,                      -- el id de Meta, no el teléfono
  proposito        text not null check (proposito in ('consultas', 'ventas')),
  nombre_visible   text,
  telefono_visible text,                                       -- para mostrar, ej. "+54 9 387 ..."
  token_ref        text,                                       -- nombre del secreto en Vault, nunca el valor
  activo           boolean not null default false,
  created_at       timestamptz not null default now()
);
comment on table public.wa_numeros is
  'Números de WhatsApp Cloud API por empresa (db/104). wa-entrada enruta por phone_number_id. Solo service_role.';
alter table public.wa_numeros enable row level security;
revoke all on table public.wa_numeros from public, anon, authenticated;
grant all on table public.wa_numeros to service_role;

-- ── 2. Parámetros del CRM por empresa ───────────────────────────────────────────────────────────
create table public.crm_parametros (
  id_empresa        uuid primary key references public.empresas(id),
  horas_volver_bot  int not null default 2,      -- sin actividad humana en ese lapso, vuelve el bot
  minutos_inactivo  int not null default 15,     -- el cartel de control se pone amarillo
  monto_derivar     numeric,                     -- ticket por encima de esto → pasa a una persona
  tope_mensual      int not null default 1000,   -- envíos del número de ventas por mes
  horario           jsonb,                       -- {"lun":["08:00","18:00"], ...}; null = siempre
  updated_at        timestamptz not null default now()
);
insert into public.crm_parametros (id_empresa) select id from public.empresas on conflict do nothing;

-- ── 3. Contactos, conversaciones, mensajes y tickets ─────────────────────────────────────────────
create table public.crm_contactos (
  id            uuid primary key default gen_random_uuid(),
  id_empresa    uuid not null references public.empresas(id),
  wa_id         text not null,                   -- teléfono en formato de Meta, solo dígitos
  nombre_perfil text,                            -- el nombre que el cliente tiene en WhatsApp
  id_cliente    uuid references public.clientes(id) on delete set null,
  opt_in_ts     timestamptz,
  created_at    timestamptz not null default now(),
  unique (id_empresa, wa_id)
);

create table public.crm_conversaciones (
  id                  uuid primary key default gen_random_uuid(),
  id_empresa          uuid not null references public.empresas(id),
  id_numero           uuid references public.wa_numeros(id),   -- null en la demostración
  id_contacto         uuid not null references public.crm_contactos(id) on delete cascade,
  estado              text not null default 'bot'
                      check (estado in ('bot', 'esperando_persona', 'humano', 'cerrada')),
  asignada_a          uuid references public.perfiles(id) on delete set null,
  asignada_nombre     text,                      -- copia para el cartel "Controlado por" en Realtime
  tomada_ts           timestamptz,
  ultima_actividad_ts timestamptz,               -- última acción de quien tiene el control
  ultima_entrante_ts  timestamptz,               -- último mensaje del cliente: ventana de 24 h
  ultimo_mensaje_ts   timestamptz,
  ultimo_texto        text,                      -- vista previa en la bandeja
  no_leidos           int not null default 0,
  motivo_derivacion   text,
  demo                boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- Una sola conversación abierta por contacto.
create unique index crm_conv_abierta_uq on public.crm_conversaciones (id_contacto) where estado <> 'cerrada';
create index crm_conv_bandeja_idx on public.crm_conversaciones (id_empresa, estado, ultimo_mensaje_ts desc);

create table public.crm_mensajes (
  id              bigint generated always as identity primary key,
  id_empresa      uuid not null references public.empresas(id),
  id_conversacion uuid not null references public.crm_conversaciones(id) on delete cascade,
  wamid           text unique,                   -- id de Meta: el mismo mensaje no se procesa dos veces
  direccion       text not null check (direccion in ('entra', 'sale', 'interno')),
  autor           text not null check (autor in ('cliente', 'bot', 'persona', 'sistema')),
  id_perfil       uuid references public.perfiles(id) on delete set null,
  autor_nombre    text,
  tipo            text not null default 'texto'
                  check (tipo in ('texto', 'audio', 'imagen', 'documento', 'ubicacion', 'plantilla', 'ticket', 'sistema')),
  texto           text,
  transcripcion   text,
  media_path      text,                          -- crm-media/<empresa>/<conversación>/<archivo>
  media_mime      text,
  estado_envio    text check (estado_envio in ('enviando', 'enviado', 'entregado', 'leido', 'fallo')),
  error           text,
  nota_interna    boolean not null default false,
  created_at      timestamptz not null default now()
);
create index crm_msj_conv_idx on public.crm_mensajes (id_conversacion, id);

create table public.crm_tickets (
  id              uuid primary key default gen_random_uuid(),
  id_empresa      uuid not null references public.empresas(id),
  id_conversacion uuid not null references public.crm_conversaciones(id) on delete cascade,
  id_cliente      uuid references public.clientes(id) on delete set null,
  items           jsonb not null default '[]',   -- [{id_producto, codigo, descripcion, cantidad, precio_unitario, subtotal}]
  total           numeric not null default 0,
  estado          text not null default 'borrador' check (estado in ('borrador', 'confirmado', 'cancelado')),
  creado_por_bot  boolean not null default false,
  creado_por      uuid references public.perfiles(id) on delete set null,
  editado_por     uuid references public.perfiles(id) on delete set null,
  editado_nombre  text,
  id_pedido       uuid references public.pedidos(id) on delete set null,
  numero_pedido   text,
  version         int not null default 1,        -- control de edición concurrente
  enviado_ts      timestamptz,                   -- se mandó al cliente para confirmar
  confirmado_ts   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index crm_ticket_borrador_uq on public.crm_tickets (id_conversacion) where estado = 'borrador';

-- Cada mensaje actualiza la vista previa, el contador y la ventana de 24 h. Un solo lugar (regla 36).
create function public.crm_tras_mensaje() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.nota_interna then
    return new;
  end if;
  update public.crm_conversaciones c
     set ultimo_mensaje_ts  = new.created_at,
         ultimo_texto       = left(coalesce(new.texto, case new.tipo when 'audio' then '🎤 Audio'
                                                                     when 'imagen' then '📷 Imagen'
                                                                     else new.tipo end), 140),
         ultima_entrante_ts = case when new.autor = 'cliente' then new.created_at else c.ultima_entrante_ts end,
         no_leidos          = case when new.autor = 'cliente' then c.no_leidos + 1 else c.no_leidos end,
         updated_at         = now()
   where c.id = new.id_conversacion;
  return new;
end $$;
create trigger crm_mensajes_tras_insert after insert on public.crm_mensajes
  for each row execute function public.crm_tras_mensaje();
revoke all on function public.crm_tras_mensaje() from public, anon, authenticated;

-- ── 4. Quién entra y qué puede hacer ─────────────────────────────────────────────────────────────
-- 'operar' | 'ver' | null. Perfil activo; superadmin opera siempre; si no, manda el permiso explícito.
create function public.crm_acceso_de(p_perfil uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
           when p.rol = 'superadmin' then 'operar'
           when p.rol = 'marketing' then null
           when 'crm' = any (p.permisos) then 'operar'
           when 'crm_ver' = any (p.permisos) then 'ver'
         end
    from public.perfiles p
   where p.id = p_perfil and p.activo
$$;

create function public.crm_acceso() returns text
language sql stable security definer set search_path = public as $$
  select public.crm_acceso_de(auth.uid())
$$;

-- Empresas que el usuario ve en el CRM: todas para el superadmin, la suya si tiene acceso.
create function public.crm_empresas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select e.id from public.empresas e
   where exists (select 1 from public.perfiles p where p.id = auth.uid() and p.activo and p.rol = 'superadmin')
  union
  select p.id_empresa from public.perfiles p
   where p.id = auth.uid() and public.crm_acceso_de(p.id) is not null
$$;

-- Para las funciones con service_role: ¿este perfil puede actuar sobre esta conversación?
-- p_exigir_control: además tiene que ser quien tiene el control.
create function public.crm_puede_operar(p_perfil uuid, p_conv uuid, p_exigir_control boolean default true)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.crm_conversaciones c
      join public.perfiles p on p.id = p_perfil
     where c.id = p_conv
       and public.crm_acceso_de(p_perfil) = 'operar'
       and (p.rol = 'superadmin' or c.id_empresa = p.id_empresa)
       and (not p_exigir_control or c.asignada_a = p_perfil)
  )
$$;

-- ── 5. Lectura (RLS) ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['crm_parametros', 'crm_contactos', 'crm_conversaciones', 'crm_mensajes', 'crm_tickets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
    execute format('create policy %I on public.%I for select to authenticated
                      using (id_empresa in (select public.crm_empresas()))', t || '_sel', t);
    execute format('create policy %I on public.%I as restrictive for all to authenticated
                      using ((select public.mi_rol()) is distinct from ''marketing'')', t || '_no_marketing', t);
  end loop;
end $$;

-- ── 6. Acciones desde el CRM ─────────────────────────────────────────────────────────────────────
-- Todas: exigen 'operar', validan la empresa y dejan un mensaje de sistema para que el resto lo vea.
create function public._crm_sistema(p_conv uuid, p_texto text) returns void
language sql security definer set search_path = public as $$
  insert into public.crm_mensajes (id_empresa, id_conversacion, direccion, autor, tipo, texto)
  select c.id_empresa, c.id, 'interno', 'sistema', 'sistema', p_texto
    from public.crm_conversaciones c where c.id = p_conv
$$;

create function public._crm_yo() returns public.perfiles
language plpgsql stable security definer set search_path = public as $$
declare v public.perfiles;
begin
  select * into v from public.perfiles where id = auth.uid() and activo;
  if v.id is null or public.crm_acceso_de(v.id) is distinct from 'operar' then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  return v;
end $$;

-- Tomar el control. Atómico: si dos aprietan a la vez, gana uno; el otro recibe quién lo tiene.
-- p_forzar: admin, encargado o superadmin pueden sacárselo a otro (queda registrado).
create function public.crm_tomar(p_conv uuid, p_forzar boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  yo     public.perfiles := public._crm_yo();
  v_prev text;
  v_ok   uuid;
begin
  select asignada_nombre into v_prev from public.crm_conversaciones where id = p_conv;

  update public.crm_conversaciones c
     set asignada_a = yo.id, asignada_nombre = yo.nombre, estado = 'humano',
         tomada_ts = now(), ultima_actividad_ts = now(), updated_at = now()
   where c.id = p_conv
     and c.id_empresa in (select public.crm_empresas())
     and c.estado <> 'cerrada'
     and (c.asignada_a is null or c.asignada_a = yo.id
          or (p_forzar and yo.rol in ('superadmin', 'admin', 'encargado')))
  returning c.id into v_ok;

  if v_ok is null then
    select asignada_nombre into v_prev from public.crm_conversaciones
     where id = p_conv and id_empresa in (select public.crm_empresas());
    return jsonb_build_object('ok', false, 'asignada_nombre', v_prev);
  end if;

  perform public._crm_sistema(p_conv,
    case when p_forzar and v_prev is not null and v_prev <> yo.nombre
         then yo.nombre || ' tomó el control (antes lo tenía ' || v_prev || ')'
         else yo.nombre || ' tomó el control' end);
  return jsonb_build_object('ok', true, 'asignada_nombre', yo.nombre);
end $$;

-- Soltar el control: vuelve al bot (p_al_bot) o queda esperando a otra persona.
create function public.crm_liberar(p_conv uuid, p_al_bot boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  yo   public.perfiles := public._crm_yo();
  v_ok uuid;
begin
  update public.crm_conversaciones c
     set asignada_a = null, asignada_nombre = null, tomada_ts = null,
         estado = case when p_al_bot then 'bot' else 'esperando_persona' end,
         motivo_derivacion = case when p_al_bot then null else c.motivo_derivacion end,
         updated_at = now()
   where c.id = p_conv
     and c.id_empresa in (select public.crm_empresas())
     and (c.asignada_a = yo.id or c.asignada_a is null or yo.rol in ('superadmin', 'admin', 'encargado'))
  returning c.id into v_ok;
  if v_ok is null then
    return jsonb_build_object('ok', false);
  end if;
  perform public._crm_sistema(p_conv, yo.nombre ||
    case when p_al_bot then ' devolvió la conversación al bot' else ' liberó la conversación' end);
  return jsonb_build_object('ok', true);
end $$;

-- Pasarle el control a otra persona del CRM de la misma empresa.
create function public.crm_pasar(p_conv uuid, p_perfil uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  yo     public.perfiles := public._crm_yo();
  v_dest public.perfiles;
  v_ok   uuid;
begin
  select * into v_dest from public.perfiles where id = p_perfil and activo;
  if v_dest.id is null or public.crm_acceso_de(v_dest.id) is distinct from 'operar' then
    return jsonb_build_object('ok', false, 'error', 'destino-sin-permiso');
  end if;
  update public.crm_conversaciones c
     set asignada_a = v_dest.id, asignada_nombre = v_dest.nombre, estado = 'humano',
         tomada_ts = now(), ultima_actividad_ts = now(), updated_at = now()
   where c.id = p_conv
     and c.id_empresa in (select public.crm_empresas())
     and (v_dest.rol = 'superadmin' or c.id_empresa = v_dest.id_empresa)
     and (c.asignada_a = yo.id or yo.rol in ('superadmin', 'admin', 'encargado'))
  returning c.id into v_ok;
  if v_ok is null then
    return jsonb_build_object('ok', false);
  end if;
  perform public._crm_sistema(p_conv, yo.nombre || ' le pasó la conversación a ' || v_dest.nombre);
  return jsonb_build_object('ok', true, 'asignada_nombre', v_dest.nombre);
end $$;

create function public.crm_cerrar(p_conv uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  yo   public.perfiles := public._crm_yo();
  v_ok uuid;
begin
  update public.crm_conversaciones c
     set estado = 'cerrada', asignada_a = null, asignada_nombre = null, no_leidos = 0, updated_at = now()
   where c.id = p_conv
     and c.id_empresa in (select public.crm_empresas())
     and (c.asignada_a is null or c.asignada_a = yo.id or yo.rol in ('superadmin', 'admin', 'encargado'))
  returning c.id into v_ok;
  if v_ok is null then
    return jsonb_build_object('ok', false);
  end if;
  perform public._crm_sistema(p_conv, yo.nombre || ' cerró la conversación');
  return jsonb_build_object('ok', true);
end $$;

create function public.crm_marcar_leido(p_conv uuid) returns void
language plpgsql security definer set search_path = public as $$
declare yo public.perfiles := public._crm_yo();
begin
  update public.crm_conversaciones set no_leidos = 0
   where id = p_conv and id_empresa in (select public.crm_empresas()) and no_leidos > 0;
end $$;

-- Nota interna: la ve el equipo, nunca el cliente. Cualquiera con 'operar', tenga o no el control.
create function public.crm_nota(p_conv uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare yo public.perfiles := public._crm_yo();
begin
  if coalesce(btrim(p_texto), '') = '' then
    raise exception 'nota-vacia';
  end if;
  insert into public.crm_mensajes (id_empresa, id_conversacion, direccion, autor, id_perfil, autor_nombre,
                                   tipo, texto, nota_interna)
  select c.id_empresa, c.id, 'interno', 'persona', yo.id, yo.nombre, 'texto', left(p_texto, 2000), true
    from public.crm_conversaciones c
   where c.id = p_conv and c.id_empresa in (select public.crm_empresas());
  if not found then
    raise exception 'conversacion-inexistente';
  end if;
end $$;

-- Vincular el contacto con un cliente de la base (de la misma empresa).
create function public.crm_vincular_cliente(p_conv uuid, p_cliente uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  yo  public.perfiles := public._crm_yo();
  c   public.crm_conversaciones;
  v_n text;
begin
  select * into c from public.crm_conversaciones
   where id = p_conv and id_empresa in (select public.crm_empresas());
  if c.id is null then
    return jsonb_build_object('ok', false, 'error', 'conversacion-inexistente');
  end if;
  select nombre_comercio into v_n from public.clientes
   where id = p_cliente and id_empresa = c.id_empresa and archivado_ts is null;
  if v_n is null then
    return jsonb_build_object('ok', false, 'error', 'cliente-de-otra-empresa');
  end if;
  update public.crm_contactos set id_cliente = p_cliente where id = c.id_contacto;
  update public.crm_tickets set id_cliente = p_cliente, updated_at = now()
   where id_conversacion = p_conv and estado = 'borrador';
  perform public._crm_sistema(p_conv, yo.nombre || ' vinculó el contacto con ' || v_n);
  return jsonb_build_object('ok', true, 'nombre_comercio', v_n);
end $$;

-- Personas de la empresa que pueden recibir una conversación (para "Pasar a…").
create function public.crm_personas() returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre from public.perfiles p
   where p.activo and public.crm_acceso_de(p.id) = 'operar'
     and p.id_empresa in (select public.crm_empresas())
   order by p.nombre
$$;

-- ── 7. Búsqueda de productos (editor de tickets y bot de ventas) ─────────────────────────────────
create index if not exists productos_desc_trgm_idx
  on public.productos using gin (lower(descripcion) extensions.gin_trgm_ops);

-- Todas las palabras tienen que aparecer (o el código exacto); ordena por parecido.
create function public.crm_buscar_productos_de(p_empresa uuid, p_texto text, p_limite int default 15)
returns table (id uuid, codigo text, descripcion text, marca text, categoria text, precio_unitario numeric,
               oferta boolean, precio_oferta numeric, escalas jsonb, unidades int, unidad_venta text, peso_kg numeric)
language sql stable security definer set search_path = public, extensions as $$
  with q as (select lower(btrim(coalesce(p_texto, ''))) as t)
  select pr.id, pr.codigo, pr.descripcion, pr.marca, pr.categoria, pr.precio_unitario,
         pr.oferta, pr.precio_oferta, pr.escalas, pr.unidades, pr.unidad_venta, pr.peso_kg
    from public.productos pr, q
   where pr.id_empresa = p_empresa
     and pr.descontinuado_ts is null
     and q.t <> ''
     and (pr.codigo_norm = q.t or pr.codigo = q.t
          or not exists (select 1 from regexp_split_to_table(q.t, '\s+') w
                          where w <> '' and lower(pr.descripcion) not like '%' || w || '%'))
   order by (pr.codigo = q.t) desc, similarity(lower(pr.descripcion), q.t) desc, pr.descripcion
   limit least(greatest(coalesce(p_limite, 15), 1), 50)
$$;

create function public.crm_buscar_productos(p_texto text, p_limite int default 15, p_empresa uuid default null)
returns table (id uuid, codigo text, descripcion text, marca text, categoria text, precio_unitario numeric,
               oferta boolean, precio_oferta numeric, escalas jsonb, unidades int, unidad_venta text, peso_kg numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_emp uuid;
begin
  if public.crm_acceso() is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  -- El superadmin puede indicar la empresa; el resto, siempre la suya.
  select e into v_emp from public.crm_empresas() e
   where p_empresa is null or e = p_empresa
   order by (e = public.mi_empresa()) desc limit 1;
  if v_emp is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  return query select * from public.crm_buscar_productos_de(v_emp, p_texto, p_limite);
end $$;

-- ── 8. Permisos de funciones ─────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  -- Internas: solo service_role (regla 7-bis).
  foreach f in array array[
    'public.crm_acceso_de(uuid)', 'public.crm_puede_operar(uuid, uuid, boolean)',
    'public._crm_sistema(uuid, text)', 'public.crm_buscar_productos_de(uuid, text, int)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  -- Las que llama el CRM con la sesión del usuario: validan adentro.
  foreach f in array array[
    'public.crm_acceso()', 'public.crm_empresas()', 'public._crm_yo()',
    'public.crm_tomar(uuid, boolean)', 'public.crm_liberar(uuid, boolean)', 'public.crm_pasar(uuid, uuid)',
    'public.crm_cerrar(uuid)', 'public.crm_marcar_leido(uuid)', 'public.crm_nota(uuid, text)',
    'public.crm_vincular_cliente(uuid, uuid)', 'public.crm_personas()',
    'public.crm_buscar_productos(text, int, uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

-- ── 9. Realtime y archivos ───────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.crm_conversaciones, public.crm_mensajes, public.crm_tickets;

insert into storage.buckets (id, name, public) values ('crm-media', 'crm-media', false)
on conflict (id) do nothing;
-- Lectura: el primer tramo de la ruta es la empresa. Escritura: solo service_role (sin policy).
create policy crm_media_sel on storage.objects for select to authenticated
  using (bucket_id = 'crm-media'
         and (storage.foldername(name))[1] in (select e::text from public.crm_empresas() e));

-- ── 10. Autochequeo de permisos (regla 7-bis) ────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as f, p.proacl::text as acl
             from pg_proc p where p.pronamespace = 'public'::regnamespace
              and (p.proname like 'crm\_%' or p.proname like '\_crm\_%') loop
    if r.acl like '%=X/%' and r.acl ~ '(^|[{,])=X/' then
      raise exception 'ACL abierta a public: %', r.f;
    end if;
    if r.acl like '%anon=%' then
      raise exception 'ACL abierta a anon: %', r.f;
    end if;
    if r.f::text in ('crm_acceso_de(uuid)', 'crm_puede_operar(uuid,uuid,boolean)', '_crm_sistema(uuid,text)',
                     'crm_buscar_productos_de(uuid,text,integer)', 'crm_tras_mensaje()')
       and r.acl like '%authenticated=%' then
      raise exception 'Función interna abierta a authenticated: %', r.f;
    end if;
  end loop;
end $$;
