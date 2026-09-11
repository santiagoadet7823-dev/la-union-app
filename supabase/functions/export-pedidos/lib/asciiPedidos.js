/**
 * EL ARCHIVO DE PEDIDOS QUE COME EL ERP DE LA DISTRIBUIDORA.
 *
 * 🩸 POR QUÉ ESTE MÓDULO EXISTE APARTE (10/09/2026). El mismo archivo lo emiten DOS runtimes: el
 * botón "Exportar para facturar" de la app (`features/pedidos/exportarPedidos.js`) y la Edge
 * Function `export-pedidos`, que es la que contesta el pedido automático del servidor Java del
 * cliente. Escribir el layout dos veces es la regla 36 de CLAUDE.md y el modo de falla más caro del
 * proyecto: el día que el ERP cambie una columna, uno de los dos se queda viejo y **no falla** —
 * emite un archivo corrido, en silencio.
 *
 * ⚠️ Este archivo se COPIA a `supabase/functions/export-pedidos/lib/` al desplegar
 * (`scripts/sync-export-pedidos.mjs`), igual que `planillaProductos.js` en el canal de precios. La
 * fuente es ésta. No editar la copia.
 *
 * 🔑 QUÉ ES ESTE FORMATO. Lo que el cliente llamó "asqui" es **ASCII**, la exportación de texto
 * plano de varios ERP argentinos. Se trabajó sobre un archivo real (`20260909164538.txt`, 09/09/2026):
 *
 *   · 25 campos separados por TAB, **sin fila de encabezado**;
 *   · una fila por renglón, con la cabecera del pedido REPETIDA en cada una;
 *   · fin de línea `\r\n`;
 *   · números con punto decimal, sin separador de miles y **sin decimales de relleno**
 *     (`38000`, no `38000.00`; pero `7350.07` y `317.5` tal cual).
 *
 * La aritmética del archivo real cierra: campo 9 = Σ(campo 19 × campo 21), verificado en varios
 * comprobantes (132700 y 5629.78 exactos). Eso es lo que ancla el mapeo de cantidad, precio y total.
 *
 * 🔴 LO QUE NO SABEMOS. Los encabezados del archivo nunca llegaron: 11 de los 25 campos son
 * constantes cuyo significado es DEDUCCIÓN. Por eso ninguna se escribe acá — todas salen de
 * `empresas.export_erp` (db/62) y se corrigen con un `update`, sin release de APK. Las dos que
 * importan son el campo 7 (probable forma de pago) y el campo 3 (vendedor o sucursal).
 */

/** El separador. Un TAB, no una coma: es lo que trae el archivo del cliente. */
export const SEP = '\t'

/** Fin de línea. `\r\n` como el archivo real — es un importador de Windows. */
export const EOL = '\r\n'

/**
 * Un número para un importador, no para una persona.
 *
 * `fmtPesos` acá sería un bug: pondría "$ 1.234,50" y el otro sistema lee 1. Y `toFixed(2)` también
 * lo sería con este ERP —emitiría `38000.00` donde el archivo real dice `38000`—, así que los
 * decimales sólo aparecen cuando el número los tiene. `decimalesFijos` deja volver atrás si su
 * importador resulta exigir el relleno; es una de las preguntas abiertas.
 */
