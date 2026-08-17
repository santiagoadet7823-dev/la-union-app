import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { useTheme } from '../../../context/ThemeContext'
import { useCatalog } from '../../../context/CatalogContext'
import { useAuth } from '../../../context/AuthContext'
import useEmpresaBase from '../../../hooks/useEmpresaBase'
import LeafletMap from '../../../components/LeafletMap'
import ErrorBoundary from '../../../components/ErrorBoundary'
import { fieldLabel } from '../ui'

/**
 * Ficha editable de un cliente. Se despliega EN LÍNEA, justo debajo de la fila
 * que se tocó en la lista (acordeón).
 *
 * 20/07/2026 — Antes esto vivía dentro de ClientesTab como una columna `sticky` a
 * la derecha (grid `minmax(560px,1fr) 400px`). Editar un cliente hacía aparecer el
 * formulario lejos de la fila que uno acababa de tocar, y en la lista larga se
 * perdía la referencia de sobre cuál se estaba trabajando. En mobile ya se
 * renderizaba debajo, pero al final de TODA la lista, y hacía falta un
 * `scrollIntoView` para que "apareciera" — ese parche ya no hace falta: la ficha
 * se abre donde está el dedo.
 *
 * 🔑 El llamador la monta con `key={cliente.id}`. Eso hace que al cambiar de
 * cliente React remonte el componente y el estado de edición se reinicie solo,
 * sin ningún efecto de sincronización. No sacar esa key.
 *
 * props: { cliente, puedeEditar, onToast, onCerrar }
 */
const DIAS = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']
const FRECUENCIAS = ['Semanal', 'Quincenal', 'Mensual']

