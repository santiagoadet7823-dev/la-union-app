import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'

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
  const { signInWithGoogle, hasSupabase, authError } = useAuth()

  return (
    <div style={sx('min-height:100vh;display:grid;place-items:center;background:var(--bg-app);color:var(--text);padding:24px')}>
      <div style={sx('width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow-lg);padding:28px 24px;text-align:center')}>
        <div style={sx('width:52px;height:52px;margin:0 auto 14px;border-radius:14px;background:var(--primary);color:var(--on-primary);display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:24px')}>U</div>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:20px;letter-spacing:.03em')}>Distribuidora LA UNIÓN</div>
        <div style={sx('font-size:12.5px;color:var(--muted);margin:6px 0 22px')}>Ingresá con tu cuenta de Google para continuar.</div>

        <button
          onClick={() => signInWithGoogle()}
          disabled={!hasSupabase}
          style={sx('width:100%;min-height:50px;display:flex;align-items:center;justify-content:center;gap:10px;background:#fff;color:#1f2937;border:1px solid #dadce0;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer')}
        >
          <GoogleIcon /> Continuar con Google
        </button>

        {!hasSupabase && (
          <div style={sx('margin-top:14px;font-size:11.5px;color:var(--danger)')}>
            Falta configurar Supabase (VITE_SUPABASE_URL / ANON_KEY).
          </div>
        )}

        {authError && (
          <div style={sx('margin-top:14px;text-align:left;font-size:11.5px;color:var(--danger);background:var(--danger-tint);border:1px solid var(--danger);border-radius:10px;padding:10px 12px;line-height:1.5')}>
            <b>No se pudo completar el ingreso.</b><br />{authError}
          </div>
        )}

        <div style={sx('margin-top:20px;font-size:11px;color:var(--faint);line-height:1.5')}>
          Al ingresar por primera vez tu cuenta queda <b>pendiente de aprobación</b>. Un administrador
          te asignará tu rol (vendedor, repartidor, encargado o admin).
        </div>
      </div>
    </div>
  )
}
