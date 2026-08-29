-- 51_destacado.sql — "Destacados": los productos que hay que empujar (28/08/2026).
--
-- QUÉ RESUELVE. El vendedor entra a un comercio con 529 productos en la grilla y vende lo que el
-- comerciante ya le pide. Lo que no rota se queda quieto para siempre. El cliente pidió un filtro
-- que muestre primero esos productos, para que el vendedor los saque uno por uno y —con la tablet
-- pareada— se los abra grandes al comerciante para que decida si los suma.
--
-- 🔴 POR QUÉ ES UN FLAG EXPLÍCITO Y NO SE CALCULA DEL HISTORIAL DE PEDIDOS.
-- La forma "obvia" sería una RPC tipo `productos_sugeridos_cliente` (db/44) pero al revés: los que
-- menos se pidieron. Medido contra la base viva el 28/08, ANTES de escribir nada:
--
--     productos ................. 529   (0 descontinuados)
--     pedidos ................... 3     — y los 3 ANULADOS
--     pedido_items .............. 3 líneas, 3 productos distintos
--
-- O sea que "los que menos se movieron" devolvería hoy **526 de 529**: el chip nacería
-- indistinguible de "Todos". Es exactamente la advertencia que db/44 se escribió a sí misma ("no da
-- resultados el día 1"), y acá se cumpliría durante meses. Además `productos` no tiene ninguna
-- columna de stock ni de rotación: el único sistema que hoy SABE qué no se mueve es el ERP del
-- cliente.
--
-- Por eso: una columna booleana que se llena por DOS caminos, con el mismo nombre de campo.
--   1) A mano, desde la ficha del producto (Catálogo / Marketing). Funciona el día 1.
--   2) Desde la lista de precios del ERP, una columna `destacado` más (`si`/`no`), por la planilla
--      o por el endpoint `ingest-precios`. Es el camino que lo mantiene solo.
--
-- Cuando `pedido_items` tenga historial de verdad, esto se puede complementar con una sugerencia
-- automática ("estos 20 no se pidieron en 90 días, ¿los marco?"), pero la DECISIÓN sigue siendo del
-- cliente: un producto puede no rotar porque no lo quiere nadie o porque hay que liquidarlo, y esa
-- diferencia no está en los datos.
--
-- SIN ÍNDICE, a propósito. El catálogo entero ya viaja al teléfono (`CatalogContext`) y el filtro es
-- en memoria (`PRODUCTS.filter`). Un índice sobre 529 filas para una query que no existe es ruido.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La columna
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.productos
  add column if not exists destacado boolean not null default false;

