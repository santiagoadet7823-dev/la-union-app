-- 100_clientes_export_direccion_zona.sql — la dirección y la zona viajan al ERP (28/10/2026, plan 31).
--
-- La Unión pidió que `Clientes.txt` traiga la cartera COMPLETA en cada bajada y, además, la
-- dirección (campo 13) y la zona (campo 14). Eso revierte la decisión de db/99 ("la dirección no
-- viaja al ERP"): ahora sí viaja, así que cambiarla tiene que salir como MODIFICACION.
--
-- `cliente_export_control` es la versión viva (db/92) + `direccion` e `id_zona` en la lista de
-- datos que suben `export_version`. Renombrar una zona NO sube la versión de sus clientes: con la
-- base completa en cada archivo, el nombre nuevo igual llega en la próxima bajada.

begin;

CREATE OR REPLACE FUNCTION public.cliente_export_control()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(current_setting('distat.export_bypass', true), '') = 'on' then return new; end if;

  if new.export_enviada     is distinct from old.export_enviada
  or new.exportado_ts       is distinct from old.exportado_ts
  or new.export_lote        is distinct from old.export_lote
  or new.export_ultimo_lote is distinct from old.export_ultimo_lote
  then
    raise exception 'cursor-de-exportacion-no-editable';
  end if;
  new.export_version := old.export_version;

  if new.codigo is distinct from old.codigo then
    if old.exportado_ts is not null then
      raise exception 'cliente-ya-exportado'
        using hint = 'Este cliente ya está en el sistema de gestión con ese código. La corrección se hace allá.';
    end if;
    if exists (select 1 from public.clientes_export_bajas b
                where b.id_empresa = new.id_empresa and b.codigo_norm = public.codigo_norm(new.codigo)
                  and b.export_lote is null) then
      raise exception 'codigo-dado-de-baja-en-erp'
        using hint = 'Ese código lo tuvo un cliente que se borró y su baja todavía no salió al ERP. Probá de nuevo después del próximo envío.';
    end if;
  end if;

  -- Los datos que viajan en `Clientes.txt` (`web/src/lib/asciiClientes.js`). La fecha de alta no:
  -- no se edita. `direccion` e `id_zona` desde db/100 (campos 13 y 14).
  if new.codigo          is distinct from old.codigo
  or new.nombre_comercio is distinct from old.nombre_comercio
  or new.localidad       is distinct from old.localidad
  or new.direccion       is distinct from old.direccion
  or new.id_zona         is distinct from old.id_zona
  or new.telefono        is distinct from old.telefono
  or new.contacto        is distinct from old.contacto
  or new.id_vendedor     is distinct from old.id_vendedor
  or new.lat             is distinct from old.lat
  or new.lng             is distinct from old.lng
  or (new.archivado_ts is null) <> (old.archivado_ts is null)
  then
    new.export_version := old.export_version + 1;
  end if;

  return new;
end $function$;

commit;
