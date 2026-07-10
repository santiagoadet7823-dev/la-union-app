import { useCallback, useEffect, useMemo, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useTheme } from '../../context/ThemeContext'
import { useDevice } from '../../context/DeviceContext'
import { useAuth } from '../../context/AuthContext'
import { historialPosiciones } from '../../services/sync/realtime'
import { matchTrail } from '../../services/routing'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { colorPorId } from '../../lib/colors'
import LeafletMap from '../../components/LeafletMap'

/**
 * Vista estática de recorridos: en un solo mapa se ven TODOS los recorridos del día,
 * separados por color (uno por persona), y el encargado navega/zoomea libremente.
 * Alternativa a la "Reproducción" animada.
 */
const LIMITE_MENSUAL = 5000
const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
const selectStyle = { ...sx('padding:9px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font-body);cursor:pointer') }

export default function RecorridosView({ onToast }) {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { idEmpresa, user } = useAuth()
  const [users, setUsers] = useState([])
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [trails, setTrails] = useState([])
  const [loading, setLoading] = useState(false)
  const [snapOn, setSnapOn] = useState(true)

  useEffect(() => {
    supabase.from('perfiles').select('id, nombre, rol').in('rol', ['vendedor', 'repartidor', 'encargado']).eq('activo', true)
      .then(({ data }) => setUsers(data || []))
  }, [])

  const cargar = useCallback(async () => {
    // Cupo mensual de consultas por empresa (igual que Reproducción).
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    const { count } = await supabase.from('consultas_rutas').select('id', { count: 'exact', head: true }).eq('id_empresa', idEmpresa).gte('ts', inicioMes)
    if ((count || 0) >= LIMITE_MENSUAL) { onToast?.(`Se alcanzó el límite mensual de ${LIMITE_MENSUAL} consultas.`); return }

    setLoading(true); setTrails([])
    const desde = new Date(fecha + 'T00:00:00').toISOString()
    const hasta = new Date(fecha + 'T23:59:59').toISOString()
    const res = []
    for (const u of users) {
      const pts = await historialPosiciones(u.id, desde, hasta)
      if (!pts || pts.length < 2) continue
      let km = 0
      for (let i = 1; i < pts.length; i++) km += distanciaMetros(pts[i - 1], pts[i])
      let points = pts.map((p) => ({ lat: p.lat, lng: p.lng }))
      if (snapOn) {
        try { const m = await matchTrail(points); if (m.coords?.length) points = m.coords.map(([lat, lng]) => ({ lat, lng })) } catch (_) {}
      }
      res.push({ id: u.id, nombre: u.nombre, rol: u.rol, points, km: km / 1000, color: colorPorId(u.id) })
    }
    setTrails(res)
    setLoading(false)
    // Registrar la consulta (1 por carga de la vista).
    supabase.from('consultas_rutas').insert({ id_empresa: idEmpresa, id_usuario: user?.id, id_vendedor: null }).then(() => {})
    if (!res.length) onToast?.('No hay recorridos grabados para ese día')
  }, [users, fecha, snapOn, idEmpresa, user, onToast])

  const btn = (active) => ({ ...sx('padding:8px 14px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer'), border: `1px solid ${active ? 'var(--primary)' : 'var(--line2)'}`, background: active ? 'var(--primary-tint)' : 'transparent', color: active ? 'var(--deep)' : 'var(--muted)' })
  const leafletTrails = useMemo(() => trails.map((t) => ({ points: t.points, color: t.color })), [trails])

  return (
    <div style={{ ...sx('flex:1;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;gap:14px;align-items:start'), padding: isMobile ? 12 : 20, gridTemplateColumns: isMobile ? '1fr' : '1fr 300px' }}>
      <div style={sx('display:flex;flex-direction:column;gap:12px;min-width:0')}>
        <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <div style={label10}>Fecha</div>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={selectStyle} />
          </div>
          <button onClick={cargar} disabled={loading} style={sx('padding:9px 16px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            {loading ? 'Cargando…' : 'Ver recorridos del día'}
          </button>
          <button onClick={() => setSnapOn((v) => !v)} title="Pegar los recorridos a las calles" style={btn(snapOn)}>{snapOn ? '✓ Pegado a calles' : 'Pegar a calles'}</button>
          <div style={sx('flex:1')} />
          <div style={sx('font-family:var(--font-mono);font-size:11.5px;color:var(--muted);text-align:right')}>{trails.length ? `${trails.length} recorridos` : 'Sin datos cargados'}</div>
        </div>

        <LeafletMap theme={theme} height={isMobile ? '58vh' : '72vh'} trails={leafletTrails.length ? leafletTrails : null} />
      </div>

      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={label10}>Recorridos ({trails.length})</div>
        {trails.length === 0 ? (
          <div style={sx('padding:20px 4px;text-align:center;color:var(--faint);font-size:12.5px;line-height:1.6')}>Elegí una fecha y tocá <b>Ver recorridos del día</b> para ver todos los recorridos juntos, cada uno con su color.</div>
        ) : (
          trails.map((t) => (
            <div key={t.id} style={sx('display:flex;align-items:center;gap:10px;padding:9px 11px;background:var(--surface2);border:1px solid var(--line);border-radius:12px')}>
              <span style={{ width: 12, height: 12, borderRadius: 99, background: t.color, flex: 'none', border: '1px solid #fff' }} />
              <div style={sx('flex:1;min-width:0')}>
                <div style={sx('font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{t.nombre}</div>
                <div style={sx('font-size:10.5px;color:var(--faint);font-family:var(--font-mono)')}>{t.rol}</div>
              </div>
              <div style={sx('font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--deep)')}>{t.km.toFixed(1)} km</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
