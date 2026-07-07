import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'

/**
 * Pantalla para usuarios logueados pero SIN acceso todavía: cuenta creada pero
 * sin rol asignado o inactiva. Espera la aprobación del administrador.
 */
export default function PendienteView() {
  const { user, perfil, signOut, refetchPerfil } = useAuth()
  const { isDark, toggleTheme } = useTheme()

  const inactivo = perfil && !perfil.activo
  const sinRol = perfil && !perfil.rol

  return (
    <div style={sx('min-height:100vh;display:grid;place-items:center;background:var(--bg-app);color:var(--text);padding:24px')}>
      <div style={sx('width:100%;max-width:400px;background:var(--surface);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow-lg);padding:28px 24px;text-align:center')}>
        <div style={sx('width:60px;height:60px;margin:0 auto 14px;border-radius:99px;display:grid;place-items:center;background:var(--warning-tint);border:1px solid var(--warning)')}>
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--warning)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        </div>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:19px')}>Cuenta pendiente de aprobación</div>
        <div style={sx('font-size:13px;color:var(--muted);margin:8px 0 4px;line-height:1.5')}>
          {sinRol && !inactivo
            ? 'Tu cuenta fue creada pero todavía no tiene un rol asignado.'
            : 'Tu cuenta todavía no está habilitada.'}
          {' '}Un administrador de LA UNIÓN te asignará tu rol para que puedas ingresar.
        </div>
        <div style={sx('margin:14px 0;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--surface2);font-family:var(--font-mono);font-size:12px;color:var(--muted)')}>
          {user?.email}
        </div>

        <div style={sx('display:flex;gap:8px;margin-top:6px')}>
          <button onClick={() => refetchPerfil()} style={sx('flex:1;min-height:46px;border:1px solid var(--line2);border-radius:12px;background:transparent;color:var(--text);font-weight:600;font-size:13px;cursor:pointer')}>
            Ya me aprobaron — reintentar
          </button>
          <button onClick={() => signOut()} style={sx('flex:none;min-height:46px;padding:0 16px;border:1px solid var(--danger);border-radius:12px;background:var(--danger-tint);color:var(--danger);font-weight:600;font-size:13px;cursor:pointer')}>
            Salir
          </button>
        </div>

        <button onClick={toggleTheme} style={sx('margin-top:16px;background:none;border:none;color:var(--faint);font-size:11px;cursor:pointer')}>
          Cambiar a modo {isDark ? 'claro' : 'oscuro'}
        </button>
      </div>
    </div>
  )
}
