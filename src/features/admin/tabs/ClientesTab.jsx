import { useState } from 'react'
import { sx } from '../../../lib/sx'
import { useDevice } from '../../../context/DeviceContext'
import { useCatalog } from '../../../context/CatalogContext'
import { useAuth } from '../../../context/AuthContext'
import ImportarClientes from '../ImportarClientes'
import FichaCliente from './FichaCliente'
import { panel, label10, cliGrid, miniLbl, EmptyState } from '../ui'

/**
 * Pestaña "Clientes": cartera real (tabla en PC / tarjetas en teléfono). La ficha
 * editable se despliega EN LÍNEA, justo debajo de la fila que se tocó (acordeón).
 *
 * 20/07/2026 — Antes la ficha era una columna `sticky` a la derecha (grid
 * `minmax(560px,1fr) 400px`). Con una cartera de 2.000 clientes, tocar una fila
 * hacía aparecer el formulario del otro lado de la pantalla, lejos del renglón que
 * uno acababa de tocar. Ahora se abre donde está el dedo y la referencia visual no
 * se pierde. Como efecto secundario desapareció el `scrollIntoView` que hacía
 * falta en mobile para que la ficha "apareciera": ya no se va de pantalla.
 */
export default function ClientesTab({ onToast, onNuevoCliente }) {
  const { isMobile } = useDevice()
  const { rol } = useAuth()
  const { clientes: cartera, zonas, loading: catLoading, updateCliente } = useCatalog()
  // Editar a profundidad y eliminar es permiso de GESTIÓN (la RLS clientes_upd/clientes_del lo
  // exige): admin, encargado y superadmin. El resto solo ve/ubica.
  const puedeEditar = rol === 'admin' || rol === 'encargado' || rol === 'superadmin'

  const [selCli, setSelCli] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [soloSinUbicar, setSoloSinUbicar] = useState(false)

  // Tocar la fila abierta la cierra: es lo que se espera de un acordeón.
  const alternar = (id) => setSelCli((actual) => (actual === id ? null : id))

  const carteraSorted = [...cartera].sort((a, b) => (a.activo === b.activo ? a.name.localeCompare(b.name) : a.activo ? 1 : -1))
  const sinUbicar = cartera.filter((c) => c.lat == null).length
  const listaMostrada = soloSinUbicar ? carteraSorted.filter((c) => c.lat == null) : carteraSorted
  const porConfirmar = cartera.filter((c) => !c.activo).length

  // La ficha del cliente `c`, si es el abierto. `key` fuerza el remonte al cambiar
  // de cliente, que es lo que reinicia el estado de edición (ver FichaCliente).
  const fichaDe = (c) => c.id === selCli && (
    <FichaCliente key={c.id} cliente={c} puedeEditar={puedeEditar} onToast={onToast} onCerrar={() => setSelCli(null)} />
  )

  const chipEstado = (c) => (c.activo ? (
    <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:var(--r-pill);font-size:10.5px;font-weight:600'), background: 'var(--success-tint)', color: 'var(--success)' }}>
      <span style={{ ...sx('width:5px;height:5px;border-radius:var(--r-pill)'), background: 'var(--success)' }} />Confirmado
    </span>
  ) : (
    <button onClick={async () => { const { ok, error } = await updateCliente(c.id, { activo: true }); onToast(ok ? `${c.name} confirmado` : 'Error: ' + (error?.message || '')) }}
      className="lu-press" style={sx('display:inline-flex;align-items:center;gap:5px;padding:6px 11px;border:1px solid var(--warning);border-radius:var(--r-pill);background:var(--warning-tint);color:var(--warning);font-size:10.5px;font-weight:700;cursor:pointer')}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>Confirmar
    </button>
  ))

  // `overflow-x:auto` solo en PC: la tabla tiene 440px de columnas fijas (cliGrid) y en
  // una ventana angosta necesita scroll PROPIO. Sin eso el desborde se va al documento y
  // scrollea la página entera de costado. En teléfono son tarjetas, que no desbordan.
  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box'), padding: isMobile ? 12 : 20, overflowX: isMobile ? 'visible' : 'auto' }}>
      <div style={{ ...panel, minWidth: 0 }}>
        <div style={{ ...sx('display:flex;justify-content:space-between;margin-bottom:14px;gap:10px'), flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap')}>
            <div style={label10}>Clientes · {cartera.length}</div>
            {porConfirmar > 0 && <span style={sx('display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:var(--r-pill);font-size:10.5px;font-weight:600;color:var(--warning);background:var(--warning-tint)')}>{porConfirmar} por confirmar</span>}
            {sinUbicar > 0 && (
              <button onClick={() => setSoloSinUbicar((v) => !v)} aria-pressed={soloSinUbicar} title="Filtrar clientes sin ubicación en el mapa"
                style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:var(--r-pill);font-size:10.5px;font-weight:600;cursor:pointer'), color: soloSinUbicar ? 'var(--on-primary)' : 'var(--info)', background: soloSinUbicar ? 'var(--primary)' : 'var(--surface2)', border: '1px solid var(--line)' }}>
                {sinUbicar} sin ubicar
              </button>
            )}
          </div>
          <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
            <button onClick={() => setImportOpen(true)} className="lu-press" style={sx('display:flex;align-items:center;gap:7px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:var(--r-md);padding:9px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 7l4-4 4 4M5 21h14" /></svg>Importar planilla
            </button>
            <button onClick={onNuevoCliente} className="lu-press" style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:var(--r-md);padding:9px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
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
          /* ===== TELÉFONO: tarjetas ===== */
          <div style={sx('display:flex;flex-direction:column')}>
            {listaMostrada.map((c) => {
              const z = zonas.find((x) => x.id === c.idZona)
              const abierto = c.id === selCli
              return (
                <div key={c.id}>
                  <div onClick={() => alternar(c.id)} role="button" aria-expanded={abierto}
                    style={{ ...sx('background:var(--surface2);padding:13px;cursor:pointer'), border: `1px solid ${abierto ? 'var(--primary)' : 'var(--line)'}`, borderRadius: abierto ? 'var(--r-lg) var(--r-lg) 0 0' : 'var(--r-lg)', marginBottom: abierto ? 0 : 8 }}>
                    <div style={sx('display:flex;justify-content:space-between;align-items:flex-start;gap:8px')}>
                      <div style={sx('min-width:0')}>
                        <div style={sx('font-size:14px;font-weight:600')}>{c.name}</div>
                        <div style={sx('font-size:11px;color:var(--faint);font-family:var(--font-mono);margin-top:2px')}>{c.codigo || '—'} · {c.loc || '—'}</div>
                      </div>
                      <span onClick={(e) => e.stopPropagation()} style={sx('flex:none')}>{chipEstado(c)}</span>
                    </div>
                    <div style={sx('display:flex;gap:16px;margin-top:10px;font-size:11px')}>
                      <div><span style={miniLbl}>Días</span><span style={sx('font-family:var(--font-mono);font-weight:600')}>{c.dias || '—'}</span></div>
                      <div><span style={miniLbl}>Frecuencia</span><span style={sx('font-weight:600')}>{c.frecuencia || '—'}</span></div>
                      <div><span style={miniLbl}>Zona</span><span style={{ ...sx('font-weight:600'), color: z?.color || 'var(--muted)' }}>{z?.nombre || '—'}</span></div>
                    </div>
                  </div>
                  {fichaDe(c)}
                </div>
              )
            })}
          </div>
        ) : (
          /* ===== PC: tabla ===== */
          <>
            <div style={{ ...cliGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
              <span>Código</span><span>Razón social</span><span>Localidad</span><span>Días de visita</span><span>Frecuencia</span><span>Estado</span>
            </div>
            {listaMostrada.map((c) => {
              const abierto = c.id === selCli
              return (
                <div key={c.id}>
                  <div onClick={() => alternar(c.id)} role="button" aria-expanded={abierto}
                    style={{
                      ...cliGrid,
                      ...sx('padding:10px;align-items:center;font-size:12.5px;cursor:pointer'),
                      background: abierto ? 'var(--primary-tint)' : 'transparent',
                      // la fila abierta se une visualmente con su ficha
                      border: abierto ? '1px solid var(--primary)' : '1px solid transparent',
                      borderBottom: abierto ? 'none' : '1px solid var(--line)',
                      borderRadius: abierto ? 'var(--r-lg) var(--r-lg) 0 0' : 0,
                    }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--deep);font-weight:600')}>{c.codigo || '—'}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</span>
                    <span style={sx('color:var(--muted)')}>{c.loc || '—'}</span>
                    <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--muted);letter-spacing:.04em')}>{c.dias || '—'}</span>
                    <span style={sx('color:var(--muted);font-size:12px')}>{c.frecuencia || '—'}</span>
                    <span onClick={(e) => e.stopPropagation()}>{chipEstado(c)}</span>
                  </div>
                  {fichaDe(c)}
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
