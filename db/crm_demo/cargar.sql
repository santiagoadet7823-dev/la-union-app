-- Conversaciones de DEMOSTRACIÓN del CRM (plan 41, pasos 4 y 6). NO es una migración.
--
-- Todo va con `demo = true`: `crm-enviar` / `crm-ticket` no hablan con Meta, no cuentan para el tope
-- y confirmar no crea un pedido real (queda "DEMO-…"). Contactos con teléfonos ficticios 549387000000x.
-- Empresa: LA UNIÓN (catálogo y precios reales). Se borra con `limpiar.sql`.
-- Idempotente: si ya hay demo cargada, no hace nada.
begin;
do $$
declare
  emp  constant uuid := '645aa685-2949-484c-bfe8-9eca57abc8b1';
  sa   uuid := (select id from public.perfiles where rol = 'superadmin' and activo order by created_at limit 1);
  sa_n text := (select nombre from public.perfiles where id = (select id from public.perfiles where rol = 'superadmin' and activo order by created_at limit 1));
  k1 uuid; k2 uuid; k3 uuid; k4 uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  ahora timestamptz := now();
begin
  if exists (select 1 from public.crm_conversaciones where demo and id_empresa = emp) then
    raise notice 'Ya hay demo cargada: no se toca nada.';
    return;
  end if;

  insert into public.crm_contactos (id_empresa, wa_id, nombre_perfil, opt_in_ts) values
    (emp, '5493870000001', 'Kiosco Don Pedro', ahora) returning id into k1;
  insert into public.crm_contactos (id_empresa, wa_id, nombre_perfil, opt_in_ts) values
    (emp, '5493870000002', 'Almacén La Esquina', ahora) returning id into k2;
  insert into public.crm_contactos (id_empresa, wa_id, nombre_perfil, opt_in_ts) values
    (emp, '5493870000003', 'Despensa Mary', ahora) returning id into k3;
  insert into public.crm_contactos (id_empresa, wa_id, nombre_perfil, opt_in_ts) values
    (emp, '5493870000004', 'Maxikiosco 24', ahora) returning id into k4;

  -- 1. El bot armó un pedido completo y espera la confirmación del cliente.
  insert into public.crm_conversaciones (id_empresa, id_contacto, estado, demo, created_at)
    values (emp, k1, 'bot', true, ahora - interval '40 min') returning id into c1;
  insert into public.crm_mensajes (id_empresa, id_conversacion, direccion, autor, tipo, texto, estado_envio, created_at) values
    (emp, c1, 'entra', 'cliente', 'texto', 'Hola! Quiero hacer un pedido', null, ahora - interval '40 min'),
    (emp, c1, 'sale', 'bot', 'texto', '¡Hola! Soy el asistente de pedidos de La Unión. Decime qué necesitás y te armo el pedido.', 'leido', ahora - interval '39 min'),
    (emp, c1, 'entra', 'cliente', 'audio', null, null, ahora - interval '37 min'),
    (emp, c1, 'sale', 'bot', 'ticket', E'🧾 *Tu pedido*\n• 6 × YERBA AMANDA 1KG UN — $ 20.791,98\n• 12 × YERBA AMANDA 250G UN — $ 12.600,96\n• 10 × YERBA DON ARREGUI 500G BURRITO UN — $ 16.500,00\n\n*Total: $ 49.892,94*\n\nRespondé *SÍ* para confirmarlo o decinos qué querés cambiar.', 'entregado', ahora - interval '36 min');
  update public.crm_mensajes set transcripcion = 'Mandame seis yerba amanda de un kilo, doce de las de 250 y diez don arregui burrito'
   where id_conversacion = c1 and tipo = 'audio';
  insert into public.crm_tickets (id_empresa, id_conversacion, items, total, creado_por_bot, enviado_ts, created_at) values
    (emp, c1, '[
      {"id_producto":"1f051ffa-63e1-49db-9abe-da14180c5eaf","codigo":"1663","descripcion":"YERBA AMANDA 1KG UN","cantidad":6,"precio_unitario":3465.33,"subtotal":20791.98,"peso_kg":0,"motivo":"lista"},
      {"id_producto":"7582df95-b5fd-4b7c-ab02-f073a316f79a","codigo":"0477","descripcion":"YERBA AMANDA 250G UN","cantidad":12,"precio_unitario":1050.08,"subtotal":12600.96,"peso_kg":0,"motivo":"lista"},
      {"id_producto":"b2b72c1a-17b2-4f64-b437-e165f9a13cca","codigo":"0215","descripcion":"YERBA DON ARREGUI 500G BURRITO UN","cantidad":10,"precio_unitario":1650,"subtotal":16500,"peso_kg":0,"motivo":"lista"}
    ]'::jsonb, 49892.94, true, ahora - interval '36 min', ahora - interval '36 min');

  -- 2. Derivada a una persona.
  insert into public.crm_conversaciones (id_empresa, id_contacto, estado, motivo_derivacion, demo, created_at)
    values (emp, k2, 'esperando_persona', 'Pide hablar con una persona', true, ahora - interval '12 min') returning id into c2;
  insert into public.crm_mensajes (id_empresa, id_conversacion, direccion, autor, tipo, texto, estado_envio, created_at) values
    (emp, c2, 'entra', 'cliente', 'texto', 'Buenas, el pedido de ayer me llegó con un faltante', null, ahora - interval '12 min'),
    (emp, c2, 'sale', 'bot', 'texto', 'Uy, perdón. Te paso con una persona del equipo para que lo revise.', 'leido', ahora - interval '11 min'),
    (emp, c2, 'interno', 'sistema', 'sistema', 'El bot pasó la conversación a una persona: pide hablar con una persona', null, ahora - interval '11 min'),
    (emp, c2, 'entra', 'cliente', 'texto', 'Faltaron 2 aceites. Me lo pueden mandar con el próximo?', null, ahora - interval '3 min');

  -- 3. Tomada por una persona (cartel "Controlado por").
  insert into public.crm_conversaciones (id_empresa, id_contacto, estado, asignada_a, asignada_nombre, tomada_ts, ultima_actividad_ts, demo, created_at)
    values (emp, k3, 'humano', sa, sa_n, ahora - interval '25 min', ahora - interval '20 min', true, ahora - interval '30 min') returning id into c3;
  insert into public.crm_mensajes (id_empresa, id_conversacion, direccion, autor, id_perfil, autor_nombre, tipo, texto, estado_envio, nota_interna, created_at) values
    (emp, c3, 'entra', 'cliente', null, null, 'texto', '¿Tienen la yerba Amanda especial?', null, false, ahora - interval '30 min'),
    (emp, c3, 'sale', 'bot', null, null, 'texto', 'Sí: YERBA AMANDA ESPECIAL 1K a $ 3.850,00. ¿Cuántas te mando?', 'leido', false, ahora - interval '29 min'),
    (emp, c3, 'entra', 'cliente', null, null, 'texto', 'Si llevo 20 me hacen precio?', null, false, ahora - interval '27 min'),
    (emp, c3, 'interno', 'sistema', null, null, 'sistema', sa_n || ' tomó el control', null, false, ahora - interval '25 min'),
    (emp, c3, 'sale', 'persona', sa, sa_n, 'texto', 'Hola! Te consulto con el encargado y te confirmo en un rato.', 'leido', false, ahora - interval '24 min'),
    (emp, c3, 'interno', 'persona', sa, sa_n, 'texto', 'Preguntarle a Javier si hay escala para 20 unidades.', null, true, ahora - interval '20 min');

  -- 4. Cerrada con el pedido confirmado (simulado: no crea un pedido real).
  insert into public.crm_conversaciones (id_empresa, id_contacto, estado, demo, created_at)
    values (emp, k4, 'cerrada', true, ahora - interval '1 day') returning id into c4;
  insert into public.crm_mensajes (id_empresa, id_conversacion, direccion, autor, id_perfil, autor_nombre, tipo, texto, estado_envio, created_at) values
    (emp, c4, 'entra', 'cliente', null, null, 'texto', 'Mandame 5 yerba la posesiva de 1 kilo', null, ahora - interval '1 day'),
    (emp, c4, 'interno', 'sistema', null, null, 'sistema', sa_n || ' confirmó el pedido N° DEMO-000001 ($ 12.000,00) para Maxikiosco 24', null, ahora - interval '23 hours'),
    (emp, c4, 'sale', 'persona', sa, sa_n, 'texto', '✅ ¡Listo! Tu pedido N° DEMO-000001 quedó confirmado por $ 12.000,00. Gracias.', 'leido', ahora - interval '23 hours');
  insert into public.crm_tickets (id_empresa, id_conversacion, items, total, estado, creado_por, editado_por, editado_nombre, numero_pedido, confirmado_ts, version, created_at) values
    (emp, c4, '[{"id_producto":"5f9cefb6-4155-4c78-b2ff-04851111e7ed","codigo":"2282","descripcion":"YERBA LA POSESIVA ARREGUI 1KG","cantidad":5,"precio_unitario":2400,"subtotal":12000,"peso_kg":0,"motivo":"lista"}]'::jsonb,
     12000, 'confirmado', sa, sa, sa_n, 'DEMO-000001', ahora - interval '23 hours', 3, ahora - interval '1 day');

  raise notice 'Demo cargada: 4 conversaciones.';
end $$;
select count(*) as conversaciones_demo from public.crm_conversaciones where demo;
commit;
