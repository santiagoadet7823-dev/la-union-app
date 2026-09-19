import { useState } from 'react'
import { sx } from '../lib/sx'
import { fmtHora } from '../lib/format'
import { Truck } from './icons'
import Overlay from './Overlay'
import { useTransporte } from '../hooks/useTransporte'

/**
 * "Iniciar jornada de transporte" — el mismo control para el vendedor y el repartidor (regla 31).
 * (17/09/2026, db/72.)
 *
 * Cerrado: una píldora de una línea, que se toca una vez. Abierto: un chip persistente en tinta
 * —el mismo color con el que el panel pinta el tramo— con la hora de inicio y "Terminar". Terminar
 * pide confirmación: un toque de más no cierra un tramo, y con el tramo cerrado la cadencia vuelve
 * a la adaptativa (en el próximo cambio de velocidad) y la alerta de "en ruta sin declarar" vuelve
 * a mirar a la persona.
 *
 * Lo que este botón NO decide: cuándo se cierra solo (lo hace el cron al terminar la ventana de
 * rastreo, o a las 14 h), ni cuándo se abre solo para el repartidor (lo hace `useEntregas` al
 * marcar el primer "En camino"). Acá se muestra el estado, sea quien sea el que lo abrió.
 */
export default function BotonTransporte({ style }) {
  const { tramo, abierto, abrir, cerrar } = useTransporte()
  const [confirmar, setConfirmar] = useState(false)

  if (!abierto) {
    return (
      <button type="button" onClick={() => abrir('manual')} className="lu-press"
        style={{ ...sx('width:100%;min-height:46px;display:flex;align-items:center;justify-content:center;gap:9px;border-radius:12px;border:1px solid var(--line2);background:var(--surface);color:var(--deep);font-weight:600;font-size:13px;cursor:pointer'), ...style }}>
        <Truck size={17} />
        Iniciar jornada de transporte
      </button>
    )
  }

  return (
    <>
      <div style={{ ...sx('width:100%;min-height:46px;display:flex;align-items:center;gap:9px;padding:0 6px 0 14px;border-radius:12px;background:var(--text);color:var(--surface);font-size:12px;font-weight:500;box-sizing:border-box'), ...style }}>
        <Truck size={17} />
        <span style={sx('flex:1')}>
          En transporte desde las <b style={sx('font-family:var(--font-mono);font-variant-numeric:tabular-nums')}>{fmtHora(tramo.inicio_ts)}</b>
          {tramo.origen === 'reparto' && <span style={sx('opacity:.7')}> · por el reparto</span>}
        </span>
        <button type="button" onClick={() => setConfirmar(true)} className="lu-press"
          style={sx('min-height:34px;padding:0 12px;border-radius:9px;border:1px solid rgba(255,255,255,.25);background:transparent;color:inherit;font-weight:700;font-size:12px;cursor:pointer')}>
          Terminar
        </button>
      </div>

      <Overlay
        open={confirmar}
        onClose={() => setConfirmar(false)}
        variant="modal"
        title="¿Terminar la jornada de transporte?"
        subtitle="El GPS vuelve a la cadencia normal y el recorrido deja de pintarse como transporte."
        footer={
          <>
            <button type="button" onClick={() => setConfirmar(false)} className="lu-press"
              style={sx('flex:1;min-height:46px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:var(--r-md);font-weight:600;font-size:var(--fs-sm);color:var(--muted);cursor:pointer;background:transparent')}>
              Seguir en ruta
            </button>
            <button type="button" onClick={() => { cerrar(); setConfirmar(false) }} className="lu-press"
              style={sx('flex:1;min-height:46px;display:grid;place-items:center;background:var(--text);color:var(--surface);border-radius:var(--r-md);font-weight:600;font-size:var(--fs-sm);cursor:pointer;border:none')}>
              Terminar
            </button>
          </>
        }
      />
    </>
  )
}
