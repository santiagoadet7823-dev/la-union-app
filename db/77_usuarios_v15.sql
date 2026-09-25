-- 77_usuarios_v15.sql — Menú Usuarios v1.5: guarda de escalada, guardado en lote, eliminar y purgar.
-- 24/09/2026. Aplicada en la base viva vía MCP.
--
-- 🩸 POR QUÉ EXISTE. El rediseño de Usuarios (brief v1.5, entrega del diseñador del 24/09) pide
-- tres cosas que la base no tenía:
--
-- 1) UN SOLO ACTO DE GUARDADO con resultado PARCIAL ("3 de 4 guardados; no se pudo cambiar el rol
--    de Lucía: sin permiso"). Hasta 1.41.0 cada fila guardaba por su cuenta, el color de trazo, el
--    perfil GPS y desactivar escribían al instante, y la tabla puente de horarios se sincronizaba
--    SIN mirar el error. Va `guardar_usuarios_lote`, que aplica cada campo en su propio
--    subbloque y devuelve qué salió y qué no. Es SECURITY INVOKER a propósito: la RLS de
--    `perfiles` y la guarda de abajo siguen siendo las que deciden, no una copia de la matriz de
--    permisos escrita en esta función.
--
-- 2) 🔴 UN HUECO DE ESCALADA QUE ESTABA ABIERTO. Medido en la base viva antes de esta migración:
--    `perfiles_upd` es `es_superadmin() OR (mi_rol()='admin' AND id_empresa = mi_empresa())` en el
--    USING y lo mismo en el WITH CHECK, **sin mirar el rol de la fila**. O sea que cualquier admin
--    podía hacer `update perfiles set rol='superadmin' where id = auth.uid()` desde la consola del
--    navegador y quedar con acceso a todas las empresas. Y también degradar o desactivar al
--    superadmin si compartía empresa con él. La UI nunca lo ofreció, pero la UI no es la guarda.
--    Una policy no puede comparar OLD con NEW, así que va un trigger BEFORE UPDATE
--    (`perfiles_guarda_cambios`) que aplica la matriz §3 del brief a las columnas sensibles:
--      - superadmin: todo, salvo desactivarse/cambiarse el rol a sí mismo y dejar al sistema sin
--        superadmin activo;
--      - admin: su empresa, nunca una fila superadmin ni el rol superadmin como destino, ni color de
--        trazo, ni perfil GPS, ni mover de empresa (salvo adoptar un pendiente sin empresa);
--      - cualquier otro: ninguna columna sensible (las RPC de "Mi cuenta" sólo tocan nombre,
--        teléfono y foto, que no están en la lista).
--    Con `auth.uid()` nulo (service role: `crear-usuario`, `eliminar-usuario`, crons) no se aplica.
--
-- 3) ELIMINAR y PURGAR. Borrar un perfil choca con 9 FK en NO ACTION (medidas en la base viva el
--    24/09: pedidos ×3, posiciones, visitas, rutas, pedido_ediciones, metas, exportaciones_pedidos,
--    ubicaciones_compartidas.creado_por). Se decidió con el dueño:
--      - Eliminar: la cuenta desaparece; pedidos, recorridos y visitas quedan a nombre de un perfil
--        "Usuario eliminado", uno por empresa, para que los reportes pasados no cambien.
--      - Purgar: lo mismo, y además se borran recorridos GPS y visitas. Los pedidos NUNCA.
--    El marcador es un perfil real (perfiles.id tiene FK a auth.users, no puede ser una fila
--    suelta) con `sistema = true`, `rol = null` y `activo = false`: con eso ya queda fuera del
--    plantel, de `usePerfilesEquipo` y de los avisos, que filtran por rol y activo. Lo crea la Edge
--    Function `eliminar-usuario` la primera vez que hace falta en cada empresa.
--    `_eliminar_usuario` hace TODO en una transacción, incluido el `delete from auth.users`: si
--    algo falla a mitad de camino, no queda un usuario vivo con su historia ya movida.
--
-- ⚠️ CLAUDE.md §8 ya contaba el precedente: el 12/08 limpiar 10 perfiles duplicados costó 23.945
-- posiciones, irreversible. Por eso Eliminar REASIGNA y sólo Purgar borra, y Purgar pide doble
-- confirmación en la UI.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Marca de perfil de sistema
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.perfiles add column if not exists sistema boolean not null default false;
comment on column public.perfiles.sistema is
  'Perfil técnico "Usuario eliminado" (uno por empresa) que hereda pedidos, recorridos y visitas de las cuentas eliminadas. No es una persona: no se lista en Usuarios ni en Empresas.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Guarda de columnas sensibles de perfiles
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.perfiles_guarda_cambios()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_rol   text;
  v_emp   uuid;
  v_sensible boolean;
