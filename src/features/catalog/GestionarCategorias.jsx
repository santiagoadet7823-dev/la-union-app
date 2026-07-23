import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useCatalog } from '../../context/CatalogContext'
import Overlay from '../../components/Overlay'
import { inputStyle } from '../../components/form'
import { btnPrimario } from '../../lib/botones'

/**
 * Gestor de categorías del catálogo (agregar / renombrar / quitar). Las categorías se guardan
 * en la tabla `categorias` (gestionadas por empresa) y alimentan el selector del alta/edición.
 * Renombrar propaga el nombre a los productos; quitar manda sus productos a "Otros"
 * (la lógica vive en CatalogContext: addCategoria/updateCategoria/deleteCategoria).
 */
export default function GestionarCategorias({ onClose, onToast }) {
  const { categorias, productos, addCategoria, updateCategoria, deleteCategoria } = useCatalog()
  const [abierto, setAbierto] = useState(true)
  const [nueva, setNueva] = useState('')
  const [editId, setEditId] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)

  const cuenta = (nombre) => productos.filter((p) => p.cat === nombre).length

  async function agregar() {
    const n = nueva.trim()
    if (!n) return
    const { ok, error } = await addCategoria(n)
    if (!ok) { onToast?.(error?.message || 'No se pudo agregar'); return }
    setNueva('')
  }
  async function guardarEdicion(id) {
    const n = editVal.trim()
    if (!n) { setEditId(null); return }
    const { ok, error } = await updateCategoria(id, n)
    if (!ok) { onToast?.(error?.message || 'No se pudo renombrar'); return }
    setEditId(null)
  }
  async function quitar(c) {
    setConfirmDel(null)
    await deleteCategoria(c.id)
    const n = cuenta(c.nombre)
    onToast?.(n ? `Categoría eliminada · ${n} producto${n === 1 ? '' : 's'} pasaron a "Otros"` : 'Categoría eliminada')
  }

  return (
    <Overlay open={abierto} onClose={onClose} title="Categorías" maxWidth={440}
      footer={<button type="button" onClick={() => setAbierto(false)} className="lu-press" style={{ ...btnPrimario, flex: 1 }}>Listo</button>}
    >
      <div style={sx('font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:12px')}>
        Al <b>renombrar</b> una categoría, los productos que la usaban quedan con el nombre nuevo. Al <b>quitarla</b>, sus productos pasan a <b>"Otros"</b>.
      </div>

      {/* Agregar */}
      <div style={sx('display:flex;gap:8px;margin-bottom:14px')}>
        <input value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && agregar()} placeholder="Nueva categoría" style={inputStyle} className="lu-input" />
        <button onClick={agregar} style={sx('flex:none;padding:0 15px;border:none;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);font-size:13px;font-weight:600;cursor:pointer')}>Agregar</button>
      </div>

      {/* Lista */}
      {categorias.length === 0 ? (
        <div style={sx('padding:16px 2px;font-size:12.5px;color:var(--faint);line-height:1.5')}>Todavía no cargaste categorías. Agregá las que uses; mientras tanto, en el alta de producto podés elegir de la lista por defecto.</div>
      ) : (
        <div style={sx('display:flex;flex-direction:column;gap:6px')}>
          {categorias.map((c) => {
            const n = cuenta(c.nombre)
            return (
              <div key={c.id} style={sx('display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--line);border-radius:10px')}>
                {editId === c.id ? (
                  <>
                    <input autoFocus value={editVal} onChange={(e) => setEditVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') guardarEdicion(c.id); if (e.key === 'Escape') setEditId(null) }} style={{ ...inputStyle, minHeight: 34 }} className="lu-input" />
                    <button onClick={() => guardarEdicion(c.id)} style={sx('flex:none;padding:0 12px;height:34px;border:none;border-radius:9px;background:var(--primary);color:var(--on-primary);font-size:12px;font-weight:600;cursor:pointer')}>Guardar</button>
                    <button onClick={() => setEditId(null)} style={sx('flex:none;padding:0 10px;height:34px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer')}>No</button>
                  </>
                ) : confirmDel === c.id ? (
                  <>
                    <span style={sx('flex:1;font-size:12.5px;color:var(--danger)')}>¿Quitar "{c.nombre}"?{n ? ` (${n} → Otros)` : ''}</span>
                    <button onClick={() => quitar(c)} style={sx('flex:none;padding:0 12px;height:34px;border:none;border-radius:9px;background:var(--danger);color:#fff;font-size:12px;font-weight:600;cursor:pointer')}>Quitar</button>
                    <button onClick={() => setConfirmDel(null)} style={sx('flex:none;padding:0 10px;height:34px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer')}>No</button>
                  </>
                ) : (
                  <>
                    <span style={sx('flex:1;font-size:13.5px;font-weight:500')}>{c.nombre}</span>
                    <span style={sx('font-size:10.5px;color:var(--faint);font-family:var(--font-mono)')}>{n}</span>
                    <button onClick={() => { setEditId(c.id); setEditVal(c.nombre) }} title="Renombrar" style={sx('width:32px;height:32px;flex:none;display:grid;place-items:center;border:1px solid var(--line2);border-radius:8px;background:transparent;color:var(--deep);cursor:pointer')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                    </button>
                    <button onClick={() => setConfirmDel(c.id)} title="Quitar" style={sx('width:32px;height:32px;flex:none;display:grid;place-items:center;border:1px solid var(--line2);border-radius:8px;background:transparent;color:var(--danger);cursor:pointer')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>
                    </button>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </Overlay>
  )
}
