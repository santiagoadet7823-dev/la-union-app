import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { useTheme } from '../../context/ThemeContext'
import { useGps } from '../../context/GpsContext'
import { pedirUbicacionUnaVez } from '../../services/geolocation'
import { CENTRO } from '../../data/demoGeo'
import LeafletMap from '../../components/LeafletMap'
import ErrorBoundary from '../../components/ErrorBoundary'

/**
 * Edición ACOTADA de un cliente por el VENDEDOR: solo ubicación (mapa) y días de visita.
 * No toca razón social/código/zona/etc. (eso es gestión). La RLS `clientes_upd` ya permite al
 * vendedor actualizar SUS clientes (id_vendedor = auth.uid()); el llamador solo ofrece este
 * editor en los clientes propios, para no mostrar un "guardado" que el servidor no persiste.
 *
 * props: { clienteId, onClose, onToast }
 */
const DIAS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']

export default function EditarClienteVendedor({ clienteId, onClose, onToast }) {
  const { clientes, updateCliente } = useCatalog()
  const { theme } = useTheme()
  const { pos: livePos } = useGps()
  const c = clientes.find((x) => x.id === clienteId) || null

  const [punto, setPunto] = useState(c && c.lat != null ? { lat: c.lat, lng: c.lng } : null)
  const [dias, setDias] = useState(() => {
    const ds = {}
    ;(c?.dias || '').split('·').map((s) => s.trim()).filter(Boolean).forEach((d) => { ds[d] = true })
    return ds
  })
  const [locBusy, setLocBusy] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!c) return null
  const base = punto || livePos || CENTRO

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
    setSaving(true)
    const diasStr = DIAS.filter((d) => dias[d]).join(' · ')
    const patch = { dias_visita: diasStr || null }
    if (punto) { patch.lat = punto.lat; patch.lng = punto.lng }
    const { ok, error } = await updateCliente(c.id, patch)
    setSaving(false)
    if (!ok) { onToast?.('Error: ' + (error?.message || 'no se pudo guardar')); return }
    onToast?.(`${c.name} actualizado`)
    onClose?.()
  }

  return (
    <div className="lu-modal-scrim" style={sx('position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--scrim)')}>
      <div onClick={onClose} style={sx('position:absolute;inset:0')} />
      <div className="lu-modal-card" style={sx('position:relative;width:100%;max-width:460px;max-height:92vh;overflow-y:auto;background:var(--surface);border:1px solid var(--line2);border-radius:18px;box-shadow:var(--shadow-lg);padding:18px')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:4px')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Editar cliente</div>
          <button onClick={onClose} style={sx('width:30px;height:30px;border-radius:8px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;font-size:16px')}>✕</button>
        </div>
        <div style={sx('font-size:12.5px;color:var(--muted);margin-bottom:14px')}>{c.name}</div>

        <div style={sx('font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px')}>Ubicación</div>
        <div style={sx('display:flex;gap:8px;margin-bottom:8px')}>
          <button onClick={usarMiUbicacion} disabled={locBusy} style={sx('flex:1;min-height:42px;border:1px solid var(--primary);border-radius:10px;background:var(--primary-tint);color:var(--deep);font-size:12.5px;font-weight:600;cursor:pointer')}>
            {locBusy ? 'Obteniendo…' : '📍 Usar mi ubicación actual'}
          </button>
        </div>
        <div style={sx('font-size:11px;color:var(--faint);margin-bottom:6px')}>…o tocá el mapa para marcar el punto exacto del comercio.</div>
        <ErrorBoundary compact message="No se pudo cargar el mapa.">
          <LeafletMap
            theme={theme}
            height={230}
            zoom={15}
            center={base}
            markers={punto ? [{ lat: punto.lat, lng: punto.lng, color: theme === 'dark' ? '#2DD4CE' : '#0ABAB5', title: c.name }] : []}
            onMapClick={(p) => setPunto({ lat: p.lat, lng: p.lng })}
          />
        </ErrorBoundary>
        <div style={sx('font-family:var(--font-mono);font-size:11px;color:var(--muted);margin-top:6px')}>
          {punto ? `${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}` : 'Sin ubicación marcada'}
        </div>

        <div style={sx('font-size:11px;font-weight:600;color:var(--muted);margin:16px 0 6px')}>Días de visita</div>
        <div style={sx('display:flex;gap:5px')}>
          {DIAS.map((d) => {
            const on = !!dias[d]
            return <div key={d} onClick={() => setDias((v) => ({ ...v, [d]: !v[d] }))} style={{ ...sx('flex:1;min-height:38px;display:grid;place-items:center;border-radius:9px;font-family:var(--font-mono);font-size:10.5px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--faint)' }}>{d}</div>
          })}
        </div>

        <div style={sx('display:flex;gap:8px;margin-top:18px')}>
          <button onClick={onClose} style={sx('flex:none;min-height:46px;padding:0 16px;border:1px solid var(--line2);border-radius:12px;background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer')}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={sx('flex:1;min-height:46px;border:none;border-radius:12px;background:var(--primary);color:var(--on-primary);font-weight:600;font-size:14px;cursor:pointer')}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </div>
    </div>
  )
}
