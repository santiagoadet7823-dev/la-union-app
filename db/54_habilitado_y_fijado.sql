-- =============================================================================
--  db/54 — El ERP puede APAGAR un producto (01/09/2026)
--
--  QUÉ PEDÍA EL CLIENTE
--  Tienen mal stock y deshabilitan productos en su sistema de gestión. Quieren
--  que eso llegue a la app: una columna `habilitado` en el archivo, y que todo
--  lo que no venga —ni marcado ni presente— desaparezca para el vendedor.
--
--  QUÉ YA EXISTÍA, y por eso esta migración es chica
--  El estado "deshabilitado" es `productos.descontinuado_ts`, y toda la app ya
--  lo respeta (`productosVigentes` en CatalogContext). La pantalla para verlos y
--  rehabilitarlos es `CatalogoTab`, y los cuatro roles que se pidieron ya llegan
--  a ella. La baja por ausencia ya estaba en `importar_precios(p_lista_completa)`
--  con una válvula que aborta si se daría de baja más del 20 %.
--  Faltaban: la columna por fila, y el FIJADO.
--
--  🔴 POR QUÉ HACE FALTA EL FIJADO, que es lo único realmente nuevo acá
--  El envío corre CADA HORA. Con la baja por ausencia prendida, un producto
--  rehabilitado a mano se vuelve a apagar solo antes de que termine la hora: el
--  botón de "rehabilitar" mentiría. Y su corolario muerde igual de fuerte —un
--  producto CREADO a mano tampoco está en el archivo del ERP, así que marketing
--  cargaría un producto y lo vería desaparecer sin ninguna explicación.
--  `fijado_ts` es la marca de "esto lo sostiene una persona": el envío por hora
--  no lo apaga por ausencia. Una orden EXPLÍCITA del ERP (`habilitado = no`) sí
--  gana — la marca protege contra el silencio, no contra una instrucción.
-- =============================================================================

begin;

-- ── 1) productos.fijado_ts ───────────────────────────────────────────────────
--
-- 🩸 SE AGREGA SIN DEFAULT Y RECIÉN DESPUÉS SE LE PONE EL DEFAULT. No es un
-- rodeo: desde Postgres 11 un `add column ... default now()` RELLENA las filas
-- que ya existen, así que en un solo paso los 606 productos de hoy quedarían
-- fijados y la baja por ausencia no se dispararía nunca. El efecto sería una
-- migración que aplica limpia, no da ningún error, y deja la función que vino a
-- construir sin hacer absolutamente nada.
alter table public.productos add column if not exists fijado_ts timestamptz;

-- El default vale sólo de acá en adelante: todo producto que nazca por un camino
-- que NO sea la importación (alta a mano desde el catálogo) queda fijado solo.
-- Eso también resuelve un problema de ORDEN DE PUBLICACIÓN: entre el deploy de
-- la base y la OTA que enseña a la app a fijar, un alta a mano ya está cubierta.
alter table public.productos alter column fijado_ts set default now();

comment on column public.productos.fijado_ts is
  'Sellado cuando una PERSONA sostiene el producto (alta a mano, o rehabilitado desde el catálogo). '
  'Mientras no sea NULL, la importación no lo da de baja por estar ausente del archivo del ERP. '
  'Un `habilitado = no` explícito del ERP lo apaga igual y limpia esta marca. Ver db/54.';

-- ── 2) ingestas_precios.bajas ────────────────────────────────────────────────
--
-- QUÉ productos se apagaron y por qué. Hasta hoy la bitácora guardaba sólo el
-- NÚMERO (`descontinuados`), y con un número no se puede revisar nada: dar de
-- baja productos es un cambio de estado masivo y silencioso —desaparecen del
-- celular de nueve vendedores sin que nadie toque un botón— así que necesita
-- rastro. Calcado de `rechazadas`, que ya resolvió lo mismo para las filas malas.
alter table public.ingestas_precios add column if not exists bajas jsonb not null default '[]'::jsonb;

comment on column public.ingestas_precios.bajas is
  'Productos dados de baja por esta ingesta: [{codigo, descripcion, motivo}]. '
  'motivo = ''ausente'' (no vino en el archivo) | ''habilitado'' (vino con habilitado = no).';


