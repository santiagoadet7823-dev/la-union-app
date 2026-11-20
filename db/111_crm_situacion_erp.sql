-- =============================================================================
--  db/111 — ARM: "pronto a despacho" solo si de verdad lo es (plan 51, 20/11/2026)
--
--  QUÉ RESUELVE
--  db/108 decía "pronto a despacho" para todo pedido exportado al ERP sin repartidor. Pero La Unión
--  no marca repartos ni entregas en la app: sus pedidos exportados quedan "Pendiente" para siempre, y
--  el panel mostraba como "pronto a despacho" pedidos de hace semanas (medido 20/11: los 16 del
--  cliente de la demo). Ahora:
--    · pronto_despacho = exportado en las últimas 48 h, sin repartidor, y con la fecha de entrega
--      (si la tiene) de hoy en adelante;
--    · en_erp          = exportado antes, sin datos de reparto: "Cargado en el ERP" (no se inventa
--      si se entregó o no).
--  Solo reemplaza `crm_pedidos_cliente` (misma firma y permisos). (La 109 está reservada por el plan 47.)
--  Volver atrás: volver a correr la sección 3 de db/108.
-- =============================================================================
begin;

create or replace function public.crm_pedidos_cliente(p_conv uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c        public.crm_conversaciones;
  v_cli    uuid;
  v_res    jsonb;
  v_demo   jsonb := '[]'::jsonb;
begin
  if public.crm_acceso() is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;
  select * into c from public.crm_conversaciones
   where id = p_conv and id_empresa in (select public.crm_empresas());
  if c.id is null then
    raise exception 'crm-sin-permiso' using errcode = '42501';
  end if;

  if c.demo then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id, 'numero', coalesce(t.numero_pedido, 'DEMO'), 'estado', 'Pendiente', 'origen', 'whatsapp',
             'created_at', t.confirmado_ts, 'monto_total', t.total, 'situacion', 'abierto', 'editable_arm', false,
             'motivo_bloqueo', 'Pedido de demostración: no existe en el sistema real.', 'demo', true,
             'items', t.items) order by t.confirmado_ts desc), '[]'::jsonb)
      into v_demo
      from public.crm_tickets t
     where t.id_conversacion = c.id and t.estado = 'confirmado';
  end if;

  select ct.id_cliente into v_cli from public.crm_contactos ct where ct.id = c.id_contacto;
  if v_cli is null then
    return v_demo;
  end if;

  with base as (
    select p.*,
           case
             when p.estado = 'Anulado' then 'anulado'
             when p.estado = 'Entregado' then 'entregado'
             when p.estado = 'No entregado' then 'no_entregado'
             when p.estado = 'En camino' or (p.exportado_ts is not null and p.id_repartidor is not null) then 'en_camino'
             when p.exportado_ts is not null and p.exportado_ts > now() - interval '48 hours'
                  and (p.fecha_entrega is null or p.fecha_entrega >= current_date) then 'pronto_despacho'
             when p.exportado_ts is not null then 'en_erp'
             else 'abierto'
           end as situacion
      from public.pedidos p
     where p.id_cliente = v_cli
       and p.id_empresa = c.id_empresa
       and p.estado <> 'Sin pedido'
       and (p.exportado_ts is null or p.created_at >= now() - interval '30 days')
     order by p.created_at desc
     limit 40
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'numero', b.numero, 'estado', b.estado, 'origen', b.origen,
           'created_at', b.created_at, 'monto_total', b.monto_total, 'fecha_entrega', b.fecha_entrega,
           'exportado_ts', b.exportado_ts, 'export_lote', b.export_lote,
           'ts_en_camino', b.ts_en_camino, 'ts_entregado', b.ts_entregado,
           'vendedor_nombre', (select pf.nombre from public.perfiles pf where pf.id = b.id_vendedor),
           'repartidor_nombre', (select pf.nombre from public.perfiles pf where pf.id = b.id_repartidor),
           'situacion', b.situacion,
           'editable_arm', (not c.demo and b.situacion = 'abierto' and b.origen = 'whatsapp'),
           'motivo_bloqueo', case
               when b.situacion <> 'abierto' then null
               when b.origen is distinct from 'whatsapp'
                 then 'Lo tomó ' || coalesce((select pf.nombre from public.perfiles pf where pf.id = b.id_vendedor), 'un vendedor')
                      || ' en la app: corregilo desde allí.'
               when c.demo then 'Conversación de demostración: solo lectura.'
               end,
           'token', public.crm_token_pedido(b.id),
           'items', coalesce((select jsonb_agg(jsonb_build_object(
                        'id_producto', i.id_producto, 'codigo', i.codigo_producto, 'descripcion', i.descripcion,
                        'cantidad', i.cantidad, 'cantidad_entregada', i.cantidad_entregada,
                        'precio_unitario', i.precio_unitario,
                        'subtotal', round(i.cantidad * i.precio_unitario, 2)) order by i.descripcion)
                      from public.pedido_items i where i.id_pedido = b.id), '[]'::jsonb)
         ) order by b.created_at desc), '[]'::jsonb)
    into v_res
    from base b;
  return v_demo || v_res;
end $$;

revoke all on function public.crm_pedidos_cliente(uuid) from public, anon;
grant execute on function public.crm_pedidos_cliente(uuid) to authenticated, service_role;
notify pgrst, 'reload schema';

commit;
