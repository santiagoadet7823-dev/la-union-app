
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
 * `queExpande` nombra lo que se agranda ("el mapa", "el catálogo"). Tiene default para no tocar a
 * los tres consumidores que ya existían, todos de mapa.
 *
 * props: { activo, onToggle, style, queExpande }
 */
export default function BtnInmersivo({ activo, onToggle, style, queExpande = 'el mapa' }) {
  const etiqueta = activo ? 'Salir de pantalla completa' : `Ver ${queExpande} en pantalla completa`
  return (
    <button
      onClick={onToggle}
      className="lu-press"
      aria-pressed={activo}
      aria-label={etiqueta}
      title={etiqueta}
      style={{
        width: 44,
        height: 44,
        flex: 'none',
        display: 'grid',
        placeItems: 'center',
        borderRadius: 'var(--r-md)',
        cursor: 'pointer',
        color: 'var(--text)',
        // Plano (01/10/2026), como los demás botones del rail: el vidrio de la pantalla del mapa lo
        // gasta el header (presupuesto de 2 capas, brief v2 §2.5). Ver RailBtn en RailMapa.
        padding: 0,
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        boxShadow: 'var(--shadow)',
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
