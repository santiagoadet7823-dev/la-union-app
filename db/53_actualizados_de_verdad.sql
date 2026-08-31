-- 53_actualizados_de_verdad.sql — que "actualizados" signifique actualizados (31/08/2026).
--
-- QUÉ LO DISPARA. El envío de precios del ERP pasa de tres veces por día a **una vez por hora, y
-- manda siempre** aunque el archivo sea idéntico al anterior (decisión del cliente: "por las dudas
-- que lo envíe igual"). Son 24 envíos por día.
--
-- 🔴 EL PROBLEMA QUE ESO DESTAPA, MEDIDO ANTES DE TOCAR NADA.
-- `sello_precios()` (db/52) devuelve `max(ts)` de `ingestas_precios`. El teléfono lo consulta y, si
-- cambió, **recarga el catálogo completo**. Con 24 envíos por día ese sello se mueve 24 veces aunque
-- no cambie un solo precio:
--
--     productos ............ 170 kB (529 filas)
--     clientes ............. 340 kB (2.015 filas)
--     una recarga .......... ~510 kB
--     por teléfono/día ..... ~12 MB de datos móviles DEL EMPLEADO, para nada
--     × 9 teléfonos ........ ~110 MB/día
--
-- Es la regla 48 otra vez —"antes de automatizar una descarga, calcular MB × repeticiones ×
-- teléfonos"—, la misma que costó los ~430 MB/día del auto-updater del APK.
--
-- 🩸 Y LA CAUSA RAÍZ NO ES EL SELLO: ES QUE `importar_precios` MIENTE.
-- `v_actualizados` contaba "cuántos códigos del archivo YA EXISTÍAN", medido ANTES de escribir:
--
--     select count(*) into v_actualizados from _filas f
--      where f.ck is not null and exists (select 1 from productos p where …);
--
-- Reenviar un archivo idéntico reportaba **`actualizados: 511`** con cero cambios reales. Ese número
-- miente en dos lugares a la vez: en el registro que lee el cliente y en el sello que lee el
-- teléfono. Acá se arregla el número, y el sello se arregla solo como consecuencia.
--
-- LO QUE CAMBIA, EN CONCRETO:
--   1. El UPDATE sólo toca filas que DE VERDAD cambian (`is distinct from`), y el conteo sale de
--      `get diagnostics`. De paso se escriben muchas menos filas: menos WAL, menos bloat.
--   2. `v_creados` también sale de `get diagnostics` del INSERT, que es el número honesto (el
--      `on conflict do nothing` podía descartar alguna).
--   3. `sello_precios()` sólo mira las ingestas que cambiaron algo.
--
-- ⚠️ Y EL EFECTO BUENO QUE NO ES OBVIO: el registro del cliente pasa a decir la verdad.
-- `actualizados: 0` es información útil ("llegó y no había nada nuevo"); `actualizados: 511` sobre un
-- archivo sin cambios es ruido, y el ruido entrena a no mirar el registro.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `importar_precios` — los conteos salen de lo que REALMENTE se escribió
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ El cuerpo sale de la función viva (db/51 + db/50 + db/49 ya fusionados en producción), no de
-- leer los tres archivos y unirlos a ojo (regla 5). Lo único distinto está marcado con `-- 53:`.
-- Misma firma → los grants no se tocan y no aplica la trampa de la regla 7-bis.
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

  -- 53: LOS CONTEOS YA NO SE MIDEN ANTES DE ESCRIBIR.
  -- Acá había dos `select count(*)` que calculaban "cuántos códigos ya existían" y derivaban los
  -- creados por resta. Eso daba un `actualizados` que sólo significaba "estaba en el archivo y ya
  -- existía" — verdadero incluso cuando ninguna columna cambiaba. Ahora los dos números salen del
  -- `row_count` de las sentencias reales, más abajo.

  -- 1) Los que ya existen.
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
    destacado          = coalesce(f.destacado,          p.destacado),
    escalas            = coalesce(f.escalas,            p.escalas),
    descontinuado_ts   = null
  from _filas f
  where p.id_empresa = p_empresa and f.ck is not null and p.codigo_norm = f.ck
    -- 53: 🔑 SÓLO LAS FILAS QUE DE VERDAD CAMBIAN.
    -- La lista de la izquierda es el estado actual; la de la derecha, exactamente lo que el `set`
    -- de arriba va a escribir. Si son iguales, la fila no se toca y no cuenta como actualizada.
    --
    -- ⚠️ `descontinuado_ts` VA EN LA COMPARACIÓN, y es la trampa de este cambio. El `set` lo pone en
    -- `null` incondicionalmente para que un producto que reaparece en la lista se REACTIVE solo
    -- (ver db/49). Si quedara fuera de este `is distinct from`, un producto descontinuado que vuelve
    -- tendría todas las demás columnas iguales, la fila no se actualizaría, y **no se reactivaría
    -- nunca**. Incluyéndolo, `descontinuado_ts is distinct from null` da verdadero y entra.
    and (p.descripcion, p.precio_unitario, p.peso_kg, p.unidades, p.categoria, p.marca,
         p.unidad_venta, p.nivel_rentabilidad, p.oferta, p.precio_oferta, p.destacado,
         p.escalas, p.descontinuado_ts)
        is distinct from
        (case when p_pisar_descripcion then coalesce(f.descripcion, p.descripcion) else p.descripcion end,
         coalesce(f.precio_unitario,    p.precio_unitario),
         coalesce(f.peso_kg,            p.peso_kg),
         coalesce(f.unidades,           p.unidades),
         coalesce(f.categoria,          p.categoria),
         coalesce(f.marca,              p.marca),
         coalesce(f.unidad_venta,       p.unidad_venta),
         coalesce(f.nivel_rentabilidad, p.nivel_rentabilidad),
         coalesce(f.oferta,             p.oferta),
         coalesce(f.precio_oferta,      p.precio_oferta),
         coalesce(f.destacado,          p.destacado),
         coalesce(f.escalas,            p.escalas),
         null::timestamptz);
  get diagnostics v_actualizados = row_count;   -- 53: el número honesto

  -- 2) Los nuevos.
  insert into productos (
    id, id_empresa, codigo, descripcion, precio_unitario, peso_kg, unidades,
    categoria, marca, unidad_venta, nivel_rentabilidad, oferta, precio_oferta, destacado, escalas)
  select gen_random_uuid(), p_empresa, f.codigo, coalesce(f.descripcion, f.codigo),
    coalesce(f.precio_unitario, 0), coalesce(f.peso_kg, 0), f.unidades,
    f.categoria, f.marca, f.unidad_venta, f.nivel_rentabilidad,
    coalesce(f.oferta, false), f.precio_oferta,
    coalesce(f.destacado, false),
    coalesce(f.escalas, '[]'::jsonb)
  from _filas f
  where f.ck is not null
    and not exists (select 1 from productos p where p.id_empresa = p_empresa and p.codigo_norm = f.ck)
  on conflict do nothing;
  get diagnostics v_creados = row_count;        -- 53: lo que de verdad entró

  if p_lista_completa then
    update productos p set descontinuado_ts = now()
     where p.id_empresa = p_empresa and p.descontinuado_ts is null
       and p.codigo is not null and btrim(p.codigo) <> ''
       and not exists (select 1 from _filas f where f.ck = p.codigo_norm);
    get diagnostics v_desc = row_count;
  end if;

  -- 53: ahora esta resta significa algo: filas que llegaron y no movieron nada.
  v_sin_cambio := greatest(0, v_recibidas - v_creados - v_actualizados - jsonb_array_length(v_rechazadas));
  v_resultado := jsonb_build_object('recibidas',v_recibidas,'creados',v_creados,'actualizados',v_actualizados,
    'sin_cambio',v_sin_cambio,'descontinuados',v_desc,'rechazadas',v_rechazadas);

  insert into ingestas_precios (id_empresa,id_usuario,origen,recibidas,creados,actualizados,sin_cambio,descontinuados,rechazadas)
  values (p_empresa,p_usuario,p_origen,v_recibidas,v_creados,v_actualizados,v_sin_cambio,v_desc,v_rechazadas);
  return v_resultado;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `sello_precios()` — que sólo se mueva cuando el catálogo cambió
