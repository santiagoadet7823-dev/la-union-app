/**
 * DE QUIÉN ES UN COMERCIO. Única definición, para el teléfono del vendedor y para la supervisión.
 *
 * 🩸 POR QUÉ EXISTE (18/09/2026, db/76). Hasta hoy "mi cartera" la decidía la RLS: el vendedor
 * leía sus clientes y los sin dueño, y la app tomaba todo lo que llegaba como suyo
 * (`useJornada`). Para que pueda cubrir la zona de otro por una jornada, la lectura se abrió a
 * toda la empresa, y la pregunta "¿es mío?" pasó a la app. Si la contestaran dos lugares
 * distintos, un día el mapa y la lista no coincidirían (regla 31).
 *
 * Un comercio tiene dueño de DOS formas, y se toman las dos: el dueño directo
 * (`clientes.id_vendedor`) o el dueño de su zona (`zonas.id_vendedor`). El directo gana: es la
 * excepción explícita que el menú Zonas deja cargar por cliente.
 *
 * 🩸 SIN DUEÑO YA NO ES "DE TODOS" (18/09/2026). Hasta hoy el comercio sin dueño entraba en la
 * lista y el mapa de TODOS los vendedores (930 de 2.042 al 18/09, con 249 ubicados): cada teléfono
 * cargaba los suyos más esos 930, y Eduardo, con 29 propios, scrolleaba 959. El dueño decidió que
 * arranquen ocultos y se lleguen a mano —el buscador de Inicio y un interruptor en el mapa— y que
 * quien ubica uno se lo quede (eso no cambió: `ubicarComercio`). `conSinDueno` es esa mano.
 */

/**
 * El id del dueño del comercio (directo o de su zona), o `null` si no tiene.
 * @param {{ idVendedor?: string|null, idZona?: string|null }} c  cliente en la forma de la vista
 * @param {Map<string, { id_vendedor?: string|null }>} zonaPorId
 */
export function duenoDe(c, zonaPorId) {
  if (!c) return null
  if (c.idVendedor) return c.idVendedor
  const z = c.idZona ? zonaPorId?.get(c.idZona) : null
  return z?.id_vendedor || null
}

/**
 * ¿Este comercio está en MI lista hoy? Mío, de una zona que cubro por esta jornada o —sólo si se
 * pide— de nadie.
 * @param {object} c
 * @param {{ userId: string, zonaPorId: Map, zonasCubiertas?: Set<string>, conSinDueno?: boolean }} ctx
 */
export function esMiComercio(c, { userId, zonaPorId, zonasCubiertas = null, conSinDueno = false }) {
  const dueno = duenoDe(c, zonaPorId)
  if (!dueno) return conSinDueno
  if (dueno === userId) return true
  return !!(zonasCubiertas && c.idZona && zonasCubiertas.has(c.idZona))
}
