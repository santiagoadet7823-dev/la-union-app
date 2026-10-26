-- 97_limpiar_clientes_duplicados.sql — 2000 clientes duplicados por una planilla (26/10/2026, plan 28).
--
-- 🩸 QUÉ PASÓ. Una cuenta admin bajó la planilla de clientes y la volvió a subir desde una PC que
-- recién había iniciado sesión: la cartera todavía no había terminado de bajar (sólo la primera
-- página de las tres), así que el importador —que cruzaba contra la MEMORIA de la app— no encontró
-- ningún código y mandó las 2027 filas como altas. El servidor vio que cada código ya estaba ocupado
-- y, como con un choque offline, les dio uno nuevo (2804-4803). La cola de escrituras (tope 2000)
-- descartó las 27 primeras. Resultado: 2000 copias exactas, con `codigo_solicitado` = el código del
-- original. Durante la tarde los vendedores tomaron 21 pedidos y 52 visitas sobre copias, y 18 de esos
-- pedidos salieron al ERP con un código que el ERP no conoce.
--
-- Arreglo:
--   1) `clientes_redireccion`: copia → original (queda como red para los teléfonos offline).
--   2) Lo que se editó en una copia (ubicación cargada en el lugar, días, frecuencia, zona) pasa al
--      original — sólo lo que agrega, nunca un "quitar".
--   3) Pedidos, visitas e historial de ediciones: de la copia al original. Los pedidos ya exportados
--      cambian SOLO `id_cliente`, con el bypass de `pedido_exportado_congelado`.
--   4) Se borran las copias. No dejan lápida: nunca salieron al ERP (`exportado_ts` null).
--   5) Trigger en `pedidos` y `visitas`: un `id_cliente` de una copia (teléfono con la cartera vieja
--      en caché, pedido tomado sin señal) se reemplaza por el original en vez de caer en cuarentena.
--   6) Guarda en `cliente_resolver_codigo`: un alta con un código ocupado POR UN CLIENTE CON EL MISMO
--      NOMBRE es el mismo comercio, no uno nuevo → error. Un choque offline con otro nombre se sigue
--      reasignando como siempre (db/92).
--
-- El importador también se corrige (1.45.2): cruza contra el servidor y sube las altas en lotes.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) LA REDIRECCIÓN
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.clientes_redireccion (
  id_copia    uuid primary key,
  id_original uuid not null references public.clientes(id) on delete cascade,
  id_empresa  uuid not null references public.empresas(id),
  motivo      text not null,
  ts          timestamptz not null default now()
);
-- Sin policies: sólo la leen los triggers (security definer) y el service_role.
alter table public.clientes_redireccion enable row level security;
revoke all on public.clientes_redireccion from anon, authenticated;

/* Las copias: altas de esa ventana de 20 minutos con el código reasignado, cuyo código PEDIDO es el
 * de un cliente anterior con el mismo nombre. Las tres condiciones juntas no las cumple ningún alta
 * legítima: un choque offline real trae otro nombre. */
insert into public.clientes_redireccion (id_copia, id_original, id_empresa, motivo)
select n.id, o.id, n.id_empresa, 'planilla 26/10/2026 subida con la cartera sin cargar'
  from public.clientes n
  join public.clientes o
    on o.id_empresa = n.id_empresa
   and o.id <> n.id
   and o.codigo_norm = public.codigo_norm(n.codigo_solicitado)
   and o.created_at < n.created_at
   and lower(btrim(o.nombre_comercio)) = lower(btrim(n.nombre_comercio))
 where n.codigo_reasignado_ts is not null
   and n.codigo_solicitado is not null
   and n.created_at >= '2026-10-26 15:30:00+00'
   and n.created_at <  '2026-10-26 15:50:00+00'
on conflict (id_copia) do nothing;

do $$
declare v_pares int; v_orig int;
begin
  select count(*), count(distinct id_original) into v_pares, v_orig from public.clientes_redireccion;
  if v_pares <> 2000 or v_orig <> 2000 then
    raise exception 'db/97: se esperaban 2000 pares con 2000 originales distintos, hay % pares y % originales', v_pares, v_orig;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) LO QUE SE EDITÓ EN UNA COPIA PASA AL ORIGINAL
-- ─────────────────────────────────────────────────────────────────────────────
/* Sólo copias con ediciones propias (`export_version > 1`): el resto es la planilla tal cual, y sus
 * diferencias con el original son ruido (lat redondeada, vendedor heredado de la zona).
 *
 * Ubicación: se pasa si el original no tenía, o si en la copia alguien la movió y el original no la
 * tocó después. Días / frecuencia / zona: sólo si el original no tenía (agregar, nunca quitar: dos
 * copias quedaron SIN zona por una edición y eso no se copia). El vendedor lo pone el trigger de la
 * zona (`cliente_hereda_vendedor_de_zona`).
 *
 * ⚠️ Tres updates y no uno: `id_zona` en el SET dispara `BEFORE UPDATE OF id_zona` aunque el valor
 * no cambie, y el trigger de la zona le reasignaría el vendedor a originales que no se tocaron. */
create temp table _db97_editadas on commit drop as
select r.id_original, n.lat, n.lng, n.dias_visita, n.frecuencia, n.id_zona,
       (select max(h.ts) from public.clientes_historial h
         where h.id_cliente = n.id and h.accion = 'edicion'
           and h.cambios @> '[{"campo": "Ubicación"}]') as movida_ts
  from public.clientes_redireccion r
  join public.clientes n on n.id = r.id_copia
 where n.export_version > 1;

