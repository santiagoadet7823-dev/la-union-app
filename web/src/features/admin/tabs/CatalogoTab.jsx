import { useEffect, useMemo, useState } from 'react'
import { sx } from '../../../lib/sx'
import { fmtPesos, hoyStr } from '../../../lib/format'
import { useAuth } from '../../../context/AuthContext'
import { useCatalog } from '../../../context/CatalogContext'
import { useDevice } from '../../../context/DeviceContext'
import { panel, label10, EmptyState, FilaTabla, CabeceraTabla } from '../ui'
import ImportarProductos from '../ImportarProductos'
import ImportarFotos from '../ImportarFotos'
import GestionarCategorias from '../../catalog/GestionarCategorias'
import { descargarArchivo } from '../../../services/download'
import { Bajar, Basura, Editar, ImagenVacia, Mas, Subir } from '../../../components/icons'

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
        <ImagenVacia size={18} />
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

/**
 * Pestaña "Catálogo": ABM de los productos reales de la distribuidora.
 *
 * 🔴 GATE PROPIO (12/08/2026). Hasta hoy esta pantalla no comprobaba nada: el único control era la
 * lista del menú que la abre (`lib/gestion.js`). Eso alcanzaba mientras la montaban tres hosts que
 * ya filtraban, pero es un contrato implícito — el cuarto host que la monte sin acordarse expone
 * Eliminar, Importar y Cargar fotos a cualquiera. El gate real sigue siendo RLS (`productos_wr`),
 * así que esto no es la seguridad: es no ofrecer botones que van a fallar.
 *
 * props:
 *   - filtroPedido  {f, nonce} | null — filtro pedido desde afuera (el tablero de marketing).
 *                   Lleva `nonce` porque tocar dos veces el mismo contador tiene que volver a
 *                   aplicarlo; sin el sello, la prop no cambia y el efecto no corre (regla 41).
 */
