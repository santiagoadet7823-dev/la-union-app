-- 45_pedidos_anulacion.sql — Los pedidos se revisan, se anulan, y el encargado ve lo suyo.
-- 20/08/2026.
--
-- POR QUÉ EXISTE. `db/43` hizo que el pedido se guardara; faltaba lo otro: **poder mirarlo después
-- y arreglarlo cuando está mal**. El reporte fue textual: "acabo de hacer un pedido y no encuentro
-- dónde eliminarlo". No había dónde: no existía ninguna pantalla que leyera `pedidos`.
--
-- Tres decisiones tomadas por el dueño el 20/08/2026, y las tres están acá:
--
--  1. **Se anula, no se borra** — salvo el superadmin, y solo lo que ya está anulado. La anulación
--     deja el pedido en su lugar con sello, motivo y firma; el borrado no deja nada. Un pedido
--     borrado no se distingue de uno que nunca existió, y sin distinguirlos no hay forma de notar
--     que alguien se está limpiando los días flojos.
--  2. **El vendedor anula lo suyo sin pedir permiso.** No hace falta abrir nada: `pedidos_upd` ya
--     se lo permitía. Lo que se agrega es CON QUÉ QUEDA REGISTRADO.
--  3. **El encargado ve solo su gente.**
--
-- 🔴 EL PUNTO 3 REVIERTE UNA DECISIÓN ESCRITA EN `db/40`, y por eso se explica en vez de hacerse
-- callado. Aquel archivo dejó `pedidos_sel` afuera de la jerarquía con este argumento: "el pedido
-- es sobre ver PERSONAS; los clientes son de la distribuidora, no del encargado" — y cerraba
-- diciendo que si algún día se quería, era **una decisión comercial, no de implementación**.
-- Esa decisión se tomó. El argumento de `db/40` era sobre `clientes_sel` (la cartera, que
-- efectivamente es de la empresa y hay que poder cubrir a un compañero); `pedidos_sel` había
-- quedado del mismo lado por arrastre. Un pedido no es un cliente: es el resultado del trabajo de
-- una persona, y quién puede revisarlo —y ANULARLO— es exactamente la pregunta que `db/40` vino a
-- contestar en un solo lugar. `clientes_sel` NO se toca.
--
-- APLICA AL INSTANTE Y SIN BUNDLE NUEVO. Todo el recorte pasa en el servidor: rige aunque el
-- teléfono siga en una versión vieja — que hoy es el caso de los nueve equipos.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Con qué queda registrada una anulación
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `motivo_anulacion` ya lo creó `db/43`. Faltaba la firma: sin ella, "¿quién anuló esto?" no se
-- puede contestar, y esa pregunta es la ÚNICA defensa que tiene el sistema contra usar la
-- anulación como borrado encubierto. La app la va a llenar siempre; la columna se deja nullable
-- porque las filas anteriores a hoy no la pueden tener y mentirles un default sería peor.
alter table public.pedidos
  add column if not exists anulado_por uuid references public.perfiles(id),
  add column if not exists anulado_ts  timestamptz;

comment on column public.pedidos.anulado_por is
  'Quién anuló el pedido (db/45). Null en pedidos vivos y en los anulados antes del 20/08/2026.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Las policies, obedeciendo la jerarquía en vez de repetirla
-- ─────────────────────────────────────────────────────────────────────────────
--
-- La forma es SIEMPRE `id_vendedor in (select ids_a_mi_cargo())`, con el subselect, y no una
-- llamada por fila: así Postgres la evalúa una vez por consulta (InitPlan) — es la misma regla de
-- uso que documenta `db/40` y el motivo por el que el mapa abre en vez de colgarse.
--
-- `ids_a_mi_cargo()` ya contesta para TODOS los roles, así que las cuatro ramas que había escritas
-- a mano se colapsan en una sola condición. Lo que cada rol ve NO cambia, salvo el encargado:
--   · superadmin → todo (rama propia, que corta antes)
--   · admin      → toda su empresa            (igual que antes)
--   · encargado  → los de su gente            (👈 lo que cambia)
--   · vendedor / repartidor → lo suyo          (igual que antes)
--
-- El `id_empresa = mi_empresa()` se conserva aunque `ids_a_mi_cargo()` ya filtre por empresa: es
-- cinturón y tirantes sobre la tabla que guarda plata, y cuesta cero.

drop policy if exists pedidos_sel on public.pedidos;
create policy pedidos_sel on public.pedidos for select
using (
  es_superadmin()
  or (
    id_empresa = mi_empresa()
    and (
      id_vendedor in (select ids_a_mi_cargo())
      or id_repartidor in (select ids_a_mi_cargo())
    )
  )
);

