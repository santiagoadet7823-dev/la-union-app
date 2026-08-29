-- 52_sello_precios.sql — el sello que le dice al teléfono si vale la pena recargar (29/08/2026).
--
-- QUÉ RESUELVE. Desde hoy el ERP manda la lista de precios VARIAS VECES POR DÍA (la distribuidora
-- corrige precios a media mañana y a la tarde). Eso no servía de nada: `CatalogContext.recargar()`
-- corre una sola vez, al montar, así que el vendedor que abrió la app a las 8 tenía el catálogo
-- congelado toda la jornada y cobraba el precio de las 6 con el comerciante enfrente.
--
-- El teléfono ahora pregunta un SELLO —cuándo entró la última lista— y sólo si cambió paga la
-- recarga completa (`fetchCatalogo` baja 529 productos y 2.014 clientes, paginando). Tres envíos
-- por día = tres recargas, en vez de una cada veinte minutos a datos móviles del empleado. Es la
-- regla 48: antes de automatizar una descarga, calcular MB × repeticiones × teléfonos.
--
-- 🔴 POR QUÉ UNA RPC Y NO LEER `ingestas_precios` DIRECTO — encontrado ANTES de publicar.
-- La policy `ingestas_precios_sel` (db/48) da SELECT a `admin`, `encargado`, `marketing` y a quien
-- tenga el permiso `catalogo`. **`vendedor` NO está en esa lista.** O sea que la primera versión de
-- esto, que consultaba la tabla desde el cliente, devolvía CERO FILAS justo para las nueve personas
-- que necesitan el refresco — y sin error: `data` vacío, sello `null`, el catálogo nunca se
-- recarga. Habría fallado en silencio y en producción, que es la firma de esta clase de bug.
--
-- Ampliar la policy también servía, pero expondría los conteos, los rechazos y el texto de error de
-- cada corrida a los nueve teléfonos. Esta función devuelve **un timestamp y nada más**: es la
-- superficie mínima que contesta la pregunta.
--
-- La empresa sale de `mi_empresa()`, NUNCA de un parámetro (es SECURITY DEFINER: un parámetro
-- dejaría preguntar por cualquier distribuidora; ver el encabezado de db/44).

create or replace function public.sello_precios()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  select max(ts) from public.ingestas_precios where id_empresa = (select mi_empresa());
$function$;

comment on function public.sello_precios() is
  'Cuándo entró la última lista de precios de MI empresa. Un timestamp y nada más: lo consulta el '
  'teléfono cada tanto para decidir si recarga el catálogo, sin bajar 2.500 filas para averiguarlo.';

-- 🚨 Regla 7 + 7-bis: revocar de los TRES y recién después el grant que corresponde.
-- Supabase concede EXECUTE explícito a anon y authenticated sobre cada función nueva de `public` vía
-- ALTER DEFAULT PRIVILEGES, y un grant explícito NO se va con un revoke a PUBLIC.
revoke execute on function public.sello_precios() from public;
revoke execute on function public.sello_precios() from anon;
revoke execute on function public.sello_precios() from authenticated;
-- La llama el vendedor desde el teléfono, y el recorte por empresa está adentro.
grant execute on function public.sello_precios() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación (correr a mano después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
--   select proname, proacl from pg_proc
--    where pronamespace='public'::regnamespace and proname='sello_precios';
--   -- esperado: `authenticated=X` SÍ, `anon=X` NO. Mirar el ACL real, no asumir.
--
--   -- Y lo que de verdad importa: que un VENDEDOR la pueda ejecutar (era el bug).
--   select has_function_privilege('authenticated', 'public.sello_precios()', 'execute');
