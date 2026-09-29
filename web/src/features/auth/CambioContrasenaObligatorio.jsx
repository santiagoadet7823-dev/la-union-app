import { useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth, identidadVisible } from '../../context/AuthContext'
import Isotipo from '../../components/Isotipo'

/**
 * CAMBIO DE CONTRASEÑA OBLIGATORIO — bloquea el Gate entero (db/78, 29/09/2026).
 *
 * La ve quien tiene `perfil.debe_cambiar_contrasena = true`: un admin le reseteó la contraseña
 * (Edge Function `resetear-contrasena`, la respuesta a "¿cómo recupera la contraseña alguien sin
 * email?", pero también sirve para cualquier cuenta). La contraseña que dictó el admin por
 * teléfono es de un solo uso — entra, pero no se puede seguir usando la app hasta poner una propia.
 *
 * A diferencia de `CambiarContrasenaModal` (Mi cuenta, voluntario): esto NO se puede cerrar, no
 * pide la contraseña "actual" (la que se acaba de tipear para entrar ya cumplió ese papel) y es
 * pantalla completa — no un overlay flotando sobre nada, porque el Gate todavía no montó la app.
 */
export default function CambioContrasenaObligatorio() {
  const { user, refetchPerfil } = useAuth()
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [verPass, setVerPass] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const listo = nueva.length >= 6 && nueva === repetir && !saving

  async function guardar(e) {
    e.preventDefault()
    if (!listo) return
    setSaving(true)
    setError(null)
    const { error: errAuth } = await supabase.auth.updateUser({ password: nueva })
    if (errAuth) {
      setSaving(false)
      setError(/weak|short|at least/i.test(errAuth.message) ? 'La contraseña es muy corta (mínimo 6 caracteres).' : errAuth.message)
      return
    }
    // Si esto falla, la contraseña YA se cambió (lo que importa) y el Gate seguiría bloqueando
    // en el próximo ingreso — reintentable, no se pierde nada.
    const { error: errFlag } = await supabase.rpc('marcar_contrasena_cambiada')
    setSaving(false)
    if (errFlag) { setError('La contraseña se cambió, pero no se pudo destrabar la app. Reintentá.'); return }
    await refetchPerfil() // el Gate lee perfil.debe_cambiar_contrasena: sin esto seguiría acá
  }

  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text);padding:24px 20px;box-sizing:border-box')}>
      <div style={sx('width:100%;max-width:400px;margin:0 auto;display:flex;flex-direction:column;flex:1')}>
        <div style={{ ...sx('display:flex;flex-direction:column;align-items:center;margin-top:24px'), '--gy': '10px' }}>
          <div style={sx('width:64px;height:64px;border-radius:18px;background:#0C0C0C;display:grid;place-items:center;border:1px solid var(--line)')}>
            <Isotipo size={44} />
          </div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-xl);letter-spacing:.03em;text-align:center')}>
            Poné una contraseña propia
          </div>
          <div style={sx('font-size:var(--fs-md);color:var(--muted);text-align:center;line-height:1.5')}>
            Un administrador reseteó la contraseña de <b style={{ color: 'var(--text)' }}>{identidadVisible(user?.email)}</b>.
            Antes de seguir, poné una que solo sepas vos.
          </div>
        </div>

        <form onSubmit={guardar} className="lu-rise" style={{ ...sx('display:flex;flex-direction:column;margin-top:28px'), '--gy': '10px' }}>
          <input
            type={verPass ? 'text' : 'password'} autoComplete="new-password" placeholder="Contraseña nueva" aria-label="Contraseña nueva"
            value={nueva} onChange={(e) => setNueva(e.target.value)} disabled={saving}
            className="lu-input" style={campo}
          />
          <input
            type={verPass ? 'text' : 'password'} autoComplete="new-password" placeholder="Repetir contraseña nueva" aria-label="Repetir contraseña nueva"
            value={repetir} onChange={(e) => setRepetir(e.target.value)} disabled={saving}
            className="lu-input" style={campo}
          />
          {repetir && nueva !== repetir && <div style={sx('font-size:var(--fs-sm);color:var(--danger)')}>No coinciden.</div>}

          <label style={{ ...sx('display:flex;align-items:center;cursor:pointer'), '--gx': '10px' }}>
            <input type="checkbox" checked={verPass} onChange={(e) => setVerPass(e.target.checked)}
              style={{ width: 22, height: 22, accentColor: 'var(--primary)', cursor: 'pointer' }} />
            <span style={sx('font-size:var(--fs-sm);color:var(--muted)')}>Mostrar contraseñas</span>
          </label>

          {error && <div style={sx('font-size:var(--fs-sm);color:var(--danger);line-height:1.5')}>{error}</div>}

          <button type="submit" disabled={!listo} className="lu-press"
            style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700'), '--gx': '10px', cursor: listo ? 'pointer' : 'not-allowed', opacity: listo ? 1 : 0.6 }}>
            {saving && <span className="lu-spin" style={{ width: 20, height: 20, borderRadius: 999, border: '2.5px solid rgba(0,0,0,.18)', borderTopColor: 'var(--on-primary)' }} />}
            <span>{saving ? 'Guardando…' : 'Cambiar y continuar'}</span>
          </button>
        </form>

        <div style={sx('flex:1;min-height:20px')} />
      </div>
    </div>
  )
}

const campo = {
  width: '100%', minHeight: 52, padding: '0 14px', boxSizing: 'border-box',
  background: 'var(--surface2)', color: 'var(--text)',
  border: '1px solid var(--line2)', borderRadius: 'var(--r-md)',
  fontFamily: 'var(--font-body)', fontSize: 'var(--fs-lg)', outline: 'none',
}
