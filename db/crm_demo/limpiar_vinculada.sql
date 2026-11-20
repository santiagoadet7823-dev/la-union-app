-- Borra la demo de `cargar_vinculada.sql` (conversación + contacto con "(demo)" en el nombre).
-- 🔴 Correr ANTES de conectar el número de ventas real.
begin;
delete from public.crm_conversaciones c
 using public.crm_contactos k
 where k.id = c.id_contacto and c.demo and k.nombre_perfil like '% (demo)';
delete from public.crm_contactos k
 where k.nombre_perfil like '% (demo)'
   and not exists (select 1 from public.crm_conversaciones c where c.id_contacto = k.id);
select count(*) as quedan from public.crm_contactos where nombre_perfil like '% (demo)';
commit;
