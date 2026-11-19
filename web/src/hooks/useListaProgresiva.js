import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * DIBUJAR DE A POCO (19/11/2026, plan 50). Una lista de miles de filas no se dibuja entera: con 30
 * días de Pedidos (4 519) la pantalla quedaba congelada al abrir y con cada letra del buscador.
 * Se dibujan las primeras `inicial` y se suman `paso` más cuando el centinela (un div al final de la
 * lista) entra en vista. `IntersectionObserver` con root nulo mira contra la ventana recortada por los
 * contenedores con scroll, así que sirve también adentro de una hoja (`Overlay`). Por si el
 * observador no dispara (documento oculto, WebView vieja) va el botón "Mostrar N más".
 *
 * Cuando cambia la lista de origen (otro filtro, otra búsqueda) vuelve a `inicial`: lo nuevo se
 * mira desde arriba. Una lista que sólo crece (carga progresiva) conserva lo ya mostrado.
 *
 * @param {any[]} lista
 * @param {{ inicial?: number, paso?: number, clave?: any }} o  `clave`: cambiarla vuelve a `inicial`
 * @returns {{ visibles: any[], hayMas: boolean, faltan: number, mostrarMas: () => void, centinelaRef: Function }}
 */
export default function useListaProgresiva(lista, { inicial = 60, paso = 100, clave } = {}) {
  const [limite, setLimite] = useState(inicial)
  const [claveVista, setClaveVista] = useState(clave)
  // Ajuste durante el render (patrón recomendado por React para "resetear al cambiar una prop"):
  // sin un efecto, no se pinta ni un cuadro con el límite viejo.
  if (claveVista !== clave) {
    setClaveVista(clave)
    setLimite(inicial)
  }

  const total = lista?.length || 0
  const hayMas = limite < total
  const mostrarMas = useCallback(() => setLimite((l) => l + paso), [paso])

  const obs = useRef(null)
  // Depende de `limite` a propósito: si después de sumar filas el centinela SIGUE a la vista (pantalla
  // alta, filas bajitas), el observador no vuelve a avisar porque su estado no cambió. Con una ref
  // nueva por límite, React lo desconecta y lo vuelve a observar, y el primer aviso llega de nuevo.
  const centinelaRef = useCallback((nodo) => {
    obs.current?.disconnect()
    obs.current = null
    if (!nodo || typeof IntersectionObserver === 'undefined') return
    obs.current = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) mostrarMas()
    }, { rootMargin: '600px 0px' })
    obs.current.observe(nodo)
  }, [mostrarMas, limite]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => obs.current?.disconnect(), [])

  return {
    visibles: hayMas ? lista.slice(0, limite) : (lista || []),
    hayMas,
    faltan: Math.max(0, total - limite),
    mostrarMas,
    centinelaRef,
  }
}
