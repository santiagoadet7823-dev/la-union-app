import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { Sun, Moon } from './icons'

const ROLE_META = {
  superadmin: { label: 'Superadmin', color: 'var(--info)' },
  admin: { label: 'Administrador', color: 'var(--primary)' },
  encargado: { label: 'Encargado', color: 'var(--primary)' },
  vendedor: { label: 'Vendedor', color: 'var(--success)' },
  repartidor: { label: 'Repartidor', color: 'var(--warning)' },
}

/**
 * Marco global: topbar con logo, identidad del usuario logueado + su rol, toggle
 * de tema y salir. Ya no hay selector manual de rol: la app degrada según el rol
 * real del perfil (RBAC).
 */
export default function AppShell({ children }) {
  const { perfil, user, rol, signOut } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const meta = ROLE_META[rol] || { label: rol || '—', color: 'var(--muted)' }
  const nombre = perfil?.nombre || user?.email || 'Usuario'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          flex: 'none', height: 52, display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px',
          background: 'var(--surface)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
          <div style={logoBox}>U</div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, letterSpacing: '.04em', lineHeight: 1.1 }}>
              LA UNIÓN
            </div>
            <div style={{ fontSize: 9, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>Distribuidora · Anta</div>
          </div>
        </div>

        <div style={{ flex: 1 }} />

        {/* Identidad + rol */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
          <div style={{ textAlign: 'right', lineHeight: 1.15 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</div>
            <div style={{ fontSize: 9.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{user?.email}</div>
          </div>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 99,
            fontSize: 11, fontWeight: 600, color: meta.color, background: 'var(--surface2)', border: '1px solid var(--line)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: meta.color }} />
            {meta.label}
          </span>
        </div>

        <button
          onClick={toggleTheme}
          title="Cambiar tema Light/Dark"
          style={{
            flex: 'none', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)',
            borderRadius: 10, padding: '7px 12px', cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
            fontWeight: 600, background: 'transparent', fontFamily: 'var(--font-body)',
          }}
        >
          {isDark ? <Sun /> : <Moon />}
          {isDark ? 'Dark' : 'Light'}
        </button>

        <button
          onClick={() => signOut()}
          title="Cerrar sesión"
          style={{
            flex: 'none', display: 'flex', alignItems: 'center', gap: 7, border: '1px solid var(--line)',
            borderRadius: 10, padding: '7px 12px', cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
            fontWeight: 600, background: 'transparent', fontFamily: 'var(--font-body)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
          Salir
        </button>
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>{children}</div>
    </div>
  )
}

const logoBox = {
  width: 26, height: 26, borderRadius: 8, background: 'var(--primary)', color: 'var(--on-primary)',
  display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
}
