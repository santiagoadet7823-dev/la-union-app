-- 92_clientes_erp.sql — DisT-At da el código del cliente y le manda al ERP altas, modificaciones y bajas.
-- 25/10/2026. Plan: `D:\Dist-At (LA UNION)\planes\24-clientes-erp-envio.md`.
-- Reemplaza a `db/86_clientes_erp_codigos.sql` (rama `clientes-erp`, nunca aplicada), de donde sale
-- la mayor parte de este archivo.
--
-- 🩸 POR QUÉ EXISTE. La Unión modifica su ERP para que lea SOLO los clientes que le manda DisT-At y
-- los actualice cuando cambian. DisT-At pasa a ser el dueño de la cartera: da el código, y cada 30
-- minutos la PC del ERP baja `Clientes.txt` desde `export-clientes` con lo que cambió.
--
-- 🔑 CADA FILA DEL ARCHIVO ES EL ESTADO COMPLETO DEL CLIENTE + `ALTA` / `MODIFICACION` / `BAJA`. El
-- importador hace upsert por código, así que mandar de nuevo una fila nunca rompe nada.
--
-- 🔑 EL CURSOR ES UNA VERSIÓN POR FILA, no una marca de "ya salió". `export_version` sube con cada
-- cambio de un dato que viaja; `export_enviada` es la versión que se llevó el ERP. Pendiente =
-- `export_version > coalesce(export_enviada, 0)`. Al aplicar, TODA la cartera queda pendiente: el
-- primer archivo es la cartera completa (el ERP se queda con lo que le mandemos).
--
-- 🔑 EL SERVIDOR ES LA AUTORIDAD DEL CÓDIGO (de db/86). El teléfono propone el primer libre desde el
-- piso contra su copia local; dos vendedores sin señal pueden proponer el mismo. El trigger
-- `clientes_resolver_codigo` resuelve el choque: gana el que se creó antes (`creado_ts`, hora del
-- dispositivo) mientras el otro no se haya enviado; al perdedor le da el siguiente libre.
--
-- 🔴 LA LLAVE. `empresas.export_erp.clientes_activo` arranca en `false`: mientras el ERP no lea
-- `Clientes.txt`, los pedidos salen exactamente como hoy. Al prenderla, un pedido espera a que su
-- cliente haya llegado al ERP (como mucho un ciclo de 30 minutos).
--
-- ⚠️ GEMELOS SQL/JS (regla 36): `siguiente_codigo_cliente()` ↔ `primerCodigoLibre()`
-- (`web/src/lib/codigoCliente.js`); `pedido_exportable()` ↔ `motivoRetencion()`
-- (`web/src/features/pedidos/exportado.js`). El del teléfono SUGIERE; éste DECIDE.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) COLUMNAS: LA REASIGNACIÓN Y EL CURSOR POR VERSIÓN
-- ─────────────────────────────────────────────────────────────────────────────

-- El código que pidió el teléfono cuando el servidor tuvo que darle otro (la ficha lo muestra).
alter table public.clientes add column if not exists codigo_solicitado    text;
alter table public.clientes add column if not exists codigo_reasignado_ts timestamptz;
-- El cursor. `exportado_ts`/`export_lote` = la PRIMERA vez que salió (desde ahí el código queda
-- congelado); `export_ultimo_lote` = el último lote en que viajó.
alter table public.clientes add column if not exists export_version     int not null default 1;
alter table public.clientes add column if not exists export_enviada     int;
alter table public.clientes add column if not exists exportado_ts       timestamptz;
alter table public.clientes add column if not exists export_lote        bigint;
alter table public.clientes add column if not exists export_ultimo_lote bigint;

create index if not exists clientes_pendiente_export_idx
  on public.clientes (id_empresa)
  where export_version > coalesce(export_enviada, 0);

-- LAS LÁPIDAS. Un cliente que ya llegó al ERP y se BORRA (no archiva) no puede salir del archivo
-- en silencio: el ERP lo seguiría teniendo activo. El borrado deja acá su código y sale como `BAJA`
-- en el lote siguiente. El código queda ocupado para siempre: el ERP lo conoce.
create table if not exists public.clientes_export_bajas (
  id              bigint generated always as identity primary key,
  id_empresa      uuid not null references public.empresas(id) on delete cascade,
  id_cliente      uuid not null,            -- sin FK: el cliente ya no existe
  codigo          text not null,
  codigo_norm     text generated always as (public.codigo_norm(codigo)) stored,
  nombre_comercio text,
  ts              timestamptz not null default now(),
  borrado_por     uuid,
  export_lote     bigint                    -- null = todavía no salió
);

