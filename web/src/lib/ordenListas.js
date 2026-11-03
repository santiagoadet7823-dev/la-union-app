import { DIAS, parseDias } from './diasVisita.js'

/**
 * EL ORDEN POR COLUMNA DE GESTIÓN → CLIENTES Y CATÁLOGO (plan 37). Funciones puras: no tocan la
 * lista que reciben.
 *
 * - Códigos: numéricos, 9 antes que 10 y 100; como texto iría 10, 100, 9.
 * - Los vacíos van SIEMPRE al final, también de mayor a menor: si no, con ▼ la lista arrancaría con
 *   cientos de renglones "—" (hay más de 400 comercios sin días cargados).
 * - Empates: por nombre, siempre de la A a la Z.
 */
const TEXTO = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

const compararPlano = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** `''` es "vacío" para el orden: lo que en pantalla se ve como "—". */
const numeroOVacio = (v) => {
  const n = Number(v)
  return v != null && v !== '' && Number.isFinite(n) ? n : ''
}

function ordenarPorClave(lista, claveDe, sentido, comparar = TEXTO.compare) {
  const signo = sentido === 'desc' ? -1 : 1
  return lista
    .map((item) => {
      const v = claveDe(item)
      return { item, clave: typeof v === 'number' ? v : String(v ?? '').trim() }
    })
    .sort((a, b) => {
      const aVacio = a.clave === ''
      const bVacio = b.clave === ''
      if (aVacio !== bVacio) return aVacio ? 1 : -1
      if (aVacio) return TEXTO.compare(a.item.name || '', b.item.name || '')
      return signo * comparar(a.clave, b.clave) || TEXTO.compare(a.item.name || '', b.item.name || '')
    })
    .map(({ item }) => item)
}

/** `'LU · JU'` → `'03'`. Un dígito por día: comparados como texto plano respetan la semana. */
const claveDias = (dias) => parseDias(dias).map((d) => DIAS.indexOf(d)).join('')

const textoZona = (z) => (z ? `${z.abrev ? `${z.abrev} · ` : ''}${z.nombre || ''}` : '')

/** Días: por semana (alfabético daría JU antes que LU). Estado: "por confirmar" primero. */
export function ordenarClientes(lista, { campo, sentido }, zonas = []) {
  const zonaPorId = new Map(zonas.map((z) => [z.id, z]))
  const claves = {
    codigo: (c) => c.codigo,
    nombre: (c) => c.name,
    localidad: (c) => c.loc,
    zona: (c) => textoZona(zonaPorId.get(c.idZona)),
    dias: (c) => claveDias(c.dias),
    frecuencia: (c) => c.frecuencia,
    estado: (c) => (c.activo ? 1 : 0),
  }
  if (!claves[campo]) return [...lista]
  // Las claves de días ya están armadas: el collator numérico leería '03' como 3 y rompería la semana.
  const comparar = campo === 'dias' || campo === 'estado' ? compararPlano : TEXTO.compare
  return ordenarPorClave(lista, claves[campo], sentido, comparar)
}

/**
 * Precio: el que se ve en la fila (el de oferta si está en oferta). Un precio en 0 cuenta como vacío:
 * es el mismo criterio del filtro "Sin precio", y así "de menor a mayor" no arranca por los que no
 * tienen precio cargado.
 */
const precioVisible = (p) => {
  const n = numeroOVacio(p.oferta && p.precioOferta != null ? p.precioOferta : p.price)
  return n === 0 ? '' : n
}

export function ordenarProductos(lista, { campo, sentido }) {
  const claves = {
    codigo: (p) => p.codigo,
    nombre: (p) => p.name,
    categoria: (p) => p.cat,
    precio: precioVisible,
    unidades: (p) => numeroOVacio(p.unidades),
    nivel: (p) => (p.nivel >= 1 && p.nivel <= 4 ? Number(p.nivel) : ''),
  }
  if (!claves[campo]) return [...lista]
  const numerico = campo === 'precio' || campo === 'unidades' || campo === 'nivel'
  return ordenarPorClave(lista, claves[campo], sentido, numerico ? compararPlano : TEXTO.compare)
}
