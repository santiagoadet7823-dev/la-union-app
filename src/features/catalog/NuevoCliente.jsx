import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { useTheme } from '../../context/ThemeContext'
import { pedirUbicacionUnaVez } from '../../services/geolocation'
import { CENTRO } from '../../data/demoGeo'
import LeafletMap from '../../components/LeafletMap'

/**
 * Alta de cliente (modal). La ubicación se fija tocando el mapa (pin) o con el
 * botón "Usar mi ubicación actual" (GPS del dispositivo). Lo usan vendedor,
 * repartidor y admin — cada empresa carga su propia cartera.
 */
const FRECUENCIAS = ['Semanal', 'Quincenal', 'Mensual']
const DIAS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']

export default function NuevoCliente({ onClose, onToast, center }) {
  const { addCliente } = useCatalog()
  const { theme } = useTheme()
  const [nombre, setNombre] = useState('')
  const [codigo, setCodigo] = useState('')
  const [localidad, setLocalidad] = useState('Las Lajitas')
  const [dias, setDias] = useState({})
  const [frecuencia, setFrecuencia] = useState('Semanal')
  const [horario, setHorario] = useState('')
  const [geofence, setGeofence] = useState(75)
  const [punto, setPunto] = useState(center || null) // {lat,lng}
  const [locBusy, setLocBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  const base = center || CENTRO

  async function usarMiUbicacion() {
    setLocBusy(true)
    try {
      const p = await pedirUbicacionUnaVez()
      setPunto({ lat: p.lat, lng: p.lng })
      onToast?.('Ubicación tomada del GPS')
    } catch {
      onToast?.('No se pudo obtener el GPS. Tocá el mapa para marcar el punto.')
    } finally {
      setLocBusy(false)
    }
  }

  async function guardar() {
    if (!nombre.trim()) { onToast?.('Poné el nombre del comercio'); return }
    if (!punto) { onToast?.('Marcá la ubicación en el mapa'); return }
    setSaving(true)
    const diasStr = DIAS.filter((d) => dias[d]).join(' · ')
    const res = await addCliente({
      nombre_comercio: nombre.trim(),
      codigo: codigo.trim() || null,
      localidad: localidad.trim() || null,
      lat: punto.lat,
      lng: punto.lng,
      dias_visita: diasStr || null,
      frecuencia,
      horario: horario.trim() || null,
      geofence_radio: geofence,
    })
    const { ok, error } = res
    setSaving(false)
    if (!ok) { onToast?.('Error: ' + (error?.message || 'no se pudo guardar')); return }
    onToast?.(res?.requiereConfirmacion
      ? `Cliente "${nombre.trim()}" enviado · queda pendiente de confirmación del admin`
      : `Cliente "${nombre.trim()}" agregado`)
    onClose?.()
  }

  return (
    <div style={sx('position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--scrim)')}>
      <div onClick={onClose} style={sx('position:absolute;inset:0')} />
      <div style={sx('position:relative;width:100%;max-width:460px;max-height:92vh;overflow-y:auto;background:var(--surface);border:1px solid var(--line2);border-radius:18px;box-shadow:var(--shadow-lg);padding:18px')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Nuevo cliente</div>
          <button onClick={onClose} style={sx('width:30px;height:30px;border-radius:8px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;font-size:16px')}>✕</button>
        </div>

        <Field label="Nombre del comercio *">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Kiosco San Martín" style={inp} />
        </Field>
        <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
          <Field label="Código (opcional)"><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="CLI-005" style={inp} /></Field>
          <Field label="Localidad"><input value={localidad} onChange={(e) => setLocalidad(e.target.value)} style={inp} /></Field>
        </div>

        <Field label="Ubicación *">
          <div style={sx('display:flex;gap:8px;margin-bottom:8px')}>
            <button onClick={usarMiUbicacion} disabled={locBusy} style={sx('flex:1;min-height:42px;border:1px solid var(--primary);border-radius:10px;background:var(--primary-tint);color:var(--deep);font-size:12.5px;font-weight:600;cursor:pointer')}>
              {locBusy ? 'Obteniendo…' : '📍 Usar mi ubicación actual'}
            </button>
          </div>
          <div style={sx('font-size:11px;color:var(--faint);margin-bottom:6px')}>…o tocá el mapa para marcar el punto exacto del comercio.</div>
          <LeafletMap
            theme={theme}
            height={200}
            zoom={15}
            center={punto || base}
            markers={punto ? [{ lat: punto.lat, lng: punto.lng, color: theme === 'dark' ? '#2DD4CE' : '#0ABAB5', title: nombre || 'Nuevo cliente' }] : []}
            onMapClick={(ll) => setPunto(ll)}
          />
          <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-top:6px')}>
            {punto ? `${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}` : 'Sin ubicación marcada'}
          </div>
        </Field>

        <Field label="Días de visita">
          <div style={sx('display:flex;gap:4px')}>
            {DIAS.map((d) => {
              const on = !!dias[d]
              return <button key={d} onClick={() => setDias((v) => ({ ...v, [d]: !v[d] }))} style={{ ...sx('flex:1;min-height:34px;border-radius:8px;font-family:var(--font-mono);font-size:10.5px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--faint)' }}>{d}</button>
            })}
          </div>
        </Field>

        <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
          <Field label="Frecuencia">
            <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)} style={inp}>
              {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>
          <Field label="Horario"><input value={horario} onChange={(e) => setHorario(e.target.value)} placeholder="08:00 – 13:00" style={inp} /></Field>
        </div>

        <Field label={`Radio de geofence · ${geofence} m`}>
          <input type="range" min="50" max="150" step="5" value={geofence} onChange={(e) => setGeofence(+e.target.value)} style={{ width: '100%', accentColor: '#0ABAB5' }} />
        </Field>

        <div style={sx('display:flex;gap:8px;margin-top:8px')}>
          <button onClick={onClose} style={sx('flex:none;min-height:46px;padding:0 16px;border:1px solid var(--line2);border-radius:12px;background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer')}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={sx('flex:1;min-height:46px;border:none;border-radius:12px;background:var(--primary);color:var(--on-primary);font-weight:600;font-size:14px;cursor:pointer')}>{saving ? 'Guardando…' : 'Guardar cliente'}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={sx('margin-bottom:12px')}>
      <div style={sx('font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px')}>{label}</div>
      {children}
    </div>
  )
}

const inp = { ...sx('width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;outline:none;font-family:var(--font-body)') }
