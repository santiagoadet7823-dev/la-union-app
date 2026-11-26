-- 115_wa_asistente_plan53.sql — asistente de consultas, plan 53 (26/11/2026).
--
-- 1. `wa_clientes_sin_visitar`: Javier preguntó «cuántos clientes tocaba hoy Juan Abregu sin visitar» y no
--    había consulta para eso (contestó otra cosa). Los clientes del vendedor (`clientes.id_vendedor`) cuyo
--    `dias_visita` incluye el día (formato «LU · JU», ≈ 80 % cargado) y que ese día no tuvieron visita ni
--    pedido. Mismo alcance que el resto (db/102): el admin ve la empresa, el encargado a su gente.
--
-- 2. `wa_buscar_personas` sin los perfiles de prueba (cardix1-3, «Prueba tablet vendedor»): «Gabriel»
--    siempre repreguntaba por «Gabriel Tévez DisT-At». Se excluyen por nombre (no hay marca de prueba).
--
-- Solo service_role, como todas las wa_*. Sin begin/commit: probar con `begin; \i …; rollback;`.

create or replace function public.wa_clientes_sin_visitar(p_empresa uuid, p_fecha date, p_perfil uuid, p_persona uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with dia as (
    select (array['LU','MA','MI','JU','VI','SA','DO'])[extract(isodow from p_fecha)::int] as abrev,
           p_fecha::timestamp at time zone 'America/Argentina/Salta' as t0,
           (p_fecha + 1)::timestamp at time zone 'America/Argentina/Salta' as t1
  ),
  vend as (
    select pf.id, pf.nombre
      from public.perfiles pf
     where pf.id_empresa = p_empresa and pf.activo and not coalesce(pf.sistema, false)
       and pf.rol in ('vendedor', 'encargado')
       and pf.nombre !~* '(cardix|prueba tablet)'
       and (p_persona is null or pf.id = p_persona)
       and ((select public.wa_ve_todo(p_perfil)) or pf.id in (select public.ids_a_cargo_de(p_perfil)))
  ),
  tocan as (
    select v.id as u, v.nombre as vendedor, c.id, c.codigo, c.nombre_comercio,
           exists (select 1 from public.visitas vi, dia
                    where vi.id_cliente = c.id and vi.check_in_ts >= dia.t0 and vi.check_in_ts < dia.t1
                      and coalesce(vi.estado, '') <> 'cancelada')
           or exists (select 1 from public.pedidos p, dia
                       where p.id_cliente = c.id and p.estado <> 'Anulado' and p.created_at >= dia.t0 and p.created_at < dia.t1) as visitado
      from vend v
      join public.clientes c on c.id_vendedor = v.id and c.id_empresa = p_empresa
      cross join dia
     where coalesce(c.activo, true) and c.archivado_ts is null
       and upper(coalesce(c.dias_visita, '')) ~ ('(^|[^A-Z])' || dia.abrev || '([^A-Z]|$)')
  ),
  por as (
    select u, vendedor, count(*) as tocaban, count(*) filter (where visitado) as visitados,
           count(*) filter (where not visitado) as sin_visitar,
           coalesce(jsonb_agg(jsonb_build_object('codigo', codigo, 'nombre', nombre_comercio) order by nombre_comercio)
                    filter (where not visitado), '[]'::jsonb) as lista
      from tocan group by u, vendedor
  )
  select jsonb_build_object(
    'dia', (select abrev from dia),
    'sin_dias_cargados', (select count(*) from vend v join public.clientes c on c.id_vendedor = v.id and c.id_empresa = p_empresa
                           where coalesce(c.activo, true) and c.archivado_ts is null and coalesce(c.dias_visita, '') = ''),
    'vendedores', coalesce((select jsonb_agg(to_jsonb(p) - 'u' order by p.sin_visitar desc, p.vendedor) from por p), '[]'::jsonb)
  )
$$;

revoke all on function public.wa_clientes_sin_visitar(uuid, date, uuid, uuid) from public, anon, authenticated;
grant execute on function public.wa_clientes_sin_visitar(uuid, date, uuid, uuid) to service_role;

create or replace function public.wa_buscar_personas(p_empresa uuid, p_texto text, p_perfil uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  with hallados as (
    select pf.id, pf.nombre, pf.rol
      from public.perfiles pf
     where pf.id_empresa = p_empresa
       and pf.activo and not coalesce(pf.sistema, false)
       and pf.rol in ('vendedor', 'repartidor', 'encargado', 'admin')
       and pf.nombre !~* '(cardix|prueba tablet|dist-at)'
       and ((select public.wa_ve_todo(p_perfil)) or pf.id in (select public.ids_a_cargo_de(p_perfil)))
       and public.wa_coincide(pf.nombre, p_texto)
  )
  select jsonb_build_object(
    'total', (select count(*) from hallados),
    'personas', coalesce((select jsonb_agg(to_jsonb(h) order by h.nombre) from (select * from hallados limit 6) h), '[]'::jsonb)
  )
$$;

revoke all on function public.wa_buscar_personas(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.wa_buscar_personas(uuid, text, uuid) to service_role;
