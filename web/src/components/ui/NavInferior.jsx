import { sx } from '../../lib/sx'
import { glassBlur } from '../../lib/glass'
import { useTecladoAbierto } from '../../hooks/useTecladoAbierto'
import { pintarIcono } from './icono'

/**
 * BARRA DE NAVEGACIÓN INFERIOR DEL CELULAR (01/10/2026). Brief v2 §4.1, §4.5, §4.6 y hoja
 * "Cuenta y Navegación" (3a-3f): Resumen · Mapa · Gestión, Mapa · Equipo · Dashboard · Gestión,
 * Inicio · Ruta · Catálogo, y las pestañas de Marketing.
 *
 * Hoy hay cuatro copias (`NavBtn` de SupervisionMovil y de MarketingView, la botonera de
 * VendedorView, la de la galería); dos son `<div onClick>` sin foco ni rol. Esta es la única.
 *
 * Cómo se ve la pestaña activa, sin depender del color (con el acento azul acero, ícono activo
 * contra inactivo da ~1,1:1): píldora de tinte detrás del ícono + indicador de 2 px arriba +
 * rótulo en 600 y en `--text`. Además `aria-current="page"`.
 *
 * Medidas: cada botón ≥ 56 px de alto (`--nav-alto`, 3,5 rem) y nunca menos de 44 de ancho; la
 * barra suma abajo el área segura (`--safe-bottom`, o `env()` mientras ese token no exista). El
 * ícono va en px fijos (22): con letra al 200 % no tiene que crecer a 44 y empujar el rótulo.
 * El rótulo es 11 px con tope de 12 (§4.5 regla 5, excepción documentada a WCAG 1.4.4: con letra
 * grande "Dashboard" a 22 px no entra en 90 px, y partir la palabra sería peor; el ícono y el
 * `aria-label` sostienen la función).
 *
 * Con el teclado abierto la barra NO se dibuja (`display:none`, ver useTecladoAbierto): así el
 * contenido recupera ese alto y, si la pantalla mide la barra con `useAltoMedido`, el alto medido
 * pasa a 0 solo. `oculta` es otra cosa: el modo inmersivo del catálogo, que la desliza hacia
 * abajo sin desmontarla (para animar la vuelta) y la saca del recorrido del teclado.
 *
 * Posición: la barra no se posiciona sola. Va en el flujo (última hija de una columna flex) o el
 * consumidor le pasa `style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex:
 * 'var(--z-chrome)' }}`. Acepta `ref` (React 19) para medirla con `useAltoMedido`.
 *
 * Props:
 *   - items       [{ k, etiqueta, icono, contador? }] — de 3 a 4 (§4.1: máximo 4 destinos).
 *                 `icono`: componente de icons.jsx o elemento. `contador`: número > 0 en un
 *                 círculo NEUTRO (--text); el rojo queda para lo crítico.
 *   - activo      la `k` de la pestaña actual
 *   - onCambiar   (k) => void
 *   - ariaLabel   ('Principal')
 *   - sobreMapa   bool: fondo de vidrio (solo si hay un mapa detrás; §2.5, presupuesto de 2
 *                 capas con desenfoque por pantalla). Si no, `--surface` plano con borde.
 *   - oculta      bool: modo inmersivo (se desliza fuera de la pantalla)
 *   - ref, style
 */
export default function NavInferior({ items, activo, onCambiar, ariaLabel = 'Principal', sobreMapa = false, oculta = false, ref, style }) {
  const teclado = useTecladoAbierto()
  const n = items?.length || 1

  return (
    <nav
      ref={ref}
      aria-label={ariaLabel}
      aria-hidden={oculta || undefined}
      style={{
        ...sx('flex:none;display:grid;border-top-width:1px;border-top-style:solid'),
        gridTemplateColumns: `repeat(${n}, minmax(2.75rem, 1fr))`,
        paddingBottom: 'var(--safe-bottom, env(safe-area-inset-bottom, 0px))',
        ...(sobreMapa ? { background: 'var(--glass-bg)', ...glassBlur, borderTopColor: 'var(--glass-brd)' } : { background: 'var(--surface)', borderTopColor: 'var(--line)' }),
        ...(teclado ? { display: 'none' } : null),
        transform: oculta ? 'translateY(100%)' : undefined,
        visibility: oculta ? 'hidden' : undefined,
        transition: 'transform 200ms cubic-bezier(0.23, 1, 0.32, 1), visibility 200ms',
        ...style,
      }}
    >
      {(items || []).map((it) => {
        const on = it.k === activo
        const cuenta = Number(it.contador) > 0 ? it.contador : null
        return (
          <button
            key={it.k}
            type="button"
            className="lu-nav-btn"
            aria-current={on ? 'page' : undefined}
            aria-label={cuenta ? `${it.etiqueta}, ${cuenta}` : undefined}
            onClick={() => onCambiar?.(it.k)}
            style={{
              ...sx('min-width:2.75rem;min-height:var(--nav-alto, 3.5rem);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;padding:4px 2px;margin:0;border-width:2px 0 0;border-style:solid;background:transparent;font-family:inherit;text-align:center;cursor:pointer;-webkit-tap-highlight-color:transparent'),
              borderTopColor: on ? 'var(--primary)' : 'transparent',
              color: on ? 'var(--text)' : 'var(--muted)',
            }}
          >
            <span
              className="lu-nav-pildora"
              aria-hidden="true"
              style={{
                ...sx('position:relative;width:52px;height:28px;border-radius:var(--r-pill);display:grid;place-items:center'),
                background: on ? 'var(--primary-tint)' : 'transparent',
                color: on ? 'var(--primary)' : 'var(--muted)',
              }}
            >
              {pintarIcono(it.icono, 22)}
              {cuenta && (
                <span style={sx('position:absolute;top:-3px;right:4px;min-width:18px;height:18px;padding:0 4px;border-radius:var(--r-pill);background:var(--text);color:var(--surface);border:2px solid var(--surface);font-family:var(--font-mono);font-size:11px;font-weight:600;line-height:1;display:grid;place-items:center')}>
                  {cuenta}
                </span>
              )}
            </span>
            <span style={{ ...sx('font-size:clamp(11px, 0.6875rem, 12px);line-height:1.2;white-space:nowrap;max-width:100%;overflow:hidden'), fontWeight: on ? 600 : 500 }}>
              {it.etiqueta}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
