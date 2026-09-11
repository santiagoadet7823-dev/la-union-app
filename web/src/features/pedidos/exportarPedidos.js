import { descargarArchivo } from '../../services/download'
import { supabase } from '../../services/supabase'
import { itemsDePedidos } from './usePedidos'
import { armarAscii, CFG_POR_DEFECTO } from '../../lib/asciiPedidos'

/**
 * EXPORTAR LOS PEDIDOS PARA FACTURAR EN EL SISTEMA DEL CLIENTE.
 *
 * 🩸 POR QUÉ EXISTE (22/08/2026, pedido del cliente). La distribuidora factura desde su propio
 * sistema de gestión y **no hay integración posible** con él. Lo que sí acepta es un archivo de
 * texto separado por TABULADORES — lo que en varios ERP argentinos se llama "exportación ASCII",
 * que es lo que el cliente describió y por lo que "parece un CSV pero raro".
 *
 * ✅ **EL FORMATO YA NO ES PROVISORIO** (10/09/2026). Durante tres semanas esto emitió un layout
 * inventado, escrito sin ver un archivo real. El 09/09 llegó uno (`20260909164538.txt`) y el layout
 * se rehízo contra él: 25 campos, sin encabezado, verificado fila por fila con
 * `scripts/verificar-formato-pedidos.mjs`.
 *
 * 🔑 ESTE ARCHIVO YA NO DECIDE EL FORMATO. El layout vive en `lib/asciiPedidos.js`, que es el MISMO
 * módulo que usa la Edge Function `export-pedidos` — la que contesta el pedido automático del
 * servidor Java del cliente. Tenerlo dos veces es la regla 36 de CLAUDE.md: el día que el ERP
 * cambie una columna, una de las dos copias se queda vieja y **no falla**, emite un archivo corrido
 * en silencio. Acá quedan sólo las dos cosas que sí son de la app: de dónde salen los datos y cómo
 * se baja el archivo.
 *
 * ⚠️ ESTE BOTÓN NO MUEVE EL CURSOR DE EXPORTACIÓN (`pedidos.exportado_ts`, db/62). Es a propósito:
 * es la vía de REVISIÓN —bajar lo que está en pantalla para mirarlo— y el canal automático es el que
 * lleva la cuenta de lo enviado. Si este botón marcara, alguien revisando un rango de 30 días
 * dejaría afuera del ERP todo lo que todavía no se había mandado, sin enterarse.
 */

/**
 * La configuración del layout por empresa (`empresas.export_erp`, db/62).
 *
 * Se lee de la base y no se escribe en el código porque 11 de los 25 campos son constantes cuyo
 * significado NO conocemos —los encabezados del archivo del ERP nunca llegaron—, y el día que el
 * cliente aclare qué es el campo 7 hay que poder corregirlo con un `update`, no con un release de
 * APK para teléfonos que no siempre actualizan.
 *
 * Se piden todas las empresas involucradas de una vez: con el scope de superadmin en '*', la lista
 * puede traer pedidos de dos distribuidoras y cada una tiene sus constantes.
 */
async function configsDe(pedidos) {
  const ids = [...new Set(pedidos.map((p) => p.id_empresa).filter(Boolean))]
  const porEmpresa = new Map()
  if (!ids.length) return porEmpresa
  const { data, error } = await supabase.from('empresas').select('id, export_erp').in('id', ids)
  if (error) throw error
  for (const e of data || []) porEmpresa.set(e.id, { ...CFG_POR_DEFECTO, ...(e.export_erp || {}) })
  return porEmpresa
}

/**
 * Baja el archivo.
 *
 * `descargarArchivo` resuelve las dos plataformas: `<a download>` en la PWA y Filesystem + hoja de
 * compartir en el APK, donde el ancla no dispara nada.
 *
 * ⚠️ **SIN BOM.** El respaldo CSV sí lo lleva, para que Excel no rompa los acentos; acá el lector es
 * una máquina y esos tres bytes quedarían pegados adelante del primer campo del primer renglón, que
 * es un número. El archivo del cliente no tiene BOM.
 *
 * El nombre por defecto es `Pedidos.txt` — el mismo que ellos ya reciben hoy de su sistema actual.
 */
export async function exportarPedidosAscii(pedidos, { nombre = 'Pedidos' } = {}) {
  if (!pedidos.length) throw new Error('No hay pedidos en el rango elegido.')
  const [lineasPorPedido, cfgs] = await Promise.all([
    itemsDePedidos(pedidos.map((p) => p.id)),
    configsDe(pedidos),
  ])

  // Se arma por empresa y se concatena: cada distribuidora tiene sus propias constantes de layout.
  // Con una sola empresa —el caso real— esto es una vuelta y el orden no cambia.
  const partes = []
  let filas = 0
  let sinLineas = 0
  for (const [idEmpresa, cfg] of (cfgs.size ? cfgs : new Map([[null, CFG_POR_DEFECTO]]))) {
    const suyos = idEmpresa ? pedidos.filter((p) => p.id_empresa === idEmpresa) : pedidos
    if (!suyos.length) continue
    const r = armarAscii(suyos, lineasPorPedido, cfg)
    if (r.texto) partes.push(r.texto)
    filas += r.filas
    sinLineas += r.sinLineas
  }

  const texto = partes.join('')
  if (!texto) throw new Error('Ninguno de los pedidos del rango tiene renglones.')
  const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' })
  await descargarArchivo({ filename: `${nombre}.txt`, blob, mime: 'text/plain' })
  return { pedidos: pedidos.length, filas, sinLineas }
}

/**
 * ⚠️ Nombre viejo, mantenido para no romper una importación que se me haya pasado. El export dejó de
 * ser un TSV con encabezado el 10/09/2026; lo que emite ahora es el ASCII del ERP.
 */
export const exportarPedidosTsv = exportarPedidosAscii
