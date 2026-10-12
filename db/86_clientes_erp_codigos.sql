-- 86_clientes_erp_codigos.sql — dist-at da de alta los clientes y el ERP los recibe.
-- 07/10/2026. Plan: `D:\Dist-At (LA UNION)\planes\07-clientes-erp-codigos.md`.
--
-- 🔴 NO APLICAR ANTES DEL CORTE A SERVIDOR PROPIO (domingo 11/10/2026): una migración nueva en
-- Cloud rompe la foto de paridad del ensayo. Si hubiera que adelantarla, re-sacar esa foto.
--
-- 🩸 POR QUÉ EXISTE. Cambió la regla de negocio: hasta hoy el código de cliente "lo emitía el ERP"
-- (`lib/codigoCliente.js`), se escribía a mano, era opcional, y un comercio cargado en la calle
-- nacía sin código — sus pedidos quedaban retenidos del lote al ERP (db/74). Desde ahora la app da
-- de alta al cliente con el número correlativo libre más bajo (reutilizando los huecos) y el ERP lo
-- recibe por el mismo camino que ya usa para los pedidos: la PC del ERP lo baja como `Clientes.txt`
-- desde `export-clientes`, cada 30 minutos.
--
-- 🔑 EL SERVIDOR ES LA AUTORIDAD DEL CÓDIGO. El teléfono calcula el hueco contra su copia local de
-- la cartera, así que dos vendedores sin señal ven EL MISMO hueco y proponen el mismo número. Hasta
-- hoy el segundo en subir rebotaba contra `clientes_codigo_norm_uidx` (23505 → cuarentena en SU
-- teléfono, donde no hay aviso visible) y el comercio no existía en la base. Ahora un trigger
-- BEFORE INSERT —calcado de `asignar_numero_pedido` (db/43)— resuelve la colisión antes de que el
-- índice la vea: gana el que se creó ANTES según la hora del dispositivo (`creado_ts`), y al otro se
-- le asigna el siguiente libre. El índice único queda como última red.
--
-- ⚠️ LÍMITE DE LA REGLA DE PRIORIDAD: vale mientras el que ya tiene el código no se haya exportado.
-- Una vez en el ERP, su código no se mueve más (trigger `cliente_exportado_congelado`), así que el
-- que llega tarde con una hora anterior recibe otro número.
--
-- ⚠️ GEMELOS SQL/JS (regla 36): `siguiente_codigo_cliente()` es el gemelo de `primerCodigoLibre()`
-- (`web/src/lib/codigoCliente.js`), como `codigo_norm()` lo es de `codigoKey()`. El del teléfono
-- SUGIERE; éste DECIDE. Si cambia la regla del hueco en uno, cambia en el otro.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) EL RASTREO DEL ALTA Y EL CURSOR DE EXPORTACIÓN
-- ─────────────────────────────────────────────────────────────────────────────

-- Hora del DISPOSITIVO en que se creó el cliente. Es la que ordena la prioridad ante una colisión,
-- igual que `pedidos.created_at` lleva la hora del comercio y no la de subida (useJornada.js). El
-- trigger la recorta a `now()`: un reloj adelantado no gana prioridad.
alter table public.clientes add column if not exists creado_ts timestamptz;
-- Quién lo creó. Lo pone el trigger con `auth.uid()`: el payload no es de fiar.
alter table public.clientes add column if not exists creado_por uuid
  references public.perfiles(id) on delete set null;
-- El código que pidió el teléfono, cuando el servidor tuvo que darle otro. Es la marca visible de
-- una reasignación (la ficha lo muestra), y el rastro para auditarla.
alter table public.clientes add column if not exists codigo_solicitado text;
alter table public.clientes add column if not exists codigo_reasignado_ts timestamptz;
-- El código que tenía un cliente dado de baja con historial (pedidos o visitas): no se lo puede
-- borrar —las FK de `pedidos` y `visitas` no tienen ON DELETE—, así que se archiva y su número pasa
-- acá para quedar libre. Ver `purgar_clientes_inactivos`.
alter table public.clientes add column if not exists codigo_baja text;
-- El cursor por fila, igual que `pedidos` (db/62): un cliente creado sin señal a las 09:00 puede
-- llegar a la base después del lote de las 09:30, y con un cursor de tiempo no saldría nunca.
alter table public.clientes add column if not exists exportado_ts timestamptz;
alter table public.clientes add column if not exists export_lote  bigint;

