import { useEffect, useState } from 'react'

/**
 * Contador "hace Xs" que se refresca solo, sin arrastrar a nadie más.
 *
 * 19/07/2026 — POR QUÉ EXISTE. SupervisionMovil tenía un `setInterval` de 1 s que
 * hacía `tick(n => n + 1)` sobre el estado del componente raíz, solo para que dos
 * etiquetas "hace Xs" quedaran al día. Como no hay `React.memo` en ningún hijo, ese
 * tick re-renderizaba TODO una vez por segundo: header, rail de 7 botones, bottom-nav
 * y el bottom-sheet entero con la lista de móviles. En un Android de gama baja eso
 * compite por el main thread justo cuando el sheet intenta animar: la animación CSS
 * corre en el compositor, pero el sheet no arranca a tiempo y se percibe como un
 * salto. Y durante el dashboard había DOS intervalos pisándose, porque EstadoEquipo
 * tiene el suyo y vive adentro del sheet.
 *
 * Acá el intervalo queda encerrado en el nodo de texto que realmente cambia.
 *
 * ⚠️ No volver a subir el tick al padre "porque es más simple". Ese es el bug.
 *
 * props: { ts } — epoch ms de la última señal
 */
export default function HaceSegundos({ ts }) {
  const [, tick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  return <>hace {Math.max(0, Math.round((Date.now() - ts) / 1000))}s</>
}
