import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'
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
  // El llamador monta este modal condicionalmente, así que el "abierto" vive acá
  // para que la animación de salida alcance a correr. Ver Overlay.jsx.
  const [abierto, setAbierto] = useState(true)

  async function guardar() {
    if (!nombre.trim()) { onToast?.('Poné tu nombre'); return }
    setSaving(true)
    const { error } = await actualizarMiPerfil({ nombre: nombre.trim(), telefono: telefono.trim() })
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
