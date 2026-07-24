import { useMemo, useState } from 'react'
import { sx } from '../../../lib/sx'
import { fmtPesos, hoyStr } from '../../../lib/format'
import { useCatalog } from '../../../context/CatalogContext'
import { useDevice } from '../../../context/DeviceContext'
import { panel, label10, EmptyState, FilaTabla, CabeceraTabla } from '../ui'
import ImportarProductos from '../ImportarProductos'
import ImportarFotos from '../ImportarFotos'
import GestionarCategorias from '../../catalog/GestionarCategorias'
import { descargarArchivo } from '../../../services/download'

// Grilla del catálogo (escritorio): foto · código · descripción · categoría · precio · unid. · nivel · acciones.
// El CÓDIGO va visible y temprano: es la llave con la que se parean las fotos (el archivo se
// llama como el código) y con la que el import hace upsert. Sin verlo no se sabe qué foto va
// a qué producto, que es justo como se leía el catálogo en PDF.
const catGrid = { display: 'grid', gridTemplateColumns: '48px 76px 1.6fr 1fr 100px 62px 50px 92px', gap: 10 }

// Punto de color del nivel de rentabilidad (mismo código que ve el vendedor en el marco).
function NivelDot({ nivel }) {
  if (!(nivel >= 1 && nivel <= 4)) return <span style={sx('color:var(--faint)')}>—</span>
  return <span title={`Nivel ${nivel}`} style={{ ...sx('display:inline-block;width:16px;height:16px;border-radius:5px'), background: `var(--rent-${nivel})` }} />
}

function Thumb({ src }) {
  return (
    <div style={sx('width:40px;height:40px;border-radius:9px;overflow:hidden;background:var(--surface2);border:1px solid var(--line);display:grid;place-items:center;color:var(--faint)')}>
      {src ? <img src={src} alt="" style={sx('width:100%;height:100%;object-fit:cover')} /> : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
      )}
    </div>
  )
}

function PrecioCelda({ p }) {
  const enOferta = p.oferta && p.precioOferta != null
  return (
    <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-weight:600')}>
      {enOferta ? (
        <span style={sx('display:inline-flex;flex-direction:column;align-items:flex-end;line-height:1.25')}>
          <span style={sx('font-size:10px;color:var(--faint);text-decoration:line-through')}>{fmtPesos(p.price)}</span>
          <span style={sx('color:var(--warning)')}>{fmtPesos(p.precioOferta)}</span>
        </span>
      ) : (
        <span style={sx('color:var(--deep)')}>{fmtPesos(p.price)}</span>
      )}
    </span>
  )
}

