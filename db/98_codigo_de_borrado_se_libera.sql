-- 98_codigo_de_borrado_se_libera.sql — el código de un cliente ELIMINADO vuelve a quedar libre (27/10/2026, plan 29).
--
-- 🩸 POR QUÉ. Pedido del usuario: "si se eliminan clientes, esos códigos quedan libres". Desde db/92,
-- borrar un cliente que ya estaba en el ERP deja una lápida (`clientes_export_bajas`) para que el ERP
-- reciba la BAJA — y esa lápida bloqueaba el código PARA SIEMPRE en tres lugares:
-- `siguiente_codigo_cliente`, `cliente_resolver_codigo` (lo reasignaba) y `cliente_export_control`
-- (`codigo-dado-de-baja-en-erp`).
--
-- La regla nueva: la lápida bloquea el código SÓLO MIENTRAS SU BAJA NO SALIÓ (`export_lote is null`).
-- Cuando la BAJA viajó en un lote, el código es libre. Así el ERP recibe siempre la BAJA en el lote N
-- y el ALTA del cliente nuevo con ese código en un lote posterior, que es lo que pide un importador
-- que hace upsert por código.
--
-- ⚠️ El reenvío de lotes viejos (`?repetir=1`, `?lote=N` → `repetir_lote_clientes`) ya no reemite la
-- BAJA de un código que hoy tiene un cliente vivo: si la reemitiera, el ERP le daría de baja al nuevo.
--
-- Los ARCHIVADOS no cambian: siguen ocupando su código (pueden volver a la cartera).
-- Junto con esto el piso (`export_erp.cliente_codigo_min`) baja a 1: los nuevos llenan huecos.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) EL PRÓXIMO CÓDIGO LIBRE: la lápida cuenta como ocupada sólo si su BAJA está pendiente
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.siguiente_codigo_cliente(p_empresa uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with piso as (
    select greatest(1, coalesce((
      select case when (e.export_erp ->> 'cliente_codigo_min') ~ '^\d{1,18}$'
                  then (e.export_erp ->> 'cliente_codigo_min')::bigint end
        from public.empresas e where e.id = p_empresa), 1)) as n
  ),
  usados as (
    select c.codigo_norm::bigint as n
      from public.clientes c
     where c.id_empresa = p_empresa and c.codigo_norm ~ '^\d{1,18}$'
    union
    -- db/98: sólo las lápidas cuya BAJA todavía no salió.
    select b.codigo_norm::bigint
      from public.clientes_export_bajas b
     where b.id_empresa = p_empresa and b.codigo_norm ~ '^\d{1,18}$'
       and b.export_lote is null
  )
  select min(x.n)::text
    from (select p.n from piso p
          union all
          select u.n + 1 from usados u, piso p where u.n + 1 >= p.n) x
   where not exists (select 1 from usados u where u.n = x.n);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) EL ALTA: igual a db/97 salvo la condición de la lápida (🔴 db/98)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cliente_resolver_codigo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_titular public.clientes;
  v_ts_titular timestamptz;