create index if not exists clientes_export_bajas_pend_idx
  on public.clientes_export_bajas (id_empresa) where export_lote is null;
create index if not exists clientes_export_bajas_codigo_idx
  on public.clientes_export_bajas (id_empresa, codigo_norm);

alter table public.clientes_export_bajas enable row level security;

drop policy if exists clientes_export_bajas_sel on public.clientes_export_bajas;
create policy clientes_export_bajas_sel on public.clientes_export_bajas
  for select using (es_superadmin() or (id_empresa = mi_empresa() and es_admin()));

drop policy if exists clientes_export_bajas_no_marketing on public.clientes_export_bajas;
create policy clientes_export_bajas_no_marketing on public.clientes_export_bajas
  as restrictive for all to authenticated
  using ((select public.mi_rol()) is distinct from 'marketing')
  with check ((select public.mi_rol()) is distinct from 'marketing');

revoke all on public.clientes_export_bajas from anon;
revoke insert, update, delete on public.clientes_export_bajas from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) EL PISO Y LA LLAVE (por empresa, en `empresas.export_erp`)
-- ─────────────────────────────────────────────────────────────────────────────

/* `cliente_codigo_min` arranca en "máximo + 1" (2803 en La Unión, decisión del 25/10: no se rellenan
 * los huecos). Para reutilizarlos, se baja a mano:
 *   update empresas set export_erp = jsonb_set(export_erp, '{cliente_codigo_min}', '1') where id = '<id>';
 * `clientes_activo` arranca en false (la llave de la retención de pedidos, sección 7).
 * Sólo se escriben si la clave no existe: re-aplicar este archivo no pisa lo que se cambió a mano. */
update public.empresas e
   set export_erp = coalesce(e.export_erp, '{}'::jsonb)
                    || jsonb_build_object('cliente_codigo_min', coalesce((
                         select max(c.codigo_norm::bigint) + 1
                           from public.clientes c
                          where c.id_empresa = e.id and c.codigo_norm ~ '^\d{1,18}$'), 1))
 where not coalesce(e.export_erp, '{}'::jsonb) ? 'cliente_codigo_min';

update public.empresas e
   set export_erp = coalesce(e.export_erp, '{}'::jsonb) || '{"clientes_activo": false}'::jsonb
 where not coalesce(e.export_erp, '{}'::jsonb) ? 'clientes_activo';

/* El menor número >= piso que nadie usa: ni un cliente (vigente o archivado: el índice único no
 * distingue) ni una lápida (el ERP todavía conoce ese código). El hueco más bajo es el piso o el
 * siguiente de algún código usado, así que basta mirar esos candidatos. Compara por `codigo_norm`
 * (`0712` ocupa el 712) y sólo cuentan los códigos numéricos, como `primerCodigoLibre`. */
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
    select b.codigo_norm::bigint
      from public.clientes_export_bajas b
     where b.id_empresa = p_empresa and b.codigo_norm ~ '^\d{1,18}$'
  )
  select min(x.n)::text
    from (select p.n from piso p
          union all
          select u.n + 1 from usados u, piso p where u.n + 1 >= p.n) x
   where not exists (select 1 from usados u where u.n = x.n);
$$;

revoke execute on function public.siguiente_codigo_cliente(uuid) from public, anon, authenticated;
grant  execute on function public.siguiente_codigo_cliente(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) LA HORA DEL ALTA ES LA DEL DISPOSITIVO (reemplaza la función del trigger de db/89)
-- ─────────────────────────────────────────────────────────────────────────────

/* Igual a la de db/89 salvo una línea: `creado_ts` deja de ser `now()` y pasa a ser la hora del
 * teléfono al tocar "Guardar", recortada a `now()` (un reloj adelantado no gana prioridad). Es la
 * que decide quién se queda un código si dos vendedores sin señal tomaron el mismo. */
