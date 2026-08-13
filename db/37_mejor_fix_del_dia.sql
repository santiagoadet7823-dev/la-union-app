-- 37 — `ultimo_punto_equipo` devuelve además EL MEJOR FIX DEL DÍA: la señal que detecta un GNSS muerto.
--
-- 🩸 EL TECHO DE 30 m NO SEPARA UN TELÉFONO SANO DE UNO ROTO (12/08/2026, auditoría de GPS).
--
-- `db/36` trajo dos relojes y con eso el panel dejó de mentir sobre quién reporta. Pero se quedó
-- corto para el otro hallazgo: el estado `sin-gps-confiable` dispara cuando los puntos recientes
-- superan los 30 m, y **los tres teléfonos rotos del informe §3 H2 no lo superan** — se ubican a
-- 15-25 m, que pasa cómodo. Se veían sanos igual.
--
-- La vara que sí los separa es **el mejor fix del día**, y es limpia por construcción: subir o bajar
-- un techo de captura filtra los fixes malos, pero **no puede mejorar el mínimo**. Es inmune al
-- cambio de `ACCURACY_CAPTURA_MAX_M` que contaminó todas las medianas del 11/08 en adelante.
--
-- Medido sobre los 8 días de retención (mejor fix del día · % de fixes ≤ 5 m):
--
--   SANOS   Orlando 0,8 m · 94 %    Agustin 0,8 m · 98 %    Emanuel 3,0 m · 61 %
--           Luis    1,1 m · 56 %    Javier  1,3 m ·  8 %  ← engancha, pero se le APAGA
--   ROTOS   Gabriel 5,8 m ·  0 %    Alejandro 9,6 m · 0 %   Zura 10,3 m · 0 %
--           Nelson 15,7 m · 0 %  ← y el 07/08 tenía 1,4 m y 83 %: se degradó
--
-- **Zura, Alejandro y Gabriel no produjeron UN SOLO fix de ≤ 5 m en 8 días**, sobre miles de puntos.
-- Un GNSS que funciona consigue 3-5 m en la calle sin esfuerzo; cero es un chip que no posiciona.
--
-- El corte va en 8 m: los sanos llegan a 0,8-3,0 y los rotos arrancan en 9,6. Y se exige una MUESTRA
-- mínima antes de acusar, porque un teléfono recién prendido todavía no enganchó y no por eso está
-- roto — el umbral de puntos lo aplica el front (ver `useDiagnosticoEquipo`), no esta función: acá
-- solo se mide.

-- ⚠️ DROP obligatorio: `create or replace` NO puede cambiar el tipo de retorno de una función
-- («cannot change return type of existing function»), y acá se agregan dos columnas al RETURNS
-- TABLE. Y como el DROP se lleva puesto el ACL, los grants de abajo dejan de ser una formalidad:
-- sin ellos la RPC queda sin `authenticated` y el panel deja de poder llamarla.
drop function if exists public.ultimo_punto_equipo(uuid, timestamptz);

create function public.ultimo_punto_equipo(
  p_empresa uuid,
  p_desde   timestamptz
)
returns table(
  id_usuario           uuid,
  ultimo_ts            timestamptz,
  ultimo_ts_confiable  timestamptz,
  puntos               integer,
  puntos_confiables    integer,
  mejor_accuracy       real,      -- el mejor fix del día: la vara que detecta un GNSS muerto
  puntos_sub5          integer    -- cuántas veces llegó a precisión de GPS real
)
language sql
stable
set search_path to 'public'
as $function$
  select
    p.id_usuario,
    max(p.ts),
    -- = gpsConfig.ACCURACY_MAX_M (30). Si se mueve, se mueven todos (regla 18-bis):
    -- gpsConfig.js, segmentar.ts, db/28, db/33 y ésta.
    max(p.ts) filter (where p.accuracy is null or p.accuracy <= 30),
    count(*)::int,
    count(*) filter (where p.accuracy is null or p.accuracy <= 30)::int,
    min(p.accuracy),
    count(*) filter (where p.accuracy <= 5)::int
  from posiciones p
  where (p_empresa is null or p.id_empresa = p_empresa)
    and p.id_usuario is not null
    and p.ts >= p_desde
  group by p.id_usuario;
$function$;

-- Regla 7 + 7-bis: los TRES revokes y el grant explícito de vuelta.
revoke execute on function public.ultimo_punto_equipo(uuid, timestamptz) from public;
revoke execute on function public.ultimo_punto_equipo(uuid, timestamptz) from anon;
grant  execute on function public.ultimo_punto_equipo(uuid, timestamptz) to authenticated;
grant  execute on function public.ultimo_punto_equipo(uuid, timestamptz) to service_role;