begin
  -- Service role (crear-usuario, eliminar-usuario, crons): no hay persona a quien limitar.
  if v_uid is null then return new; end if;

  v_sensible :=
       new.rol                  is distinct from old.rol
    or new.activo               is distinct from old.activo
    or new.id_empresa           is distinct from old.id_empresa
    or new.nivel                is distinct from old.nivel
    or new.numero               is distinct from old.numero
    or new.codigo_erp           is distinct from old.codigo_erp
    or new.permisos             is distinct from old.permisos
    or new.id_categoria_rastreo is distinct from old.id_categoria_rastreo
    or new.color_trazo          is distinct from old.color_trazo
    or new.gps_perfil           is distinct from old.gps_perfil
    or new.sistema              is distinct from old.sistema;
  if not v_sensible then return new; end if;

  -- El marcador "Usuario eliminado" no se edita desde la app.
  if old.sistema or new.sistema then
    raise exception 'perfil-de-sistema';
  end if;

  select rol, id_empresa into v_rol, v_emp from public.perfiles where id = v_uid;

  -- La propia cuenta: ni desactivarse ni cambiarse el rol (brief v1.5 §6 P5).
  if old.id = v_uid and (new.activo is distinct from old.activo or new.rol is distinct from old.rol) then
    raise exception 'propia-cuenta';
  end if;

  if v_rol = 'superadmin' then
    null;
  elsif v_rol = 'admin' then
    if old.rol = 'superadmin' or new.rol = 'superadmin' then
      raise exception 'sin-permiso-superadmin';
    end if;
    if new.color_trazo is distinct from old.color_trazo or new.gps_perfil is distinct from old.gps_perfil then
      raise exception 'solo-superadmin';
    end if;
    -- Mover de empresa es del superadmin. La única excepción es adoptar un pendiente que entró con
    -- Google y todavía no tiene empresa (la RLS ya exige que el destino sea la del admin).
    if new.id_empresa is distinct from old.id_empresa
       and not (old.id_empresa is null and new.id_empresa = v_emp) then
      raise exception 'solo-superadmin';
    end if;
  else
    raise exception 'sin-permiso';
  end if;

  -- Nunca dejar el sistema sin un superadmin activo.
  if old.rol = 'superadmin' and old.activo
     and (new.rol is distinct from 'superadmin' or not new.activo)
     and not exists (select 1 from public.perfiles p
                      where p.rol = 'superadmin' and p.activo and p.id <> old.id) then
    raise exception 'ultimo-superadmin';
  end if;

  return new;
end;
$$;

revoke execute on function public.perfiles_guarda_cambios() from public;
revoke execute on function public.perfiles_guarda_cambios() from anon;
revoke execute on function public.perfiles_guarda_cambios() from authenticated;

drop trigger if exists perfiles_guarda_cambios on public.perfiles;
create trigger perfiles_guarda_cambios
  before update on public.perfiles
  for each row execute function public.perfiles_guarda_cambios();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Guardado en lote con resultado por campo
