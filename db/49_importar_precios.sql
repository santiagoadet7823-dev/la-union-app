-- 49_importar_precios.sql — LA RPC QUE ESCRIBE LA LISTA DE PRECIOS.
-- 27/08/2026. Segunda mitad de db/48: aquél es el esquema, éste la lógica.
--
-- POR QUÉ EN SQL Y NO EN LA EDGE FUNCTION. El cruce de un producto de la lista contra el catálogo
-- es "mismo código, ignorando los ceros de adelante" (`codigoKey`, web/src/lib/texto.js) — la regla
-- que costó descubrir que importar la lista del 08/08 con una comparación literal habría creado
-- 372 duplicados sin foto. Esa regla ya vive en el bundle; escribirla otra vez en Deno la pondría
-- en DOS runtimes que nadie sincroniza, que es la regla 36 de CLAUDE.md y el modo de falla más caro
-- del proyecto. Acá abajo es una restricción de la base, y la Edge Function no la conoce: parsea,
-- valida el formato y delega.
--
-- Y hay un segundo motivo: en SQL el upsert es ATÓMICO. La importación por planilla resuelve el
-- pareo en memoria contra el catálogo cargado, así que dos personas importando a la vez pueden
-- pisarse. Un endpoint que dispara solo, de madrugada, no puede depender de eso.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. LA NORMALIZACIÓN DEL CÓDIGO, EN UN SOLO LUGAR
-- ─────────────────────────────────────────────────────────────────────────────
-- db/48 dejó la expresión escrita a mano dentro de la columna generada. Ahora la necesita también
-- esta RPC para normalizar lo que ENTRA, y dos copias de la misma expresión es exactamente lo que
-- este archivo dice que hay que evitar. Se extrae a una función y la columna generada pasa a
-- usarla: una definición, dos consumidores.
--
-- IMMUTABLE es obligatorio para una columna generada. Todas las funciones que usa lo son
-- (verificado en pg_proc: btrim, lower, ltrim, regexp_replace).
--
-- El `coalesce(nullif(...))` replica el `|| s` de `codigoKey`: un código que es todo ceros (`0000`)
-- no puede colapsar a cadena vacía, o dos productos distintos quedarían pareados entre sí.
create or replace function public.codigo_norm(p_codigo text)
returns text
language sql
immutable
parallel safe
as $$
  select coalesce(
    nullif(ltrim(lower(regexp_replace(btrim(p_codigo), '\s', '', 'g')), '0'), ''),
    lower(regexp_replace(btrim(p_codigo), '\s', '', 'g'))
  )
$$;

comment on function public.codigo_norm(text) is
  'Clave canónica de un código de producto/cliente: minúsculas, sin espacios, sin ceros a la '
  'izquierda. Espeja `codigoKey()` de web/src/lib/texto.js. Si se toca una, tocar la otra.';

-- Se recrean las columnas generadas para que usen la función en vez de la expresión copiada.
-- Los índices únicos se van con la columna, así que se rehacen igual que en db/48.
alter table public.productos drop column if exists codigo_norm;
alter table public.clientes  drop column if exists codigo_norm;

alter table public.productos add column codigo_norm text
  generated always as (public.codigo_norm(codigo)) stored;
alter table public.clientes add column codigo_norm text
  generated always as (public.codigo_norm(codigo)) stored;

create unique index if not exists productos_codigo_norm_uidx
  on public.productos (id_empresa, codigo_norm)
  where codigo is not null and btrim(codigo) <> '';

create unique index if not exists clientes_codigo_norm_uidx
  on public.clientes (id_empresa, codigo_norm)
  where codigo is not null and btrim(codigo) <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LA RPC
