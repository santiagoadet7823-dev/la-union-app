-- 17_reclamar_ubicar_cliente.sql — Actualización 1.6.x (27/07/2026).
-- Feature C: el vendedor guarda la ubicación (lat/lng) de un comercio al hacer check-in.
-- Problema que resuelve: la RLS `clientes_upd` solo deja al vendedor tocar clientes donde
-- id_vendedor = auth.uid(); pero ~1.983 de los 1.998 clientes importados NO tienen vendedor
-- asignado (id_vendedor IS NULL), así que un update directo del vendedor sería rechazado.
--
-- Decisión del cliente (27/07): "reclamar pero reversible". Esta RPC (SECURITY DEFINER) reclama
-- el cliente (id_vendedor = auth.uid()) y fija sus coordenadas EN UNA sola operación segura,
-- solo si el cliente es de su empresa y está sin dueño (o ya es suyo). La reversibilidad la da la
-- RLS normal: admin/encargado pueden reasignar/liberar id_vendedor con un update común.
--
-- SECURITY DEFINER bypassa RLS, por eso el WHERE valida empresa y propiedad a mano.
-- auth.uid() / mi_empresa() siguen leyendo el JWT del que llama (no del definer).

create or replace function public.reclamar_y_ubicar_cliente(
  p_id  uuid,
  p_lat double precision,
  p_lng double precision
)
returns public.clientes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     public.clientes;
  v_empresa uuid := mi_empresa();
begin
  update public.clientes
     set id_vendedor = auth.uid(),
         lat = coalesce(p_lat, lat),
         lng = coalesce(p_lng, lng)
   where id = p_id
     and id_empresa = v_empresa
     and (id_vendedor is null or id_vendedor = auth.uid())
  returning * into v_row;

  if not found then
    raise exception
      'No se puede reclamar/ubicar el cliente % (no existe, es de otra empresa, o ya tiene otro vendedor).', p_id
      using errcode = '42501';
  end if;

  return v_row;
end;
$$;

-- Postgres concede EXECUTE a PUBLIC por defecto (revocar FROM PUBLIC, regla 7). ADEMÁS, Supabase
-- concede EXECUTE a anon por DEFAULT PRIVILEGES (grant explícito a anon, no vía PUBLIC): esta RPC
-- no debe ser llamable sin sesión, así que acá revocar de anon SÍ corresponde (no es no-op).
revoke execute on function public.reclamar_y_ubicar_cliente(uuid, double precision, double precision) from public;
revoke execute on function public.reclamar_y_ubicar_cliente(uuid, double precision, double precision) from anon;
grant  execute on function public.reclamar_y_ubicar_cliente(uuid, double precision, double precision) to authenticated;
