import { isNative } from '../platform'

/**
 * IMPRIMIR UN NODO DE LA PANTALLA COMO PDF.
 *
 * 🩸 SE EXTRAJO ACÁ EL 19/08/2026, al aparecer el segundo imprimible (el ticket del pedido). Todo
 * esto vivía dentro de `features/reportes/exportarInforme.js` con el id `lu-informe` escrito a
 * mano en tres lugares y en la hoja `@media print`. Copiarlo para el ticket habría sido la regla 31
 * otra vez: dos mecanismos de impresión que divergen, y el que se olvide de arreglar los DOS gana
 * un PDF en blanco. El informe sigue funcionando exactamente igual; solo cambió de dónde sale.
 *
 * 🩸 POR QUÉ IMPRIMIR Y NO GENERAR CON UNA LIBRERÍA. La alternativa evidente era `jsPDF`, y se
 * descartó por dos motivos, en este orden:
 *
 *  1. No sabe nada de la pantalla. Genera el PDF dibujando de cero, así que cada cosa habría que
 *     escribirla DOS veces —una en React y otra en coordenadas de papel— y esas dos copias
 *     divergen a la primera corrección. Lo impreso tiene que SER lo de la pantalla, no una
 *     reconstrucción parecida.
 *  2. Son ~350 KB de bundle para algo que el navegador ya trae.
 *
 * 🔴 EL NODO SE MUEVE A `<body>`, Y NO ES OPCIONAL. La hoja de impresión oculta todo lo que no sea
 * el imprimible con `body > *:not(.lu-imprimible)`, un selector que da por sentado que el nodo es
 * hijo directo de `<body>`. No lo es: React monta en `#root`, así que la cadena real es
 * `.lu-imprimible < main < div < div < #root`. El único hijo de `<body>` es `#root` —que no es el
 * imprimible— así que la regla lo ocultaba ENTERO, con el informe adentro. Medido en el navegador
 * cuando pasó (1.12.0): el informe pasaba de 900×458 a **0×0** y la página quedaba con 0
 * caracteres. El selector no se arregló: se hizo verdad su premisa.
 *
 * `:not(:has(.lu-imprimible))` sería lo elegante, pero `:has()` llegó en Chrome 105 y este parque
 * tiene teléfonos bastante más viejos que eso.
 */

/** Cuelga el nodo de `<body>` y devuelve cómo restituirlo exactamente donde estaba. */
export function moverABody(id) {
  const el = document.getElementById(id)
  if (!el || el.parentNode === document.body) return () => {}
  // Un comentario de marca en vez de recordar el padre: si el árbol de React se re-renderizó
  // mientras tanto, la marca sigue en la posición correcta y el nodo vuelve a su lugar exacto.
  const marca = document.createComment(id)
  el.parentNode.insertBefore(marca, el)
  document.body.appendChild(el)
  return () => { if (marca.parentNode) marca.parentNode.replaceChild(el, marca) }
}

/**
 * Deja un nodo listo para imprimirse venga la orden de donde venga.
 *
 * Se engancha a `beforeprint`/`afterprint` y no solo al botón porque **Ctrl+P es la otra mitad del
 * caso**: quien tiene algo en pantalla lo imprime con el atajo del navegador tanto como con el
 * botón, y por ese camino no pasa la función de imprimir. Un arreglo que solo cubriera el botón
 * dejaría el PDF en blanco la mitad de las veces.
 *
 * Devuelve la función de limpieza: la monta la vista mientras está viva, así los listeners no
 * quedan dando vueltas en pantallas donde el nodo ni existe.
 */
export function montarImpresion(id) {
  let restaurar = () => {}
  const antes = () => { restaurar = moverABody(id) }
  const despues = () => { restaurar(); restaurar = () => {} }
  window.addEventListener('beforeprint', antes)
  window.addEventListener('afterprint', despues)
  return () => {
    window.removeEventListener('beforeprint', antes)
    window.removeEventListener('afterprint', despues)
    restaurar()
  }
}

/**
 * Imprime el nodo. En web va por `window.print()`; en la APK no hay diálogo de impresión en el
 * WebView, así que va por el plugin nativo `Impresion` (PrintManager + createPrintDocumentAdapter),
 * que produce el PDF con el MISMO renderizado del WebView y lo entrega a la hoja de compartir.
 */
