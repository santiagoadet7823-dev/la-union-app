import { useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import Isotipo from '../../components/Isotipo'
import Overlay from '../../components/Overlay'

/**
 * VERIFICAR 2FA (TOTP) — bloquea el Gate entero. 29/09/2026 (db/80, Tarea 2.2, fase 1).
 *
 * La ve quien ya tiene un factor activo pero esta sesión concreta está en `aal1` con
 * `nextLevel === 'aal2'` (tabla oficial de Supabase): un login nuevo, o una sesión que perdió el
 * espejo. Pide el código de 6 dígitos de la app autenticadora.
 *
 * 🩸 POR QUÉ NO SE REPITE EN CADA APERTURA (el problema de los Samsung que planteó el dueño). El
 * `aal2` queda pegado a la SESIÓN, no a la persona, y sobrevive a cada refresh de token mientras el
 * refresh token siga vivo — esta pantalla solo aparece en un login realmente nuevo (o después de un
 * "Cerrar sesión" o un reseteo de un admin), nunca porque One UI mató el proceso o el teléfono se
 * reinició con la sesión todavía viva.
 */
export default function MfaVerificar() {
  const { refetchMfa, signOut } = useAuth()
  const [codigo, setCodigo] = useState('')
  const [verificando, setVerificando] = useState(false)
  const [error, setError] = useState('')
  const [hoja, setHoja] = useState(null) // 'recuperar' | null
  const [codigoRecuperacion, setCodigoRecuperacion] = useState('')
  const [recuperando, setRecuperando] = useState(false)
  const [errorRecuperar, setErrorRecuperar] = useState('')

  async function verificar(e) {
    e.preventDefault()
    if (verificando || codigo.trim().length < 6) return
    setVerificando(true); setError('')
    const { data: factores, error: errFactores } = await supabase.auth.mfa.listFactors()
    const factor = factores?.totp?.[0]
    if (errFactores || !factor) {
      setError('No se encontró tu factor de verificación. Probá cerrar sesión y volver a entrar.')
      setVerificando(false)
      return
    }
    const { data: challenge, error: errChallenge } = await supabase.auth.mfa.challenge({ factorId: factor.id })
    if (errChallenge) { setError(errChallenge.message); setVerificando(false); return }
    const { error: errVerify } = await supabase.auth.mfa.verify({ factorId: factor.id, challengeId: challenge.id, code: codigo.trim() })
    setVerificando(false)
    if (errVerify) {
      setError(/invalid|expired/i.test(errVerify.message) ? 'El código no es válido o ya venció. Probá con el siguiente que muestre la app.' : errVerify.message)
      return
    }
    await refetchMfa()
  }

  async function recuperar() {
    if (recuperando || !codigoRecuperacion.trim()) return
    setRecuperando(true); setErrorRecuperar('')
    const { data, error: errFn } = await supabase.functions.invoke('mfa-recuperar', { body: { codigo: codigoRecuperacion.trim() } })
    setRecuperando(false)
    if (errFn || !data?.ok) {
      let code = data?.error || null
      if (errFn && !code) {
        try { code = (await errFn.context.json())?.error } catch (_) { code = errFn.message }
      }
      setErrorRecuperar(
        code === 'codigo-invalido' ? 'Ese código no es válido o ya se usó.'
          : code === 'no-se-pudo-completar' ? 'No se pudo terminar de recuperar el acceso. Probá de nuevo en un momento.'
          : code === 'no-auth' ? 'Tu sesión venció. Volvé a entrar.'
          : 'No se pudo recuperar el acceso.'
      )
      return
    }
    // 🩸 refetchMfa() SOLO no alcanza acá (bug encontrado en revisión, 29/09/2026):
    // getAuthenticatorAssuranceLevel() lee la SESIÓN CACHEADA del navegador, y el factor se borró
    // server-side con la service_role key — el caché local no se entera solo. Hace falta forzar un
    // refresh real contra el servidor primero; recién ese intercambio trae de vuelta un `user`
    // actualizado (sin el factor) para que refetchMfa calcule aal1/aal1 y el Gate mande a
    // MfaActivar. Sin este paso, la pantalla se quedaba mostrando este mismo componente.
    await supabase.auth.refreshSession()
    await refetchMfa()
  }

  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text);padding:24px 20px;box-sizing:border-box')}>
      <div style={sx('width:100%;max-width:400px;margin:0 auto;display:flex;flex-direction:column;flex:1')}>
        <div style={{ ...sx('display:flex;flex-direction:column;align-items:center;margin-top:24px'), '--gy': '10px' }}>
          <div style={sx('width:64px;height:64px;border-radius:18px;background:#0C0C0C;display:grid;place-items:center;border:1px solid var(--line)')}>
            <Isotipo size={44} />
          </div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-xl);letter-spacing:.03em;text-align:center')}>
            Verificación en dos pasos
          </div>
          <div style={sx('font-size:var(--fs-md);color:var(--muted);text-align:center;line-height:1.5')}>
            Ingresá el código de tu app autenticadora.
          </div>
        </div>

        <form onSubmit={verificar} className="lu-rise" style={{ ...sx('display:flex;flex-direction:column;margin-top:24px'), '--gy': '10px' }}>
          <input
            type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="Código de 6 dígitos"
            aria-label="Código de 6 dígitos" autoFocus maxLength={6}
            value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} disabled={verificando}
            className="lu-input" style={{ ...campo, textAlign: 'center', letterSpacing: '0.3em', fontSize: 'var(--fs-xl)' }}
          />
          {error && <div style={sx('font-size:var(--fs-sm);color:var(--danger);line-height:1.5')}>{error}</div>}
          <button type="submit" disabled={verificando || codigo.trim().length < 6} className="lu-press"
            style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700'), '--gx': '10px', cursor: verificando ? 'wait' : 'pointer', opacity: codigo.trim().length < 6 ? 0.6 : 1 }}>
            {verificando && <span className="lu-spin" style={{ width: 20, height: 20, borderRadius: 999, border: '2.5px solid rgba(0,0,0,.18)', borderTopColor: 'var(--on-primary)' }} />}
            <span>{verificando ? 'Verificando…' : 'Verificar'}</span>
          </button>
          <button type="button" onClick={() => { setHoja('recuperar'); setCodigoRecuperacion(''); setErrorRecuperar('') }}
            style={sx('min-height:44px;background:transparent;border:none;font-size:var(--fs-sm);font-weight:600;color:var(--deep);cursor:pointer')}>
            Perdí el teléfono — usar un código de recuperación
          </button>
          <button type="button" onClick={signOut}
            style={sx('min-height:40px;background:transparent;border:none;font-size:var(--fs-sm);color:var(--muted);cursor:pointer')}>
            Cerrar sesión
          </button>
        </form>

        <div style={sx('flex:1;min-height:20px')} />
      </div>

      <Overlay open={hoja === 'recuperar'} onClose={() => setHoja(null)} variant="sheet" title="Código de recuperación">
        <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.55')}>
          Usá uno de los 10 códigos que guardaste al activar la verificación. Se gasta al usarlo, y
          esto también borra el factor viejo: vas a tener que activar uno nuevo enseguida.
        </div>
        <input type="text" placeholder="Código de recuperación" aria-label="Código de recuperación" autoFocus
          value={codigoRecuperacion} onChange={(e) => setCodigoRecuperacion(e.target.value)}
          className="lu-input" style={{ ...campo, marginTop: 16 }} />
        {errorRecuperar && <div style={sx('font-size:var(--fs-sm);color:var(--danger);line-height:1.5;margin-top:8px')}>{errorRecuperar}</div>}
        <button onClick={recuperar} disabled={recuperando || !codigoRecuperacion.trim()} className="lu-press"
          style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:12px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700'), cursor: recuperando ? 'wait' : 'pointer', opacity: codigoRecuperacion.trim() ? 1 : 0.6 }}>
          {recuperando ? 'Verificando…' : 'Recuperar acceso'}
        </button>
      </Overlay>
    </div>
  )
}

const campo = {
  width: '100%', minHeight: 52, padding: '0 14px', boxSizing: 'border-box',
  background: 'var(--surface2)', color: 'var(--text)',
  border: '1px solid var(--line2)', borderRadius: 'var(--r-md)',
  fontFamily: 'var(--font-body)', fontSize: 'var(--fs-lg)', outline: 'none',
}
