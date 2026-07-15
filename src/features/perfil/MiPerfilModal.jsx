import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'

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

  async function guardar() {
    if (!nombre.trim()) { onToast?.('Poné tu nombre'); return }
    setSaving(true)
    const { error } = await actualizarMiPerfil({ nombre: nombre.trim(), telefono: telefono.trim() })
    setSaving(false)
    if (error) { onToast?.('Error: ' + (error.message || 'no se pudo guardar')); return }
    onToast?.('Perfil actualizado')
    onClose?.()
  }

  return (
    <div style={sx('position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--scrim)')}>
      <div onClick={onClose} style={sx('position:absolute;inset:0')} />
      <div style={sx('position:relative;width:100%;max-width:420px;max-height:92vh;overflow-y:auto;background:var(--surface);border:1px solid var(--line2);border-radius:18px;box-shadow:var(--shadow-lg);padding:18px')}>
        <div style={sx('display:flex;justify-content:space-between;align-items:center;margin-bottom:14px')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Mi perfil</div>
          <button onClick={onClose} style={sx('width:30px;height:30px;border-radius:8px;border:1px solid var(--line2);background:transparent;color:var(--muted);cursor:pointer;font-size:16px')}>✕</button>
        </div>

        <Field label="Nombre *">
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Tu nombre y apellido" style={inp} />
        </Field>

        <Field label="Teléfono">
          <input value={telefono} onChange={(e) => setTelefono(e.target.value)} type="tel" inputMode="tel" placeholder="Ej: +54 9 387 555 1234" style={inp} />
          <div style={sx('font-size:11px;color:var(--faint);margin-top:6px')}>Para que la dirección pueda comunicarse con vos.</div>
        </Field>

        <Field label="Cuenta">
          <div style={sx('display:flex;align-items:center;gap:8px;flex-wrap:wrap')}>
            <span style={{ ...sx('display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;font-size:11px;font-weight:600;color:var(--deep)'), background: 'var(--surface2)', border: '1px solid var(--line)' }}>{ROLE_LABEL[rol] || rol || '—'}</span>
            <span style={sx('font-family:var(--font-mono);font-size:11.5px;color:var(--muted);word-break:break-all')}>{user?.email || ''}</span>
          </div>
        </Field>

        <div style={sx('display:flex;gap:8px;margin-top:8px')}>
          <button onClick={onClose} style={sx('flex:none;min-height:46px;padding:0 16px;border:1px solid var(--line2);border-radius:12px;background:transparent;color:var(--muted);font-weight:600;font-size:13px;cursor:pointer')}>Cancelar</button>
          <button onClick={guardar} disabled={saving} style={sx('flex:1;min-height:46px;border:none;border-radius:12px;background:var(--primary);color:var(--on-primary);font-weight:600;font-size:14px;cursor:pointer')}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
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
