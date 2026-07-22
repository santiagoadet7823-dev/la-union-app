-- 08_catalogo_visual.sql
-- ⚠️ DOCUMENTACIÓN. Ya aplicado en la base VIVA (migraciones `catalogo_visual_y_foto_perfil`
-- y `buckets_productos_avatares`, 2026-07-22). NO re-ejecutar a ciegas: los db/*.sql no son
-- la fuente de verdad (ver 00_LEER_PRIMERO.md y CLAUDE.md).
--
-- Contexto: catálogo visual de productos (cuadrícula con foto, unidades, ofertas y marco de
-- color por rentabilidad) + burbuja de perfil en el mapa (foto o iniciales).

-- ---------- productos: columnas nuevas ----------
alter table public.productos add column if not exists imagen_url         text;      -- URL pública en Storage (bucket 'productos')
alter table public.productos add column if not exists unidades           integer;   -- unidades por bulto/pack (ej. ×10)
alter table public.productos add column if not exists nivel_rentabilidad smallint;  -- 1..4, define el color del marco (NO es el margen real)
alter table public.productos add column if not exists oferta             boolean not null default false;
alter table public.productos add column if not exists precio_oferta      numeric(12,2);

-- El costo real NUNCA se guarda: solo un nivel discreto 1..4 → el color no filtra el margen.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'productos_nivel_rentabilidad_chk') then
    alter table public.productos
      add constraint productos_nivel_rentabilidad_chk
      check (nivel_rentabilidad is null or nivel_rentabilidad between 1 and 4);
  end if;
end $$;

-- ---------- perfiles: foto para la burbuja del mapa ----------
alter table public.perfiles add column if not exists foto_url text;  -- fallback = iniciales del nombre

-- ---------- Storage: buckets públicos ----------
-- Las imágenes NO van a Postgres: se guardan en Storage (no cuenta contra la DB) y en la fila
-- solo queda la URL. La URL pública absoluta además es inmune al doble base path del APK.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('productos', 'productos', true, 2097152, array['image/webp','image/jpeg','image/png']),
  ('avatares',  'avatares',  true, 2097152, array['image/webp','image/jpeg','image/png'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lectura pública (bucket public=true). Escritura solo autenticados.
drop policy if exists "productos_avatares_ins" on storage.objects;
create policy "productos_avatares_ins" on storage.objects
  for insert to authenticated with check (bucket_id in ('productos','avatares'));

drop policy if exists "productos_avatares_upd" on storage.objects;
create policy "productos_avatares_upd" on storage.objects
  for update to authenticated
  using (bucket_id in ('productos','avatares')) with check (bucket_id in ('productos','avatares'));

drop policy if exists "productos_avatares_del" on storage.objects;
create policy "productos_avatares_del" on storage.objects
  for delete to authenticated using (bucket_id in ('productos','avatares'));