create index if not exists clientes_pendiente_export_idx
  on public.clientes (id_empresa, creado_ts)
  where exportado_ts is null;

/* 🔴 BACKFILL: LOS CLIENTES QUE YA TIENEN CÓDIGO SE MARCAN COMO YA ENVIADOS (lote 0).
 *
 * El ERP ya los conoce: la cartera salió de su planilla. Sin esto el primer GET se lleva los ~2.000
 * y además `pedido_exportable` (más abajo) retendría todos los pedidos nuevos hasta entonces. Los
 * que NO tienen código quedan sin marcar: `purgar_clientes_inactivos` les asigna uno y salen en el
 * primer lote.
 *
 * 🩸 La lección de db/62 —su backfill se re-ejecutó dos veces y congeló pedidos recién cargados—:
 * acá va dentro de un `if not exists (... export_lote = 0)`, así que re-aplicar este archivo para
 * corregir una función de más abajo NO vuelve a marcar nada. */
do $$
begin
  if not exists (select 1 from public.clientes where export_lote = 0) then
    update public.clientes
       set exportado_ts = now(), export_lote = 0
     where exportado_ts is null
       and coalesce(btrim(codigo), '') <> '';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) EL PISO DE LA NUMERACIÓN (por empresa)
-- ─────────────────────────────────────────────────────────────────────────────

/* `empresas.export_erp.cliente_codigo_min`: desde qué número se buscan huecos. Vive en el mismo
 * jsonb que las constantes del layout de pedidos (db/62) y se cambia con un `update`, sin release.
 *
 * 🔴 ARRANCA EN "SIN REUTILIZAR": máximo código actual + 1. Los ~800 huecos de hoy son en buena parte
 * clientes INHABILITADOS que el ERP todavía tiene (`exportarClientes.js`): reutilizar uno antes de que
 * el programador depure su lado choca en su sistema. Cuando el ERP confirme la limpieza, se baja a
 * mano (Paso 2 del plan):
 *   update empresas set export_erp = jsonb_set(export_erp, '{cliente_codigo_min}', '1') where id = '<id>';
 * Sólo se escribe si la clave no existe: re-aplicar este archivo no pisa un piso ya bajado. */
update public.empresas e
   set export_erp = coalesce(e.export_erp, '{}'::jsonb)
                    || jsonb_build_object('cliente_codigo_min', coalesce((
                         select max(c.codigo_norm::bigint) + 1
                           from public.clientes c
                          where c.id_empresa = e.id and c.codigo_norm ~ '^\d{1,18}$'), 1))
 where not coalesce(e.export_erp, '{}'::jsonb) ? 'cliente_codigo_min';

/* El menor número >= piso que ningún cliente de la empresa usa (vigente o archivado: el índice
 * único no distingue). El hueco más bajo es el piso mismo o el siguiente de algún código usado, así
 * que basta mirar esos candidatos — no hace falta un `generate_series` hasta el máximo.
 *
 * Compara contra `codigo_norm` (sin ceros a la izquierda): `0712` ocupa el 712, igual que en el
 * índice. Sólo cuentan los códigos enteramente numéricos, como en `primerCodigoLibre`. */
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
     where c.id_empresa = p_empresa
       and c.codigo_norm ~ '^\d{1,18}$'
  )
  select min(x.n)::text
    from (select p.n from piso p
          union all
          select u.n + 1 from usados u, piso p where u.n + 1 >= p.n) x
   where not exists (select 1 from usados u where u.n = x.n);
$$;

