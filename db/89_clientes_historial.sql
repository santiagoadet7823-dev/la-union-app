-- db/89 — Historial de cada cliente (quién lo creó, quién cambió qué y cuándo) + la zona que puede
-- elegir un vendedor (23/10/2026, plan 21).
--
-- CONTEXTO. La Unión pidió trazabilidad de la cartera: quién dio de alta un comercio y quién le tocó
-- qué. Se muestra en un desplegable "Historial" de la ficha. Lo ven gestión (superadmin, admin,
-- encargado) y SOLO el vendedor que creó el cliente. Además, el vendedor elige la zona del cliente
-- entre SUS zonas: hoy un alta del teléfono nace sin zona y queda "a medias" (sin dueño visible).
--
-- 🔑 POR QUÉ UN TRIGGER Y NO EL FRONT (como `pedido_ediciones`, db/55). A `clientes` se escribe por
-- muchos caminos: alta y edición del vendedor, ficha de gestión, confirmar, archivar, importar
-- planilla, asignar zonas, arreglos por SQL. Un trigger los capta TODOS y nadie lo puede falsear.
-- Límites que hay que saber:
--   · quién = `auth.uid()` de la sesión que VACÍA la cola (normalmente el que hizo el cambio);
--   · cuándo = hora en que el cambio LLEGÓ al servidor (un cambio hecho sin señal figura al sincronizar);
--   · sin `auth.uid()` (SQL a mano, procesos) figura como "Sistema".
--
-- 🔑 EL NOMBRE SE GUARDA EN LA FILA. Un vendedor no puede leer `perfiles` ajenos (db/40), así que un
-- embed por FK le daría "Sin nombre". Se copia nombre y rol al escribir: además, el historial no
-- cambia si después se renombra o se borra el usuario.
--
-- 🔑 `creado_por` / `creado_ts` son las mismas columnas que define db/86 (plan 07, sin aplicar), con
-- el mismo criterio (las pone el servidor, no se editan). db/86 usa `add column if not exists`, así
-- que puede correr después de esta sin chocar; su trigger también pisa `creado_por`, coinciden.
--
-- Volver atrás:
--   drop trigger if exists clientes_historial_reg on public.clientes;
--   drop trigger if exists clientes_fiscal_historial on public.clientes_fiscal;
--   drop trigger if exists clientes_alta_y_zona on public.clientes;
--   drop table if exists public.clientes_historial;      -- ⚠️ se pierde el historial: respaldar antes
--   drop function if exists public.registrar_historial_cliente(), public.registrar_historial_fiscal(),
--                           public.clientes_alta_y_zona(), public.historial_quien();
--   (las columnas creado_por/creado_ts se pueden dejar: db/86 las usa)

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Quién y cuándo se creó cada cliente
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.clientes add column if not exists creado_por uuid references public.perfiles(id) on delete set null;
alter table public.clientes add column if not exists creado_ts timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Antes de escribir: sellar el alta y frenar la zona ajena
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- · Alta: `creado_por` = quien inserta (no se le cree al payload) y `creado_ts` = ahora.
-- · `creado_por`/`creado_ts` no se editan desde la app (mismo error que db/86). Sin `auth.uid()`
--   (SQL a mano) se permite, para poder corregir.
-- · Un VENDEDOR sólo puede poner al cliente en una zona SUYA, y sólo si el cliente no tenía zona o
--   la que tenía también era suya: así no se lleva clientes de otro. Gestión elige cualquier zona.
--   Corre antes que `clientes_hereda_vendedor_de_zona` (db/75) por orden alfabético; da igual el
--   orden, porque sólo mira `id_zona`.
create or replace function public.clientes_alta_y_zona()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  yo uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(yo, new.creado_por);
    new.creado_ts := now();
  elsif yo is not null and (new.creado_por is distinct from old.creado_por
                            or new.creado_ts is distinct from old.creado_ts) then
    raise exception 'rastreo-de-alta-no-editable'
      using hint = 'Quién creó el cliente y cuándo no se pueden cambiar.';
  end if;

  if yo is not null and new.id_zona is not null
     and (tg_op = 'INSERT' or new.id_zona is distinct from old.id_zona)
     and (select public.mi_rol()) = 'vendedor' then
    if not exists (select 1 from public.zonas z where z.id = new.id_zona and z.id_vendedor = yo)
       or (tg_op = 'UPDATE' and old.id_zona is not null
           and not exists (select 1 from public.zonas z where z.id = old.id_zona and z.id_vendedor = yo)) then
      raise exception 'zona-ajena'
        using hint = 'Esa zona es de otro vendedor.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clientes_alta_y_zona on public.clientes;
