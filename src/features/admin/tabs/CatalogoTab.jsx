import { sx } from '../../../lib/sx'
import { fmtPesos, kgFmt } from '../../../lib/format'
import { useCatalog } from '../../../context/CatalogContext'
import { panel, label10, catGrid, EmptyState } from '../ui'

/** Pestaña "Catálogo": productos reales de la distribuidora. */
export default function CatalogoTab({ onNuevoProducto }) {
  const { productos, loading: catLoading } = useCatalog()

  return (
    <div className="lu-tabs" style={sx('flex:1;padding:20px;max-width:1100px;width:100%;margin:0 auto;box-sizing:border-box;overflow-x:auto')}>
      <div style={{ ...panel, minWidth: 700 }}>
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
            <div style={{ ...catGrid, ...sx('padding:8px 10px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);border-bottom:1px solid var(--line)') }}>
              <span>Código</span><span>Descripción</span><span>Categoría</span><span style={sx('text-align:right')}>Precio</span><span style={sx('text-align:right')}>Peso</span>
            </div>
            {productos.map((p) => (
              <div key={p.id} style={{ ...catGrid, ...sx('padding:10px;align-items:center;border-bottom:1px solid var(--line);font-size:12.5px') }}>
                <span style={sx('font-family:var(--font-mono);font-size:11px;color:var(--deep);font-weight:600')}>{p.codigo || '—'}</span>
                <span style={sx('font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{p.name}</span>
                <span style={sx('color:var(--muted)')}>{p.cat}</span>
                <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--deep);font-weight:600')}>{fmtPesos(p.price)}</span>
                <span style={sx('text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums;color:var(--muted)')}>{kgFmt(p.kg)} kg</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
