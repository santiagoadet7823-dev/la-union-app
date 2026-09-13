import { normalizar } from './texto'

/**
 * Abreviatura y número de zona: sugerencias y chequeo de "ya está ocupado".
 *
 * Las dos cosas tienen índice único por empresa en la base (`zonas_empresa_numero_uidx`,
 * `zonas_empresa_abrev_uidx`). Si se manda un valor repetido, el insert/update falla con 23505 en
 * la cola y va a cuarentena sin que la persona lo vea — por eso se bloquea ACÁ, antes de encolar.
 */

/** Dos caracteres, mayúscula o dígito. Es lo que pide `zonas_abrev_chk`. */
export const ABREV_RE = /^[A-Z0-9]{2}$/

/** Normaliza lo tipeado: mayúsculas, sin acentos, sólo letras/dígitos, máximo 2. */
export function limpiarAbrev(s) {
  return normalizar(s).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2)
}

/** Zona que ya usa esa abreviatura (ignorando `excluirId`), o null. */
export function abrevOcupada(abrev, zonas, excluirId) {
  const a = limpiarAbrev(abrev)
  if (!a) return null
  return (zonas || []).find((z) => z.id !== excluirId && (z.abrev || '') === a) || null
}

/**
 * Sugiere una abreviatura libre a partir del nombre: iniciales de las dos primeras palabras
 * ("Las Lajitas" → LL), o las dos primeras letras si es una sola ("Gaona" → GA). Si está ocupada,
 * prueba la inicial + cada letra siguiente del nombre, y al final inicial + dígito. '' si no hay.
 */
export function sugerirAbrev(nombre, zonas, excluirId) {
  const palabras = normalizar(nombre).split(' ').filter(Boolean)
  if (!palabras.length) return ''
  const libre = (a) => a.length === 2 && !abrevOcupada(a, zonas, excluirId)
  const candidatos = []
  if (palabras.length >= 2) candidatos.push(palabras[0][0] + palabras[1][0])
  const junto = palabras.join('')
  candidatos.push(junto.slice(0, 2))
  for (let i = 1; i < junto.length; i++) candidatos.push(junto[0] + junto[i])
  for (let d = 1; d <= 9; d++) candidatos.push(junto[0] + String(d))
  for (const c of candidatos) {
    const a = c.toUpperCase()
    if (libre(a)) return a
  }
  return ''
}

/**
 * Próximo número de zona: max + 1 (o 1). No se busca hueco desde el 1 como con los clientes: los
 * números de zona los define la empresa y "la que sigue" es lo que uno espera al crear una nueva.
 */
export function primerNumeroLibre(zonas) {
  let max = 0
  for (const z of zonas || []) if (z.numero != null && z.numero > max) max = z.numero
  return max + 1
}

/** Zona que ya usa ese número (ignorando `excluirId`), o null. */
export function numeroOcupado(numero, zonas, excluirId) {
  if (numero === '' || numero == null) return null
  const n = Number(numero)
  if (!Number.isFinite(n)) return null
  return (zonas || []).find((z) => z.id !== excluirId && z.numero === n) || null
}