create or replace function public.clientes_alta_y_zona()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  yo uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.creado_por := coalesce(yo, new.creado_por);
    new.creado_ts := least(coalesce(new.creado_ts, now()), now());
  elsif yo is not null and (new.creado_por is distinct from old.creado_por
                            or new.creado_ts is distinct from old.creado_ts) then
    raise exception 'rastreo-de-alta-no-editable'
      using hint = 'Quién creó el cliente y cuándo no se pueden cambiar.';
  end if;

  if yo is not null and new.id_zona is not null
     and (tg_op = 'INSERT' or new.id_zona is distinct from old.id_zona)
     and (select public.mi_rol()) = 'vendedor' then
    if not exists (select 1 from public.zonas z where z.id = new.id_zona and z.id_vendedor = yo)
       or (tg_op = 'UPDATE' and old.id_zona is not null
           and not exists (select 1 from public.zonas z where z.id = old.id_zona and z.id_vendedor = yo)) then
      raise exception 'zona-ajena'
        using hint = 'Esa zona es de otro vendedor.';
    end if;
  end if;
  return new;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) LA COLISIÓN SE RESUELVE EN EL SERVIDOR (BEFORE INSERT)
-- ─────────────────────────────────────────────────────────────────────────────

/* Corre DESPUÉS de `clientes_alta_y_zona` (los BEFORE van por orden alfabético), así que
 * `creado_ts` ya viene recortado y `creado_por` ya es `auth.uid()`. */
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

  -- Un código que el ERP dio de baja (lápida) no se vuelve a usar.
  if exists (select 1 from public.clientes_export_bajas b
              where b.id_empresa = new.id_empresa and b.codigo_norm = public.codigo_norm(new.codigo)) then
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

revoke execute on function public.cliente_resolver_codigo() from public, anon, authenticated;
grant  execute on function public.cliente_resolver_codigo() to service_role;

drop trigger if exists clientes_resolver_codigo on public.clientes;
create trigger clientes_resolver_codigo
  before insert on public.clientes
  for each row execute function public.cliente_resolver_codigo();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) CADA CAMBIO QUE VIAJA SUBE LA VERSIÓN; LO ENVIADO NO CAMBIA DE CÓDIGO (BEFORE UPDATE)
-- ─────────────────────────────────────────────────────────────────────────────

/* El nombre empieza con `zz` a propósito: los BEFORE van por orden alfabético y éste tiene que
 * correr DESPUÉS de `clientes_hereda_vendedor_de_zona`, que cambia `id_vendedor` cuando cambia la
 * zona (y el vendedor viaja en el archivo).
 *
 * `distat.export_bypass = on` lo prenden (con `set_config` local, y lo devuelven a como estaba al
 * terminar) las RPC de exportación y el trigger de `clientes_fiscal`: ellos sí mueven el cursor.
 * 🩸 No se puede poner como `SET` de la función: en el servidor propio `postgres` no es superusuario
 * y Postgres no deja fijar así una variable propia ("permission denied to set parameter"). */
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
                where b.id_empresa = new.id_empresa and b.codigo_norm = public.codigo_norm(new.codigo)) then
      raise exception 'codigo-dado-de-baja-en-erp'
        using hint = 'Ese código lo tuvo un cliente que se borró y el ERP lo sigue conociendo.';
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

revoke execute on function public.cliente_export_control() from public, anon, authenticated;

drop trigger if exists clientes_zz_export_control on public.clientes;
create trigger clientes_zz_export_control
  before update on public.clientes
  for each row execute function public.cliente_export_control();

-- La condición de IVA y el CUIT también viajan (campos 10-11), pero viven en `clientes_fiscal`.
create or replace function public.cliente_fiscal_export_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_prev text := current_setting('distat.export_bypass', true);
begin
  if tg_op = 'DELETE' then
    v_id := old.id_cliente;
  elsif tg_op = 'INSERT' then
    if new.condicion_iva is null and new.cuit is null then return null; end if;
    v_id := new.id_cliente;
  else
    if new.condicion_iva is not distinct from old.condicion_iva
       and new.cuit is not distinct from old.cuit then return null; end if;
    v_id := new.id_cliente;
  end if;
  -- Si el cliente se está borrando (cascada), no hay fila: el UPDATE no hace nada.
  perform set_config('distat.export_bypass', 'on', true);
  update public.clientes set export_version = export_version + 1 where id = v_id;
  perform set_config('distat.export_bypass', coalesce(v_prev, ''), true);
  return null;
end $$;

revoke execute on function public.cliente_fiscal_export_version() from public, anon, authenticated;

drop trigger if exists clientes_fiscal_export_version on public.clientes_fiscal;
create trigger clientes_fiscal_export_version
  after insert or update or delete on public.clientes_fiscal
  for each row execute function public.cliente_fiscal_export_version();

-- El borrado de un cliente que ya está en el ERP deja su lápida.
create or replace function public.cliente_export_lapida()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.exportado_ts is not null and coalesce(btrim(old.codigo), '') <> '' then
    insert into public.clientes_export_bajas (id_empresa, id_cliente, codigo, nombre_comercio, borrado_por)
    values (old.id_empresa, old.id, old.codigo, old.nombre_comercio, auth.uid());
  end if;
  return old;
