import { useRole } from '../context/RoleContext'
import { useTheme } from '../context/ThemeContext'
import { Sun, Moon } from './icons'

/**
 * Marco global: topbar con logo, selector de rol y toggle de tema.
 * Réplica fiel del shell del diseñador (LA UNION.dc.html).
 */
export default function AppShell({ children }) {
  const { currentRole, setCurrentRole, roles } = useRole()
  const { isDark, toggleTheme } = useTheme()

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

        <nav style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 4, flexWrap: 'wrap' }}>
          {Object.values(roles).map((r) => {
            const active = currentRole === r.id
            return (
              <button
                key={r.id}
                onClick={() => setCurrentRole(r.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7, padding: '7px 15px', borderRadius: 10,
                  fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)',
                  color: active ? 'var(--deep)' : 'var(--muted)',
                  background: active ? 'var(--primary-tint)' : 'transparent',
                  border: `1px solid ${active ? 'var(--primary)' : 'transparent'}`,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: 99, background: active ? 'var(--primary)' : 'var(--line2)' }} />
                {r.label}
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9.5, color: 'var(--faint)', fontWeight: 500 }}>{r.device}</span>
              </button>
            )
          })}
        </nav>

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
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>{children}</div>
    </div>
  )
}

const logoBox = {
  width: 26, height: 26, borderRadius: 8, background: 'var(--primary)', color: 'var(--on-primary)',
  display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
}
