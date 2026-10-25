import { codigoKey } from './texto'

/**
 * Código de cliente: el hueco libre y la colisión.
 *
 * 🔑 DESDE EL 25/10/2026 (db/92, plan 24) EL CÓDIGO LO DA DIST-AT Y EL ERP LO RECIBE. Hasta ahí lo
 * "emitía el ERP" y acá sólo se sugería. Ahora el alta lleva el primer número libre y el ERP se
 * entera por `export-clientes`. Lo que la app sabe es qué códigos tiene cargados —vigentes y
 * archivados— y con eso puede (a) proponer el primer número libre y (b) frenar un alta que
 * chocaría contra el índice único `clientes_codigo_norm_uidx`.
 *
 * ⚠️ LO DE ACÁ PROPONE; EL SERVIDOR DECIDE. Este cálculo corre contra la copia LOCAL de la cartera,
 * así que dos vendedores sin señal ven el mismo hueco. El trigger `clientes_resolver_codigo` (db/92)
 * resuelve el choque al subir: gana el que se creó antes (`creado_ts`) y al otro le da el siguiente
 * libre. Por eso el número que muestra el teléfono es PROVISORIO hasta sincronizar.
 *
 * 🔴 GEMELO EN SQL (regla 36): `siguiente_codigo_cliente()` en db/92, como `codigo_norm()` lo es de
 * `codigoKey()`. Si cambia la regla del hueco (el piso, qué cuenta como ocupado), cambia en los dos.
 *
 * Las dos funciones reciben `clientesTodos` (con archivados): un archivado sigue ocupando su código
 * en la base. Lo que el teléfono NO ve son las lápidas (`clientes_export_bajas`, códigos de
 * clientes borrados que el ERP todavía conoce): si propone uno de esos, el servidor le da otro.
 * Comparan por `codigoKey()`, que es exactamente lo que hace `codigo_norm()` del lado de Postgres:
 * lo que pasa acá pasa allá.
 */

/**
 * Primer número libre desde `piso` (`empresas.export_erp.cliente_codigo_min`, db/92). Los huecos
 * que van quedando (clientes dados de baja, códigos que nunca se usaron) se reutilizan antes de
 * seguir de largo. Sólo se compara contra códigos numéricos: "CLI-005" no bloquea el 5.
 *
 * `piso = null` es "no sé el piso" (un teléfono que nunca lo leyó con señal, ver
 * `useCodigoClienteMin`): se propone el siguiente al último código cargado, que no reutiliza nada.
 * El servidor no tiene este caso: allá el piso siempre se conoce.
 *
 * @param {Array<{codigo?: string}>} clientes
 * @param {number|null} [piso=1]
 * @returns {string}
 */
export function primerCodigoLibre(clientes, piso = 1) {
  const ocupados = new Set()
  let max = 0
  for (const c of clientes || []) {
    const k = codigoKey(c.codigo)
    if (k && /^\d+$/.test(k)) {
      const v = Number(k)
      ocupados.add(v)
      if (v > max) max = v
    }
  }
  let n = piso == null ? max + 1 : Math.max(1, Math.trunc(Number(piso)) || 1)
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