/** Pestaña "Catálogo": ABM de los productos reales de la distribuidora. */
export default function CatalogoTab({ onNuevoProducto, onEditarProducto, onToast }) {
  const { productos, loading: catLoading, deleteProducto } = useCatalog()
  const { isMobile } = useDevice()
  const [confirmDel, setConfirmDel] = useState(null) // id con confirmación de borrado pendiente
  const [importOpen, setImportOpen] = useState(false)
  const [fotosOpen, setFotosOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('todos') // todos | sin-foto | sin-precio

  // Con ~700 productos la lista sola es inusable: sin buscador no se llega a editar uno, y
  // los que quedaron sin foto (o sin precio) son imposibles de encontrar a ojo.
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return productos.filter((p) => {
      if (filtro === 'sin-foto' && p.imagen) return false
      if (filtro === 'sin-precio' && p.price) return false
      if (!q) return true
      return (p.name || '').toLowerCase().includes(q)
        || (p.codigo || '').toLowerCase().includes(q)
        || (p.cat || '').toLowerCase().includes(q)
    })
  }, [productos, busqueda, filtro])

  const sinFoto = useMemo(() => productos.filter((p) => !p.imagen).length, [productos])
  const sinPrecio = useMemo(() => productos.filter((p) => !p.price).length, [productos])

  /**
   * Exporta el catálogo vivo a .xlsx con LAS MISMAS columnas que acepta "Importar planilla".
   * Es la otra mitad de la edición masiva: bajás, corregís en Excel (descripciones, precios,
   * categorías) y volvés a subir. El import hace upsert POR CÓDIGO y la actualización es
   * PARCIAL, así que las celdas que dejes vacías no borran lo que el producto ya tenía.
   *
   * La foto NO va en la planilla (vive en Storage, se carga con "Cargar fotos").
   */
  async function exportarCatalogo() {
    if (!productos.length) { onToast?.('El catálogo está vacío'); return }
    try {
      const XLSX = await import('xlsx')
      const filas = productos.map((p) => ({
        codigo: p.codigo || '',
        descripcion: p.name || '',
        precio: p.price || '',
        peso: p.kg || '',
        unidades: p.unidades != null ? p.unidades : '',
        categoria: p.cat || '',
        nivel: p.nivel != null ? p.nivel : '',
        oferta: p.oferta ? 'si' : 'no',
        precio_oferta: p.precioOferta != null ? p.precioOferta : '',
      }))
      const ws = XLSX.utils.json_to_sheet(filas)
      ws['!cols'] = [{ wch: 10 }, { wch: 44 }, { wch: 10 }, { wch: 8 }, { wch: 9 }, { wch: 18 }, { wch: 7 }, { wch: 7 }, { wch: 12 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Productos')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      await descargarArchivo({ filename: `catalogo-${hoyStr()}.xlsx`, blob: new Blob([buf], { type: mime }), mime })
      // Un producto sin código no se puede reimportar sobre sí mismo (el upsert es por código):
      // volvería a entrar como producto nuevo. Avisamos para que se los complete antes.
      const sinCodigo = productos.filter((p) => !p.codigo).length
      onToast?.(sinCodigo
        ? `Planilla descargada · ojo: ${sinCodigo} sin código (no se pueden reimportar)`
        : `Planilla descargada · ${filas.length} productos`)
    } catch (e) {
      onToast?.('No se pudo generar la planilla')
    }
  }

  async function eliminar(p) {
    setConfirmDel(null)
    await deleteProducto(p.id)
    onToast?.(`Producto "${p.name}" eliminado`)
  }

  const btnIcono = sx('width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;cursor:pointer;background:transparent')

  function Acciones({ p }) {
    if (confirmDel === p.id) {
      return (
        <div style={sx('display:flex;gap:6px;align-items:center;justify-content:flex-end')}>
          <button onClick={() => eliminar(p)} style={sx('height:34px;padding:0 10px;border:none;border-radius:9px;background:var(--danger);color:#fff;font-size:12px;font-weight:600;cursor:pointer')}>Eliminar</button>
          <button onClick={() => setConfirmDel(null)} style={sx('height:34px;padding:0 10px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer')}>No</button>
        </div>
      )
    }
    return (
      <div style={sx('display:flex;gap:6px;align-items:center;justify-content:flex-end')}>
        <button onClick={() => onEditarProducto?.(p)} title="Editar" style={{ ...btnIcono, color: 'var(--deep)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button>
        <button onClick={() => setConfirmDel(p.id)} title="Eliminar" style={{ ...btnIcono, color: 'var(--danger)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
        </button>
      </div>
    )
  }

  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box'), padding: isMobile ? 12 : 20, overflowX: isMobile ? 'visible' : 'auto' }}>
      <div style={{ ...panel, minWidth: isMobile ? 0 : 760 }}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px')}>
          <div style={label10}>
            Catálogo · {visibles.length === productos.length ? `${productos.length} productos` : `${visibles.length} de ${productos.length}`}
          </div>
          <div style={sx('display:flex;gap:8px;flex-wrap:wrap')}>
            <button onClick={() => setCatsOpen(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h18" /></svg>Categorías
            </button>
            <button onClick={exportarCatalogo} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>Descargar planilla
            </button>
            <button onClick={() => setImportOpen(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21V9M7 14l5-5 5 5M5 3h14" /></svg>Importar planilla
            </button>
            <button onClick={() => setFotosOpen(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>Cargar fotos
            </button>
            <button onClick={onNuevoProducto} style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo producto
            </button>
          </div>
        </div>
        {catLoading ? (
          <div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando catálogo…</div>
        ) : productos.length === 0 ? (
          <EmptyState titulo="El catálogo está vacío" texto="Cargá los productos de la distribuidora con “Nuevo producto”. Los vendedores los verán al tomar pedidos." />
        ) : (
          <>
            <div style={sx('display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px')}>
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar por descripción, código o categoría…"
                style={sx('flex:1;min-width:220px;height:36px;padding:0 12px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;box-sizing:border-box')}
              />
              {[
                { k: 'todos', t: `Todos (${productos.length})` },
                { k: 'sin-foto', t: `Sin foto (${sinFoto})` },
                { k: 'sin-precio', t: `Sin precio (${sinPrecio})` },
              ].map(({ k, t }) => (
                <button key={k} onClick={() => setFiltro(k)} style={{
                  ...sx('height:36px;padding:0 12px;border-radius:10px;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap'),
                  border: `1px solid ${filtro === k ? 'var(--primary)' : 'var(--line2)'}`,
                  background: filtro === k ? 'var(--primary)' : 'transparent',
                  color: filtro === k ? 'var(--on-primary)' : 'var(--muted)',
                }}>{t}</button>
              ))}
            </div>

            {visibles.length === 0 ? (
              <div style={sx('padding:34px;text-align:center;color:var(--faint);font-size:13px')}>
                Ningún producto coincide con la búsqueda.
              </div>
            ) : (<>
            <CabeceraTabla grid={catGrid} isMobile={isMobile} columnas={[
              'Foto', 'Código', 'Descripción', 'Categoría',
              { label: 'Precio', align: 'right' }, { label: 'Unid.', align: 'right' }, 'Nivel', '',
            ]} />
            {visibles.map((p) => (
              <FilaTabla key={p.id} grid={catGrid} isMobile={isMobile}
                acciones={<Acciones p={p} />}
                celdas={[
                  { label: 'Foto', contenido: <Thumb src={p.imagen} /> },
                  { label: 'Código', contenido: p.codigo || '—', estilo: sx('font-family:var(--font-mono);font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis') },
                  { label: 'Descripción', titulo: true, contenido: (
                    <span>{p.name}{p.oferta && <span style={sx('margin-left:7px;font-size:9.5px;font-weight:700;color:var(--warning);border:1px solid var(--warning);border-radius:99px;padding:1px 6px;vertical-align:middle')}>OFERTA</span>}</span>
                  ), estilo: sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis') },
                  { label: 'Categoría', contenido: p.cat, estilo: sx('color:var(--muted)') },
                  { label: 'Precio', contenido: <PrecioCelda p={p} /> },
                  { label: 'Unidades', contenido: p.unidades != null ? `×${p.unidades}` : '—', estilo: sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--muted)') },
                  { label: 'Nivel', contenido: <NivelDot nivel={p.nivel} /> },
                ]} />
            ))}
            </>)}
          </>
        )}
      </div>

      {catsOpen && <GestionarCategorias onClose={() => setCatsOpen(false)} onToast={onToast} />}
      {importOpen && <ImportarProductos onClose={() => setImportOpen(false)} onToast={onToast} />}
      {fotosOpen && <ImportarFotos onClose={() => setFotosOpen(false)} onToast={onToast} />}
    </div>
  )
}
