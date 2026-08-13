-- 38_rol_marketing.sql — Rol `marketing` + saneamiento del catálogo (12/08/2026).
--
-- EL PEDIDO: la distribuidora incorpora una persona dedicada al catálogo — precios, fotos,
-- productos, control de códigos.
--
-- POR QUÉ ACÁ SÍ VA UN ROL NUEVO, Y `db/23_perfiles_permisos.sql` SIGUE TENIENDO RAZÓN.
-- Ese archivo argumenta en contra de un rol 'marketing', y su argumento es correcto PARA EL CASO
-- QUE DESCRIBE: un VENDEDOR que además carga fotos. Ese sigue igual — rol 'vendedor' +
-- `permisos: {catalogo}` — y no se toca nada de su camino: conserva GPS, jornada, `GpsGate` y su
-- lugar en el mapa del equipo.
-- Lo que aparece ahora es el caso que en julio no existía: una persona cuyo trabajo **es** el
-- catálogo y que **no sale a la calle**. Ahí el rol prestado se da vuelta y muerde:
--   · con 'vendedor' queda encerrada detrás del muro de GPS (`GpsGate`) sin poder trabajar;
--   · con 'encargado' se la rastrea por GPS, entra al mapa del supervisor y aparece en los avisos
--     de "sin reportar" y "quieto" (`vigilancia_equipo`) todos los días de su vida.
-- El rol define QUÉ ES la persona, y esta persona no es un móvil. Los dos mecanismos conviven:
-- `permisos` para sumar una capacidad, un rol para describir un puesto distinto.
--
-- 🔴 LO QUE ESTE ROL **NO** PUEDE VER, y es a propósito: ninguna policy de `posiciones`,
-- `recorridos_snap`, `estado_dispositivo`, `visitas`, `alertas_equipo`, `rutas` ni
-- `ubicaciones_compartidas` menciona a 'marketing', así que no ve el recorrido de nadie. Verificado
-- contra la base viva: las siete acotan a `admin`/`encargado`. **Si algún día se agrega marketing a
-- alguna de ellas, es una decisión de privacidad, no un detalle de implementación.**
-- `perfiles_sel` ya lo cubre con `id = auth.uid()`: puede leer su propio perfil, que es lo que
-- necesita para loguearse.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El rol
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles add constraint perfiles_rol_check
  check (rol = any (array['superadmin', 'admin', 'encargado', 'vendedor', 'repartidor', 'marketing']));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Escritura del catálogo
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists productos_wr on public.productos;
create policy productos_wr on public.productos
  for all
  using (
    es_superadmin()
    or (id_empresa = mi_empresa()
        and (mi_rol() = any (array['admin', 'encargado', 'marketing'])
             or 'catalogo' = any (mis_permisos())))
  )
  with check (
    es_superadmin()
    or (id_empresa = mi_empresa()
        and (mi_rol() = any (array['admin', 'encargado', 'marketing'])
             or 'catalogo' = any (mis_permisos())))
  );

-- 🩸 ARREGLO DE PASO, no es cosmético. `categorias_wr` (db/09) miraba SOLO el rol, así que desde
-- que existe el permiso `catalogo` (db/23) un vendedor con ese permiso VE el botón "Categorías" en
-- `CatalogoTab` y sus escrituras fallan por RLS — sin mensaje útil, porque la mutación va por la
-- write queue y el error aparece lejos del toque. Era un permiso a medias: podía editar el producto
-- pero no la categoría a la que lo mandaba.
drop policy if exists categorias_wr on public.categorias;
create policy categorias_wr on public.categorias
  for all
  using (
    es_superadmin()
    or (id_empresa = mi_empresa()
        and (mi_rol() = any (array['admin', 'encargado', 'superadmin', 'marketing'])
             or 'catalogo' = any (mis_permisos())))
  )
  with check (
    es_superadmin()
    or (id_empresa = mi_empresa()
        and (mi_rol() = any (array['admin', 'encargado', 'superadmin', 'marketing'])
             or 'catalogo' = any (mis_permisos())))
  );

-- Storage NO necesita cambios: `puede_escribir_objeto()` (db/25) solo exige que la carpeta del
-- objeto sea la empresa de quien sube, sin mirar el rol.
-- 🔎 Corolario que conviene tener anotado, y que este archivo NO empeora: hoy **cualquier** usuario
-- autenticado de la empresa puede escribir en el bucket `productos`. El gate real de las fotos es
-- que sin poder escribir `productos.imagen_url` la foto queda huérfana y no se ve.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Columnas nuevas del producto
-- ─────────────────────────────────────────────────────────────────────────────
-- `marca` sale de los 28 encabezados de la lista de precios del ERP (MANAOS, DULCOR, BAGGIO,
-- LA VIRGINIA, FECOVITA…). Hasta hoy la marca no existía como campo y se venía colando dentro de
-- `categoria`: por eso "Manaos" está partido en 5 categorías por tamaño de envase
-- (Manaos 600ml, Manaos 1,5L, Manaos 2,25L, Manaos 3L, Manaos 354ml) y hay 183 productos en
-- "Otros". Son DOS EJES —qué es el producto y de quién es— y estaban aplastados en uno.
alter table public.productos add column if not exists marca text;
comment on column public.productos.marca is
  'Marca o proveedor. Eje separado de `categoria` (tipo de producto). Sale del encabezado de la lista del ERP.';

