-- 28 · La burbuja en vivo se queda con el GPS (1.9.0, 03/08/2026)
--
-- ⚠️ Este archivo es el REGISTRO de una migración YA APLICADA en la base viva, no la fuente de
-- verdad (regla 5). Está acá para que el porqué no se pierda; para saber cómo está la base hoy,
-- consultarla.
--
-- QUÉ CAMBIA Y POR QUÉ
--
-- Desde 1.9.0 el teléfono, cuando el GPS se calla más de 90 s (`SILENCIO_MS`), pide ubicación por
-- antenas y WiFi para no dejar el hueco vacío. Esos puntos entran a `posiciones` con `accuracy` de
-- 20 a 150 m. Hasta 1.8.1 NO EXISTÍA en la tabla un solo punto con accuracy > 30, porque el uploader
-- nativo los descartaba — por eso la precisión alcanza como marca y no hizo falta una columna nueva.
--
-- `ultimas_posiciones` alimenta la burbuja del equipo en el mapa. Sin este filtro, un punto
-- triangulado la movería hasta 150 m SIN QUE SE NOTE: la burbuja no tiene forma de decir "esto es
-- aproximado", así que un salto de una cuadra se leería como que la persona se movió. Entre una
-- posición exacta y vieja —que además deja ver el "sin señal", que es justo lo que el supervisor
-- necesita saber— y una aproximada disfrazada de exacta, gana la primera.
--
-- Los puntos triangulados NO se pierden ni se ocultan: se dibujan PUNTEADOS en el recorrido del día
-- (`lib/geo.limpiarTrazo` → `aproximados` → `features/supervision/trazos.js`), donde se ve solo que
-- son otra cosa. Y quedan fuera de los km y fuera del snap.
--
-- GRANTS: `create or replace` conserva el ACL de la función. La regla 7-bis (revocar de los TRES:
-- public, anon, authenticated) aplica a funciones NUEVAS, porque el `alter default privileges` de
-- Supabase les da EXECUTE explícito al crearlas. Esta ya existía, así que no hay grants que rehacer.
-- Verificado después de aplicar: el `proacl` quedó idéntico al de antes.

create or replace function public.ultimas_posiciones(p_empresa uuid)
returns table(id_usuario uuid, rol text, lat double precision, lng double precision, ts timestamptz)
language sql
stable
set search_path to 'public'
as $function$
  select distinct on (id_usuario) id_usuario, rol, lat, lng, ts
  from public.posiciones
  where id_empresa = p_empresa
    and id_usuario is not null
    and (accuracy is null or accuracy <= 30)  -- = gpsConfig.ACCURACY_MAX_M: arriba de eso es triangulado
  order by id_usuario, ts desc
$function$;
