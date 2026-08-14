-- 40_jerarquia_encargados.sql — Jerarquía entre encargados (13/08/2026).
--
-- EL PEDIDO (Zura, encargado 1): que los encargados tengan jerarquía. Zura ve a todo el mundo;
-- Javier —encargado 2— no puede ver a Zura.
--
-- POR QUÉ NO ES UN BOOLEANO EN UNA PANTALLA. Hoy "el encargado ve todo" no está escrito en un
-- lugar: está escrito en NUEVE, y la mitad no son policies. Verificado contra la base viva antes
-- de tocar nada:
--
--   RLS (SELECT)      perfiles_sel · posiciones_sel · estado_disp_sel · visitas_sel ·
--                     alertas_sel · recorridos_snap_sel · clientes_sel · pedidos_sel
--   RLS (UPDATE)      visitas_upd  — el encargado además EDITA visitas ajenas
--   SECURITY DEFINER  metricas_actividad — saltea RLS por completo, filtra solo por empresa
--
-- Si se arreglan ocho y se olvida una, Javier deja de ver a Zura en el mapa pero lo sigue viendo
-- en las métricas, o en la campanita. Por eso la regla vive en UNA función —`ids_a_mi_cargo()`—
-- y los demás lugares la obedecen en vez de repetirla.
--
-- QUÉ QUEDA AFUERA, A PROPÓSITO:
--   · `clientes_sel` y `pedidos_sel` NO se tocan. El pedido es sobre ver PERSONAS. Los clientes son
--     de la distribuidora, no del encargado, y recortarlos le impediría trabajar a quien reemplaza
--     a otro por un día. Si algún día se quiere, es una decisión comercial, no de implementación.
--   · `vigilancia_equipo` tampoco. No la llama nadie desde el cliente: la usa la Edge Function
--     `alertas-equipo` con service_role (cron cada 10 min). El recorte de quién VE cada aviso lo
--     hace `alertas_sel`, que sí queda jerarquizada acá.
--   · `ultimas_posiciones` y `ultimo_punto_equipo` son SECURITY INVOKER: heredan `posiciones_sel`
--     y quedan jerarquizadas gratis. No hay que tocarlas (y por eso no se tocan).
--
-- 🔴 ESTA MIGRACIÓN TOCA `perfiles_sel`, QUE ES LA POLICY QUE DECIDE SI ALGUIEN PUEDE LEER SU
-- PROPIO PERFIL. Si queda mal, NO ENTRA NADIE A LA APP. El `id = auth.uid()` es la primera
-- condición de la policy y no se toca nunca — está antes que cualquier otra cosa a propósito.
--
-- APLICA AL INSTANTE Y SIN APK. Todo el recorte pasa en el servidor, así que rige aunque el
-- teléfono esté en una versión vieja (Zura estaba en 1.11.0 el día que se escribió esto). Lo único
-- que necesita bundle nuevo es el selector para asignar niveles, y ese corre en el panel.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El nivel
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.perfiles
  add column if not exists nivel smallint not null default 0;

alter table public.perfiles drop constraint if exists perfiles_nivel_check;
alter table public.perfiles add constraint perfiles_nivel_check check (nivel >= 0 and nivel <= 9);

comment on column public.perfiles.nivel is
  'Rango del supervisor. Cada encargado ve a los de nivel MENOR al suyo (estricto: los pares no se '
  'ven entre sí). Solo tiene efecto en el rol `encargado`: admin y superadmin siguen viendo su '
  'empresa entera por su propia rama de las policies, y a un vendedor no lo mira nadie. '
  '1 = supervisor de equipo (ve a los vendedores). 2 = supervisor general (ve también a los otros '
  'encargados). El 0 se comporta como el 1 —ver `ids_a_mi_cargo()`— para que un encargado recién '
  'creado NUNCA quede ciego por olvidarse de asignarle nivel.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La regla, en un solo lugar
-- ─────────────────────────────────────────────────────────────────────────────

-- Mi propio nivel. STABLE + SECURITY DEFINER como `mi_rol()`/`mi_empresa()`: se lee `perfiles`
-- desde adentro de las policies DE `perfiles`, así que sin definer sería recursivo.
create or replace function public.mi_nivel()
returns smallint
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce((select p.nivel from perfiles p where p.id = (select auth.uid())), 0)::smallint
$function$;

comment on function public.mi_nivel() is
  'Nivel jerárquico del usuario de la sesión (perfiles.nivel). 0 si no tiene perfil.';

-- A QUIÉN PUEDO VER. Única fuente de verdad de la jerarquía: las policies y `metricas_actividad`
-- la consultan en vez de repetir la condición.
--
-- Se usa SIEMPRE como `id_usuario in (select ids_a_mi_cargo())` —con el subselect— y no como una
-- función por fila: así Postgres la evalúa UNA VEZ por consulta (InitPlan) en lugar de una vez por
-- posición. En `posiciones`, que tiene cientos de miles de filas por día, esa diferencia es la que
-- decide si el mapa abre o se cuelga.
--
-- Contesta para TODOS los roles, no solo para el encargado. Es a propósito: una función que solo
-- fuera correcta en una rama es una trampa para el próximo que la use en otra.
create or replace function public.ids_a_mi_cargo()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id
  from perfiles p
  where p.id = (select auth.uid())          -- a uno mismo SIEMPRE
     or case (select mi_rol())
          when 'superadmin' then true
          when 'admin'      then p.id_empresa = (select mi_empresa())
          -- `greatest(nivel, 1)` es la red de contención: un encargado en nivel 0 se comporta
          -- exactamente como uno de nivel 1 (ve a los vendedores) en vez de quedarse sin ver a
          -- nadie. Sin esto, crear un encargado y olvidar el nivel lo dejaría con la pantalla
          -- vacía y sin ningún mensaje que lo explique.
          when 'encargado'  then p.id_empresa = (select mi_empresa())
                                 and coalesce(p.nivel, 0) < greatest((select mi_nivel()), 1)
          else false                        -- vendedor, repartidor, marketing: solo a sí mismos
        end
