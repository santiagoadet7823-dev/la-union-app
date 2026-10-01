-- 84_estado_plan_tope_pro.sql — 30/09/2026.
-- El panel "Estado del plan" (superadmin, EmpresasView > PanelPlan) medía el tamaño de la base contra
-- 500 MB, el tope del plan Free. La organización es Pro (verificado con el conector de Supabase el
-- 30/09/2026): con la base en ~290 MB el panel marcaba 57,9 % (a punto de pasar a naranja) cuando
-- contra el disco incluido de Pro (8 GiB) son 3,5 %.
--
-- Único cambio respecto de db/19: `db_limit_bytes` pasa de 524288000 (500 MB) a 8589934592 (8 GiB).
-- Misma firma, mismo cuerpo, misma guarda `es_superadmin()` y mismos permisos.
--
-- ⚠️ 8 GiB es el disco INCLUIDO en Pro. Supabase puede haberlo ampliado en este proyecto (el disco
-- crece solo al llenarse); el conector no expone el tamaño real. Si se amplía, se cambia acá con una
-- migración nueva: el front (PanelPlan) lee `db_limit_bytes` tal cual, no tiene el número escrito.
--
-- Revertir: volver a aplicar db/19 (524288000).

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
    'db_limit_bytes',   8589934592,                                 -- 8 GiB de disco incluido en el plan Pro
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

-- Mismos permisos que db/19 (regla 7): fuera de public y de anon; la guarda va adentro de la función.
revoke execute on function public.estado_plan() from public;
revoke execute on function public.estado_plan() from anon;
grant  execute on function public.estado_plan() to authenticated;
