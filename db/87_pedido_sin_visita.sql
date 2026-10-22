-- db/87 — Pedidos que no se pierden: visita faltante, alta en un paso y rescate (22/10/2026, plan 19).
--
-- 🩸 CONTEXTO (prueba en calle de La Unión, 13–22/10/2026). La cola de escrituras del teléfono
-- (`writeQueue.js`) leía/modificaba/escribía sin candado, y dos operaciones cruzadas se pisaban: la
-- que escribía última borraba lo que la otra había agregado. Lo que más se perdía era el ALTA DE LA
-- VISITA (se encola en el check-in, casi a la vez que el `updateCliente` del comercio sin dueño).
-- Medido en el log del túnel: 39 visitas que los teléfonos intentaron cerrar y que la base nunca
-- recibió (1, 5, 8 y 24 por día, creciendo con el uso). Cada pedido de esas visitas chocaba con la
-- FK `pedidos.id_visita → visitas` → 409 (23503) → la cola lo apartaba a CUARENTENA en el teléfono,
-- sin avisar al vendedor. 27 pedidos así en 4 días. El vendedor los contaba como hechos; el panel y
-- el ERP no los tenían.
--
-- Esta migración tiene tres piezas:
--
-- 1. `asegurar_visita_pedido` (trigger BEFORE INSERT en `pedidos`): si la visita que el pedido
--    referencia no existe, la crea con los datos del pedido. Es el FRENO INMEDIATO: con la app
--    1.44.2 que está en la calle, los pedidos de visitas perdidas pasan a entrar sin actualizar
--    ningún teléfono. La visita es un dato secundario (check-in/out); el pedido es la venta.
--
-- 2. `registrar_pedido(p_pedido, p_items)`: alta del pedido EN UN PASO (cabecera + renglones en una
--    transacción) que devuelve el número. La usa la 1.44.3 para mostrar en el ticket el número que
--    confirmó el servidor (decisión del usuario, 22/10: nunca un número que el servidor no dio).
--    Idempotente por `id`: un reintento devuelve el MISMO número y no consume otro (el upsert con
--    `ignoreDuplicates` sí lo consumía: el trigger BEFORE INSERT corre antes que el ON CONFLICT).
--
-- 3. `rescate_cola`: los teléfonos suben una copia de su cuarentena y de su jornada, para poder ver
--    desde el servidor TODO lo que quedó aislado, incluso lo que no se pueda reenviar solo.
--
-- Volver atrás:
--   drop trigger if exists pedidos_asegurar_visita on public.pedidos;
--   drop function if exists public.asegurar_visita_pedido();
--   drop function if exists public.registrar_pedido(jsonb, jsonb);
--   drop table if exists public.rescate_cola;     -- ⚠️ solo después de haber mirado lo que trajo

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. La visita que falta se crea con los datos del pedido
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.asegurar_visita_pedido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id_visita is null then return new; end if;
  if exists (select 1 from public.visitas v where v.id = new.id_visita) then return new; end if;

  -- Sin cliente o sin vendedor no se puede armar una visita válida (las dos columnas son NOT NULL
  -- en `visitas`): se suelta la referencia y el pedido entra igual.
  if new.id_cliente is null or new.id_vendedor is null then
    new.id_visita := null;
    return new;
  end if;

  -- SECURITY DEFINER porque la policy `visitas_ins` exige `id_usuario = auth.uid()`, y un admin que
  -- carga un pedido a nombre de un vendedor no la cumpliría. No abre nada nuevo: el pedido ya pasó
  -- (o va a pasar) `pedidos_ins`, que es quien decide si este usuario puede vender a ese nombre.
  -- `check_out_ts` = hora del pedido: si el PATCH de cierre ya llegó antes (y no tocó ninguna fila),
  -- la visita queda cerrada igual; si llega después, la pisa con la hora real.
  insert into public.visitas (id, id_empresa, id_usuario, id_cliente, check_in_ts, check_out_ts,
                              lat, lng, accuracy, estado, monto)
  values (new.id_visita, new.id_empresa, new.id_vendedor, new.id_cliente,
          coalesce(new.created_at, now()), coalesce(new.created_at, now()),
          new.lat, new.lng, new.accuracy, 'visitado', new.monto_total)
  on conflict (id) do nothing;

  return new;
end
$$;

drop trigger if exists pedidos_asegurar_visita on public.pedidos;
create trigger pedidos_asegurar_visita
  before insert on public.pedidos
  for each row execute function public.asegurar_visita_pedido();