begin
  /* 🔴 EL REINTENTO DE LA COLA. `writeQueue` inserta con `ON CONFLICT (id) DO NOTHING`, y un BEFORE
   * INSERT corre IGUAL antes de que Postgres vea el conflicto. Sin esta guarda, el reintento de un
   * cliente que ya subió se encontraría a sí mismo como "titular" de su código y le correría el
   * número a otro comercio. Si la fila ya existe, no se toca nada: el insert se descarta. */
  if exists (select 1 from public.clientes c where c.id = new.id) then
    return new;
  end if;

  -- El cursor y la reasignación nacen limpios: el payload no los decide.
  new.export_version       := 1;
  new.export_enviada       := null;
  new.exportado_ts         := null;
  new.export_lote          := null;
  new.export_ultimo_lote   := null;
  new.codigo_solicitado    := null;
  new.codigo_reasignado_ts := null;

  if new.id_empresa is null then return new; end if; -- la policy de INSERT lo rechaza igual

  -- Una sola alta por empresa a la vez. `tomar_lote_clientes` toma el mismo cerrojo.
  perform pg_advisory_xact_lock(hashtext('codigo_cliente:' || new.id_empresa::text));

  if coalesce(btrim(new.codigo), '') = '' then
    new.codigo := public.siguiente_codigo_cliente(new.id_empresa);
    return new;
  end if;

  -- 🔴 db/98: un código con la BAJA todavía sin salir al ERP no se usa (el ERP recibiría el ALTA
  -- antes o en el mismo lote que la BAJA). Con la BAJA ya enviada, el código es libre.
  if exists (select 1 from public.clientes_export_bajas b
              where b.id_empresa = new.id_empresa and b.codigo_norm = public.codigo_norm(new.codigo)
                and b.export_lote is null) then
    new.codigo_solicitado    := new.codigo;
    new.codigo               := public.siguiente_codigo_cliente(new.id_empresa);
    new.codigo_reasignado_ts := now();
    return new;
  end if;

  select * into v_titular
    from public.clientes c
   where c.id_empresa = new.id_empresa
     and c.codigo_norm = public.codigo_norm(new.codigo)
     and coalesce(btrim(c.codigo), '') <> ''
   limit 1
   for update;

  if not found then return new; end if;

  /* 🔴 db/97. Mismo código Y mismo nombre: no es un choque entre dos teléfonos, es el mismo comercio
   * entrando dos veces (una planilla reimportada sin cruzar, un alta repetida). Reasignarle otro
   * número creaba una copia silenciosa —así nacieron las 2000 del 26/10/2026—. Se rechaza. */
  if lower(regexp_replace(btrim(v_titular.nombre_comercio), '\s+', ' ', 'g'))
   = lower(regexp_replace(btrim(new.nombre_comercio), '\s+', ' ', 'g')) then
    raise exception 'cliente-duplicado'
      using hint = format('Ya existe "%s" con el código %s: se actualiza, no se vuelve a crear.',
                          v_titular.nombre_comercio, v_titular.codigo);
  end if;

  v_ts_titular := coalesce(v_titular.creado_ts, v_titular.created_at);

  if v_titular.exportado_ts is null and new.creado_ts < v_ts_titular then
    -- El que llega se creó ANTES y el titular todavía no está en el ERP: el código es del que llega
    -- y al titular se le da el siguiente libre (que no puede ser el disputado: lo tiene el titular).
    -- El UPDATE pasa por `clientes_zz_export_control`, que sube su versión.
    update public.clientes
       set codigo_solicitado    = coalesce(codigo_solicitado, codigo),
           codigo               = public.siguiente_codigo_cliente(new.id_empresa),
           codigo_reasignado_ts = now()
     where id = v_titular.id;
  else
    -- Posterior, empate (gana el que llegó primero) o titular ya enviado: el que llega se corre.
    new.codigo_solicitado    := new.codigo;
    new.codigo               := public.siguiente_codigo_cliente(new.id_empresa);
    new.codigo_reasignado_ts := now();
  end if;

  return new;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) EL CAMBIO DE CÓDIGO EN LA FICHA: misma regla (🔴 db/98)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cliente_export_control()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('distat.export_bypass', true), '') = 'on' then return new; end if;

  if new.export_enviada     is distinct from old.export_enviada
  or new.exportado_ts       is distinct from old.exportado_ts
  or new.export_lote        is distinct from old.export_lote
  or new.export_ultimo_lote is distinct from old.export_ultimo_lote
  then
    raise exception 'cursor-de-exportacion-no-editable';
  end if;
  new.export_version := old.export_version;

  if new.codigo is distinct from old.codigo then
    if old.exportado_ts is not null then
      raise exception 'cliente-ya-exportado'
        using hint = 'Este cliente ya está en el sistema de gestión con ese código. La corrección se hace allá.';
    end if;
    if exists (select 1 from public.clientes_export_bajas b
                where b.id_empresa = new.id_empresa and b.codigo_norm = public.codigo_norm(new.codigo)
                  and b.export_lote is null) then
      raise exception 'codigo-dado-de-baja-en-erp'
        using hint = 'Ese código lo tuvo un cliente que se borró y su baja todavía no salió al ERP. Probá de nuevo después del próximo envío.';
    end if;
  end if;

  -- Los datos que viajan en `Clientes.txt` (`web/src/lib/asciiClientes.js`). La fecha de alta no:
  -- no se edita.
  if new.codigo          is distinct from old.codigo
  or new.nombre_comercio is distinct from old.nombre_comercio
  or new.localidad       is distinct from old.localidad
  or new.telefono        is distinct from old.telefono
  or new.contacto        is distinct from old.contacto
  or new.id_vendedor     is distinct from old.id_vendedor
  or new.lat             is distinct from old.lat
  or new.lng             is distinct from old.lng
  or (new.archivado_ts is null) <> (old.archivado_ts is null)
  then
    new.export_version := old.export_version + 1;
  end if;

  return new;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) EL REENVÍO DE UN LOTE VIEJO NO DA DE BAJA AL QUE HOY TIENE ESE CÓDIGO
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.repetir_lote_clientes(p_empresa uuid, p_lote bigint default null)
returns table(id_cliente uuid, id_baja bigint, tipo text, lote bigint)
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select x.lote, x.ids, x.bajas
      from public.exportaciones_clientes x
     where x.id_empresa = p_empresa and x.lote is not null
       and (p_lote is null or x.lote = p_lote)
     order by x.lote desc
     limit 1
  )
  select null::uuid, b.id, 'BAJA'::text, e.lote
    from e join public.clientes_export_bajas b on b.id = any (e.bajas) and b.id_empresa = p_empresa
   -- db/98: si el código ya lo reutilizó un cliente, esa BAJA vieja no se reemite.
   where not exists (select 1 from public.clientes c
                      where c.id_empresa = p_empresa and c.codigo_norm = b.codigo_norm)
  union all
  select c.id, null::bigint,
         case when c.archivado_ts is not null then 'BAJA'
              when c.export_lote = e.lote then 'ALTA'
              else 'MODIFICACION' end,
         e.lote
    from e join public.clientes c on c.id = any (e.ids) and c.id_empresa = p_empresa;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) EL PISO BAJA A 1: los clientes nuevos llenan los huecos (plan 29)
-- ─────────────────────────────────────────────────────────────────────────────
update public.empresas
   set export_erp = jsonb_set(export_erp, '{cliente_codigo_min}', '1')
 where export_erp ? 'cliente_codigo_min';

notify pgrst, 'reload schema';

commit;

-- VERIFICACIÓN:
--   select public.siguiente_codigo_cliente('<id_empresa>');   -- el primer hueco (20 en La Unión, 27/10)
--   select export_erp->>'cliente_codigo_min' from public.empresas;   -- 1
