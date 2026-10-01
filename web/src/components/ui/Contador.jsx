import { sx } from '../../lib/sx'

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
 *                  `--faint`, nunca 0 (principio "sin dato ≠ cero" de KpiCard).
 *   - etiqueta     rótulo ("Sin foto"). Puede partir en dos líneas: nunca se corta con elipsis.
 *   - tono         'ok' | 'aviso' | 'error' | 'info' | null — color del punto. null = sin punto
 *                  (el total no es un estado).
 *   - variante     'compacto' (defecto) | 'tarjeta'
 *   - activo       bool: el filtro elegido (tinte de acento)
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
      {sinDato ? '—' : valor}
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
          ...sx('display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-height:2.75rem;min-width:2.75rem;padding:var(--sp-3) var(--sp-4);border-radius:var(--r-lg);border-width:1px;border-style:solid;background:var(--surface);box-shadow:var(--shadow);font-family:inherit;text-align:left;color:var(--text)'),
          borderColor: activo ? 'var(--primary)' : 'var(--line)',
          cursor: onClick ? 'pointer' : undefined,
          ...style,
        }}
      >
        <span style={sx('display:flex;align-items:center;gap:6px;font-size:var(--fs-xs);font-weight:600;color:var(--muted);line-height:1.25')}>
          <Punto tono={tono} />{etiqueta}
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
        ...sx('flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:3px;min-height:3.5rem;padding:var(--sp-2) 6px;border:0;font-family:inherit;text-align:left;color:var(--text)'),
        background: activo ? 'var(--primary-tint)' : 'transparent',
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      <span style={sx('display:flex;align-items:center;gap:4px;min-width:0')}><Punto tono={tono} />{numero}</span>
      <span style={sx('font-size:var(--fs-xs);color:var(--muted);line-height:1.2;overflow-wrap:break-word')}>{etiqueta}</span>
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
      style={{ ...sx('display:flex;align-items:stretch;border-radius:var(--r-lg);border:1px solid var(--line);background:var(--surface);overflow:hidden'), ...style }}
    >
      {children}
    </div>
  )
}
