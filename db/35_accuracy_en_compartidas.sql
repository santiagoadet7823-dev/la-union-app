-- 35 — `ultimas_posiciones_compartidas` también filtra los puntos TRIANGULADOS.
--
-- 🩸 EL CUARTO ESPEJO QUE FALTABA (12/08/2026, auditoría de GPS).
--
-- La regla 40 dice que un punto triangulado por antenas/WiFi "vale para decir «por acá anduvo» y
-- para nada más": va punteado, fuera de los km, fuera del snap y **fuera de la burbuja en vivo**.
-- Ese último pedazo se implementó en `db/28` sobre `ultimas_posiciones`, y en `db/33` sobre
-- `metricas_actividad` y `vigilancia_equipo` — pero `ultimas_posiciones_compartidas` **nació
-- después y nunca lo recibió**. Verificado contra la base viva: era la única de las cuatro RPC que
-- ni siquiera menciona `accuracy`.
--
-- Hoy no muerde porque `ubicaciones_compartidas` tiene 0 filas y la función no devuelve nada. Por
-- eso se arregla AHORA: el día que se prenda la función de compartir ubicación entre empresas, el
-- pin de una persona podría aparecer a ±120 m de donde está, y en la pantalla donde MENOS se puede
-- explicar el error — la de un tercero mirando a alguien que no es suyo.
--
-- El umbral es el mismo 30 de `gpsConfig.ACCURACY_MAX_M`, escrito a mano por cuarta vez porque la
-- cuenta se hace en SQL. ⚠️ Si alguna vez se mueve ese número, se mueven los CUATRO (ver la regla
-- 18-bis de CLAUDE.md): `gpsConfig.js`, `segmentar.ts`, y las RPC de `db/28`, `db/33` y ésta.
--
-- ⚠️ `CREATE OR REPLACE` CONSERVA el ACL existente, que ya estaba bien cerrado
-- (`{postgres, authenticated, service_role}` — sin PUBLIC y sin anon). Los revokes de abajo se
-- re-afirman igual por la regla 7-bis: Supabase tiene un ALTER DEFAULT PRIVILEGES que le da EXECUTE
-- explícito a anon y authenticated, y un grant explícito NO se va con un revoke a PUBLIC. Se
-- verifica el `proacl` real al final, nunca se asume.

create or replace function public.ultimas_posiciones_compartidas()
returns table(
  id_usuario uuid, nombre text, rol text,
  lat double precision, lng double precision, ts timestamp with time zone
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with permitidos as (
    select c.id_usuario
    from ubicaciones_compartidas c
    where c.id_empresa_destino = (select mi_empresa())
      and c.activo
      and (c.hasta is null or now() < c.hasta)
  )
  select distinct on (p.id_usuario)
    p.id_usuario, pe.nombre, p.rol, p.lat, p.lng, p.ts
  from posiciones p
  join permitidos pm on pm.id_usuario = p.id_usuario
  left join perfiles pe on pe.id = p.id_usuario
  where p.ts > now() - interval '24 hours'
    -- = gpsConfig.ACCURACY_MAX_M: arriba de eso es triangulado y no ubica a nadie (regla 40).
    -- Va en el WHERE y no en el ORDER BY a propósito: así el `distinct on` se queda con el último
    -- punto CONFIABLE, no con el último punto a secas.
    and (p.accuracy is null or p.accuracy <= 30)
  order by p.id_usuario, p.ts desc;
$function$;

-- Regla 7 + 7-bis: los TRES revokes, y el grant explícito de vuelta a quien lo necesita.
-- Esta RPC la llama el cliente logueado, así que `authenticated` SÍ va.
revoke execute on function public.ultimas_posiciones_compartidas() from public;
revoke execute on function public.ultimas_posiciones_compartidas() from anon;
grant  execute on function public.ultimas_posiciones_compartidas() to authenticated;
grant  execute on function public.ultimas_posiciones_compartidas() to service_role;

-- Verificación (no asumir — regla 7-bis):
--   select proacl from pg_proc where proname = 'ultimas_posiciones_compartidas';
--   esperado: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--   NO puede aparecer ni `=X` (PUBLIC) ni `anon=X`.
