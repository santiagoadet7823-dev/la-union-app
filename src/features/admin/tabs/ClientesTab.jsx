import { useEffect, useRef, useState } from 'react'
import { sx } from '../../../lib/sx'
import { useTheme } from '../../../context/ThemeContext'
import { useDevice } from '../../../context/DeviceContext'
import { useCatalog } from '../../../context/CatalogContext'
import { useAuth } from '../../../context/AuthContext'
import useEmpresaBase from '../../../hooks/useEmpresaBase'
import LeafletMap from '../../../components/LeafletMap'
import ErrorBoundary from '../../../components/ErrorBoundary'
import ImportarClientes from '../ImportarClientes'
import { panel, label10, fieldLabel, cliGrid, miniLbl, EmptyState } from '../ui'

/**
 * Pestaña "Clientes": cartera real (tabla desktop / tarjetas mobile) + ficha editable
 * (geofence, días, frecuencia). Alta y confirmación de clientes cargados por móviles.
 */
export default function ClientesTab({ onToast, onNuevoCliente }) {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { idEmpresa, rol } = useAuth()
  const base = useEmpresaBase(idEmpresa) // dónde abre el mini-mapa al ubicar un cliente importado
  const { clientes: cartera, zonas, loading: catLoading, updateCliente, deleteCliente } = useCatalog()
  // Editar a profundidad y eliminar es permiso de GESTIÓN (la RLS clientes_upd/clientes_del lo
  // exige): admin, encargado y superadmin. El resto solo ve/ubica.
  const puedeEditar = rol === 'admin' || rol === 'encargado' || rol === 'superadmin'

  const [selCli, setSelCli] = useState(null)
  const fichaRef = useRef(null) // para traer la ficha a la vista en mobile al elegir un cliente
  const [geoRadio, setGeoRadio] = useState(75)
  const [diasSel, setDiasSel] = useState({ LU: true, JU: true })
  const [freqSel, setFreqSel] = useState('Semanal')
  const [importOpen, setImportOpen] = useState(false)
  const [puntoNuevo, setPuntoNuevo] = useState(null) // punto elegido para un cliente sin ubicación
  const [savingLoc, setSavingLoc] = useState(false)
  const [soloSinUbicar, setSoloSinUbicar] = useState(false)
  // Edición a profundidad de la ficha (solo gestión) + confirmación de baja.
  const [nombreEdit, setNombreEdit] = useState('')
  const [codigoEdit, setCodigoEdit] = useState('')
  const [locEdit, setLocEdit] = useState('')
  const [horarioEdit, setHorarioEdit] = useState('')
  const [zonaEdit, setZonaEdit] = useState(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Sincroniza los controles de la ficha (geofence/días/frecuencia) con el cliente elegido.
  useEffect(() => {
    setPuntoNuevo(null)
    setConfirmDel(false)
    const c = cartera.find((x) => x.id === selCli)
    if (!c) return
    setGeoRadio(c.geofence || 75)
    setFreqSel(c.frecuencia || 'Semanal')
    setNombreEdit(c.name || '')
    setCodigoEdit(c.codigo || '')
    setLocEdit(c.loc || '')
    setHorarioEdit(c.horario || '')
    setZonaEdit(c.idZona || null)
    const ds = {}
    ;(c.dias || '').split('·').map((s) => s.trim()).filter(Boolean).forEach((d) => { ds[d] = true })
    setDiasSel(ds)
  }, [selCli, cartera])

  // En mobile (APK incluido) la ficha se renderiza DEBAJO de la lista: al tocar un cliente hay
  // que traerla a la vista, si no "no aparece" (quedaba fuera de pantalla, debajo de miles de
  // filas). En desktop es columna sticky y no hace falta.
  useEffect(() => {
    if (isMobile && selCli && fichaRef.current) {
      fichaRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [selCli, isMobile])

  const fc = cartera.find((c) => c.id === selCli) || null
  const diasAll = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']
  const carteraSorted = [...cartera].sort((a, b) => (a.activo === b.activo ? a.name.localeCompare(b.name) : a.activo ? 1 : -1))
  const sinUbicar = cartera.filter((c) => c.lat == null).length
  const listaMostrada = soloSinUbicar ? carteraSorted.filter((c) => c.lat == null) : carteraSorted
  const porConfirmar = cartera.filter((c) => !c.activo).length
  const inp = sx('width:100%;box-sizing:border-box;padding:9px 11px;border:1px solid var(--line2);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px;font-family:var(--font-body);outline:none')

  async function guardarUbicacion() {
    if (!fc || !puntoNuevo) return
    setSavingLoc(true)
    const { ok, error } = await updateCliente(fc.id, { lat: puntoNuevo.lat, lng: puntoNuevo.lng })
    setSavingLoc(false)
    if (!ok) { onToast('Error: ' + (error?.message || '')); return }
    setPuntoNuevo(null)
    onToast(`${fc.name} ubicado`)
  }

  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;gap:14px;align-items:start;overflow-x:auto'), padding: isMobile ? 12 : 20, gridTemplateColumns: isMobile ? '1fr' : 'minmax(560px,1fr) 400px' }}>
      <div style={{ ...panel, minWidth: 0 }}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
          <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
            <div style={label10}>Clientes · {cartera.length}</div>
            {porConfirmar > 0 && <span style={sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600;color:var(--warning);background:var(--warning-tint)')}>{porConfirmar} por confirmar</span>}
            {sinUbicar > 0 && (
              <span onClick={() => setSoloSinUbicar((v) => !v)} title="Filtrar clientes sin ubicación en el mapa" style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600;cursor:pointer'), color: soloSinUbicar ? 'var(--on-primary)' : 'var(--info)', background: soloSinUbicar ? 'var(--primary)' : 'var(--surface2)', border: '1px solid var(--line)' }}>{sinUbicar} sin ubicar</span>
            )}
          </div>
          <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
            <button onClick={() => setImportOpen(true)} style={sx('display:flex;align-items:center;gap:7px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 7l4-4 4 4M5 21h14" /></svg>Importar planilla
            </button>
            <button onClick={onNuevoCliente} style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo cliente
            </button>
          </div>
        </div>
        {importOpen && <ImportarClientes onClose={() => setImportOpen(false)} onToast={onToast} />}
        {catLoading ? (
          <div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando cartera…</div>
        ) : cartera.length === 0 ? (
          <EmptyState titulo="Todavía no cargaste clientes" texto="Agregá tu primer comercio con “Nuevo cliente”. También los pueden cargar los vendedores y repartidores desde su celular." />
        ) : isMobile ? (
          <div style={sx('display:flex;flex-direction:column;gap:8px')}>
            {listaMostrada.map((c) => {
              const z = zonas.find((x) => x.id === c.idZona)
              return (
                <div key={c.id} onClick={() => setSelCli(c.id)} style={{ ...sx('background:var(--surface2);border-radius:14px;padding:13px;cursor:pointer'), border: `1px solid ${c.id === selCli ? 'var(--primary)' : 'var(--line)'}` }}>
                  <div style={sx('display:flex;justify-content:space-between;align-items:flex-start;gap:8px')}>
                    <div style={sx('min-width:0')}>
                      <div style={sx('font-size:14px;font-weight:600')}>{c.name}</div>
                      <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono);margin-top:2px')}>{c.codigo || '—'} · {c.loc || '—'}</div>
                    </div>
                    <span onClick={(e) => e.stopPropagation()} style={sx('flex:none')}>
                      {c.activo ? (
                        <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), background: 'var(--success-tint)', color: 'var(--success)' }}><span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: 'var(--success)' }} />Confirmado</span>
                      ) : (
                        <button onClick={async () => { const { ok, error } = await updateCliente(c.id, { activo: true }); onToast(ok ? `${c.name} confirmado` : 'Error: ' + (error?.message || '')) }} style={sx('display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--warning);border-radius:99px;background:var(--warning-tint);color:var(--warning);font-size:10.5px;font-weight:700;cursor:pointer')}>Confirmar</button>
                      )}
                    </span>
                  </div>
                  <div style={sx('display:flex;gap:16px;margin-top:10px;font-size:11px')}>
                    <div><span style={miniLbl}>Días</span><span style={sx('font-family:var(--font-mono);font-weight:600')}>{c.dias || '—'}</span></div>
                    <div><span style={miniLbl}>Frecuencia</span><span style={sx('font-weight:600')}>{c.frecuencia || '—'}</span></div>
                    <div><span style={miniLbl}>Zona</span><span style={{ ...sx('font-weight:600'), color: z?.color || 'var(--muted)' }}>{z?.nombre || '—'}</span></div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <>
            <div style={{ ...cliGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
              <span>Código</span><span>Razón social</span><span>Localidad</span><span>Días de visita</span><span>Frecuencia</span><span>Estado</span>
            </div>
            {listaMostrada.map((c) => (
              <div key={c.id} onClick={() => setSelCli(c.id)} style={{ ...cliGrid, ...sx('padding:10px;align-items:center;border-bottom:1px solid var(--line);font-size:12.5px;cursor:pointer'), background: c.id === selCli ? 'var(--primary-tint)' : 'transparent' }}>
                <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--deep);font-weight:600')}>{c.codigo || '—'}</span>
                <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</span>
                <span style={sx('color:var(--muted)')}>{c.loc || '—'}</span>
                <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--muted);letter-spacing:.04em')}>{c.dias || '—'}</span>
                <span style={sx('color:var(--muted);font-size:12px')}>{c.frecuencia || '—'}</span>
                <span onClick={(e) => e.stopPropagation()}>
                  {c.activo ? (
                    <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:99px;font-size:10.5px;font-weight:600'), background: 'var(--success-tint)', color: 'var(--success)' }}><span style={{ ...sx('width:5px;height:5px;border-radius:99px'), background: 'var(--success)' }} />Confirmado</span>
                  ) : (
                    <button onClick={async () => { const { ok, error } = await updateCliente(c.id, { activo: true }); onToast(ok ? `${c.name} confirmado` : 'Error: ' + (error?.message || '')) }} style={sx('display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:1px solid var(--warning);border-radius:99px;background:var(--warning-tint);color:var(--warning);font-size:10.5px;font-weight:700;cursor:pointer')}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>Confirmar
                    </button>
                  )}
                </span>
              </div>
            ))}
          </>
        )}
      </div>

      <div ref={fichaRef} style={isMobile ? panel : { ...panel, position: 'sticky', top: 12, alignSelf: 'start', maxHeight: 'calc(100vh - 24px)', overflowY: 'auto' }}>
        {fc ? (
          <>
            <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px')}>
              <div style={label10}>Ficha de cliente · Editar</div>
              <div style={sx('display:flex;align-items:center;gap:10px')}>
                <div style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--deep);font-weight:600')}>{fc.codigo || '—'}</div>
                {isMobile && <button onClick={() => setSelCli(null)} title="Cerrar ficha" style={sx('width:28px;height:28px;border-radius:8px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;font-size:15px;line-height:1')}>✕</button>}
              </div>
            </div>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>{fc.name}</div>
            <div style={sx('font-size:11.5px;color:var(--faint);font-family:var(--font-mono);margin:3px 0 14px')}>{fc.lat != null ? `${fc.lat.toFixed(5)}, ${fc.lng.toFixed(5)}` : 'Sin ubicación'}</div>

            {/* Datos del cliente — edición a profundidad (solo gestión). */}
            {puedeEditar && (
              <div style={sx('display:grid;gap:9px;margin-bottom:14px')}>
                <div>
                  <div style={fieldLabel}>Razón social</div>
                  <input value={nombreEdit} onChange={(e) => setNombreEdit(e.target.value)} placeholder="Nombre del comercio" style={inp} />
                </div>
                <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:9px')}>
                  <div>
                    <div style={fieldLabel}>Código</div>
                    <input value={codigoEdit} onChange={(e) => setCodigoEdit(e.target.value)} placeholder="—" style={inp} />
                  </div>
                  <div>
                    <div style={fieldLabel}>Localidad</div>
                    <input value={locEdit} onChange={(e) => setLocEdit(e.target.value)} placeholder="—" style={inp} />
                  </div>
                </div>
                <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:9px')}>
                  <div>
                    <div style={fieldLabel}>Horario</div>
                    <input value={horarioEdit} onChange={(e) => setHorarioEdit(e.target.value)} placeholder="—" style={inp} />
                  </div>
                  <div>
                    <div style={fieldLabel}>Zona</div>
                    <select value={zonaEdit || ''} onChange={(e) => setZonaEdit(e.target.value || null)} style={{ ...inp, cursor: 'pointer' }}>
                      <option value="">Sin zona</option>
                      {zonas.map((z) => <option key={z.id} value={z.id}>{z.numero != null ? `Z${z.numero} · ` : ''}{z.nombre}</option>)}
                    </select>
                  </div>
                </div>
                <div style={sx('font-size:10.5px;color:var(--faint);line-height:1.4')}>Al cambiar la zona, el cliente hereda el vendedor dueño de esa zona.</div>
              </div>
            )}

            {fc.lat != null ? (
              <div style={sx('margin-bottom:8px')}>
                <ErrorBoundary compact message="No se pudo cargar el mini-mapa.">
                  <LeafletMap theme={theme} height={260} zoom={16}
                    center={{ lat: fc.lat, lng: fc.lng }}
                    markers={[{ lat: fc.lat, lng: fc.lng, color: theme === 'dark' ? '#2DD4CE' : '#0ABAB5', title: fc.name }]}
                    circle={{ lat: fc.lat, lng: fc.lng, radiusM: geoRadio, color: theme === 'dark' ? '#2DD4CE' : '#0ABAB5' }}
                  />
                </ErrorBoundary>
              </div>
            ) : (
              // Cliente importado sin coordenadas: tocá el mapa para ubicarlo.
              <div style={sx('margin-bottom:12px')}>
                <div style={sx('font-size:11.5px;color:var(--warning);font-weight:600;margin-bottom:6px')}>Tocá el mapa para fijar la ubicación del cliente.</div>
                <ErrorBoundary compact message="No se pudo cargar el mini-mapa.">
                  <LeafletMap theme={theme} height={280} zoom={15}
                    center={puntoNuevo || base}
                    markers={puntoNuevo ? [{ lat: puntoNuevo.lat, lng: puntoNuevo.lng, color: theme === 'dark' ? '#2DD4CE' : '#0ABAB5', title: fc.name }] : []}
                    onMapClick={(p) => setPuntoNuevo({ lat: p.lat, lng: p.lng })}
                  />
                </ErrorBoundary>
                <button onClick={guardarUbicacion} disabled={!puntoNuevo || savingLoc} style={{ ...sx('width:100%;margin-top:8px;min-height:40px;display:grid;place-items:center;border:none;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer'), background: puntoNuevo ? 'var(--primary)' : 'var(--line2)', color: puntoNuevo ? 'var(--on-primary)' : 'var(--faint)' }}>
                  {savingLoc ? 'Guardando…' : 'Guardar ubicación'}
                </button>
              </div>
            )}
            <div style={sx('margin-bottom:14px')}>
              <div style={sx('display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px')}><span>Radio de geofence</span><span style={sx('font-family:var(--font-mono);color:var(--deep)')}>{geoRadio} m</span></div>
              <input type="range" min="50" max="150" step="5" value={geoRadio} onChange={(e) => setGeoRadio(+e.target.value)} style={{ width: '100%', accentColor: '#0ABAB5' }} />
            </div>

            <div style={fieldLabel}>Días de visita</div>
            <div style={sx('display:flex;gap:5px;margin-bottom:14px')}>
              {diasAll.map((d) => {
                const on = !!diasSel[d]
                return <div key={d} onClick={() => setDiasSel((v) => ({ ...v, [d]: !v[d] }))} style={{ ...sx('flex:1;min-height:36px;display:grid;place-items:center;border-radius:9px;font-family:var(--font-mono);font-size:10.5px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--faint)' }}>{d}</div>
              })}
            </div>

            <div style={fieldLabel}>Frecuencia</div>
            <div style={sx('display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px')}>
              {['Semanal', 'Quincenal', 'Mensual'].map((f) => {
                const on = freqSel === f
                return <div key={f} onClick={() => setFreqSel(f)} style={{ ...sx('min-height:38px;display:grid;place-items:center;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer'), border: `1px solid ${on ? 'var(--primary)' : 'var(--line)'}`, background: on ? 'var(--primary-tint)' : 'var(--surface)', color: on ? 'var(--deep)' : 'var(--muted)' }}>{f}</div>
              })}
            </div>

            <button onClick={async () => {
              const dias_visita = diasAll.filter((d) => diasSel[d]).join(' · ')
              const patch = { geofence_radio: geoRadio, dias_visita: dias_visita || null, frecuencia: freqSel }
              if (puedeEditar) {
                patch.nombre_comercio = nombreEdit.trim() || fc.name
                patch.codigo = codigoEdit.trim() || null
                patch.localidad = locEdit.trim() || null
                patch.horario = horarioEdit.trim() || null
                // Si cambió la zona, actualizarla y heredar el vendedor dueño (modelo "la zona lleva el vendedor").
                if ((zonaEdit || null) !== (fc.idZona || null)) {
                  patch.id_zona = zonaEdit || null
                  const zObj = zonas.find((z) => z.id === zonaEdit) || null
                  patch.id_vendedor = zObj?.id_vendedor || null
                }
              }
              const { ok, error } = await updateCliente(fc.id, patch)
              onToast(ok ? `${(puedeEditar ? nombreEdit.trim() : '') || fc.name} actualizado` : 'Error: ' + (error?.message || ''))
            }} style={sx('width:100%;min-height:44px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:13.5px;cursor:pointer')}>Guardar cambios</button>

            {/* Baja del cliente (solo gestión), con confirmación en dos pasos. */}
            {puedeEditar && (
              <div style={sx('margin-top:10px')}>
                {confirmDel ? (
                  <div style={sx('display:flex;flex-direction:column;gap:8px;padding:11px;border:1px solid var(--danger);border-radius:10px;background:var(--danger-tint)')}>
                    <span style={sx('font-size:12px;color:var(--danger);font-weight:600;line-height:1.4')}>¿Eliminar “{fc.name}”? Esta acción no se puede deshacer.</span>
                    <div style={sx('display:flex;gap:8px')}>
                      <button disabled={deleting} onClick={async () => {
                        setDeleting(true)
                        const { ok, error } = await deleteCliente(fc.id)
                        setDeleting(false); setConfirmDel(false)
                        if (ok) { setSelCli(null); onToast(`${fc.name} eliminado`) }
                        else onToast('Error al eliminar: ' + (error?.message || ''))
                      }} style={sx('flex:1;min-height:40px;border:none;border-radius:9px;background:var(--danger);color:#fff;font-weight:700;font-size:13px;cursor:pointer')}>{deleting ? 'Eliminando…' : 'Sí, eliminar'}</button>
                      <button disabled={deleting} onClick={() => setConfirmDel(false)} style={sx('flex:1;min-height:40px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer')}>Cancelar</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDel(true)} style={sx('width:100%;min-height:42px;display:flex;align-items:center;justify-content:center;gap:7px;background:transparent;color:var(--danger);border:1px solid var(--danger);border-radius:10px;font-weight:600;font-size:13px;cursor:pointer')}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    Eliminar cliente
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={sx('padding:40px 10px;text-align:center;color:var(--faint);font-size:12.5px')}>Seleccioná un cliente de la lista para ver y editar su ficha.</div>
        )}
      </div>
    </div>
  )
}