update public.clientes o
   set lat = e.lat, lng = e.lng
  from _db97_editadas e
 where o.id = e.id_original
   and e.lat is not null and e.lng is not null
   and (o.lat is distinct from e.lat or o.lng is distinct from e.lng)
   and (o.lat is null
        or (e.movida_ts is not null and not exists (
              select 1 from public.clientes_historial h
               where h.id_cliente = o.id and h.accion = 'edicion' and h.ts > e.movida_ts
                 and h.cambios @> '[{"campo": "Ubicación"}]')));

update public.clientes o
   set dias_visita = coalesce(o.dias_visita, e.dias_visita),
       frecuencia  = coalesce(o.frecuencia, e.frecuencia)
  from _db97_editadas e
 where o.id = e.id_original
   and ((o.dias_visita is null and e.dias_visita is not null)
        or (o.frecuencia is null and e.frecuencia is not null));

update public.clientes o
   set id_zona = e.id_zona
  from _db97_editadas e
 where o.id = e.id_original
   and o.id_zona is null and e.id_zona is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) PEDIDOS, VISITAS E HISTORIAL → AL ORIGINAL
-- ─────────────────────────────────────────────────────────────────────────────

-- Los ya exportados sólo cambian de cliente: el pedido en el ERP lo corrige La Unión con la lista.
select set_config('distat.export_bypass', 'on', true);
update public.pedidos p
   set id_cliente = r.id_original
  from public.clientes_redireccion r
 where p.id_cliente = r.id_copia;
select set_config('distat.export_bypass', '', true);

update public.visitas v
   set id_cliente = r.id_original
  from public.clientes_redireccion r
 where v.id_cliente = r.id_copia;

-- Las ediciones hechas sobre una copia se ven en la ficha del original. Las altas quedan con el id
-- de la copia (no se ven en ninguna ficha): son el rastro de lo que pasó.
update public.clientes_historial h
   set id_cliente = r.id_original
  from public.clientes_redireccion r
 where h.id_cliente = r.id_copia
   and h.accion = 'edicion';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) FUERA LAS COPIAS
-- ─────────────────────────────────────────────────────────────────────────────

delete from public.clientes_fiscal f using public.clientes_redireccion r where f.id_cliente = r.id_copia;
delete from public.clientes c using public.clientes_redireccion r where c.id = r.id_copia;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) RED PARA LOS TELÉFONOS QUE TODAVÍA TIENEN LAS COPIAS EN CACHÉ
-- ─────────────────────────────────────────────────────────────────────────────
/* `aa` en el nombre: los BEFORE corren en orden alfabético y éste tiene que ir antes de
 * `pedidos_asegurar_visita`, que arma la visita con `new.id_cliente`. Las policies (WITH CHECK) ven la
 * fila ya redirigida. */
create or replace function public.redirigir_cliente_duplicado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_original uuid;
begin
  if new.id_cliente is null then return new; end if;
  select r.id_original into v_original from public.clientes_redireccion r where r.id_copia = new.id_cliente;
  if found then new.id_cliente := v_original; end if;
  return new;
end $$;
revoke execute on function public.redirigir_cliente_duplicado() from public, anon, authenticated;

drop trigger if exists pedidos_aa_redirigir_cliente on public.pedidos;
create trigger pedidos_aa_redirigir_cliente
  before insert or update of id_cliente on public.pedidos
  for each row execute function public.redirigir_cliente_duplicado();

drop trigger if exists visitas_aa_redirigir_cliente on public.visitas;
create trigger visitas_aa_redirigir_cliente
  before insert or update of id_cliente on public.visitas
  for each row execute function public.redirigir_cliente_duplicado();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) GUARDA: MISMO CÓDIGO Y MISMO NOMBRE = EL MISMO CLIENTE
-- ─────────────────────────────────────────────────────────────────────────────
/* Igual a la versión viva (db/92) más la guarda marcada 🔴 db/97. */
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
revoke execute on function public.cliente_resolver_codigo() from public, anon, authenticated;
grant  execute on function public.cliente_resolver_codigo() to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- AUTOCHEQUEO
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v int;
begin
  select count(*) into v from public.clientes c join public.clientes_redireccion r on r.id_copia = c.id;
  if v <> 0 then raise exception 'db/97: quedaron % copias', v; end if;

  select count(*) into v from public.pedidos p join public.clientes_redireccion r on r.id_copia = p.id_cliente;
  if v <> 0 then raise exception 'db/97: % pedidos siguen en una copia', v; end if;

  select count(*) into v from public.visitas x join public.clientes_redireccion r on r.id_copia = x.id_cliente;
  if v <> 0 then raise exception 'db/97: % visitas siguen en una copia', v; end if;

  select count(*) into v from public.clientes_export_bajas b join public.clientes_redireccion r on r.id_copia = b.id_cliente;
  if v <> 0 then raise exception 'db/97: % copias dejaron lápida', v; end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- VERIFICACIÓN:
--   select count(*) from public.clientes where id_empresa = '<id_empresa>';     -- 2027
--   select count(*) from public.clientes_redireccion;                          -- 2000
-- `clientes_redireccion` y sus dos triggers se pueden borrar cuando ningún teléfono tenga la cartera
-- vieja en caché (un par de semanas).
