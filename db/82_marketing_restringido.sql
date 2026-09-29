-- 82_marketing_restringido.sql — Tarea 3: el rol `marketing` ve y edita el CATÁLOGO y nada más.
-- 29/09/2026.
--
-- Qué hay en la base viva (auditado en solo lectura el 29/09/2026, con pg_policies + pg_proc):
--   · `marketing` ya estaba fuera de las policies de posiciones, recorridos_snap, visitas, alertas,
--     rutas, pedidos (los ve solo si son suyos) y perfiles (solo el propio). Eso NO se toca.
--   · PERO cinco policies de LECTURA filtran solo por empresa, sin mirar el rol, así que marketing
--     leía la cartera entera —nombre del comercio, teléfono, coordenadas— y los mapas de cobertura:
--       clientes_sel · zonas_sel · coberturas_zona_sel · categorias_rastreo_sel · pcr_sel
--   · Y dos de ESCRITURA le abrían la puerta a fabricar datos operativos a nombre propio:
--       clientes_ins (`id_empresa = mi_empresa()`, sin rol) · pedidos_ins (`id_vendedor = auth.uid()`).
--   · Cuatro funciones SECURITY DEFINER ejecutables por `authenticated` no miraban el rol:
--       productos_sugeridos_cliente (historial de compras de CUALQUIER cliente por id)
--       reclamar_y_ubicar_cliente   (reclama y mueve un cliente sin vendedor)
--       ultimas_posiciones_compartidas (posiciones de quien compartió ubicación con la empresa)
--       mi_token_ingesta('gps')     (le daba un token de rastreo a alguien que "no se trackea")
--     Había 1 token 'gps' activo de una cuenta marketing.
--
-- 🩸 POR QUÉ POLICIES RESTRICTIVE Y NO REESCRIBIR LAS EXISTENTES. Una policy RESTRICTIVE se combina
-- con AND sobre todas las permisivas, así que agregar una por tabla corta a marketing en SELECT,
-- INSERT, UPDATE y DELETE de una sola vez, sin tocar la lógica (delicada, con historia) de las
-- policies de cada tabla. Es aditivo: revertir es `drop policy`. Y es a prueba de olvidos: una
-- policy permisiva NUEVA que alguien agregue mañana sin acordarse de marketing sigue quedando
-- cortada por esta. Es el mismo mecanismo que el plan usa para el aal2 (Tarea 2.2.E).
--
-- Regla 10: el rol va como `(select mi_rol())` para que se evalúe UNA vez por sentencia y no una por
-- fila (clientes tiene ~2.000 filas y posiciones cientos de miles).
--
-- LO QUE MARKETING SIGUE PUDIENDO (y por eso NO se restringe acá):
--   · productos / categorias / storage `productos` — sus policies `*_wr` ya lo listan a propósito.
--   · ingestas_precios / ingestas_emisor (solo lectura) y su token de 'precios'.
--   · su propia fila de perfiles, su empresa (empresas_sel), app_config (pública por diseño).
--
-- DELIBERADAMENTE FUERA: `ubicaciones_compartidas`. MiCuenta la muestra a todos los roles, incluido
-- marketing; sus policies son solo-fila-propia y no filtran datos ajenos. Sacársela es una decisión
-- de UI (Tarea 3, parte visual) y no de seguridad — bloquearla acá solo produciría un error en un
-- panel que todavía se dibuja.
--
-- Regla 7-bis: esta migración NO crea funciones, solo las reemplaza (misma firma), y
-- CREATE OR REPLACE conserva el ACL. Se verifica igual al final.
--
-- ROLLBACK: ver el bloque al pie + `_interno/seguridad/respaldo_pre_db82.sql`.

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 1. Policies RESTRICTIVE: marketing queda fuera de todo lo operativo.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare
  t text;
  tablas text[] := array[
    -- cartera y territorio
    'clientes', 'zonas', 'coberturas_zona', 'categorias_rastreo', 'perfiles_categorias_rastreo',
    -- ventas
    'pedidos', 'pedido_items', 'pedido_ediciones', 'visitas', 'metas',
    -- rastreo del equipo
    'posiciones', 'recorridos_snap', 'tramos_transporte', 'estado_dispositivo', 'alertas_equipo', 'rutas'
  ];