create trigger clientes_alta_y_zona
  before insert or update on public.clientes
  for each row execute function public.clientes_alta_y_zona();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. La tabla del historial
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- `id_cliente` SIN FK: el borrado de un cliente también queda registrado (y no se lleva su historia).
-- `cambios` = [{campo, de, a}] con rótulos y valores ya legibles (zona y vendedor por nombre).
create table if not exists public.clientes_historial (
  id             bigint generated always as identity primary key,
  id_empresa     uuid not null references public.empresas(id),
  id_cliente     uuid not null,
  accion         text not null check (accion in ('alta', 'edicion', 'confirmado', 'archivado', 'desarchivado', 'borrado', 'fiscal')),
  cambios        jsonb not null default '[]'::jsonb,
  id_usuario     uuid,
  usuario_nombre text,
  usuario_rol    text,
  ts             timestamptz not null default now()
);
create index if not exists clientes_historial_cliente_idx on public.clientes_historial (id_cliente, ts desc);
create index if not exists clientes_historial_empresa_idx on public.clientes_historial (id_empresa, ts desc);

-- Quién está escribiendo, para copiarlo en la fila. Sin sesión: "Sistema".
create or replace function public.historial_quien(out id uuid, out nombre text, out rol text)
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid(),
         coalesce((select p.nombre from public.perfiles p where p.id = auth.uid()), case when auth.uid() is null then 'Sistema' end),
         coalesce((select p.rol from public.perfiles p where p.id = auth.uid()), case when auth.uid() is null then 'sistema' end);
$$;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Después de escribir en `clientes`: anotar qué cambió
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: escribe en una tabla donde nadie más puede escribir, y lee nombres de zona y de
-- vendedor que el vendedor no siempre ve. Un UPDATE que no cambia ningún campo de la lista (el
-- reintento de la cola, un "guardar" sin tocar nada) NO deja fila.
create or replace function public.registrar_historial_cliente()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c      jsonb := '[]'::jsonb;
  accion text;
  q      record;
  d      numeric;

  -- nombre legible de una zona / un vendedor
  zona_txt   text;
  zona_txt_v text;
  vend_txt   text;
  vend_txt_v text;