export async function imprimirNodo(id, titulo) {
  if (!isNative()) {
    // El nodo lo mueve el listener de `beforeprint` (ver `montarImpresion`), que además cubre el
    // Ctrl+P del navegador. Acá no hace falta tocar nada.
    window.print()
    return
  }
  // En la APK sí hay que moverlo a mano: `PrintManager` renderiza el WebView con media `print`,
  // pero NO dispara `beforeprint` — es una API de Android, no del documento. Si esto se sacara, el
  // PDF nativo volvería a salir en blanco aunque el de la web funcione.
  const restaurar = moverABody(id)
  try {
    const { registerPlugin } = await import('@capacitor/core')
    const Impresion = registerPlugin('Impresion')
    await Impresion.imprimir({ titulo })
  } catch (e) {
    // Flota MIXTA: un APK anterior al plugin recibe este JS por OTA y no tiene con qué imprimir.
    // Se cae a un aviso — un botón que no hace nada y no dice nada es peor que uno que falla.
    console.warn('[imprimir] sin plugin de impresión nativo', e)
    alert('Este teléfono todavía no puede generar el PDF. Actualizá la app.')
  } finally {
    // En `finally` y no después del `await`: si el plugin falla, el nodo tiene que volver a su
    // lugar igual. Si no, la pantalla queda rota hasta recargar y el error se ve como dos bugs.
    restaurar()
  }
}

/**
 * COMPARTIR EL NODO COMO PDF (mandárselo a alguien, no imprimirlo).
 *
 * 🩸 POR QUÉ NO ALCANZABA CON `imprimirNodo` (03/09/2026, pedido del cliente). El diálogo de Android
 * ofrece "Guardar como PDF", así que técnicamente ya se podía. Pero el caso de uso no es guardar: el
 * vendedor tiene al comerciante enfrente pidiéndole el comprobante, y por ese camino son cinco pasos
 * y dos aplicaciones. El método nativo `compartirPdf` escribe el PDF y abre la hoja de compartir de
 * una.
 *
 * 🔴 FLOTA MIXTA, Y ACÁ IMPORTA MÁS QUE NUNCA. `compartirPdf` es código NATIVO: viaja sólo en un APK
 * nuevo, nunca por OTA. Los teléfonos que reciban este JS con el APK viejo tienen el plugin
 * `Impresion` pero NO este método, y Capacitor rechaza la llamada. La caída no es un cartel de
 * error: es `imprimirNodo`, que en esos equipos sigue haciendo exactamente lo que hacía. Peor UX,
 * pero el vendedor igual saca su PDF — que es lo que vino a hacer.
 *
 * En WEB no hay a dónde compartir un blob que el navegador no generó: `window.print()` con destino
 * "Guardar como PDF" es el camino, y es el que ya usa el informe.
 *
 * @param {string} id      el id del nodo imprimible
 * @param {string} titulo  título del documento (Android lo usa de asunto)
 * @param {string} archivo nombre sugerido, sin extensión
 */
export async function compartirPdfNodo(id, titulo, archivo) {
  if (!isNative()) {
    await imprimirNodo(id, titulo)
    return
  }
  // Igual que en `imprimirNodo`: `PrintManager` renderiza con media `print` pero NO dispara
  // `beforeprint`, así que el nodo se mueve a mano o el PDF sale en blanco.
  const restaurar = moverABody(id)
  try {
    const { registerPlugin } = await import('@capacitor/core')
    const Impresion = registerPlugin('Impresion')
    await Impresion.compartirPdf({ titulo, archivo: archivo || titulo })
  } catch (e) {
    console.warn('[imprimir] sin compartirPdf nativo, se cae a imprimir', e)
    // Se reintenta con el nodo TODAVÍA colgado de `<body>`, y está bien: el `moverABody` de
    // `imprimirNodo` ve que ya es hijo de body y devuelve un no-op, así que la marca de posición
    // sigue siendo la nuestra y el `finally` de acá abajo lo devuelve a su lugar una sola vez.
    await imprimirNodo(id, titulo)
  } finally {
    restaurar()
  }
}
