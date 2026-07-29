-- 25 · Alcance por empresa en Storage (29/07/2026)
--
-- ⚠️ Ya APLICADA en la base viva. Este archivo es historia, no fuente de verdad (regla 5).
--
-- 🔴 EL AGUJERO QUE CIERRA. Las tres policies de escritura de `storage.objects` eran
-- `to authenticated` y lo único que chequeaban era el `bucket_id`:
--
--     productos_avatares_del  DELETE  bucket_id in ('productos','avatares')
--     productos_avatares_upd  UPDATE  idem
--     productos_avatares_ins  INSERT  idem
--
-- O sea que CUALQUIER usuario logueado de CUALQUIER empresa podía borrar o pisar las fotos de
-- otra. Con dos empresas en la base y 626 fotos de productos cargadas, era un borrado masivo a un
-- request de distancia; lo único que lo evitaba era que la interfaz no ofreciera el botón. Eso no
-- es una defensa: la API de Storage es pública y la anon key vive en el bundle.
--
-- Se cerró SIN MOVER UN SOLO ARCHIVO, porque la ruta ya trae al dueño adentro (medido antes de
-- aplicar: 626 de 626 objetos de `productos` tienen carpeta, y es el UUID de la empresa):
--
--     productos → '{id_empresa}/{id_producto}.webp'   (services/data/productoImagen.js:109)
--     avatares  → '{id_usuario}.webp'                 (services/data/productoImagen.js:114)
--
-- 🩸 EL SELECT NO SE TOCA, y no es un olvido. Dos motivos, los dos duros:
--   1. Los buckets son PÚBLICOS (la app sirve con getPublicUrl), así que restringir el SELECT de
--      storage.objects no protegería la lectura de nada: solo rompería la app.
--   2. El ON CONFLICT del upsert NECESITA SELECT. Sin él ninguna subida funciona — ese bug ya se
--      pagó una vez ("new row violates RLS" con INSERT y UPDATE correctamente escritos).
--
-- VERIFICADO en las DOS direcciones antes de dar esto por bueno (probar solo que el legítimo puede
-- no prueba nada). Simulando sesión con set_config dentro de begin/rollback:
--     vendedor de otra empresa → foto de LA UNIÓN ......... false
--     vendedor de otra empresa → avatar ajeno ............. false
--     vendedor de otra empresa → su propia empresa ........ true
--     admin de LA UNIÓN        → foto de LA UNIÓN ......... true
--     admin de LA UNIÓN        → avatar de otro ........... false
--     dueño del avatar         → su propio avatar ......... true
--
-- NOTA: no se puede probar con un DELETE real desde SQL — `storage.protect_delete()` lo bloquea
-- ("Direct deletion from storage tables is not allowed"). Por eso se evalúa el predicado exacto
-- que usa la policy, bajo cada identidad simulada.

drop policy if exists productos_avatares_ins on storage.objects;
drop policy if exists productos_avatares_upd on storage.objects;
drop policy if exists productos_avatares_del on storage.objects;

-- Dueño legítimo del objeto: su empresa (productos) o él mismo (avatares). El superadmin pasa
-- siempre, que es quien opera sobre otro tenant a propósito.
create or replace function public.puede_escribir_objeto(p_bucket text, p_name text)
returns boolean language sql stable security definer set search_path = public, storage
as $$
  select case
    when public.es_superadmin() then true
    when p_bucket = 'productos' then (storage.foldername(p_name))[1] = public.mi_empresa()::text
    when p_bucket = 'avatares'  then split_part(p_name, '.', 1) = auth.uid()::text
    else false
  end
$$;

-- Regla 7: se revoca de PUBLIC, nunca de anon/authenticated (que lo heredan; revocarles es no-op).
-- Regla 8: esta función queda en la MISMA familia que mi_empresa/mi_rol/es_superadmin — las
-- policies la invocan como el rol que consulta, así que NUNCA revocarle EXECUTE a authenticated.
revoke execute on function public.puede_escribir_objeto(text, text) from public;
grant execute on function public.puede_escribir_objeto(text, text) to authenticated;

create policy productos_avatares_ins on storage.objects
  for insert to authenticated
  with check (bucket_id = any (array['productos','avatares']) and public.puede_escribir_objeto(bucket_id, name));

create policy productos_avatares_upd on storage.objects
  for update to authenticated
  using      (bucket_id = any (array['productos','avatares']) and public.puede_escribir_objeto(bucket_id, name))
  with check (bucket_id = any (array['productos','avatares']) and public.puede_escribir_objeto(bucket_id, name));

create policy productos_avatares_del on storage.objects
  for delete to authenticated
  using (bucket_id = any (array['productos','avatares']) and public.puede_escribir_objeto(bucket_id, name));
