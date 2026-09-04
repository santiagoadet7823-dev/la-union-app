-- 57_panel_vendedor.sql — el tablero del vendedor: qué vende, qué no, y a quién dejó de ver.
-- (04/09/2026, corrección sobre 1.24.0.)
--
-- QUÉ RESUELVE. "Mis metas" (db/56) salió como siete barras de progreso y el pedido fue "le falta
-- más UI/UX, como si fuera un dashboard: productos que más vendo, productos que nunca vendí".
-- Estas tres funciones son los datos que faltaban. La cuarta cosa que se pidió —comparar contra el
-- mes anterior— NO necesita función nueva: se llama `metricas_venta` (db/56) con el rango del mes
-- pasado y se compara con `lib/comparar.js`, que ya existe.
--
-- 🔑 "PRODUCTOS QUE NUNCA VENDÍ" SE RESUELVE COMO OPORTUNIDAD, NO COMO INVENTARIO. La lectura
-- literal —el catálogo menos lo que vendí— da ~400 filas para cualquier vendedor y no se puede
-- accionar: nadie lee esa lista. Lo que sí se acciona son los productos que **el resto del equipo
-- sí vende** y esta persona nunca vendió: eso es plata que está pasando por al lado, sale del mismo
-- dato, y entra en una pantalla.
--
-- 🔴 EL ALCANCE SALE DE `ids_a_mi_cargo()` ADENTRO DE CADA FUNCIÓN, NUNCA DEL PARÁMETRO. Son
-- SECURITY DEFINER: aceptar cualquier `p_id_usuario` dejaría a un vendedor pedir las ventas de un
-- compañero —o de otra distribuidora— con un fetch a mano. Es el mismo criterio del encabezado de
-- db/44 y de `metricas_venta`.
--
-- ⚠️ ADVERTENCIA DE DATOS, QUE VALE MÁS QUE EL CÓDIGO: al 04/09/2026 hay **6 pedidos en toda la
-- base** y los pedidos se empezaron a guardar el 19/08. Estas tres funciones van a devolver vacío o
-- casi vacío durante semanas. Eso NO es un bug, y la pantalla tiene que decirlo con palabras en vez
-- de dibujar un cero — un cero se lee como "no vendiste nada".

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Qué vende esta persona
-- ─────────────────────────────────────────────────────────────────────────────
-- Devuelve una fila por producto con unidades, monto y en cuántos pedidos apareció. La mezcla por
-- categoría/marca se arma en el cliente agrupando esto: son ~100 filas y agrupar en JS evita una
-- segunda función que tendría que repetir exactamente los mismos filtros (y quedarse desfasada).
create or replace function public.productos_del_vendedor(
  p_id_usuario uuid,
  p_desde date,
  p_hasta date
)
returns table (
  id_producto uuid,
  descripcion text,
  categoria   text,
  marca       text,
  unidades    bigint,
  monto       numeric,
  pedidos     bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := (select mi_empresa());
  v_desde   timestamptz := (p_desde::text || ' 00:00:00')::timestamp at time zone 'America/Argentina/Salta';
  v_hasta   timestamptz := ((p_hasta + 1)::text || ' 00:00:00')::timestamp at time zone 'America/Argentina/Salta';
begin
  if p_id_usuario is null or p_id_usuario not in (select ids_a_mi_cargo()) then
    raise exception 'Sin permiso para ver las metricas de esa persona';
  end if;
  if p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango invalido';
  end if;

  return query
  select
    pi.id_producto,
    -- La descripción sale de la LÍNEA y no del catálogo: es la que se vendió. Si marketing renombró
    -- el producto, el tablero tiene que seguir diciendo lo que el vendedor recuerda haber vendido.
    max(pi.descripcion)                       as descripcion,
    max(pr.categoria)                         as categoria,
    max(pr.marca)                             as marca,
    sum(pi.cantidad)::bigint                  as unidades,
    sum(pi.cantidad * pi.precio_unitario)::numeric as monto,
    count(distinct p.id)::bigint              as pedidos
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.id_pedido
  left join public.productos pr on pr.id = pi.id_producto
  where p.id_empresa = v_empresa
    and p.id_vendedor = p_id_usuario
    and p.created_at >= v_desde
    and p.created_at <  v_hasta
    and p.estado <> 'Anulado'
    and pi.id_producto is not null
  group by pi.id_producto
  order by monto desc, unidades desc;
end;
$function$;

comment on function public.productos_del_vendedor(uuid, date, date) is
  'Que vendio una persona en un rango, por producto: unidades, monto y en cuantos pedidos aparecio. '
  'La descripcion sale de la LINEA (lo que se vendio), no del catalogo actual.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lo que el equipo vende y esta persona no
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.oportunidades_vendedor(
  p_id_usuario uuid,
  p_limite integer default 10
)
returns table (
  id_producto  uuid,
  descripcion  text,
  categoria    text,
  vendedores   bigint,
  unidades     bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := (select mi_empresa());
  -- Ventana fija de 90 días: lo que el equipo vendió el año pasado no es una oportunidad de hoy, y
  -- el catálogo cambia. Se elige acá y no como parámetro para que la pregunta sea siempre la misma.
  v_desde timestamptz := now() - interval '90 days';
begin
  if p_id_usuario is null or p_id_usuario not in (select ids_a_mi_cargo()) then
    raise exception 'Sin permiso para ver las metricas de esa persona';
  end if;

  return query
  with mios as (
    -- TODO lo que esta persona vendió alguna vez, sin ventana: si lo vendió hace ocho meses no es
    -- un producto que "nunca vendió", y ofrecérselo como novedad haría que la lista pierda sentido.
    select distinct pi.id_producto
      from public.pedido_items pi
      join public.pedidos p on p.id = pi.id_pedido
     where p.id_empresa = v_empresa
       and p.id_vendedor = p_id_usuario
       and p.estado <> 'Anulado'
  )
  select
    pi.id_producto,
    max(pi.descripcion)                          as descripcion,
    max(pr.categoria)                            as categoria,
    -- Cuántos COMPAÑEROS lo venden. Es el dato que convence: "lo venden otros cuatro" pesa más que
    -- un total de unidades que no se sabe de dónde sale.
    count(distinct p.id_vendedor)::bigint        as vendedores,
    sum(pi.cantidad)::bigint                     as unidades
  from public.pedido_items pi
  join public.pedidos p on p.id = pi.id_pedido
  left join public.productos pr on pr.id = pi.id_producto
  where p.id_empresa = v_empresa
    and p.id_vendedor is distinct from p_id_usuario
    and p.created_at >= v_desde
    and p.estado <> 'Anulado'
    and pi.id_producto is not null
    and pi.id_producto not in (select id_producto from mios)
    -- Sólo lo que se puede vender hoy: un producto descontinuado no es una oportunidad.
    and pr.id is not null
    and pr.descontinuado_ts is null
  group by pi.id_producto
  order by vendedores desc, unidades desc
  limit greatest(1, least(coalesce(p_limite, 10), 30));
end;
$function$;

comment on function public.oportunidades_vendedor(uuid, integer) is
  'Productos que el RESTO del equipo vendio en los ultimos 90 dias y esta persona nunca vendio. Es '
  '"lo que nunca vendi" en version accionable: el catalogo entero menos lo mio son ~400 filas que '
  'nadie lee.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Clientes que le compraban y dejaron de comprarle
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.clientes_dormidos(
  p_id_usuario uuid,
  p_dias integer default 30,
  p_limite integer default 20
)
returns table (
  id_cliente      uuid,
  nombre          text,
  localidad       text,
  ultima_compra   timestamptz,
  dias_sin_comprar integer,
  compras         bigint,
  monto_historico numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := (select mi_empresa());
begin
  if p_id_usuario is null or p_id_usuario not in (select ids_a_mi_cargo()) then
    raise exception 'Sin permiso para ver las metricas de esa persona';
  end if;

  return query
  with compras as (
    select p.id_cliente,
           max(p.created_at)      as ultima,
           count(*)::bigint       as veces,
           sum(p.monto_total)     as total
      from public.pedidos p
     where p.id_empresa = v_empresa
       and p.id_vendedor = p_id_usuario
       and p.estado <> 'Anulado'
       and p.id_cliente is not null
     group by p.id_cliente
  )
  select
    c.id_cliente,
    max(cl.nombre_comercio)                                          as nombre,
    max(cl.localidad)                                                as localidad,
    c.ultima                                                         as ultima_compra,
    (extract(day from (now() - c.ultima)))::integer                  as dias_sin_comprar,
    c.veces                                                          as compras,
    c.total                                                          as monto_historico
  from compras c
  join public.clientes cl on cl.id = c.id_cliente
  where c.ultima < now() - make_interval(days => greatest(1, coalesce(p_dias, 30)))
    -- Un comercio dado de baja no es un cliente que se perdió: es uno que ya no existe.
    and coalesce(cl.activo, true)
  group by c.id_cliente, c.ultima, c.veces, c.total
  -- Primero los que más plata dejaban: si la lista se corta, que se corte por abajo.
  order by c.total desc nulls last, c.ultima asc
  limit greatest(1, least(coalesce(p_limite, 20), 50));
end;
$function$;

comment on function public.clientes_dormidos(uuid, integer, integer) is
  'Comercios que le compraban a esta persona y hace mas de N dias que no. Ordenados por lo que '
  'dejaban, no por antiguedad: si la lista se corta, que se corte por abajo.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 🚨 Permisos — regla 7 + 7-bis: revocar de los TRES y recién después el grant
-- ─────────────────────────────────────────────────────────────────────────────
-- Supabase le da EXECUTE explícito a `anon` y `authenticated` a cada función nueva de `public` vía
-- ALTER DEFAULT PRIVILEGES, y un grant explícito NO se va con un revoke a PUBLIC.
revoke execute on function public.productos_del_vendedor(uuid, date, date) from public;
revoke execute on function public.productos_del_vendedor(uuid, date, date) from anon;
revoke execute on function public.productos_del_vendedor(uuid, date, date) from authenticated;
grant  execute on function public.productos_del_vendedor(uuid, date, date) to authenticated;

revoke execute on function public.oportunidades_vendedor(uuid, integer) from public;
revoke execute on function public.oportunidades_vendedor(uuid, integer) from anon;
revoke execute on function public.oportunidades_vendedor(uuid, integer) from authenticated;
grant  execute on function public.oportunidades_vendedor(uuid, integer) to authenticated;

revoke execute on function public.clientes_dormidos(uuid, integer, integer) from public;
revoke execute on function public.clientes_dormidos(uuid, integer, integer) from anon;
revoke execute on function public.clientes_dormidos(uuid, integer, integer) from authenticated;
grant  execute on function public.clientes_dormidos(uuid, integer, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación (correr a mano después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
--   select proname, proacl::text from pg_proc
--    where pronamespace='public'::regnamespace
--      and proname in ('productos_del_vendedor','oportunidades_vendedor','clientes_dormidos');
--   -- esperado en las tres: `authenticated=X` SÍ, `anon=X` NO. Mirar el ACL real (regla 7-bis).
--
--   -- 🔴 Y la prueba que importa: que NO dejen espiar. Con la sesión de un vendedor, pedir los
--   -- datos de un compañero tiene que tirar excepción, no devolver filas vacías:
--   --   select * from productos_del_vendedor('<uuid de otro>', current_date - 30, current_date);