export function numero(v, { decimalesFijos = false, decimales = 2 } = {}) {
  const n = Number(v)
  if (!Number.isFinite(n)) return ''
  if (decimalesFijos) return n.toFixed(decimales)
  // `toFixed` primero y recorte después: sin él, 0.1+0.2 saldría como 0.30000000000000004.
  // El recorte es sobre string y no `parseFloat(...).toString()` para no caer nunca en notación
  // exponencial, que un importador de texto lee como basura.
  const s = n.toFixed(decimales)
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

/**
 * `dd/mm/yyyy hh:mm`, en la zona horaria de la DISTRIBUIDORA.
 *
 * 🩸 ACÁ HUBO UN BUG Y SE CAZÓ EJECUTANDO (10/09/2026). Esto usaba `getHours()`, o sea "la hora
 * local del runtime". En el teléfono eso es Salta y estaba bien; en la Edge Function el runtime es
 * **UTC**, así que el canal automático emitía tres horas de más: un pedido tomado a las 22:33 salía
 * al ERP como `11/09/2026 01:33` — con la fecha del día siguiente, y por lo tanto en otro día de
 * facturación. Es exactamente el modo de falla que la regla 23 de CLAUDE.md viene a evitar, entrando
 * por la puerta de atrás: el comentario decía "hora local, nunca UTC" y era verdad en un runtime y
 * mentira en el otro.
 *
 * 🔑 POR ESO LA ZONA ES EXPLÍCITA Y NO "LA DEL QUE EJECUTA". Con `timeZone` fijo los dos runtimes
 * dan el mismo resultado siempre — y además deja de importar que un teléfono tenga mal configurada
 * su zona horaria, que antes se habría copiado tal cual al comprobante.
 */
export const ZONA_POR_DEFECTO = 'America/Argentina/Salta'

function partes(ts, zona) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  // `en-GB` da dd/mm/yyyy y reloj de 24 h, que es justo el formato del ERP. `hourCycle: 'h23'`
  // evita el "24:05" que `hour12: false` produce a la medianoche en algunos motores.
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const v = {}
  for (const p of f) v[p.type] = p.value
  return v
}

export function fechaHoraErp(ts, zona = ZONA_POR_DEFECTO) {
  const v = partes(ts, zona)
  if (!v) return ''
  return `${v.day}/${v.month}/${v.year} ${v.hour}:${v.minute}`
}

/**
 * La fecha de entrega. `fecha_entrega` es un `date` (`YYYY-MM-DD`) y se le pega la hora del pedido,
 * porque el campo 10 del archivo real lleva hora y siempre es igual al campo 6.
 *
 * ⚠️ Se parte a mano en vez de `new Date('2026-09-09')`: ese constructor interpreta el string como
 * UTC y en UTC−3 devuelve el día ANTERIOR. Es el mismo bug de arriba, por otra puerta.
 */
function fechaEntregaErp(fecha, tsPedido, zona = ZONA_POR_DEFECTO) {
  if (!fecha) return fechaHoraErp(tsPedido, zona)
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return fechaHoraErp(tsPedido, zona)
  const v = partes(tsPedido, zona)
  const p2 = (n) => String(n).padStart(2, '0')
  const hh = v ? `${v.hour}:${v.minute}` : '00:00'
  return `${p2(d)}/${p2(m)}/${y} ${hh}`
}

/**
 * Una celda. **No se escapa con comillas**: en un archivo separado por TABs las comillas son texto
 * literal para la mayoría de los importadores, así que agregarlas ensucia el dato. Lo que sí hay que
 * hacer es que ningún valor traiga un TAB o un salto de línea adentro, o correría las columnas — un
 * nombre de comercio con un enter pegado desde una planilla alcanza para romper el archivo.
 */
export function celda(v) {
  if (v === null || v === undefined) return ''
  return String(v).replace(/[\t\r\n]+/g, ' ').trim()
}

/** Las constantes del layout, si la empresa todavía no tiene `export_erp` cargado (db/62). */
export const CFG_POR_DEFECTO = {
  campo_2: '1', campo_3: '002', campo_5: '0', campo_8: '1',
  campo_11: '0', campo_12: '0', campo_13: '0', campo_15: '0', campo_16: '01',
  campo_20: '1', campo_22: '0', campo_23: '1', campo_24: '', campo_25: 'SIN GRUPO',
  forma_pago_default: '3',
  id_pedido: 'epoch',
  decimales_fijos: false,
  zona_horaria: ZONA_POR_DEFECTO,
}

