import { sx } from '../../lib/sx'
import { Check } from '../icons'

/**
 * CONTADOR CON PUNTO DE ESTADO (01/10/2026). Decisión 14 del dueño: "número en tinta con punto
 * de estado". Hoja "Marketing" (8a celular, 8c escritorio).
 *
 * Antes eran cinco números de cinco colores (`Contador` de MarketingView): el color cargaba el
 * significado y además pintaba de rojo y ocre el número entero. Ahora el número va en `--text`
 * (mono, tabular) y el estado lo lleva un punto de 6 px junto al número o al rótulo, que además
 * dice en palabras qué cuenta. El punto es un refuerzo, no la señal.
 *
 * Dos formas:
 *   - 'compacto' (celular): punto + número arriba, rótulo corto abajo. Va dentro de
 *     `TiraContadores`, que los pone en una fila con divisores (los cinco entran en 360 px).
 *   - 'tarjeta' (escritorio): punto + rótulo arriba, número grande abajo, tarjeta propia.
 *
 * Con `onClick` es un <button> con `aria-pressed` (el contador filtra: "tocá un contador para
 * filtrar"); sin `onClick` es solo lectura.
 *
 * Props:
 *   - valor        número o texto ya formateado. `null`/`undefined` = sin dato: muestra "—" en
 *                  `--faint`, nunca 0 (principio "sin dato ≠ cero" de KpiCard); TalkBack lee
 *                  "sin dato" (la raya va `aria-hidden`).
 *   - etiqueta     rótulo ("Sin foto"). Puede partir en dos líneas: nunca se corta con elipsis.
 *   - tono         'ok' | 'aviso' | 'error' | 'info' | null — color del punto. null = sin punto
 *                  (el total no es un estado).
 *   - variante     'compacto' (defecto) | 'tarjeta'
 *   - activo       bool: el filtro elegido. Tinte de acento MÁS una marca que no es color:
 *                  indicador de 2 px y rótulo 600 (compacto), borde de 2 px y ✓ (tarjeta).
 *   - onClick, title, style
 */
const PUNTO = { ok: 'var(--success)', aviso: 'var(--warning)', error: 'var(--danger)', info: 'var(--info)' }

function Punto({ tono }) {
  if (!PUNTO[tono]) return null
  return <span aria-hidden="true" style={{ ...sx('flex:none;width:6px;height:6px;border-radius:var(--r-pill)'), background: PUNTO[tono] }} />
}

export function Contador({ valor, etiqueta, tono = null, variante = 'compacto', activo = false, onClick, title, style }) {
  const sinDato = valor === null || valor === undefined || valor === ''
  const numero = (
    <span style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600;line-height:1.1'), fontSize: variante === 'tarjeta' ? 'var(--fs-num-md, 24px)' : 'min(1rem, 5vw)', color: sinDato ? 'var(--faint)' : 'var(--text)' }}>
      {sinDato ? <><span aria-hidden="true">—</span><span className="lu-ui-oculto">sin dato</span></> : valor}
    </span>
  )
  const Tag = onClick ? 'button' : 'div'
  const interactivo = onClick ? { type: 'button', onClick, 'aria-pressed': !!activo, className: 'lu-ui-btn' } : {}

  if (variante === 'tarjeta') {
    return (
      <Tag
        {...interactivo}
        title={title}
        style={{
          ...sx('display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:2.75rem;min-width:2.75rem;border-radius:var(--r-lg);border-style:solid;background:var(--surface);box-shadow:var(--shadow);font-family:inherit;text-align:left;color:var(--text)'),
          // Activo = borde de 2 px (y ✓), no solo otro color: el tinte contra la superficie da
          // ~1,1:1. El padding resta ese píxel de más para que la tarjeta no salte al elegirla.
          borderWidth: activo ? 2 : 1,
          borderColor: activo ? 'var(--primary)' : 'var(--line)',
          padding: activo ? 'calc(var(--sp-3) - 1px) calc(var(--sp-4) - 1px)' : 'var(--sp-3) var(--sp-4)',
          cursor: onClick ? 'pointer' : undefined,
          ...style,
        }}
      >
        <span style={sx('display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);font-weight:600;color:var(--muted);line-height:1.25')}>
          <Punto tono={tono} />{etiqueta}
          {activo && <span aria-hidden="true" style={sx('display:grid;color:var(--primary)')}><Check size={14} w={1.75} /></span>}
        </span>
        {numero}
      </Tag>
    )
  }

  return (
    <Tag
      {...interactivo}
      title={title}
      style={{
        ...sx('position:relative;flex:1 0 0;min-width:auto;display:flex;flex-direction:column;justify-content:center;gap:3px;min-height:3.5rem;padding:var(--sp-2) 6px;border:0;font-family:inherit;text-align:left;color:var(--text)'),
        background: activo ? 'var(--primary-tint)' : 'transparent',
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      <span style={sx('display:flex;align-items:center;gap:4px;white-space:nowrap')}><Punto tono={tono} />{numero}</span>
      <span style={{ ...sx('font-size:var(--fs-xs);line-height:1.2'), color: activo ? 'var(--text)' : 'var(--muted)', fontWeight: activo ? 600 : 400 }}>{etiqueta}</span>
      {/* Activo: indicador de 2 px abajo + rótulo 600, como la pestaña de la barra inferior. El
          tinte solo no alcanza (~1,1:1 contra la superficie). Es un hijo y no un box-shadow
          inline porque el box-shadow ya lo usa la tira para el divisor (ui.css). */}
      {activo && <span aria-hidden="true" style={sx('position:absolute;left:0;right:0;bottom:0;height:2px;background:var(--primary)')} />}
    </Tag>
  )
}

/**
 * La tira de contadores del celular: una tarjeta con los `Contador` compactos en fila y un
 * divisor de 1 px entre cada uno. El divisor lo pone la tira (borde izquierdo de cada hijo menos
 * el primero) para que el contador no tenga que saber su posición.
 *
 * Props: children (Contador variante 'compacto'), ariaLabel, style.
 */
export function TiraContadores({ children, ariaLabel, style }) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="lu-tira-contadores"
      // `flex:none`: con `overflow:hidden`, dentro de una columna flex el alto mínimo es 0 y con
      // letra grande la columna la aplastaba hasta hacerla desaparecer (galería, letra x2).
      // `flex-wrap`: cada contador mide al menos su contenido (número y palabra más larga, sin
      // partirlos) y reparte el resto en partes iguales. A 1,0 los cinco entran en una fila de
      // 360; con la letra del sistema al doble (que agranda el texto y no las cajas, informe 08)
      // pasan a una segunda fila en vez de pisarse los números o cortar "Códi-go" al medio.
      style={{ ...sx('flex:none;display:flex;flex-wrap:wrap;align-items:stretch;border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);overflow:hidden'), ...style }}
    >
      {children}
    </div>
  )
}
