import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import Isotipo from '../../components/Isotipo'

/**
 * ACTIVAR 2FA (TOTP) — bloquea el Gate entero. 29/09/2026 (db/80, Tarea 2.2, fase 1).
 *
 * La ve quien está en `aal1` sin ningún factor (`nextLevel === 'aal1'`, tabla oficial de Supabase:
 * https://supabase.com/docs/guides/auth/auth-mfa#add-a-challenge-step-to-login) — primera vez que
 * entra desde que 2FA es obligatoria, o después de recuperar por código (mfa-recuperar borra el
 * factor viejo entero). No tiene forma de "más tarde": la 2FA es obligatoria para todos los roles.
 *
 * Flujo: enroll → challenge+verify (pasa a aal2 sola) → generar y mostrar los 10 códigos de
 * recuperación UNA vez (mfa-codigos) → confirmar que se anotaron → listo, el Gate deja pasar.
 *
 * 🩸 EN LA APK, el autenticador está en el MISMO teléfono (brief original: "veo un problema cuando
 * a los samsung se le cierra la sesión le va a pedir la verificación"). Por eso, además del QR para
 * quien lo escanee con otro teléfono, hay un botón que abre `uri` directo (`otpauth://…`): si hay
 * una app autenticadora instalada, Android la ofrece sin tener que fotografiar la propia pantalla.
 *
 * ⚠️ LÍMITE CONOCIDO (revisión del 29/09/2026): cada vez que este componente monta llama a
 * `enroll()` de nuevo sin revisar si ya había un factor sin verificar de un intento anterior
 * (por ejemplo, recargar la página a mitad del QR). Quedan factores "huérfanos" sin verificar en
 * el servidor — no otorgan acceso ni afectan el `aal` de nadie, así que no es un problema de
 * seguridad, pero sí clutter. No se limpia automáticamente acá porque no está confirmado que
 * `unenroll()` funcione en aal1 sobre un factor sin verificar (la documentación de Supabase solo
 * confirma que hace falta aal2 para el caso de gestión post-activación). Si se vuelve un problema
 * real, revisarlo desde el panel de Supabase (Authentication → Users → factors) o con una limpieza
 * periódica server-side de factores `unverified` viejos.
 */