-- ─────────────────────────────────────────────────────────────────────────────
-- Son DOS preguntas distintas y por eso son dos consultas distintas. Que no se unifiquen:
--
--   `EstadoCatalogo` (la pantalla)  →  max(ts) a secas
--       "¿sigue llegando la lista?" — con 24 envíos por hora se mantiene fresco, y el ámbar de las
--       36 h sigue siendo una señal real de que el envío se murió.
--
--   `sello_precios()` (el teléfono) →  max(ts) SÓLO de las que cambiaron algo
--       "¿vale la pena bajar 510 kB por datos móviles?"
--
-- Un envío que llega y no cambia nada tiene que contestar SÍ a la primera y NO a la segunda.
create or replace function public.sello_precios()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  select max(ts) from public.ingestas_precios
   where id_empresa = (select mi_empresa())
     and coalesce(creados,0) + coalesce(actualizados,0) + coalesce(descontinuados,0) > 0;
$function$;

comment on function public.sello_precios() is
  'Cuando el catalogo de MI empresa cambio por ultima vez (no cuando llego la ultima lista: eso es '
  'max(ts) a secas). Lo consulta el telefono para decidir si vale la pena recargar 510 kB.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación (correr a mano después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
--   -- 1. El ACL de las dos, IDÉNTICO a antes. Mirar el real, no asumir.
--   select proname, proacl from pg_proc
--    where pronamespace='public'::regnamespace
--      and proname in ('importar_precios','sello_precios');
--
--   -- 2. Importar un archivo y volver a importar EL MISMO:
--   --      1ª vez → creados/actualizados > 0, el sello se mueve
--   --      2ª vez → actualizados = 0, sin_cambio = recibidas, y el sello NO se mueve
--   --    (antes de db/53 la 2ª daba `actualizados: 511`)
--
--   -- 3. Cambiar UN precio y reenviar → actualizados = 1, y el sello sí se mueve.
--
--   -- 4. La trampa: descontinuar un producto a mano, reenviarlo en la lista, y verificar que
--   --    `descontinuado_ts` volvió a NULL. Si no se reactiva, falta `descontinuado_ts` en el
--   --    `is distinct from`.