/**
 * LOS 25 CAMPOS, EN ORDEN. `val(p, l, i, cfg)` recibe el pedido, la línea, el índice de renglón
 * (1-based) y la configuración de la empresa.
 *
 * `precio_unitario`, `descripcion` y `codigo_producto` salen de la LÍNEA y no del producto vivo: se
 * copian al tomar el pedido (db/43 y db/62) justamente para que un comprobante de hace seis meses
 * siga diciendo lo que se vendió y a cuánto, aunque marketing le haya cambiado el nombre, el precio
 * o lo haya sacado del catálogo.
 */
export const CAMPOS = [
  // 1 — El identificador del pedido.
  //
  // 🔴 DECISIÓN ABIERTA. Su app de preventa actual manda un epoch en milisegundos (el
  // `1788953946616` del archivo real ES la hora del pedido: 09/09/2026 08:39). Nosotros tenemos
  // `numero`, correlativo por empresa de 6 dígitos, que ya está impreso en tickets que existen.
  // Mientras no confirmen si su importador acepta el nuestro, se emite el epoch —compatible con lo
  // que ya come— y el `numero` viaja en observaciones (campo 14) para poder cruzar los dos sistemas.
  ['id_pedido', (p, _l, _i, cfg) => (cfg.id_pedido === 'numero'
    ? (p.numero || '')
    : String(new Date(p.created_at).getTime() || ''))],
  // 2 — constante, significado desconocido
  ['c2', (_p, _l, _i, cfg) => cfg.campo_2],
  // 3 — `002` en todo el archivo: vendedor o sucursal, sin confirmar. Si alguien cargó el código
  // ERP del vendedor (`perfiles.codigo_erp`), gana ése; si no, la constante de la empresa.
  ['vendedor_erp', (p, _l, _i, cfg) => p.codigoVendedor || cfg.campo_3],
  // 4 — código del cliente.
  // 🔑 CRUDO, nunca `codigo_norm`: esa columna generada (db/48) le quita los ceros a la izquierda y
  // existe sólo para COMPARAR ("0041 ≡ 41"). El ERP conoce a este comercio como `0712`, no como 712.
  ['cliente_codigo', (p) => p.comercio?.codigo || ''],
  // 5 — constante
  ['c5', (_p, _l, _i, cfg) => cfg.campo_5],
  // 6 — fecha y hora del pedido
  ['fecha', (p, _l, _i, cfg) => fechaHoraErp(p.created_at, cfg.zona_horaria)],
  // 7 — 🔴 el candidato firme a FORMA DE PAGO, sin confirmar. Hasta que llegue su tabla de códigos
  // se emite lo que el pedido tenga cargado y, si no tiene, el default de la empresa (`3`, que es
  // lo que trae el archivo real en todas sus filas).
  ['forma_pago', (p, _l, _i, cfg) => p.forma_pago || cfg.forma_pago_default],
  // 8 — constante
  ['c8', (_p, _l, _i, cfg) => cfg.campo_8],
  // 9 — total del pedido.
  //
  // 🔑 SE EMITE LA SUMA DE LOS RENGLONES, NO `monto_total`. El archivo tiene que cerrar CONSIGO
  // MISMO —es la validación que hace su importador y la que se usó para descifrar el layout—, y
  // `monto_total` lo calcula el teléfono al confirmar. Si algún día los dos difieren, que el
  // archivo sea internamente coherente es más importante que arrastrar la diferencia adentro.
  ['total', (p, _l, _i, cfg) => numero(p.totalCalculado, { decimalesFijos: cfg.decimales_fijos })],
  // 10 — fecha de entrega. En el archivo real siempre igual al campo 6.
  ['fecha_entrega', (p, _l, _i, cfg) => fechaEntregaErp(p.fecha_entrega, p.created_at, cfg.zona_horaria)],
  // 11-13 — constantes en cero (descuentos / recargo / IVA, sin confirmar)
  ['c11', (_p, _l, _i, cfg) => cfg.campo_11],
  ['c12', (_p, _l, _i, cfg) => cfg.campo_12],
  ['c13', (_p, _l, _i, cfg) => cfg.campo_13],
  // 14 — observaciones. Vacío en las 300 filas del ejemplo.
  ['observaciones', (p, _l, _i, cfg) => (cfg.id_pedido === 'numero'
    ? (p.observaciones || '')
    // Con el epoch en el campo 1, nuestro correlativo no viaja en ningún otro lado — y sin él no
    // hay forma de encontrar en la app el pedido que el ERP está facturando.
    : [p.observaciones, p.numero ? `Pedido ${p.numero}` : ''].filter(Boolean).join(' - '))],
  // 15-16 — constantes
  ['c15', (_p, _l, _i, cfg) => cfg.campo_15],
  ['c16', (_p, _l, _i, cfg) => cfg.campo_16],
  // 17 — número de renglón, reinicia en cada pedido
  ['renglon', (_p, _l, i) => String(i)],
  // 18 — código de producto (db/62: copiado en la línea, ya no por relación viva)
  ['producto_codigo', (_p, l) => l.codigoProducto || ''],
  // 19 — cantidad. Admite fracciones: el archivo real trae dos renglones de `0.5`.
  ['cantidad', (_p, l, _i, cfg) => numero(l.cantidad, { decimalesFijos: cfg.decimales_fijos })],
  // 20 — constante
  ['c20', (_p, _l, _i, cfg) => cfg.campo_20],
  // 21 — precio unitario, congelado en la línea al tomar el pedido
  ['precio_unitario', (_p, l, _i, cfg) => numero(l.precio_unitario, { decimalesFijos: cfg.decimales_fijos })],
  // 22-25 — constantes
  ['c22', (_p, _l, _i, cfg) => cfg.campo_22],
  ['c23', (_p, _l, _i, cfg) => cfg.campo_23],
  ['c24', (_p, _l, _i, cfg) => cfg.campo_24],
  ['c25', (_p, _l, _i, cfg) => cfg.campo_25],
]