-- `unidad_venta` es el sufijo de la descripción del ERP: UN (unidad) · FDO (fardo) · CJ (caja) ·
-- DISPL (display) · PACK · CJN (cajón) · BOLSA. Es el dato que le faltaba al contador de la tarjeta
-- del vendedor: en mayorista la unidad natural no es "1", es el bulto.
alter table public.productos add column if not exists unidad_venta text;
comment on column public.productos.unidad_venta is
  'Cómo se vende: UN | FDO | CJ | DISPL | PACK | CJN | BOLSA. Sufijo de la descripción del ERP.';

-- Vigencia. Mismo patrón, mismo nombre y misma semántica que `clientes.archivado_ts` (db/22):
-- NULL = vigente. Se eligió espejar ese campo y no inventar un `vigente_ts` invertido justamente
-- porque ya hay una convención en la casa y dos convenciones opuestas para lo mismo garantizan que
-- alguien lea el filtro al revés.
--
-- POR QUÉ HACE FALTA: la lista del 08/08 trae 529 productos y en la base hay 693. Los 368 que no
-- vinieron no son un error de la lista — son productos que salieron de circulación. Hoy siguen
-- visibles para el vendedor con precio $0, que es la peor de las tres opciones posibles: le cotiza
-- $0 a un cliente. Descontinuar los saca de la vista SIN perder la foto ni el código, y si el
-- producto vuelve en una lista futura se reactiva solo (el import lo vuelve a poner en NULL).
-- Borrarlos liberaría el código y el próximo import los crearía de nuevo como productos nuevos sin
-- foto — exactamente el argumento de db/22.
alter table public.productos add column if not exists descontinuado_ts timestamptz;
comment on column public.productos.descontinuado_ts is
  'Cuándo dejó de estar en la lista de precios vigente. NULL = vigente. Espeja a clientes.archivado_ts.';

-- Índice PARCIAL sobre los vigentes: la consulta que corre en cada arranque de cada teléfono es
-- "traeme el catálogo", que ahora lleva `descontinuado_ts is null`. No crece con lo descontinuado.
create index if not exists productos_vigentes_idx
  on public.productos (id_empresa)
  where descontinuado_ts is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 🩸 Normalización del CÓDIGO a 4 dígitos
-- ─────────────────────────────────────────────────────────────────────────────
-- El ERP emite los códigos con ceros a la izquierda (`0041`); la base los tiene pelados (`41`)
-- porque así salieron de la extracción del PDF viejo. El pareo del importador era un
-- `trim().toLowerCase()` literal, así que `"0041" !== "41"`.
--
-- Medido el 12/08/2026 con la función real (`codigoKey`, `src/lib/texto.js`) sobre los 529 códigos
-- de la lista contra los 693 de la base: **325 actualizan · 204 son nuevos · 368 quedan sin lista**.
-- Con la comparación literal cruzaban **157** — solo los que ya vienen de 4 dígitos y no tienen
-- ceros que agregar. O sea que ese import habría creado **372 productos duplicados sin foto** y
-- habría dejado 168 con foto, precio viejo y un gemelo al lado.
-- 🩸 Lo peligroso no es que fallara: es que fallaba A MEDIAS, así que a simple vista "funcionaba".
--
-- El arreglo de verdad es la clave canónica del lado del JS (ya aplicada, y es la que sostiene el
-- pareo aunque el ERP cambie de formato mañana). Este UPDATE es lo otro: que el código GUARDADO se
-- vea igual que en el papel que la persona de marketing tiene al lado del teclado.
--
-- Verificado antes de correrlo: ningún código de la base tiene hoy ceros a la izquierda, así que
-- rellenar no puede colapsar dos códigos distintos en uno (693 → 693 claves únicas). El
-- `length <= 4` deja afuera al único de 5 dígitos (`45620`, que parece dos códigos pegados) — ese
-- se revisa a mano desde el control de códigos, no lo arregla una migración.
update public.productos
   set codigo = lpad(codigo, 4, '0')
 where codigo is not null
   and codigo ~ '^[0-9]+$'
   and length(codigo) < 4;

-- ⚠️ Recordatorio de deuda preexistente que esto NO toca y NO empeora: `productos_codigo_key` es
-- `unique (codigo)` GLOBAL, no por empresa — mismo problema ya reportado para `clientes_codigo_key`.
-- Con 2 empresas vivas en la base, dos distribuidoras no pueden usar el mismo código de producto.
