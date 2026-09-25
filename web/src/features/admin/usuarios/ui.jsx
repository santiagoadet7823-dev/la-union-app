import { sx } from '../../../lib/sx'
import { initials } from '../../../lib/format'

/**
 * Piezas chicas del menú Usuarios v1.5, portadas de la entrega del diseñador
 * (`Usuarios v1.5.dc.html`) con `sx()` para que el CSS quede 1:1 y comparable.
 *
 * Cambios contra el prototipo, todos por las restricciones del brief (§7):
 *  - Sin hex sueltos: el `#fff` del interruptor y de "Purgar" pasó a `--on-primary` / `--surface`.
 *  - El punto "en la calle" NO parpadea: `us-blink` era una animación infinita de 2 s (> 300 ms y
 *    fuera del estándar de motion del repo). El color ya lo dice.
 *  - Las transiciones animan sólo `transform`/`opacity`.
 */

export const mono = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }
export const display = { fontFamily: 'var(--font-display)' }

export const tarjeta = sx('background:var(--surface);border:1px solid var(--line);border-radius:var(--r-card)')
export const rotulo = sx('font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)')
export const tituloTarjeta = { ...display, ...sx('font-weight:600;font-size:15px') }

/** Iniciales con anillo del color de trazo y punto de estado. */
export function Avatar({ nombre, color, dot, size = 30, fs = 10.5, borde = 2, style }) {
  return (
    <div style={{ ...sx('position:relative;flex:none;border-radius:99px;background:var(--surface2);display:grid;place-items:center;font-weight:700;color:var(--text)'), ...display, width: size, height: size, border: `${borde}px solid ${color}`, fontSize: fs, ...style }}>
      {initials(nombre)}
      {dot && <span style={{ ...sx('position:absolute;right:-3px;bottom:-3px;width:10px;height:10px;border-radius:99px;border:2px solid var(--surface)'), background: dot }} />}
    </div>
  )
}

/** Control segmentado (Agrupar, período, perfil GPS). Cada botón mide lo que pide `alto`. */
export function Segmentado({ opciones, valor, onChange, alto = 30, fs = 12, estirar = false }) {
  return (
    <div role="tablist" style={{ ...sx('display:flex;gap:2px;padding:3px;border-radius:10px;background:var(--surface2);border:1px solid var(--line)'), ...(estirar ? { width: '100%', boxSizing: 'border-box' } : null) }}>
      {opciones.map((o) => {
        const on = o.k === valor
        return (
          <button key={o.k} type="button" role="tab" aria-selected={on} onClick={() => onChange(o.k)} className="lu-press"
            style={{ ...sx('border:0;border-radius:7px;cursor:pointer;font-weight:600;white-space:nowrap;padding:0 11px'), height: alto, fontSize: fs, background: on ? 'var(--primary)' : 'transparent', color: on ? 'var(--on-primary)' : 'var(--muted)', ...(estirar ? { flex: 1 } : null) }}>
            {o.l}
          </button>
        )
      })}
    </div>
  )
}

/** Chip del historial de jornadas. `punteado` = "no acusa" (sin datos, antes del alta…). */
export function ChipEstado({ t, dot, bg = 'var(--surface)', bd = 'var(--line)', punteado = false }) {
  return (
    <span style={{ ...sx('display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 9px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap'), background: bg, border: `1px ${punteado ? 'dashed' : 'solid'} ${bd}` }}>
      <span style={{ ...sx('width:6px;height:6px;border-radius:99px'), background: dot }} />{t}
    </span>
  )
}

export function Skeleton({ alto = 92, radio = 12 }) {
  return <div className="lu-sk" style={{ height: alto, borderRadius: radio }} />
}