export default function MfaActivar() {
  const { refetchMfa, signOut } = useAuth()
  const [paso, setPaso] = useState('cargando') // 'cargando' | 'enroll' | 'codigos' | 'error'
  const [factorId, setFactorId] = useState('')
  const [qr, setQr] = useState('')
  const [secret, setSecret] = useState('')
  const [uri, setUri] = useState('')
  const [codigo, setCodigo] = useState('')
  const [verificando, setVerificando] = useState(false)
  const [error, setError] = useState('')
  const [codigosRecuperacion, setCodigosRecuperacion] = useState([])
  const [anotado, setAnotado] = useState(false)

  async function intentarEnroll() {
    setPaso('cargando')
    const { data, error: errEnroll } = await supabase.auth.mfa.enroll({ factorType: 'totp', issuer: 'DisT-At' })
    if (errEnroll || !data) {
      setError(errEnroll?.message || 'No se pudo empezar la activación.')
      setPaso('error')
      return
    }
    setFactorId(data.id)
    setQr(data.totp.qr_code)
    setSecret(data.totp.secret)
    setUri(data.totp.uri)
    setPaso('enroll')
  }

  useEffect(() => { intentarEnroll() }, [])

  async function verificar(e) {
    e.preventDefault()
    if (verificando || codigo.trim().length < 6) return
    setVerificando(true); setError('')
    const { data: challenge, error: errChallenge } = await supabase.auth.mfa.challenge({ factorId })
    if (errChallenge) { setError(errChallenge.message); setVerificando(false); return }
    const { error: errVerify } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: codigo.trim() })
    if (errVerify) {
      setVerificando(false)
      setError(/invalid|expired/i.test(errVerify.message) ? 'El código no es válido o ya venció. Probá con el siguiente que muestre la app.' : errVerify.message)
      return
    }
    // 🩸 NO se llama a `refetchMfa()` acá todavía (bug encontrado en revisión, 29/09/2026): el
    // verify ya deja la sesión en aal2 por dentro, así que refrescar el estado del contexto ACÁ
    // haría que el Gate deje de mostrar esta pantalla de inmediato — mientras todavía falta pedir
    // y mostrar los códigos de recuperación (un round-trip de red bastante más lento que este
    // refetch, que solo lee la sesión ya cacheada). El resultado real era que el paso 'codigos'
    // quedaba inalcanzable: el usuario pasaba derecho a la app y perdía sus códigos para siempre.
    // Por eso `refetchMfa` se llama recién en el botón "Continuar" de la pantalla de códigos.
    const { data: cod, error: errCod } = await supabase.functions.invoke('mfa-codigos')
    setVerificando(false)
    if (errCod || !cod?.ok) {
      // La 2FA YA quedó activa server-side (lo que importa para la seguridad) aunque el contexto
      // todavía no se enteró — no trabar acá por un fallo en un paso secundario.
      setPaso('codigos'); setCodigosRecuperacion([]); return
    }
    setCodigosRecuperacion(cod.codigos)
    setPaso('codigos')
  }

  if (paso === 'cargando') {
    return (
      <div style={sx('min-height:100vh;display:grid;place-items:center;background:var(--bg-app)')}>
        <span className="lu-spin" style={{ width: 32, height: 32, borderRadius: 999, border: '3px solid var(--line)', borderTopColor: 'var(--primary)' }} />
      </div>
    )
  }

  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text);padding:24px 20px;box-sizing:border-box')}>
      <div style={sx('width:100%;max-width:420px;margin:0 auto;display:flex;flex-direction:column;flex:1')}>
        <div style={{ ...sx('display:flex;flex-direction:column;align-items:center;margin-top:16px'), '--gy': '10px' }}>
          <div style={sx('width:64px;height:64px;border-radius:18px;background:#0C0C0C;display:grid;place-items:center;border:1px solid var(--line)')}>
            <Isotipo size={44} />
          </div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-xl);letter-spacing:.03em;text-align:center')}>
            Activá la verificación en dos pasos
          </div>
          {paso === 'enroll' && (
            <div style={sx('font-size:var(--fs-md);color:var(--muted);text-align:center;line-height:1.5')}>
              Es obligatoria para todas las cuentas. Escaneá el código con tu app autenticadora
              (Google Authenticator, Authy, etc.) o abrila directo si está en este mismo teléfono.
            </div>
          )}
        </div>

        {paso === 'error' && (
          <div style={sx('margin-top:24px;display:flex;flex-direction:column')}>
            <div style={sx('padding:14px;border-radius:var(--r-lg);background:var(--danger-tint);border:1px solid var(--danger);font-size:var(--fs-sm);color:var(--text);line-height:1.5')}>
              {error}
            </div>
            {/* Sin esto, un fallo transitorio (red, rate-limit) dejaba a la persona completamente
                varada: no había ningún botón en esta pantalla, ni siquiera para cerrar sesión. */}
            <button onClick={intentarEnroll} className="lu-press"
              style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;margin-top:14px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-md);font-weight:700;cursor:pointer') }}>
              Reintentar
            </button>
            <button onClick={signOut}
              style={sx('min-height:44px;margin-top:6px;background:transparent;border:none;font-size:var(--fs-sm);color:var(--muted);cursor:pointer')}>
              Cerrar sesión
            </button>
          </div>
        )}

        {paso === 'enroll' && (
          <>
            <div style={sx('display:flex;justify-content:center;margin-top:20px')}>
              <img src={qr} alt="Código QR de activación" width={200} height={200}
                style={{ borderRadius: 12, background: '#fff', padding: 10 }} />
            </div>

            <a href={uri} className="lu-press"
              style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;margin-top:16px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line2);color:var(--text);font-size:var(--fs-md);font-weight:600;text-decoration:none'), '--gx': '8px' }}>
              Abrir en la app autenticadora
            </a>

            <details style={sx('margin-top:12px')}>
              <summary style={sx('font-size:var(--fs-sm);color:var(--muted);cursor:pointer')}>
                ¿No podés escanear? Ingresá la clave a mano
              </summary>
              <div style={sx('margin-top:8px;padding:10px 12px;border-radius:var(--r-md);background:var(--surface2);font-family:var(--font-mono);font-size:var(--fs-sm);word-break:break-all;user-select:all')}>
                {secret}
              </div>
            </details>

            <form onSubmit={verificar} className="lu-rise" style={{ ...sx('display:flex;flex-direction:column;margin-top:20px'), '--gy': '10px' }}>
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
                <span>{verificando ? 'Verificando…' : 'Verificar y activar'}</span>
              </button>
            </form>
          </>
        )}

        {paso === 'codigos' && (
          <div className="lu-rise" style={sx('margin-top:20px;display:flex;flex-direction:column')}>
            <div style={sx('font-size:var(--fs-md);font-weight:600')}>Guardá tus códigos de recuperación</div>
            <div style={sx('font-size:var(--fs-sm);color:var(--muted);line-height:1.5;margin-top:4px')}>
              {codigosRecuperacion.length
                ? 'Sirven para entrar si perdés el teléfono con la app autenticadora. Cada uno se usa una sola vez. Se muestran ahora y no de nuevo — anotalos en un lugar seguro.'
                : 'La verificación ya quedó activa, aunque no se pudieron generar los códigos de recuperación por un problema de conexión. Si más adelante perdés el teléfono, pedile a un administrador que te resetee la verificación desde el menú Usuarios.'}
            </div>
            {codigosRecuperacion.length > 0 && (
              <div style={sx('margin-top:14px;padding:14px;border-radius:var(--r-lg);background:var(--surface2);border:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;gap:8px;font-family:var(--font-mono);font-size:var(--fs-sm)')}>
                {codigosRecuperacion.map((c) => <div key={c}>{c}</div>)}
              </div>
            )}
            {codigosRecuperacion.length > 0 && (
              <label style={{ ...sx('display:flex;align-items:center;cursor:pointer;margin-top:16px'), '--gx': '10px' }}>
                <input type="checkbox" checked={anotado} onChange={(e) => setAnotado(e.target.checked)}
                  style={{ width: 22, height: 22, accentColor: 'var(--primary)', cursor: 'pointer' }} />
                <span style={sx('font-size:var(--fs-sm);color:var(--muted)')}>Ya los anoté o los guardé</span>
              </label>
            )}
            <button onClick={refetchMfa} disabled={codigosRecuperacion.length > 0 && !anotado} className="lu-press"
              style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;margin-top:16px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700'), cursor: (codigosRecuperacion.length > 0 && !anotado) ? 'not-allowed' : 'pointer', opacity: (codigosRecuperacion.length > 0 && !anotado) ? 0.6 : 1 }}>
              Continuar
            </button>
          </div>
        )}

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