end $$;

revoke execute on function public.cliente_export_lapida() from public, anon, authenticated;

drop trigger if exists clientes_export_lapida on public.clientes;
create trigger clientes_export_lapida
  after delete on public.clientes
  for each row execute function public.cliente_export_lapida();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) LA BITÁCORA Y EL LOTE
-- ─────────────────────────────────────────────────────────────────────────────

-- Calcada de `exportaciones_pedidos` (db/62 + db/64): la fila del lote nace en la misma RPC que
-- marca los clientes, y los rechazos también dejan fila. `bajas` = ids de las lápidas del lote.
create table if not exists public.exportaciones_clientes (
  id          uuid primary key default gen_random_uuid(),
  id_empresa  uuid not null references public.empresas(id) on delete cascade,
  id_usuario  uuid references public.perfiles(id),
  ts          timestamptz not null default now(),
  lote        bigint,
  clientes    int  not null default 0,
  ids         uuid[] not null default '{}',
  bajas       bigint[] not null default '{}',
  bytes       int,
  ip          text,
  agente      text,
  origen      text,          -- 'endpoint' | 'reposicion' | 'repeticion'
  error       text
);

create index if not exists exportaciones_clientes_empresa_idx
  on public.exportaciones_clientes (id_empresa, ts desc);
create unique index if not exists exportaciones_clientes_lote_uidx
  on public.exportaciones_clientes (id_empresa, lote) where lote is not null;

alter table public.exportaciones_clientes enable row level security;

-- Lectura para admin/superadmin, igual que la de pedidos. Sin policy de escritura: la escriben
-- `service_role` (Edge Function) y las RPC de abajo.
drop policy if exists exportaciones_clientes_sel on public.exportaciones_clientes;
create policy exportaciones_clientes_sel on public.exportaciones_clientes
  for select using (es_superadmin() or (id_empresa = mi_empresa() and es_admin()));

drop policy if exists exportaciones_clientes_no_marketing on public.exportaciones_clientes;
create policy exportaciones_clientes_no_marketing on public.exportaciones_clientes
  as restrictive for all to authenticated
  using ((select public.mi_rol()) is distinct from 'marketing')
  with check ((select public.mi_rol()) is distinct from 'marketing');

/* Toma lo pendiente, lo marca y lo devuelve en una sola transacción (dos corridas del script no se
 * llevan lo mismo). Una fila por cliente o lápida, en el orden del archivo: primero las lápidas,
 * después los clientes por hora de alta.
 *   · `ALTA`         nunca salió;
 *   · `MODIFICACION` ya salió y cambió algo que viaja;
 *   · `BAJA`         archivado (si nunca salió, no se manda: queda pendiente por si se desarchiva)
 *                    o lápida.
 * Un vigente sin código no sale (el trigger de alta ya no lo deja nacer así).
 * `p_marcar = false` mira qué saldría sin marcar ni reservar número de lote. */
drop function if exists public.tomar_lote_clientes(uuid, uuid, boolean);
create function public.tomar_lote_clientes(
  p_empresa uuid,
  p_usuario uuid default null,
  p_marcar  boolean default true
)
returns table (id_cliente uuid, id_baja bigint, tipo text, lote bigint)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lote bigint;
  v_prev text := current_setting('distat.export_bypass', true);
