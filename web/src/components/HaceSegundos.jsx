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
  const seg = Math.max(0, Math.round((Date.now() - ts) / 1000))

  // 28/07/2026 — El intervalo se adapta a la antigüedad. Un móvil que reportó hace 4 horas no
  // necesita refrescarse cada segundo: el número no cambia de forma perceptible y cada burbuja
  // del equipo tiene su propio contador. Bajo el minuto, donde el segundo SÍ se ve, sigue a 1 s.
  const cada = seg < 60 ? 1000 : 30000
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), cada)
    return () => clearInterval(t)
  }, [cada])

  return <>hace {humano(seg)}</>
}

/**
 * "45s" · "12 min" · "4 h" · "3 d".
 *
 * Antes esto era siempre segundos crudos, y estaba bien mientras solo lo usaban dos etiquetas de
 * móviles activos. Al llevarlo a las burbujas del equipo apareció el problema: `ultimas_posiciones`
 * siembra la ÚLTIMA posición conocida de cada persona sin corte de tiempo (a propósito, para que
 * quien cerró la app no desaparezca del mapa), así que se leían cosas como "hace 643219s".
 * Ese número no es un dato: es ruido con forma de dato.
 */
function humano(seg) {
  if (seg < 60) return seg + 's'
  const min = Math.round(seg / 60)
  if (min < 60) return min + ' min'
  const h = Math.round(min / 60)
  if (h < 24) return h + ' h'
  return Math.round(h / 24) + ' d'
}
