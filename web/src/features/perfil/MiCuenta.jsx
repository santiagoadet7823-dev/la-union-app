import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { useAuth } from '../../context/AuthContext'
import { useDevice } from '../../context/DeviceContext'
import { APP_VERSION } from '../../version'
import { estadoOta } from '../../services/ota'
import MiPerfilModal from './MiPerfilModal'
import CompartirUbicacion from '../../components/CompartirUbicacion'
import ThemeToggle from '../../components/ThemeToggle'
import { ChevronRight, LogOut, Monitor, Profile, Smartphone } from '../../components/icons'

/**
 * Sección "Mi cuenta" reutilizable: las MISMAS acciones que el menú de cuenta del admin
 * (SupervisionMovil), para unificar el perfil entre roles. La usan el Perfil del Vendedor y
 * el Repartidor, que antes no tenían editar perfil / tema / cerrar sesión.
 *
 *   - Mi perfil    → abre MiPerfilModal (editar nombre + teléfono).
 *   - Apariencia   → toggle Oscuro/Claro (components/ThemeToggle).
 *   - Cerrar sesión→ signOut (useAuth).
 *
 * props: { onToast }
 */
const ROLE_LABEL = { encargado: 'Encargado', admin: 'Administrador', superadmin: 'Superadmin', vendedor: 'Vendedor', repartidor: 'Repartidor' }
const item = { ...sx('display:flex;align-items:center;gap:12px;padding:13px 4px;cursor:pointer;min-height:44px;box-sizing:border-box') }
const iconBox = { ...sx('width:32px;height:32px;flex:none;border-radius:10px;background:var(--surface2);border:1px solid var(--line);display:grid;place-items:center;color:var(--deep)') }

export default function MiCuenta({ onToast, showDeviceToggle = false }) {
  const { perfil, user, rol, signOut } = useAuth()
  const { isMobile, setMode } = useDevice()
  const [perfilOpen, setPerfilOpen] = useState(false)
  // 🩸 QUÉ VERSIÓN HAY ESPERANDO (20/08/2026). `APP_VERSION` es una constante compilada dentro del
  // bundle que está corriendo, así que jamás puede avisar de una actualización ya descargada. El
  // 19/08 los nueve equipos pasaron un día entero en la versión anterior con el bundle nuevo ya
  // bajado en cada teléfono, y desde la app no había forma de verlo ni de aplicarlo.
  const [ota, setOta] = useState(null)
  useEffect(() => { let vivo = true; estadoOta().then((e) => { if (vivo) setOta(e) }).catch(() => {}); return () => { vivo = false } }, [])
  const nombre = perfil?.nombre || user?.email || 'Usuario'

  return (
    <div className="lu-modal-card" style={sx('background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow);padding:6px 14px')}>
      <div style={sx('display:flex;align-items:center;gap:12px;padding:13px 4px 11px')}>
        <div style={sx('width:44px;height:44px;flex:none;border-radius:14px;background:var(--tlight);color:var(--deep);display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:16px')}>{nombre.slice(0, 2).toUpperCase()}</div>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{nombre}</div>
          <div style={sx('font-size:11px;color:var(--muted);font-family:var(--font-mono)')}>{ROLE_LABEL[rol] || rol || '—'} · {user?.email || ''}</div>
          <div style={sx('font-size:10px;color:var(--faint);font-family:var(--font-mono);margin-top:2px')}>
            App v{APP_VERSION}
            {ota?.encolado && <span style={sx('color:var(--primary)')}> · v{ota.encolado} lista (se aplica al reabrir)</span>}
            {ota?.error && !ota?.encolado && <span style={sx('color:var(--warning)')}> · no se pudo actualizar</span>}
          </div>
        </div>
      </div>

      <div style={sx('height:0.5px;background:var(--line)')} />

      <div onClick={() => setPerfilOpen(true)} className="lu-press" style={item}>
        <div style={iconBox}><Profile size={15} /></div>
        <span style={sx('flex:1;font-size:13.5px;font-weight:500')}>Mi perfil</span>
        <ChevronRight size={16} />
      </div>

      <div style={sx('height:0.5px;background:var(--line)')} />

      <div style={sx('padding:12px 4px')}>
        <div style={sx('font-size:9.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);margin-bottom:9px')}>Apariencia</div>
        <ThemeToggle />
      </div>

      {showDeviceToggle && (
        <>
          <div style={sx('height:0.5px;background:var(--line)')} />
          <div style={sx('padding:12px 4px')}>
            <div style={sx('font-size:9.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);margin-bottom:9px')}>Vista</div>
            <div style={sx('display:flex;gap:6px;background:var(--surface2);border:1px solid var(--line);border-radius:12px;padding:4px')}>
              <div onClick={() => setMode('mobile')} style={themeBtn(isMobile)}><Smartphone size={14} />Celular</div>
              <div onClick={() => setMode('desktop')} style={themeBtn(!isMobile)}><Monitor size={14} />PC</div>
            </div>
          </div>
        </>
      )}

      <div style={sx('height:0.5px;background:var(--line)')} />

      {/* Compartir la propia ubicación con otra empresa. Va acá y no en un menú de gestión porque
          es una decisión sobre MIS datos, no sobre los del equipo: la toma cada uno sobre sí mismo
          y la puede cortar en el mismo lugar donde la prendió. */}
      <div style={sx('padding:12px 0')}>
        <CompartirUbicacion />
      </div>

      <div style={sx('height:0.5px;background:var(--line)')} />

      <div onClick={() => signOut()} className="lu-press" style={{ ...item, color: 'var(--danger)' }}>
        <div style={{ ...iconBox, color: 'var(--danger)', borderColor: 'var(--danger)', background: 'var(--danger-tint)' }}><LogOut size={15} /></div>
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
