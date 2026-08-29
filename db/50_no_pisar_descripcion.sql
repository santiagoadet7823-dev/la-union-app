-- 50_no_pisar_descripcion.sql — el envío automático no toca los nombres de los productos.
-- 28/08/2026, con `ARTIK.csv`, el primer archivo real del ERP del cliente.
--
-- 🩸 POR QUÉ. El export del ERP trae la descripción **cortada a 20 caracteres**: 407 de 541 filas
-- llegan mutiladas — `MANAOS 12X600ML COLA` (sin el `FDO`), `PLACER 12X500ML ANAN` (era `ANANA`).
-- Es un ancho fijo de su sistema, no un error de esta exportación en particular.
--
-- En la base los nombres están COMPLETOS, cargados desde la lista en PDF. Importar los cortados
-- degradaría el catálogo que ve el vendedor en su celular y el comerciante en la tablet de la
-- vidriera — y lo haría todos los días, en silencio, cada vez que el ERP mande la lista.
--
-- La decisión: **el envío automático actualiza precios y escalones, no nombres.** La planilla manual
-- sí los pisa, que es lo que uno espera cuando corrige un producto a mano.
--
-- ⚠️ En el INSERT no cambia nada: un producto NUEVO sí necesita nombre, aunque venga cortado. Se
-- corrige a mano después, y para eso está la pantalla de control de códigos.
--
-- ⚠️ `create or replace` NO sirve acá: agregar un parámetro cambia la firma y Postgres crearía una
-- SOBRECARGA en vez de reemplazar. Con las dos vivas, la llamada de la Edge Function quedaría
-- ambigua y fallaría. Por eso va un `drop` explícito de la firma vieja.

begin;

drop function if exists public.importar_precios(uuid, jsonb, boolean, uuid, text);

create function public.importar_precios(
  p_empresa            uuid,
  p_filas              jsonb,
  p_lista_completa     boolean default false,
  p_usuario            uuid    default null,
  p_origen             text    default 'endpoint',
  p_pisar_descripcion  boolean default true
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recibidas int; v_creados int := 0; v_actualizados int := 0; v_sin_cambio int := 0;
  v_desc int := 0; v_vigentes int; v_bajas int;
  v_rechazadas jsonb := '[]'::jsonb; v_resultado jsonb;
begin
  if p_empresa is null then raise exception 'sin empresa'; end if;
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'p_filas tiene que ser un array'; end if;
  v_recibidas := jsonb_array_length(p_filas);

  -- 🩸 El `drop` explícito no sobra: `on commit drop` libera la tabla al cerrar la TRANSACCIÓN, no
  -- al terminar la función. Dos llamadas en la misma transacción —o dos requests que caen en la
  -- misma conexión del pool antes de un commit— revientan con `42P07`. Es un fallo INTERMITENTE.
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

  -- 🔴 El freno de las bajas. `lista_completa` da de baja todo lo que no vino; en la pantalla eso
  -- está a salvo porque una PERSONA lee el conteo antes de confirmar. Un endpoint que dispara solo
  -- no tiene esa persona: un export parcial descontinuaría el catálogo entero y nadie se enteraría
  -- hasta que un vendedor abre la app frente a un comercio.
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

  -- Los conteos se miden ANTES de escribir: contar cuántos códigos ya existían es una pregunta con
  -- respuesta exacta, y el resto es una resta. (La alternativa —mirar `xmin = xmax` en un
  -- `returning`— depende de detalles internos de Postgres y devuelve cualquier cosa.)
  select count(*) into v_actualizados from _filas f
   where f.ck is not null
     and exists (select 1 from productos p where p.id_empresa = p_empresa and p.codigo_norm = f.ck);
  select count(*) into v_creados from _filas f where f.ck is not null;
  v_creados := v_creados - v_actualizados;

  -- ⚠️ UPDATE e INSERT separados, no un `on conflict do update`: con defaults en el insert,
  -- `excluded.x` nunca es NULL y el `coalesce` de la rama del update no ataja nada — pisaba el
  -- valor bueno y rompía "celda vacía no borra". Ver el encabezado de db/49.
  update productos p set
    -- 🔑 EL CAMBIO DE ESTA MIGRACIÓN. Con `p_pisar_descripcion = false` el nombre no se toca ni
    -- aunque venga uno en el archivo: es lo que protege los 407 nombres completos de la base contra
    -- el ancho fijo de 20 caracteres del ERP.
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
    -- `escalas` distingue TRES casos: ausente (NULL) = no tocar; `[]` = borrar; con datos = reemplazar.
    escalas            = coalesce(f.escalas,            p.escalas),
    descontinuado_ts   = null
  from _filas f
  where p.id_empresa = p_empresa and f.ck is not null and p.codigo_norm = f.ck;

  -- Los nuevos SÍ se llevan la descripción del archivo, aunque venga cortada: una fila sin nombre no
  -- se puede mostrar. Se corrige a mano desde la pantalla de control de códigos.
  insert into productos (
    id, id_empresa, codigo, descripcion, precio_unitario, peso_kg, unidades,
    categoria, marca, unidad_venta, nivel_rentabilidad, oferta, precio_oferta, escalas)
  select gen_random_uuid(), p_empresa, f.codigo, coalesce(f.descripcion, f.codigo),
    coalesce(f.precio_unitario, 0), coalesce(f.peso_kg, 0), f.unidades,
    f.categoria, f.marca, f.unidad_venta, f.nivel_rentabilidad,
    coalesce(f.oferta, false), f.precio_oferta, coalesce(f.escalas, '[]'::jsonb)
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
$$;

-- 🚨 Regla 7-bis: función NUEVA (la firma cambió), hay que revocar de los TRES. Y acá importa más
-- que de costumbre: recibe `p_empresa` COMO PARÁMETRO y es SECURITY DEFINER, así que un usuario
-- logueado que pudiera llamarla le reescribiría el catálogo a cualquier otra distribuidora.
revoke execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text, boolean) from public;
revoke execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text, boolean) from anon;
revoke execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text, boolean) from authenticated;
grant  execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text, boolean) to service_role;

commit;

-- VERIFICAR (regla 7-bis: mirar el ACL real, no asumir):
--   select proname, pg_get_function_identity_arguments(oid), proacl from pg_proc
--   where proname = 'importar_precios';
--   → una sola fila, y sin anon ni authenticated.
