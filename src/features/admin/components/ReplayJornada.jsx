import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { sx } from '../../../lib/sx'
import { hoyStr } from '../../../lib/format'
import { supabase } from '../../../services/supabase'
import { useTheme } from '../../../context/ThemeContext'
import { useDevice } from '../../../context/DeviceContext'
import { useAuth } from '../../../context/AuthContext'
import { historialPosiciones } from '../../../services/sync/realtime'
import { fetchSnapRecorridos } from '../../../services/recorridos'
import { exportarRutaPng } from '../../../services/report/rutaPng'
import { distanciaMetros } from '../../../services/geolocation/geofence'
import { colorPorId } from '../../../lib/colors'
import usePerfilesEquipo from '../../../hooks/usePerfilesEquipo'
import LeafletMap from '../../../components/LeafletMap'

/**
 * Reproducción de la jornada: elegí un vendedor/repartidor y una fecha, y se
 * anima el recorrido real que quedó grabado en `posiciones` (el rastro que dejó
 * el móvil por movimiento). Controles play/pausa/velocidad/scrub, estética panel.
 */

const panel = { ...sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:16px') }
const label10 = { ...sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)') }
const VELOCIDADES = [1, 2, 4, 8]
const TICK_MS = 350
const LIMITE_MENSUAL = 5000 // consultas de rutas por empresa/mes (bloquea al llegar)

const hhmm = (ts) => new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export default function ReplayJornada({ onToast }) {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { idEmpresa, user } = useAuth()
  const users = usePerfilesEquipo()
  const [userId, setUserId] = useState('')
  const [fecha, setFecha] = useState(hoyStr)
  const [pts, setPts] = useState([])
  const [loading, setLoading] = useState(false)
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [vel, setVel] = useState(2)
  const [snapOn, setSnapOn] = useState(true)   // pegar el rastro a las calles (OSRM /route)
  const [snapped, setSnapped] = useState(null) // segmentos pegados a calles: [{lat,lng}[]]
  const timerRef = useRef(null)
  const ptsFechaRef = useRef(null) // fecha/usuario para los que `pts` realmente se cargó
  const ptsUserRef = useRef(null)

  // Preselecciona el primer usuario móvil de la empresa apenas carga la lista.
  useEffect(() => {
    if (users.length && !userId) setUserId(users[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users])

  const cargar = useCallback(async () => {
    if (!userId) { onToast?.('Elegí un usuario'); return }

    // Cupo mensual de consultas por empresa. Si se alcanzó, se bloquea la carga.
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    const { count } = await supabase
      .from('consultas_rutas')
      .select('id', { count: 'exact', head: true })
      .eq('id_empresa', idEmpresa)
      .gte('ts', inicioMes)
    if ((count || 0) >= LIMITE_MENSUAL) {
      onToast?.(`Se alcanzó el límite mensual de ${LIMITE_MENSUAL} consultas de rutas. Se reanuda el mes próximo.`)
      return
    }

    setPlaying(false); setLoading(true); setIdx(0)
    const desde = new Date(fecha + 'T00:00:00').toISOString()
    const hasta = new Date(fecha + 'T23:59:59').toISOString()
    const data = await historialPosiciones(userId, desde, hasta)
    setPts(data)
    ptsFechaRef.current = fecha
    ptsUserRef.current = userId
    setLoading(false)
    // Registrar la consulta (cuenta para el heatmap y el cupo).
    supabase.from('consultas_rutas').insert({ id_empresa: idEmpresa, id_usuario: user?.id, id_vendedor: userId })
      .then(({ error }) => { if (error) console.warn('[consultas_rutas]', error.message) })
    if (!data.length) onToast?.('No hay recorrido grabado para ese día')
  }, [userId, fecha, onToast, idEmpresa, user])

  // Motor de reproducción.
  useEffect(() => {
    if (!playing || pts.length < 2) return
    timerRef.current = setInterval(() => {
      setIdx((i) => {
        if (i >= pts.length - 1) { setPlaying(false); return i }
        return i + 1
      })
    }, TICK_MS / vel)
    return () => clearInterval(timerRef.current)
  }, [playing, vel, pts.length])

  // Snap-to-road del rastro (Edge Function con OSRM /route + cache). Devuelve segmentos
  // por usuario; tomamos los del usuario elegido. No bloquea la reproducción: si falla o
  // está apagado, se usa el rastro crudo.
  useEffect(() => {
    let cancel = false
    if (!snapOn || pts.length < 2 || !userId) { setSnapped(null); return }
    // `pts` puede seguir siendo de un día/usuario anterior si `fecha`/`userId`
    // cambiaron sin volver a tocar "Cargar recorrido": no pegar a calles el día
    // nuevo sobre el rastro crudo viejo (mapa/stats mezclados de dos jornadas).
    if (fecha !== ptsFechaRef.current || userId !== ptsUserRef.current) { setSnapped(null); return }
    const desde = new Date(fecha + 'T00:00:00').toISOString()
    const hasta = new Date(fecha + 'T23:59:59').toISOString()
    fetchSnapRecorridos({ fecha, desde, hasta })
      .then((map) => { if (!cancel) { const segs = map[userId]; setSnapped(segs && segs.length ? segs : null) } })
      .catch(() => { if (!cancel) setSnapped(null) })
    return () => { cancel = true }
  }, [pts, snapOn, userId, fecha])

  const stats = useMemo(() => {
    if (pts.length < 2) return { km: 0, desde: null, hasta: null }
    let m = 0
    for (let i = 1; i < pts.length; i++) m += distanciaMetros(pts[i - 1], pts[i])
    return { km: m / 1000, desde: pts[0].ts, hasta: pts[pts.length - 1].ts }
  }, [pts])

  const parcial = useMemo(() => pts.slice(0, idx + 1), [pts, idx])
  const actual = pts[idx]
  const colorUser = colorPorId(userId)
  const [exporting, setExporting] = useState(false)

  async function exportarPng() {
    if (pts.length < 2) { onToast?.('Cargá primero un recorrido'); return }
    setExporting(true)
    try {
      const u = users.find((x) => x.id === userId)
      const nombre = u?.nombre || 'Vendedor'
      // Preferimos el rastro pegado a calles (aplanando los segmentos); si no, el crudo.
      const coords = snapped && snapped.length ? snapped.flat() : pts.map((p) => ({ lat: p.lat, lng: p.lng }))
      await exportarRutaPng({
        coords,
        titulo: nombre,
        subtitulo: `${u?.rol || ''} · ${new Date(fecha + 'T00:00:00').toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}`,
        stats: [
          { label: 'Distancia', value: `${stats.km.toFixed(2)} km` },
          { label: 'Horario', value: stats.desde ? `${hhmm(stats.desde)}–${hhmm(stats.hasta)}` : '—' },
          { label: 'Puntos', value: String(pts.length) },
        ],
        color: colorUser,
        filename: `recorrido_${nombre.replace(/\s+/g, '_')}_${fecha}.png`,
      })
      onToast?.('PNG del recorrido descargado')
    } catch (e) {
      onToast?.('No se pudo exportar: ' + (e?.message || 'error'))
    } finally {
      setExporting(false)
    }
  }

  const btn = (active) => ({ ...sx('padding:8px 14px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer'), border: `1px solid ${active ? 'var(--primary)' : 'var(--line2)'}`, background: active ? 'var(--primary-tint)' : 'transparent', color: active ? 'var(--deep)' : 'var(--muted)' })

  return (
    <div style={{ ...sx('flex:1;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;gap:14px;align-items:start'), padding: isMobile ? 12 : 20, gridTemplateColumns: isMobile ? '1fr' : '1fr 320px' }}>
      <div style={sx('display:flex;flex-direction:column;gap:12px;min-width:0')}>
        {/* Controles superiores */}
        <div style={{ ...panel, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div>
            <div style={label10}>Usuario</div>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} style={selectStyle}>
              <option value="">Elegir…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.nombre} · {u.rol}</option>)}
            </select>
          </div>
          <div>
            <div style={label10}>Fecha</div>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={selectStyle} />
          </div>
          <button onClick={cargar} disabled={loading} style={sx('padding:9px 16px;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>
            {loading ? 'Cargando…' : 'Cargar recorrido'}
          </button>
          <button onClick={() => setSnapOn((v) => !v)} title="Corrige los saltos de GPS pegando el recorrido a las calles" style={btn(snapOn)}>
            {snapOn ? '✓ Pegado a calles' : 'Pegar a calles'}
          </button>
          <button onClick={exportarPng} disabled={exporting || pts.length < 2} style={sx('padding:9px 14px;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--deep);font-size:13px;font-weight:600;cursor:pointer')}>
            {exporting ? 'Generando…' : '⤓ Exportar PNG'}
          </button>
          <div style={sx('flex:1')} />
          <div style={sx('font-family:var(--font-mono);font-size:11.5px;color:var(--muted);text-align:right')}>
            {pts.length ? <>{pts.length} puntos · {stats.km.toFixed(2)} km<br />{stats.desde && `${hhmm(stats.desde)} – ${hhmm(stats.hasta)}`}</> : 'Sin datos cargados'}
          </div>
        </div>

        <LeafletMap
          theme={theme}
          height={isMobile ? '54vh' : '68vh'}
          trails={snapOn && snapped ? snapped.map((s) => ({ points: s, color: colorUser })) : null}
          trail={(!snapOn || !snapped) && parcial.length >= 2 ? parcial : null}
          trailColor={colorUser}
          live={actual ? { lat: actual.lat, lng: actual.lng } : null}
          liveColor={colorUser}
          followLive={playing}
        />

        {/* Barra de reproducción */}
        <div style={{ ...panel, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={() => { if (idx >= pts.length - 1) setIdx(0); setPlaying((p) => !p) }} disabled={pts.length < 2}
            style={sx('width:44px;height:44px;border-radius:99px;border:none;background:var(--primary);color:var(--on-primary);cursor:pointer;display:grid;place-items:center;flex:none')}>
            {playing
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5v14l12-7z" /></svg>}
          </button>
          <input type="range" min="0" max={Math.max(0, pts.length - 1)} value={idx} onChange={(e) => { setPlaying(false); setIdx(+e.target.value) }} style={{ flex: 1, accentColor: '#0ABAB5', minWidth: 160 }} />
          <div style={sx('font-family:var(--font-mono);font-size:12px;color:var(--deep);font-weight:600;min-width:78px;text-align:center')}>{actual ? hhmm(actual.ts) : '--:--:--'}</div>
          <div style={sx('display:flex;gap:5px')}>
            {VELOCIDADES.map((v) => <button key={v} onClick={() => setVel(v)} style={btn(vel === v)}>{v}×</button>)}
          </div>
        </div>
      </div>

      {/* Panel lateral */}
      <div style={{ ...panel, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={label10}>Detalle de la jornada</div>
        {pts.length ? (
          <>
            <Stat label="Punto actual" value={`${idx + 1} / ${pts.length}`} />
            <Stat label="Distancia recorrida (total)" value={`${stats.km.toFixed(2)} km`} />
            <Stat label="Inicio" value={stats.desde ? hhmm(stats.desde) : '—'} />
            <Stat label="Fin" value={stats.hasta ? hhmm(stats.hasta) : '—'} />
            <Stat label="Coordenada" value={actual ? `${actual.lat.toFixed(5)}, ${actual.lng.toFixed(5)}` : '—'} mono />
          </>
        ) : (
          <div style={sx('padding:24px 4px;text-align:center;color:var(--faint);font-size:12.5px;line-height:1.6')}>
            Elegí un usuario y una fecha, y tocá <b>Cargar recorrido</b> para reproducir su jornada grabada.
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, mono }) {
  return (
    <div style={sx('padding:10px 12px;background:var(--surface2);border:1px solid var(--line);border-radius:12px')}>
      <div style={sx('font-size:9.5px;color:var(--faint);text-transform:uppercase;letter-spacing:.05em')}>{label}</div>
      <div style={{ ...sx('font-size:15px;font-weight:600;margin-top:3px'), fontFamily: mono ? 'var(--font-mono)' : 'inherit' }}>{value}</div>
    </div>
  )
}

const selectStyle = { ...sx('padding:9px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font-body);cursor:pointer') }
