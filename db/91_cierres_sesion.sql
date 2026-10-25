-- 91_cierres_sesion.sql — cada cierre de sesión que hace la APP queda anotado con su motivo (25/10/2026, plan 23).
--
-- 🩸 POR QUÉ. El 24/10 `launionvendedor3` (SM-A075M, 1.44.8) entró con Google y salió 26 veces en una
-- tarde, a veces con 11 s entre una cosa y la otra. El servidor tiene cada `POST /logout` (204) pero
-- no POR QUÉ: la app cierra la sesión desde siete lugares (el menú, "Volver al ingreso", las dos
-- pantallas de 2FA, la política, el rechazo de "sesión de otra cuenta") y todos terminan en el mismo
-- `signOut({ scope: 'local' })`. Sin el motivo no hay forma de saber si la persona tocó un botón o si
-- la app la echó.
--
-- Va a `auditoria_seguridad` (db/80), que no tiene policies: la app escribe sólo por esta función, que
-- fija quién es (`auth.uid()`) y recorta lo que llega. Tope de 60 por hora y cuenta: una app en un
-- ciclo no puede llenar la tabla.
--
-- Devuelve si anotó: la app guarda el motivo en el teléfono y lo borra sólo con `true`. Sin sesión
-- (`false`) lo vuelve a mandar con el próximo login. Pasado el tope también devuelve `true`: no tiene
-- sentido que el teléfono acumule lo que la base ya decidió no guardar.

drop function if exists public.registrar_cierre_sesion(text, jsonb);
create function public.registrar_cierre_sesion(p_motivo text, p_detalle jsonb default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if (select count(*) from auditoria_seguridad
       where id_usuario = v_uid and accion like 'cierre_sesion%'
         and creado_ts > now() - interval '1 hour') >= 60 then
    return true;
  end if;
  insert into auditoria_seguridad (id_usuario, id_actor, accion, detalle)
  values (v_uid, v_uid, 'cierre_sesion:' || left(coalesce(p_motivo, 'sin-motivo'), 40),
          case when p_detalle is null then null
               when length(p_detalle::text) > 2000 then jsonb_build_object('recortado', true)
               else p_detalle end);
  return true;
end;
$$;

revoke all on function public.registrar_cierre_sesion(text, jsonb) from public, anon;
grant execute on function public.registrar_cierre_sesion(text, jsonb) to authenticated;

create index if not exists auditoria_seguridad_usuario_ts_idx
  on public.auditoria_seguridad (id_usuario, creado_ts desc);

notify pgrst, 'reload schema';

-- Lectura (desde el panel o psql):
--   select a.creado_ts at time zone 'America/Argentina/Buenos_Aires' as hora, u.email, a.accion, a.detalle
--     from auditoria_seguridad a join auth.users u on u.id = a.id_usuario
--    where a.accion like 'cierre_sesion%' order by a.creado_ts desc limit 50;
