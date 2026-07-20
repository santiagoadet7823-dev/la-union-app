import { sx } from '../../../lib/sx'
import { fmtPesos, kgFmt } from '../../../lib/format'
import { useCatalog } from '../../../context/CatalogContext'
import { useDevice } from '../../../context/DeviceContext'
import { panel, label10, catGrid, EmptyState, FilaTabla, CabeceraTabla } from '../ui'

/** Pestaña "Catálogo": productos reales de la distribuidora. */
export default function CatalogoTab({ onNuevoProducto }) {
  const { productos, loading: catLoading } = useCatalog()
  const { isMobile } = useDevice()

  return (
    <div className="lu-tabs" style={{ ...sx('flex:1;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box'), padding: isMobile ? 12 : 20, overflowX: isMobile ? 'visible' : 'auto' }}>
      {/* minWidth solo en escritorio: en el teléfono forzaba scroll horizontal */}
      <div style={{ ...panel, minWidth: isMobile ? 0 : 700 }}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
          <div style={label10}>Catálogo · {productos.length} productos</div>
          <button onClick={onNuevoProducto} style={sx('display:flex;align-items:center;gap:7px;background:var(--primary);color:var(--on-primary);border:none;border-radius:10px;padding:8px 13px;font-size:12.5px;font-weight:600;cursor:pointer')}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>Nuevo producto
          </button>
        </div>
        {catLoading ? (
          <div style={sx('padding:40px;text-align:center;color:var(--faint);font-family:var(--font-mono);font-size:12px')}>Cargando catálogo…</div>
        ) : productos.length === 0 ? (
          <EmptyState titulo="El catálogo está vacío" texto="Cargá los productos de la distribuidora con “Nuevo producto”. Los vendedores los verán al tomar pedidos." />
        ) : (
          <>
            <CabeceraTabla grid={catGrid} isMobile={isMobile} columnas={[
              'Código', 'Descripción', 'Categoría',
              { label: 'Precio', align: 'right' }, { label: 'Peso', align: 'right' },
            ]} />
            {productos.map((p) => (
              <FilaTabla key={p.id} grid={catGrid} isMobile={isMobile} celdas={[
                { label: 'Código', contenido: p.codigo || '—', estilo: sx('font-family:var(--font-mono);font-size:11px;color:var(--deep);font-weight:600') },
                { label: 'Descripción', titulo: true, contenido: p.name, estilo: sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis') },
                { label: 'Categoría', contenido: p.cat, estilo: sx('color:var(--muted)') },
                { label: 'Precio', contenido: fmtPesos(p.price), estilo: sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--deep);font-weight:600') },
                { label: 'Peso', contenido: `${kgFmt(p.kg)} kg`, estilo: sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--muted)') },
              ]} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}