-- UPDATE con el mismo alcance en `using` y en `with check`. Que el `with check` sea idéntico no es
-- redundancia: es lo que impide que alguien REASIGNE un pedido a una persona que no puede ver
-- (un vendedor solo se tiene a sí mismo en `ids_a_mi_cargo()`, así que no puede pasarle un pedido
-- a otro para sacárselo de encima).
drop policy if exists pedidos_upd on public.pedidos;
create policy pedidos_upd on public.pedidos for update
using (
  es_superadmin()
  or (
    id_empresa = mi_empresa()
    and (
      id_vendedor in (select ids_a_mi_cargo())
      or id_repartidor in (select ids_a_mi_cargo())
    )
  )
)
with check (
  es_superadmin()
  or (
    id_empresa = mi_empresa()
    and (
      id_vendedor in (select ids_a_mi_cargo())
      or id_repartidor in (select ids_a_mi_cargo())
    )
  )
);

-- Las líneas heredan del padre, como ya lo hacían. Se reescriben solo para que digan lo mismo que
-- `pedidos_*`: dos reglas que deberían coincidir y están escritas distinto terminan divergiendo.
drop policy if exists items_sel on public.pedido_items;
create policy items_sel on public.pedido_items for select
using (exists (
  select 1 from public.pedidos p
  where p.id = pedido_items.id_pedido
    and (
      es_superadmin()
      or (
        p.id_empresa = mi_empresa()
        and (
          p.id_vendedor in (select ids_a_mi_cargo())
          or p.id_repartidor in (select ids_a_mi_cargo())
        )
      )
    )
));

drop policy if exists items_upd on public.pedido_items;
create policy items_upd on public.pedido_items for update
using (exists (
  select 1 from public.pedidos p
  where p.id = pedido_items.id_pedido
    and (
      es_superadmin()
      or (
        p.id_empresa = mi_empresa()
        and (
          p.id_vendedor in (select ids_a_mi_cargo())
          or p.id_repartidor in (select ids_a_mi_cargo())
        )
      )
    )
))
with check (exists (
  select 1 from public.pedidos p
  where p.id = pedido_items.id_pedido
    and (
      es_superadmin()
      or (
        p.id_empresa = mi_empresa()
        and (
          p.id_vendedor in (select ids_a_mi_cargo())
          or p.id_repartidor in (select ids_a_mi_cargo())
        )
      )
    )
));

-- ⚠️ `items_ins` NO se toca. Su condición mira al pedido padre para decidir, y ahí el vendedor
-- todavía no está "a cargo" de nada: está insertando el suyo recién creado. Cambiarla por la forma
-- jerárquica sería equivalente hoy, pero es la policy de la que depende que un pedido pueda
-- guardarse, y no se toca lo que funciona sin una razón.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Borrar de verdad: solo superadmin, y solo lo ya anulado
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 🩸 `db/43` decía "SIN POLICY DE DELETE, NI ACÁ NI EN pedido_items" y el criterio sigue siendo el
-- correcto para el uso normal. Esto no lo revierte: lo acota. Es la salida para limpiar los pedidos
-- de PRUEBA, y tiene dos cerrojos que la vuelven inútil como atajo:
--
--   · `es_superadmin()` — nadie de la distribuidora puede borrar, ni el admin.
--   · `estado = 'Anulado'` — hay que anular ANTES, o sea dejar el rastro de la anulación antes de
--     poder destruirlo. Un pedido vivo no se puede borrar de un paso.
--
-- No hace falta policy de DELETE en `pedido_items`: su FK es `on delete cascade` (verificado en la
-- base viva), y un borrado en cascada no pasa por la RLS de la tabla hija.
drop policy if exists pedidos_del on public.pedidos;
create policy pedidos_del on public.pedidos for delete
using (es_superadmin() and estado = 'Anulado');

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El índice del listado
-- ─────────────────────────────────────────────────────────────────────────────
--
-- La pantalla de gestión filtra por empresa y rango de fechas y ordena por fecha descendente:
-- `db/43` ya dejó `(id_empresa, created_at desc)`, que cubre exactamente eso. NO se agrega uno con
-- `estado` adentro — los estados son seis y ninguno descarta filas, así que solo costaría
-- escrituras. La lección de `db/42` fue esa misma al revés (medir antes de borrar un índice); acá
-- es medir antes de crearlo.
--
-- Lo que sí falta es el de "MIS pedidos", que filtra por persona:
create index if not exists idx_pedidos_vendedor_fecha
  on public.pedidos (id_vendedor, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICACIÓN (contra la base VIVA, nunca leyendo este archivo — regla 5)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Que quedaron cinco policies en `pedidos` (sel/ins/upd/del) y tres en `pedido_items`:
--    select tablename, policyname, cmd from pg_policies
--     where tablename in ('pedidos','pedido_items') order by tablename, cmd;
--
-- 🔴 La prueba que importa, y que NO se puede hacer leyendo policies: entrar como un encargado que
-- no tenga a cierto vendedor a cargo y confirmar que sus pedidos no aparecen. Una policy que se lee
-- bien y filtra mal se ve igual que una correcta.
