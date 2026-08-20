-- 43_pedidos_operativos.sql — El pedido se GUARDA (19/08/2026).
--
-- EL HALLAZGO QUE MOTIVA ESTO. `pedidos` y `pedido_items` existen desde `schema.sql` —con RLS
-- completa, endurecida en `db/06`— y **ninguna línea de código las tocó nunca**. Lo único que se
-- persistía de una venta era un escalar: `visitas.monto`. Los productos, las cantidades, los
-- precios y los kg se armaban en un `useState({})` y se tiraban al confirmar.
--
-- 🔴 Y ni siquiera ese escalar estaba llegando. Medido contra la base viva el 19/08/2026:
--
--     52 visitas · 33 `en_curso` · 19 `cancelado` · CERO `visitado` · CERO con monto
--
-- El check-out cuelga de `visitaActualRef`, un ref de React que muere con cualquier recarga del
-- WebView — y desde 1.12.1 la OTA se aplica sola (regla 48), así que recargar es rutina. La visita
-- quedaba abierta para siempre y el monto no se escribía nunca. El arreglo del ref va en el bundle
-- (`useJornada.js`, persistido con `services/persistence/`); acá va la mitad de la base.
--
-- QUÉ NO SE TOCA, Y POR QUÉ:
--   · `pedidos_sel` NO se jerarquiza. `db/40` lo dejó afuera a propósito y ese razonamiento sigue
--     valiendo: los clientes son de la distribuidora, no del encargado. Si algún día se quiere, es
--     una decisión comercial, no de implementación.
--   · El `id` lo genera el CLIENTE (uuid), igual que en `visitas` (`db/16`). Es lo que hace que un
--     reintento de la cola de escritura no duplique el pedido.
--
-- 🩸 SIN POLICY DE DELETE, NI ACÁ NI EN `pedido_items`. Un pedido mal cargado se ANULA, no se
-- borra. Es el mismo criterio que la cuarentena de posiciones (regla 20): un dato equivocado es
-- recuperable, uno destruido no. Ver §4, que además le saca a `pedido_items` un DELETE que hoy
-- tiene sin que nadie lo haya decidido.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Las columnas que faltaban
-- ─────────────────────────────────────────────────────────────────────────────

-- Con qué visita nació. Permite cruzar el pedido con el check-in, su hora y su GPS.
alter table public.pedidos
  add column if not exists id_visita uuid references public.visitas(id);

-- DÓNDE se tomó el pedido, y a qué distancia del comercio registrado.
-- El pedido de un vendedor de calle se toma ENFRENTE del comerciante; esto es lo que permite
-- distinguirlo de una llamada hecha desde la casa. No bloquea nada: informa.
alter table public.pedidos
  add column if not exists lat         double precision,
  add column if not exists lng         double precision,
  add column if not exists accuracy    double precision,
  add column if not exists distancia_m numeric;

comment on column public.pedidos.distancia_m is
  'Metros entre donde se confirmó el pedido y `clientes.lat/lng`. NULL cuando el comercio no tiene '
  'ubicación registrada — que hoy son 1.401 de 2.014. 🔴 NULL NO ES CERO: mostrarlo como "sin '
  'ubicación de referencia", nunca como "0 m". Y ojo con el otro falso cero: en la primera visita a '
  'un comercio sin ubicar, `reclamar_y_ubicar_cliente` le asigna las coordenadas de donde está el '
  'vendedor, así que la distancia da 0 POR CONSTRUCCIÓN y no prueba nada.';

-- De qué pantalla salió. La vidriera es la tablet del cliente; el celular es la grilla del vendedor.
alter table public.pedidos
  add column if not exists origen text;

alter table public.pedidos drop constraint if exists pedidos_origen_check;
alter table public.pedidos add constraint pedidos_origen_check
  check (origen is null or origen in ('celular', 'vidriera'));

