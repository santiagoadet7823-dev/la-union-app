-- 55_pedidos_edicion.sql — el vendedor corrige un pedido sin perder el precio pactado (03/09/2026).
--
-- QUÉ RESUELVE. Hasta hoy un pedido confirmado era inmutable para quien lo tomó: si el comerciante
-- agregaba dos cajones a los cinco minutos, o el vendedor se equivocaba de renglón, el único camino
-- era ANULAR y rehacerlo entero. Lo pidieron el dueño y un vendedor en la reunión del 02/09.
--
-- 🔑 LA REGLA QUE PIDIÓ EL CLIENTE, Y POR QUÉ NO HAY QUE PROGRAMARLA. "Si entre que cargué el
-- pedido y lo edito hubo actualización de precios, lo viejo queda congelado; lo nuevo va al precio
-- de hoy." Eso YA es como funciona: `pedido_items.precio_unitario` se COPIA en la línea al
-- confirmar (`useJornada.js`, la línea del `precioDe`), igual que `descripcion`. Editar una línea
-- vieja sólo toca `cantidad`, así que el precio no se puede mover ni queriendo — la protección es
-- de esquema, no una condición que alguien pueda olvidarse de escribir.
-- Es la misma decisión que se tomó el 27/08 para la ENTREGA PARCIAL: si el repartidor entrega 40 de
-- 60, el comerciante paga los 40 al precio pactado. Restar en la edición es el mismo hecho.
-- ⚠️ Corolario deliberado: bajar la cantidad NO recalcula el escalón por volumen. Si compró 12 al
-- precio de 12 y se arrepiente de 4, paga 8 al precio de 12. Se le prometió ese número con el
-- comerciante enfrente; la app no se lo sube por atrás.
--
-- LA VENTANA es `estado = 'Pendiente'` (decisión del dueño, 03/09): se edita hasta que el
-- repartidor lo pasa a "En camino". Nadie corrige lo que ya salió a la calle.
--
-- Y NO EXISTE EL PEDIDO EN $0: quitar la última línea no deja una cabecera vacía, pide motivo y
-- anula por el camino que ya existe (`anularPedido`). Un pedido en cero y uno anulado serían dos
-- formas de decir lo mismo, y la de la izquierda no dice quién ni por qué.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. La auditoría — dónde y cuándo se tocó
-- ─────────────────────────────────────────────────────────────────────────────
-- El cliente pidió explícitamente que la modificación deje coordenadas y hora. Es la mitad del
-- pedido: sin esto, "el ticket cambió" no se distingue de "el ticket siempre fue así".

create table if not exists public.pedido_ediciones (
  id            uuid primary key,
  id_empresa    uuid not null references public.empresas(id),
  id_pedido     uuid not null references public.pedidos(id) on delete cascade,
  id_usuario    uuid not null references public.perfiles(id),
  -- 🩸 La estampa el CLIENTE, no `now()`. La edición puede subir horas después si el vendedor
  -- estaba sin señal (todo pasa por la write queue), y lo que interesa es cuándo se decidió, no
  -- cuándo llegó. Mismo criterio que `pedidos.created_at` y que `pedidos.anulado_ts`.
  ts            timestamptz not null,
  lat           double precision,
  lng           double precision,
  accuracy      double precision,
  -- Qué cambió, renglón por renglón: [{id_producto, descripcion, de, a}] con `de`/`a` en unidades.
  -- Va como jsonb y no como tabla hija porque nadie va a consultar POR renglón editado: se lee
  -- entero, para mostrar "qué le pasó a este pedido".
  cambios       jsonb not null default '[]'::jsonb,
  monto_antes   numeric(12,2),
  monto_despues numeric(12,2),
  created_at    timestamptz not null default now(),
  constraint pedido_ediciones_cambios_array check (jsonb_typeof(cambios) = 'array')
);

comment on table public.pedido_ediciones is
  'Cada corrección de un pedido: quién, cuándo, DÓNDE (lat/lng) y qué renglones cambiaron. No tiene '
  'policy de UPDATE ni de DELETE a propósito: un registro de auditoría que se puede editar no es '
  'auditoría.';

