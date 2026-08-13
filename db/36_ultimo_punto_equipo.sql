-- 36 — `ultimo_punto_equipo`: saber quién está reportando MIRANDO LAS POSICIONES, no el latido.
--
-- 🩸 EL PANEL MENTÍA, Y MENTÍA JUSTO CON LOS QUE PEOR ANDABAN (12/08/2026, auditoría de GPS).
--
-- `estado_dispositivo` lo escribe el LATIDO DEL JS, que se congela con el WebView en Doze. Las
-- posiciones las sube el SERVICIO NATIVO, que sobrevive. Son dos caminos independientes, y
-- `useDiagnosticoEquipo` leía solo el primero: con `e.ts` de ayer daba "Sin actividad hoy".
--
-- Medido el 12/08 sobre el caso que lo destapó: **Nelson rojas figuraba con último latido el 11/08
-- 00:51 y tenía 1.619 posiciones de ese mismo día.** El panel lo mostraba apagado mientras trabajaba.
--
-- ⚠️ Y NO ALCANZA CON MIRAR "¿llegó un punto?", porque eso taparía el otro hallazgo de la auditoría:
-- hay teléfonos cuyo GNSS no engancha y que se ubican por antenas (Zura, Alejandro y Gabriel no
-- produjeron UN SOLO fix de ≤ 5 m en 8 días). Un equipo que solo entrega basura **llegaría puntual y
-- se vería sano** — es exactamente el modo de falla que advierte la regla 18-bis.
--
-- Por eso se devuelven DOS relojes, y el panel los muestra distinto:
--   · `ultimo_ts`            → cualquier punto. Prueba que **el teléfono nos alcanza** (uplink vivo).
--   · `ultimo_ts_confiable`  → solo ≤ 30 m. Prueba que **el GPS funciona**.
-- Si el primero está fresco y el segundo no, el equipo reporta pero no sabe dónde está: ése es el
-- estado nuevo `sin-gps-confiable`, que es la población de teléfonos rotos del informe §3 H2.
--
-- SECURITY INVOKER a propósito (mismo criterio que `ultimas_posiciones`): la RLS de `posiciones` ya
-- resuelve quién puede leer qué. ⚠️ Pero para el SUPERADMIN la RLS **no** filtra por tenant, así que
-- `p_empresa` no es decorativo — sin él ve el plantel de todas las empresas (regla del scope, y el
-- mismo motivo por el que el hook hace `.eq('id_empresa')` explícito). `p_empresa = null` es el
-- centinela de "todas", y solo el superadmin obtiene algo distinto con él.

create or replace function public.ultimo_punto_equipo(
  p_empresa uuid,
  p_desde   timestamptz
)
returns table(
  id_usuario           uuid,
  ultimo_ts            timestamptz,
  ultimo_ts_confiable  timestamptz,
  puntos               integer,
  puntos_confiables    integer
)
language sql
stable
set search_path to 'public'
as $function$
  select
    p.id_usuario,
    max(p.ts),
    -- = gpsConfig.ACCURACY_MAX_M (30). Quinto lugar donde vive este número; si se mueve, se mueven
    -- todos (regla 18-bis): gpsConfig.js, segmentar.ts, db/28, db/33 y ésta.
    max(p.ts) filter (where p.accuracy is null or p.accuracy <= 30),
    count(*)::int,
    count(*) filter (where p.accuracy is null or p.accuracy <= 30)::int
  from posiciones p
  where (p_empresa is null or p.id_empresa = p_empresa)
    and p.id_usuario is not null
    and p.ts >= p_desde
  group by p.id_usuario;
$function$;

-- Regla 7 + 7-bis: los TRES revokes y el grant explícito de vuelta. La llama el cliente logueado.
revoke execute on function public.ultimo_punto_equipo(uuid, timestamptz) from public;
revoke execute on function public.ultimo_punto_equipo(uuid, timestamptz) from anon;
grant  execute on function public.ultimo_punto_equipo(uuid, timestamptz) to authenticated;
grant  execute on function public.ultimo_punto_equipo(uuid, timestamptz) to service_role;

-- Verificación (no asumir — regla 7-bis):
--   select proacl from pg_proc where proname = 'ultimo_punto_equipo';
--   esperado: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