-- ─────────────────────────────────────────────────────────────────────────────
-- p_cambios: [{ "id": uuid, "campos": { "id_empresa", "rol", "nivel", "numero", "permisos",
--               "categorias", "color_trazo", "gps_perfil", "activo" } }]
-- Devuelve:  [{ "id", "campo", "ok", "error" }]
--
-- El ORDEN de los campos importa: `id_empresa` va primero porque aprobar un pendiente sin empresa
-- exige ponerle empresa antes que nada (el WITH CHECK del admin pide `id_empresa = mi_empresa()`),
-- y `activo` va último para que un alta aprobada no quede activa con el rol a medio escribir.
create or replace function public.guardar_usuarios_lote(p_cambios jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item   jsonb;
  v_id     uuid;
  v_campos jsonb;
  v_campo  text;
  v_n      integer;
  v_cats   uuid[];
  v_fallo  boolean;
  v_out    jsonb := '[]'::jsonb;
  v_orden  text[] := array['id_empresa','rol','nivel','numero','permisos','categorias','color_trazo','gps_perfil','activo'];
begin
  if auth.uid() is null then raise exception 'no-auth'; end if;
  if jsonb_typeof(p_cambios) is distinct from 'array' then raise exception 'payload-invalido'; end if;

  for v_item in select * from jsonb_array_elements(p_cambios) loop
    v_id := (v_item->>'id')::uuid;
    v_campos := coalesce(v_item->'campos', '{}'::jsonb);
    v_fallo := false;

    foreach v_campo in array v_orden loop
      continue when not (v_campos ? v_campo);
      begin
        if v_campo = 'id_empresa' then
          update public.perfiles set id_empresa = (v_campos->>'id_empresa')::uuid where id = v_id;
        elsif v_campo = 'rol' then
          -- Un rol que no es encargado no tiene nivel: se limpia en el mismo UPDATE.
          update public.perfiles
             set rol = nullif(v_campos->>'rol', ''),
                 nivel = case when v_campos->>'rol' = 'encargado' then nivel else 0 end
           where id = v_id;
        elsif v_campo = 'nivel' then
          update public.perfiles set nivel = coalesce((v_campos->>'nivel')::smallint, 0) where id = v_id;
        elsif v_campo = 'numero' then
          update public.perfiles set numero = nullif(v_campos->>'numero', '')::integer where id = v_id;
        elsif v_campo = 'permisos' then
          update public.perfiles
             set permisos = coalesce(array(select jsonb_array_elements_text(v_campos->'permisos')), '{}'::text[])
           where id = v_id;
        elsif v_campo = 'color_trazo' then
          update public.perfiles set color_trazo = nullif(v_campos->>'color_trazo', '') where id = v_id;
        elsif v_campo = 'gps_perfil' then
          update public.perfiles
             set gps_perfil = case when jsonb_typeof(v_campos->'gps_perfil') = 'object' then v_campos->'gps_perfil' end
           where id = v_id;
        elsif v_campo = 'activo' then
          -- Activar a alguien cuyo rol o empresa acaba de fallar lo dejaría adentro a medio
          -- configurar (un pendiente aprobado sin rol). Se frena y queda en el borrador con el resto.
          if v_fallo and (v_campos->>'activo')::boolean then raise exception 'depende-de-otro-cambio'; end if;
          update public.perfiles set activo = (v_campos->>'activo')::boolean where id = v_id;
        elsif v_campo = 'categorias' then
          v_cats := coalesce(array(select (jsonb_array_elements_text(v_campos->'categorias'))::uuid), '{}'::uuid[]);
          -- `id_categoria_rastreo` es la columna vieja (una sola categoría); la app todavía la lee
          -- como respaldo, así que se espeja con la primera. Va ANTES de la tabla puente para que
          -- la RLS rechace acá, con el mismo mensaje que el resto, a quien no puede tocar la fila.
          update public.perfiles set id_categoria_rastreo = v_cats[1] where id = v_id;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'sin-permiso'; end if;
          delete from public.perfiles_categorias_rastreo
           where id_usuario = v_id and not (id_categoria = any (v_cats));
          insert into public.perfiles_categorias_rastreo (id_usuario, id_categoria)
            select v_id, c from unnest(v_cats) c
            on conflict do nothing;
        end if;

        if v_campo <> 'categorias' then
          -- 0 filas = la RLS la filtró sin error (otra empresa, otro alcance). No es un éxito.
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'sin-permiso'; end if;
        end if;

        v_out := v_out || jsonb_build_object('id', v_id, 'campo', v_campo, 'ok', true);
      exception when others then
        v_fallo := true;
        v_out := v_out || jsonb_build_object('id', v_id, 'campo', v_campo, 'ok', false, 'error', sqlerrm);
      end;
    end loop;
  end loop;

  return v_out;
end;
$$;

revoke execute on function public.guardar_usuarios_lote(jsonb) from public;
revoke execute on function public.guardar_usuarios_lote(jsonb) from anon;
grant execute on function public.guardar_usuarios_lote(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Eliminar / purgar (sólo service role, desde la Edge Function eliminar-usuario)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public._eliminar_usuario(p_id uuid, p_purgar boolean, p_marcador uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
-- Un vendedor con meses de rastreo tiene 150-180k posiciones (medido el 24/09): reasignarlas no
-- entra en el statement_timeout por defecto de la API.
set statement_timeout = '300s'
as $$
declare
  v_p   public.perfiles;
  v_m   public.perfiles;
  v_pos bigint := 0;
  v_vis bigint := 0;
  v_ped bigint := 0;
  v_zon bigint := 0;
  v_n   bigint;
begin
  select * into v_p from public.perfiles where id = p_id;
  if v_p.id is null then raise exception 'no-existe'; end if;
  if v_p.sistema then raise exception 'perfil-de-sistema'; end if;

  select * into v_m from public.perfiles where id = p_marcador;
  if v_m.id is null or not v_m.sistema then raise exception 'marcador-invalido'; end if;
  if v_m.id_empresa is distinct from v_p.id_empresa then raise exception 'marcador-de-otra-empresa'; end if;

  if v_p.rol = 'superadmin' and not exists (
       select 1 from public.perfiles where rol = 'superadmin' and activo and id <> p_id) then
    raise exception 'ultimo-superadmin';
  end if;

  -- Los pedidos ya enviados a facturación están congelados (`pedido_exportado_congelado`, db/62),
  -- id_vendedor incluido. Cambiar a quién figura NO altera la venta: se abre el bypass sólo en esta
  -- transacción.
  perform set_config('distat.export_bypass', 'on', true);

  update public.pedidos set id_vendedor   = p_marcador where id_vendedor   = p_id; get diagnostics v_n = row_count; v_ped := v_ped + v_n;
  update public.pedidos set id_repartidor = p_marcador where id_repartidor = p_id; get diagnostics v_n = row_count; v_ped := v_ped + v_n;
  update public.pedidos set anulado_por   = p_marcador where anulado_por   = p_id;
  update public.pedido_ediciones        set id_usuario = p_marcador where id_usuario = p_id;
  update public.exportaciones_pedidos   set id_usuario = p_marcador where id_usuario = p_id;
  update public.rutas                   set id_usuario = p_marcador where id_usuario = p_id;
  update public.ubicaciones_compartidas set creado_por = p_marcador where creado_por = p_id;

  if p_purgar then
    -- Los pedidos se conservan siempre; sólo pierden el enlace a la visita que se borra.
    update public.pedidos set id_visita = null
     where id_visita in (select id from public.visitas where id_usuario = p_id);
    delete from public.visitas    where id_usuario = p_id; get diagnostics v_vis = row_count;
    delete from public.posiciones where id_usuario = p_id; get diagnostics v_pos = row_count;
  else
    update public.visitas    set id_usuario = p_marcador where id_usuario = p_id; get diagnostics v_vis = row_count;
    update public.posiciones set id_usuario = p_marcador where id_usuario = p_id; get diagnostics v_pos = row_count;
  end if;

  -- Sin FK: quedarían huérfanas (CLAUDE.md §8). `recorridos_snap` es caché regenerable y lleva
  -- unique (id_usuario, fecha), así que no se puede reasignar sin chocar con otro eliminado.
  delete from public.recorridos_snap    where id_usuario = p_id;
  delete from public.estado_dispositivo where id_usuario = p_id;
  delete from public.metas              where id_usuario = p_id;

  -- La zona queda sin dueño (aviso "zona sin vendedor"). El trigger de db/75 no hace nada con un
  -- dueño nulo, y `clientes.id_vendedor` se pone en NULL solo por su FK SET NULL al borrar el perfil.
  update public.zonas set id_vendedor = null where id_vendedor = p_id; get diagnostics v_zon = row_count;

  -- Cascada: perfiles → alertas, horarios, coberturas, tramos, tokens de ingesta.
  delete from auth.users where id = p_id;

  return jsonb_build_object('pedidos', v_ped, 'visitas', v_vis, 'posiciones', v_pos, 'zonas', v_zon, 'purgado', p_purgar);
end;
$$;

revoke execute on function public._eliminar_usuario(uuid, boolean, uuid) from public;
revoke execute on function public._eliminar_usuario(uuid, boolean, uuid) from anon;
revoke execute on function public._eliminar_usuario(uuid, boolean, uuid) from authenticated;
grant execute on function public._eliminar_usuario(uuid, boolean, uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN
--   select proname, proacl from pg_proc
--    where proname in ('guardar_usuarios_lote','_eliminar_usuario','perfiles_guarda_cambios');
--   -- _eliminar_usuario y la guarda: sin anon ni authenticated.
--
--   -- Como un admin (la escalada tiene que fallar con 'sin-permiso-superadmin'):
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<id admin>","role":"authenticated"}', true);
--   select public.guardar_usuarios_lote('[{"id":"<id admin>","campos":{"rol":"superadmin"}}]');
--   rollback;
-- ─────────────────────────────────────────────────────────────────────────────
