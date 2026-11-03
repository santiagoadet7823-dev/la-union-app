import { useState } from 'react'

/**
 * Las flechitas para ordenar una lista por columna (plan 37): Gestión → Clientes y Catálogo.
 * En PC son los encabezados de la tabla; en el teléfono, donde no hay encabezados, una fila de botones.
 */

/** Menor a mayor → mayor a menor → orden de siempre. Otra columna arranca de menor a mayor. */
export function useOrdenColumna() {
  const [orden, setOrden] = useState(null) // { campo, sentido } o null = el orden de siempre
  const alternarOrden = (campo) => setOrden((o) => {
    if (o?.campo !== campo) return { campo, sentido: 'asc' }
    return o.sentido === 'asc' ? { campo, sentido: 'desc' } : null
  })
  return [orden, alternarOrden]
}

/** Las dos flechitas: apagadas sin orden; prendida la del sentido elegido. */
const Flechitas = ({ sentido }) => (
  <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" style={{ flex: 'none' }}>
    <path d="M4 0 8 5H0z" fill={sentido === 'asc' ? 'var(--primary)' : 'currentColor'} opacity={sentido === 'asc' ? 1 : 0.35} />
    <path d="M4 12 0 7h8z" fill={sentido === 'desc' ? 'var(--primary)' : 'currentColor'} opacity={sentido === 'desc' ? 1 : 0.35} />
  </svg>
)

export function BotonOrden({ campo, etiqueta, orden, onAlternar, comoChip = false }) {
  const sentido = orden?.campo === campo ? orden.sentido : null
  const estado = sentido === 'asc' ? 'de menor a mayor' : sentido === 'desc' ? 'de mayor a menor' : 'sin ordenar'
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 0, cursor: 'pointer',
    font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', textAlign: 'left',
  }
  const estilo = comoChip
    ? {
      // 44 de alto: el táctil mínimo del teléfono, igual que los `Chip` de filtro.
      ...base, flex: 'none', minHeight: 44, padding: '0 12px', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600,
      background: sentido ? 'var(--primary-tint)' : 'var(--surface2)',
      border: `1px solid ${sentido ? 'var(--primary)' : 'var(--line)'}`,
      color: sentido ? 'var(--deep)' : 'var(--muted)',
    }
    : { ...base, maxWidth: '100%', padding: 0, border: 'none', background: 'transparent', color: sentido ? 'var(--deep)' : 'inherit' }
  return (
    <button type="button" onClick={() => onAlternar(campo)} className="lu-press" style={estilo}
      aria-label={`Ordenar por ${etiqueta}. Ahora: ${estado}`}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{etiqueta}</span>
      <Flechitas sentido={sentido} />
    </button>
  )
}

/** `campos`: lista de `[campo, etiqueta]`. Se desliza de costado, como los filtros del catálogo. */
export function FilaOrden({ campos, orden, onAlternar }) {
  return (
    <div className="lu-chips" style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, overflowX: 'auto', flex: 'none', scrollbarWidth: 'none' }}>
      <span style={{ flex: 'none', fontSize: 11, fontWeight: 600, color: 'var(--faint)' }}>Ordenar por</span>
      {campos.map(([campo, etiqueta]) => (
        <BotonOrden key={campo} campo={campo} etiqueta={etiqueta} orden={orden} onAlternar={onAlternar} comoChip />
      ))}
    </div>
  )
}
