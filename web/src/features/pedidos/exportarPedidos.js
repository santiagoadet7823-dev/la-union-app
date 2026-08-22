import { descargarArchivo } from '../../services/download'
import { itemsDePedidos } from './usePedidos'

/**
 * EXPORTAR LOS PEDIDOS PARA FACTURAR EN OTRO SISTEMA.
 *
 * 🩸 POR QUÉ EXISTE (22/08/2026, pedido del cliente). La distribuidora factura desde su propio
 * sistema de gestión y **no hay integración posible** con él. Lo que sí acepta es un archivo de
 * texto separado por TABULADORES — lo que en varios ERP argentinos se llama "exportación ASCII",
 * que es lo que el cliente describió y por lo que "parece un CSV pero raro".
 *
 * ⚠️ **ESTE FORMATO ES PROVISORIO Y ESTÁ HECHO SIN VER EL ARCHIVO REAL.** Se pidió una muestra del
 * export de su sistema y todavía no llegó. Por eso todo lo que puede cambiar —el separador, el
 * encabezado, el orden y el nombre de las columnas— vive en las dos constantes de acá arriba y no
 * repartido por la función: ajustar esto al formato definitivo tiene que ser editar una lista, no
 * reescribir nada. Lo que NO va a cambiar es de dónde sale cada dato.
 *
 * UNA FILA POR RENGLÓN DE PEDIDO, con la cabecera repetida. Es la forma que come un importador de
 * facturación: cada línea trae su propio número de comprobante, así el importador arma la cabecera
 * agrupando y no depende del orden del archivo. Un formato "cabecera + detalle" en dos bloques es
 * más compacto y mucho más frágil.
 *
 * 🔑 EL NÚMERO ES EL MISMO EN TODOS LADOS. `pedidos.numero` lo asigna el trigger
 * `asignar_numero_pedido` por empresa (`000001`, `000002`…). Es el que ve el vendedor en el ticket,
 * el que se imprime y el que va acá — que es justo lo que el cliente pidió para poder relacionar el
 * pedido con lo que factura y con lo que sale al reparto. No se inventa un código nuevo.
 */

// El separador. Un TAB, no una coma: es lo que espera el sistema del cliente.
const SEP = '\t'

/**
 * Las columnas, en orden. `val(p, l)` recibe el pedido y la línea.
 *
 * `precio_unitario` y `descripcion` salen de la LÍNEA y no del producto vivo: se copiaron al tomar
 * el pedido (`db/43`) justamente para que un comprobante de hace seis meses siga diciendo lo que se
 * vendió y a cuánto, aunque marketing le haya cambiado el nombre o el precio.
 */
const COLUMNAS = [
  ['pedido', (p) => p.numero || ''],
  ['fecha', (p) => fechaLocal(p.created_at)],
  ['hora', (p) => horaLocal(p.created_at)],
  ['cliente_codigo', (p) => p.comercio?.codigo || ''],
  ['cliente', (p) => p.comercio?.name || ''],
  ['localidad', (p) => p.comercio?.loc || ''],
  ['vendedor', (p) => p.nombreVendedor || ''],
  ['producto_codigo', (_p, l) => l.codigoProducto || ''],
  ['descripcion', (_p, l) => l.descripcion || ''],
  ['cantidad', (_p, l) => numero(l.cantidad, 0)],
  ['precio_unitario', (_p, l) => numero(l.precio_unitario, 2)],
  // Vacío, no cero, cuando la línea no existe: un 0,00 en un archivo de facturación se lee como
  // "se vendió por cero", que es una afirmación distinta de "este pedido no tiene renglones".
  ['subtotal', (_p, l) => (l.cantidad == null && l.precio_unitario == null ? '' : numero((Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0), 2))],
  ['estado', (p) => p.estado || ''],
]

/**
 * Fecha y hora LOCALES, nunca UTC. Salta es UTC−3: con `toISOString().slice(0,10)` un pedido de las
 * 21:30 se exportaría con la fecha de mañana y le caería en otro día de facturación (regla 23).
 */
function fechaLocal(ts) {
  const d = new Date(ts)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}
function horaLocal(ts) {
  const d = new Date(ts)
  const p2 = (n) => String(n).padStart(2, '0')
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/**
 * Un número para un importador, no para una persona: punto decimal y sin separador de miles.
 * `fmtPesos` acá sería un bug — pondría "$ 1.234,50" y el otro sistema lee 1.
 */
function numero(v, decimales) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(decimales) : ''
}

/**
 * Una celda. **No se escapa con comillas**: en un archivo separado por tabs las comillas son texto
 * literal para la mayoría de los importadores, así que agregarlas ensucia el dato. Lo que sí hay que
 * hacer es que ningún valor traiga un TAB o un salto de línea adentro, o correría las columnas —
 * un nombre de comercio con un enter pegado desde una planilla alcanza para romper el archivo.
 */
function celda(v) {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[\t\r\n]+/g, ' ').trim()
}

/**
 * Arma el texto del archivo. Separado de la descarga para poder verificarlo sin bajar nada.
 * @returns {{ texto: string, filas: number, sinLineas: number }}
 */
export function armarTsv(pedidos, lineasPorPedido) {
  const filas = [COLUMNAS.map(([titulo]) => titulo).join(SEP)]
  let sinLineas = 0
  for (const p of pedidos) {
    const lineas = lineasPorPedido.get(p.id) || []
    // Un pedido sin líneas igual sale, con una fila de cantidad vacía: es un dato raro que hay que
    // poder VER en el archivo. Omitirlo lo haría desaparecer sin que nadie se entere.
    if (!lineas.length) { sinLineas++; filas.push(COLUMNAS.map(([, val]) => celda(val(p, {}))).join(SEP)); continue }
    for (const l of lineas) filas.push(COLUMNAS.map(([, val]) => celda(val(p, l))).join(SEP))
  }
  return { texto: filas.join('\r\n') + '\r\n', filas: filas.length - 1, sinLineas }
}

/**
 * Baja el archivo. `descargarArchivo` resuelve las dos plataformas: `<a download>` en la PWA y
 * Filesystem + hoja de compartir en el APK, donde el ancla no dispara nada.
 *
 * El BOM UTF-8 va adelante por el mismo motivo que en Respaldo: sin él, Excel abre los acentos
 * rotos. Si el sistema del cliente resulta esperar Latin-1, se saca de acá.
 */
export async function exportarPedidosTsv(pedidos, { nombre = 'pedidos' } = {}) {
  if (!pedidos.length) throw new Error('No hay pedidos en el rango elegido.')
  const lineasPorPedido = await itemsDePedidos(pedidos.map((p) => p.id))
  const { texto, filas, sinLineas } = armarTsv(pedidos, lineasPorPedido)
  const blob = new Blob(['\ufeff' + texto], { type: 'text/tab-separated-values;charset=utf-8' })
  await descargarArchivo({ filename: `${nombre}.txt`, blob, mime: 'text/tab-separated-values' })
  return { pedidos: pedidos.length, filas, sinLineas }
}
