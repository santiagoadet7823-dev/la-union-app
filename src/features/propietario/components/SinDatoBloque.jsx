import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { initials } from '../../../lib/format'

/**
 * "N sin datos hoy" — bloque colapsable, SEPARADO de la lista de equipo.
 *
 * 🩸 ESTA SEPARACIÓN ES EL PUNTO ÉTICO DE TODA LA PANTALLA. Quien no reporta NO aparece en la lista
 * con 0 km, porque un 0 al lado de los demás se lee como "no trabajó" cuando la verdad es "no
 * sabemos". Sale de la lista y viene acá, con el diagnóstico del teléfono al lado.
 *
 * Cerrado por defecto: es información de excepción, no el titular del día.
 */
export default function SinDatoBloque({ personas, onAbrir }) {
  const [abierto, setAbierto] = useState(false)
  if (!personas.length) return null

  return (
    <div style={sx('margin-top:14px;background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden')}>
      <div
        onClick={() => setAbierto((v) => !v)}
        className="lu-press"
        role="button"
        aria-expanded={abierto}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAbierto((v) => !v) } }}
        style={sx('min-height:48px;padding:0 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer')}
      >
        <div style={sx('display:flex;align-items:center;gap:9px;min-width:0')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ color: 'var(--muted)', flex: 'none' }}>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span style={sx('font-size:var(--fs-md);font-weight:600')}>
            {personas.length} sin datos {personas.length === 1 ? 'hoy' : 'hoy'}
          </span>
        </div>
        <span style={sx('font-family:var(--font-mono);font-size:var(--fs-md);color:var(--muted)')}>{abierto ? '▴' : '▾'}</span>
      </div>

      {abierto && (
        <div style={sx('padding:0 14px 12px')}>
          <div style={sx('font-size:var(--fs-sm);line-height:1.55;color:var(--muted);padding-bottom:10px')}>
            Sin señal del teléfono. <b style={sx('color:var(--text)')}>No quiere decir que no estén trabajando</b> — puede
            ser batería, permisos o zona sin cobertura.
          </div>
          {personas.map((p) => (
            <div
              key={p.id}
              onClick={() => onAbrir?.(p.id)}
              className="lu-press"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onAbrir?.(p.id) } }}
              style={sx('display:flex;align-items:center;gap:11px;min-height:52px;padding:8px 0;border-top:1px solid var(--line);cursor:pointer')}
            >
              <div style={sx('flex:none;width:34px;height:34px;border-radius:var(--r-md);background:var(--bar);display:grid;place-items:center;font-family:var(--font-display);font-size:var(--fs-sm);font-weight:700;color:var(--muted)')}>
                {initials(p.nombre)}
              </div>
              <div style={sx('flex:1;min-width:0')}>
                <div style={sx('font-size:var(--fs-md);font-weight:600')}>{p.nombre}</div>
                <div style={sx('font-size:var(--fs-xs);color:var(--muted);margin-top:1px;line-height:1.35')}>{p.motivo}</div>
              </div>
              <span style={sx('font-family:var(--font-mono);font-size:var(--fs-md);color:var(--faint);flex:none')}>›</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