begin
  perform set_config('distat.export_bypass', 'on', true);
  perform pg_advisory_xact_lock(hashtext('codigo_cliente:' || p_empresa::text));
  perform pg_advisory_xact_lock(hashtext('export_clientes:' || p_empresa::text));

  select coalesce(max(e.lote), 0) + 1 into v_lote
    from public.exportaciones_clientes e
   where e.id_empresa = p_empresa;

  if not p_marcar then
    return query
      select u.idc, u.idb, u.tp, v_lote
        from (select null::uuid as idc, b.id as idb, 'BAJA'::text as tp, 0 as g, b.ts as t1, b.ts as t2
                from public.clientes_export_bajas b
               where b.id_empresa = p_empresa and b.export_lote is null
              union all
              select c.id, null::bigint,
                     case when c.archivado_ts is not null then 'BAJA'
                          when c.export_enviada is null then 'ALTA'
                          else 'MODIFICACION' end,
                     1, c.creado_ts, c.created_at
                from public.clientes c
               where c.id_empresa = p_empresa
                 and c.export_version > coalesce(c.export_enviada, 0)
                 and coalesce(btrim(c.codigo), '') <> ''
                 and (c.archivado_ts is null or c.export_enviada is not null)) u
       order by u.g, u.t1, u.t2;
    perform set_config('distat.export_bypass', coalesce(v_prev, ''), true);
    return;
  end if;

  return query
    with lapidas as (
      update public.clientes_export_bajas b
         set export_lote = v_lote
       where b.id_empresa = p_empresa and b.export_lote is null
      returning b.id, b.ts
    ),
    previo as (
      select c.id, c.export_enviada as enviada
        from public.clientes c
       where c.id_empresa = p_empresa
         and c.export_version > coalesce(c.export_enviada, 0)
         and coalesce(btrim(c.codigo), '') <> ''
         and (c.archivado_ts is null or c.export_enviada is not null)
       for update
    ),
    tomados as (
      update public.clientes c
         set export_enviada     = c.export_version,
             exportado_ts       = coalesce(c.exportado_ts, now()),
             export_lote        = coalesce(c.export_lote, v_lote),
             export_ultimo_lote = v_lote
        from previo p
       where c.id = p.id
      returning c.id, c.creado_ts, c.created_at,
                case when c.archivado_ts is not null then 'BAJA'
                     when p.enviada is null then 'ALTA'
                     else 'MODIFICACION' end as tipo
    ),
    registro as (
      insert into public.exportaciones_clientes (id_empresa, id_usuario, lote, clientes, ids, bajas, origen)
      select p_empresa, p_usuario, v_lote,
             (select count(*) from tomados)::int + (select count(*) from lapidas)::int,
             coalesce((select array_agg(t.id) from tomados t), '{}'),
             coalesce((select array_agg(l.id) from lapidas l), '{}'),
             'endpoint'
       where exists (select 1 from tomados) or exists (select 1 from lapidas)
    )
    select u.idc, u.idb, u.tp, v_lote
      from (select null::uuid as idc, l.id as idb, 'BAJA'::text as tp, 0 as g, l.ts as t1, l.ts as t2
              from lapidas l
            union all
            select t.id, null::bigint, t.tipo, 1, t.creado_ts, t.created_at
              from tomados t) u
     order by u.g, u.t1, u.t2;
  perform set_config('distat.export_bypass', coalesce(v_prev, ''), true);
end
$fn$;

revoke execute on function public.tomar_lote_clientes(uuid, uuid, boolean) from public, anon, authenticated;
grant  execute on function public.tomar_lote_clientes(uuid, uuid, boolean) to service_role;

/* REPETIR un lote ("la respuesta salió bien pero el archivo se perdió del lado del ERP"). No mueve
 * el cursor. Manda el estado ACTUAL de los clientes de ese lote (cada fila es el estado completo,
 * así que es lo correcto); el tipo: `BAJA` si hoy está archivado, `ALTA` si ese lote fue su primera
 * salida, `MODIFICACION` si no. Las lápidas, `BAJA`. `p_lote = null` = el último. */
create or replace function public.repetir_lote_clientes(p_empresa uuid, p_lote bigint default null)
returns table (id_cliente uuid, id_baja bigint, tipo text, lote bigint)
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
  union all
  select c.id, null::bigint,
         case when c.archivado_ts is not null then 'BAJA'
              when c.export_lote = e.lote then 'ALTA'
              else 'MODIFICACION' end,
         e.lote
    from e join public.clientes c on c.id = any (e.ids) and c.id_empresa = p_empresa;
$$;

revoke execute on function public.repetir_lote_clientes(uuid, bigint) from public, anon, authenticated;
grant  execute on function public.repetir_lote_clientes(uuid, bigint) to service_role;