begin
  select * into q from public.historial_quien();

  if tg_op = 'DELETE' then
    insert into public.clientes_historial (id_empresa, id_cliente, accion, cambios, id_usuario, usuario_nombre, usuario_rol)
    values (old.id_empresa, old.id, 'borrado',
            jsonb_build_array(jsonb_build_object('campo', 'Nombre', 'de', old.nombre_comercio),
                              jsonb_build_object('campo', 'Código', 'de', old.codigo)),
            q.id, q.nombre, q.rol);
    return old;
  end if;

  select z.abrev || ' · ' || z.nombre into zona_txt from public.zonas z where z.id = new.id_zona;
  select p.nombre into vend_txt from public.perfiles p where p.id = new.id_vendedor;

  if tg_op = 'INSERT' then
    -- el alta: qué datos trajo
    if coalesce(new.codigo, '') <> '' then c := c || jsonb_build_object('campo', 'Código', 'a', new.codigo); end if;
    c := c || jsonb_build_object('campo', 'Nombre', 'a', new.nombre_comercio);
    if zona_txt is not null then c := c || jsonb_build_object('campo', 'Zona', 'a', zona_txt); end if;
    if vend_txt is not null then c := c || jsonb_build_object('campo', 'Vendedor', 'a', vend_txt); end if;
    if coalesce(new.telefono, '') <> '' then c := c || jsonb_build_object('campo', 'Teléfono', 'a', new.telefono); end if;
    if new.lat is not null then c := c || jsonb_build_object('campo', 'Ubicación', 'a', 'cargada'); end if;
    if coalesce(new.dias_visita, '') <> '' then c := c || jsonb_build_object('campo', 'Días de visita', 'a', new.dias_visita); end if;
    insert into public.clientes_historial (id_empresa, id_cliente, accion, cambios, id_usuario, usuario_nombre, usuario_rol)
    values (new.id_empresa, new.id, 'alta', c, q.id, q.nombre, q.rol);
    return new;
  end if;

  -- UPDATE: campo por campo (como app_config_historial, db/07)
  if new.codigo is distinct from old.codigo then
    c := c || jsonb_build_object('campo', 'Código', 'de', old.codigo, 'a', new.codigo); end if;
  if new.nombre_comercio is distinct from old.nombre_comercio then
    c := c || jsonb_build_object('campo', 'Nombre', 'de', old.nombre_comercio, 'a', new.nombre_comercio); end if;
  if new.lat is distinct from old.lat or new.lng is distinct from old.lng then
    if old.lat is null then
      c := c || jsonb_build_object('campo', 'Ubicación', 'a', 'cargada');
    elsif new.lat is null then
      c := c || jsonb_build_object('campo', 'Ubicación', 'a', 'borrada');
    else
      d := round((111320 * sqrt(power(new.lat - old.lat, 2)
                                + power((new.lng - old.lng) * cos(radians(old.lat)), 2)))::numeric);
      c := c || jsonb_build_object('campo', 'Ubicación', 'a', 'movida ' || d || ' m');
    end if;
  end if;
  if new.localidad is distinct from old.localidad then
    c := c || jsonb_build_object('campo', 'Localidad', 'de', old.localidad, 'a', new.localidad); end if;
  if new.dias_visita is distinct from old.dias_visita then
    c := c || jsonb_build_object('campo', 'Días de visita', 'de', old.dias_visita, 'a', new.dias_visita); end if;
  if new.frecuencia is distinct from old.frecuencia then
    c := c || jsonb_build_object('campo', 'Frecuencia', 'de', old.frecuencia, 'a', new.frecuencia); end if;
  if new.horario is distinct from old.horario then
    c := c || jsonb_build_object('campo', 'Horario', 'de', old.horario, 'a', new.horario); end if;
  if new.telefono is distinct from old.telefono then
    c := c || jsonb_build_object('campo', 'Teléfono', 'de', old.telefono, 'a', new.telefono); end if;
  if new.contacto is distinct from old.contacto then
    c := c || jsonb_build_object('campo', 'Contacto', 'de', old.contacto, 'a', new.contacto); end if;
  if new.forma_pago_default is distinct from old.forma_pago_default then
    c := c || jsonb_build_object('campo', 'Forma de pago', 'de', old.forma_pago_default, 'a', new.forma_pago_default); end if;
  if new.id_zona is distinct from old.id_zona then
    select z.abrev || ' · ' || z.nombre into zona_txt_v from public.zonas z where z.id = old.id_zona;
    c := c || jsonb_build_object('campo', 'Zona', 'de', zona_txt_v, 'a', zona_txt); end if;
  if new.id_vendedor is distinct from old.id_vendedor then
    select p.nombre into vend_txt_v from public.perfiles p where p.id = old.id_vendedor;
    c := c || jsonb_build_object('campo', 'Vendedor', 'de', vend_txt_v, 'a', vend_txt); end if;
  if new.activo is distinct from old.activo and not new.activo then
    c := c || jsonb_build_object('campo', 'Confirmado', 'de', 'sí', 'a', 'no'); end if;

  if old.archivado_ts is null and new.archivado_ts is not null then
    accion := 'archivado';
  elsif old.archivado_ts is not null and new.archivado_ts is null then
    accion := 'desarchivado';
  elsif new.activo and not old.activo and jsonb_array_length(c) = 0 then
    accion := 'confirmado';
  elsif new.activo and not old.activo then
    accion := 'edicion';
    c := c || jsonb_build_object('campo', 'Confirmado', 'de', 'no', 'a', 'sí');
  elsif jsonb_array_length(c) > 0 then
    accion := 'edicion';
  else
    return new;   -- nada que anotar
  end if;

  insert into public.clientes_historial (id_empresa, id_cliente, accion, cambios, id_usuario, usuario_nombre, usuario_rol)
  values (new.id_empresa, new.id, accion, c, q.id, q.nombre, q.rol);
  return new;
end;
$$;

drop trigger if exists clientes_historial_reg on public.clientes;
create trigger clientes_historial_reg
  after insert or update or delete on public.clientes
  for each row execute function public.registrar_historial_cliente();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Situación fiscal y CUIT/CUIL (db/88) también al historial
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.registrar_historial_fiscal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c jsonb := '[]'::jsonb;
  q record;
  iva_viejo text := case when tg_op = 'UPDATE' then old.condicion_iva end;
  cuit_viejo text := case when tg_op = 'UPDATE' then old.cuit end;
  rotulo constant jsonb := '{"RI":"Responsable inscripto","MONOTRIBUTO":"Monotributista","EXENTO":"Exento",
                             "CONSUMIDOR_FINAL":"Consumidor final","NO_ALCANZADO":"No alcanzado"}';