revoke execute on function public.asegurar_visita_pedido() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Alta del pedido en un paso, con número
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER: corre con la RLS del que llama (`pedidos_ins`, `items_ins`), igual que el
-- upsert que reemplaza. Si algo falla, no queda nada (ni cabecera sola ni renglones sueltos).
create or replace function public.registrar_pedido(p_pedido jsonb, p_items jsonb)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id  uuid := nullif(p_pedido->>'id', '')::uuid;
  v_num text;
begin
  if v_id is null then
    raise exception 'pedido-sin-id';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'pedido-sin-renglones';
  end if;

  select p.numero into v_num from public.pedidos p where p.id = v_id;

  if not found then
    insert into public.pedidos (
      id, id_empresa, id_vendedor, id_cliente, id_visita, estado, monto_total, peso_total,
      created_at, lat, lng, accuracy, distancia_m, origen, intencion, sello_precios_ts, catalogo_ts,
      forma_pago, fecha_entrega, observaciones)
    select r.id, r.id_empresa, r.id_vendedor, r.id_cliente, r.id_visita,
           coalesce(r.estado, 'Pendiente'), coalesce(r.monto_total, 0), coalesce(r.peso_total, 0),
           coalesce(r.created_at, now()), r.lat, r.lng, r.accuracy, r.distancia_m, r.origen,
           coalesce(r.intencion, '[]'::jsonb), r.sello_precios_ts, r.catalogo_ts,
           r.forma_pago, r.fecha_entrega, r.observaciones
      from jsonb_populate_record(null::public.pedidos, p_pedido) r
    returning numero into v_num;
  end if;

  -- Renglones: solo los que FALTAN. No alcanza con `on conflict do nothing`: el trigger
  -- `items_exportado_congelado` es BEFORE INSERT y corre antes del ON CONFLICT, así que el reintento
  -- de un pedido que el ERP ya bajó rebotaría aunque todos sus renglones ya estuvieran.
  -- `id_pedido` se fuerza al de la cabecera. Un producto que ya no existe (lo borró marketing entre
  -- que se tomó el pedido y que subió) no puede tirar la venta entera: el renglón conserva su
  -- descripción y su código, que son los que viajan al ERP.
  insert into public.pedido_items (id, id_pedido, id_producto, descripcion, cantidad,
                                   precio_unitario, peso_kg, codigo_producto)
  select coalesce(r.id, gen_random_uuid()), v_id,
         case when exists (select 1 from public.productos pr where pr.id = r.id_producto)
              then r.id_producto end,
         r.descripcion, coalesce(r.cantidad, 0), coalesce(r.precio_unitario, 0),
         coalesce(r.peso_kg, 0), r.codigo_producto
    from jsonb_populate_recordset(null::public.pedido_items, p_items) r
   where r.id is null
      or not exists (select 1 from public.pedido_items i where i.id = r.id)
  on conflict (id) do nothing;

  return v_num;
end
$$;

revoke execute on function public.registrar_pedido(jsonb, jsonb) from public, anon;
grant  execute on function public.registrar_pedido(jsonb, jsonb) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Rescate: lo que cada teléfono tenía aislado
-- ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Solo se INSERTA desde el teléfono y solo lo lee el superadmin. Nada lo borra solo (regla 20:
-- se aísla, no se borra).
create table if not exists public.rescate_cola (
  id          uuid primary key default gen_random_uuid(),
  id_empresa  uuid not null references public.empresas(id),
  id_usuario  uuid not null default auth.uid() references public.perfiles(id),
  dispositivo text,
  version     text,
  contenido   jsonb not null,
  ts          timestamptz not null default now()
);
create index if not exists rescate_cola_ts_idx on public.rescate_cola (ts desc);

alter table public.rescate_cola enable row level security;

drop policy if exists rescate_cola_ins on public.rescate_cola;
create policy rescate_cola_ins on public.rescate_cola for insert to authenticated
  with check (id_usuario = auth.uid() and id_empresa = (select public.mi_empresa()));

drop policy if exists rescate_cola_sel on public.rescate_cola;
create policy rescate_cola_sel on public.rescate_cola for select to authenticated
  using ((select public.es_superadmin()));

revoke all on public.rescate_cola from anon;
grant insert, select on public.rescate_cola to authenticated;

-- Que PostgREST vea la función nueva sin esperar (si no, `rpc('registrar_pedido')` da PGRST202).
notify pgrst, 'reload schema';

-- Verificación (no modifica nada):
--   select tgname from pg_trigger where tgrelid = 'public.pedidos'::regclass and not tgisinternal;
--   select proacl from pg_proc where proname in ('registrar_pedido', 'asegurar_visita_pedido');
--   select count(*), max(ts) from public.rescate_cola;
