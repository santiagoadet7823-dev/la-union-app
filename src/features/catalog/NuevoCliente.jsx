import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { useTheme } from '../../context/ThemeContext'
import { pedirUbicacionUnaVez } from '../../services/geolocation'
import { CENTRO } from '../../data/demoGeo'
import LeafletMap from '../../components/LeafletMap'
import Overlay from '../../components/Overlay'
import { Field, inputStyle } from '../../components/form'
import { Crosshair } from '../../components/icons'
import { btnPrimario, btnSecundario, apagado } from '../../lib/botones'

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
  const [abierto, setAbierto] = useState(true) // ver Overlay.jsx: el padre monta condicionalmente

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
    setAbierto(false)
  }

  return (
    <Overlay
      open={abierto}
      onClose={onClose}
      title="Nuevo cliente"
      dismissible={!saving}
      footer={
        <>
          <button type="button" onClick={() => setAbierto(false)} disabled={saving} className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 16px', ...(saving ? apagado : null) }}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={saving} className="lu-press" style={{ ...btnPrimario, flex: 1, ...(saving ? apagado : null) }}>{saving ? 'Guardando…' : 'Guardar cliente'}</button>
        </>
      }
    >
      <Field label="Nombre del comercio *">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Kiosco San Martín" style={inputStyle} className="lu-input" />
      </Field>
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Código (opcional)"><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="CLI-005" style={inputStyle} className="lu-input" /></Field>
        <Field label="Localidad"><input value={localidad} onChange={(e) => setLocalidad(e.target.value)} style={inputStyle} className="lu-input" /></Field>
      </div>

      <Field label="Ubicación *">
        <button type="button" onClick={usarMiUbicacion} disabled={locBusy} className="lu-press" style={{ ...sx('width:100%;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--primary);border-radius:var(--r-md);background:var(--primary-tint);color:var(--deep);font-size:var(--fs-sm);font-weight:600;margin-bottom:8px'), ...(locBusy ? apagado : { cursor: 'pointer' }) }}>
          <Crosshair />
          {locBusy ? 'Obteniendo…' : 'Usar mi ubicación actual'}
        </button>
        <div style={sx('font-size:var(--fs-xs);color:var(--faint);margin-bottom:6px')}>…o tocá el mapa para marcar el punto exacto del comercio.</div>
        {/* redondeo + recorte: sin esto los tiles cortan en esquinas rectas */}
        <div style={sx('border-radius:var(--r-md);overflow:hidden;border:1px solid var(--line)')}>
          <LeafletMap
            theme={theme}
            height={200}
            zoom={15}
            center={punto || base}
            markers={punto ? [{ lat: punto.lat, lng: punto.lng, color: 'var(--primary)', title: nombre || 'Nuevo cliente' }] : []}
            onMapClick={(ll) => setPunto(ll)}
          />
        </div>
        <div style={sx('font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--muted);margin-top:6px')}>
          {punto ? `${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}` : 'Sin ubicación marcada'}
        </div>
      </Field>

      <Field label="Días de visita">
        <div style={sx('display:flex;gap:4px')}>
          {DIAS.map((d) => {
            const on = !!dias[d]
            return <button key={d} type="button" aria-pressed={on} onClick={() => setDias((v) => ({ ...v, [d]: !v[d] }))} className="lu-press" style={{ ...sx('flex:1;min-height:44px;border-radius:var(--r-sm);font-family:var(--font-mono);font-size:var(--fs-2xs);font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line2)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--faint)' }}>{d}</button>
          })}
        </div>
      </Field>

      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Frecuencia">
          <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)} style={inputStyle} className="lu-input">
            {FRECUENCIAS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Field>
        <Field label="Horario"><input value={horario} onChange={(e) => setHorario(e.target.value)} placeholder="08:00 – 13:00" style={inputStyle} className="lu-input" /></Field>
      </div>

      <Field label={`Radio de geofence · ${geofence} m`}>
        {/* accentColor va por token: estaba fijo en #0ABAB5 (el primary de light),
            así que en dark el slider quedaba del color equivocado. */}
        <input type="range" min="50" max="150" step="5" value={geofence} onChange={(e) => setGeofence(+e.target.value)} style={{ width: '100%', accentColor: 'var(--primary)' }} />
      </Field>
    </Overlay>
  )
}