$function$;

comment on function public.ids_a_mi_cargo() is
  'Ids de perfiles que el usuario de la sesión puede ver (db/40). Usar SIEMPRE como '
  '`id_usuario in (select ids_a_mi_cargo())` para que se evalúe una vez por consulta.';

-- Grants: espejo exacto de `mi_rol()`/`mi_empresa()`, y por el mismo motivo — las policies las
-- invocan, así que sin EXECUTE la consulta falla con "permission denied" en vez de devolver vacío.
-- El `revoke from public` va aparte del de los roles: Supabase le da EXECUTE explícito a anon y
-- authenticated en cada función nueva, y revocar de PUBLIC no alcanza para sacárselo.
revoke execute on function public.mi_nivel() from public, anon, authenticated, service_role;
revoke execute on function public.ids_a_mi_cargo() from public, anon, authenticated, service_role;
grant execute on function public.mi_nivel() to anon, authenticated, service_role;
grant execute on function public.ids_a_mi_cargo() to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Las policies
--
-- En todas se separa la rama `admin` de la rama `encargado`, que hasta hoy compartían un
-- `mi_rol() = any(array['admin','encargado'])`. El admin queda EXACTAMENTE como estaba.
-- Se conserva el envoltorio `(select ...)` de las que ya lo tenían: no es cosmético, es lo que
-- hace que la función se evalúe una vez por consulta y no una por fila.
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1 · perfiles — la más delicada. `id = auth.uid()` primero y sin condiciones.
drop policy if exists perfiles_sel on public.perfiles;
create policy perfiles_sel on public.perfiles
  for select
  using (
    id = (select auth.uid())
    or (select es_superadmin())
    or ((select mi_rol()) = 'admin'
        and (id_empresa = (select mi_empresa()) or id_empresa is null))
    or ((select mi_rol()) = 'encargado'
        and (id_empresa = (select mi_empresa()) or id_empresa is null)
        -- Acá el nivel está EN LA FILA, así que no hace falta `ids_a_mi_cargo()`.
        and coalesce(nivel, 0) < greatest((select mi_nivel()), 1))
  );

-- 3.2 · posiciones — el mapa y los recorridos.
drop policy if exists posiciones_sel on public.posiciones;
create policy posiciones_sel on public.posiciones
  for select
  using (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  );

-- 3.3 · estado_dispositivo — batería, red, versión, última telemetría.
drop policy if exists estado_disp_sel on public.estado_dispositivo;
create policy estado_disp_sel on public.estado_dispositivo
  for select
  using (
    es_superadmin()
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  );

-- 3.4 · visitas — lectura Y escritura. La escritura importa tanto como la lectura: sin esto
-- Javier no vería las visitas de Zura pero podría editarlas a ciegas por id.
drop policy if exists visitas_sel on public.visitas;
create policy visitas_sel on public.visitas
  for select
  using (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  );

drop policy if exists visitas_upd on public.visitas;
create policy visitas_upd on public.visitas
  for update
  using (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  )
  with check (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  );

-- 3.5 · alertas_equipo — la campanita. Los avisos los sigue CREANDO el cron para todo el mundo
-- (`vigilancia_equipo` con service_role); lo que cambia es quién los ve.
drop policy if exists alertas_sel on public.alertas_equipo;
create policy alertas_sel on public.alertas_equipo
  for select
  using (
    (select es_superadmin())
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  );

-- 3.6 · recorridos_snap — el trazo pegado a las calles.
drop policy if exists recorridos_snap_sel on public.recorridos_snap;
create policy recorridos_snap_sel on public.recorridos_snap
  for select
  using (
    es_superadmin()
    or id_usuario = (select auth.uid())
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'admin')
    or (id_empresa = (select mi_empresa()) and (select mi_rol()) = 'encargado'
        and id_usuario in (select ids_a_mi_cargo()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. La que saltea RLS
--
-- `metricas_actividad` es SECURITY DEFINER: las policies de arriba NO la alcanzan. Es el km, los
-- puntos, los minutos en movimiento y las paradas de cada persona — o sea, exactamente lo que no
-- tiene que ver un encargado de quien no está a su cargo. Se le agrega el filtro adentro.
-- Cuerpo idéntico al vivo salvo las dos líneas marcadas.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.metricas_actividad(p_desde date, p_hasta date)
returns table(dia date, id_usuario uuid, km numeric, puntos integer,
              primer_ts timestamp with time zone, ultimo_ts timestamp with time zone,
              minutos_movimiento integer, paradas integer)
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
      -- Solo el carril de CONFIANZA (db/33). Espeja ACCURACY_MAX_M de gpsConfig.js.
      and (p.accuracy is null or p.accuracy <= 30)
      -- 🔴 db/40 — JERARQUÍA. Esta función saltea RLS, así que el recorte va acá o no va.
      and (v_rol <> 'encargado' or p.id_usuario in (select ids_a_mi_cargo()))
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
           coalesce(sum(metros) filter (where metros >= 9), 0) / 1000.0 as km_dia,
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Los niveles de hoy
--
-- Todos arrancan en 0, que se comporta como 1 (ver `ids_a_mi_cargo()`): los encargados siguen
-- viendo a los vendedores, y dejan de verse entre ellos. Lo único que hay que declarar es quién
-- está POR ENCIMA.
-- ─────────────────────────────────────────────────────────────────────────────
update public.perfiles set nivel = 2
where rol = 'encargado' and nombre in ('Zura', 'Santiago Adet 2');
