import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useTheme } from '../../context/ThemeContext'
import { useDevice } from '../../context/DeviceContext'
import { useAuth } from '../../context/AuthContext'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { colorPorId } from '../../lib/colors'
import LeafletMap from '../../components/LeafletMap'

/**
 * Vista estática de recorridos: al abrir carga sola TODAS las ubicaciones del día
 * (todos los móviles, cada uno con su color) y se **actualiza sola cada 30 s** de
 * forma INCREMENTAL (solo trae los puntos nuevos, para no gastar egress). El
 * usuario navega/zoomea libre: al refrescar NO se reencuadra el mapa.
 */
const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
const selectStyle = { ...sx('padding:9px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font-body);cursor:pointer') }
const REFRESH_MS = 30000
const hoyStr = () => new Date().toISOString().slice(0, 10)

export default function RecorridosView() {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { idEmpresa } = useAuth()
  const [users, setUsers] = useState([])
  const [fecha, setFecha] = useState(hoyStr)
  const [byUser, setByUser] = useState({}) // { id_usuario: { points:[{lat,lng}] } }
  const [loading, setLoading] = useState(false)
  const [fitDone, setFitDone] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [, forceTick] = useState(0)
  const lastTsRef = useRef(null)

  const esHoy = fecha === hoyStr()

  // Nombres/roles (para la lista lateral).
  useEffect(() => {
    supabase.from('perfiles').select('id, nombre, rol').in('rol', ['vendedor', 'repartidor', 'encargado']).eq('activo', true)
      .then(({ data }) => setUsers(data || []))
  }, [])
  const meta = useMemo(() => { const m = {}; users.forEach((u) => { m[u.id] = u }); return m }, [users])

  // Carga: completa (reemplaza) o incremental (solo puntos nuevos desde lastTs).
  const load = useCallback(async (incremental) => {
    if (!idEmpresa) return
    const desde = new Date(fecha + 'T00:00:00').toISOString()
    const hasta = new Date(fecha + 'T23:59:59').toISOString()
    if (!incremental) setLoading(true)
    let q = supabase.from('posiciones').select('id_usuario, lat, lng, ts')
      .eq('id_empresa', idEmpresa).lte('ts', hasta).order('ts', { ascending: true })
    q = incremental && lastTsRef.current ? q.gt('ts', lastTsRef.current) : q.gte('ts', desde)
    const { data } = await q
    if (!incremental) setLoading(false)
    if (!data) return
    if (data.length) {
      setByUser((prev) => {
        const next = incremental ? { ...prev } : {}
        data.forEach((p) => {
          if (!p.id_usuario) return
          if (!next[p.id_usuario]) next[p.id_usuario] = { points: [] }
          next[p.id_usuario] = { points: [...next[p.id_usuario].points, { lat: p.lat, lng: p.lng }] }
        })
        return next
      })
      lastTsRef.current = data[data.length - 1].ts
    } else if (!incremental) {
      setByUser({})
    }
    setUpdatedAt(Date.now())
  }, [idEmpresa, fecha])

  // Carga inicial y al cambiar de fecha.
  useEffect(() => {
    lastTsRef.current = null
    setFitDone(false)
    load(false)
  }, [load])

  // Encuadrar solo la primera vez que llegan datos (después se preserva el zoom).
  useEffect(() => { if (!fitDone && Object.keys(byUser).length) setFitDone(true) }, [byUser, fitDone])

  // Auto-refresh incremental cada 30 s (solo si la fecha es HOY; el pasado no cambia).
  useEffect(() => {
    if (!esHoy) return
    const iv = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(iv)
  }, [esHoy, load])

  // Tick para el "hace Xs".
  useEffect(() => { const t = setInterval(() => forceTick((n) => n + 1), 1000); return () => clearInterval(t) }, [])

  const trails = useMemo(() => Object.entries(byUser)
    .filter(([, v]) => v.points.length >= 2)
    .map(([id, v]) => {
      let m = 0
      for (let i = 1; i < v.points.length; i++) m += distanciaMetros(v.points[i - 1], v.points[i])
      return { id, points: v.points, color: colorPorId(id), nombre: meta[id]?.nombre || 'Móvil', rol: meta[id]?.rol || '', km: m / 1000 }
    }), [byUser, meta])
  const leafletTrails = useMemo(() => trails.map((t) => ({ points: t.points, color: t.color })), [trails])
  const hace = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null

  return (
    <div style={{ ...sx('flex:1;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;gap:14px;align-items:start'), padding: isMobile ? 12 : 20, gridTemplateColumns: isMobile ? '1fr' : '1fr 300px' }}>
      <div style={sx('display:flex;flex-direction:column;gap:12px;min-width:0')}>
        <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <div style={label10}>Fecha</div>
            <input type="date" value={fecha} max={hoyStr()} onChange={(e) => setFecha(e.target.value)} style={selectStyle} />
          </div>
          <button onClick={() => load(false)} disabled={loading} style={sx('padding:9px 16px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--deep);font-size:13px;font-weight:600;cursor:pointer')}>
            {loading ? 'Cargando…' : '↻ Recargar'}
          </button>
          <div style={sx('flex:1')} />
          <div style={sx('display:flex;align-items:center;gap:7px;font-family:var(--font-mono);font-size:11.5px;color:var(--muted)')}>
            {esHoy && <span style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--success)', animation: 'lu-blink 1.6s infinite' }} />}
            {trails.length} recorridos{hace != null ? ` · act. hace ${hace}s` : ''}{esHoy ? ' · en vivo' : ''}
          </div>
        </div>

        <LeafletMap theme={theme} height={isMobile ? '58vh' : '72vh'} trails={leafletTrails.length ? leafletTrails : null} fit={!fitDone} />
      </div>

      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={label10}>Recorridos ({trails.length})</div>
        {trails.length === 0 ? (
          <div style={sx('padding:20px 4px;text-align:center;color:var(--faint);font-size:12.5px;line-height:1.6')}>
            {loading ? 'Cargando ubicaciones del día…' : 'Todavía no hay ubicaciones registradas para esta fecha.'}
          </div>
        ) : (
          trails.map((t) => (
            <div key={t.id} style={sx('display:flex;align-items:center;gap:10px;padding:9px 11px;background:var(--surface2);border:1px solid var(--line);border-radius:12px')}>
              <span style={{ width: 12, height: 12, borderRadius: 99, background: t.color, flex: 'none', border: '1px solid #fff' }} />
              <div style={sx('flex:1;min-width:0')}>
                <div style={sx('font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{t.nombre}</div>
                <div style={sx('font-size:10.5px;color:var(--faint);font-family:var(--font-mono)')}>{t.rol} · {t.points.length} pts</div>
              </div>
              <div style={sx('font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--deep)')}>{t.km.toFixed(1)} km</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
