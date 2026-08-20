-- 46_diagnostico_ota.sql — Poder VER por qué una actualización no llegó. 20/08/2026.
--
-- 🩸 EL DÍA QUE ESTO FALTÓ. El 19/08/2026 se publicó 1.19.0 por los tres canales. El bundle quedó
-- arriba y correcto (verificado bajándolo y abriéndolo: tenía todo el código nuevo), `app_config`
-- apuntando a él, y `push-actualizacion` devolvió **12 enviados · 0 fallidos · 0 tokens muertos**.
-- Al día siguiente los NUEVE equipos seguían reportando `app_version = 1.18.1`, y el pedido que
-- hizo el dueño para probar no se guardó, porque su teléfono estaba corriendo el código viejo.
--
-- Lo grave no fue que no llegara. Fue que **no había forma de saber en cuál de los tres estados
-- estaba cada teléfono**, y los tres se ven idénticos desde el servidor:
--
--   1. la descarga falló (sin cobertura, GitHub caído);
--   2. se descargó bien y espera un arranque en frío — `next()` la aplica ahí, no antes;
--   3. ni siquiera se intentó.
--
-- En los tres, `app_version` sigue diciendo la versión vieja, porque **es una constante compilada
-- adentro del bundle que está corriendo**. Un dato que no puede contradecir al código que lo
-- reporta no sirve para diagnosticar a ese código.
--
-- Las tres columnas de acá las escribe el latido (`useEstadoDispositivo` → `estadoOta()` de
-- `services/ota.js`) y separan los tres casos:
--
--   · `bundle_aplicado` — lo que de verdad está corriendo, según Capgo. `'builtin'` significa que
--     el teléfono está con el bundle que vino adentro del APK y nunca aplicó una OTA.
--   · `bundle_encolado` — se descargó y espera el reinicio. **Este es el caso invisible**, y se
--     borra solo cuando pasa a ser el aplicado.
--   · `ota_error` — el mensaje de la última descarga fallida.
--
-- ⚠️ SON SOLO DE LA APK. En la PWA se omiten (misma regla que `app_version` y `fcm_token` desde el
-- 05/08/2026): omitir deja la columna como estaba, y una PWA que se autoactualiza sola no tiene
-- nada que decir sobre el bundle de un teléfono. "No sé" y "no tiene" son cosas distintas.
--
-- ⚠️ Y ESTAS COLUMNAS SOLO SE LLENAN DESDE 1.20.0. Un equipo en 1.19.0 o anterior las deja en null
-- para siempre — que es exactamente el aviso de que ese equipo tampoco recibió la actualización.

alter table public.estado_dispositivo
  add column if not exists bundle_aplicado text,
  add column if not exists bundle_encolado text,
  add column if not exists ota_error       text;

comment on column public.estado_dispositivo.bundle_aplicado is
  'Bundle OTA realmente en ejecución (Capgo). "builtin" = el que vino en el APK. db/46.';
comment on column public.estado_dispositivo.bundle_encolado is
  'Bundle descargado esperando el próximo arranque en frío. Se limpia al aplicarse. db/46.';
comment on column public.estado_dispositivo.ota_error is
  'Mensaje de la última descarga de OTA que falló. Null si la última salió bien. db/46.';

-- ─────────────────────────────────────────────────────────────────────────────
-- CÓMO SE LEE (la consulta que el 19/08 no se pudo hacer)
-- ─────────────────────────────────────────────────────────────────────────────
--
--   select p.nombre, d.app_version, d.bundle_aplicado, d.bundle_encolado, d.ota_error, d.ts
--     from estado_dispositivo d join perfiles p on p.id = d.id_usuario
--    where d.apk_version is not null
--    order by d.ts desc;
--
--   · `bundle_encolado` con algo    → bajó bien; falta que cierren y abran la app.
--   · `ota_error` con algo          → no bajó; el mensaje dice por qué.
--   · los tres en null y atrasado   → ni lo intentó (o está en una versión anterior a 1.20.0).
--
-- 🔴 Nada de esto hace que la OTA se aplique antes. Una OTA se aplica en el ARRANQUE EN FRÍO y eso
-- no cambió: si el teléfono nunca cierra la app, la actualización espera. Lo que cambia es que
-- ahora se puede DECIR, en vez de suponerlo. La salida para el día de una prueba es el botón
-- "Aplicar ahora" de `UpdatePrompt`.
