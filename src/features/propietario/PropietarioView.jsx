import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { useDevice } from '../../context/DeviceContext'
import { colorPorId } from '../../lib/colors'
import useEquipoEnVivo from '../../hooks/useEquipoEnVivo'
import RecorridosView from '../admin/RecorridosView'

/**
 * Vista del DUEÑO (rol `propietario`). Solo lectura, pensada para el celular:
 *   1) Franja "Equipo en vivo": quién está compartiendo su GPS ahora + quién lo apagó.
 *   2) Mapa estático de recorridos del día (reutiliza RecorridosView tal cual).
 *   3) Tarjetas de métricas ("próximamente"): se completan cuando avance el módulo de pedidos.
 *
 * Sin ningún botón de crear/editar: el rol es read-only también a nivel base (RLS).
 */
const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }

// Métricas que verá el dueño cuando esté cargado el módulo de pedidos. Hoy placeholder.
const KPIS_PROXIMOS = [
  { label: 'Pedidos por preventista', hint: 'cantidad semanal por vendedor' },
  { label: 'Horas trabajadas', hint: 'por preventista, a la semana' },
  { label: 'Clientes visitados', hint: 'visitas efectivas en la semana' },
  { label: 'Recaudado en la semana', hint: 'cobrado + a cobrar' },
]

export default function PropietarioView() {
  const { isMobile } = useDevice()
  const { nombres, movers, gpsOff, mqttOn } = useEquipoEnVivo()
  const moversArr = Object.values(movers)
  const gpsOffArr = Object.values(gpsOff)

  // "hace Xs" en vivo (sin esto el label queda congelado si nadie manda una
  // posición nueva, en vez de seguir contando cada segundo).
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])

  return (
    <div style={{ ...sx('flex:1;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box;display:flex;flex-direction:column;gap:14px'), padding: isMobile ? 12 : 20 }}>
      {/* Alerta: GPS apagado (mismo patrón que el banner del admin). */}
      {gpsOffArr.length > 0 && (
        <div style={sx('background:var(--danger-tint);border:1px solid var(--danger);color:var(--danger);border-radius:12px;padding:10px 14px;font-size:12.5px;font-weight:600;display:flex;align-items:center;gap:10px')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17h.01" /></svg>
          {gpsOffArr.map((u) => `${u.nombre} (${u.rol})`).join(', ')} {gpsOffArr.length > 1 ? 'tienen' : 'tiene'} el GPS DESACTIVADO.
        </div>
      )}

      {/* Franja "Equipo en vivo". */}
      <div style={{ ...sx('display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:12px;font-size:12.5px;font-weight:500;flex-wrap:wrap'), background: moversArr.length ? 'var(--success-tint)' : 'var(--surface)', border: `1px solid ${moversArr.length ? 'var(--success)' : 'var(--line)'}`, color: moversArr.length ? 'var(--success)' : 'var(--muted)' }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: moversArr.length ? 'var(--success)' : mqttOn ? 'var(--info)' : 'var(--faint)', animation: moversArr.length ? 'lu-blink 1.4s infinite' : 'none' }} />
        {moversArr.length
          ? moversArr.map((m, i) => (
              <span key={m.id} style={sx('display:inline-flex;align-items:center;gap:5px')}>
                {i > 0 && <span style={sx('opacity:.4;margin:0 4px')}>·</span>}
                <span style={{ width: 9, height: 9, borderRadius: 99, background: colorPorId(m.id), border: '1px solid #fff' }} />
                {`${nombres[m.id] || m.rol} (${m.rol}) · hace ${Math.max(0, Math.round((Date.now() - m.ts) / 1000))}s`}
              </span>
            ))
          : `Esperando ubicación de vendedores/repartidores… · telemetría ${mqttOn ? 'conectada' : 'conectando…'}`}
      </div>

      {/* Mapa estático de recorridos del día (reutilizado). */}
      <RecorridosView />

      {/* Métricas del negocio — próximamente. */}
      <div style={panel}>
        <div style={sx('display:flex;align-items:center;gap:10px;margin-bottom:12px')}>
          <div style={label10}>Métricas del negocio</div>
          <span style={sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10px;font-weight:700;color:var(--info);background:var(--info-tint)')}>PRÓXIMAMENTE</span>
        </div>
        <div style={{ ...sx('display:grid;gap:10px'), gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)' }}>
          {KPIS_PROXIMOS.map((k) => (
            <div key={k.label} style={sx('background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:12px')}>
              <div style={sx('font-size:11.5px;font-weight:600;color:var(--muted);line-height:1.3')}>{k.label}</div>
              <div style={sx('font-family:var(--font-mono);font-size:20px;font-weight:600;color:var(--faint);margin:6px 0 4px')}>—</div>
              <div style={sx('font-size:10px;color:var(--faint);line-height:1.3')}>{k.hint}</div>
            </div>
          ))}
        </div>
        <div style={sx('margin-top:12px;font-size:11.5px;color:var(--faint);line-height:1.5')}>
          Estos indicadores se completan con la operación real: se arman a partir de los pedidos y
          las entregas que carguen los preventistas. Los vas a ver cobrar vida cuando el módulo de
          ventas esté en marcha. Mientras tanto, seguí a tu equipo en vivo desde el mapa de arriba.
        </div>
      </div>
    </div>
  )
}
