-- 90_ingestas_archivo.sql — copia del archivo de precios TAL CUAL llega del ERP, y de dónde salió
-- (23/10/2026, ampliada el 25/10, plan 23 fase A).
--
-- Hasta hoy `ingest-precios` parseaba el archivo y lo tiraba: de cada envío quedaban sólo los
-- conteos (`ingestas_precios`) y el encabezado recortado (`ingestas_emisor`). El día que hizo falta
-- revisar qué mandó La Unión no había nada que mirar.
--
-- Bucket PRIVADO: no hay policies, así que sólo lo lee `service_role` (la función que escribe y el
-- panel de Supabase, desde donde se descarga). Ruta:
-- `<id_empresa>/<AAAA-MM-DD>/<HH-MM-SS>-<8 primeros del sha256>.csv`, hora de Argentina. El sha en
-- el nombre evita que dos máquinas que mandan en el mismo segundo se pisen (pasó el 08/09).
--
-- Las columnas nuevas de `ingestas_emisor` las llena el agente del cliente con cabeceras `X-…`.
-- Hasta que La Unión instale el agente nuevo (va por ZIP) quedan vacías, salvo `sha256_servidor` y
-- `archivo`, que salen del servidor.

begin;

insert into storage.buckets (id, name, public, file_size_limit)
values ('ingestas-precios', 'ingestas-precios', false, 10485760)
on conflict (id) do nothing;

alter table public.ingestas_emisor
  add column if not exists ruta_origen       text,
  add column if not exists equipo            text,
  add column if not exists version_agente    text,
  add column if not exists modificado_origen timestamptz,
  add column if not exists sha256_cliente    text,
  add column if not exists sha256_servidor   text,
  add column if not exists archivo           text;

comment on column public.ingestas_emisor.ruta_origen is
  'Ruta completa del archivo en la PC que lo mandó (cabecera X-Archivo-Origen). db/90.';
comment on column public.ingestas_emisor.equipo is
  'Nombre de la PC que mandó (X-Equipo, COMPUTERNAME en Windows). db/90.';
comment on column public.ingestas_emisor.modificado_origen is
  'Última modificación del archivo en el origen (X-Archivo-Modificado). Si es vieja, el export del ERP no corrió. db/90.';
comment on column public.ingestas_emisor.sha256_cliente is
  'SHA-256 que calculó el agente antes de mandar. Si no coincide con sha256_servidor, el archivo llegó cortado y se rechaza. db/90.';
comment on column public.ingestas_emisor.sha256_servidor is
  'SHA-256 de los bytes que recibió la función, el mismo del archivo guardado en el bucket. db/90.';
comment on column public.ingestas_emisor.archivo is
  'Ruta dentro del bucket ingestas-precios. Nula si la copia falló o si fue una consulta de config. db/90.';

commit;

-- Verificación:
--   select id, public, file_size_limit from storage.buckets where id = 'ingestas-precios';
--   select ts, resultado, equipo, ruta_origen, sha256_cliente = sha256_servidor as integro, archivo
--     from ingestas_emisor order by ts desc limit 5;