-- Un superadmin vuelve a poner clientes en la fila de salida. Se llama desde la app, con sesión:
-- conserva EXECUTE para `authenticated` y valida el rol adentro.
drop function if exists public.reponer_clientes_para_export(uuid[], text);
create function public.reponer_clientes_para_export(p_ids uuid[], p_motivo text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_empresa uuid;
  v_prev text := current_setting('distat.export_bypass', true);
begin
  if not es_superadmin() then
    raise exception 'solo-superadmin';
  end if;

  select c.id_empresa into v_empresa from public.clientes c where c.id = any (p_ids) limit 1;

  perform set_config('distat.export_bypass', 'on', true);
  update public.clientes c
     set export_version = greatest(c.export_version, coalesce(c.export_enviada, 0) + 1)
   where c.id = any (p_ids);
  get diagnostics v_n = row_count;
  perform set_config('distat.export_bypass', coalesce(v_prev, ''), true);

  insert into public.exportaciones_clientes (id_empresa, id_usuario, clientes, ids, origen, error)
  values (v_empresa, auth.uid(), v_n, p_ids, 'reposicion', p_motivo);

  return v_n;
end $$;

revoke execute on function public.reponer_clientes_para_export(uuid[], text) from public, anon;
grant  execute on function public.reponer_clientes_para_export(uuid[], text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) UN PEDIDO NO SALE ANTES QUE SU CLIENTE (detrás de la llave)
-- ─────────────────────────────────────────────────────────────────────────────

/* La versión viva (db/74) + una condición: si la llave `clientes_activo` de la empresa está
 * prendida, el cliente tiene que haber llegado ya al ERP. Con la llave apagada es idéntica a hoy. */
create or replace function public.pedido_exportable(p_cliente uuid, p_vendedor uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.clientes c
                   join public.empresas e on e.id = c.id_empresa
                  where c.id = p_cliente and coalesce(c.codigo, '') <> ''
                    and (c.exportado_ts is not null
                         or coalesce(e.export_erp ->> 'clientes_activo', 'false') <> 'true'))
     and exists (select 1 from public.perfiles v
                  where v.id = p_vendedor
                    and (coalesce(v.codigo_erp, '') <> '' or v.numero is not null));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) EL TOKEN Y EL SELLO DE LA CARTERA
-- ─────────────────────────────────────────────────────────────────────────────

-- Una superficie más: un token de pedidos no lee la cartera y viceversa.
alter table public.ingesta_tokens drop constraint if exists ingesta_tokens_proposito_chk;
alter table public.ingesta_tokens add constraint ingesta_tokens_proposito_chk
  check (proposito = any (array['gps','precios','pedidos','clientes']));

/* Calcado de `sello_precios()`: un teléfono abierto se entera de altas y reasignaciones sin esperar
 * al próximo arranque en frío. Marketing no ve la cartera (db/82): para ese rol devuelve NULL. */
create or replace function public.sello_clientes()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select greatest(max(c.created_at), max(c.codigo_reasignado_ts))
    from public.clientes c
   where c.id_empresa = (select mi_empresa())
     and (select mi_rol()) is distinct from 'marketing';
$$;

revoke execute on function public.sello_clientes() from public, anon;
grant  execute on function public.sello_clientes() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) LOS VIGENTES SIN CÓDIGO RECIBEN UNO (25/10: uno solo, "TV CANCHA EL POTRERO")
-- ─────────────────────────────────────────────────────────────────────────────

-- Uno por uno y en orden de alta: cada asignación tiene que ver la anterior.
do $$
declare
  r record;
begin
  for r in
    select c.id, c.id_empresa from public.clientes c
     where c.archivado_ts is null and coalesce(btrim(c.codigo), '') = ''
     order by c.created_at
  loop
    update public.clientes set codigo = public.siguiente_codigo_cliente(r.id_empresa) where id = r.id;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) AUTOCHEQUEO: si algo no quedó como dice este archivo, la migración FALLA.
-- ─────────────────────────────────────────────────────────────────────────────

/* Las pruebas corren en la empresa con menos clientes ("Prueba SaaS"), dentro de un sub-bloque que
 * termina con una excepción propia (P0099): Postgres deshace todo lo del sub-bloque y el
 * `exception when` la ataja. Cualquier otra excepción aborta la migración entera. */
do $$
declare
  v_emp uuid;
  v_vend uuid;
  v_x text;
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  e uuid := gen_random_uuid();
  f uuid := gen_random_uuid();
  g uuid := gen_random_uuid();
  v_a text; v_b text; v_c text; v_d text; v_y text;
  n int;
  v_n int;
  faltan text;
