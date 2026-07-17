import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { hoyStr } from '../../lib/format'
import { useTheme } from '../../context/ThemeContext'
import { useDevice } from '../../context/DeviceContext'
import { useAuth } from '../../context/AuthContext'
import { distanciaMetros } from '../../services/geolocation/geofence'
import { colorPorId } from '../../lib/colors'
import { fetchSnapRecorridos } from '../../services/recorridos'
import usePerfilesEquipo from '../../hooks/usePerfilesEquipo'
import useRecorridosDelDia from '../../hooks/useRecorridosDelDia'
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
const REFRESH_MS = 60000

export default function RecorridosView() {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { idEmpresa } = useAuth()
  const [fecha, setFecha] = useState(hoyStr)
  const [snapped, setSnapped] = useState({}) // { id_usuario: [{lat,lng}] } pegado a calles
  const [snapOn, setSnapOn] = useState(false) // default OFF = rastro crudo (GPS real); ON = pegar a calles
  const [fitDone, setFitDone] = useState(false)
  const [, forceTick] = useState(0)
  const snapCallRef = useRef(0)

  const users = usePerfilesEquipo()
  const { byUser, updatedAt, loading, esHoy, reload } = useRecorridosDelDia(fecha, idEmpresa)

  const meta = useMemo(() => { const m = {}; users.forEach((u) => { m[u.id] = u }); return m }, [users])

  // Encuadrar solo la primera vez que llegan datos (después se preserva el zoom).
  useEffect(() => { setFitDone(false) }, [fecha])
  useEffect(() => { if (!fitDone && Object.keys(byUser).length) setFitDone(true) }, [byUser, fitDone])

  // Tick para el "hace Xs".
  useEffect(() => { const t = setInterval(() => forceTick((n) => n + 1), 1000); return () => clearInterval(t) }, [])

  // Snap-to-road: geometría pegada a calles (Edge Function con cache). Falla suave → crudo.
  // Guarda de staleness: se invoca desde un efecto Y desde el polling (no solo como
  // cuerpo de un efecto), así que un `cancel` de closure no alcanza — se usa un
  // contador de llamada y solo se aplica la respuesta si sigue siendo la última.
  const cargarSnap = useCallback(async () => {
    if (!idEmpresa) return
    const myCall = ++snapCallRef.current
    const desde = new Date(fecha + 'T00:00:00').toISOString()
    const hasta = new Date(fecha + 'T23:59:59').toISOString()
    const s = await fetchSnapRecorridos({ fecha, desde, hasta })
    if (myCall === snapCallRef.current) setSnapped(s)
  }, [idEmpresa, fecha])
  useEffect(() => { setSnapped({}); cargarSnap() }, [cargarSnap])
  useEffect(() => {
    if (!esHoy) return
    const iv = setInterval(cargarSnap, REFRESH_MS)
    return () => clearInterval(iv)
  }, [esHoy, cargarSnap])

  const trails = useMemo(() => Object.entries(byUser)
    .filter(([, v]) => v.points.length >= 2)
    .map(([id, v]) => {
      let m = 0
      for (let i = 1; i < v.points.length; i++) m += distanciaMetros(v.points[i - 1], v.points[i])
      return { id, points: v.points, color: colorPorId(id), nombre: meta[id]?.nombre || 'Móvil', rol: meta[id]?.rol || '', km: m / 1000 }
    }), [byUser, meta])
  // Para dibujar: geometría pegada a calles (uno o varios segmentos por persona) si
  // está; si no, el rastro crudo. Los km se calculan sobre el crudo (más fiel).
  const leafletTrails = useMemo(() => trails.flatMap((t) => {
    const segs = snapOn ? snapped[t.id] : null
    if (segs && segs.length) return segs.map((s) => ({ points: s, color: t.color }))
    return [{ points: t.points, color: t.color }]
  }), [trails, snapped, snapOn])
  const hace = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null

  return (
    <div style={{ ...sx('flex:1;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;gap:14px;align-items:start'), padding: isMobile ? 12 : 20, gridTemplateColumns: isMobile ? '1fr' : '1fr 300px' }}>
      <div style={sx('display:flex;flex-direction:column;gap:12px;min-width:0')}>
        <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <div style={label10}>Fecha</div>
            <input type="date" value={fecha} max={hoyStr()} onChange={(e) => setFecha(e.target.value)} style={selectStyle} />
          </div>
          <button onClick={reload} disabled={loading} style={sx('padding:9px 16px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--deep);font-size:13px;font-weight:600;cursor:pointer')}>
            {loading ? 'Cargando…' : '↻ Recargar'}
          </button>
          <button
            onClick={() => setSnapOn((v) => !v)}
            title="Por defecto se muestra el rastro real (GPS). Activá para pegarlo a las calles."
            style={snapOn
              ? sx('padding:9px 16px;border:1px solid var(--primary);border-radius:10px;background:var(--primary-tint);color:var(--deep);font-size:13px;font-weight:600;cursor:pointer')
              : sx('padding:9px 16px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--deep);font-size:13px;font-weight:600;cursor:pointer')}>
            {snapOn ? '✓ Pegar a calles' : 'Pegar a calles'}
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