-- ─────────────────────────────────────────────────────────────────────────────
-- `p_filas` es un array de objetos con los MISMOS nombres que las columnas de la planilla, ya
-- parseados por la Edge Function (números resueltos, escalas armadas). Una clave AUSENTE significa
-- "no toques este campo"; es la misma semántica de "celda vacía no borra" que rige la planilla desde
-- siempre, y es lo que permite mandar sólo código y precio sin perder fotos ni categorías.
--
-- 🔴 `escalas` es la excepción y necesita distinguir tres cosas: ausente = no tocar; `[]` = borrar
-- la escala (vino `desde_1 = 0`); un array con datos = reemplazarla.
create or replace function public.importar_precios(
  p_empresa        uuid,
  p_filas          jsonb,
  p_lista_completa boolean default false,
  p_usuario        uuid    default null,
  p_origen         text    default 'endpoint'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_recibidas     int;
  v_creados       int := 0;
  v_actualizados  int := 0;
  v_sin_cambio    int := 0;
  v_desc          int := 0;
  v_vigentes      int;
  v_bajas         int;
  v_rechazadas    jsonb := '[]'::jsonb;
  v_resultado     jsonb;
begin
  if p_empresa is null then
    raise exception 'sin empresa';
  end if;
  if jsonb_typeof(p_filas) <> 'array' then
    raise exception 'p_filas tiene que ser un array';
  end if;

  v_recibidas := jsonb_array_length(p_filas);

  -- 🩸 EL `drop` EXPLÍCITO NO SOBRA (encontrado probando, 27/08/2026). `on commit drop` libera la
  -- tabla al cerrar la TRANSACCIÓN, no al terminar la función: dos llamadas dentro de la misma
  -- transacción —o dos requests que caen en la misma conexión del pool de PostgREST antes de un
  -- commit— revientan con `42P07: relation "_filas" already exists`. Es un fallo INTERMITENTE, que
  -- es la peor clase: en la prueba de a una anda siempre, y falla el día que el ERP manda dos
  -- archivos seguidos.
  drop table if exists _filas;

  -- Las filas de entrada, ya normalizadas y DEDUPLICADAS dentro del propio archivo (gana la
  -- primera, igual que la planilla). Sin este paso, un ERP que exporte el mismo código dos veces
  -- haría que el `on conflict` chocara consigo mismo dentro del mismo comando:
  -- "ON CONFLICT DO UPDATE command cannot affect row a second time".
  create temp table _filas on commit drop as
  with crudo as (
    select
      ordinality                                        as fila,
      f->>'codigo'                                      as codigo,
      public.codigo_norm(f->>'codigo')                  as ck,
      nullif(btrim(coalesce(f->>'descripcion','')),'')  as descripcion,
      (f->>'precio_unitario')::numeric                  as precio_unitario,
      (f->>'peso_kg')::numeric                          as peso_kg,
      (f->>'unidades')::int                             as unidades,
      nullif(btrim(coalesce(f->>'categoria','')),'')    as categoria,
      nullif(btrim(coalesce(f->>'marca','')),'')        as marca,
      nullif(btrim(coalesce(f->>'unidad_venta','')),'') as unidad_venta,
      (f->>'nivel_rentabilidad')::smallint              as nivel_rentabilidad,
      (f->>'oferta')::boolean                           as oferta,
      (f->>'precio_oferta')::numeric                    as precio_oferta,
      case when f ? 'escalas' then f->'escalas' else null end as escalas
    from jsonb_array_elements(p_filas) with ordinality as t(f, ordinality)
  )
  select * from (
    select *, row_number() over (partition by ck order by fila) as rn
    from crudo
    where descripcion is not null or ck is not null
  ) x where rn = 1;

  -- Lo que se descartó, para poder decirlo en la respuesta.
  select coalesce(jsonb_agg(jsonb_build_object(
           'fila', ordinality, 'codigo', f->>'codigo', 'motivo', 'sin descripción ni código')), '[]'::jsonb)
    into v_rechazadas
  from jsonb_array_elements(p_filas) with ordinality as t(f, ordinality)
  where nullif(btrim(coalesce(f->>'descripcion','')),'') is null
    and public.codigo_norm(f->>'codigo') is null;

  -- ───────────────────────────────────────────────────────────────────────────
  -- 🔴 EL FRENO DE LAS BAJAS
  -- ───────────────────────────────────────────────────────────────────────────
  -- `lista_completa` da de baja todo lo que no vino en el archivo. En la pantalla eso está a salvo
  -- porque una PERSONA lee el conteo de bajas antes de confirmar (`bajasSiCompleta`). Un endpoint
  -- que dispara solo no tiene esa persona: un export parcial de su servidor —un filtro mal
  -- aplicado un martes a la mañana— descontinuaría el catálogo entero, y nadie se enteraría hasta
  -- que un vendedor abre la app frente a un comercio.
  --
  -- Por eso: no se escribe NADA y se devuelve el número para que lo mire alguien. El umbral es 20 %
  -- del catálogo vigente. La primera carga real —la que reemplaza las 529 filas de fardo por las de
  -- unidad— va a chocar contra esto A PROPÓSITO: esa se hace una vez, a mano, desde la pantalla.
  if p_lista_completa then
    select count(*) into v_vigentes
      from productos where id_empresa = p_empresa and descontinuado_ts is null;

    select count(*) into v_bajas
      from productos p
      where p.id_empresa = p_empresa
        and p.descontinuado_ts is null
        and p.codigo is not null and btrim(p.codigo) <> ''
        and not exists (select 1 from _filas f where f.ck = p.codigo_norm);

    if v_vigentes > 0 and v_bajas::numeric / v_vigentes > 0.20 then
      v_resultado := jsonb_build_object(
        'error', 'demasiadas-bajas',
        'bajas', v_bajas, 'vigentes', v_vigentes,
        'detalle', format('La lista dejaría fuera %s de %s productos vigentes (%s%%). No se escribió nada.',
                          v_bajas, v_vigentes, round(v_bajas::numeric / v_vigentes * 100)));
      insert into ingestas_precios (id_empresa, id_usuario, origen, recibidas, error)
      values (p_empresa, p_usuario, p_origen, v_recibidas, v_resultado->>'detalle');
      return v_resultado;
    end if;
  end if;

  -- ───────────────────────────────────────────────────────────────────────────
  -- EL UPSERT
  -- ───────────────────────────────────────────────────────────────────────────
  -- 🩸 Los conteos se miden ANTES de escribir. La forma "natural" —un `returning` que distinga
  -- insert de update mirando `xmin = xmax`— es un truco que depende de detalles internos de
  -- Postgres y devuelve cualquier cosa según la versión. Contar cuántos códigos del archivo ya
  -- existían es una pregunta simple con una respuesta exacta, y el resto es una resta.
  select count(*) into v_actualizados
    from _filas f
   where f.ck is not null
     and exists (select 1 from productos p where p.id_empresa = p_empresa and p.codigo_norm = f.ck);

  select count(*) into v_creados from _filas f where f.ck is not null;
  v_creados := v_creados - v_actualizados;

  -- ⚠️ SON DOS SENTENCIAS Y NO UN `on conflict do update`, y la razón importa.
  --
  -- 🩸 LA PRIMERA VERSIÓN ERA UN UPSERT Y BORRABA DATOS (encontrado probando, 27/08/2026). Un
  -- `insert ... on conflict do update set x = coalesce(excluded.x, pr.x)` NO puede hacer una
  -- actualización parcial cuando el INSERT necesita defaults: las columnas `precio_unitario`,
  -- `peso_kg` y `escalas` son `not null` o tienen `default`, así que la parte del insert las
  -- rellenaba (`coalesce(f.escalas,'[]')`), y entonces `excluded.escalas` valía `[]` — no NULL.
  -- El `coalesce` de la rama del update no tenía nada que atajar y **pisaba el valor bueno**.
  -- Medido: una segunda importación con sólo `codigo` y `precio` dejaba la descripción en el
  -- código, el peso en 0 y la escala vacía. Es exactamente la invariante que la planilla promete
  -- desde siempre ("celda vacía no borra") y que hace posible mandar sólo la lista de precios sin
  -- arrastrar el maestro entero.
  --
  -- Separado en UPDATE + INSERT, cada campo se compara contra la fila VIVA y no contra un default
  -- inventado. Las dos sentencias corren dentro de la misma transacción (el cuerpo de la función),
  -- así que la atomicidad no se pierde; el índice único sigue impidiendo duplicados.

  -- 1) Los que ya existen. `descontinuado_ts = null` va sin coalesce y a propósito: un producto que
  --    reaparece en la lista se REACTIVA solo, con su foto y su historial intactos.
  update productos p set
    descripcion        = coalesce(f.descripcion,        p.descripcion),
    precio_unitario    = coalesce(f.precio_unitario,    p.precio_unitario),
    peso_kg            = coalesce(f.peso_kg,            p.peso_kg),
    unidades           = coalesce(f.unidades,           p.unidades),
    categoria          = coalesce(f.categoria,          p.categoria),
    marca              = coalesce(f.marca,              p.marca),
    unidad_venta       = coalesce(f.unidad_venta,       p.unidad_venta),
    nivel_rentabilidad = coalesce(f.nivel_rentabilidad, p.nivel_rentabilidad),
    oferta             = coalesce(f.oferta,             p.oferta),
    precio_oferta      = coalesce(f.precio_oferta,      p.precio_oferta),
    -- `escalas` distingue TRES casos y por eso no alcanza un `coalesce` cualquiera: ausente en el
    -- archivo (NULL) = no tocar; `[]` = borrar la escala (vino `desde_1 = 0`); con datos =
    -- reemplazar. El `coalesce` cubre los tres porque `f.escalas` es NULL sólo si la clave no vino.
    escalas            = coalesce(f.escalas,            p.escalas),
    descontinuado_ts   = null
  from _filas f
  where p.id_empresa = p_empresa
    and f.ck is not null
    and p.codigo_norm = f.ck;

  -- 2) Los nuevos. Acá SÍ van los defaults: la fila no existe y las columnas no admiten NULL.
  --    `on conflict do nothing` es la red por si otra corrida lo insertó en el medio.
  insert into productos (
    id, id_empresa, codigo, descripcion, precio_unitario, peso_kg, unidades,
    categoria, marca, unidad_venta, nivel_rentabilidad, oferta, precio_oferta, escalas
  )
  select
    gen_random_uuid(), p_empresa, f.codigo, coalesce(f.descripcion, f.codigo),
    coalesce(f.precio_unitario, 0), coalesce(f.peso_kg, 0), f.unidades,
    f.categoria, f.marca, f.unidad_venta, f.nivel_rentabilidad,
    coalesce(f.oferta, false), f.precio_oferta, coalesce(f.escalas, '[]'::jsonb)
  from _filas f
  where f.ck is not null
    and not exists (
      select 1 from productos p where p.id_empresa = p_empresa and p.codigo_norm = f.ck
    )
  on conflict do nothing;

  -- Bajas por ausencia.
  if p_lista_completa then
    update productos p set descontinuado_ts = now()
     where p.id_empresa = p_empresa
       and p.descontinuado_ts is null
       and p.codigo is not null and btrim(p.codigo) <> ''
       and not exists (select 1 from _filas f where f.ck = p.codigo_norm);
    get diagnostics v_desc = row_count;
  end if;

  v_sin_cambio := greatest(0, v_recibidas - v_creados - v_actualizados - jsonb_array_length(v_rechazadas));

  v_resultado := jsonb_build_object(
    'recibidas', v_recibidas,
    'creados', v_creados,
    'actualizados', v_actualizados,
    'sin_cambio', v_sin_cambio,
    'descontinuados', v_desc,
    'rechazadas', v_rechazadas
  );

  -- La bitácora. Sin esto el pipeline es invisible, que es la lección de 1.19.0: se publicó con
  -- "12 enviados · 0 fallidos" y no le llegó a nadie, porque no había forma de distinguir
  -- "no lo intentó" de "falló".
  insert into ingestas_precios (
    id_empresa, id_usuario, origen, recibidas, creados, actualizados, sin_cambio, descontinuados, rechazadas
  ) values (
    p_empresa, p_usuario, p_origen, v_recibidas, v_creados, v_actualizados, v_sin_cambio, v_desc, v_rechazadas
  );

  return v_resultado;
