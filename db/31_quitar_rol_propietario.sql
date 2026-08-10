-- 31 — Quitar el rol `propietario`: el dueño de la distribuidora usa `admin`.
--
-- POR QUÉ.
-- `propietario` se creó en `db/20` (27/07/2026) para el dueño, con su propia pantalla y su propia
-- rama de ruteo. Nunca se usó: al 08/08/2026 la base tiene **0 perfiles** con ese rol (15 vendedor,
-- 6 encargado, 1 superadmin, 1 repartidor, 1 admin). Era un rol entero —CHECK, 8 policies, 1 RPC y
-- media docena de listas en la UI— mantenido para nadie, y cada policy nueva tenía que acordarse de
-- incluirlo o el dueño perdía acceso en silencio.
--
-- POR QUÉ ES SEGURO.
-- Las 8 policies que lo nombran **ya incluyen `admin` en el mismo array**, así que sacarlo es una
-- resta pura: no le quita acceso a nadie que hoy pueda leer algo. Lo mismo la guarda de rol de
-- `metricas_actividad`.
--
-- ORDEN (importa): la aserción va PRIMERO. Si algún día alguien creó un perfil con este rol, la
-- migración aborta entera en vez de dejar el CHECK rechazando una fila que ya existe.

begin;

-- ── 1. Aserción ───────────────────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from public.perfiles where rol = 'propietario') then
    raise exception
      'Hay % perfil(es) con rol propietario. Migralos a admin antes de correr esto.',
      (select count(*) from public.perfiles where rol = 'propietario');
  end if;
end $$;

-- ── 2. Policies ───────────────────────────────────────────────────────────────
-- Cada una se recrea IDÉNTICA salvo por el elemento que se saca del array. Ojo con el `to`:
-- `visitas_sel` es `to authenticated` y el resto `to public` — cambiarlo sería un efecto colateral.

drop policy if exists alertas_sel on public.alertas_equipo;
create policy alertas_sel on public.alertas_equipo for select to public
using (
  (select es_superadmin())
  or (id_empresa = (select mi_empresa()) and (select mi_rol()) = any (array['admin','encargado']))
);

drop policy if exists alertas_upd on public.alertas_equipo;
create policy alertas_upd on public.alertas_equipo for update to public
using (
  id_empresa = (select mi_empresa()) and (select mi_rol()) = any (array['admin','encargado'])
)
with check (
  id_empresa = (select mi_empresa()) and (select mi_rol()) = any (array['admin','encargado'])
);

drop policy if exists clientes_sel on public.clientes;
create policy clientes_sel on public.clientes for select to public
using (
  es_superadmin()
  or (
    id_empresa = mi_empresa()
    and (
      mi_rol() = any (array['admin','encargado','superadmin'])
      or id_vendedor = auth.uid()
      or id_vendedor is null
    )
  )
);

drop policy if exists estado_disp_sel on public.estado_dispositivo;
create policy estado_disp_sel on public.estado_dispositivo for select to public
using (
  es_superadmin()
  or id_usuario = auth.uid()
  or (id_empresa = mi_empresa() and mi_rol() = any (array['admin','encargado']))
);

drop policy if exists perfiles_sel on public.perfiles;
create policy perfiles_sel on public.perfiles for select to public
using (
  id = auth.uid()
  or es_superadmin()
  or (
    mi_rol() = any (array['admin','encargado'])
    and (id_empresa = mi_empresa() or id_empresa is null)
  )
);

-- 🚨 Regla 10: el alcance de tenant va como subconsulta, no como predicado escalar por fila.
-- `posiciones` es la tabla de alto volumen y esto se paginan de a 1.000 filas.
drop policy if exists posiciones_sel on public.posiciones;
create policy posiciones_sel on public.posiciones for select to public
using (
  (select es_superadmin())
  or id_usuario = (select auth.uid())
  or (id_empresa = (select mi_empresa()) and (select mi_rol()) = any (array['admin','encargado']))
);

drop policy if exists recorridos_snap_sel on public.recorridos_snap;
create policy recorridos_snap_sel on public.recorridos_snap for select to public
using (
  es_superadmin()
  or id_usuario = auth.uid()
  or (id_empresa = mi_empresa() and mi_rol() = any (array['admin','encargado']))
);

drop policy if exists ucomp_sel on public.ubicaciones_compartidas;
create policy ucomp_sel on public.ubicaciones_compartidas for select to public
using (
  id_usuario = (select auth.uid())
  or (select es_superadmin())
  or (id_empresa_destino = (select mi_empresa()) and (select mi_rol()) = any (array['admin','encargado']))
);

drop policy if exists visitas_sel on public.visitas;
create policy visitas_sel on public.visitas for select to authenticated
using (
  (select es_superadmin())
  or id_usuario = (select auth.uid())
  or (id_empresa = (select mi_empresa()) and (select mi_rol()) = any (array['admin','encargado']))
);

