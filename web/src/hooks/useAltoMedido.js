import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * EL ALTO REAL DE UN ELEMENTO, en píxeles, y actualizado cuando cambia.
 *
 * 🩸 POR QUÉ EXISTE (20/08/2026). La barra del pedido del vendedor se posicionaba con
 * `bottom: calc(80px + env(safe-area-inset-bottom,0px))`, donde el 80 era una ESTIMACIÓN del alto
 * de la botonera Inicio · Ruta · Catálogo. En el Motorola del dueño `env(safe-area-inset-bottom)`
 * resuelve a ~0 y la botonera mide un poco más de 80, así que el botón "Confirmar pedido y
 * finalizar visita" quedaba tapado por ella. Se reportó dos veces, con captura.
 *
 * El problema de fondo no es que el número esté mal: es que **es un número**. La botonera crece con
 * la barra de gestos, con el tamaño de fuente del sistema y con el idioma (una etiqueta que pasa a
 * dos renglones sube el alto). Cualquier constante que se elija hoy vuelve a estar mal en el
 * próximo teléfono. La única versión que no se rompe es medir.
 *
 * El valor se publica como variable CSS en un contenedor y lo consumen los flotantes con
 * `bottom: calc(var(--nav-h, 80px) + 12px)`. **El default del `var()` no es decorativo**: cubre el
 * primer frame —antes de que el observer haya medido— y cualquier navegador sin `ResizeObserver`.
 *
 * ⚠️ NO usa `rAF` para nada. `requestAnimationFrame` no corre con el documento oculto (regla 35),
 * y una medición que solo ocurre con la pestaña visible dejaría los flotantes en el default para
 * siempre en el caso que importa.
 */
export function useAltoMedido() {
  const [alto, setAlto] = useState(0)
  const nodo = useRef(null)
  const obs = useRef(null)

  // Callback ref y no `useRef` + `useEffect`: el nodo puede aparecer y desaparecer con un render
  // condicional (la barra del pedido solo existe con el carrito lleno), y un efecto con `[]` se
  // lo perdería. Así se engancha exactamente cuando el nodo entra al DOM.
  const ref = useCallback((el) => {
    if (obs.current) { obs.current.disconnect(); obs.current = null }
    nodo.current = el
    if (!el) { setAlto(0); return }
    setAlto(el.offsetHeight || 0)
    if (typeof ResizeObserver === 'undefined') return
    obs.current = new ResizeObserver(() => {
      // `offsetHeight` y no el `contentRect` del observer: el segundo NO incluye padding ni borde
      // con `box-sizing: content-box`, y esta botonera tiene padding abajo por la safe-area — que
      // es justamente la parte que hay que despejar.
      const h = nodo.current?.offsetHeight || 0
      setAlto((prev) => (prev === h ? prev : h))
    })
    obs.current.observe(el)
  }, [])

  useEffect(() => () => { if (obs.current) obs.current.disconnect() }, [])

  return [ref, alto]
}
