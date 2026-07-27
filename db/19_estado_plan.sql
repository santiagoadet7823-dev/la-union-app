-- 19_estado_plan.sql — Actualización 1.6.x (27/07/2026).
-- Feature F: panel superadmin de "estado del plan" de Supabase. Devuelve lo que SÍ se puede leer
-- por SQL (tamaño de base, volumen de posiciones, conteos). OJO: egress/MAU/billing NO son
-- consultables por SQL — para eso el panel remite al dashboard de Supabase (copy honesto en la UI).
-- SECURITY DEFINER + guarda es_superadmin() adentro: pg_database_size requiere permisos elevados.

create or replace function public.estado_plan()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v json;
begin
  if not es_superadmin() then
    raise exception 'Solo el superadmin puede consultar el estado del plan.' using errcode = '42501';
  end if;

  select json_build_object(
    'db_bytes',         pg_database_size(current_database()),
    'db_limit_bytes',   524288000,                                  -- 500 MB del plan free
    'posiciones',       (select count(*) from posiciones),
    'posiciones_bytes', pg_total_relation_size('posiciones'),
    'clientes',         (select count(*) from clientes),
    'clientes_geo',     (select count(*) from clientes where lat is not null and lng is not null),
    'perfiles',         (select count(*) from perfiles),
    'empresas',         (select count(*) from empresas),
    'dispositivos',     (select count(*) from estado_dispositivo),
    'pos_desde',        (select min(ts) from posiciones),
    'pos_hasta',        (select max(ts) from posiciones)
  ) into v;

  return v;
end;
$$;

-- revoke from public (regla 7) + from anon (Supabase concede a anon por default privileges: acá SÍ
-- corresponde quitarlo, la RPC ya se guarda con es_superadmin() adentro igual).
revoke execute on function public.estado_plan() from public;
revoke execute on function public.estado_plan() from anon;
grant  execute on function public.estado_plan() to authenticated;
