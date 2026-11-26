import { useCallback, useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { hace } from '../../lib/format'
import { supabase } from '../../services/supabase'
import { PildoraEstado } from '../../components/ui'
import { ALERTA_MONITOREO } from './usuarios/MonitoreoBloque'

/**
 * Salud del parque (plan 54, R4): un renglón por teléfono con APK piloto o designado para monitoreo.
 * Datos de `salud_parque()` (db/116, solo superadmin). Semáforo por batería, ahorro, precisión de hoy,
 * último latido, huecos y alertas abiertas.
 */
const SILENCIO_MIN = 30

function semaforo(r) {
  const silencio = r.latido_ts ? (Date.now() - new Date(r.latido_ts).getTime()) / 60000 : Infinity
  if ((r.alertas_abiertas || []).length || r.ahorro || (r.bateria != null && r.bateria < 20)) return 'error'
  if (silencio > SILENCIO_MIN || (r.bateria != null && r.bateria < 40) || (r.pct_menos_8m != null && r.pct_menos_8m < 50) || r.huecos_5min > 3) return 'aviso'
  return 'ok'
}

const COLOR = { ok: 'var(--success)', aviso: 'var(--warning)', error: 'var(--danger)' }

function Dato({ k, v, alerta }) {
  return (
    <div style={sx('display:flex;flex-direction:column;gap:1px;min-width:0')}>
      <span style={sx('font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em')}>{k}</span>
      <span style={{ ...sx('font-family:var(--font-mono);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis'), color: alerta ? 'var(--danger)' : 'var(--text)' }}>{v}</span>
    </div>
  )
}

export default function SaludParqueView({ onToast }) {
  const [filas, setFilas] = useState(null)
  const [cargando, setCargando] = useState(false)
  const [soloMonitoreados, setSoloMonitoreados] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase.rpc('salud_parque')
    setCargando(false)
    if (error) { onToast?.(`No se pudo leer la salud del parque: ${error.message}`); setFilas([]); return }
    setFilas(data || [])
  }, [onToast])

  useEffect(() => {
    cargar()
    const iv = setInterval(cargar, 60000)
    return () => clearInterval(iv)
  }, [cargar])

  const lista = (filas || []).filter((r) => !soloMonitoreados || r.monitoreado)
  const cuenta = { ok: 0, aviso: 0, error: 0 }
  lista.forEach((r) => { cuenta[semaforo(r)]++ })

  return (
    <div style={sx('display:flex;flex-direction:column;gap:12px;padding:16px;max-width:1100px')}>
      <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
        <PildoraEstado tipo="ok">{cuenta.ok} bien</PildoraEstado>
        <PildoraEstado tipo="aviso">{cuenta.aviso} a mirar</PildoraEstado>
        <PildoraEstado tipo="error">{cuenta.error} con problema</PildoraEstado>
        <label style={sx('display:flex;align-items:center;gap:6px;font-size:13px;margin-left:auto;cursor:pointer')}>
          <input type="checkbox" checked={soloMonitoreados} onChange={(e) => setSoloMonitoreados(e.target.checked)} />
          Solo monitoreados
        </label>
        <button type="button" onClick={cargar} className="lu-press"
          style={sx('min-height:36px;padding:0 12px;border-radius:9px;border:1.5px solid var(--line2);background:transparent;color:var(--text);font-size:13px;cursor:pointer')}>
          {cargando ? 'Actualizando…' : 'Actualizar'}
        </button>
      </div>
      <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.4')}>
        Teléfonos con APK piloto (1.46.1 o más) o designados para monitoreo. Precisión: % de puntos de hoy con menos de 8 m.
        Huecos: cortes de más de 5 min entre puntos de hoy.
      </div>
      {filas === null && <div style={sx('padding:24px;color:var(--muted)')}>Cargando…</div>}
      {filas && !lista.length && <div style={sx('padding:24px;color:var(--muted)')}>No hay teléfonos para mostrar.</div>}
      {lista.map((r) => {
        const s = semaforo(r)
        const abiertas = r.alertas_abiertas || []
        return (
          <div key={r.id_usuario} style={{ ...sx('border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:12px 14px;display:flex;flex-direction:column;gap:10px'), borderLeft: `4px solid ${COLOR[s]}` }}>
            <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
              <b style={sx('font-size:15px')}>{r.nombre || '—'}</b>
              <span style={sx('font-size:12px;color:var(--muted)')}>{[r.empresa, r.modelo].filter(Boolean).join(' · ')}</span>
              <span style={sx('margin-left:auto;display:flex;gap:6px;flex-wrap:wrap')}>
                {r.monitoreado && <PildoraEstado tipo={r.vigente ? 'info' : 'aviso'}>{r.vigente ? 'Monitoreado' : 'Monitoreado sin piloto'}</PildoraEstado>}
                {r.ahorro && <PildoraEstado tipo="error">Ahorro prendido</PildoraEstado>}
              </span>
            </div>
            <div style={sx('display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px 14px')}>
              <Dato k="Batería" v={r.bateria != null ? `${r.bateria} %${r.cargando ? ' 🔌' : ''}` : '—'} alerta={r.bateria != null && r.bateria < 40} />
              <Dato k="Temperatura" v={r.bateria_temp != null ? `${Number(r.bateria_temp).toFixed(1)} °C` : '—'} alerta={r.bateria_temp != null && r.bateria_temp >= 45} />
              <Dato k="Último latido" v={r.latido_ts ? hace(r.latido_ts) || 'recién' : '—'} />
              <Dato k="Último punto" v={r.ultimo_punto_ts ? hace(r.ultimo_punto_ts) || 'recién' : 'sin puntos hoy'} />
              <Dato k="Puntos hoy" v={String(r.puntos_hoy ?? 0)} />
              <Dato k="Precisión" v={r.pct_menos_8m != null ? `${r.pct_menos_8m} %` : '—'} alerta={r.pct_menos_8m != null && r.pct_menos_8m < 50} />
              <Dato k="Huecos" v={`${r.huecos_5min ?? 0}${r.hueco_max_min ? ` · máx ${r.hueco_max_min} min` : ''}`} alerta={r.huecos_5min > 3} />
              <Dato k="APK" v={r.apk_version || '—'} />
              <Dato k="App" v={r.app_version || '—'} />
            </div>
            {abiertas.length > 0 && (
              <div style={sx('display:flex;gap:6px;flex-wrap:wrap')}>
                {abiertas.map((t) => <PildoraEstado key={t} tipo="error">{ALERTA_MONITOREO[t] || t}</PildoraEstado>)}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
