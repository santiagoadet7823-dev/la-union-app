import { useState } from 'react'
import { sx } from '../lib/sx'

/**
 * Bloque que se abre y se cierra: encabezado tocable con ▾/▴ y el contenido debajo. Arranca
 * CERRADO salvo que se pida otra cosa: es para información de consulta, no para el titular.
 *
 * Salió de `SinDatoBloque` (plan 21) para usarlo también en el "Historial" de los clientes. El
 * contenido se monta recién al abrir: quien lo usa puede cargar datos en ese momento (`onCambio`).
 *
 * props:
 *   titulo       nodo del encabezado (a la izquierda del ▾)
 *   abiertoAl    arranca abierto (default false)
 *   onCambio     (abierto:boolean) en cada toque
 *   style        estilos del contenedor (se suman a los de base)
 *   cuerpoStyle  estilos del contenido
 */
export default function Desplegable({ titulo, abiertoAl = false, onCambio, style, cuerpoStyle, children }) {
  const [abierto, setAbierto] = useState(abiertoAl)
  const alternar = () => { const v = !abierto; setAbierto(v); onCambio?.(v) }

  return (
    <div style={{ ...sx('background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden'), ...style }}>
      <div
        onClick={alternar}
        className="lu-press"
        role="button"
        aria-expanded={abierto}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar() } }}
        style={sx('min-height:48px;padding:0 14px;display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer')}
      >
        <div style={sx('display:flex;align-items:center;gap:9px;min-width:0')}>{titulo}</div>
        <span style={sx('font-family:var(--font-mono);font-size:var(--fs-md);color:var(--muted)')}>{abierto ? '▴' : '▾'}</span>
      </div>
      {abierto && <div style={{ ...sx('padding:0 14px 12px'), ...cuerpoStyle }}>{children}</div>}
    </div>
  )
}