/**
 * Arma el texto del archivo. **Pura y exportada a propósito**: es lo que permite comparar la salida
 * contra el archivo real del cliente sin bajar nada ni tocar la base — que es el criterio de
 * aceptación del formato, no "se ve parecido".
 *
 * ⚠️ **Sin fila de encabezado y sin BOM.** El archivo del cliente no los tiene. El BOM que sí lleva
 * el respaldo CSV está ahí para que Excel no rompa los acentos; acá el lector es una máquina, y esos
 * tres bytes quedarían pegados adelante del primer campo del primer renglón — que es un número.
 *
 * @param {object[]} pedidos  ya filtrados y ordenados por quien llama
 * @param {Map<string, object[]>} lineasPorPedido
 * @param {object} cfg  `empresas.export_erp`
 * @returns {{ texto: string, filas: number, sinLineas: number }}
 */
export function armarAscii(pedidos, lineasPorPedido, cfg = null) {
  const c = { ...CFG_POR_DEFECTO, ...(cfg || {}) }
  const filas = []
  let sinLineas = 0

  for (const p of pedidos) {
    const lineas = lineasPorPedido.get(p.id) || []
    // 🔴 Un pedido sin renglones NO se emite. Acá esto no es lo mismo que en el export manual, donde
    // una fila rara hay que poder VERLA: este archivo va derecho a facturación, y una cabecera con
    // total cero es una factura por cero pesos. Se cuenta y se informa por separado.
    if (!lineas.length) { sinLineas++; continue }

    // El total del comprobante, calculado una vez y compartido por todas sus filas.
    const totalCalculado = lineas.reduce(
      (acc, l) => acc + (Number(l.cantidad) || 0) * (Number(l.precio_unitario) || 0), 0,
    )
    const pedido = { ...p, totalCalculado }

    lineas.forEach((l, idx) => {
      filas.push(CAMPOS.map(([, val]) => celda(val(pedido, l, idx + 1, c))).join(SEP))
    })
  }

  return { texto: filas.length ? filas.join(EOL) + EOL : '', filas: filas.length, sinLineas }
}