export default function CatalogoTab({ onNuevoProducto, onEditarProducto, onToast, filtroPedido = null }) {
  const { rol, permisos } = useAuth()
  // `productosTodos` y no `productos`: esta pantalla es la única desde donde se puede volver a
  // poner en circulación algo dado de baja, así que necesita poder verlo.
  const { productosTodos, loading: catLoading, deleteProducto, updateProducto } = useCatalog()
  const { isMobile } = useDevice()
  const [confirmDel, setConfirmDel] = useState(null) // id con confirmación de borrado pendiente
  const [importOpen, setImportOpen] = useState(false)
  const [fotosOpen, setFotosOpen] = useState(false)
  const [catsOpen, setCatsOpen] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState('todos') // todos | sin-foto | sin-precio | sin-marca | descontinuados

  const puedeEditar = ['admin', 'encargado', 'superadmin', 'marketing'].includes(rol)
    || (Array.isArray(permisos) && permisos.includes('catalogo'))

  useEffect(() => {
    if (filtroPedido?.f) setFiltro(filtroPedido.f)
  }, [filtroPedido])

  // Los descontinuados quedan FUERA salvo que se los pida: son el estado excepcional, y mezclarlos
  // con el catálogo vivo haría que "sin foto" cuente productos que ya no se venden.
  const productos = useMemo(
    () => (filtro === 'descontinuados' ? productosTodos.filter((p) => p.descontinuado) : productosTodos.filter((p) => !p.descontinuado)),
    [productosTodos, filtro],
  )

  // Con ~700 productos la lista sola es inusable: sin buscador no se llega a editar uno, y
  // los que quedaron sin foto (o sin precio) son imposibles de encontrar a ojo.
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return productos.filter((p) => {
      if (filtro === 'sin-foto' && p.imagen) return false
      if (filtro === 'sin-precio' && p.price) return false
      if (filtro === 'sin-marca' && p.marca) return false
      if (!q) return true
      return (p.name || '').toLowerCase().includes(q)
        || (p.codigo || '').toLowerCase().includes(q)
        || (p.cat || '').toLowerCase().includes(q)
        || (p.marca || '').toLowerCase().includes(q)
    })
  }, [productos, busqueda, filtro])

  // Los contadores salen SIEMPRE de los vigentes, aunque el filtro activo sea "descontinuados":
  // son el trabajo pendiente del catálogo vivo, no del listado que se está mirando.
  const vigentes = useMemo(() => productosTodos.filter((p) => !p.descontinuado), [productosTodos])
  const sinFoto = useMemo(() => vigentes.filter((p) => !p.imagen).length, [vigentes])
  const sinPrecio = useMemo(() => vigentes.filter((p) => !p.price).length, [vigentes])
  const sinMarca = useMemo(() => vigentes.filter((p) => !p.marca).length, [vigentes])
  const deBaja = useMemo(() => productosTodos.filter((p) => p.descontinuado).length, [productosTodos])

  /**
   * Exporta el catálogo vivo a .xlsx con LAS MISMAS columnas que acepta "Importar planilla".
   * Es la otra mitad de la edición masiva: bajás, corregís en Excel (descripciones, precios,
   * categorías) y volvés a subir. El import hace upsert POR CÓDIGO y la actualización es
   * PARCIAL, así que las celdas que dejes vacías no borran lo que el producto ya tenía.
   *
   * La foto NO va en la planilla (vive en Storage, se carga con "Cargar fotos").
   *
   * Baja los VIGENTES, no lo que el filtro esté mostrando: si bajara lo filtrado, exportar mirando
   * "Sin foto" y volver a subir con "lista completa" daría de baja el resto del catálogo. Y no baja
   * los descontinuados porque reimportar esa planilla los resucitaría a todos.
   */
  async function exportarCatalogo() {
    if (!vigentes.length) { onToast?.('El catálogo está vacío'); return }
    try {
      const XLSX = await import('xlsx')
      const filas = vigentes.map((p) => ({
        codigo: p.codigo || '',
        descripcion: p.name || '',
        precio: p.price || '',
        peso: p.kg || '',
        unidades: p.unidades != null ? p.unidades : '',
        categoria: p.cat || '',
        marca: p.marca || '',
        unidad_venta: p.unidadVenta || '',
        nivel: p.nivel != null ? p.nivel : '',
        oferta: p.oferta ? 'si' : 'no',
        precio_oferta: p.precioOferta != null ? p.precioOferta : '',
      }))
      const ws = XLSX.utils.json_to_sheet(filas)
      // Un ancho por columna, en el mismo orden que `filas`. Si se agrega una columna arriba y acá
      // no, todas las siguientes quedan con el ancho de la anterior.
      ws['!cols'] = [{ wch: 10 }, { wch: 44 }, { wch: 10 }, { wch: 8 }, { wch: 9 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 7 }, { wch: 7 }, { wch: 12 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Productos')
      const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
      const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      await descargarArchivo({ filename: `catalogo-${hoyStr()}.xlsx`, blob: new Blob([buf], { type: mime }), mime })
      // Un producto sin código no se puede reimportar sobre sí mismo (el upsert es por código):
      // volvería a entrar como producto nuevo. Avisamos para que se los complete antes.
      const sinCodigo = vigentes.filter((p) => !p.codigo).length
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

  // Vuelta a circulación a mano. Existe porque la reactivación automática solo ocurre cuando el
  // producto REAPARECE en una lista importada, y a veces la baja fue un error de la planilla.
  async function reactivar(p) {
    await updateProducto(p.id, { descontinuado_ts: null })
    onToast?.(`"${p.name}" vuelve al catálogo`)
  }

  const btnIcono = sx('width:34px;height:34px;display:grid;place-items:center;border:1px solid var(--line2);border-radius:9px;cursor:pointer;background:transparent')

  function Acciones({ p }) {
    // Sin permiso de escritura no se dibuja ninguna acción: RLS las rechazaría igual, pero el
    // error llegaría lejos del toque (las mutaciones van por la write queue) y se leería como que
    // la app no anda.
    if (!puedeEditar) return null
    if (p.descontinuado) {
      return (
        <div style={sx('display:flex;gap:6px;align-items:center;justify-content:flex-end')}>
          <button onClick={() => reactivar(p)} style={sx('height:34px;padding:0 11px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--deep);font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap')}>Reactivar</button>
        </div>
      )
    }
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
          <Editar size={15} />
        </button>
        <button onClick={() => setConfirmDel(p.id)} title="Eliminar" style={{ ...btnIcono, color: 'var(--danger)' }}>
          <Basura size={15} />
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
            {puedeEditar && (
              <button onClick={() => setCatsOpen(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M3 12h18M3 17h18" /></svg>Categorías
              </button>
            )}
            <button onClick={exportarCatalogo} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer')}>
              <Bajar size={13} />Descargar planilla
            </button>
            {/* Todo lo que ESCRIBE queda detrás del gate. Descargar la planilla no: es lectura de lo
                que la pantalla ya está mostrando. */}
            {puedeEditar && <>
              <button onClick={() => setImportOpen(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <Subir size={13} />Importar planilla
              </button>
              <button onClick={() => setFotosOpen(true)} style={sx('display:flex;align-items:center;gap:6px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:10px;padding:8px 12px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <ImagenVacia size={13} w={2} />Cargar fotos
              </button>
              <button onClick={onNuevoProducto} style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
                <Mas size={13} w={2.5} />Nuevo producto
              </button>
            </>}
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
                { k: 'todos', t: `Todos (${vigentes.length})` },
                { k: 'sin-foto', t: `Sin foto (${sinFoto})` },
                { k: 'sin-precio', t: `Sin precio (${sinPrecio})` },
                { k: 'sin-marca', t: `Sin marca (${sinMarca})` },
                ...(deBaja ? [{ k: 'descontinuados', t: `De baja (${deBaja})` }] : []),
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
                  // La MARCA va acá adentro y no en una columna propia: es un dato de identificación
                  // que se lee junto al nombre, y una novena columna dejaría la tabla sin aire.
                  { label: 'Descripción', titulo: true, contenido: (
                    <span>
                      {p.marca && <span style={sx('margin-right:7px;font-size:9.5px;font-weight:700;color:var(--muted);background:var(--surface2);border-radius:99px;padding:2px 7px;vertical-align:middle')}>{p.marca}</span>}
                      {p.name}
                      {p.oferta && <span style={sx('margin-left:7px;font-size:9.5px;font-weight:700;color:var(--warning);border:1px solid var(--warning);border-radius:99px;padding:1px 6px;vertical-align:middle')}>OFERTA</span>}
                    </span>
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