revoke execute on function public.siguiente_codigo_cliente(uuid) from public;
revoke execute on function public.siguiente_codigo_cliente(uuid) from anon;
revoke execute on function public.siguiente_codigo_cliente(uuid) from authenticated;
grant  execute on function public.siguiente_codigo_cliente(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) LA COLISIÓN SE RESUELVE EN EL SERVIDOR
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
  /* 🔴 EL REINTENTO DE LA COLA. `writeQueue` inserta con `upsert(…, { onConflict: 'id',
   * ignoreDuplicates: true })`, o sea `INSERT … ON CONFLICT (id) DO NOTHING`, y un BEFORE INSERT
   * corre IGUAL antes de que Postgres detecte el conflicto. Sin esta guarda, el reintento de un
   * cliente que ya subió se encontraría a sí mismo como "titular" de su código y le correría el
   * número a otro comercio. Si la fila ya existe, no se toca nada: el insert va a ser descartado. */
  if exists (select 1 from public.clientes c where c.id = new.id) then
    return new;
  end if;

  new.creado_por := coalesce(auth.uid(), new.creado_por);
  new.creado_ts  := least(coalesce(new.creado_ts, now()), now());

  if new.id_empresa is null then return new; end if; -- la policy de INSERT lo rechaza igual

  -- Una sola alta por empresa a la vez: dos inserts que se disputan el mismo hueco no pueden mirar
  -- la cartera al mismo tiempo. `tomar_lote_clientes` toma el mismo cerrojo.
  perform pg_advisory_xact_lock(hashtext('codigo_cliente:' || new.id_empresa::text));

  if coalesce(btrim(new.codigo), '') = '' then
    new.codigo := public.siguiente_codigo_cliente(new.id_empresa);
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
    -- y al titular se le da el siguiente libre. `siguiente_codigo_cliente` todavía ve ocupado el
    -- código en disputa (lo tiene el titular), así que no puede devolverlo.
    update public.clientes
       set codigo_solicitado    = coalesce(codigo_solicitado, codigo),
           codigo               = public.siguiente_codigo_cliente(new.id_empresa),
           codigo_reasignado_ts = now()
     where id = v_titular.id;
  else
    -- El que llega es posterior, empata (gana el que llegó primero al servidor) o el titular ya se
    -- exportó: el que llega recibe el siguiente libre.
    new.codigo_solicitado    := new.codigo;
    new.codigo               := public.siguiente_codigo_cliente(new.id_empresa);
    new.codigo_reasignado_ts := now();
  end if;

  return new;
end $$;

revoke execute on function public.cliente_resolver_codigo() from public;
revoke execute on function public.cliente_resolver_codigo() from anon;
revoke execute on function public.cliente_resolver_codigo() from authenticated;
grant  execute on function public.cliente_resolver_codigo() to service_role;

drop trigger if exists clientes_resolver_codigo on public.clientes;
create trigger clientes_resolver_codigo
  before insert on public.clientes
  for each row execute function public.cliente_resolver_codigo();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) UN CLIENTE EXPORTADO NO CAMBIA DE CÓDIGO
-- ─────────────────────────────────────────────────────────────────────────────

/* Calcado de `pedido_exportado_congelado` (db/62). El ERP conoce al comercio por ese número: si la
 * app lo cambiara, los pedidos siguientes saldrían a nombre de un código que el ERP no tiene (o que
 * tiene OTRO comercio). La corrección se hace en el sistema de gestión.
 *
 * El rastreo del alta (`creado_ts`, `creado_por`) tampoco se edita: es lo que decide la prioridad
 * de una colisión, y si se pudiera tocar desde la app, se podría ganar un código a mano. */
create or replace function public.cliente_exportado_congelado()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('distat.export_bypass', true), '') = 'on' then return new; end if;

  if new.exportado_ts is distinct from old.exportado_ts
  or new.export_lote  is distinct from old.export_lote
  then
    raise exception 'cursor-de-exportacion-no-editable';
  end if;

  if new.creado_ts  is distinct from old.creado_ts
  or new.creado_por is distinct from old.creado_por
  then
    raise exception 'rastreo-de-alta-no-editable';
  end if;

  if old.exportado_ts is not null and new.codigo is distinct from old.codigo then
    raise exception 'cliente-ya-exportado'
      using hint = 'Este cliente ya está en el sistema de gestión con ese código. La corrección se hace allá.';
  end if;

  return new;
end $$;

drop trigger if exists clientes_exportado_congelado on public.clientes;
create trigger clientes_exportado_congelado
  before update on public.clientes
  for each row execute function public.cliente_exportado_congelado();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) LA BITÁCORA Y EL LOTE
