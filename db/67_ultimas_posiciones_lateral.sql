-- 67 — `ultimas_posiciones` sin recorrer la tabla entera (14/09/2026)
--
-- Aplicada en la base viva el 14/09/2026 (MCP, apply_migration). Misma firma, mismo resultado,
-- mismos permisos (create or replace conserva el ACL). Verificada con explain analyze: 7 ms.
--
-- Por qué. La versión de db/28 hacía `distinct on (id_usuario) … order by id_usuario, ts desc`
-- sobre TODAS las posiciones de la empresa, sin corte temporal: con 45 días de retención son
-- ~900.000 filas por un dato que es "la última de cada persona". Superaba el statement_timeout
-- (8 s) del rol `authenticated` — en los logs del 13/09: dos `POST 500 /rpc/ultimas_posiciones`
-- con "canceling statement due to statement timeout" al montar la supervisión, o sea que las
-- burbujas iniciales del mapa en vivo directamente no cargaban. Y ese costo crece solo con cada
-- día de datos, sin que nadie toque el código (regla 50).
--
-- Ahora se parte de `perfiles` de la empresa (una decena de filas) y por cada uno se pide UN punto
-- por el índice `idx_posiciones_usuario_ts (id_usuario, ts desc)`: `limit 1` sobre el índice ya
-- ordenado, sin ordenar nada. El filtro de precisión (= gpsConfig.ACCURACY_MAX_M, regla 40) y el
-- de empresa se conservan tal cual.
--
-- ⚠️ Cambio de semántica, deliberado: sólo aparecen personas CON PERFIL en la empresa. Antes, un
-- `id_usuario` con posiciones pero sin fila en `perfiles` salía igual — y el front lo descartaba
-- de todos modos, porque sin perfil no hay nombre ni rol que dibujar.

create or replace function public.ultimas_posiciones(p_empresa uuid)
returns table(id_usuario uuid, rol text, lat double precision, lng double precision, ts timestamptz)
language sql
stable
set search_path to 'public'
as $$
  select p.id as id_usuario, x.rol, x.lat, x.lng, x.ts
  from public.perfiles p
  cross join lateral (
    select q.rol, q.lat, q.lng, q.ts
    from public.posiciones q
    where q.id_usuario = p.id
      and q.id_empresa = p_empresa
      and (q.accuracy is null or q.accuracy <= 30)  -- = gpsConfig.ACCURACY_MAX_M: arriba de eso es triangulado
    order by q.ts desc
    limit 1
  ) x
  where p.id_empresa = p_empresa
$$;
