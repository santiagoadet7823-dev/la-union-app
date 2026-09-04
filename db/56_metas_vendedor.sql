-- 56_metas_vendedor.sql — el vendedor se pone sus propias metas (03/09/2026).
--
-- QUÉ RESUELVE. Pedido del dueño en la reunión del 02/09: que el vendedor pueda fijarse una meta de
-- ventas diaria, mensual y anual, y ver cómo va. Hoy no existe NADA de esto — ni tabla, ni columna,
-- ni un número de venta calculado en ninguna parte. Lo único que la app mide del equipo son
-- kilómetros, paradas y tiempo en movimiento (`metricas_actividad`, db/21), que son métricas de
-- SUPERVISIÓN. Esta es la primera vez que el sistema mide lo que el vendedor vino a hacer.
--
-- 🔑 LAS METAS SON PROPIAS, NO ASIGNADAS. El vendedor las pone, las cambia y las ve; el encargado y
-- el admin las miran (para acompañar, no para imponer). Si algún día la empresa quiere fijarlas por
-- arriba, la policy de UPDATE es el único lugar que hay que tocar — el resto ya funciona.
--
-- ⚠️ QUÉ MÉTRICAS NO ESTÁN, Y ES DELIBERADO: kilómetros y horas en la calle. Son las que YA existen
-- y son las que NO van acá. Una meta propia de "recorrer X km" invita a inflar el número, y el
-- número se infla manejando de más — que le cuesta plata a la empresa y le arruina el día a la
-- persona. La meta propia mide venta; el recorrido lo mira el supervisor, que es otra conversación.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La tabla
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.metas (
  id          uuid primary key,
  id_empresa  uuid not null references public.empresas(id),
  id_usuario  uuid not null references public.perfiles(id),
  periodo     text not null check (periodo in ('diaria','mensual','anual')),
  -- Qué se mide. El CHECK es la lista blanca: una métrica nueva se agrega acá y en el motor de
  -- abajo, en ese orden. Sin el check, un typo en el cliente crea una meta que nunca se va a poder
  -- calcular y que igual se muestra como "0 de X" para siempre.
  metrica     text not null check (metrica in (
    'monto',            -- pesos vendidos (sin anulados)
    'pedidos',          -- cantidad de pedidos
    'clientes',         -- comercios distintos visitados
    'efectividad',      -- % de visitas que terminan en pedido
    'ticket_promedio',  -- pesos por pedido
    'clientes_nuevos',  -- comercios que compran por primera vez
    'cobertura'         -- % de la cartera propia visitada en el período
  )),
  valor       numeric(14,2) not null check (valor > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- UNA meta por persona, período y métrica. Es lo que permite que el cliente haga upsert sin leer
-- primero, y lo que impide la lista con "meta diaria de monto" repetida tres veces con valores
-- distintos y ninguna forma de saber cuál vale.
create unique index if not exists metas_unica_idx
  on public.metas (id_usuario, periodo, metrica);

comment on table public.metas is
  'Las metas de venta que cada persona se fija. Las pone y las cambia el propio vendedor; el '
  'encargado y el admin las ven. NO incluye km ni horas a proposito: ver el encabezado de db/56.';

alter table public.metas enable row level security;

-- Ver: las mias, y las de mi gente si soy encargado/admin. Misma jerarquia que todo el resto.
drop policy if exists metas_sel on public.metas;
create policy metas_sel on public.metas
  for select using (
    es_superadmin() or (
      id_empresa = mi_empresa()
      and id_usuario in (select ids_a_mi_cargo())
    )
  );

-- 🔑 Escribir: SOLO las propias, para cualquier rol. Un encargado que ve las metas de su equipo NO
-- se las puede cambiar — la meta que te pone otro no es una meta, es una cuota, y eso el dueño no lo
-- pidió. Si se decide lo contrario, se toca esta policy y nada más.
drop policy if exists metas_ins on public.metas;
create policy metas_ins on public.metas
  for insert with check (id_empresa = mi_empresa() and id_usuario = auth.uid());

drop policy if exists metas_upd on public.metas;
create policy metas_upd on public.metas
  for update using (id_empresa = mi_empresa() and id_usuario = auth.uid())
       with check (id_empresa = mi_empresa() and id_usuario = auth.uid());

drop policy if exists metas_del on public.metas;
create policy metas_del on public.metas
  for delete using (id_empresa = mi_empresa() and id_usuario = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El motor — qué lleva vendido esta persona en este rango
-- ─────────────────────────────────────────────────────────────────────────────
-- 🩸 VA EN SQL Y NO EN EL TELÉFONO, por dos motivos concretos:
--
--  1. **"Clientes nuevos" no se puede calcular con lo que el teléfono tiene.** Es "comercios que
--     compraron por primera vez en este rango", y para saberlo hay que mirar TODA la historia de ese
--     comercio, no la ventana que se está mostrando. Bajarla al teléfono sería traer la tabla entera
--     para contar unos pocos.
--  2. La meta anual mira 365 días de pedidos. `usePedidos` pagina de a 1.000 y trae el comercio y la
--     persona embebidos: para un número escalar eso es bajar megabytes por un `sum()`.
--
-- ⚠️ EL DÍA ES EL DE SALTA, no UTC. Mismo criterio que `metricas_actividad` (db/21) y que `hoyStr()`
-- en el cliente: con UTC−3, todo lo vendido después de las 21:00 caería en el día siguiente y la
-- meta diaria se cerraría con tres horas de ventas del día anterior adentro.
create or replace function public.metricas_venta(
  p_id_usuario uuid,
  p_desde date,
  p_hasta date
)
returns table (
  monto            numeric,
  pedidos          bigint,
  clientes         bigint,
  visitas          bigint,
  clientes_nuevos  bigint,
  cartera          bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_empresa uuid := (select mi_empresa());
  v_desde   timestamptz := (p_desde::text || ' 00:00:00')::timestamp at time zone 'America/Argentina/Salta';
  v_hasta   timestamptz := ((p_hasta + 1)::text || ' 00:00:00')::timestamp at time zone 'America/Argentina/Salta';
begin
  -- 🔴 EL ALCANCE SE DECIDE ACÁ ADENTRO, NUNCA SE CONFÍA EN EL PARÁMETRO. Es SECURITY DEFINER: si
  -- se aceptara cualquier `p_id_usuario`, un vendedor podría pedir las ventas de un compañero —o de
  -- otra distribuidora— con un fetch a mano. La lista de a quién puedo mirar ya existe y es la
  -- misma de todas las policies.
  if p_id_usuario is null or p_id_usuario not in (select ids_a_mi_cargo()) then
    raise exception 'Sin permiso para ver las metricas de esa persona';
  end if;

  -- Techo de ventana: la meta anual son 366 días. Más que eso no lo pide ninguna pantalla y sí lo
  -- pediría un bucle mal escrito. Mismo criterio que `metricas_actividad`.
  if p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango invalido';
  end if;

  return query
  with ped as (
    select p.id, p.id_cliente, p.monto_total, p.created_at
      from public.pedidos p
     where p.id_empresa = v_empresa
       and p.id_vendedor = p_id_usuario
       and p.created_at >= v_desde
       and p.created_at <  v_hasta
       -- Un pedido anulado no se factura: no suma al monto ni cuenta como pedido. Contarlo seria
       -- decirle que vendio algo que no vendio.
       and p.estado <> 'Anulado'
  ),
  vis as (
    select v.id, v.id_cliente
      from public.visitas v
     where v.id_empresa = v_empresa
       and v.id_usuario = p_id_usuario
       and v.check_in_ts >= v_desde
       and v.check_in_ts <  v_hasta
       and v.estado <> 'cancelado'
  ),
  nuevos as (
    -- Comercios cuyo PRIMER pedido de la historia cae dentro del rango. El `min()` mira toda la
    -- historia del comercio con CUALQUIER vendedor: un cliente que ya le compraba a un companero no
    -- es nuevo para la empresa, y la meta es de la empresa aunque la fije la persona.
    select count(*)::bigint as n
      from (
        select p.id_cliente, min(p.created_at) as primera
          from public.pedidos p
         where p.id_empresa = v_empresa
           and p.estado <> 'Anulado'
           and p.id_cliente in (select distinct id_cliente from ped where id_cliente is not null)
         group by p.id_cliente
      ) h
     where h.primera >= v_desde and h.primera < v_hasta
  )
  select
    coalesce((select sum(monto_total) from ped), 0)::numeric              as monto,
    (select count(*) from ped)::bigint                                    as pedidos,
    (select count(distinct id_cliente) from vis)::bigint                  as clientes,
    (select count(*) from vis)::bigint                                    as visitas,
    (select n from nuevos)::bigint                                        as clientes_nuevos,
    -- ⚠️ LA CARTERA PROPIA HOY ES CASI VACÍA, y el que consuma esto tiene que saberlo: la
    -- importación masiva no cargó `id_vendedor`, así que de ~2.000 comercios sólo un puñado está
    -- asignado. La cobertura va a dar 0 de 0 para casi todos. Se devuelve el número igual —es la
    -- verdad— y la pantalla NO muestra la métrica cuando la cartera es cero, en vez de dibujar un
    -- 0 % que se lee como "no visitó a nadie".
    (select count(*) from public.clientes c
      where c.id_empresa = v_empresa
        and c.id_vendedor = p_id_usuario
        and coalesce(c.activo, true))::bigint                             as cartera;
end;
$function$;

comment on function public.metricas_venta(uuid, date, date) is
  'Lo vendido por una persona en un rango: monto, pedidos, clientes visitados, visitas, clientes '
  'nuevos y tamano de cartera. El dia es el de Salta. El alcance sale de ids_a_mi_cargo(), NUNCA '
  'del parametro.';

-- 🚨 Regla 7 + 7-bis: revocar de los TRES y recién después el grant. Supabase le da EXECUTE
-- explícito a anon y authenticated a cada función nueva de `public` vía ALTER DEFAULT PRIVILEGES, y
-- un grant explícito NO se va con un revoke a PUBLIC.
revoke execute on function public.metricas_venta(uuid, date, date) from public;
revoke execute on function public.metricas_venta(uuid, date, date) from anon;
revoke execute on function public.metricas_venta(uuid, date, date) from authenticated;
-- La llama el vendedor desde su teléfono, y el recorte por persona y por empresa está adentro.
grant execute on function public.metricas_venta(uuid, date, date) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación (correr a mano después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
--   select proname, proacl from pg_proc
--    where pronamespace='public'::regnamespace and proname='metricas_venta';
--   -- esperado: `authenticated=X` SÍ, `anon=X` NO. Mirar el ACL real, no asumir (regla 7-bis).
--
--   -- Y que un VENDEDOR la pueda ejecutar de verdad, que es el bug que ya se pagó con
--   -- `sello_precios` (db/52): la policy que la habilitaba no incluía al rol vendedor.
--   select has_function_privilege('authenticated', 'public.metricas_venta(uuid,date,date)', 'execute');
--
--   -- 🔴 Y la prueba que importa: que NO deje espiar. Con la sesión de un vendedor, pedir las
--   -- métricas de OTRO usuario tiene que tirar excepción, no devolver ceros:
--   --   select * from metricas_venta('<uuid de un companero>', current_date, current_date);
