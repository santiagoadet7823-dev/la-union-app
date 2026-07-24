-- 10_storage_select.sql — 24/07/2026
--
-- BUG: NINGUNA subida a Storage funcionó jamás. Cero objetos en los tres buckets desde que
-- existen, y cada POST /object/... devolvía 400 con
--     new row violates row-level security policy for table "objects"
-- Salió a la luz al cargar en masa las 644 fotos del catálogo, pero venía de antes: el alta
-- manual de foto de producto y el avatar de perfil fallaban igual, en silencio (la subida es
-- best-effort: el producto se guardaba sin imagen y nadie lo notaba).
--
-- CAUSA: `productoImagen.js` sube con `upsert: true` para que reemplazar una foto sea
-- idempotente. Eso hace que Storage ejecute `INSERT ... ON CONFLICT DO UPDATE`, y Postgres
-- necesita **leer** la fila en conflicto para resolverlo: sin una policy de SELECT, el
-- ON CONFLICT falla con el error de RLS del INSERT, que despista mal porque las policies de
-- INSERT y UPDATE estaban perfectas. Comprobado en la base viva: el mismo INSERT sin
-- ON CONFLICT pasa, y con ON CONFLICT falla.
--
-- Las policies vivas eran productos_avatares_ins (INSERT), _upd (UPDATE) y _del (DELETE).
-- Faltaba la cuarta.
--
-- Exposición que agrega: ninguna. `productos` y `avatares` son buckets PÚBLICOS — su
-- contenido ya se sirve por CDN a cualquiera que tenga la URL. Esta policy solo habilita a un
-- usuario logueado a leer la fila de metadatos, que es lo que el upsert necesita.
--
-- `firmas` queda afuera a propósito: es un bucket PRIVADO y hoy ningún código lo escribe (no
-- hay consumidores de `from('firmas')` en src/). Si alguna vez se usa, va a chocar con lo
-- mismo, y ahí la policy tiene que ir acotada por empresa, no abierta como esta.

create policy productos_avatares_sel
  on storage.objects
  for select
  to authenticated
  using (bucket_id = any (array['productos'::text, 'avatares'::text]));
