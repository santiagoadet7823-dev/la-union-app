/**
 * Colores de los gráficos del dashboard. Dos familias, dos reglas:
 *
 * 1. IDENTIDAD DE PERSONA → `colorPorId` de `lib/colors.js`, siempre. Es el mismo color que la
 *    persona tiene en el mapa, en su burbuja y en su trazo: un vendedor no cambia de color por
 *    pasar de una pantalla a otra, y el superadmin puede fijarlo a mano. Acá no se decide nada.
 *
 * 2. CATEGORÍAS SIN IDENTIDAD PREVIA (rubros del catálogo, marcas, estados de pedido) → esta
 *    lista, en ORDEN FIJO por posición, nunca por hash ni cíclica: la porción más grande de la
 *    torta lleva siempre el slot 1, la segunda el 2, y pasadas 6 porciones el resto se pliega en
 *    "Otros" (gris). Validada el 16/09/2026 con el validador de `dataviz` contra las dos
 *    superficies de ESE día (`--surface` claro #ffffff y oscuro #0d1f1e): banda de luminosidad,
 *    piso de croma, separación para daltonismo (protan/deutan/tritan) y piso de visión normal,
 *    todo PASS. En claro tres slots quedan bajo 3:1 de contraste con el fondo, y por eso la dona
 *    lleva SIEMPRE leyenda con etiqueta y valor al lado — la identidad nunca es color solo.
 *
 *    ⚠️ Las superficies cambiaron el 29/09/2026 (paleta nueva: `--surface` claro #FCFBF8 y oscuro
 *    #232327) y el validador NO se volvió a correr (Tarea 7, paso 5: pendiente). Solo se midió el
 *    contraste contra el fondo con `_interno/diseno/contraste`: en oscuro los seis slots quedan
 *    entre 3.97 y 5.66:1 y en claro siguen los mismos tres bajo 3:1. Faltan la banda de
 *    luminosidad y la separación para daltonismo. Los valores de `CATEGORICAS` no se tocaron.
 *
 * Los ESTADOS de pedido no son categorías arbitrarias: tienen semántica y usan los tokens de
 * estado de la app (`--success`, `--info`, `--warning`, `--danger`), ver `colorEstadoPedido`.
 */
export const CATEGORICAS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'],
  dark:  ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'],
}

export const MAX_PORCIONES = 6

export function colorCategoria(i, isDark) {
  const lista = isDark ? CATEGORICAS.dark : CATEGORICAS.light
  return lista[i] || null // null = "Otros": lo pinta el componente con --faint
}

/** Estado de pedido → token CSS. Mismo criterio que las pills de la lista de pedidos. */
export function colorEstadoPedido(estado) {
  switch (estado) {
    case 'Entregado':    return 'var(--success)'
    case 'En camino':    return 'var(--info)'
    case 'Pendiente':    return 'var(--primary)'
    case 'No entregado': return 'var(--warning)'
    case 'Anulado':      return 'var(--danger)'
    default:             return 'var(--faint)'
  }
}