begin
  if new.condicion_iva is distinct from iva_viejo then
    c := c || jsonb_build_object('campo', 'Situación fiscal', 'de', rotulo ->> iva_viejo, 'a', rotulo ->> new.condicion_iva);
  end if;
  if new.cuit is distinct from cuit_viejo then
    c := c || jsonb_build_object('campo', 'CUIT/CUIL',
      'de', case when cuit_viejo is not null then substr(cuit_viejo, 1, 2) || '-' || substr(cuit_viejo, 3, 8) || '-' || substr(cuit_viejo, 11) end,
      'a',  case when new.cuit is not null then substr(new.cuit, 1, 2) || '-' || substr(new.cuit, 3, 8) || '-' || substr(new.cuit, 11) end);
  end if;
  if jsonb_array_length(c) = 0 then
    return new;
  end if;
  select * into q from public.historial_quien();
  insert into public.clientes_historial (id_empresa, id_cliente, accion, cambios, id_usuario, usuario_nombre, usuario_rol)
  values (new.id_empresa, new.id_cliente, 'fiscal', c, q.id, q.nombre, q.rol);
  return new;
end;
$$;

drop trigger if exists clientes_fiscal_historial on public.clientes_fiscal;
create trigger clientes_fiscal_historial
  after insert or update on public.clientes_fiscal
  for each row execute function public.registrar_historial_fiscal();

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 6. Quién lo lee: gestión y el vendedor que creó el cliente. Nadie escribe a mano.
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
alter table public.clientes_historial enable row level security;

drop policy if exists clientes_historial_sel on public.clientes_historial;
create policy clientes_historial_sel on public.clientes_historial for select to authenticated
  using ((select public.es_superadmin())
         or (id_empresa = (select public.mi_empresa())
             and ((select public.mi_rol()) in ('superadmin', 'admin', 'encargado')
                  or exists (select 1 from public.clientes c
                              where c.id = clientes_historial.id_cliente and c.creado_por = (select auth.uid())))));

drop policy if exists clientes_historial_no_marketing on public.clientes_historial;
create policy clientes_historial_no_marketing on public.clientes_historial as restrictive for all to authenticated
  using ((select public.mi_rol()) is distinct from 'marketing')
  with check ((select public.mi_rol()) is distinct from 'marketing');

revoke all on public.clientes_historial from public, anon, authenticated;
grant select on public.clientes_historial to authenticated;
grant all on public.clientes_historial to service_role;

revoke all on function public.historial_quien() from public, anon, authenticated;
revoke all on function public.registrar_historial_cliente() from public, anon, authenticated;
revoke all on function public.registrar_historial_fiscal() from public, anon, authenticated;
revoke all on function public.clientes_alta_y_zona() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 7. Punto de partida: los clientes que ya existen
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- No se sabe quién los cargó (antes no se guardaba): una fila "alta" con su fecha y sin autor, así
-- el desplegable nunca queda vacío. `creado_por` queda null (no se inventa).
insert into public.clientes_historial (id_empresa, id_cliente, accion, cambios, ts)
select c.id_empresa, c.id, 'alta',
       jsonb_build_array(jsonb_build_object('campo', 'Nota', 'a', 'Alta registrada antes del historial')),
       c.created_at
  from public.clientes c
 where c.id_empresa is not null
   and not exists (select 1 from public.clientes_historial h where h.id_cliente = c.id);

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 8. Autochequeo: si algo de arriba no quedó, la migración FALLA en vez de decir que anduvo.
--    (El comportamiento con usuarios reales se prueba aparte, dentro de una transacción descartada.)
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  if not exists (select 1 from pg_class where oid = 'public.clientes_historial'::regclass and relrowsecurity) then
    raise exception 'db/89: RLS apagado en clientes_historial';
  end if;
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'clientes_historial';
  if n <> 2 then raise exception 'db/89: se esperaban 2 policies en clientes_historial y hay %', n; end if;
  if has_table_privilege('authenticated', 'public.clientes_historial', 'insert')
     or has_table_privilege('authenticated', 'public.clientes_historial', 'update')
     or has_table_privilege('authenticated', 'public.clientes_historial', 'delete')
     or has_table_privilege('anon', 'public.clientes_historial', 'select') then
    raise exception 'db/89: permisos de más en clientes_historial';
  end if;
  select count(*) into n from pg_trigger
   where tgname in ('clientes_alta_y_zona', 'clientes_historial_reg', 'clientes_fiscal_historial') and not tgisinternal;
  if n <> 3 then raise exception 'db/89: faltan triggers (hay % de 3)', n; end if;
  select count(*) into n from public.clientes c
   where c.id_empresa is not null and not exists (select 1 from public.clientes_historial h where h.id_cliente = c.id);
  if n > 0 then raise exception 'db/89: % clientes sin fila inicial de historial', n; end if;
end $$;

notify pgrst, 'reload schema';

-- Verificación (no modifica nada):
--   select accion, count(*) from public.clientes_historial group by 1;
--   select * from public.clientes_historial where id_cliente = '<id>' order by ts desc;