-- INTENCIÓN DE COMPRA. Lo que entró al carrito y salió, más lo que el cliente miró en la tablet y
-- no pidió. Hoy esa señal se evapora: `addCart` con cantidad 0 hace `delete next[id]` y listo.
-- Va como jsonb y no como tabla propia porque es dato de la MISMA visita, se escribe una sola vez
-- junto con el pedido y no se consulta por fila.
-- Forma: [{ "id_producto": uuid, "cantidad_previa": int, "origen": "sacado" | "mirado" }]
-- 🔴 NUNCA viaja a la tablet del cliente. Es lectura del vendedor y de los reportes.
alter table public.pedidos
  add column if not exists intencion jsonb not null default '[]'::jsonb;

-- Por qué se anuló. Distinto de `motivo_no_venta`, que es "por qué el comercio no compró".
alter table public.pedidos
  add column if not exists motivo_anulacion text;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. `id_empresa` pasa a obligatorio
-- ─────────────────────────────────────────────────────────────────────────────
-- La columna existía nullable (viene de `historico/02_saas.sql`, que NO es fuente de verdad).
-- La tabla está VACÍA, así que esto es gratis hoy y carísimo dentro de un mes: un pedido sin
-- empresa es invisible para `pedidos_sel` y para cualquier exportación por tenant.
alter table public.pedidos alter column id_empresa set not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El estado, con la anulación adentro
-- ─────────────────────────────────────────────────────────────────────────────
-- El check original no contemplaba anular. Se conservan los cinco valores que ya estaban —el
-- módulo de entregas los va a necesitar— y se suma 'Anulado'.
alter table public.pedidos drop constraint if exists pedidos_estado_check;
alter table public.pedidos add constraint pedidos_estado_check
  check (estado in ('Pendiente', 'En camino', 'Entregado', 'No entregado', 'Sin pedido', 'Anulado'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 🔴 `pedido_items` tenía DELETE sin que nadie lo hubiera decidido
-- ─────────────────────────────────────────────────────────────────────────────
-- `items_wr` era una policy `for all`, y `all` incluye DELETE. O sea que cualquier vendedor podía
-- vaciar las líneas de un pedido ya confirmado y dejar la cabecera mintiendo un total que no se
-- corresponde con ninguna línea. Se parte en INSERT y UPDATE explícitos.
--
-- El FK `pedido_items_id_pedido_fkey` es ON DELETE CASCADE, pero eso no abre una puerta: no hay
-- —ni va a haber— policy de DELETE sobre `pedidos`.
drop policy if exists items_wr on public.pedido_items;

create policy items_ins on public.pedido_items
  for insert to authenticated
  with check (exists (
    select 1 from public.pedidos p
    where p.id = pedido_items.id_pedido
      and (es_superadmin() or (p.id_empresa = mi_empresa()
           and (mi_rol() in ('admin', 'encargado') or p.id_vendedor = auth.uid() or p.id_repartidor = auth.uid())))
  ));

-- El UPDATE existe para el módulo de entregas (`cantidad_entregada`, `motivo_faltante`), que es
-- justo lo que un repartidor completa después. Por eso `id_repartidor` sigue en la condición.
create policy items_upd on public.pedido_items
  for update to authenticated
  using (exists (
    select 1 from public.pedidos p
    where p.id = pedido_items.id_pedido
      and (es_superadmin() or (p.id_empresa = mi_empresa()
           and (mi_rol() in ('admin', 'encargado') or p.id_vendedor = auth.uid() or p.id_repartidor = auth.uid())))
  ))
  with check (exists (
    select 1 from public.pedidos p
    where p.id = pedido_items.id_pedido
      and (es_superadmin() or (p.id_empresa = mi_empresa()
           and (mi_rol() in ('admin', 'encargado') or p.id_vendedor = auth.uid() or p.id_repartidor = auth.uid())))
  ));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. El número de pedido
-- ─────────────────────────────────────────────────────────────────────────────
-- El ticket necesita un número corto que una persona pueda leer por teléfono; el uuid no sirve
-- para eso. Va por empresa y es atómico: un `insert … on conflict do update … returning` no puede
-- entregar el mismo número dos veces, ni con dos vendedores confirmando en el mismo instante.
-- Un `max(numero) + 1` sí podría, y por eso no se usa.
create table if not exists public.pedidos_contador (
  id_empresa uuid primary key references public.empresas(id) on delete cascade,
  ultimo     bigint not null default 0
);

alter table public.pedidos_contador enable row level security;
-- Sin policies a propósito: nadie la lee ni la escribe desde el cliente. La toca únicamente el
-- trigger, que es SECURITY DEFINER. Con RLS activa y cero policies, anon y authenticated no ven
-- ni una fila.

create or replace function public.asignar_numero_pedido()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_num bigint;
begin
  if new.numero is not null then return new; end if;

  insert into public.pedidos_contador (id_empresa, ultimo)
       values (new.id_empresa, 1)
  on conflict (id_empresa) do update set ultimo = pedidos_contador.ultimo + 1
    returning ultimo into v_num;

  new.numero := lpad(v_num::text, 6, '0');
  return new;
end
$function$;

drop trigger if exists pedidos_numero on public.pedidos;
create trigger pedidos_numero before insert on public.pedidos
  for each row execute function public.asignar_numero_pedido();

-- 🚨 Regla 7 + 7-bis: revocar de los TRES. Supabase le da EXECUTE explícito a anon y authenticated
-- sobre cada función nueva de `public` vía ALTER DEFAULT PRIVILEGES, y un grant explícito NO se va
-- con un revoke a PUBLIC. Esta función escribe un contador salteando RLS: no la llama nadie a mano.
revoke execute on function public.asignar_numero_pedido() from public;
revoke execute on function public.asignar_numero_pedido() from anon;
revoke execute on function public.asignar_numero_pedido() from authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Índices
-- ─────────────────────────────────────────────────────────────────────────────
-- El primero es para los reportes por jornada; el segundo lo consume el recomendador de `db/44`
-- ("lo que más lleva este cliente"), que agrega `pedido_items` por cliente.
create index if not exists pedidos_empresa_fecha_idx  on public.pedidos (id_empresa, created_at desc);
create index if not exists pedidos_cliente_fecha_idx  on public.pedidos (id_cliente, created_at desc);
create index if not exists pedidos_vendedor_fecha_idx on public.pedidos (id_vendedor, created_at desc);
create index if not exists pedido_items_pedido_idx    on public.pedido_items (id_pedido);
-- ⚠️ Ninguno parcial. Regla 6: un índice con WHERE sobre una columna de upsert rompe `on conflict`
-- con 42P10 y se cae todo en silencio. Acá no hay upsert, pero la costumbre se sostiene igual.

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Las 33 visitas que quedaron abiertas
-- ─────────────────────────────────────────────────────────────────────────────
-- Son el rastro del bug del ref: check-in que se guardó, check-out que nunca llegó. No se pueden
-- cerrar como 'visitado' —no sabemos si hubo venta y no hay monto— así que van a 'cancelado', que
-- es lo que la app ya escribe cuando una visita se abandona.
-- Solo las de días ANTERIORES: una visita de hoy puede estar realmente en curso ahora mismo.
update public.visitas
   set estado = 'cancelado',
       check_out_ts = coalesce(check_out_ts, check_in_ts)
 where estado = 'en_curso'
   and (check_in_ts at time zone 'America/Argentina/Salta')::date
       < (now() at time zone 'America/Argentina/Salta')::date;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Verificación (correr a mano después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
-- Que no quedó ninguna policy de DELETE:
--   select tablename, policyname, cmd from pg_policies
--    where schemaname='public' and tablename in ('pedidos','pedido_items') order by 1,3;
--   -- esperado: pedidos {INSERT,SELECT,UPDATE} · pedido_items {INSERT,SELECT,UPDATE}
--
-- Que el ACL del trigger quedó limpio (regla 7-bis — mirar el ACL REAL, no asumir):
--   select proname, proacl from pg_proc
--    where pronamespace = 'public'::regnamespace and proname = 'asignar_numero_pedido';
--   -- esperado: sin `anon=X` ni `authenticated=X`
--
-- Que no quedan visitas viejas abiertas:
--   select estado, count(*) from public.visitas group by 1;