/** Marca de campo modificado: tinte + punto + "antes: ~~x~~ · Deshacer". */
export function CampoEditable({ label, cambiado, antes, onDeshacer, extra, children }) {
  return (
    <div style={{ ...sx('padding:8px;border-radius:10px;display:flex;flex-direction:column;gap:6px;min-width:0'), background: cambiado ? 'var(--primary-tint)' : 'transparent' }}>
      <div style={sx('display:flex;align-items:center;gap:6px')}>
        <span style={{ ...rotulo, flex: 1 }}>{label}</span>
        {cambiado && <span aria-label="Modificado" style={sx('width:7px;height:7px;border-radius:99px;background:var(--primary)')} />}
      </div>
      {children}
      {cambiado && (
        <div style={sx('display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);min-width:0')}>
          <span style={sx('flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>antes: <s>{antes}</s>{extra}</span>
          <button type="button" onClick={onDeshacer} className="lu-press" style={sx('border:0;background:transparent;cursor:pointer;font-size:11px;font-weight:600;color:var(--deep);padding:6px 4px;min-height:32px')}>Deshacer</button>
        </div>
      )}
    </div>
  )
}

/** Botón de opción (rol, empresa, nivel): borde primario cuando está elegido. */
export function Opcion({ on, onClick, children, alto = 36, style }) {
  return (
    <button type="button" onClick={onClick} className="lu-press"
      style={{ ...sx('border-radius:8px;cursor:pointer;font-size:11.5px;font-weight:600;padding:0 6px;overflow:hidden;text-overflow:ellipsis'), minHeight: alto, border: `1.5px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary-tint)' : 'transparent', color: on ? 'var(--deep)' : 'var(--text)', ...style }}>
      {children}
    </button>
  )
}

export function Interruptor({ on, onClick, label }) {
  return (
    <button type="button" onClick={onClick} role="switch" aria-checked={on} className="lu-press"
      style={sx('display:flex;align-items:center;gap:8px;min-height:38px;border:0;background:transparent;cursor:pointer;padding:0;color:var(--text)')}>
      <span style={{ ...sx('flex:none;width:40px;height:24px;border-radius:99px;position:relative'), background: on ? 'var(--primary)' : 'var(--line2)' }}>
        <span style={{ ...sx('position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:99px;background:var(--surface);transition:transform .15s cubic-bezier(.23,1,.32,1)'), transform: `translateX(${on ? 16 : 0}px)` }} />
      </span>
      <span style={sx('font-size:12.5px;font-weight:600')}>{label}</span>
    </button>
  )
}

// ── Íconos (trazo, sin librería) ────────────────────────────────────────────
const I = ({ d, size = 15, sw = 2.2, children }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d ? <path d={d} /> : children}
  </svg>
)
export const IcoBuscar = (p) => <I {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></I>
export const IcoChevron = ({ abierto, size = 13 }) => (
  <span style={{ display: 'inline-grid', transform: `rotate(${abierto ? 90 : 0}deg)`, transition: 'transform .15s cubic-bezier(.23,1,.32,1)' }}><I d="m9 6 6 6-6 6" size={size} sw={2.4} /></span>
)
export const IcoAviso = ({ size = 13, color = 'var(--warning)' }) => (
  <span style={{ color, display: 'inline-grid' }}><I d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" size={size} /></span>
)
export const IcoMas = (p) => <I d="M12 5v14M5 12h14" sw={2.4} {...p} />
export const IcoReloj = (p) => <I {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></I>
export const IcoOk = (p) => <I d="m5 12 5 5L20 7" sw={2.4} {...p} />
export const IcoExpandir = (p) => <I d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" {...p} />
export const IcoPlay = (p) => <I d="M7 4v16l13-8Z" {...p} />
export const IcoMapa = (p) => <I d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14" {...p} />
export const IcoInforme = (p) => <I d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8M8 17h5" {...p} />
export const IcoEdificio = (p) => <I d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m4 0h1m-6 4h1m4 0h1m-6 4h6" sw={2} {...p} />
export const IcoSinRastreo = (p) => <I {...p}><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 11.9-5" /><path d="M19 9.5c0 5.3-7 11.5-7 11.5" /><path d="m3 3 18 18" /></I>
export const IcoAtras = (p) => <I d="m15 18-6-6 6-6" {...p} />
