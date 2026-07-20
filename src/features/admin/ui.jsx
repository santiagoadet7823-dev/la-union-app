import { sx } from '../../lib/sx'

/**
 * UI compartida del panel Admin: tokens de estilo, grillas de tablas y componentes
 * chicos reusados por las pestañas (features/admin/tabs/*). Antes vivían al pie de
 * AdminView; extraídos para que el shell y cada tab los importen.
 */
export const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
export const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
export const miniLbl = { ...sx('color:var(--faint);font-size:10px;text-transform:uppercase;letter-spacing:.05em;display:block') }
export const fieldLabel = { ...sx('font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px') }

export const asignGrid = { display: 'grid', gridTemplateColumns: '40px 110px 1.5fr 1fr 80px 110px 120px', gap: 10 }
export const cliGrid = { display: 'grid', gridTemplateColumns: '90px 1.6fr 1fr 150px 110px 90px', gap: 10 }
export const catGrid = { display: 'grid', gridTemplateColumns: '100px 1.8fr 1fr 120px 90px', gap: 10 }
export const faltGrid = { display: 'grid', gridTemplateColumns: '1.6fr 80px 80px 80px 120px', gap: 10 }

/**
 * Fila de tabla que en MÓVIL se convierte en tarjeta con etiquetas.
 *
 * 20/07/2026 — Catálogo, Usuarios y Empresas eran tablas de escritorio puras
 * (grillas de hasta 8 columnas fijas y `minWidth` de 700 a 1120 px) metidas dentro
 * del GestionHost de la APK. En un teléfono de ~390 px eso es scroll horizontal y
 * texto ilegible. Ninguna de las tres mencionaba `isMobile`, mientras Clientes y
 * Zonas sí lo hacían: nunca fueron adaptadas.
 *
 * En escritorio rinde la grilla de siempre. En móvil apila `etiqueta → valor`, con
 * la primera celda como título de la tarjeta.
 *
 * props:
 *   - grid      objeto de grilla (asignGrid, catGrid, …) para escritorio
 *   - isMobile  de useDevice()
 *   - celdas    [{ label, contenido, titulo?, ocultarEnMovil? }]
 *               `titulo` marca la celda que encabeza la tarjeta (sin etiqueta).
 *   - acciones  ReactNode opcional, al pie de la tarjeta / última columna
 */
export function FilaTabla({ grid, isMobile, celdas, acciones }) {
  if (!isMobile) {
    return (
      <div style={{ ...grid, ...sx('padding:10px;border-bottom:1px solid var(--line);font-size:12.5px;align-items:center') }}>
        {celdas.map((c, i) => <span key={i} style={c.estilo}>{c.contenido}</span>)}
        {acciones}
      </div>
    )
  }
  const titulo = celdas.find((c) => c.titulo)
  const resto = celdas.filter((c) => !c.titulo && !c.ocultarEnMovil)
  return (
    <div style={sx('border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);padding:12px;margin-bottom:10px')}>
      {titulo && <div style={sx('font-weight:600;font-size:14px;margin-bottom:10px;word-break:break-word')}>{titulo.contenido}</div>}
      <div style={sx('display:flex;flex-direction:column;gap:8px')}>
        {resto.map((c, i) => (
          <div key={i} style={sx('display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:32px')}>
            <span style={sx('font-size:11px;font-weight:600;color:var(--faint);text-transform:uppercase;letter-spacing:.05em;flex:none')}>{c.label}</span>
            <span style={sx('flex:1;min-width:0;text-align:right;font-size:13px')}>{c.contenido}</span>
          </div>
        ))}
      </div>
      {acciones && <div style={sx('display:flex;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)')}>{acciones}</div>}
    </div>
  )
}

/** Encabezado de tabla: en móvil no se dibuja (las tarjetas llevan su etiqueta). */
export function CabeceraTabla({ grid, isMobile, columnas }) {
  if (isMobile) return null
  return (
    <div style={{ ...grid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
      {columnas.map((c, i) => <span key={i} style={c.align === 'right' ? sx('text-align:right') : undefined}>{c.label ?? c}</span>)}
    </div>
  )
}

export function EmptyState({ titulo, texto }) {
  return (
    <div style={sx('padding:48px 20px;display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center')}>
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="M3.29 7 12 12l8.71-5" /><path d="M12 22V12" /></svg>
      <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px')}>{titulo}</div>
      <div style={sx('font-size:12.5px;color:var(--muted);max-width:380px;line-height:1.5')}>{texto}</div>
    </div>
  )
}

export function MiniStat({ label, value, color, span }) {
  return (
    <div style={{ ...sx('padding:10px 12px;background:var(--surface2);border:1px solid var(--line);border-radius:12px'), gridColumn: span ? 'span 2' : undefined }}>
      <div style={sx('font-size:9.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.05em')}>{label}</div>
      <div style={{ ...sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:18px;font-weight:600;margin-top:2px'), color: color || 'inherit' }}>{value}</div>
    </div>
  )
}