-- ── 3. RPC de métricas ────────────────────────────────────────────────────────
-- Solo cambia la lista de roles de la guarda; el cuerpo es el de `db/21` sin tocar.
--
-- ⚠️ `create or replace` CONSERVA el ACL, y acá eso es lo que queremos: esta función la llama la
-- app desde el navegador, o sea que `authenticated` TIENE que conservar EXECUTE. La regla 7-bis
-- (revocar de los tres) aplica a las SECURITY DEFINER que cruzan empresas y que solo debe invocar
-- `service_role` — no es el caso: acá el alcance de tenant está adentro (`id_empresa = mi_empresa()`)
-- y hay guarda de rol. Lo que sí hay que verificar después es que no aparezca `anon` ni PUBLIC.
create or replace function public.metricas_actividad(p_desde date, p_hasta date)
returns table(
  dia date, id_usuario uuid, km numeric, puntos integer,
  primer_ts timestamptz, ultimo_ts timestamptz,
  minutos_movimiento integer, paradas integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_rol text := mi_rol();
begin
  if v_rol is null or v_rol not in ('admin', 'superadmin', 'encargado') then
    raise exception 'Sin permiso para leer las métricas del equipo.' using errcode = '42501';
  end if;

  if p_hasta < p_desde or (p_hasta - p_desde) > 400 then
    raise exception 'Rango de fechas inválido.' using errcode = '22023';
  end if;

  return query
  with base as (
    select
      p.id_usuario                                       as u,
      (p.ts at time zone 'America/Argentina/Salta')::date as d,
      p.ts                                               as t,
      p.id                                               as pid,
      p.lat, p.lng
    from posiciones p
    where p.id_empresa = mi_empresa()
      and p.ts >= ((p_desde::timestamp)       at time zone 'America/Argentina/Salta')
      and p.ts <  (((p_hasta + 1)::timestamp) at time zone 'America/Argentina/Salta')
      and p.id_usuario is not null
  ),
  seg as (
    select
      d, u, t,
      lag(t)   over w as t_prev,
      lag(lat) over w as lat_prev,
      lag(lng) over w as lng_prev,
      lat, lng
    from base
    window w as (partition by u, d order by t, pid)
  ),
  dist as (
    select
      d, u, t, t_prev,
      case
        when lat_prev is null then null
        else 2 * 6371000 * asin(least(1, sqrt(
               power(sin(radians(lat - lat_prev) / 2), 2) +
               cos(radians(lat_prev)) * cos(radians(lat)) *
               power(sin(radians(lng - lng_prev) / 2), 2)
             )))
      end as metros
    from seg
  ),
  marca as (
    select d, u, t, t_prev, metros,
           case when metros is null or metros >= 40 then 1 else 0 end as rompe
    from dist
  ),
  grupos as (
    select d, u, t, t_prev, metros, rompe,
           sum(rompe) over (partition by u, d order by t rows between unbounded preceding and current row) as g
    from marca
  ),
  racimos as (
    select d, u, g, min(t) as ini, max(t) as fin
    from grupos
    group by d, u, g
  ),
  paradas_dia as (
    select d, u,
           count(*)::int                                 as n,
           sum(extract(epoch from (fin - ini)))::numeric as seg_parado
    from racimos
    where fin - ini >= interval '5 minutes'
    group by d, u
  ),
  totales as (
    select d, u,
           coalesce(sum(metros), 0) / 1000.0 as km_dia,
           count(*)::int                     as n_puntos,
           min(t)                            as t_ini,
           max(t)                            as t_fin
    from dist
    group by d, u
  )
  select
    tt.d,
    tt.u,
    round(tt.km_dia::numeric, 3),
    tt.n_puntos,
    tt.t_ini,
    tt.t_fin,
    greatest(0, floor((extract(epoch from (tt.t_fin - tt.t_ini)) - coalesce(pd.seg_parado, 0)) / 60))::int,
    coalesce(pd.n, 0)
  from totales tt
  left join paradas_dia pd on pd.d = tt.d and pd.u = tt.u
  order by tt.d, tt.u;
end;
$function$;

-- Cinturón por si alguna vez se recrea desde cero (regla 7 + 7-bis): nunca `anon`, nunca PUBLIC.
revoke execute on function public.metricas_actividad(date, date) from public;
revoke execute on function public.metricas_actividad(date, date) from anon;
grant  execute on function public.metricas_actividad(date, date) to authenticated;

-- ── 4. CHECK constraint ───────────────────────────────────────────────────────
-- Va ÚLTIMO: es lo que hace imposible volver a crear el rol. Reemplaza al de `db/20`.
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check
  check (rol = any (array['superadmin','admin','encargado','vendedor','repartidor']));

commit;
