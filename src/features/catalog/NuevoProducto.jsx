import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import { useAuth } from '../../context/AuthContext'
import { CATEGORIAS } from '../../lib/categoria'
import { subirImagenProducto } from '../../services/data/productoImagen'
import { uid } from '../../lib/uid'
import Overlay from '../../components/Overlay'
import { Field, inputStyle } from '../../components/form'
import { btnPrimario, btnSecundario, apagado } from '../../lib/botones'

/**
 * Alta / edición de producto (modal). Lo usa el admin/encargado para cargar y mantener
 * el catálogo real de la distribuidora. Si recibe `producto` (forma de vista de
 * CatalogContext) entra en modo EDICIÓN; sin él, en ALTA.
 *
 * Campos visuales nuevos: foto (Storage, no la base), unidades por bulto, nivel de
 * rentabilidad (1..4 → color del marco del vendedor, NO es el margen real) y oferta.
 */
const NIVELES = [1, 2, 3, 4]

const soloNum = (s) => s.replace(/[^\d.]/g, '')

export default function NuevoProducto({ onClose, onToast, producto = null }) {
  const editar = !!producto
  const { addProducto, updateProducto, categorias } = useCatalog()
  const { idEmpresa } = useAuth()

  // Lista del selector: categorías gestionadas por la empresa + 'Otros'. Si la empresa todavía
  // no cargó ninguna, cae a la constante CATEGORIAS. Incluye la categoría actual del producto
  // aunque ya no esté en la lista, para no perderla al editar.
  const gestionadas = (categorias || []).map((c) => c.nombre)
  const opcionesCat = Array.from(new Set([
    ...(gestionadas.length ? gestionadas : CATEGORIAS),
    'Otros',
    ...(producto?.cat ? [producto.cat] : []),
  ]))

  const [descripcion, setDescripcion] = useState(producto?.name || '')
  const [codigo, setCodigo] = useState(producto?.codigo || '')
  const [precio, setPrecio] = useState(producto?.price ? String(producto.price) : '')
  const [peso, setPeso] = useState(producto?.kg ? String(producto.kg) : '')
  const [unidades, setUnidades] = useState(producto?.unidades != null ? String(producto.unidades) : '')
  const [categoria, setCategoria] = useState(producto?.cat || opcionesCat[0] || 'Otros')
  const [nivel, setNivel] = useState(producto?.nivel || null)
  const [oferta, setOferta] = useState(!!producto?.oferta)
  const [precioOferta, setPrecioOferta] = useState(producto?.precioOferta != null ? String(producto.precioOferta) : '')

  // Imagen: `preview` es lo que se muestra (URL actual o object URL del archivo elegido);
  // `file` es el archivo nuevo a subir (null si no se cambió).
  const [preview, setPreview] = useState(producto?.imagen || null)
  const [file, setFile] = useState(null)

  const [saving, setSaving] = useState(false)
  const [abierto, setAbierto] = useState(true) // ver Overlay.jsx: el padre monta condicionalmente

  function elegirArchivo(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }
  function quitarFoto() { setFile(null); setPreview(null) }

  async function guardar() {
    if (!descripcion.trim()) { onToast?.('Poné la descripción del producto'); return }
    setSaving(true)

    const base = {
      descripcion: descripcion.trim(),
      codigo: codigo.trim() || null,
      precio_unitario: Number(precio) || 0,
      peso_kg: Number(peso) || 0,
      unidades: unidades ? Math.round(Number(unidades)) : null,
      categoria,
      nivel_rentabilidad: nivel || null,
      oferta,
      precio_oferta: oferta && precioOferta ? Number(precioOferta) : null,
    }

    // El id se necesita antes de subir la foto (la ruta en Storage lo usa). En alta lo
    // generamos acá y se lo pasamos a addProducto para que la fila y el objeto compartan id.
    const id = editar ? producto.id : uid()

    // Subida de foto (requiere red). Es best-effort: si falla/está offline, el producto se
    // guarda igual sin tocar la imagen — el texto es offline-first, la foto se agrega después.
    let imagenPatch = {}
    if (file) {
      const { url, error } = await subirImagenProducto(idEmpresa, id, file)
      if (error) {
        onToast?.('El producto se guardó, pero la foto no pudo subirse (revisá la conexión).')
      } else {
        imagenPatch = { imagen_url: url }
      }
    } else if (editar && preview === null && producto.imagen) {
      // Se quitó la foto existente.
      imagenPatch = { imagen_url: null }
    }

    let res
    if (editar) {
      res = await updateProducto(id, { ...base, ...imagenPatch })
    } else {
      res = await addProducto({ id, ...base, ...imagenPatch })
    }
    setSaving(false)
    if (!res?.ok) { onToast?.('Error: ' + (res?.error?.message || 'no se pudo guardar')); return }
    onToast?.(editar ? `Producto "${base.descripcion}" actualizado` : `Producto "${base.descripcion}" agregado`)
    setAbierto(false)
  }

  return (
    <Overlay
      open={abierto}
      onClose={onClose}
      title={editar ? 'Editar producto' : 'Nuevo producto'}
      maxWidth={440}
      dismissible={!saving}
      footer={
        <>
          <button type="button" onClick={() => setAbierto(false)} disabled={saving} className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 16px', ...(saving ? apagado : null) }}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={saving} className="lu-press" style={{ ...btnPrimario, flex: 1, ...(saving ? apagado : null) }}>{saving ? 'Guardando…' : (editar ? 'Guardar cambios' : 'Guardar producto')}</button>
        </>
      }
    >
      {/* Foto del producto (opcional). Se comprime y sube a Storage; en la fila queda la URL. */}
      <Field label="Foto (opcional)">
        <div style={sx('display:flex;align-items:center;gap:12px')}>
          <div style={sx('width:64px;height:64px;flex:none;border-radius:12px;overflow:hidden;background:var(--surface2);border:1px solid var(--line2);display:grid;place-items:center;color:var(--faint)')}>
            {preview ? (
              <img src={preview} alt="" style={sx('width:100%;height:100%;object-fit:cover')} />
            ) : (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
            )}
          </div>
          <div style={sx('display:flex;flex-direction:column;gap:6px')}>
            <label className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 14px', height: 36, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              {preview ? 'Cambiar foto' : 'Subir foto'}
              <input type="file" accept="image/*" onChange={elegirArchivo} style={sx('display:none')} />
            </label>
            {preview && (
              <button type="button" onClick={quitarFoto} style={sx('background:none;border:none;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer;text-align:left;padding:0')}>Quitar foto</button>
            )}
          </div>
        </div>
      </Field>

      <Field label="Descripción *">
        <input value={descripcion} onChange={(e) => setDescripcion(e.target.value)} placeholder="Ej: Harina 000 1 kg" style={inputStyle} className="lu-input" />
      </Field>
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Código (opcional)"><input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="P-2031" style={inputStyle} className="lu-input" /></Field>
        <Field label="Categoría">
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={inputStyle} className="lu-input">
            {opcionesCat.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div style={sx('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
        <Field label="Precio unitario ($)"><input value={precio} onChange={(e) => setPrecio(soloNum(e.target.value))} inputMode="decimal" placeholder="7800" style={inputStyle} className="lu-input" /></Field>
        <Field label="Unidades por bulto"><input value={unidades} onChange={(e) => setUnidades(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="10" style={inputStyle} className="lu-input" /></Field>
      </div>
      <Field label="Peso (kg)"><input value={peso} onChange={(e) => setPeso(soloNum(e.target.value))} inputMode="decimal" placeholder="1" style={inputStyle} className="lu-input" /></Field>

      {/* Nivel de rentabilidad: el color del marco que ve el vendedor. El número/costo real
          NO se guarda ni viaja al celular; solo este nivel 1..4. */}
      <Field label="Nivel de rentabilidad (marco del vendedor)">
        <div style={sx('display:flex;gap:8px;align-items:center;flex-wrap:wrap')}>
          {NIVELES.map((n) => {
            const on = nivel === n
            return (
              <button
                key={n}
                type="button"
                onClick={() => setNivel(on ? null : n)}
                title={`Nivel ${n}`}
                style={{
                  ...sx('width:40px;height:34px;border-radius:9px;cursor:pointer;font-size:12px;font-weight:700;color:#fff;display:grid;place-items:center'),
                  background: `var(--rent-${n})`,
                  border: on ? '2px solid var(--text)' : '2px solid transparent',
                  opacity: on || nivel === null ? 1 : 0.4,
                }}
              >{n}</button>
            )
          })}
          <span style={sx('font-size:11px;color:var(--faint);margin-left:4px')}>{nivel ? `Nivel ${nivel}` : 'Sin definir'}</span>
        </div>
      </Field>

      {/* Oferta: switch + precio promocional. */}
      <Field label="Oferta">
        <div style={sx('display:flex;align-items:center;gap:10px')}>
          <button
            type="button"
            onClick={() => setOferta((v) => !v)}
            style={{
              ...sx('width:46px;height:26px;border-radius:99px;position:relative;cursor:pointer;border:none;flex:none;transition:background .15s'),
              background: oferta ? 'var(--primary)' : 'var(--line2)',
            }}
          >
            <span style={{ ...sx('position:absolute;top:3px;width:20px;height:20px;border-radius:99px;background:#fff;transition:left .15s'), left: oferta ? 23 : 3 }} />
          </button>
          <span style={sx('font-size:12.5px;color:var(--muted)')}>{oferta ? 'En oferta' : 'Precio normal'}</span>
        </div>
      </Field>
      {oferta && (
        <Field label="Precio de oferta ($)"><input value={precioOferta} onChange={(e) => setPrecioOferta(soloNum(e.target.value))} inputMode="decimal" placeholder="6900" style={inputStyle} className="lu-input" /></Field>
      )}
    </Overlay>
  )
}
