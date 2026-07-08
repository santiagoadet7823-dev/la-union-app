import { sx } from '../lib/sx'
import { useDevice } from '../context/DeviceContext'

/**
 * Banner inicial (una sola vez) para elegir Celular o PC. Guarda la elección; se
 * puede cambiar después desde el botón de la topbar. La detección automática ya
 * propone una opción, pero el usuario decide.
 */
function PhoneGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M11 18h2" />
    </svg>
  )
}
function DesktopGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
    </svg>
  )
}

export default function DeviceBanner() {
  const { chosen, auto, setMode } = useDevice()
  if (chosen) return null

  const card = (active) => ({
    ...sx('flex:1;display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px 14px;border-radius:16px;cursor:pointer;font-weight:600;font-size:14px'),
    border: `2px solid ${active ? 'var(--primary)' : 'var(--line2)'}`,
    background: active ? 'var(--primary-tint)' : 'var(--surface)',
    color: active ? 'var(--deep)' : 'var(--muted)',
  })

  return (
    <div style={sx('position:fixed;inset:0;z-index:200;display:grid;place-items:center;background:var(--scrim);padding:24px')}>
      <div style={sx('width:100%;max-width:420px;background:var(--surface);border:1px solid var(--line2);border-radius:20px;box-shadow:var(--shadow-lg);padding:24px')}>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:19px;text-align:center')}>¿Desde qué dispositivo entrás?</div>
        <div style={sx('font-size:12.5px;color:var(--muted);text-align:center;margin:6px 0 18px')}>
          Ajustamos la vista para que se vea bien. Podés cambiarlo después desde el botón de dispositivo.
        </div>
        <div style={sx('display:flex;gap:12px')}>
          <div onClick={() => setMode('mobile')} style={card(auto === 'mobile')}>
            <PhoneGlyph />
            Celular
            {auto === 'mobile' && <span style={sx('font-size:10px;font-weight:600;color:var(--primary)')}>sugerido</span>}
          </div>
          <div onClick={() => setMode('desktop')} style={card(auto === 'desktop')}>
            <DesktopGlyph />
            PC
            {auto === 'desktop' && <span style={sx('font-size:10px;font-weight:600;color:var(--primary)')}>sugerido</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