end;
$$;

-- 🚨 Regla 7-bis: en una función NUEVA hay que revocar de los TRES. Supabase le da EXECUTE
-- explícito a anon y authenticated sobre cada función creada en `public`, y un grant explícito no
-- se va con un revoke a PUBLIC.
--
-- 🔴 Y acá importa más que de costumbre: esta función recibe `p_empresa` COMO PARÁMETRO y es
-- SECURITY DEFINER. Si un usuario logueado pudiera llamarla, podría reescribirle el catálogo entero
-- a cualquier otra distribuidora pasando su uuid. Sólo service_role — o sea, sólo la Edge Function,
-- que resuelve la empresa desde el token y nunca desde el payload.
revoke execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text) from public;
revoke execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text) from anon;
revoke execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text) from authenticated;
grant  execute on function public.importar_precios(uuid, jsonb, boolean, uuid, text) to service_role;

-- `codigo_norm` sí la pueden ejecutar todos: es una función pura de texto, sin acceso a datos, y la
-- necesitan los planes de consulta de cualquier query que use el índice.
commit;

-- VERIFICAR DESPUÉS DE APLICAR (regla 7-bis: mirar el ACL real, no asumir):
--   select proname, proacl from pg_proc where proname in ('importar_precios','codigo_norm');
--   → importar_precios NO puede tener anon ni authenticated.
