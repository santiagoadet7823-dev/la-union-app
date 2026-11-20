-- =============================================================================
--  Demo del ARM: una 5.ª conversación cuyo contacto entra con el TELÉFONO DE UN CLIENTE REAL
--  (plan 51, 20/11/2026, para la reunión con La Unión).
--
--  Muestra en vivo lo de db/108: el trigger `crm_contactos_vinculo` lo vincula solo ("Vinculado
--  automáticamente por teléfono") y la pestaña Pedidos trae los pedidos REALES de ese cliente en
--  solo lectura (las conversaciones `demo` nunca editan, anulan ni crean pedidos reales).
--  Se elige el cliente con teléfono válido y único que más pedidos tuvo en los últimos 30 días.
--  El contacto lleva "(demo)" en el nombre para reconocerlo y borrarlo.
--
--  Borrar: db/crm_demo/limpiar.sql (borra las conversaciones demo) + la línea de abajo, o
--  `limpiar_vinculada.sql`. 🔴 Borrarla ANTES de conectar el número de ventas real.
-- =============================================================================
begin;
do $$
declare
  emp  constant uuid := '645aa685-2949-484c-bfe8-9eca57abc8b1';
  v_cli uuid; v_nom text; v_wa text;
  k uuid; c uuid;
  ahora timestamptz := now();
begin
  if exists (select 1 from public.crm_contactos where id_empresa = emp and nombre_perfil like '% (demo)') then
    raise notice 'Ya está cargada: no se toca nada.';
    return;
  end if;

  select cl.id, cl.nombre_comercio, public.crm_wa_de_telefono(cl.telefono) into v_cli, v_nom, v_wa
    from public.clientes cl
   where cl.id_empresa = emp and cl.archivado_ts is null
     and public.crm_cliente_por_wa(emp, public.crm_wa_de_telefono(cl.telefono)) = cl.id
     and not exists (select 1 from public.crm_contactos k2 where k2.id_empresa = emp and k2.wa_id = public.crm_wa_de_telefono(cl.telefono))
   order by (select count(*) from public.pedidos p where p.id_cliente = cl.id and p.created_at > now() - interval '30 days' and p.estado <> 'Anulado') desc,
            cl.nombre_comercio
   limit 1;
  if v_cli is null then raise exception 'No hay cliente con teléfono válido'; end if;

  -- Sin id_cliente: lo pone el trigger por el teléfono (vinculo_origen = 'auto').
  insert into public.crm_contactos (id_empresa, wa_id, nombre_perfil, opt_in_ts)
    values (emp, v_wa, v_nom || ' (demo)', ahora) returning id into k;

  insert into public.crm_conversaciones (id_empresa, id_contacto, estado, motivo_derivacion, demo, created_at)
    values (emp, k, 'esperando_persona', 'Pide precios', true, ahora - interval '20 min') returning id into c;
  insert into public.crm_mensajes (id_empresa, id_conversacion, direccion, autor, tipo, texto, created_at) values
    (emp, c, 'entra', 'cliente', 'texto', 'Hola! Buen día', ahora - interval '8 min'),
    (emp, c, 'entra', 'cliente', 'texto', '¿Me pasás el precio de la yerba Amanda? Y si tienen aceite de 1,5', ahora - interval '6 min');
  update public.crm_conversaciones set ultima_entrante_ts = ahora - interval '6 min' where id = c;

  raise notice 'Demo vinculada: % (%), contacto %, conversación %', v_nom, v_wa, k, c;
end $$;
select k.nombre_perfil, k.id_cliente is not null as vinculado, k.vinculo_origen
  from public.crm_contactos k where k.nombre_perfil like '% (demo)';
commit;
