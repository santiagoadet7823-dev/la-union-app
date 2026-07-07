import { useEffect, useRef, useState } from 'react'
import { sx } from '../lib/sx'
import { useGps } from '../context/GpsContext'
import { publicarAlerta } from '../services/sync/realtime'
import { Pin } from './icons'

const STALE_MS = 60000 // sin fix nuevo por 60s => se considera GPS desactivado

/**
 * Puerta de GPS obligatorio para las vistas móviles. Si el GPS no está activo
 * (permiso denegado, apagado, o sin señal reciente), bloquea toda la pantalla y
 * emite una alerta al Admin indicando qué usuario/rol desactivó su GPS.
 */
export default function GpsGate({ children }) {
  const { pos, error, request, id, nombre, rol, idEmpresa } = useGps()
  const [now, setNow] = useState(Date.now())

  // Tick para re-evaluar la frescura del fix aunque no lleguen posiciones nuevas.
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(iv)
  }, [])

  const activo = !!pos && !error && now - pos.ts < STALE_MS

  // Alerta al Admin en las transiciones.
  const prev = useRef(activo)
  useEffect(() => {
    if (prev.current && !activo) publicarAlerta({ id, nombre, rol, idEmpresa, tipo: 'gps-off', ts: Date.now() })
    if (!prev.current && activo) publicarAlerta({ id, nombre, rol, idEmpresa, tipo: 'gps-on', ts: Date.now() })
    prev.current = activo
  }, [activo, id, nombre, rol, idEmpresa])

  if (activo) return children

  return (
    <div style={sx('height:100%;min-height:600px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:14px;padding:28px 22px;background:var(--bg-app);color:var(--text)')}>
      <div style={sx('width:76px;height:76px;border-radius:99px;display:grid;place-items:center;background:var(--danger-tint);border:1px solid var(--danger)')}>
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><path d="m4.5 4.5 15 15" />
        </svg>
      </div>
      <div style={sx('font-family:var(--font-display);font-weight:700;font-size:20px;color:var(--danger)')}>GPS desactivado</div>
      <div style={sx('font-size:13.5px;color:var(--muted);max-width:300px;line-height:1.5')}>
        La app <b>requiere la ubicación activada</b> para operar. Activá el GPS de tu teléfono
        para continuar. El panel fue notificado de que tu GPS está apagado.
      </div>
      <button
        onClick={() => request().catch(() => {})}
        style={sx('margin-top:6px;min-height:52px;padding:0 22px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border:none;border-radius:14px;font-weight:600;font-size:15px;cursor:pointer')}
      >
        <Pin size={18} /> Activar GPS
      </button>
      {error && (
        <div style={sx('font-size:11.5px;color:var(--danger);max-width:300px')}>
          Permiso denegado o ubicación apagada. Habilitá la ubicación en los ajustes del teléfono y tocá "Activar GPS".
        </div>
      )}
      <div style={sx('margin-top:8px;font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>{nombre} · {rol}</div>
    </div>
  )
}
