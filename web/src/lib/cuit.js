/**
 * CUIT/CUIL y situación fiscal del cliente (22/10/2026, plan 20, db/88).
 *
 * 🔑 GEMELO DE LA BASE: `cuitValido` es la misma regla que `public.cuit_valido` (db/88). La base la
 * aplica como CHECK, así que un CUIT que pase acá y no allá terminaría en la cuarentena de la cola
 * después de que la pantalla dijo "guardado". Si cambia la regla, se cambia en los dos lados.
 */

/** Condición frente al IVA: código que guarda la base (CHECK de db/88) → lo que se lee. */
export const CONDICIONES_IVA = [
  ['RI', 'Responsable inscripto'],
  ['MONOTRIBUTO', 'Monotributo'],
  ['EXENTO', 'Exento'],
  ['CONSUMIDOR_FINAL', 'Consumidor final'],
  ['NO_ALCANZADO', 'No alcanzado'],
]
const ETIQUETA_IVA = new Map(CONDICIONES_IVA)

export function etiquetaIva(codigo) {
  return ETIQUETA_IVA.get(codigo) || ''
}

/** Sólo los dígitos: saca guiones, puntos y espacios ("20-12345678-6" → "20123456786"). */
export function normalizarCuit(s) {
  return String(s ?? '').replace(/\D/g, '')
}

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

/**
 * Dígito verificador módulo 11. Recibe el CUIT ya normalizado (11 dígitos). Prefijos 20/23/24/25/
 * 26/27 (personas) y 30/33/34 (empresas); si el dígito da 10, el número no existe.
 */
export function cuitValido(cuit) {
  if (!/^(20|23|24|25|26|27|30|33|34)\d{9}$/.test(String(cuit ?? ''))) return false
  let suma = 0
  for (let i = 0; i < 10; i++) suma += Number(cuit[i]) * PESOS[i]
  let dv = 11 - (suma % 11)
  if (dv === 11) dv = 0
  if (dv === 10) return false
  return dv === Number(cuit[10])
}

/** "20123456786" → "20-12345678-6". Lo que no tiene 11 dígitos se devuelve como vino. */
export function formatoCuit(cuit) {
  const d = normalizarCuit(cuit)
  return d.length === 11 ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : String(cuit ?? '')
}

/**
 * Lo que escribió la persona → `{ cuit, error }`. Vacío es válido (el dato es opcional) y da
 * `cuit: null`. El error es el texto que se muestra debajo del campo.
 */
export function leerCuit(texto) {
  const d = normalizarCuit(texto)
  if (!d) return { cuit: null, error: null }
  if (d.length !== 11) return { cuit: null, error: `Tiene ${d.length} dígitos: el CUIT/CUIL lleva 11` }
  if (!/^(20|23|24|25|26|27|30|33|34)/.test(d)) return { cuit: null, error: `Empieza con ${d.slice(0, 2)}: el CUIT/CUIL empieza con 20, 23, 24, 27, 30, 33 o 34` }
  if (!cuitValido(d)) return { cuit: null, error: 'El número no es válido: revisalo (el último dígito no coincide)' }
  return { cuit: d, error: null }
}
