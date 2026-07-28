-- 22_clientes_archivado.sql — Archivado de clientes (28/07/2026).
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO `activo`: `clientes.activo` NO significa "está vigente". Significa
-- "está CONFIRMADO": `addCliente` lo pone en false cuando el alta viene de un móvil
-- (CatalogContext.jsx), y `ClientesTab` dibuja un botón "Confirmar" sobre esas filas. Si el
-- archivado reusara ese campo, los clientes archivados reaparecerían como pendientes de
-- confirmación y un toque los resucitaría. Son dos estados distintos y necesitan dos columnas.
--
-- POR QUÉ ARCHIVAR Y NO BORRAR: la cartera tiene 195 filas cuyo `nombre_comercio` es literalmente
-- "A" — basura de la importación inicial. Pero cada una tiene un `codigo` único (2209, 2187, …) que
-- vino de la planilla del cliente. Un DELETE libera esos códigos y, si mañana llega una planilla
-- con los mismos, el importador los crea de nuevo en vez de reconocerlos. Archivar los saca de la
-- vista sin perder esa correspondencia, y es reversible.
--
-- Es un timestamp y no un boolean a propósito: además de "está archivado" queda CUÁNDO, que es lo
-- primero que se pregunta cuando alguien nota que un cliente desapareció.

alter table public.clientes add column if not exists archivado_ts timestamptz;

comment on column public.clientes.archivado_ts is
  'Cuándo se archivó. NULL = vigente. Distinto de `activo`, que es "confirmado / por confirmar".';

-- Índice PARCIAL sobre los vigentes: la consulta que corre miles de veces por día es "traeme la
-- cartera", que ahora lleva `archivado_ts is null`. El índice solo indexa esas filas, así que no
-- crece con lo archivado.
create index if not exists clientes_vigentes_idx
  on public.clientes (id_empresa)
  where archivado_ts is null;

-- No se toca ninguna policy: archivar es un UPDATE y `clientes_upd` ya cubre a
-- admin / encargado / superadmin (y al vendedor sobre sus propios clientes). El gate de que la
-- acción MASIVA sea solo del superadmin vive en la UI, que es donde está la decisión de producto.