begin
  foreach t in array tablas loop
    execute format('drop policy if exists %I on public.%I', t || '_no_marketing', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      || 'using ((select public.mi_rol()) is distinct from ''marketing'') '
      || 'with check ((select public.mi_rol()) is distinct from ''marketing'')',
      t || '_no_marketing', t);
  end loop;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 2. Funciones SECURITY DEFINER que no miraban el rol de quien llama.
--    Lista blanca (no "todo menos marketing"): un rol nuevo entra cerrado, no abierto.
-- ═════════════════════════════════════════════════════════════════════════════════════════════

create or replace function public.productos_sugeridos_cliente(p_id_cliente uuid, p_limite integer default 8)
returns table(id_producto uuid, veces bigint, unidades bigint, puntaje numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    pi.id_producto,
    count(distinct p.id)      as veces,
    sum(pi.cantidad)::bigint  as unidades,
    round(sum(power(0.5, extract(epoch from (now() - p.created_at)) / (90 * 86400)))::numeric, 4) as puntaje
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.id_pedido
  where p.id_cliente = p_id_cliente
    and p.id_empresa = (select mi_empresa())
    -- db/82: el historial de compras de un cliente no es del catálogo. Sin este renglón, marketing
    -- lo leía pasando cualquier id_cliente.
    and (select mi_rol()) in ('superadmin', 'admin', 'encargado', 'vendedor', 'repartidor')
    and p.estado <> 'Anulado'
    and pi.id_producto is not null
    and p.created_at > now() - interval '2 years'
  group by pi.id_producto
  having count(distinct p.id) >= 2
  order by puntaje desc, unidades desc
  limit greatest(1, least(coalesce(p_limite, 8), 30));
$function$;

create or replace function public.reclamar_y_ubicar_cliente(p_id uuid, p_lat double precision, p_lng double precision)
returns clientes
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row     public.clientes;
  v_empresa uuid := mi_empresa();
  v_rol     text := mi_rol();
begin
  -- db/82: reclamar un cliente es trabajo de calle o de gestión. 42501 está en CODIGOS_PERMANENTES
  -- de la cola offline, así que no se reintenta para siempre.
  if v_rol is null or v_rol not in ('superadmin', 'admin', 'encargado', 'vendedor', 'repartidor') then
    raise exception 'sin-permiso' using errcode = '42501';
  end if;

  update public.clientes
     set id_vendedor = auth.uid(),
         lat = coalesce(p_lat, lat),
         lng = coalesce(p_lng, lng)
   where id = p_id
     and id_empresa = v_empresa
     and (id_vendedor is null or id_vendedor = auth.uid())
  returning * into v_row;

  if not found then
    raise exception
      'No se puede reclamar/ubicar el cliente % (no existe, es de otra empresa, o ya tiene otro vendedor).', p_id
      using errcode = '42501';
  end if;

  return v_row;
end;
$function$;

create or replace function public.ultimas_posiciones_compartidas()
returns table(id_usuario uuid, nombre text, rol text, lat double precision, lng double precision, ts timestamp with time zone)
language sql
stable security definer
set search_path to 'public'
as $function$
  with permitidos as (
    select c.id_usuario
    from ubicaciones_compartidas c
    where c.id_empresa_destino = (select mi_empresa())
      and c.activo
      and (c.hasta is null or now() < c.hasta)
      -- db/82: mismo criterio que `ucomp_sel`: solo supervisión ve lo que otra empresa compartió.
      and (select mi_rol()) in ('superadmin', 'admin', 'encargado')
  )
  select distinct on (p.id_usuario)
    p.id_usuario, pe.nombre, p.rol, p.lat, p.lng, p.ts
  from posiciones p
  join permitidos pm on pm.id_usuario = p.id_usuario
  left join perfiles pe on pe.id = p.id_usuario
  where p.ts > now() - interval '24 hours'
    -- = gpsConfig.ACCURACY_MAX_M: arriba de eso es triangulado y no ubica a nadie (regla 40).
    and (p.accuracy is null or p.accuracy <= 30)
  order by p.id_usuario, p.ts desc;
$function$;

create or replace function public.mi_token_ingesta(p_proposito text default 'gps'::text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_token uuid;
  v_empresa uuid;
  v_rol text;
begin
  if p_proposito not in ('gps', 'precios') then
    raise exception 'proposito invalido: %', p_proposito;
  end if;

  select id_empresa, rol into v_empresa, v_rol from public.perfiles where id = auth.uid();
  if v_empresa is null then
    raise exception 'sin empresa';
  end if;

  -- db/82: marketing NO se trackea (db/38). Un token 'gps' es el permiso para escribir posiciones.
  if p_proposito = 'gps' and v_rol = 'marketing' then
    raise exception 'sin permiso para un token de gps';
  end if;

  if p_proposito = 'precios'
     and not (v_rol in ('admin', 'encargado', 'marketing', 'superadmin')
              or 'catalogo' = any(public.mis_permisos())) then
    raise exception 'sin permiso para un token de precios';
  end if;

  insert into public.ingesta_tokens (id_usuario, id_empresa, proposito)
  values (auth.uid(), v_empresa, p_proposito)
  on conflict (id_usuario, proposito)
    do update set id_empresa = excluded.id_empresa, revocado = false
  returning token into v_token;
  return v_token;
end;
$function$;

-- El token 'gps' que ya existía de una cuenta marketing: se revoca (el guard de arriba impide que
-- se vuelva a generar). `ingest-posiciones` valida `revocado` antes de insertar.
update public.ingesta_tokens t
   set revocado = true
 where t.proposito = 'gps'
   and t.revocado = false
   and t.id_usuario in (select p.id from public.perfiles p where p.rol = 'marketing');

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Autochequeo: si algo de arriba no quedó, la migración FALLA en vez de decir que anduvo.
-- ═════════════════════════════════════════════════════════════════════════════════════════════
do $$
declare
  faltan text;
begin
  select string_agg(x.tabla, ', ') into faltan
  from unnest(array[
    'clientes', 'zonas', 'coberturas_zona', 'categorias_rastreo', 'perfiles_categorias_rastreo',
    'pedidos', 'pedido_items', 'pedido_ediciones', 'visitas', 'metas',
    'posiciones', 'recorridos_snap', 'tramos_transporte', 'estado_dispositivo', 'alertas_equipo', 'rutas'
  ]) as x(tabla)
  where not exists (
    select 1 from pg_policies p
     where p.schemaname = 'public' and p.tablename = x.tabla
       and p.policyname = x.tabla || '_no_marketing' and p.permissive = 'RESTRICTIVE'
  ) or not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = x.tabla and c.relrowsecurity
  );
  if faltan is not null then
    raise exception 'db/82: falta la policy restrictiva (o RLS apagado) en: %', faltan;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (después de aplicar)
--   -- 16 policies restrictivas nuevas:
--   select tablename, policyname, permissive, roles from pg_policies
--    where policyname like '%\_no\_marketing' order by 1;
--
--   -- ACL intacto en las 4 funciones (regla 7-bis): authenticated=X, SIN anon donde no lo tenían:
--   select proname, proacl from pg_proc
--    where proname in ('productos_sugeridos_cliente','reclamar_y_ubicar_cliente',
--                      'ultimas_posiciones_compartidas','mi_token_ingesta');
--
--   -- Ningún token 'gps' activo de marketing:
--   select count(*) from ingesta_tokens t join perfiles p on p.id = t.id_usuario
--    where t.proposito = 'gps' and not t.revocado and p.rol = 'marketing';   -- 0
--
--   -- Prueba de comportamiento, simulando a una cuenta marketing (en una transacción que se descarta):
--   begin;
--     select set_config('request.jwt.claims',
--       '{"sub":"<uuid de una cuenta marketing>","role":"authenticated"}', true);
--     set local role authenticated;
--     select count(*) from clientes;        -- 0
--     select count(*) from zonas;           -- 0
--     select count(*) from productos;       -- >0  (el catálogo sigue andando)
--     select count(*) from perfiles;        -- 1   (solo el propio)
--   rollback;
--
-- ROLLBACK (policies):
--   do $$ declare t text; begin
--     foreach t in array array['clientes','zonas','coberturas_zona','categorias_rastreo',
--       'perfiles_categorias_rastreo','pedidos','pedido_items','pedido_ediciones','visitas','metas',
--       'posiciones','recorridos_snap','tramos_transporte','estado_dispositivo','alertas_equipo','rutas']
--     loop execute format('drop policy if exists %I on public.%I', t || '_no_marketing', t); end loop;
--   end $$;
-- ROLLBACK (funciones): correr `_interno/seguridad/respaldo_pre_db82.sql`.
-- ─────────────────────────────────────────────────────────────────────────────────────────────
