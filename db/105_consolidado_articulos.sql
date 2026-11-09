-- 105_consolidado_articulos.sql — el consolidado de artículos se suma en la base (09/11/2026, plan 43).
--
-- EL PROBLEMA. El consolidado de Gestión → Pedidos (plan 42, 1.45.12) bajaba al teléfono TODOS los
-- renglones de los pedidos de la lista y sumaba allá. Medido sobre 30 días de La Unión: 14 979 renglones,
-- ≈ 7,5 MB, ≈ 50 viajes al servidor uno detrás del otro → con 4G flojo la pantalla parecía tildada.
-- Sumado acá: 2 243 filas vendedor × artículo, 324 kB y 15 ms.
--
-- QUÉ HACE. `consolidado_articulos(p_ids)` recibe los ids de los pedidos que la lista tiene A LA VISTA
-- (rango, personas y filtros los decide la pantalla, como "Exportar para facturar") y devuelve la suma
-- por VENDEDOR × ARTÍCULO. El teléfono la llama un día por vez (varios en paralelo, con barra de
-- progreso) y junta los días (`fusionar` en web/src/features/pedidos/consolidado.js). Por eso cada fila
-- trae la lista de comercios y la hora del renglón más nuevo: los comercios no se pueden sumar entre
-- días (el mismo comercio contaría dos veces) y la descripción que se muestra es la más reciente.
--
-- SECURITY INVOKER, a propósito: la RLS de `pedidos` y `pedido_items` (db/45: el encargado ve a su gente,
-- el admin su empresa) aplica igual que en la lista. Un id que el usuario no puede ver no suma nada. No
-- se copia la regla de alcance acá adentro, así no hay dos verdades que se separen con el tiempo.
--
-- La clave del artículo es la misma de `claveArticulo` (consolidado.js): producto; si falta, código;
-- si falta, descripción. Agrupar por descripción partiría en dos un artículo renombrado.
--
-- jsonb y no `returns table`: PostgREST corta en 1000 filas y devuelve 200 igual (lección de db/93 y 96).
--
-- Sin begin/commit: probar con `begin; \i ...; rollback;` y aplicar con `psql -1 -f`.

create or replace function public.consolidado_articulos(p_ids uuid[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with ped as (
    select p.id, p.id_vendedor, p.id_cliente, p.created_at
    from public.pedidos p
    where p.id = any(p_ids)
      and p.estado <> 'Anulado'
  ),
  ren as (
    select ped.id as id_pedido, ped.id_vendedor, ped.id_cliente, ped.created_at,
           i.id_producto, i.descripcion, i.cantidad, i.cantidad_entregada,
           coalesce(i.precio_unitario, 0) as precio, coalesce(i.peso_kg, 0) as peso,
           coalesce(nullif(btrim(i.codigo_producto), ''), pr.codigo) as codigo,
           coalesce('p:' || i.id_producto::text,
                    'c:' || nullif(btrim(i.codigo_producto), ''),
                    'd:' || upper(btrim(coalesce(i.descripcion, '')))) as clave
    from ped
    join public.pedido_items i on i.id_pedido = ped.id
    left join public.productos pr on pr.id = i.id_producto
  ),
  -- Los comercios del tramo, numerados (ver FORMATO COMPACTO abajo).
  cl as (
    select id_cliente, (row_number() over (order by id_cliente) - 1)::int as n
    from (select distinct id_cliente from ren where id_cliente is not null) x
  ),
  filas as (
    select id_vendedor, clave,
           sum(cantidad)                                                          as pedido,
           coalesce(sum(cantidad) filter (where cantidad_entregada is not null), 0) as rendido,
           -- Lo entregado nunca pasa de lo pedido (mismo criterio que Faltante y que consolidado.js).
           coalesce(sum(least(cantidad, cantidad_entregada)) filter (where cantidad_entregada is not null), 0) as entregado,
           sum(cantidad * precio)                                                 as importe,
           sum(cantidad * peso)                                                   as kg,
           count(distinct id_pedido)                                              as pedidos,
           array_agg(distinct cl.n) filter (where cl.n is not null)               as clientes
    from ren
    left join cl using (id_cliente)
    group by id_vendedor, clave
  ),
  -- Una vez por artículo (no por vendedor): la descripción y el código del renglón más nuevo, con su
  -- hora para elegir el más nuevo al juntar días, y lo del catálogo de hoy (el renglón no lo copia).
  arts as (
    select r.clave,
           (row_number() over (order by r.clave) - 1)::int                                                            as n,
           (array_agg(r.descripcion order by r.created_at desc) filter (where coalesce(r.descripcion, '') <> ''))[1] as descripcion,
           (array_agg(r.codigo order by r.created_at desc) filter (where r.codigo is not null))[1]                   as codigo,
           max(r.created_at) filter (where coalesce(r.descripcion, '') <> '')                                        as ts,
           (array_agg(r.id_producto) filter (where r.id_producto is not null))[1]                                    as id_producto
    from ren r
    group by r.clave
  ),
  vend as (
    select id_vendedor, (row_number() over (order by id_vendedor) - 1)::int as n
    from (select distinct id_vendedor from ren) x
  )
  -- FORMATO COMPACTO (lo lee `fusionar` en consolidado.js). Las filas son arreglos y no objetos, y el
  -- vendedor, el artículo y los comercios van como números que apuntan a las listas de arriba: con
  -- objetos, cada fila repetía dos uuid y seis nombres de campo, y un día cargado pesaba ≈ 250 kB.
  --   vendedores: [uuid | null, …]
  --   articulos:  [[clave, descripcion, codigo, ts, unidades, categoria, marca, unidad_venta], …]
  --   clientes:   [uuid, …]
  --   filas:      [[vendedor, articulo, pedido, rendido, entregado, importe, kg, pedidos, [comercio, …]], …]
  -- `trim_scale` saca los ceros de relleno (18225.0000 → 18225) sin redondear: el valor es exacto.
  select jsonb_build_object(
    'con_renglones', (select count(distinct id_pedido) from ren),
    'vendedores', coalesce((select jsonb_agg(id_vendedor order by n) from vend), '[]'::jsonb),
    'clientes', coalesce((select jsonb_agg(id_cliente order by n) from cl), '[]'::jsonb),
    'articulos', coalesce((
      select jsonb_agg(jsonb_build_array(a.clave, a.descripcion, a.codigo, a.ts,
                                         pr.unidades, pr.categoria, pr.marca, pr.unidad_venta) order by a.n)
      from arts a
      left join public.productos pr on pr.id = a.id_producto), '[]'::jsonb),
    'filas', coalesce((
      select jsonb_agg(jsonb_build_array(
        v.n, a.n, trim_scale(f.pedido), trim_scale(f.rendido), trim_scale(f.entregado),
        trim_scale(f.importe), trim_scale(f.kg), f.pedidos, coalesce(to_jsonb(f.clientes), '[]'::jsonb)))
      from filas f
      join arts a on a.clave = f.clave
      join vend v on v.id_vendedor is not distinct from f.id_vendedor), '[]'::jsonb)
  )
$$;

comment on function public.consolidado_articulos(uuid[]) is
  'Plan 43: suma por vendedor × artículo de los pedidos dados (sin anulados). SECURITY INVOKER: la RLS de pedidos/pedido_items decide qué suma. Lo llama Gestión → Pedidos → Consolidado, un día por vez.';

revoke all on function public.consolidado_articulos(uuid[]) from public, anon;
grant execute on function public.consolidado_articulos(uuid[]) to authenticated;
