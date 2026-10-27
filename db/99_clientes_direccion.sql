-- 99_clientes_direccion.sql — la dirección del comercio (27/10/2026, plan 30).
--
-- Pedido de La Unión: cargar la calle y el número del comercio en el alta y en la ficha. `clientes`
-- tenía `localidad` pero no la dirección, y el repartidor mostraba la localidad donde decía "Sin
-- dirección cargada".
--
-- ⚠️ NO VIAJA AL ERP (decisión del usuario): `Clientes.txt` sigue en 12 campos, así que
-- `cliente_export_control` no se toca y cambiar la dirección no sube `export_version`. Si se suma
-- después, es el campo 13 de `asciiClientes.js` y una línea más en ese trigger.
--
-- `registrar_historial_cliente` es la versión viva (db/89) + las dos líneas de `Dirección`.

begin;

alter table public.clientes add column if not exists direccion text;

CREATE OR REPLACE FUNCTION public.registrar_historial_cliente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    if coalesce(new.direccion, '') <> '' then c := c || jsonb_build_object('campo', 'Dirección', 'a', new.direccion); end if;
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
  if new.direccion is distinct from old.direccion then
    c := c || jsonb_build_object('campo', 'Dirección', 'de', old.direccion, 'a', new.direccion); end if;
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
$function$;

notify pgrst, 'reload schema';

commit;
