import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useDevice } from '../context/DeviceContext'
import { Sun, Moon } from './icons'

const ROLE_META = {
  superadmin: { label: 'Superadmin', color: 'var(--info)' },
  admin: { label: 'Administrador', color: 'var(--primary)' },
  encargado: { label: 'Encargado', color: 'var(--primary)' },
  vendedor: { label: 'Vendedor', color: 'var(--success)' },
  repartidor: { label: 'Repartidor', color: 'var(--warning)' },
}

/**
 * Marco global: topbar con logo, identidad + rol, switch del encargado (Mi jornada /
 * Panel), selector de dispositivo, tema y salir. La app degrada según el rol real.
 * En celular la barra se compacta (oculta textos, botones a ícono).
 *
 * props:
 *  - encargadoVista  'jornada' | 'panel' | null   (null = no es encargado, sin switch)
 *  - onCambiarVista  (v) => void
 */
export default function AppShell({ children, encargadoVista = null, onCambiarVista }) {
  const { perfil, user, rol, signOut } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const { isMobile, setMode } = useDevice()
  const meta = ROLE_META[rol] || { label: rol || '—', color: 'var(--muted)' }
  const nombre = perfil?.nombre || user?.email || 'Usuario'

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-app)', color: 'var(--text)', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          flex: 'none', minHeight: 52, display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16,
          padding: isMobile ? '6px 10px' : '0 18px', flexWrap: 'wrap',
          background: 'var(--surface)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
          <div style={logoBox}>U</div>
          {!isMobile && (
            <div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13, letterSpacing: '.04em', lineHeight: 1.1 }}>
                LA UNIÓN
              </div>
              <div style={{ fontSize: 9, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>Distribuidora · Anta</div>
            </div>
          )}
        </div>

        {/* Switch del encargado: Mi jornada / Panel */}
        {encargadoVista && (
          <div style={{ display: 'flex', flex: 'none', border: '1px solid var(--line2)', borderRadius: 10, padding: 3, gap: 3, background: 'var(--surface2)' }}>
            {[['jornada', 'Mi jornada'], ['panel', 'Panel']].map(([k, label]) => {
              const on = encargadoVista === k
              return (
                <button
                  key={k}
                  onClick={() => onCambiarVista?.(k)}
                  style={{
                    border: 'none', borderRadius: 8, padding: isMobile ? '5px 9px' : '6px 12px', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-body)',
                    background: on ? 'var(--primary)' : 'transparent', color: on ? 'var(--on-primary)' : 'var(--muted)',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )}

        <div style={{ flex: 1, minWidth: 8 }} />

        {/* Identidad + rol */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
          {!isMobile && (
            <div style={{ textAlign: 'right', lineHeight: 1.15 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nombre}</div>
              <div style={{ fontSize: 9.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{user?.email}</div>
            </div>
          )}
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 5, padding: isMobile ? '5px 8px' : '5px 10px', borderRadius: 99,
            fontSize: 11, fontWeight: 600, color: meta.color, background: 'var(--surface2)', border: '1px solid var(--line)',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: meta.color }} />
            {isMobile ? meta.label.slice(0, 3) : meta.label}
          </span>
        </div>

        {/* Selector de dispositivo */}
        <button
          onClick={() => setMode(isMobile ? 'desktop' : 'mobile')}
          title={isMobile ? 'Cambiar a vista PC' : 'Cambiar a vista Celular'}
          style={iconBtn}
        >
          {isMobile ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>
          )}
        </button>

        <button onClick={toggleTheme} title="Cambiar tema Light/Dark" style={isMobile ? iconBtn : textBtn}>
          {isDark ? <Sun /> : <Moon />}
          {!isMobile && (isDark ? 'Dark' : 'Light')}
        </button>

        <button onClick={() => signOut()} title="Cerrar sesión" style={isMobile ? iconBtn : textBtn}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
          {!isMobile && 'Salir'}
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

const textBtn = {
  flex: 'none', display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--line)',
  borderRadius: 10, padding: '7px 12px', cursor: 'pointer', color: 'var(--muted)', fontSize: 12,
  fontWeight: 600, background: 'transparent', fontFamily: 'var(--font-body)',
}

const iconBtn = {
  flex: 'none', display: 'grid', placeItems: 'center', width: 34, height: 34, border: '1px solid var(--line)',
  borderRadius: 10, cursor: 'pointer', color: 'var(--muted)', background: 'transparent',
}