-- ─────────────────────────────────────────────────────────────────────────────

-- Calcada de `exportaciones_pedidos` (db/62 + db/64): la fila del lote nace en la misma RPC que
-- marca los clientes, y los rechazos también dejan fila.
create table if not exists public.exportaciones_clientes (
  id          uuid primary key default gen_random_uuid(),
  id_empresa  uuid not null references public.empresas(id) on delete cascade,
  id_usuario  uuid references public.perfiles(id),
  ts          timestamptz not null default now(),
  lote        bigint,
  clientes    int  not null default 0,
  ids         uuid[] not null default '{}',
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

-- Lectura para admin/superadmin, igual que la de pedidos. SIN policy de escritura: la escribe
-- `service_role` desde la Edge Function y las RPC de abajo.
drop policy if exists exportaciones_clientes_sel on public.exportaciones_clientes;
create policy exportaciones_clientes_sel on public.exportaciones_clientes
  for select using (es_superadmin() or (id_empresa = mi_empresa() and es_admin()));

-- Tabla operativa nueva → su RESTRICTIVE (db/82). `es_admin()` ya deja afuera a marketing, pero la
-- restrictiva corta igual a cualquier permisiva que alguien agregue mañana sin acordarse.
drop policy if exists exportaciones_clientes_no_marketing on public.exportaciones_clientes;
create policy exportaciones_clientes_no_marketing on public.exportaciones_clientes
  as restrictive for all to authenticated
  using ((select public.mi_rol()) is distinct from 'marketing')
  with check ((select public.mi_rol()) is distinct from 'marketing');

/* Calcada de `tomar_lote_pedidos` (db/74): marca y devuelve en un solo statement, para que dos
 * ejecuciones del script no se lleven el mismo cliente. Toma vigentes con código y sin exportar,
 * confirmados o no (decisión del 07/10: se exportan apenas llegan al servidor).
 *
 * Toma también el cerrojo de las altas: un cliente no puede salir en un lote mientras otro insert
 * le está corriendo el código. */
create or replace function public.tomar_lote_clientes(
  p_empresa uuid,
  p_usuario uuid default null,
  p_marcar  boolean default true
)
returns table (id_cliente uuid, lote bigint)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_lote bigint;
begin
  perform set_config('distat.export_bypass', 'on', true);
  perform pg_advisory_xact_lock(hashtext('codigo_cliente:' || p_empresa::text));
  perform pg_advisory_xact_lock(hashtext('export_clientes:' || p_empresa::text));

  select coalesce(max(e.lote), 0) + 1 into v_lote
    from public.exportaciones_clientes e
   where e.id_empresa = p_empresa;

  -- Modo prueba: mira qué saldría, no marca ni reserva número.
  if not p_marcar then
    return query
      select c.id, v_lote from public.clientes c
       where c.id_empresa = p_empresa and c.exportado_ts is null
         and c.archivado_ts is null
         and coalesce(btrim(c.codigo), '') <> ''
       order by c.creado_ts, c.created_at;
    return;
  end if;

  return query
    with tomados as (
      update public.clientes c
         set exportado_ts = now(), export_lote = v_lote
       where c.id_empresa = p_empresa and c.exportado_ts is null
         and c.archivado_ts is null
         and coalesce(btrim(c.codigo), '') <> ''
      returning c.id, c.creado_ts, c.created_at
    ),
    registro as (
      insert into public.exportaciones_clientes (id_empresa, id_usuario, lote, clientes, ids, origen)
      select p_empresa, p_usuario, v_lote, count(*)::int, array_agg(t.id), 'endpoint'
        from tomados t
      having count(*) > 0
    )
    select t.id, v_lote from tomados t order by t.creado_ts, t.created_at;
end
$fn$;

revoke execute on function public.tomar_lote_clientes(uuid, uuid, boolean) from public;
revoke execute on function public.tomar_lote_clientes(uuid, uuid, boolean) from anon;
revoke execute on function public.tomar_lote_clientes(uuid, uuid, boolean) from authenticated;
grant  execute on function public.tomar_lote_clientes(uuid, uuid, boolean) to service_role;

-- Calcada de `reponer_pedidos_para_export` (db/62): un superadmin vuelve a poner clientes en la
-- fila de salida (el archivo se perdió del lado del ERP). Se llama desde la app, con sesión: por eso
-- conserva EXECUTE para `authenticated` y valida el rol adentro.
create or replace function public.reponer_clientes_para_export(p_ids uuid[], p_motivo text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n int;
  v_empresa uuid;
begin
  if not es_superadmin() then
    raise exception 'solo-superadmin';
  end if;
  perform set_config('distat.export_bypass', 'on', true);

  select c.id_empresa into v_empresa from public.clientes c where c.id = any (p_ids) limit 1;

  update public.clientes c
     set exportado_ts = null, export_lote = null
   where c.id = any (p_ids);
  get diagnostics v_n = row_count;

  insert into public.exportaciones_clientes (id_empresa, id_usuario, clientes, ids, origen, error)
  values (v_empresa, auth.uid(), v_n, p_ids, 'reposicion', p_motivo);

  return v_n;
end $$;

revoke execute on function public.reponer_clientes_para_export(uuid[], text) from public;
revoke execute on function public.reponer_clientes_para_export(uuid[], text) from anon;
grant  execute on function public.reponer_clientes_para_export(uuid[], text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) UN PEDIDO NO SALE ANTES QUE SU CLIENTE
-- ─────────────────────────────────────────────────────────────────────────────

/* Se suma a la condición de db/74: el cliente tiene que estar YA exportado. Si no, el ERP recibiría
 * un pedido de un código que todavía no conoce. Lo retiene como mucho un ciclo de 30 minutos: entra
 * solo al lote siguiente, gracias al cursor por fila. */
create or replace function public.pedido_exportable(p_cliente uuid, p_vendedor uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.clientes c
                  where c.id = p_cliente and coalesce(c.codigo, '') <> ''
                    and c.exportado_ts is not null)
     and exists (select 1 from public.perfiles v
                  where v.id = p_vendedor
                    and (coalesce(v.codigo_erp, '') <> '' or v.numero is not null));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) EL TOKEN
-- ─────────────────────────────────────────────────────────────────────────────

-- Una superficie más: un token de pedidos no lee la cartera de clientes y viceversa. Se emite por
-- SQL a la cuenta estable "pc oficina la union", igual que el de `pedidos` (GUIA_TOKENS_INGESTA §3.2).
alter table public.ingesta_tokens drop constraint if exists ingesta_tokens_proposito_chk;
alter table public.ingesta_tokens add constraint ingesta_tokens_proposito_chk
  check (proposito = any (array['gps','precios','pedidos','clientes']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) EL SELLO DE LA CARTERA
-- ─────────────────────────────────────────────────────────────────────────────

/* Calcado de `sello_precios()`. Hasta hoy un cliente nuevo no llegaba a un teléfono abierto hasta
 * el próximo arranque en frío, y con códigos asignados por el servidor eso importa dos veces: el
 * teléfono que perdió una colisión sigue mostrando el número viejo, y sugiere huecos contra una
 * cartera vieja (más colisiones). Se mueve con las altas (`created_at` es la hora del servidor) y con
 * las reasignaciones; un cambio de nombre o de teléfono espera al próximo arranque.
 *
 * Marketing no ve la cartera (db/82): para ese rol devuelve NULL. */
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

revoke execute on function public.sello_clientes() from public;
revoke execute on function public.sello_clientes() from anon;
grant  execute on function public.sello_clientes() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) LA LIMPIEZA INICIAL (se corre a mano, una vez, desde el SQL Editor)
-- ─────────────────────────────────────────────────────────────────────────────

/* Antes de correrla, la cartera tiene que reflejar la lista de ACTIVOS del ERP: se importa con
 * "Importar planilla" y la tilde "cartera completa", que archiva a los ausentes con código.
 *
 * Sobre los ARCHIVADOS de la empresa:
 *   · sin pedidos ni visitas → DELETE;
 *   · con historial → `codigo_baja := codigo`, `codigo := null`. El número queda libre y el
 *     historial intacto (las FK de pedidos/visitas no tienen ON DELETE).
 * Y a los VIGENTES sin código les asigna uno; salen en el primer lote.
 *
 * 🩸 Esto incluye a las 195 "A" que db/22 archivó a propósito para que su código siguiera ocupado
 * y una planilla futura no las recreara. Con la regla nueva (dist-at es el dueño de las altas y los
 * huecos se reutilizan) ese motivo ya no aplica.
 *
 * `p_aplicar = false` (por defecto) sólo cuenta. Sin EXECUTE para nadie de la app: se corre como
 * `postgres` desde el SQL Editor (ahí `auth.uid()` vale NULL, por eso no valida rol adentro). */
create or replace function public.purgar_clientes_inactivos(p_empresa uuid, p_aplicar boolean default false)
returns table (borrados int, codigos_liberados int, codigos_asignados int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_borrados int := 0;
  v_liberados int := 0;
  v_asignados int := 0;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('codigo_cliente:' || p_empresa::text));

  if not p_aplicar then
    select count(*) filter (where not h.tiene),
           count(*) filter (where h.tiene and coalesce(btrim(h.codigo), '') <> '')
      into v_borrados, v_liberados
      from (select c.codigo,
                   exists (select 1 from public.pedidos p where p.id_cliente = c.id)
                   or exists (select 1 from public.visitas v where v.id_cliente = c.id) as tiene
              from public.clientes c
             where c.id_empresa = p_empresa and c.archivado_ts is not null) h;
    select count(*) into v_asignados
      from public.clientes c
     where c.id_empresa = p_empresa and c.archivado_ts is null
       and coalesce(btrim(c.codigo), '') = '';
    return query select v_borrados, v_liberados, v_asignados;
    return;
  end if;

  perform set_config('distat.export_bypass', 'on', true);

  delete from public.clientes c
   where c.id_empresa = p_empresa and c.archivado_ts is not null
     and not exists (select 1 from public.pedidos p where p.id_cliente = c.id)
     and not exists (select 1 from public.visitas v where v.id_cliente = c.id);
  get diagnostics v_borrados = row_count;

  update public.clientes c
     set codigo_baja = c.codigo, codigo = null
   where c.id_empresa = p_empresa and c.archivado_ts is not null
     and coalesce(btrim(c.codigo), '') <> '';
  get diagnostics v_liberados = row_count;

  -- Uno por uno y en orden de alta: cada asignación tiene que ver la anterior para no repetir hueco.
  for v_id in
    select c.id from public.clientes c
     where c.id_empresa = p_empresa and c.archivado_ts is null
       and coalesce(btrim(c.codigo), '') = ''
     order by c.created_at
  loop
    update public.clientes
       set codigo = public.siguiente_codigo_cliente(p_empresa)
     where id = v_id;
    v_asignados := v_asignados + 1;
  end loop;

  return query select v_borrados, v_liberados, v_asignados;
end $$;

revoke execute on function public.purgar_clientes_inactivos(uuid, boolean) from public;
revoke execute on function public.purgar_clientes_inactivos(uuid, boolean) from anon;
revoke execute on function public.purgar_clientes_inactivos(uuid, boolean) from authenticated;
grant  execute on function public.purgar_clientes_inactivos(uuid, boolean) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) AUTOCHEQUEO: si algo no quedó como dice este archivo, la migración FALLA.
-- ─────────────────────────────────────────────────────────────────────────────

