import { forwardRef } from 'react'

/**
 * Isotipo DisT-At en VECTOR (la "D" con la X, el pin y los dos puntos turquesa).
 *
 * Convive con `Logo.jsx` y no lo reemplaza: `Logo` sirve el `logo.png` y es el que va en los
 * headers, donde alcanza y pesa menos. Este existe porque el PNG **no se puede dibujar trazo a
 * trazo**, y la animación de arranque (SplashIntro) necesita exactamente eso.
 *
 * Los `data-id` van SIEMPRE, incluso cuando el isotipo se usa quieto: son los que engancha
 * SplashIntro para animar cada pieza por separado. Dejarlos puestos cuesta nada y evita tener
 * dos copias de la marca que se desincronicen — que es justo lo que pasó con `GESTION_ITEMS`.
 *
 * Geometría del handoff v1.4 del diseñador (28/07/2026). Ojo con las diagonales: NO son dos
 * líneas de esquina a esquina. Es una diagonal completa (arriba-izq → abajo-der) más una media
 * que sale del centro hacia abajo a la izquierda. Así es el logo de verdad.
 */
const Isotipo = forwardRef(function Isotipo({ size = 44, style, ...resto }, ref) {
  return (
    <svg
      ref={ref}
      viewBox="0 0 100 100"
      style={{ width: size, height: size, overflow: 'visible', display: 'block', ...style }}
      aria-label="DisT-At"
      {...resto}
    >
      <g data-halo="1" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path data-id="p-vert" d="M30.8 38 L30.8 72.8" />
        <path data-id="p-curva" d="M30 27 L51 27 C63.5 27 72.4 37 72.4 50 C72.4 63 63.5 72.8 51 72.8 L30.8 72.8" />
        <path data-id="p-diag1" d="M30 27 L64 65" />
        <path data-id="p-diag2" d="M50 49.3 L32 71" />
        <path data-id="p-pin" d="M50 49.3 C50.6 45.4 52.2 41.8 54.6 39.6 C57.6 36.9 61.9 38 62.9 41.4 C63.9 45 61.2 47.7 57.1 48.5 C54.3 49 51.8 49.2 50 49.3 Z" />
        <circle data-punto="1" cx="50" cy="49.3" r="2.6" fill="#2DD4CE" stroke="none" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
        <circle data-punto="1" cx="58.4" cy="41.6" r="3" fill="#2DD4CE" stroke="none" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
      </g>
    </svg>
  )
})

export default Isotipo
