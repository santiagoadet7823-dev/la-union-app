import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'

/**
 * Alta de producto (modal). Lo usa el admin/encargado para cargar el catálogo
 * real de la distribuidora. Sin datos de prueba: arranca vacío.
 */
const CATEGORIAS = ['Bebidas', 'Almacén', 'Galletitas y snacks', 'Limpieza', 'Perfumería', 'Otros']

export default function NuevoProducto({ onClose, onToast }) {
  const { addProducto } = useCatalog()
  const [descripcion, setDescripcion] = useState('')
  const [codigo, setCodigo] = useState('')
  const [precio, setPrecio] = useState('')
  const [peso, setPeso] = useState('')
  const [categoria, setCategoria] = useState('Almacén')
  const [saving, setSaving] = useState(false)

  async function guardar() {
    if (!descripcion.trim()) { onToast?.('Poné la descripción del producto'); return }
    setSaving(true)
    const { ok, error } = await addProducto({
      descripcion: descripcion.trim(),
      codigo: codigo.trim() || null,
      precio_unitario: Number(precio) || 0,
      peso_kg: Number(peso) || 0,
      categoria,
    })
    setSaving(false)
    if (!ok) { onToast?.('Error: ' + (error?.message || 'no se pudo guardar')); return }
    onToast?.(`Producto "${descripcion.trim()}" agregado`)
    onClose?.()
  }

  return (
    <div style={sx('position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--scrim)')}>
      <div onClick={onClose} style={sx('position:absolute;inset:0')} />
      <div style={sx('position:relative;width:100%;max-width:420px;background:var(--surface);border:1px solid var(--line2);border-radius:18px;box-shadow:var(--shadow-lg);padding:18px')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Nuevo producto</div>
          <button onClick={onClose} style={sx('width:30px;height:30px;border-radius:8px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;font-size:16px')}>✕</button>
        </div>

        <Field label="Descripción *">
          <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: Harina 000 1 kg ×10" style={inp} />
        </Field>
        <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
          <Field label="Código (opcional)"><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="P-2031" style={inp} /></Field>
          <Field label="Categoría">
            <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={inp}>
              {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </Field>
        </div>
        <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
          <Field label="Precio unitario ($)"><input value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="7800" style={inp} /></Field>
          <Field label="Peso (kg)"><input value={peso} onChange={(e) => setPeso(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="10" style={inp} /></Field>
        </div>

        <div style={sx('display:flex;gap:8px;margin-top:8px')}>
          <button onClick={onClose} style={sx('flex:none;min-height:46px;padding:0 16px;border:1px solid var(--line2);border-radius:12px;background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer')}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={sx('flex:1;min-height:46px;border:none;border-radius:12px;background:var(--primary);color:var(--on-primary);font-weight:600;font-size:14px;cursor:pointer')}>{saving ? 'Guardando…' : 'Guardar producto'}</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={sx('margin-bottom:12px')}>
      <div style={sx('font-size:11px;font-weight:600;color:var(--muted);margin-bottom:6px')}>{label}</div>
      {children}
    </div>
  )
}

const inp = { ...sx('width:100%;box-sizing:border-box;padding:10px 11px;border:1px solid var(--line2);border-radius:10px;background:var(--surface);color:var(--text);font-size:13px;outline:none;font-family:var(--font-body)') }
