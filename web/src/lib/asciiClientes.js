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
 * 🔴 FORMATO PROPUESTO, NO ACORDADO. El programador del ERP todavía no definió cómo importa
 * clientes. Esto es lo que le proponemos, con las mismas convenciones que `Pedidos.txt`:
 *
 *   · campos separados por TAB, **sin fila de encabezado**, una fila por cliente;
 *   · fin de línea `\r\n`, UTF-8 sin BOM (o Latin-1 con `?enc=latin1`);
 *   · el orden de `CAMPOS` de abajo.
 *
 * Si su importador pide otra cosa, se cambia ACÁ y en ningún otro lado.
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
]

/**
 * Arma el texto del archivo. Pura y exportada, como `armarAscii`: se puede contrastar contra lo que
 * el importador del ERP acepte sin tocar la base.
 *
 * @param {object[]} clientes  ya ordenados por quien llama
 * @param {{ zona_horaria?: string }} [cfg]  `empresas.export_erp`
 * @returns {{ texto: string, filas: number }}
 */
export function armarClientes(clientes, cfg = null) {
  const zona = cfg?.zona_horaria || ZONA_POR_DEFECTO
  const filas = clientes.map((c) => CAMPOS.map(([, val]) => celda(val(c, zona))).join(SEP))
  return { texto: filas.length ? filas.join(EOL) + EOL : '', filas: filas.length }
}