/* Las pruebas de colisión corren dentro de un sub-bloque que termina con una excepción propia
 * (P0099): Postgres deshace TODO lo que hizo el sub-bloque y el `exception when` la ataja. Cualquier
 * otra excepción (una aserción que falla) no se ataja y aborta la migración entera. */
do $$
declare
  v_emp uuid;
  v_x text;
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  c uuid := gen_random_uuid();
  d uuid := gen_random_uuid();
  v_a text; v_b text; v_c text; v_d text;
  faltan text;
begin
  -- ACL de las funciones nuevas (reglas 7 y 7-bis).
  select string_agg(p.proname || '=' || coalesce(p.proacl::text, 'NULL'), ', ') into faltan
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('siguiente_codigo_cliente', 'cliente_resolver_codigo',
                       'tomar_lote_clientes', 'purgar_clientes_inactivos')
     and (p.proacl::text like '%anon=%' or p.proacl::text like '%authenticated=%'
          or p.proacl is null);
  if faltan is not null then
    raise exception 'db/86: EXECUTE de más en: %', faltan;
  end if;

  if not exists (select 1 from pg_policies where tablename = 'exportaciones_clientes'
                  and policyname = 'exportaciones_clientes_no_marketing' and permissive = 'RESTRICTIVE') then
    raise exception 'db/86: falta exportaciones_clientes_no_marketing';
  end if;

  select id into v_emp from public.empresas order by nombre limit 1;
  if v_emp is null then return; end if;

  begin
    v_x := public.siguiente_codigo_cliente(v_emp);

    -- A llega primero pero se creó DESPUÉS que B.
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (a, v_emp, 'db86 prueba A', v_x, now() - interval '10 minutes');
    -- B llega segundo con el mismo código y se creó ANTES: se lo queda, A se corre.
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (b, v_emp, 'db86 prueba B', v_x, now() - interval '20 minutes');

    select codigo into v_a from public.clientes where id = a;
    select codigo into v_b from public.clientes where id = b;
    if v_b is distinct from v_x or v_a = v_x or v_a is null then
      raise exception 'db/86: prioridad por horario mal resuelta (x=%, A=%, B=%)', v_x, v_a, v_b;
    end if;

    -- El reintento de B (la cola) no puede mover a nadie.
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (b, v_emp, 'db86 prueba B', v_x, now() - interval '20 minutes')
    on conflict (id) do nothing;
    if (select codigo from public.clientes where id = a) is distinct from v_a
    or (select codigo from public.clientes where id = b) is distinct from v_b then
      raise exception 'db/86: el reintento movió códigos';
    end if;

    -- B ya exportado: C, aunque se haya creado antes, recibe otro número.
    perform set_config('distat.export_bypass', 'on', true);
    update public.clientes set exportado_ts = now(), export_lote = -1 where id = b;
    perform set_config('distat.export_bypass', '', true);
    insert into public.clientes (id, id_empresa, nombre_comercio, codigo, creado_ts)
    values (c, v_emp, 'db86 prueba C', v_x, now() - interval '30 minutes');
    select codigo into v_c from public.clientes where id = c;
    if (select codigo from public.clientes where id = b) is distinct from v_x
    or v_c = v_x or v_c is null
    or (select codigo_solicitado from public.clientes where id = c) is distinct from v_x then
      raise exception 'db/86: un cliente exportado perdió su código (C=%)', v_c;
    end if;

    -- Sin código: el servidor le asigna uno.
    insert into public.clientes (id, id_empresa, nombre_comercio) values (d, v_emp, 'db86 prueba D');
    select codigo into v_d from public.clientes where id = d;
    if coalesce(v_d, '') = '' then
      raise exception 'db/86: un alta sin código quedó sin código';
    end if;

    -- El código de un exportado no se edita.
    begin
      update public.clientes set codigo = v_d || '9' where id = b;
      raise exception 'db/86: se pudo cambiar el código de un cliente exportado';
    exception when raise_exception then
      if sqlerrm <> 'cliente-ya-exportado' then raise; end if;
    end;

    raise exception using errcode = 'P0099', message = 'db86-autochequeo-ok';
  exception when sqlstate 'P0099' then
    null; -- todo lo de las pruebas quedó deshecho
  end;
end $$;

commit;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────────────────────
--   -- ACL: {postgres=X/postgres,service_role=X/postgres} salvo sello_clientes y reponer (+authenticated):
--   select proname, proacl from pg_proc
--    where proname in ('siguiente_codigo_cliente','cliente_resolver_codigo','tomar_lote_clientes',
--                      'reponer_clientes_para_export','sello_clientes','purgar_clientes_inactivos');
--   -- lo que saldría en el próximo lote (sin marcar nada):
--   select * from public.tomar_lote_clientes('<id_empresa>', null, false);
--   -- la limpieza, primero en seco:
--   select * from public.purgar_clientes_inactivos('<id_empresa>', false);
--   -- las reasignaciones:
--   select codigo, codigo_solicitado, codigo_reasignado_ts, creado_ts, creado_por
--     from public.clientes where codigo_reasignado_ts is not null order by codigo_reasignado_ts desc;
