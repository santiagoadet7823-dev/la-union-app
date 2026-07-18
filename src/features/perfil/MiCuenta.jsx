import { useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useDevice } from '../../context/DeviceContext'
import { APP_VERSION } from '../../version'
import MiPerfilModal from './MiPerfilModal'

/**
 * Sección "Mi cuenta" reutilizable: las MISMAS acciones que el menú de cuenta del admin
 * (SupervisionMovil), para unificar el perfil entre roles. La usan el Perfil del Vendedor y
 * el Repartidor, que antes no tenían editar perfil / tema / cerrar sesión.
 *
 *   - Mi perfil    → abre MiPerfilModal (editar nombre + teléfono).
 *   - Apariencia   → toggle Oscuro/Claro (useTheme).
 *   - Cerrar sesión→ signOut (useAuth).
 *
 * props: { onToast }
 */
const ROLE_LABEL = { propietario: 'Propietario', encargado: 'Encargado', admin: 'Administrador', superadmin: 'Superadmin', vendedor: 'Vendedor', repartidor: 'Repartidor' }
const item = { ...sx('display:flex;align-items:center;gap:12px;padding:13px 4px;cursor:pointer;min-height:44px;box-sizing:border-box') }
const iconBox = { ...sx('width:32px;height:32px;flex:none;border-radius:10px;background:var(--surface2);border:1px solid var(--line);display:grid;place-items:center;color:var(--deep)') }

export default function MiCuenta({ onToast, showDeviceToggle = false }) {
  const { perfil, user, rol, signOut } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const { isMobile, setMode } = useDevice()
  const [perfilOpen, setPerfilOpen] = useState(false)
  const nombre = perfil?.nombre || user?.email || 'Usuario'

  return (
    <div className="lu-modal-card" style={sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:6px 14px')}>
      <div style={sx('display:flex;align-items:center;gap:12px;padding:13px 4px 11px')}>
        <div style={sx('width:44px;height:44px;flex:none;border-radius:14px;background:var(--tlight);color:var(--deep);display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:16px')}>{nombre.slice(0, 2).toUpperCase()}</div>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{nombre}</div>
          <div style={sx('font-size:11px;color:var(--muted);font-family:var(--font-mono)')}>{ROLE_LABEL[rol] || rol || '—'} · {user?.email || ''}</div>
          <div style={sx('font-size:10px;color:var(--faint);font-family:var(--font-mono);margin-top:2px')}>App v{APP_VERSION}</div>
        </div>
      </div>

      <div style={sx('height:0.5px;background:var(--line)')} />

      <div onClick={() => setPerfilOpen(true)} className="lu-press" style={item}>
        <div style={iconBox}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.2" /><path d="M5 21c0-3.5 3.1-6 7-6s7 2.5 7 6" /></svg></div>
        <span style={sx('flex:1;font-size:13.5px;font-weight:500')}>Mi perfil</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
      </div>

      <div style={sx('height:0.5px;background:var(--line)')} />

      <div style={sx('padding:12px 4px')}>
        <div style={sx('font-size:9.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);margin-bottom:9px')}>Apariencia</div>
        <div style={sx('display:flex;gap:6px;background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:4px')}>
          <div onClick={() => { if (!isDark) toggleTheme() }} style={themeBtn(isDark)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>Oscuro</div>
          <div onClick={() => { if (isDark) toggleTheme() }} style={themeBtn(!isDark)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>Claro</div>
        </div>
      </div>

      {showDeviceToggle && (
        <>
          <div style={sx('height:0.5px;background:var(--line)')} />
          <div style={sx('padding:12px 4px')}>
            <div style={sx('font-size:9.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);margin-bottom:9px')}>Vista</div>
            <div style={sx('display:flex;gap:6px;background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:4px')}>
              <div onClick={() => setMode('mobile')} style={themeBtn(isMobile)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" /></svg>Celular</div>
              <div onClick={() => setMode('desktop')} style={themeBtn(!isMobile)}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>PC</div>
            </div>
          </div>
        </>
      )}

      <div style={sx('height:0.5px;background:var(--line)')} />

      <div onClick={() => signOut()} className="lu-press" style={{ ...item, color: 'var(--danger)' }}>
        <div style={{ ...iconBox, color: 'var(--danger)', borderColor: 'var(--danger)', background: 'var(--danger-tint)' }}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg></div>
        <span style={sx('flex:1;font-size:13.5px;font-weight:600')}>Cerrar sesión</span>
      </div>

      {perfilOpen && <MiPerfilModal onClose={() => setPerfilOpen(false)} onToast={onToast} />}
    </div>
  )
}

function themeBtn(active) {
  return {
    ...sx('flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:9px 0;border-radius:9px;font-size:12.5px;font-weight:600;cursor:pointer'),
    background: active ? 'var(--surface)' : 'transparent',
    color: active ? 'var(--deep)' : 'var(--muted)',
    boxShadow: active ? 'var(--shadow)' : 'none',
  }
}
