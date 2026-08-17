import { useMemo, useState } from 'react'
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
  const { clientes: vigentes, clientesTodos, zonas, loading: catLoading, updateCliente, archivarClientes } = useCatalog()
  // Editar a profundidad y eliminar es permiso de GESTIÓN (la RLS clientes_upd/clientes_del lo
  // exige): admin, encargado y superadmin. El resto solo ve/ubica.
  const puedeEditar = rol === 'admin' || rol === 'encargado' || rol === 'superadmin'
  // El archivado MASIVO es del superadmin: borra de la vista 200 comercios de un toque y no hay
  // ninguna pantalla que muestre "qué pasó con la cartera". Es una acción de dueño del sistema.
  const puedeArchivar = rol === 'superadmin'

  const [selCli, setSelCli] = useState(null)
  const [importOpen, setImportOpen] = useState(false)
  const [soloSinUbicar, setSoloSinUbicar] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [verArchivados, setVerArchivados] = useState(false)
  const [seleccionando, setSeleccionando] = useState(false)
  const [sel, setSel] = useState(() => new Set())
  const [confirmarArchivo, setConfirmarArchivo] = useState(false)
  const [ultimoArchivado, setUltimoArchivado] = useState(null) // ids, para el "Deshacer"

  // Tocar la fila abierta la cierra: es lo que se espera de un acordeón.
  const alternar = (id) => setSelCli((actual) => (actual === id ? null : id))

  const archivados = clientesTodos.length - vigentes.length
  const cartera = verArchivados ? clientesTodos : vigentes

  // Buscador. NO es un extra: son ~2.000 filas sin paginar ni virtualizar, así que sin filtrar no
  // hay forma de encontrar nada — ni de seleccionar un subconjunto para archivarlo. Mismo criterio
  // que CatalogoTab, que ya lo necesitó con 700 productos.
  const listaMostrada = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const base = [...cartera].sort((a, b) => (a.activo === b.activo ? a.name.localeCompare(b.name) : a.activo ? 1 : -1))
    return base.filter((c) => {
      if (soloSinUbicar && c.lat != null) return false
      if (!q) return true
      return (c.name || '').toLowerCase().includes(q)
        || (c.codigo || '').toLowerCase().includes(q)
        || (c.loc || '').toLowerCase().includes(q)
    })
  }, [cartera, busqueda, soloSinUbicar])

  const sinUbicar = cartera.filter((c) => c.lat == null).length
  const porConfirmar = cartera.filter((c) => !c.activo).length

  const alternarSel = (id) => setSel((prev) => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  const salirSeleccion = () => { setSeleccionando(false); setSel(new Set()); setConfirmarArchivo(false) }

  async function archivarSeleccion() {
    const ids = [...sel]
    const n = ids.length
    await archivarClientes(ids, !verArchivados)
    setUltimoArchivado(verArchivados ? null : ids)
    salirSeleccion()
    onToast(verArchivados
      ? `${n} cliente${n === 1 ? '' : 's'} devuelto${n === 1 ? '' : 's'} a la cartera`
      : `${n} cliente${n === 1 ? '' : 's'} archivado${n === 1 ? '' : 's'}`)
  }

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

  /**
   * Casilla de selección. Es un `<span>` dibujado, no un `<input type=checkbox>`: el click lo
   * maneja la FILA entera (área táctil grande, que es lo que hace falta para marcar 195 de
   * corrido), así que un input real solo agregaría un segundo target y un estado que sincronizar.
   * El `role`/`aria-checked` mantienen la semántica para lectores de pantalla.
   */
  const Casilla = ({ marcada }) => (
    <span role="checkbox" aria-checked={marcada}
      style={{
        width: 20, height: 20, flex: 'none', borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center',
        border: `2px solid ${marcada ? 'var(--primary)' : 'var(--line2)'}`,
        background: marcada ? 'var(--primary)' : 'transparent',
        color: 'var(--on-primary)',
      }}>
      {marcada && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
    </span>
  )

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
            {archivados > 0 && (
              <button onClick={() => { setVerArchivados((v) => !v); setSel(new Set()) }} aria-pressed={verArchivados}
                title="El archivado no borra: los clientes siguen en la base y se pueden devolver a la cartera"
                style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:var(--r-pill);font-size:10.5px;font-weight:600;cursor:pointer'), color: verArchivados ? 'var(--on-primary)' : 'var(--muted)', background: verArchivados ? 'var(--muted)' : 'var(--surface2)', border: '1px solid var(--line)' }}>
                {archivados} archivado{archivados === 1 ? '' : 's'}
              </button>
            )}
          </div>
          <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
            {puedeArchivar && (
              <button onClick={() => (seleccionando ? salirSeleccion() : (setSelCli(null), setSeleccionando(true)))} className="lu-press"
                aria-pressed={seleccionando}
                style={{ ...sx('display:flex;align-items:center;gap:7px;border-radius:var(--r-md);padding:9px 13px;font-size:12.5px;font-weight:600;cursor:pointer'), background: seleccionando ? 'var(--primary)' : 'var(--surface)', color: seleccionando ? 'var(--on-primary)' : 'var(--text)', border: `1px solid ${seleccionando ? 'transparent' : 'var(--line2)'}` }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
                {seleccionando ? 'Cancelar' : 'Seleccionar'}
              </button>
            )}
            <button onClick={() => setImportOpen(true)} className="lu-press" style={sx('display:flex;align-items:center;gap:7px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:var(--r-md);padding:9px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V3M8 7l4-4 4 4M5 21h14" /></svg>Importar planilla
            </button>
            <button onClick={onNuevoCliente} className="lu-press" style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:var(--r-md);padding:9px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo cliente
            </button>
          </div>
        </div>

        {importOpen && <ImportarClientes onClose={() => setImportOpen(false)} onToast={onToast} />}

        {/* Buscador. El contenedor marca el foco con :focus-within — el input no lleva borde
            propio, así el campo se lee como una sola pieza. */}
        <div className="lu-campo" style={sx('display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-md);padding:0 12px;height:42px;margin-bottom:12px')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" style={{ flex: 'none' }}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" strokeLinecap="round" /></svg>
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, código o localidad…"
            style={sx('flex:1;min-width:0;border:none;outline:none;background:transparent;font-family:var(--font-body);font-size:13px;color:var(--text)')}
          />
          {busqueda && (
            <button onClick={() => setBusqueda('')} aria-label="Limpiar búsqueda"
              style={sx('width:22px;height:22px;flex:none;border:none;border-radius:var(--r-pill);background:var(--line);display:grid;place-items:center;font-size:12px;color:var(--muted);cursor:pointer')}>✕</button>
          )}
        </div>

        {/* Barra de acción de la selección. Aparece solo con algo seleccionado, para no ocupar
            lugar mientras el usuario todavía está eligiendo. */}
        {seleccionando && (
          <div style={{ ...sx('display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-radius:var(--r-md);margin-bottom:12px'), background: 'var(--primary-tint)', border: '1px solid var(--primary)' }}>
            <span style={sx('font-family:var(--font-mono);font-size:12.5px;font-weight:700;color:var(--deep)')}>
              {sel.size} seleccionado{sel.size === 1 ? '' : 's'}
            </span>
            <button onClick={() => setSel(new Set(listaMostrada.map((c) => c.id)))} className="lu-press"
              style={sx('background:transparent;border:none;color:var(--deep);font-size:12.5px;font-weight:600;cursor:pointer;text-decoration:underline')}>
              Seleccionar los {listaMostrada.length} de la lista
            </button>
            {sel.size > 0 && (
              <button onClick={() => setSel(new Set())} className="lu-press"
                style={sx('background:transparent;border:none;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer')}>
                Limpiar
              </button>
            )}
            <div style={sx('flex:1;min-width:8px')} />
            {sel.size > 0 && (confirmarArchivo ? (
              /* Confirmación en dos pasos INLINE. En todo el repo no hay un solo window.confirm:
                 el diálogo del navegador se puede suprimir y no se puede escribir bien. */
              <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
                <span style={sx('font-size:12px;color:var(--muted)')}>
                  {verArchivados ? `¿Devolver ${sel.size} a la cartera?` : `¿Archivar ${sel.size}? Se pueden recuperar después.`}
                </span>
                <button onClick={archivarSeleccion} className="lu-press"
                  style={sx('background:var(--primary);color:var(--on-primary);border:none;border-radius:var(--r-sm);padding:8px 14px;font-size:12.5px;font-weight:700;cursor:pointer')}>
                  Sí, {verArchivados ? 'devolver' : 'archivar'}
                </button>
                <button onClick={() => setConfirmarArchivo(false)} className="lu-press"
                  style={sx('background:transparent;border:none;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer')}>No</button>
              </div>
            ) : (
              <button onClick={() => setConfirmarArchivo(true)} className="lu-press"
                style={sx('background:var(--primary);color:var(--on-primary);border:none;border-radius:var(--r-sm);padding:9px 15px;font-size:12.5px;font-weight:700;cursor:pointer')}>
                {verArchivados ? `Devolver ${sel.size}` : `Archivar ${sel.size}`}
              </button>
            ))}
          </div>
        )}

        {/* Deshacer. Archivar es reversible, así que ofrecerlo cuesta nada y evita el sobresalto
            de ver desaparecer 195 filas de golpe. */}
        {ultimoArchivado && !seleccionando && (
          <div style={sx('display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:var(--r-md);margin-bottom:12px;background:var(--surface2);border:1px solid var(--line)')}>
            <span style={sx('flex:1;min-width:0;font-size:12.5px;color:var(--muted)')}>
              Se archivaron {ultimoArchivado.length} cliente{ultimoArchivado.length === 1 ? '' : 's'}.
            </span>
            <button onClick={async () => { await archivarClientes(ultimoArchivado, false); onToast('Listo, vuelven a la cartera'); setUltimoArchivado(null) }} className="lu-press"
              style={sx('background:transparent;border:1px solid var(--line2);border-radius:var(--r-sm);padding:7px 13px;color:var(--deep);font-size:12.5px;font-weight:700;cursor:pointer')}>
              Deshacer
            </button>
            <button onClick={() => setUltimoArchivado(null)} aria-label="Cerrar"
              style={sx('background:transparent;border:none;color:var(--faint);font-size:14px;cursor:pointer')}>✕</button>
          </div>
        )}

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
                  <div onClick={() => (seleccionando ? alternarSel(c.id) : alternar(c.id))} role="button" aria-expanded={seleccionando ? undefined : abierto}
                    style={{ ...sx('background:var(--surface2);padding:13px;cursor:pointer'), border: `1px solid ${sel.has(c.id) ? 'var(--primary)' : abierto ? 'var(--primary)' : 'var(--line)'}`, borderRadius: abierto ? 'var(--r-lg) var(--r-lg) 0 0' : 'var(--r-lg)', marginBottom: abierto ? 0 : 8 }}>
                    <div style={sx('display:flex;justify-content:space-between;align-items:flex-start;gap:8px')}>
                      {seleccionando && <Casilla marcada={sel.has(c.id)} />}
                      <div style={sx('min-width:0;flex:1')}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
              {/* Hueco del ancho de la casilla, para que los encabezados no se corran respecto
                  de las filas cuando el modo selección está activo. */}
              {seleccionando && <span style={{ width: 20, flex: 'none' }} />}
              <div style={{ ...cliGrid, ...sx('flex:1;min-width:0') }}>
                <span>Código</span><span>Razón social</span><span>Localidad</span><span>Días de visita</span><span>Frecuencia</span><span>Estado</span>
              </div>
            </div>
            {listaMostrada.map((c) => {
              const abierto = c.id === selCli
              return (
                <div key={c.id}>
                  <div onClick={() => (seleccionando ? alternarSel(c.id) : alternar(c.id))} role="button" aria-expanded={seleccionando ? undefined : abierto}
                    style={{
                      // La casilla va FUERA de la grilla de 6 columnas (`cliGrid`): meterla adentro
                      // como séptimo hijo desalinearía todos los encabezados.
                      display: 'flex', alignItems: 'center', gap: 10,
                      ...sx('padding:10px;font-size:12.5px;cursor:pointer'),
                      background: sel.has(c.id) ? 'var(--primary-tint)' : abierto ? 'var(--primary-tint)' : 'transparent',
                      // la fila abierta se une visualmente con su ficha
                      border: abierto ? '1px solid var(--primary)' : '1px solid transparent',
                      borderBottom: abierto ? 'none' : '1px solid var(--line)',
                      borderRadius: abierto ? 'var(--r-lg) var(--r-lg) 0 0' : 0,
                    }}>
                    {seleccionando && <Casilla marcada={sel.has(c.id)} />}
                    <div style={{ ...cliGrid, ...sx('flex:1;min-width:0;align-items:center') }}>
                    <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--deep);font-weight:600')}>{c.codigo || '—'}</span>
                    <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.name}</span>
                    <span style={sx('color:var(--muted)')}>{c.loc || '—'}</span>
                    <span style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--muted);letter-spacing:.04em')}>{c.dias || '—'}</span>
                    <span style={sx('color:var(--muted);font-size:12px')}>{c.frecuencia || '—'}</span>
                    <span onClick={(e) => e.stopPropagation()}>{chipEstado(c)}</span>
                    </div>
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
