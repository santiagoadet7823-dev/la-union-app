import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'
import { APP_VERSION } from '../../version'
import { inputStyle } from '../../components/form'
import Logo from '../../components/Logo'

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5h-1.9V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 6.1 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.3-5.5l-6.6-5.6C29.7 34.5 27 35.5 24 35.5c-5.2 0-9.6-3.3-11.2-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.4l6.6 5.6C41.9 36.7 44 30.9 44 24c0-1.3-.1-2.3-.4-3.5z" />
    </svg>
  )
}

export default function LoginView() {
  const { signInWithGoogle, signInWithPassword, hasSupabase, authError, authStatus } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [entrando, setEntrando] = useState(false) // login por email en curso

  const puedeEnviar = hasSupabase && email.trim() && password && !entrando

  async function ingresarConEmail(e) {
    e.preventDefault()
    if (!puedeEnviar) return
    setEntrando(true)
    // El onAuthStateChange del AuthProvider levanta la sesión y cambia de pantalla;
    // solo reactivamos el botón si hubo error (si entró, esta vista se desmonta).
    const { error } = await signInWithPassword({ email, password })
    if (error) setEntrando(false)
  }

  return (
    <div style={sx('min-height:100vh;display:grid;place-items:center;background:var(--bg-app);color:var(--text);padding:24px')}>
      <div style={sx('width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow-lg);padding:28px 24px;text-align:center')}>
        <Logo size={52} radius={14} style={{ margin: '0 auto 14px' }} />
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:20px;letter-spacing:.03em')}>DisT-At</div>
        <div style={sx('font-size:12.5px;color:var(--muted);margin:6px 0 22px')}>Ingresá para continuar.</div>

        <form onSubmit={ingresarConEmail} style={sx('text-align:left')}>
          <input
            type="email"
            autoComplete="username"
            inputMode="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!hasSupabase || entrando}
            style={{ ...inputStyle, marginBottom: 10 }}
            className="lu-input"
            aria-label="Email"
          />
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={!hasSupabase || entrando}
            style={inputStyle}
            className="lu-input"
            aria-label="Contraseña"
          />
          <button
            type="submit"
            disabled={!puedeEnviar}
            className="lu-press"
            style={{ ...sx('width:100%;min-height:48px;margin-top:14px;display:flex;align-items:center;justify-content:center;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:14px'), cursor: puedeEnviar ? 'pointer' : 'not-allowed', opacity: puedeEnviar ? 1 : 0.6 }}
          >
            {entrando ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        <div style={sx('display:flex;align-items:center;gap:10px;margin:18px 0')} aria-hidden="true">
          <span style={sx('flex:1;height:1px;background:var(--line)')} />
          <span style={sx('font-size:11px;color:var(--faint)')}>o</span>
          <span style={sx('flex:1;height:1px;background:var(--line)')} />
        </div>

        <button
          onClick={() => signInWithGoogle()}
          disabled={!hasSupabase || entrando}
          className="lu-press"
          style={sx('width:100%;min-height:48px;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1f2937;border:1px solid #dadce0;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer')}
        >
          <GoogleIcon /> Continuar con Google
        </button>

        {!hasSupabase && (
          <div style={sx('margin-top:14px;font-size:11.5px;color:var(--danger)')}>
            Falta configurar Supabase (VITE_SUPABASE_URL / ANON_KEY).
          </div>
        )}

        {authStatus && (
          <div style={sx('margin-top:12px;text-align:left;font-size:11px;color:var(--muted);background:var(--surface2);border:1px solid var(--line2);border-radius:10px;padding:9px 11px;font-family:var(--font-mono);line-height:1.5;word-break:break-word')}>
            {authStatus}
          </div>
        )}

        {authError && (
          <div style={sx('margin-top:12px;text-align:left;font-size:11px;color:var(--danger);background:var(--danger-tint);border:1px solid var(--danger);border-radius:10px;padding:10px 12px;line-height:1.5;font-family:var(--font-mono);word-break:break-word')}>
            <b>Diagnóstico del ingreso:</b><br />{authError}
          </div>
        )}

        <div style={sx('margin-top:20px;font-size:11px;color:var(--faint);line-height:1.5')}>
          ¿No tenés cuenta? Pedile el alta a un <b>administrador</b>: él crea tu usuario y te pasa la
          contraseña. Si entrás con Google por primera vez, quedás <b>pendiente de aprobación</b>.
        </div>

        <div style={sx('margin-top:12px;font-size:10px;color:var(--faint);font-family:var(--font-mono)')}>v{APP_VERSION}</div>
      </div>
    </div>
  )
}
