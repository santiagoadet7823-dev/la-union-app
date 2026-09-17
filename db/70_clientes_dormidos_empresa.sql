-- 70_clientes_dormidos_empresa.sql — los clientes dormidos de TODA la empresa, para el mapa de
-- monitoreo (17/09/2026).
--
-- `clientes_dormidos` (db/57) es POR VENDEDOR: "a quién le vendía ESTE vendedor y hace más de N
-- días que no". Sirve para su tablero. Para el supervisor la pregunta es otra: "¿a qué comercio
-- hace más de N días que NADIE de la empresa le vende?". Con la RPC por vendedor eso serían tantas
-- llamadas como vendedores por cada apertura del mapa, y encima un comercio que dejó de comprarle
-- a Gabriel pero le compra a Nelson saldría "dormido" por error.
--
-- Calcada de db/57 con tres diferencias:
--   1. la última compra es de CUALQUIER vendedor de la empresa;
--   2. el permiso es por ROL (superadmin / admin / encargado), y el encargado ve sólo los comercios
--      cuya última compra fue de gente a su cargo (`ids_a_mi_cargo()`, la misma regla que
--      `visitas_sel`);
--   3. `p_empresa` sólo se respeta si quien llama es superadmin (mismo trato que
--      `metricas_venta_equipo`): un admin siempre mira la suya.
--
-- El tope es 500 y no 50: acá no hay tablero que se corte "por abajo", es un mapa y cada rojo es
-- una alarma. Sigue ordenado por monto histórico para que, si se corta, se corte por lo que menos
-- plata movía.

create or replace function public.clientes_dormidos_empresa(
  p_dias    integer default 30,
  p_limite  integer default 300,
  p_empresa uuid    default null
)
returns table (
  id_cliente       uuid,
  ultima_compra    timestamptz,
  dias_sin_comprar integer,
  compras          bigint,
  monto_historico  numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rol     text := (select mi_rol());
  v_empresa uuid;
begin
  if v_rol not in ('superadmin', 'admin', 'encargado') then
    raise exception 'Sin permiso para ver los clientes dormidos de la empresa';
  end if;

  v_empresa := case
    when (select es_superadmin()) and p_empresa is not null then p_empresa
    else (select mi_empresa())
  end;

  return query
  with compras as (
    select p.id_cliente,
           max(p.created_at)  as ultima,
           count(*)::bigint   as veces,
           sum(p.monto_total) as total
      from public.pedidos p
     where p.id_empresa = v_empresa
       and p.estado <> 'Anulado'
       and p.id_cliente is not null
     group by p.id_cliente
  ),
  -- Para el encargado: sólo los comercios cuya ÚLTIMA compra la tomó alguien a su cargo. Se
  -- decide sobre la última y no sobre "alguna", porque es la última la que dice quién lo atiende.
  ultimo_vendedor as (
    select distinct on (p.id_cliente) p.id_cliente, p.id_vendedor
      from public.pedidos p
     where p.id_empresa = v_empresa
       and p.estado <> 'Anulado'
       and p.id_cliente is not null
     order by p.id_cliente, p.created_at desc
  )
  select
    c.id_cliente,
    c.ultima                                        as ultima_compra,
    (extract(day from (now() - c.ultima)))::integer as dias_sin_comprar,
    c.veces                                         as compras,
    c.total                                         as monto_historico
  from compras c
  join public.clientes cl on cl.id = c.id_cliente
  left join ultimo_vendedor uv on uv.id_cliente = c.id_cliente
  where c.ultima < now() - make_interval(days => greatest(1, coalesce(p_dias, 30)))
    and coalesce(cl.activo, true)
    and (v_rol <> 'encargado' or uv.id_vendedor in (select ids_a_mi_cargo()))
  order by c.total desc nulls last, c.ultima asc
  limit greatest(1, least(coalesce(p_limite, 300), 500));
end;
$$;

grant execute on function public.clientes_dormidos_empresa(integer, integer, uuid) to authenticated;
