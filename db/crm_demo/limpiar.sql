-- Borra TODA la demostración del CRM (plan 41, paso 6: antes de la puesta en marcha).
-- Mensajes y tickets se van en cascada con la conversación; después, los contactos que quedaron
-- sin ninguna conversación (solo los ficticios 549387000000x). No toca nada que no sea demo.
-- ⚠ Archivos: Storage no deja borrar `storage.objects` por SQL (`storage.protect_delete`). Si en la
-- demo se mandaron imágenes o audios, ANTES de esto listar las rutas con
--   select media_path from public.crm_mensajes m join public.crm_conversaciones c on c.id = m.id_conversacion
--    where c.demo and m.media_path is not null;
-- y borrarlas por la API de Storage (bucket `crm-media`) con la service_role.
begin;
delete from public.crm_conversaciones where demo;
delete from public.crm_contactos k
 where k.wa_id like '549387000000_'
   and not exists (select 1 from public.crm_conversaciones c where c.id_contacto = k.id);
select (select count(*) from public.crm_conversaciones where demo) as demo_restante,
       (select count(*) from public.crm_contactos where wa_id like '549387000000_') as contactos_ficticios;
commit;
