-- 44_sugeridos_por_cliente.sql — "Lo que más lleva este cliente" (19/08/2026).
--
-- QUÉ RESUELVE. El vendedor entra a un comercio y tiene 529 productos en una grilla. Lo que ese
-- comercio compra siempre está en algún lugar de esa lista y hay que acordárselo o buscarlo. Desde
-- que los pedidos se guardan (`db/43`) esa memoria la puede tener la app.
--
-- ⚠️ NO DA RESULTADOS EL DÍA 1, Y ESO NO ES UN BUG. Con `pedido_items` vacía esta función devuelve
-- cero filas hasta que haya semanas de uso real. Se construye ahora porque el DATO hay que empezar
-- a guardarlo ya; la pantalla no muestra nada hasta que hay historial suficiente.
--
-- POR QUÉ EN SQL Y NO EN EL CLIENTE. El teléfono tiene el catálogo, no el historial de pedidos:
-- traerse todos los pedidos de un comercio para contarlos en JS serían cientos de filas por cada
-- check-in, con el vendedor en la calle y a datos móviles. Acá vuelven ~8 filas.
--
-- 🔴 DEVUELVE IDS Y PUNTAJE. Nada de costo, margen ni nivel de rentabilidad — el orden que sale de
-- acá termina, por el camino de `snapshotCatalogo`, en la tablet que mira el CLIENTE. La frontera
-- de privacidad de la vidriera vale igual acá.

create or replace function public.productos_sugeridos_cliente(
  p_id_cliente uuid,
  p_limite int default 8
)
returns table (id_producto uuid, veces bigint, unidades bigint, puntaje numeric)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    pi.id_producto,
    count(distinct p.id)      as veces,
    sum(pi.cantidad)::bigint  as unidades,
    -- FRECUENCIA × RECENCIA. Un producto pedido 5 veces el mes pasado vale más que uno pedido 6
    -- veces hace un año: sin el decaimiento, el ranking se congela en lo que el comercio compraba
    -- cuando arrancó y deja de reflejar lo que compra hoy.
    -- El medio-vida son 90 días: a los 3 meses un pedido pesa la mitad. Es la escala del negocio
    -- (visita quincenal o mensual), no un número lindo.
    round(sum(power(0.5, extract(epoch from (now() - p.created_at)) / (90 * 86400)))::numeric, 4) as puntaje
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.id_pedido
  where p.id_cliente = p_id_cliente
    -- El alcance de empresa NO puede salir del parámetro: se toma de la sesión. Si viniera de
    -- afuera, cualquiera podría pedir el historial de un comercio de otra distribuidora pasando
    -- su uuid — y esta función es SECURITY DEFINER, así que RLS no la frena.
    and p.id_empresa = (select mi_empresa())
    -- Un pedido anulado no es una preferencia: es un error de carga.
    and p.estado <> 'Anulado'
    and pi.id_producto is not null
    -- Más de dos años atrás no dice nada del comercio de hoy, y además la retención de la base no
    -- llega tan lejos para casi nada.
    and p.created_at > now() - interval '2 years'
  group by pi.id_producto
  -- Con UN solo pedido histórico no hay preferencia que mostrar: hay una compra. Recomendar sobre
  -- esa base es ruido, y el ruido quema la confianza en la función más rápido que el silencio.
  having count(distinct p.id) >= 2
  order by puntaje desc, unidades desc
  limit greatest(1, least(coalesce(p_limite, 8), 30));
$function$;

comment on function public.productos_sugeridos_cliente(uuid, int) is
  'Productos que más lleva un comercio, ponderando frecuencia por recencia (medio-vida 90 días). '
  'El alcance de empresa sale de mi_empresa(), NUNCA de un parámetro. Devuelve solo ids y puntaje: '
  'nada de costo ni rentabilidad, porque este orden termina en la tablet que mira el cliente.';

-- 🚨 Regla 7 + 7-bis: revocar de los TRES y recién después dar el grant que corresponde.
-- Supabase concede EXECUTE explícito a anon y authenticated sobre cada función nueva de `public`
-- vía ALTER DEFAULT PRIVILEGES, y un grant explícito NO se va con un revoke a PUBLIC. Esto ya
-- expuso una vez el plantel completo de todos los tenants (`vigilancia_equipo`, 30/07/2026).
revoke execute on function public.productos_sugeridos_cliente(uuid, int) from public;
revoke execute on function public.productos_sugeridos_cliente(uuid, int) from anon;
revoke execute on function public.productos_sugeridos_cliente(uuid, int) from authenticated;
-- Ahora sí: la llama el vendedor desde el teléfono, y el recorte por empresa está adentro.
grant execute on function public.productos_sugeridos_cliente(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación (correr a mano después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
--   select proname, proacl from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'productos_sugeridos_cliente';
--   -- esperado: `authenticated=X` SÍ, `anon=X` NO. Mirar el ACL real, no asumir.
--
--   select * from public.productos_sugeridos_cliente('<uuid de un cliente>', 8);
--   -- hoy devuelve 0 filas: `pedido_items` está vacía. Volver a correrlo con historial.
