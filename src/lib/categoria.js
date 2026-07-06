/**
 * Infiere una categoría a partir de la descripción del producto.
 * productos.csv no trae columna de categoría; esto agrupa el catálogo
 * sin pedirle al usuario que edite el CSV para agregarla.
 */
const REGLAS = [
  { categoria: 'Bebidas', patron: /gaseosa|agua|jugo|cerveza|vino|energizante|sod[aá]/i },
  { categoria: 'Almacén', patron: /harina|az[uú]car|aceite|arroz|fideos|yerba|tomate|sal fina|mayonesa|mostaza/i },
  { categoria: 'Lácteos', patron: /leche|manteca|queso|yogurt|dulce de leche/i },
  { categoria: 'Galletitas y snacks', patron: /galletitas|bizcochitos/i },
  { categoria: 'Limpieza', patron: /lavandina|detergente|jab[oó]n l[ií]quido|suavizante|desodorante de ambientes|limpiador|bolsas de consorcio/i },
  { categoria: 'Higiene personal', patron: /jab[oó]n de tocador|shampoo|acondicionador|crema dental|rollo de cocina|papel higi[eé]nico/i },
]

export function inferCategoria(descripcion = '') {
  const match = REGLAS.find((r) => r.patron.test(descripcion))
  return match ? match.categoria : 'Otros'
}

export const ORDEN_CATEGORIAS = [
  'Bebidas',
  'Almacén',
  'Lácteos',
  'Galletitas y snacks',
  'Limpieza',
  'Higiene personal',
  'Otros',
]
