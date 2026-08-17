import { glassBlur } from '../lib/glass'

/**
 * Botón "ver el mapa a pantalla completa / volver".
 *
 * Es UN solo botón que alterna, no dos: el usuario aprende un lugar y una posición, y el ícono le
 * dice en qué estado está. Ponerlo a entrar en una esquina y a salir en otra obliga a buscarlo
 * justo cuando la pantalla acaba de cambiar entera.
 *
 * Vive en `components/` y no dentro de una de las supervisiones porque lo usan las dos, y
 * `SupervisionMovil` y `SupervisionDesktop` no comparten una línea de código (divergencia
 * documentada en dwells.js:4-8: lo que las dos tienen que mostrar IGUAL va afuera).
 *
 * props: { activo, onToggle, style }
 */
export default function BtnInmersivo({ activo, onToggle, style }) {
  return (
    <button
      onClick={onToggle}
      className="lu-press"
      aria-pressed={activo}
      aria-label={activo ? 'Salir de pantalla completa' : 'Ver el mapa en pantalla completa'}
      title={activo ? 'Salir de pantalla completa' : 'Ver el mapa en pantalla completa'}
      style={{
        width: 44,
        height: 44,
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--r-md)',
        cursor: 'pointer',
        color: 'var(--text)',
        background: 'var(--glass-bg)',
        ...glassBlur,
        border: '0.5px solid var(--glass-brd)',
        boxShadow: 'var(--shadow-lg)',
        ...style,
      }}
    >
      {activo ? (
        // Flechas hacia adentro = "contraer".
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
        </svg>
      ) : (
        // Flechas hacia afuera = "expandir".
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
        </svg>
      )}
    </button>
  )
}
