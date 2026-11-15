-- 110_wa_asistente_mejoras.sql — mejoras del asistente de CONSULTAS (15/11/2026, plan 48).
--
-- Sale de la auditoría del 15/11 (`auditor\auditoria-2026-11-15.md`): Javier pidió 5 veces la hora y el lugar
-- del primer pedido de cada vendedor (no existía) y Santiago, el ranking de TODOS los productos y los menos
-- vendidos de un vendedor (solo había los 5 más vendidos de la empresa).
--
-- 1. `wa_primer_pedido`: por vendedor y día, inicio de jornada (primer punto GPS) y su primer pedido.
-- 2. `wa_productos_ranking`: ranking de productos con orden (más/menos), límite y vendedor opcional.
-- 3. Horarios del auditor: análisis 01:00–07:50 de Salta y resumen cada hora de 08:00 a 12:00 (el 11/11 el
--    servidor estaba apagado a las 08:00 y ese resumen no existió; `resumenDiario` ya es uno por día).
--
-- 🔑 Solo `service_role` (regla 7-bis). Sin begin/commit: probar con `begin; \i ...; rollback;` y aplicar
-- con `psql -1 -f`. Volver atrás: al final del archivo.

-- ── 1. Primer pedido del día ─────────────────────────────────────────────────────────────────────
-- `distancia_m` solo con GPS confiable (accuracy ≤ 30 m), igual que `wa_control_visitas`.
create or replace function public.wa_primer_pedido(p_empresa uuid, p_fecha date, p_perfil uuid, p_persona uuid)
returns jsonb
language sql stable set search_path = public as $$
  with ped as (
    select p.*
      from public.wa_pedidos_visibles(p_empresa, p_perfil) p
     where p.estado <> 'Anulado' and p.id_vendedor is not null
       and (p_persona is null or p.id_vendedor = p_persona)
       and p.created_at >= p_fecha::timestamp at time zone 'America/Argentina/Salta'
       and p.created_at <  (p_fecha + 1)::timestamp at time zone 'America/Argentina/Salta'
  ),
  primero as (
    select distinct on (ped.id_vendedor) ped.id_vendedor, ped.numero, ped.created_at, ped.lat, ped.lng,
           case when coalesce(ped.accuracy, 0) <= 30 then round(ped.distancia_m) end as distancia_m,
           c.nombre_comercio as cliente, c.codigo as codigo_cliente, c.localidad
      from ped left join public.clientes c on c.id = ped.id_cliente
     order by ped.id_vendedor, ped.created_at
  ),
  cuenta as (select id_vendedor, count(*) as pedidos from ped group by id_vendedor),
  jornada as (
    select a.id_usuario, a.primer_ts
      from public.actividad_diaria(p_empresa, p_fecha, p_fecha, array(select id_vendedor from primero)) a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'nombre', pf.nombre, 'inicio_ts', j.primer_ts, 'pedido_ts', pr.created_at, 'numero', pr.numero,
           'cliente', pr.cliente, 'codigo_cliente', pr.codigo_cliente, 'localidad', pr.localidad,
           'distancia_m', pr.distancia_m, 'lat', pr.lat, 'lng', pr.lng, 'pedidos', cu.pedidos
         ) order by pr.created_at), '[]'::jsonb)
    from primero pr
    join public.perfiles pf on pf.id = pr.id_vendedor
    join cuenta cu on cu.id_vendedor = pr.id_vendedor
    left join jornada j on j.id_usuario = pr.id_vendedor
$$;

-- ── 2. Ranking de productos ──────────────────────────────────────────────────────────────────────
-- `p_orden`: 'mas' o 'menos' (los menos vendidos ENTRE los que se vendieron: lo que no se vendió nunca no
-- tiene fila). `p_limite` entre 1 y 50: más no entra en un WhatsApp (4096 caracteres).
create or replace function public.wa_productos_ranking(p_empresa uuid, p_desde date, p_hasta date, p_perfil uuid,
                                                       p_persona uuid, p_orden text, p_limite int)
returns jsonb
language sql stable set search_path = public as $$
  with v as (
    select pr.descripcion, sum(i.cantidad) as cant, sum(i.cantidad * i.precio_unitario) as monto
      from public.wa_pedidos_visibles(p_empresa, p_perfil) p
      join public.pedido_items i on i.id_pedido = p.id
      join public.productos pr on pr.id = i.id_producto
     where p.estado <> 'Anulado'
       and (p_persona is null or p.id_vendedor = p_persona)
       and p.created_at >= p_desde::timestamp at time zone 'America/Argentina/Salta'
       and p.created_at <  (p_hasta + 1)::timestamp at time zone 'America/Argentina/Salta'
     group by pr.id, pr.descripcion
    having sum(i.cantidad) > 0
  ),
  orden as (
    select descripcion, cant, round(monto, 2) as monto,
           row_number() over (order by case when p_orden = 'menos' then monto end asc,
                                       case when p_orden = 'menos' then null else monto end desc,
                                       descripcion) as n
      from v
  )
  select jsonb_build_object(
    'total', (select count(*) from v),
    'monto_total', (select round(coalesce(sum(monto), 0), 2) from v),
    'productos', coalesce((select jsonb_agg(jsonb_build_object('descripcion', descripcion, 'cant', cant, 'monto', monto) order by n)
                             from orden where n <= least(greatest(coalesce(p_limite, 5), 1), 50)), '[]'::jsonb)
  )
$$;

-- ── 3. Permisos ──────────────────────────────────────────────────────────────────────────────────
revoke all on function public.wa_primer_pedido(uuid, date, uuid, uuid) from public, anon, authenticated;
revoke all on function public.wa_productos_ranking(uuid, date, date, uuid, uuid, text, int) from public, anon, authenticated;
grant execute on function public.wa_primer_pedido(uuid, date, uuid, uuid) to service_role;
grant execute on function public.wa_productos_ranking(uuid, date, date, uuid, uuid, text, int) to service_role;

-- ── 4. Horarios del auditor (UTC) ────────────────────────────────────────────────────────────────
select cron.alter_job(jobid, schedule := '*/10 4-10 * * *') from cron.job where jobname = 'wa-auditor-analizar';
select cron.alter_job(jobid, schedule := '0 11-15 * * *')   from cron.job where jobname = 'wa-auditor-resumen';

notify pgrst, 'reload schema';

-- Volver atrás:
--   drop function public.wa_primer_pedido(uuid, date, uuid, uuid);
--   drop function public.wa_productos_ranking(uuid, date, date, uuid, uuid, text, int);
--   select cron.alter_job(jobid, schedule := '*/10 4-6 * * *') from cron.job where jobname = 'wa-auditor-analizar';
--   select cron.alter_job(jobid, schedule := '0 11 * * *')     from cron.job where jobname = 'wa-auditor-resumen';
