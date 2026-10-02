import Logo from '../../../components/Logo'
import SelectorTema from '../../../components/SelectorTema'
import { ChevronLeft, ChevronRight } from '../../../components/icons'

/**
 * RAIL DE ÍCONOS OSCURO del escritorio (02/10/2026, bloque C7; decisión 9 del dueño, hoja
 * "SupervisionEscritorio" de la v3 y brief v2 §1.7 / §3 módulo 3).
 *
 * Reemplaza al sidebar de 232 px siempre abierto de `SupervisionDesktop`, que le quitaba ancho al
 * mapa. Dos niveles: el rail lleva los DESTINOS (Mapa · Dashboard · Gestión) y el panel contextual
 * de Gestión (la lista agrupada) se abre al lado solo dentro de Gestión — ese panel lo monta el
 * padre, no este componente.
 *
 * - 72 px contraído (ícono + rótulo corto debajo) o 208 px expandido (ícono + rótulo de costado).
 *   El padre decide y persiste; acá solo se pinta.
 * - Fondo `--console-bg` en los dos temas; tintas `--rail-fg`/`--rail-on`/`--rail-acento`, que son
 *   alias de colores existentes (index.css). Ningún hex nuevo.
 * - Activo = `aria-current="page"` + placa clara (pseudo-elemento de ui.css) + rótulo en 600 + ícono
 *   en el acento: nunca solo color.
 * - Cada botón mide ≥ 44 (el escritorio también corre en una tablet). Contraído, el rótulo visible
 *   es corto y el `title` hace de tooltip.
 * - Abajo, el selector de tema en íconos (vertical contraído) y el botón de expandir/contraer.
 *
 * Props:
 *   - destinos    [{ k, etiqueta, Icono, activo, badge, badgeAria, expandido, onClick }]
 *                 `badge`: número (0/null = sin badge). `badgeAria`: cómo se lee ("3 avisos abiertos").
 *                 `expandido`: bool o undefined; si viene, el botón lleva `aria-expanded` (Gestión
 *                 abre/cierra su panel). `controla`: id del panel que abre (`aria-controls`), solo
 *                 cuando ese panel está en el DOM.
 *   - abierto     bool: rail expandido
 *   - onAlternar  () => void, o null para no dibujar el botón (en el drawer no tiene sentido)
 *   - navRef      ref al <nav> (el drawer le pasa el foco al abrir)
 *   - style
 */
export default function RailEscritorio({ destinos, abierto = false, onAlternar = null, navRef, style }) {
  return (
    <nav
      ref={navRef}
      tabIndex={-1}
      aria-label="Principal"
      className="lu-rail"
      style={{
        flex: 'none', width: abierto ? 208 : 72, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 6px',
        background: 'var(--console-bg)', color: 'var(--rail-fg)', borderRight: '1px solid var(--line)',
        overflowY: 'auto', outline: 'none',
        ...style,
      }}
    >
      {/* Marca */}
      <div style={{ flex: 'none', minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: abierto ? 'flex-start' : 'center', gap: 10, padding: abierto ? '0 8px' : 0 }}>
        <Logo size={40} radius={12} />
        {abierto && <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--rail-on)' }}>DisT-At</span>}
      </div>
      <div className="lu-rail-sep" style={{ margin: '4px 6px 6px' }} />

      {destinos.map((d) => (
        <BotonRail key={d.k} d={d} abierto={abierto} />
      ))}

      <div style={{ marginTop: 'auto', paddingTop: 12, display: 'flex', flexDirection: 'column', alignItems: abierto ? 'stretch' : 'center', gap: 8 }}>
        <div style={{ alignSelf: 'center' }}>
          <SelectorTema variante="iconos" vertical={!abierto} enConsola />
        </div>
        {onAlternar && (
          <button
            type="button"
            className="lu-rail-btn"
            onClick={onAlternar}
            aria-expanded={abierto}
            aria-label={abierto ? 'Contraer el menú' : 'Expandir el menú'}
            title={abierto ? 'Contraer' : 'Expandir'}
            style={{ alignSelf: 'stretch', minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: abierto ? 'flex-start' : 'center', gap: 10, padding: abierto ? '0 12px' : 0, border: 0, borderRadius: 12, background: 'transparent', color: 'var(--rail-fg)', fontFamily: 'inherit', cursor: 'pointer' }}
          >
            <span aria-hidden="true" style={{ display: 'grid' }}>
              {abierto ? <ChevronLeft size={20} /> : <ChevronRight size={20} color="currentColor" />}
            </span>
            {abierto && <span style={{ fontSize: 13, fontWeight: 500 }}>Contraer</span>}
          </button>
        )}
      </div>
    </nav>
  )
}

function BotonRail({ d, abierto }) {
  const { etiqueta, Icono, activo, badge, badgeAria, expandido, controla, onClick } = d
  const hayBadge = !!badge
  const textoBadge = badge > 99 ? '99+' : String(badge)
  return (
    <button
      type="button"
      className="lu-rail-btn"
      onClick={onClick}
      aria-current={activo ? 'page' : undefined}
      aria-expanded={expandido === undefined ? undefined : expandido}
      aria-controls={controla}
      // El badge se lee en el nombre: el número solo, sin contexto, no dice nada.
      aria-label={hayBadge ? `${etiqueta}, ${badgeAria || textoBadge}` : undefined}
      title={abierto ? undefined : etiqueta}
      style={{
        flex: 'none', position: 'relative', boxSizing: 'border-box', width: '100%',
        minHeight: abierto ? 48 : 56, borderRadius: 12, border: 0, background: 'transparent',
        display: 'flex', flexDirection: abierto ? 'row' : 'column', alignItems: 'center',
        justifyContent: abierto ? 'flex-start' : 'center', gap: abierto ? 12 : 4,
        padding: abierto ? '6px 12px' : '7px 2px 6px',
        color: activo ? 'var(--rail-on)' : 'var(--rail-fg)', fontFamily: 'inherit', cursor: 'pointer',
        textAlign: abierto ? 'left' : 'center',
      }}
    >
      <span aria-hidden="true" style={{ display: 'grid', color: activo ? 'var(--rail-acento)' : 'inherit' }}>
        <Icono size={22} />
      </span>
      <span style={{ flex: abierto ? 1 : 'none', fontSize: abierto ? 14 : 11, fontWeight: activo ? 600 : 500, lineHeight: 1.2, whiteSpace: 'nowrap' }}>{etiqueta}</span>
      {hayBadge && (
        <span
          aria-hidden="true"
          style={{
            position: abierto ? 'static' : 'absolute', top: 3, right: 6,
            minWidth: 18, height: 18, padding: '0 5px', boxSizing: 'border-box', borderRadius: 99,
            display: 'grid', placeItems: 'center',
            background: 'var(--rail-fg)', color: 'var(--console-bg)',
            fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, lineHeight: 1,
          }}
        >
          {textoBadge}
        </span>
      )}
    </button>
  )
}
