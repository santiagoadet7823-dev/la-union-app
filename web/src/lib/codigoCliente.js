import { codigoKey } from './texto'

/**
 * Código de cliente: el hueco libre y la colisión.
 *
 * El código lo emite el ERP de la distribuidora, no la app. Lo que la app SÍ sabe es qué códigos
 * tiene cargados —vigentes y archivados— y con eso puede (a) sugerir el primer número libre y
 * (b) frenar un alta que chocaría contra el índice único `clientes_codigo_norm_uidx`.
 *
 * (b) es la que importa: un insert con código repetido devuelve 23505, que `writeQueue` clasifica
 * como permanente y manda a cuarentena. La pantalla ya dijo "Cliente agregado" y el cliente no
 * está en la base. Mejor no dejarlo guardar.
 *
 * Las dos funciones reciben `clientesTodos` (con archivados): un archivado sigue ocupando su
 * código en la base, así que para esto cuenta como ocupado. Y comparan por `codigoKey()`, que es
 * exactamente lo que hace `codigo_norm()` del lado de Postgres: lo que pasa acá pasa allá.
 */

/**
 * Primer número libre rastreando desde el 1. Es lo que pidió gestión: los huecos que van quedando
 * (clientes borrados, códigos que nunca se usaron) se reutilizan antes de seguir de largo.
 * Sólo se compara contra códigos numéricos: "CLI-005" no bloquea el 5.
 *
 * ⚠️ Es "libre en DisT-At", no "libre en el ERP". La pantalla que lo muestre tiene que decirlo.
 *
 * @param {Array<{codigo?: string}>} clientes
 * @returns {string}
 */
export function primerCodigoLibre(clientes) {
  const ocupados = new Set()
  for (const c of clientes || []) {
    const k = codigoKey(c.codigo)
    if (k && /^\d+$/.test(k)) ocupados.add(Number(k))
  }
  let n = 1
  while (ocupados.has(n)) n++
  return String(n)
}

/**
 * El cliente que ya usa ese código, o `null`. `excluirId` es para la ficha: un cliente no choca
 * consigo mismo al re-guardar su propio código.
 *
 * @param {string} codigo
 * @param {Array<{id: string, codigo?: string}>} clientes
 * @param {string} [excluirId]
 */
export function codigoOcupado(codigo, clientes, excluirId) {
  const k = codigoKey(codigo)
  if (!k) return null
  return (clientes || []).find((c) => c.id !== excluirId && codigoKey(c.codigo) === k) || null
}