-- ── 3) La función ────────────────────────────────────────────────────────────
create or replace function public.importar_precios(
  p_empresa uuid,
  p_filas jsonb,
  p_lista_completa boolean default false,
  p_usuario uuid default null,
  p_origen text default 'endpoint',
  p_pisar_descripcion boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_recibidas int; v_creados int := 0; v_actualizados int := 0; v_sin_cambio int := 0;
  v_desc int := 0; v_vigentes int; v_bajas int;
  v_bajas_log jsonb := '[]'::jsonb;
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
      -- NULL = la columna `habilitado` NO estaba en el encabezado del archivo. Es la guarda que
      -- evita la regla 54: el día que su exportador deje de emitir esa columna, no se apagan los
      -- 606 productos de una. El `false` sólo llega cuando la columna VINO y la celda no dice sí.
      (f->>'habilitado')::boolean as habilitado,
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

  -- ── Qué se va a apagar, ANTES de escribir ──────────────────────────────────
  --
  -- 🩸 EL ORDEN NO ES CASUAL: después de los UPDATE ya no se puede distinguir
  -- "lo apagó este envío" de "ya estaba apagado", porque lo único que queda es
  -- un `descontinuado_ts` sin autor. Y de paso este mismo cálculo alimenta la
  -- válvula, así que la lista y el número no pueden discrepar: son el mismo
  -- `select`. Antes eran dos consultas parecidas, que es como empiezan a mentir.
  select coalesce(jsonb_agg(jsonb_build_object(
           'codigo', codigo, 'descripcion', descripcion, 'motivo', motivo)), '[]'::jsonb)
    into v_bajas_log
  from (
    -- (a) Vino en el archivo, con la columna diciendo que no.
    select p.codigo, p.descripcion, 'habilitado' as motivo
      from productos p
      join _filas f on f.ck = p.codigo_norm
     where p.id_empresa = p_empresa
       and p.descontinuado_ts is null
       and f.habilitado is false
    union all
    -- (b) No vino en el archivo. El fijado a mano queda afuera: es toda su razón de existir.
    select p.codigo, p.descripcion, 'ausente'
      from productos p
     where p_lista_completa
       and p.id_empresa = p_empresa
       and p.descontinuado_ts is null
       and p.fijado_ts is null
       and p.codigo is not null and btrim(p.codigo) <> ''
       and not exists (select 1 from _filas f where f.ck = p.codigo_norm)
  ) t;

  v_bajas := jsonb_array_length(v_bajas_log);

  -- ── La válvula ─────────────────────────────────────────────────────────────
  --
  -- Ya no cuelga de `p_lista_completa`: ahora hay DOS caminos para apagar un
  -- producto, y el explícito (la columna) existe aunque el modo lista completa
  -- esté apagado. Una válvula que sólo cubre uno de los dos caminos no es una
  -- válvula. El caso que atrapa: el exportador emite la columna vacía en todas
  -- las filas por un error de su lado, y el catálogo entero se apaga en silencio.
  if v_bajas > 0 then
    select count(*) into v_vigentes from productos where id_empresa = p_empresa and descontinuado_ts is null;
    -- 🩸 EL PISO DE 10 ES NUEVO, y salió de probar la función (01/09/2026). Con sólo el porcentaje,
    -- un catálogo chico no puede apagar NADA: sobre 3 productos, apagar uno es el 33 % y la válvula
    -- rechazaba el envío entero. Una guarda que bloquea la operación normal se termina apagando, y
    -- ahí no protege de nada. El piso no la debilita donde importa: el modo de falla real —el
    -- exportador emite la columna vacía en todas las filas— intenta apagar cientos, y supera las
    -- dos condiciones sin esfuerzo.
    if v_vigentes > 0 and v_bajas > 10 and v_bajas::numeric / v_vigentes > 0.20 then
      v_resultado := jsonb_build_object('error','demasiadas-bajas','bajas',v_bajas,'vigentes',v_vigentes,
        'detalle', format('La lista dejaria fuera %s de %s productos vigentes (%s%%). No se escribio nada.',
                          v_bajas, v_vigentes, round(v_bajas::numeric / v_vigentes * 100)));
      insert into ingestas_precios (id_empresa, id_usuario, origen, recibidas, error, bajas)
      values (p_empresa, p_usuario, p_origen, v_recibidas, v_resultado->>'detalle', v_bajas_log);
      return v_resultado;
    end if;
  end if;

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
    -- 🔴 ANTES ACÁ DECÍA `descontinuado_ts = null` A SECAS: todo lo que venía en el archivo se
    -- reactivaba. Con la columna nueva hay tres casos, y el tercero es el que sostiene el resto.
    --
    -- El `coalesce(p.descontinuado_ts, now())` NO es cosmético. Con un `now()` pelado, cada
    -- producto apagado contaría como MODIFICADO en cada envío por hora → el sello de precios se
    -- movería → los nueve teléfonos se bajarían el catálogo entero, cada hora, para siempre. Es
    -- exactamente el bug que db/53 vino a arreglar, con otro disfraz.
    descontinuado_ts   = case
                           when f.habilitado is null then p.descontinuado_ts   -- la columna no vino
                           when f.habilitado         then null                 -- habilitado: reactiva
                           else coalesce(p.descontinuado_ts, now())            -- apagado, sin pisar el sello
                         end,
    -- El ERP habla de este producto, así que la protección contra la ausencia deja de tener
    -- sentido: de acá en más lo gobierna el archivo.
    fijado_ts          = null
  from _filas f
  where p.id_empresa = p_empresa and f.ck is not null and p.codigo_norm = f.ck
    and (p.descripcion, p.precio_unitario, p.peso_kg, p.unidades, p.categoria, p.marca,
         p.unidad_venta, p.nivel_rentabilidad, p.oferta, p.precio_oferta, p.destacado,
         p.escalas, p.descontinuado_ts, p.fijado_ts)
        is distinct from
        -- ⚠️ Espejo EXACTO del SET de arriba. Lo que se escribe tiene que estar en la comparación:
        -- si falta, la fila no cambia nunca; si sobra, cambia siempre. Las dos formas rompen el
        -- sello de precios en silencio (db/53).
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
         case
           when f.habilitado is null then p.descontinuado_ts
           when f.habilitado         then null
           else coalesce(p.descontinuado_ts, now())
         end,
         null::timestamptz);
  get diagnostics v_actualizados = row_count;

  insert into productos (
    id, id_empresa, codigo, descripcion, precio_unitario, peso_kg, unidades,
    categoria, marca, unidad_venta, nivel_rentabilidad, oferta, precio_oferta, destacado, escalas,
    descontinuado_ts, fijado_ts)
  select gen_random_uuid(), p_empresa, f.codigo, coalesce(f.descripcion, f.codigo),
    coalesce(f.precio_unitario, 0), coalesce(f.peso_kg, 0), f.unidades,
    f.categoria, f.marca, f.unidad_venta, f.nivel_rentabilidad,
    coalesce(f.oferta, false), f.precio_oferta,
    coalesce(f.destacado, false),
    coalesce(f.escalas, '[]'::jsonb),
    -- Un producto que NACE apagado: viene en el archivo por primera vez y ya con habilitado = no.
    case when f.habilitado is false then now() else null end,
    -- 🩸 EXPLÍCITO, contra el `default now()` de la columna. El default está para el alta a mano;
    -- un producto que llega por el ERP lo gobierna el ERP, y si naciera fijado quedaría inmune a la
    -- baja por ausencia para siempre — o sea, la función se auto-desactivaría a medida que crea.
    null
  from _filas f
  where f.ck is not null
    and not exists (select 1 from productos p where p.id_empresa = p_empresa and p.codigo_norm = f.ck)
  on conflict do nothing;
  get diagnostics v_creados = row_count;

  if p_lista_completa then
    update productos p set descontinuado_ts = now()
     where p.id_empresa = p_empresa and p.descontinuado_ts is null
       and p.fijado_ts is null                     -- lo que sostiene una persona no se apaga solo
       and p.codigo is not null and btrim(p.codigo) <> ''
       and not exists (select 1 from _filas f where f.ck = p.codigo_norm);
  end if;

  -- El número sale de la MISMA lista que se guarda, no de un `row_count` aparte: así el resumen
  -- que ve el cliente y la bitácora que miramos nosotros no pueden discrepar.
  v_desc := v_bajas;

  v_sin_cambio := greatest(0, v_recibidas - v_creados - v_actualizados - jsonb_array_length(v_rechazadas));
  v_resultado := jsonb_build_object('recibidas',v_recibidas,'creados',v_creados,'actualizados',v_actualizados,
    'sin_cambio',v_sin_cambio,'descontinuados',v_desc,'rechazadas',v_rechazadas,'bajas',v_bajas_log);

  insert into ingestas_precios (id_empresa,id_usuario,origen,recibidas,creados,actualizados,sin_cambio,descontinuados,rechazadas,bajas)
  values (p_empresa,p_usuario,p_origen,v_recibidas,v_creados,v_actualizados,v_sin_cambio,v_desc,v_rechazadas,v_bajas_log);
  return v_resultado;
end;
$function$;

-- ── 4) Permisos (regla 7-bis) ────────────────────────────────────────────────
--
-- `create or replace` CONSERVA el ACL de la función que ya existía, así que esto
-- debería ser un no-op. Se corre igual y se VERIFICA el `proacl` después: la
-- función es SECURITY DEFINER y escribe el catálogo entero de una empresa, y el
-- costo de asumir mal es que cualquier usuario logueado pueda reescribirlo.
revoke execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text, boolean) from public;
revoke execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text, boolean) from anon;
revoke execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text, boolean) from authenticated;
grant  execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text, boolean) to service_role;

commit;

-- Verificación posterior (no se ejecuta acá):
--   select proacl from pg_proc where proname = 'importar_precios';
--   select count(*) filter (where fijado_ts is null) as expuestos, count(*) from productos;