comment on column public.pedido_ediciones.ts is
  'Cuándo se hizo la edición, estampado por el teléfono. NO es cuándo llegó a la base: puede subir '
  'horas después desde la cola offline.';

create index if not exists pedido_ediciones_pedido_idx
  on public.pedido_ediciones (id_pedido, ts desc);
create index if not exists pedido_ediciones_empresa_fecha_idx
  on public.pedido_ediciones (id_empresa, ts desc);

alter table public.pedido_ediciones enable row level security;

-- Se ve con el mismo alcance jerárquico que el pedido al que pertenece (`pedidos_sel`, db/45): el
-- encargado ve las de su gente, el admin las de su empresa. La regla vive en `ids_a_mi_cargo()` y
-- no se reescribe acá (era la lección de la jerarquía: la misma condición en nueve lugares).
-- ⚠️ Regla 10: el alcance de tenant va como `in (select …)`, nunca como predicado escalar por fila.
drop policy if exists pedido_ediciones_sel on public.pedido_ediciones;
create policy pedido_ediciones_sel on public.pedido_ediciones
  for select using (
    es_superadmin() or (
      id_empresa = mi_empresa()
      and id_usuario in (select ids_a_mi_cargo())
    )
  );

-- Sólo se puede escribir una edición PROPIA y sobre un pedido que uno alcanza. Nadie firma por otro.
drop policy if exists pedido_ediciones_ins on public.pedido_ediciones;
create policy pedido_ediciones_ins on public.pedido_ediciones
  for insert with check (
    id_empresa = mi_empresa()
    and id_usuario = auth.uid()
    and exists (
      select 1 from public.pedidos p
       where p.id = pedido_ediciones.id_pedido
         and p.id_empresa = mi_empresa()
    )
  );

