import { useEffect, useState } from 'react'
import { sx } from '../../../lib/sx'
import { useTheme } from '../../../context/ThemeContext'
import { useDevice } from '../../../context/DeviceContext'
import { useCatalog } from '../../../context/CatalogContext'
import LeafletMap from '../../../components/LeafletMap'
import ErrorBoundary from '../../../components/ErrorBoundary'
import { panel, label10, fieldLabel, cliGrid, miniLbl, EmptyState } from '../ui'

/**
 * Pestaña "Clientes": cartera real (tabla desktop / tarjetas mobile) + ficha editable
 * (geofence, días, frecuencia). Alta y confirmación de clientes cargados por móviles.
 */
export default function ClientesTab({ onToast, onNuevoCliente }) {
  const { theme } = useTheme()
  const { isMobile } = useDevice()
  const { clientes: cartera, zonas, loading: catLoading, updateCliente } = useCatalog()

  const [selCli, setSelCli] = useState(null)
  const [geoRadio, setGeoRadio] = useState(75)
  const [diasSel, setDiasSel] = useState({ LU: true, JU: true })
  const [freqSel, setFreqSel] = useState('Semanal')

  // Sincroniza los controles de la ficha (geofence/días/frecuencia) con el cliente elegido.
  useEffect(() => {
    const c = cartera.find((x) => x.id === selCli)
    if (!c) return
    setGeoRadio(c.geofence || 75)
    setFreqSel(c.frecuencia || 'Semanal')
    const ds = {}
    ;(c.dias || '').split('·').map((s) => s.trim()).filter(Boolean).forEach((d) => { ds[d] = true })
    setDiasSel(ds)
  }, [selCli, cartera])

  const fc = cartera.find((c) => c.id === selCli) || null
  const diasAll = ['LU', 'MA', 'MI', 'JU', 'VI', 'SA', 'DO']
  const carteraSorted = [...cartera].sort((a, b) => (a.activo === b.activo ? a.name.localeCompare(b.name) : a.activo ? 1 : -1))
  const porConfirmar = cartera.filter((c) => !c.activo).length

  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1600px;width:100%;margin:0 auto;box-sizing:border-box;display:grid;gap:14px;align-items:start;overflow-x:auto'), padding: isMobile ? 12 : 20, gridTemplateColumns: isMobile ? '1fr' : 'minmax(560px,1fr) 400px' }}>
      <div style={{ ...panel, minWidth: 0 }}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
          <div style={sx('display:flex;align-items:center;gap:10px')}>
            <div style={label10}>Clientes · {cartera.length}</div>
            {porConfirmar > 0 && <span style={sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:10.5px;font-weight:600;color:var(--warning);background:var(--warning-tint)')}>{porConfirmar} por confirmar</span>}
          </div>
          <button onClick={onNuevoCliente} style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo cliente
          </button>
        </div>
        {catLoading ? (
          <div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando cartera…</div>
        ) : cartera.length === 0 ? (
          <EmptyState titulo="Todavía no cargaste clientes" texto="Agregá tu primer comercio con “Nuevo cliente”. También los pueden cargar los vendedores y repartidores desde su celular." />
        ) : isMobile ? (
          <div style={sx('display:flex;flex-direction:column;gap:8px')}>
            {carteraSorted.map((c) => {
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
            {carteraSorted.map((c) => (
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

      <div style={panel}>
        {fc ? (
          <>
            <div style={sx('display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px')}>
              <div style={label10}>Ficha de cliente · Editar</div>
              <div style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--deep);font-weight:600')}>{fc.codigo || '—'}</div>
            </div>
            <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>{fc.name}</div>
            <div style={sx('font-size:11.5px;color:var(--faint);font-family:var(--font-mono);margin:3px 0 14px')}>{fc.lat != null ? `${fc.lat.toFixed(5)}, ${fc.lng.toFixed(5)}` : 'Sin ubicación'}</div>

            {fc.lat != null && (
              <div style={sx('margin-bottom:8px')}>
                <ErrorBoundary compact message="No se pudo cargar el mini-mapa.">
                  <LeafletMap theme={theme} height={190} zoom={16}
                    center={{ lat: fc.lat, lng: fc.lng }}
                    markers={[{ lat: fc.lat, lng: fc.lng, color: theme === 'dark' ? '#2DD4CE' : '#0ABAB5', title: fc.name }]}
                    circle={{ lat: fc.lat, lng: fc.lng, radiusM: geoRadio, color: theme === 'dark' ? '#2DD4CE' : '#0ABAB5' }}
                  />
                </ErrorBoundary>
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
              const { ok, error } = await updateCliente(fc.id, { geofence_radio: geoRadio, dias_visita: dias_visita || null, frecuencia: freqSel })
              onToast(ok ? `${fc.name} actualizado` : 'Error: ' + (error?.message || ''))
            }} style={sx('width:100%;min-height:44px;display:grid;place-items:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:13.5px;cursor:pointer')}>Guardar cambios</button>
          </>
        ) : (
          <div style={sx('padding:40px 10px;text-align:center;color:var(--faint);font-size:12.5px')}>Seleccioná un cliente de la lista para ver y editar su ficha.</div>
        )}
      </div>
    </div>
  )
}