comment on column public.productos.destacado is
  'Producto a empujar (baja rotación / a liquidar). Lo marca el catálogo a mano o la lista de '
  'precios del ERP. Alimenta el chip "Destacados" del vendedor. NO se calcula del historial.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `importar_precios` aprende el campo
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ ESTE CUERPO SALE DE `pg_get_functiondef` SOBRE LA BASE VIVA, no de db/49 + db/50 leídos y
-- fusionados a ojo (regla 5: los .sql no son la fuente de verdad, y db/50 ya había cambiado el
-- manejo de la descripción). Lo único que cambia respecto de lo que hoy corre en producción son las
-- TRES líneas marcadas con `-- 51:`.
--
-- ⚠️ Y es un `create or replace` de una función que YA EXISTE, con la MISMA firma. Eso significa que
-- los grants no se tocan y NO aplica la trampa de la regla 7-bis (que es para funciones nuevas).
-- Se verifica igual al final: el `proacl` tiene que quedar idéntico.
--
-- El campo viaja DENTRO del jsonb de filas, así que no hace falta un parámetro nuevo: si se hubiera
-- agregado uno, la firma cambiaría y quedarían dos funciones conviviendo — que es exactamente el
-- problema que db/48 tuvo que resolver a mano con `mi_token_ingesta`.
create or replace function public.importar_precios(
  p_empresa uuid,
  p_filas jsonb,
  p_lista_completa boolean default false,
  p_usuario uuid default null::uuid,
  p_origen text default 'endpoint'::text,
  p_pisar_descripcion boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_recibidas int; v_creados int := 0; v_actualizados int := 0; v_sin_cambio int := 0;
  v_desc int := 0; v_vigentes int; v_bajas int;
  v_rechazadas jsonb := '[]'::jsonb; v_resultado jsonb;
begin
  if p_empresa is null then raise exception 'sin empresa'; end if;
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'p_filas tiene que ser un array'; end if;
  v_recibidas := jsonb_array_length(p_filas);

  drop table if exists _filas;
  create temp table _filas on commit drop as
  with crudo as (
    select ordinality as fila, f->>'codigo' as codigo, public.codigo_norm(f->>'codigo') as ck,
      nullif(btrim(coalesce(f->>'descripcion','')),'') as descripcion,
      (f->>'precio_unitario')::numeric as precio_unitario, (f->>'peso_kg')::numeric as peso_kg,
      (f->>'unidades')::int as unidades,
      nullif(btrim(coalesce(f->>'categoria','')),'') as categoria,
      nullif(btrim(coalesce(f->>'marca','')),'') as marca,
      nullif(btrim(coalesce(f->>'unidad_venta','')),'') as unidad_venta,
      (f->>'nivel_rentabilidad')::smallint as nivel_rentabilidad,
      (f->>'oferta')::boolean as oferta, (f->>'precio_oferta')::numeric as precio_oferta,
      -- 51: NULL = la columna no vino en el archivo → el coalesce de abajo no la pisa. Mismo
      -- contrato que `oferta`, y es lo que sostiene "una celda vacía no borra nada".
      (f->>'destacado')::boolean as destacado,
      case when f ? 'escalas' then f->'escalas' else null end as escalas
    from jsonb_array_elements(p_filas) with ordinality as t(f, ordinality)
  )
  select * from (
    select *, row_number() over (partition by ck order by fila) as rn
    from crudo where descripcion is not null or ck is not null
  ) x where rn = 1;

  select coalesce(jsonb_agg(jsonb_build_object(
           'fila', ordinality, 'codigo', f->>'codigo', 'motivo', 'sin descripcion ni codigo')), '[]'::jsonb)
    into v_rechazadas
  from jsonb_array_elements(p_filas) with ordinality as t(f, ordinality)
  where nullif(btrim(coalesce(f->>'descripcion','')),'') is null
    and public.codigo_norm(f->>'codigo') is null;

  if p_lista_completa then
    select count(*) into v_vigentes from productos where id_empresa = p_empresa and descontinuado_ts is null;
    select count(*) into v_bajas from productos p
      where p.id_empresa = p_empresa and p.descontinuado_ts is null
        and p.codigo is not null and btrim(p.codigo) <> ''
        and not exists (select 1 from _filas f where f.ck = p.codigo_norm);
    if v_vigentes > 0 and v_bajas::numeric / v_vigentes > 0.20 then
      v_resultado := jsonb_build_object('error','demasiadas-bajas','bajas',v_bajas,'vigentes',v_vigentes,
        'detalle', format('La lista dejaria fuera %s de %s productos vigentes (%s%%). No se escribio nada.',
                          v_bajas, v_vigentes, round(v_bajas::numeric / v_vigentes * 100)));
      insert into ingestas_precios (id_empresa, id_usuario, origen, recibidas, error)
      values (p_empresa, p_usuario, p_origen, v_recibidas, v_resultado->>'detalle');
      return v_resultado;
    end if;
  end if;

  select count(*) into v_actualizados from _filas f
   where f.ck is not null
     and exists (select 1 from productos p where p.id_empresa = p_empresa and p.codigo_norm = f.ck);
  select count(*) into v_creados from _filas f where f.ck is not null;
  v_creados := v_creados - v_actualizados;

  update productos p set
    descripcion        = case when p_pisar_descripcion
                              then coalesce(f.descripcion, p.descripcion)
                              else p.descripcion end,
    precio_unitario    = coalesce(f.precio_unitario,    p.precio_unitario),
    peso_kg            = coalesce(f.peso_kg,            p.peso_kg),
    unidades           = coalesce(f.unidades,           p.unidades),
    categoria          = coalesce(f.categoria,          p.categoria),
    marca              = coalesce(f.marca,              p.marca),
    unidad_venta       = coalesce(f.unidad_venta,       p.unidad_venta),
    nivel_rentabilidad = coalesce(f.nivel_rentabilidad, p.nivel_rentabilidad),
    oferta             = coalesce(f.oferta,             p.oferta),
    precio_oferta      = coalesce(f.precio_oferta,      p.precio_oferta),
    destacado          = coalesce(f.destacado,          p.destacado),   -- 51:
    escalas            = coalesce(f.escalas,            p.escalas),
    descontinuado_ts   = null
  from _filas f
  where p.id_empresa = p_empresa and f.ck is not null and p.codigo_norm = f.ck;

  insert into productos (
    id, id_empresa, codigo, descripcion, precio_unitario, peso_kg, unidades,
    categoria, marca, unidad_venta, nivel_rentabilidad, oferta, precio_oferta, destacado, escalas)
  select gen_random_uuid(), p_empresa, f.codigo, coalesce(f.descripcion, f.codigo),
    coalesce(f.precio_unitario, 0), coalesce(f.peso_kg, 0), f.unidades,
    f.categoria, f.marca, f.unidad_venta, f.nivel_rentabilidad,
    coalesce(f.oferta, false), f.precio_oferta,
    coalesce(f.destacado, false),                                       -- 51:
    coalesce(f.escalas, '[]'::jsonb)
  from _filas f
  where f.ck is not null
    and not exists (select 1 from productos p where p.id_empresa = p_empresa and p.codigo_norm = f.ck)
  on conflict do nothing;

  if p_lista_completa then
    update productos p set descontinuado_ts = now()
     where p.id_empresa = p_empresa and p.descontinuado_ts is null
       and p.codigo is not null and btrim(p.codigo) <> ''
       and not exists (select 1 from _filas f where f.ck = p.codigo_norm);
    get diagnostics v_desc = row_count;
  end if;

  v_sin_cambio := greatest(0, v_recibidas - v_creados - v_actualizados - jsonb_array_length(v_rechazadas));
  v_resultado := jsonb_build_object('recibidas',v_recibidas,'creados',v_creados,'actualizados',v_actualizados,
    'sin_cambio',v_sin_cambio,'descontinuados',v_desc,'rechazadas',v_rechazadas);

  insert into ingestas_precios (id_empresa,id_usuario,origen,recibidas,creados,actualizados,sin_cambio,descontinuados,rechazadas)
  values (p_empresa,p_usuario,p_origen,v_recibidas,v_creados,v_actualizados,v_sin_cambio,v_desc,v_rechazadas);
  return v_resultado;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación (correr a mano después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
--   select column_name, data_type, column_default, is_nullable
--     from information_schema.columns
--    where table_schema='public' and table_name='productos' and column_name='destacado';
--   -- esperado: boolean, default false, NOT NULL.
--
--   select proname, proacl from pg_proc
--    where pronamespace='public'::regnamespace and proname='importar_precios';
--   -- esperado: IDÉNTICO a antes de aplicar esto (solo service_role). Mirar el ACL real, no asumir.
--
--   -- Que "celda vacía no borra": marcar un producto de descarte, y después importar la MISMA fila
--   -- SIN la clave `destacado`. Tiene que seguir en true.
--   select codigo, destacado from productos where codigo_norm = public.codigo_norm('<codigo>');