-- Sin policy de UPDATE ni de DELETE, para nadie. Ni siquiera el superadmin: si un día hay que
-- borrar una edición, que sea un acto explícito con service_role y no un botón.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Quitar un renglón — la única policy que faltaba
-- ─────────────────────────────────────────────────────────────────────────────
-- Hoy `pedido_items` NO tiene DELETE para nadie, y no es un olvido: `db/43` partió a propósito el
-- viejo `items_wr FOR ALL` (que incluía DELETE por accidente) en `items_ins` + `items_upd`.
--
-- La alternativa era dejar la línea quitada en `cantidad = 0`, y se descartó: ensucia el ticket
-- impreso, el TSV que va a facturación y todo reporte que cuente renglones. Un producto que el
-- comerciante no se llevó no es una línea en cero, es una línea que no está.
--
-- Los dos cerrojos: **el pedido sigue Pendiente** y **es de alguien a mi cargo**. Con eso, el
-- vendedor borra renglones de los suyos sin tocar, y nadie borra renglones de algo ya despachado.
drop policy if exists items_del on public.pedido_items;
create policy items_del on public.pedido_items
  for delete using (
    exists (
      select 1 from public.pedidos p
       where p.id = pedido_items.id_pedido
         and (
           es_superadmin() or (
             p.id_empresa = mi_empresa()
             and p.estado = 'Pendiente'
             and p.id_vendedor in (select ids_a_mi_cargo())
           )
         )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Cerrar la ventana en la BASE, no en el botón
-- ─────────────────────────────────────────────────────────────────────────────
-- 🩸 ACÁ ESTUVO LA TRAMPA, Y CASI SE ROMPE LA ENTREGA. La versión obvia de esta policy es
-- "`items_upd` sólo si el pedido está Pendiente". **Habría roto las entregas parciales**:
-- `useEntregas.guardarEntregado` escribe `cantidad_entregada` cuando el pedido ya está *En camino*,
-- que es justamente el estado que la condición prohíbe. Y como un UPDATE que RLS rechaza **no da
-- error** —afecta cero filas y vuelve con éxito—, el repartidor habría cerrado entregas delante del
-- cliente que no guardaban nada, sin un solo síntoma.
--
-- La condición correcta cubre los dos usos legítimos de escribir una línea:
--   · el pedido está **Pendiente** → es una EDICIÓN (vendedor corrigiendo), o
--   · el que escribe **es (o manda a) el repartidor asignado** → es una ENTREGA, en cualquier estado.
--   · el que escribe es **admin o encargado** → es GESTIÓN corrigiendo, en cualquier estado.
-- Para un vendedor `ids_a_mi_cargo()` es él solo, él no es el repartidor y su rol no es de gestión:
-- le queda sólo la primera rama, que es exactamente la ventana que pidió el dueño.
--
-- 🩸 LA TERCERA RAMA SE AGREGÓ DESPUÉS DE MEDIR, y es una lección repetida: acotar una policy le
-- SACA capacidades a alguien, y hay que preguntarse a quién. La versión anterior de `items_upd` era
-- ancha (`ids_a_mi_cargo()` sobre `id_vendedor`, sin mirar el estado), así que el admin y el
-- encargado podían corregir el renglón de un pedido ya entregado — un faltante mal cargado, por
-- ejemplo. Cerrando por estado eso se perdía **en silencio**, porque un UPDATE que RLS rechaza
-- afecta cero filas y vuelve con éxito. La rama de gestión repone exactamente lo que ya había, y
-- espeja lo que `items_ins` (db/43) permite desde el primer día para esos dos roles.
--
-- 📏 Medido en la base viva el 03/09/2026 antes de tocar nada: 6 pedidos, **los 6 Pendiente y
-- ninguno con repartidor asignado**. O sea que el circuito de entrega todavía no corrió en
-- producción y hoy ninguna de estas ramas está en uso real — razón de más para dejarlas bien
-- ahora, porque el día que se estrene nadie va a estar mirando.
drop policy if exists items_upd on public.pedido_items;
create policy items_upd on public.pedido_items
  for update using (
    exists (
      select 1 from public.pedidos p
       where p.id = pedido_items.id_pedido
         and (
           es_superadmin() or (
             p.id_empresa = mi_empresa()
             and (
               (p.estado = 'Pendiente' and p.id_vendedor in (select ids_a_mi_cargo()))
               or p.id_repartidor in (select ids_a_mi_cargo())
               or mi_rol() = any (array['admin','encargado'])
             )
           )
         )
    )
  ) with check (
    exists (
      select 1 from public.pedidos p
       where p.id = pedido_items.id_pedido
         and (
           es_superadmin() or (
             p.id_empresa = mi_empresa()
             and (
               (p.estado = 'Pendiente' and p.id_vendedor in (select ids_a_mi_cargo()))
               or p.id_repartidor in (select ids_a_mi_cargo())
               or mi_rol() = any (array['admin','encargado'])
             )
           )
         )
    )
  );

-- `items_ins` NO se toca: ya exige que el pedido padre exista y sea alcanzable, que es lo que hace
-- falta para agregar un renglón nuevo en una edición. La ventana la cierra el cliente al no ofrecer
-- el botón, y el renglón nuevo entra con el precio de HOY (`precioDe`), que es lo pedido.
--
-- `pedidos_upd` TAMPOCO se toca, y conviene decir por qué: la edición actualiza `monto_total` y
-- `peso_total`, pero por esa misma policy pasan el cambio de estado del repartidor
-- (Pendiente → En camino → Entregado), la asignación de repartidor y la ANULACIÓN, que tiene que
-- poder hacerse en cualquier estado. Meterle un `estado = 'Pendiente'` rompería las tres. El cerrojo
-- de la ventana vive donde de verdad importa —los renglones— y ahí no hay forma de esquivarlo.

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación (correr a mano después de aplicar)
-- ─────────────────────────────────────────────────────────────────────────────
--   select policyname, cmd from pg_policies
--    where schemaname='public' and tablename in ('pedido_items','pedido_ediciones')
--    order by tablename, cmd;
--   -- esperado en pedido_items: items_del (DELETE), items_ins, items_sel, items_upd
--
--   -- 🔴 LA PRUEBA QUE IMPORTA, y no se puede reemplazar mirando la pantalla: que la entrega
--   -- parcial siga funcionando después de tocar `items_upd`. Con la sesión de un REPARTIDOR:
--   --   update pedido_items set cantidad_entregada = cantidad
--   --    where id_pedido = '<un pedido En camino suyo>';
--   -- Tiene que afectar N filas, no cero. Cero = la policy lo está rechazando en silencio.
