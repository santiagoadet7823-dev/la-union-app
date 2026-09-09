import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { useTheme } from '../../context/ThemeContext'
import { useGps } from '../../context/GpsContext'
import { pedirUbicacionUnaVez } from '../../services/geolocation'
import { CENTRO } from '../../data/demoGeo'
import LeafletMap from '../../components/LeafletMap'
import ErrorBoundary from '../../components/ErrorBoundary'
import Overlay from '../../components/Overlay'
import { Crosshair } from '../../components/icons'
import { btnPrimario, btnSecundario, apagado } from '../../lib/botones'
import { inputStyle } from '../../components/form'

/**
 * Edición ACOTADA de un cliente por el VENDEDOR: ubicación (mapa), días de visita y contacto.
 * No toca razón social/código/zona/etc. (eso es gestión).
 *
 * Sobre la RLS: `clientes_upd` acepta al rol `vendedor` sobre CUALQUIER cliente de su empresa, no
 * solo los que tiene asignados. Verificado contra la base viva el 09/09/2026 — y es lo que hace
 * que esta pantalla sirva de algo, porque ~1.980 de los 2.016 clientes no tienen `id_vendedor`.
 * (Este comentario decía lo contrario: la policy se amplió y quedó viejo.)
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
  const [telefono, setTelefono] = useState(c?.telefono || '')
  const [contacto, setContacto] = useState(c?.contacto || '')
  const [locBusy, setLocBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  // El padre monta este componente con `{editCliId && <EditarClienteVendedor …/>}`,
  // así que el estado de "abierto" tiene que vivir ACÁ: si dependiéramos del padre,
  // nos arrancaría del árbol antes de que corra la animación de salida. Cerramos
  // con setAbierto(false) y el Overlay avisa al padre recién cuando terminó.
  const [abierto, setAbierto] = useState(true)

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
    const patch = {
      dias_visita: diasStr || null,
      // Sin validar el formato a propósito: el "15" intercalado, los códigos de área de 2 a 4
      // dígitos y los locales sin área hacen que cualquier regex rebote números legítimos, y el
      // costo de rebotar es que el vendedor no anote nada. Se guarda como lo tipeó.
      telefono: telefono.trim() || null,
      contacto: contacto.trim() || null,
    }
    if (punto) { patch.lat = punto.lat; patch.lng = punto.lng }
    const { ok, error } = await updateCliente(c.id, patch)
    setSaving(false)
    if (!ok) { onToast?.('Error: ' + (error?.message || 'no se pudo guardar')); return }
    onToast?.(`${c.name} actualizado`)
    setAbierto(false)
  }

  return (
    <Overlay
      open={abierto}
      onClose={onClose}
      title="Editar cliente"
      subtitle={c.name}
      dismissible={!saving}
      footer={
        <>
          <button type="button" onClick={() => setAbierto(false)} disabled={saving} className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 16px', ...(saving ? apagado : null) }}>
            Cancelar
          </button>
          <button type="button" onClick={guardar} disabled={saving} className="lu-press" style={{ ...btnPrimario, flex: 1, ...(saving ? apagado : null) }}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </>
      }
    >
      {/* El contacto va PRIMERO: es lo que el vendedor anota parado frente al mostrador, y dejarlo
          abajo del mapa obligaba a pasar 230 px de Leaflet para llegar. `type="tel"` para que en el
          celular salga el teclado numérico. */}
      <div style={label}>Teléfono</div>
      <input
        value={telefono}
        onChange={(e) => setTelefono(e.target.value)}
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="Ej: 3877 123456"
        className="lu-input"
        style={{ ...inputStyle, marginBottom: 'var(--sp-3)' }}
      />

      <div style={label}>Contacto</div>
      <input
        value={contacto}
        onChange={(e) => setContacto(e.target.value)}
        placeholder="Con quién se habla en el comercio"
        className="lu-input"
        style={{ ...inputStyle, marginBottom: 'var(--sp-4)' }}
      />

      <div style={label}>Ubicación</div>
      <button type="button" onClick={usarMiUbicacion} disabled={locBusy} className="lu-press" style={{ ...sx('width:100%;min-height:44px;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid var(--primary);border-radius:var(--r-md);background:var(--primary-tint);color:var(--deep);font-size:var(--fs-sm);font-weight:600;margin-bottom:8px'), ...(locBusy ? apagado : { cursor: 'pointer' }) }}>
        <Crosshair />
        {locBusy ? 'Obteniendo…' : 'Usar mi ubicación actual'}
      </button>
      <div style={sx('font-size:var(--fs-xs);color:var(--faint);margin-bottom:8px')}>…o tocá el mapa para marcar el punto exacto del comercio.</div>

      {/* El contenedor redondea y recorta: sin esto los tiles de Leaflet quedan
          con esquinas rectas adentro de una card redondeada. */}
      <div style={sx('border-radius:var(--r-md);overflow:hidden;border:1px solid var(--line)')}>
        <ErrorBoundary compact message="No se pudo cargar el mapa.">
          <LeafletMap
            theme={theme}
            height={230}
            zoom={15}
            center={base}
            markers={punto ? [{ lat: punto.lat, lng: punto.lng, color: 'var(--primary)', title: c.name }] : []}
            onMapClick={(p) => setPunto({ lat: p.lat, lng: p.lng })}
          />
        </ErrorBoundary>
      </div>
      <div style={sx('font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--muted);margin-top:6px')}>
        {punto ? `${punto.lat.toFixed(5)}, ${punto.lng.toFixed(5)}` : 'Sin ubicación marcada'}
      </div>

      <div style={{ ...label, marginTop: 'var(--sp-4)' }}>Días de visita</div>
      <div style={sx('display:flex;gap:5px')}>
        {DIAS.map((d) => {
          const on = !!dias[d]
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              onClick={() => setDias((v) => ({ ...v, [d]: !v[d] }))}
              className="lu-press"
              style={{
                ...sx('flex:1;min-height:44px;display:grid;place-items:center;border-radius:var(--r-sm);font-family:var(--font-mono);font-size:var(--fs-2xs);font-weight:600;cursor:pointer'),
                border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`,
                background: on ? 'var(--primary-tint)' : 'var(--surface)',
                color: on ? 'var(--deep)' : 'var(--faint)',
              }}
            >
              {d}
            </button>
          )
        })}
      </div>
    </Overlay>
  )
}

const label = sx('font-size:var(--fs-xs);font-weight:600;color:var(--muted);margin-bottom:6px')