begin
  -- ACL (reglas 7 y 7-bis).
  select string_agg(p.proname || '=' || coalesce(p.proacl::text, 'NULL'), ', ') into faltan
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('siguiente_codigo_cliente', 'cliente_resolver_codigo', 'tomar_lote_clientes',
                       'repetir_lote_clientes', 'cliente_fiscal_export_version', 'cliente_export_lapida')
     and (p.proacl::text like '%anon=%' or p.proacl::text like '%authenticated=%' or p.proacl is null);
  if faltan is not null then
    raise exception 'db/92: EXECUTE de más en: %', faltan;
  end if;

  if not exists (select 1 from pg_policies where tablename = 'exportaciones_clientes'
                  and policyname = 'exportaciones_clientes_no_marketing' and permissive = 'RESTRICTIVE')
  or not exists (select 1 from pg_policies where tablename = 'clientes_export_bajas'
                  and policyname = 'clientes_export_bajas_no_marketing' and permissive = 'RESTRICTIVE') then
    raise exception 'db/92: falta una policy restrictiva sin marketing';
  end if;

  if exists (select 1 from public.clientes where archivado_ts is null and coalesce(btrim(codigo), '') = '') then
    raise exception 'db/92: quedó un vigente sin código';
  end if;

  select em.id into v_emp
    from public.empresas em
   order by (select count(*) from public.clientes cl where cl.id_empresa = em.id), em.nombre
   limit 1;
  select p.id into v_vend from public.perfiles p where p.numero is not null limit 1;
  if v_emp is null then return; end if;

  begin
    -- Lo que la base ya tenía de esta empresa sale de la fila, para que los conteos sean sólo de la prueba.
    perform public.tomar_lote_clientes(v_emp, null, true);

    v_x := public.siguiente_codigo_cliente(v_emp);

    -- (1) A llega primero pero se creó DESPUÉS que B: B se queda el código, A se corre.
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (a, v_emp, 'db92 prueba A', v_x, now() - interval '10 minutes');
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (b, v_emp, 'db92 prueba B', v_x, now() - interval '20 minutes');
    select codigo into v_a from public.clientes where id = a;
    select codigo into v_b from public.clientes where id = b;
    if v_b is distinct from v_x or v_a = v_x or v_a is null
    or (select codigo_solicitado from public.clientes where id = a) is distinct from v_x then
      raise exception 'db/92: prioridad por horario mal resuelta (x=%, A=%, B=%)', v_x, v_a, v_b;
    end if;

    -- (2) El otro orden: E (antes) llega primero, F (después) con el mismo código se corre.
    v_y := public.siguiente_codigo_cliente(v_emp);
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (e, v_emp, 'db92 prueba E', v_y, now() - interval '20 minutes');
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (f, v_emp, 'db92 prueba F', v_y, now() - interval '10 minutes');
    if (select codigo from public.clientes where id = e) is distinct from v_y
    or (select codigo from public.clientes where id = f) = v_y then
      raise exception 'db/92: el que llegó después con hora posterior no se corrió';
    end if;

    -- (3) El reintento de B (la cola) no mueve a nadie.
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (b, v_emp, 'db92 prueba B', v_x, now() - interval '20 minutes')
    on conflict (id) do nothing;
    if (select codigo from public.clientes where id = a) is distinct from v_a
    or (select codigo from public.clientes where id = b) is distinct from v_b then
      raise exception 'db/92: el reintento movió códigos';
    end if;

    -- (4) Sin código: el servidor le asigna uno. Hora futura: se recorta.
    insert into public.clientes (id, id_empresa, nombre_comercio, creado_ts)
    values (d, v_emp, 'db92 prueba D', now() + interval '1 day');
    select codigo into v_d from public.clientes where id = d;
    if coalesce(v_d, '') = '' then raise exception 'db/92: un alta sin código quedó sin código'; end if;
    if (select creado_ts from public.clientes where id = d) > now() then
      raise exception 'db/92: creado_ts futuro no se recortó';
    end if;

    -- (5) Llave prendida: un pedido de un cliente no enviado no sale; apagada, sí.
    if v_vend is not null then
      if not public.pedido_exportable(d, v_vend) then
        raise exception 'db/92: con la llave apagada pedido_exportable cambió';
      end if;
      update public.empresas set export_erp = export_erp || '{"clientes_activo": true}' where id = v_emp;
      if public.pedido_exportable(d, v_vend) then
        raise exception 'db/92: con la llave prendida salió el pedido de un cliente no enviado';
      end if;
    end if;

    -- (6) Primer lote: los 5 como ALTA, y el modo prueba no marca.
    select count(*) into n from public.tomar_lote_clientes(v_emp, null, false);
    if n <> 5 then raise exception 'db/92: el modo prueba ve % (esperado 5)', n; end if;
    select count(*) into n from public.tomar_lote_clientes(v_emp, null, true) t where t.tipo = 'ALTA';
    if n <> 5 then raise exception 'db/92: el primer lote trajo % ALTA (esperado 5)', n; end if;
    select count(*) into n from public.tomar_lote_clientes(v_emp, null, true);
    if n <> 0 then raise exception 'db/92: un segundo lote sin cambios trajo % filas', n; end if;
    if v_vend is not null and not public.pedido_exportable(d, v_vend) then
      raise exception 'db/92: con el cliente enviado el pedido sigue retenido';
    end if;
    select count(*) into n from public.repetir_lote_clientes(v_emp, null);
    if n <> 5 then raise exception 'db/92: repetir el lote trajo % filas', n; end if;

    -- (7) Un cambio que viaja → MODIFICACION; uno que no viaja → nada.
    update public.clientes set telefono = '3870000000' where id = a;
    update public.clientes set dias_visita = 'LU' where id = e;
    select count(*) filter (where t.id_cliente = a and t.tipo = 'MODIFICACION'), count(*) into n, v_n
      from public.tomar_lote_clientes(v_emp, null, true) t;
    if n <> 1 or v_n <> 1 then
      raise exception 'db/92: modificación mal detectada (% de %)', n, v_n;
    end if;

    -- (8) Lo fiscal también viaja.
    insert into public.clientes_fiscal (id_cliente, condicion_iva) values (a, 'MONOTRIBUTO');
    select count(*) into n from public.tomar_lote_clientes(v_emp, null, true) t where t.id_cliente = a;
    if n <> 1 then raise exception 'db/92: el cambio fiscal no subió la versión'; end if;

    -- (9) Ni el código de un enviado ni el cursor se editan desde afuera.
    begin
      update public.clientes set codigo = v_d || '9' where id = b;
      raise exception 'db/92: se pudo cambiar el código de un cliente enviado';
    exception when raise_exception then
      if sqlerrm <> 'cliente-ya-exportado' then raise; end if;
    end;
    begin
      update public.clientes set export_enviada = null where id = b;
      raise exception 'db/92: se pudo tocar el cursor';
    exception when raise_exception then
      if sqlerrm <> 'cursor-de-exportacion-no-editable' then raise; end if;
    end;

    -- (10) B ya enviado: C, aunque se haya creado antes, recibe otro número.
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (c, v_emp, 'db92 prueba C', v_x, now() - interval '30 minutes');
    select codigo into v_c from public.clientes where id = c;
    if (select codigo from public.clientes where id = b) is distinct from v_x or v_c = v_x then
      raise exception 'db/92: un cliente enviado perdió su código (C=%)', v_c;
    end if;

    -- (11) Archivar → BAJA; borrar un enviado → lápida → BAJA, y su código no se reutiliza.
    perform public.tomar_lote_clientes(v_emp, null, true);       -- C sale como ALTA
    update public.clientes set archivado_ts = now() where id = a;
    -- B con datos fiscales: el borrado en cascada de `clientes_fiscal` no tiene que romper nada.
    insert into public.clientes_fiscal (id_cliente, condicion_iva) values (b, 'RI');
    delete from public.clientes where id = b;
    select count(*) into n from public.tomar_lote_clientes(v_emp, null, true) t
     where t.tipo = 'BAJA' and (t.id_cliente = a or t.id_baja is not null);
    if n <> 2 then raise exception 'db/92: bajas mal detectadas (% de 2)', n; end if;
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo) values (g, v_emp, 'db92 prueba G', v_x);
    if (select codigo from public.clientes where id = g) = v_x then
      raise exception 'db/92: se reutilizó el código de una lápida';
    end if;
    if public.siguiente_codigo_cliente(v_emp) = v_x then
      raise exception 'db/92: siguiente_codigo_cliente devuelve el código de una lápida';
    end if;

    raise exception using errcode = 'P0099', message = 'db92-autochequeo-ok';
  exception when sqlstate 'P0099' then
    null; -- todo lo de las pruebas quedó deshecho
  end;
end $$;

notify pgrst, 'reload schema';

commit;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--   -- el piso y la llave:
--   select nombre, export_erp->'cliente_codigo_min', export_erp->'clientes_activo' from empresas;
--   -- lo que saldría en el próximo lote (sin marcar nada):
--   select tipo, count(*) from public.tomar_lote_clientes('<id_empresa>', null, false) group by 1;
--   -- las reasignaciones:
--   select codigo, codigo_solicitado, codigo_reasignado_ts, creado_ts, creado_por
--     from public.clientes where codigo_reasignado_ts is not null order by codigo_reasignado_ts desc;
--   -- los lotes:
--   select lote, ts, clientes, cardinality(bajas) bajas, bytes, origen, error
--     from exportaciones_clientes order by ts desc limit 20;
