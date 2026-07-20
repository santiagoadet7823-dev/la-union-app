import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import Overlay from '../../components/Overlay'
import { Field, inputStyle } from '../../components/form'
import { btnPrimario, btnSecundario, apagado } from '../../lib/botones'

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
  const [abierto, setAbierto] = useState(true) // ver Overlay.jsx: el padre monta condicionalmente

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
    setAbierto(false)
  }

  return (
    <Overlay
      open={abierto}
      onClose={onClose}
      title="Nuevo producto"
      maxWidth={420}
      dismissible={!saving}
      footer={
        <>
          <button type="button" onClick={() => setAbierto(false)} disabled={saving} className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 16px', ...(saving ? apagado : null) }}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={saving} className="lu-press" style={{ ...btnPrimario, flex: 1, ...(saving ? apagado : null) }}>{saving ? 'Guardando…' : 'Guardar producto'}</button>
        </>
      }
    >
      <Field label="Descripción *">
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: Harina 000 1 kg ×10" style={inputStyle} className="lu-input" />
      </Field>
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Código (opcional)"><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="P-2031" style={inputStyle} className="lu-input" /></Field>
        <Field label="Categoría">
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={inputStyle} className="lu-input">
            {CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Precio unitario ($)"><input value={precio} onChange={(e) => setPrecio(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="7800" style={inputStyle} className="lu-input" /></Field>
        <Field label="Peso (kg)"><input value={peso} onChange={(e) => setPeso(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" placeholder="10" style={inputStyle} className="lu-input" /></Field>
      </div>
    </Overlay>
  )
}
