import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'
import { initials } from '../../lib/format'
import { subirAvatar } from '../../services/data/productoImagen'
import Overlay from '../../components/Overlay'
import { Field, inputStyle } from '../../components/form'
import { btnSecundario, btnPrimario, apagado } from '../../lib/botones'

/**
 * Edición del PROPIO perfil (nombre + teléfono). Reutilizable en las 3 shells
 * (SupervisionDesktop, SupervisionMovil, AppShell): cada integrante edita su
 * nombre y carga su teléfono para que la dirección tenga su contacto.
 *
 * Guarda vía `actualizarMiPerfil` (AuthContext → RPC `actualizar_mi_perfil`,
 * SECURITY DEFINER): un usuario común puede editar SOLO su nombre/teléfono, sin
 * tocar rol/empresa ni filas ajenas. El email y el rol se muestran solo-lectura.
 *
 * Es un overlay `position:fixed` con z-index alto, así queda por ENCIMA del mapa
 * de Leaflet en la PWA (no sufre el problema de stacking del menú de cuenta).
 *
 * props: { onClose, onToast }
 */
const ROLE_LABEL = { propietario: 'Propietario', encargado: 'Encargado', admin: 'Administrador', superadmin: 'Superadmin', vendedor: 'Vendedor', repartidor: 'Repartidor' }

export default function MiPerfilModal({ onClose, onToast }) {
  const { perfil, user, rol, actualizarMiPerfil } = useAuth()
  const [nombre, setNombre] = useState(perfil?.nombre || '')
  const [telefono, setTelefono] = useState(perfil?.telefono || '')
  const [saving, setSaving] = useState(false)
  // Foto: `preview` es lo que se muestra; `file` el archivo nuevo a subir (null si no cambió);
  // `fotoTocada` marca que se eligió/quitó una foto (para que el RPC toque foto_url solo entonces).
  const [preview, setPreview] = useState(perfil?.foto_url || null)
  const [file, setFile] = useState(null)
  const [fotoTocada, setFotoTocada] = useState(false)
  // El llamador monta este modal condicionalmente, así que el "abierto" vive acá
  // para que la animación de salida alcance a correr. Ver Overlay.jsx.
  const [abierto, setAbierto] = useState(true)

  function elegirFoto(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f); setFotoTocada(true); setPreview(URL.createObjectURL(f))
  }
  function quitarFoto() { setFile(null); setFotoTocada(true); setPreview(null) }

  async function guardar() {
    if (!nombre.trim()) { onToast?.('Poné tu nombre'); return }
    setSaving(true)

    // Subida de foto (requiere red). Best-effort: si falla, el resto del perfil se guarda igual.
    let fotoUrl
    let setFoto = false
    if (fotoTocada) {
      setFoto = true
      if (file) {
        const { url, error } = await subirAvatar(user.id, file)
        if (error) { onToast?.('La foto no pudo subirse (revisá la conexión).'); setFoto = false }
        else fotoUrl = url
      } else {
        fotoUrl = null // se quitó la foto
      }
    }

    const { error } = await actualizarMiPerfil({ nombre: nombre.trim(), telefono: telefono.trim(), fotoUrl, setFoto })
    setSaving(false)
    if (error) { onToast?.('Error: ' + (error.message || 'no se pudo guardar')); return }
    onToast?.('Perfil actualizado')
    setAbierto(false)
  }

  return (
    <Overlay
      open={abierto}
      onClose={onClose}
      title="Mi perfil"
      maxWidth={420}
      dismissible={!saving}
      footer={
        <>
          <button type="button" onClick={() => setAbierto(false)} disabled={saving} className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 16px', ...(saving ? apagado : null) }}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={saving} className="lu-press" style={{ ...btnPrimario, flex: 1, ...(saving ? apagado : null) }}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        </>
      }
    >
      {/* Foto de perfil: es la que aparece como burbuja en el mapa de monitoreo. Si no hay,
          la burbuja usa las iniciales. */}
      <Field label="Foto de perfil (opcional)">
        <div style={sx('display:flex;align-items:center;gap:12px')}>
          <div style={sx('width:60px;height:60px;flex:none;border-radius:99px;overflow:hidden;background:var(--tlight);color:var(--deep);border:1px solid var(--line2);display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:19px')}>
            {preview ? <img src={preview} alt="" style={sx('width:100%;height:100%;object-fit:cover')} /> : initials(nombre)}
          </div>
          <div style={sx('display:flex;flex-direction:column;gap:6px')}>
            <label className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 14px', height: 36, display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
              {preview ? 'Cambiar foto' : 'Subir foto'}
              <input type="file" accept="image/*" onChange={elegirFoto} style={sx('display:none')} />
            </label>
            {preview && (
              <button type="button" onClick={quitarFoto} style={sx('background:none;border:none;color:var(--danger);font-size:12px;font-weight:600;cursor:pointer;text-align:left;padding:0')}>Quitar foto</button>
            )}
          </div>
        </div>
      </Field>

      <Field label="Nombre *">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre y apellido" style={inputStyle} className="lu-input" />
      </Field>

      <Field label="Teléfono">
        <input value={telefono} onChange={(e) => setTelefono(e.target.value)} type="tel" inputMode="tel" placeholder="Ej: +54 9 387 555 1234" style={inputStyle} className="lu-input" />
        <div style={sx('font-size:var(--fs-xs);color:var(--faint);margin-top:6px')}>Para que la dirección pueda comunicarse con vos.</div>
      </Field>

      <Field label="Cuenta">
        <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
          <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:var(--r-pill);font-size:var(--fs-xs);font-weight:600;color:var(--deep)'), background: 'var(--surface2)', border: '1px solid var(--line)' }}>{ROLE_LABEL[rol] || rol || '—'}</span>
          <span style={sx('font-family:var(--font-mono);font-size:var(--fs-xs);color:var(--muted);word-break:break-all')}>{user?.email || ''}</span>
        </div>
      </Field>
    </Overlay>
  )
}