export default function FichaCliente({ cliente: fc, puedeEditar, onToast, onCerrar }) {
  const { theme } = useTheme()
  const { idEmpresa } = useAuth()
  const base = useEmpresaBase(idEmpresa) // dónde abre el mini-mapa si el cliente no tiene ubicación
  const { zonas, updateCliente, deleteCliente } = useCatalog()

  // Estado inicializado del cliente. Al remontar por `key`, arranca limpio.
  const [geoRadio, setGeoRadio] = useState(fc.geofence || 75)
  const [freqSel, setFreqSel] = useState(fc.frecuencia || 'Semanal')
  const [nombreEdit, setNombreEdit] = useState(fc.name || '')
  const [codigoEdit, setCodigoEdit] = useState(fc.codigo || '')
  const [locEdit, setLocEdit] = useState(fc.loc || '')
  const [horarioEdit, setHorarioEdit] = useState(fc.horario || '')
  const [zonaEdit, setZonaEdit] = useState(fc.idZona || null)
  const [diasSel, setDiasSel] = useState(() => {
    const ds = {}
    ;(fc.dias || '').split('·').map((s) => s.trim()).filter(Boolean).forEach((d) => { ds[d] = true })
    return ds
  })
  const [puntoNuevo, setPuntoNuevo] = useState(null)
  const [savingLoc, setSavingLoc] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const inp = sx('width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--line2);border-radius:var(--r-md);background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font-body)')

  async function guardarUbicacion() {
    if (!puntoNuevo) return
    setSavingLoc(true)
    const { ok, error } = await updateCliente(fc.id, { lat: puntoNuevo.lat, lng: puntoNuevo.lng })
    setSavingLoc(false)
    if (!ok) { onToast('Error: ' + (error?.message || '')); return }
    setPuntoNuevo(null)
    onToast(`${fc.name} ubicado`)
  }

  async function guardar() {
    setGuardando(true)
    const dias_visita = DIAS.filter((d) => diasSel[d]).join(' · ')
    const patch = { geofence_radio: geoRadio, dias_visita: dias_visita || null, frecuencia: freqSel }
    if (puedeEditar) {
      patch.nombre_comercio = nombreEdit.trim() || fc.name
      patch.codigo = codigoEdit.trim() || null
      patch.localidad = locEdit.trim() || null
      patch.horario = horarioEdit.trim() || null
      // Si cambió la zona, heredar el vendedor dueño ("la zona lleva el vendedor").
      if ((zonaEdit || null) !== (fc.idZona || null)) {
        patch.id_zona = zonaEdit || null
        const zObj = zonas.find((z) => z.id === zonaEdit) || null
        patch.id_vendedor = zObj?.id_vendedor || null
      }
    }
    const { ok, error } = await updateCliente(fc.id, patch)
    setGuardando(false)
    onToast(ok ? `${(puedeEditar ? nombreEdit.trim() : '') || fc.name} actualizado` : 'Error: ' + (error?.message || ''))
  }

  return (
    <div
      className="lu-rise"
      style={sx('border:1px solid var(--primary);border-top:none;border-radius:0 0 var(--r-lg) var(--r-lg);background:var(--surface);padding:16px;margin-bottom:10px')}
    >
      <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:12px')}>
        <div style={sx('min-width:0')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-lg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{fc.name}</div>
          <div style={sx('font-size:var(--fs-xs);color:var(--faint);font-family:var(--font-mono);margin-top:3px')}>
            {fc.lat != null ? `${fc.lat.toFixed(5)}, ${fc.lng.toFixed(5)}` : 'Sin ubicación'}
          </div>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar ficha" className="lu-press"
          style={sx('flex:none;width:44px;height:44px;display:grid;place-items:center;border-radius:var(--r-sm);border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Datos del cliente — edición a profundidad (solo gestión). */}
      {puedeEditar && (
        <div style={sx('display:grid;gap:9px;margin-bottom:14px')}>
          <div>
            <div style={fieldLabel}>Razón social</div>
            <input value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} placeholder="Nombre del comercio" className="lu-input" style={inp} />
          </div>
          <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:9px')}>
            <div>
              <div style={fieldLabel}>Código</div>
              <input value={codigoEdit} onChange={(e) => setCodigoEdit(e.target.value)} placeholder="—" className="lu-input" style={inp} />
            </div>
            <div>
              <div style={fieldLabel}>Localidad</div>
              <input value={locEdit} onChange={(e) => setLocEdit(e.target.value)} placeholder="—" className="lu-input" style={inp} />
            </div>
          </div>
          <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:9px')}>
            <div>
              <div style={fieldLabel}>Horario</div>
              <input value={horarioEdit} onChange={(e) => setHorarioEdit(e.target.value)} placeholder="—" className="lu-input" style={inp} />
            </div>
            <div>
              <div style={fieldLabel}>Zona</div>
              <select value={zonaEdit || ''} onChange={(e) => setZonaEdit(e.target.value || null)} className="lu-input" style={{ ...inp, cursor: 'pointer' }}>
                <option value="">Sin zona</option>
                {zonas.map((z) => <option key={z.id} value={z.id}>{z.numero != null ? `Z${z.numero} · ` : ''}{z.nombre}</option>)}
              </select>
            </div>
          </div>
          <div style={sx('font-size:10.5px;color:var(--faint);line-height:1.4')}>Al cambiar la zona, el cliente hereda el vendedor dueño de esa zona.</div>
        </div>
      )}

      {fc.lat != null ? (
        <div style={sx('margin-bottom:8px;border-radius:var(--r-md);overflow:hidden;border:1px solid var(--line)')}>
          <ErrorBoundary compact message="No se pudo cargar el mini-mapa.">
            <LeafletMap theme={theme} height={260} zoom={16}
              center={{ lat: fc.lat, lng: fc.lng }}
              markers={[{ lat: fc.lat, lng: fc.lng, color: 'var(--primary)', title: fc.name }]}
              circle={{ lat: fc.lat, lng: fc.lng, radiusM: geoRadio, color: 'var(--primary)' }}
            />
          </ErrorBoundary>
        </div>
      ) : (
        // Cliente importado sin coordenadas: tocá el mapa para ubicarlo.
        <div style={sx('margin-bottom:12px')}>
          <div style={sx('font-size:11.5px;color:var(--warning);font-weight:600;margin-bottom:6px')}>Tocá el mapa para fijar la ubicación del cliente.</div>
          <div style={sx('border-radius:var(--r-md);overflow:hidden;border:1px solid var(--line)')}>
            <ErrorBoundary compact message="No se pudo cargar el mini-mapa.">
              <LeafletMap theme={theme} height={280} zoom={15}
                center={puntoNuevo || base}
                markers={puntoNuevo ? [{ lat: puntoNuevo.lat, lng: puntoNuevo.lng, color: 'var(--primary)', title: fc.name }] : []}
                onMapClick={(p) => setPuntoNuevo({ lat: p.lat, lng: p.lng })}
              />
            </ErrorBoundary>
          </div>
          <button onClick={guardarUbicacion} disabled={!puntoNuevo || savingLoc} className="lu-press"
            style={{ ...sx('width:100%;margin-top:8px;min-height:44px;display:grid;place-items:center;border:none;border-radius:var(--r-md);font-weight:600;font-size:13px'), background: puntoNuevo ? 'var(--primary)' : 'var(--line2)', color: puntoNuevo ? 'var(--on-primary)' : 'var(--faint)', cursor: puntoNuevo && !savingLoc ? 'pointer' : 'not-allowed' }}>
            {savingLoc ? 'Guardando…' : 'Guardar ubicación'}
          </button>
        </div>
      )}

      <div style={sx('margin-bottom:14px')}>
        <div style={sx('display:flex;justify-content:space-between;font-size:var(--fs-xs);font-weight:600;color:var(--muted);margin-bottom:6px')}>
          <span>Radio de geofence</span><span style={sx('font-family:var(--font-mono);color:var(--deep)')}>{geoRadio} m</span>
        </div>
        {/* accentColor por token: estaba fijo en #0ABAB5 (el primary de light), así
            que en dark el slider quedaba del color equivocado. */}
        <input type="range" min="50" max="150" step="5" value={geoRadio} onChange={(e) => setGeoRadio(+e.target.value)} style={{ width: '100%', accentColor: 'var(--primary)' }} />
      </div>

      <div style={fieldLabel}>Días de visita</div>
      <div style={sx('display:flex;gap:5px;margin-bottom:14px')}>
        {DIAS.map((d) => {
          const on = !!diasSel[d]
          return (
            <button key={d} type="button" aria-pressed={on} onClick={() => setDiasSel((v) => ({ ...v, [d]: !v[d] }))} className="lu-press"
              style={{ ...sx('flex:1;min-height:44px;display:grid;place-items:center;border-radius:var(--r-sm);font-family:var(--font-mono);font-size:var(--fs-2xs);font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--faint)' }}>
              {d}
            </button>
          )
        })}
      </div>

      <div style={fieldLabel}>Frecuencia</div>
      <div style={sx('display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px')}>
        {FRECUENCIAS.map((f) => {
          const on = freqSel === f
          return (
            <button key={f} type="button" aria-pressed={on} onClick={() => setFreqSel(f)} className="lu-press"
              style={{ ...sx('min-height:44px;display:grid;place-items:center;border-radius:var(--r-md);font-size:12px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--muted)' }}>
              {f}
            </button>
          )
        })}
      </div>

      <button onClick={guardar} disabled={guardando} className="lu-press"
        style={{ ...sx('width:100%;min-height:46px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:var(--r-md);font-weight:600;font-size:13.5px'), ...(guardando ? { opacity: 0.55, cursor: 'not-allowed' } : { cursor: 'pointer' }) }}>
        {guardando ? 'Guardando…' : 'Guardar cambios'}
      </button>

      {/* Baja del cliente (solo gestión), con confirmación en dos pasos. */}
      {puedeEditar && (
        <div style={sx('margin-top:10px')}>
          {confirmDel ? (
            <div style={sx('display:flex;flex-direction:column;gap:8px;padding:11px;border:1px solid var(--danger);border-radius:var(--r-md);background:var(--danger-tint)')}>
              <span style={sx('font-size:12px;color:var(--danger);font-weight:600;line-height:1.4')}>¿Eliminar “{fc.name}”? Esta acción no se puede deshacer.</span>
              <div style={sx('display:flex;gap:8px')}>
                <button disabled={deleting} className="lu-press" onClick={async () => {
                  setDeleting(true)
                  const { ok, error } = await deleteCliente(fc.id)
                  setDeleting(false); setConfirmDel(false)
                  if (ok) { onCerrar(); onToast(`${fc.name} eliminado`) }
                  else onToast('Error al eliminar: ' + (error?.message || ''))
                }} style={sx('flex:1;min-height:44px;border:none;border-radius:var(--r-sm);background:var(--danger);color:#fff;font-weight:700;font-size:13px;cursor:pointer')}>{deleting ? 'Eliminando…' : 'Sí, eliminar'}</button>
                <button disabled={deleting} className="lu-press" onClick={() => setConfirmDel(false)} style={sx('flex:1;min-height:44px;border:1px solid var(--line2);border-radius:var(--r-sm);background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer')}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmDel(true)} className="lu-press" style={sx('width:100%;min-height:44px;display:flex;align-items:center;justify-content:center;gap:7px;background:transparent;color:var(--danger);border:1px solid var(--danger);border-radius:var(--r-md);font-weight:600;font-size:13px;cursor:pointer')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
              Eliminar cliente
            </button>
          )}
        </div>
      )}
    </div>
  )
}
