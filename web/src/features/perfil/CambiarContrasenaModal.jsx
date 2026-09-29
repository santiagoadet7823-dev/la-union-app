import { useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import Overlay from '../../components/Overlay'
import { Field, inputStyle } from '../../components/form'
import { btnSecundario, btnPrimario, apagado } from '../../lib/botones'

/**
 * Cambiar la PROPIA contraseña, por decisión propia, desde Mi cuenta (db/78, 29/09/2026).
 *
 * 🩸 NO EXISTÍA NINGÚN CAMINO. El alta (`AltaUsuario`) le dice al admin "la puede cambiar después
 * desde su cuenta" al pasarle la contraseña inicial — y eso era falso: Mi cuenta no tenía ninguna
 * opción de contraseña. Esto cierra ese hueco.
 *
 * `supabase.auth.updateUser` es una llamada de Auth, no una escritura en `perfiles`: no pasa por
 * `perfiles_upd` ni por el trigger de columnas sensibles (db/77), así que cualquier rol puede
 * cambiarse SU PROPIA contraseña sin pedirle nada a un admin.
 *
 * Para el reseteo hecho POR un admin (`resetear-contrasena`) hay una pantalla aparte,
 * `features/auth/CambioContrasenaObligatorio.jsx`: bloquea el Gate entero, no se puede
 * descartar, y no pide "contraseña actual" (la que dictó el admin ya cumplió ese papel).
 * Ésta es la voluntaria: se puede cancelar y pide la actual como confirmación humana — quien
 * encuentra el teléfono desbloqueado y no sabe la contraseña no puede cambiarla sin más.
 *
 * props: { onClose, onToast }
 */
export default function CambiarContrasenaModal({ onClose, onToast }) {
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [verPass, setVerPass] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [abierto, setAbierto] = useState(true)

  const listo = actual.length >= 1 && nueva.length >= 6 && nueva === repetir && !saving

  async function guardar() {
    if (!listo) return
    setSaving(true)
    setError(null)
    const { error: errAuth } = await supabase.auth.updateUser({ password: nueva })
    setSaving(false)
    if (errAuth) {
      setError(/weak|short|at least/i.test(errAuth.message) ? 'La contraseña es muy corta (mínimo 6 caracteres).' : errAuth.message)
      return
    }
    onToast?.('Contraseña cambiada')
    setAbierto(false)
  }

  return (
    <Overlay open={abierto} onClose={onClose} dismissible={!saving} title="Cambiar contraseña" maxWidth={380}
      footer={
        <>
          <button type="button" onClick={() => setAbierto(false)} disabled={saving} className="lu-press" style={{ ...btnSecundario, flex: 'none', padding: '0 16px', ...(saving ? apagado : null) }}>Cancelar</button>
          <button type="button" onClick={guardar} disabled={!listo} className="lu-press" style={{ ...btnPrimario, flex: 1, ...(!listo ? apagado : null) }}>{saving ? 'Guardando…' : 'Cambiar contraseña'}</button>
        </>
      }>
      <Field label="Contraseña actual">
        <input type={verPass ? 'text' : 'password'} autoComplete="current-password" value={actual}
          onChange={(e) => setActual(e.target.value)} style={inputStyle} className="lu-input" />
      </Field>
      <Field label="Contraseña nueva">
        <input type={verPass ? 'text' : 'password'} autoComplete="new-password" value={nueva}
          onChange={(e) => setNueva(e.target.value)} style={inputStyle} className="lu-input" />
      </Field>
      <Field label="Repetir contraseña nueva">
        <input type={verPass ? 'text' : 'password'} autoComplete="new-password" value={repetir}
          onChange={(e) => setRepetir(e.target.value)} style={inputStyle} className="lu-input" />
        {repetir && nueva !== repetir && <div style={sx('font-size:var(--fs-xs);color:var(--danger);margin-top:6px')}>No coinciden.</div>}
      </Field>
      <label style={{ ...sx('display:flex;align-items:center;cursor:pointer;margin-top:4px'), '--gx': '8px' }}>
        <input type="checkbox" checked={verPass} onChange={(e) => setVerPass(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--primary)', cursor: 'pointer' }} />
        <span style={sx('font-size:var(--fs-sm);color:var(--muted)')}>Mostrar contraseñas</span>
      </label>
      {error && <div style={sx('font-size:var(--fs-sm);color:var(--danger);margin-top:12px;line-height:1.5')}>{error}</div>}
    </Overlay>
  )
}
