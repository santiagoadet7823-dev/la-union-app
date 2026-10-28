/**
 * EL ARCHIVO DE CLIENTES QUE COME EL ERP DE LA DISTRIBUIDORA (`Clientes.txt`).
 *
 * 07/10/2026 (db/86). Desde esta fecha dist-at da de alta los clientes y el ERP los recibe: la PC
 * del ERP baja este archivo de la Edge Function `export-clientes` cada 30 minutos, igual que baja
 * `Pedidos.txt` de `export-pedidos`.
 *
 * ⚠️ Este archivo se COPIA a `supabase/functions/export-clientes/lib/` al desplegar
 * (`scripts/sync-export-clientes.mjs`), junto con `asciiPedidos.js`, del que toma las piezas
 * comunes. La fuente es ésta. No editar la copia.
 *
 * 🔑 POR QUÉ REUSA `asciiPedidos.js` Y NO COPIA. Separador, fin de línea, la limpieza de una celda,
 * la fecha en la zona de la distribuidora y el código de vendedor son las MISMAS reglas que ya come
 * el importador de pedidos de ese ERP. Escribirlas dos veces es la regla 36 de CLAUDE.md.
 *
 * 🔑 25/10/2026 (db/92, plan 24): el ERP lee SOLO los clientes que manda DisT-At. Cada fila es el
 * ESTADO COMPLETO del cliente más el campo 12 (`ALTA` / `MODIFICACION` / `BAJA`), y el importador
 * hace upsert por código: mandar dos veces la misma fila no rompe nada. El primer archivo es la
 * cartera completa. Una `BAJA` de un cliente borrado (lápida) trae sólo código y nombre.
 *
 * 🔑 28/10/2026 (plan 31): La Unión esperaba la cartera entera en cada archivo y le llegaban sólo
 * los cambios (lote 2 = 279 de 2035). Con `clientes_base_completa` cada archivo trae TODOS los
 * vigentes y el campo 12 suma `SIN CAMBIOS`; con `clientes_direccion_zona`, los campos 13 y 14.
 *
 * 🔴 FORMATO PROPUESTO, NO ACORDADO hasta que el programador del ERP lo confirme. Mismas
 * convenciones que `Pedidos.txt`:
 *
 *   · campos separados por TAB, **sin fila de encabezado**, una fila por cliente;
 *   · fin de línea `\r\n`, UTF-8 sin BOM (o Latin-1 con `?enc=latin1`);
 *   · el orden de `CAMPOS` de abajo.
 *
 * Si su importador pide otra cosa, se cambia ACÁ y en ningún otro lado (y en
 * `PARA EL PROGRAMADOR - Clientes.txt`, que lo explica).
 */
import { SEP, EOL, celda, numero, fechaHoraErp, codigoVendedorErp, ZONA_POR_DEFECTO } from './asciiPedidos.js'

/**
 * LOS CAMPOS, EN ORDEN. `val(c, zona)` recibe el cliente (con `vendedor` embebido) y la zona horaria.
 */
export const CAMPOS = [
  // 1 — código del cliente. 🔑 CRUDO, nunca `codigo_norm` (ver el campo 4 de `asciiPedidos.js`).
  ['codigo', (c) => c.codigo || ''],
  // 2 — nombre del comercio
  ['nombre', (c) => c.nombre_comercio || ''],
  // 3 — localidad
  ['localidad', (c) => c.localidad || ''],
  // 4 — teléfono
  ['telefono', (c) => c.telefono || ''],
  // 5 — persona de contacto
  ['contacto', (c) => c.contacto || ''],
  // 6 — vendedor asignado, con el MISMO código que viaja en el campo 3 de `Pedidos.txt`
  ['vendedor_erp', (c) => codigoVendedorErp(c.vendedor) || ''],
  // 7 — fecha de alta (`dd/mm/aaaa`), la del dispositivo que lo creó, en la zona de la distribuidora
  ['fecha_alta', (c, zona) => fechaHoraErp(c.creado_ts || c.created_at, zona).slice(0, 10)],
  // 8-9 — ubicación, con punto decimal. Vacías si el comercio todavía no se ubicó en el mapa.
  ['lat', (c) => (c.lat == null ? '' : numero(c.lat, { decimales: 6 }))],
  ['lng', (c) => (c.lng == null ? '' : numero(c.lng, { decimales: 6 }))],
  // 10 — condición frente al IVA (22/10/2026, db/88): RI · MONOTRIBUTO · EXENTO · CONSUMIDOR_FINAL ·
  //      NO_ALCANZADO, o vacío si no se cargó. Viene embebido (`fiscal`) de `clientes_fiscal`.
  ['condicion_iva', (c) => c.fiscal?.condicion_iva || ''],
  // 11 — CUIT/CUIL, 11 dígitos sin guiones (la base ya verificó el dígito), o vacío.
  ['cuit', (c) => c.fiscal?.cuit || ''],
  // 12 — qué pasó (db/92): ALTA (primera vez que sale) · MODIFICACION · BAJA. Lo pone
  //      `tomar_lote_clientes`, no se deduce acá. Con la base completa (plan 31) el resto de la
  //      cartera sale como `SIN CAMBIOS`: lo pone `export-clientes`, tampoco se deduce acá.
  ['tipo', (c) => c.tipo || ''],
]

/**
 * 13-14 — dirección y nombre de la zona (28/10/2026, plan 31, pedido de La Unión). Sólo con
 * `clientes_direccion_zona: true` en `empresas.export_erp`: con la llave apagada el archivo es byte a
 * byte el de 12 campos, igual que `CAMPO_26` en `asciiPedidos.js`. Cambiarlas sube `export_version`
 * desde db/100.
 */
export const CAMPOS_DIRECCION_ZONA = [
  ['direccion', (c) => c.direccion || ''],
  ['zona', (c) => c.zona?.nombre || ''],
]

/**
 * Arma el texto del archivo. Pura y exportada, como `armarAscii`: se puede contrastar contra lo que
 * el importador del ERP acepte sin tocar la base.
 *
 * @param {object[]} clientes  ya ordenados por quien llama
 * @param {{ zona_horaria?: string, clientes_direccion_zona?: boolean }} [cfg]  `empresas.export_erp`
 * @returns {{ texto: string, filas: number }}
 */
export function armarClientes(clientes, cfg = null) {
  const zona = cfg?.zona_horaria || ZONA_POR_DEFECTO
  const campos = cfg?.clientes_direccion_zona === true ? [...CAMPOS, ...CAMPOS_DIRECCION_ZONA] : CAMPOS
  const filas = clientes.map((c) => campos.map(([, val]) => celda(val(c, zona))).join(SEP))
  return { texto: filas.length ? filas.join(EOL) + EOL : '', filas: filas.length }
}
