import { sx } from '../lib/sx'
import { useDevice } from '../context/DeviceContext'
import Overlay from './Overlay'

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
    ...sx('flex:1;display:flex;flex-direction:column;align-items:center;gap:10px;padding:20px 14px;border-radius:var(--r-lg);cursor:pointer;font-weight:600;font-size:var(--fs-md)'),
    border: `2px solid ${active ? 'var(--primary)' : 'var(--line2)'}`,
    background: active ? 'var(--primary-tint)' : 'var(--surface)',
    color: active ? 'var(--deep)' : 'var(--muted)',
  })

  // dismissible={false}: es una decisión obligatoria, no hay opción de cerrar.
  // Eso apaga el botón ✕, el cierre por scrim y el Escape, todo junto.
  return (
    <Overlay open onClose={() => {}} maxWidth={420} dismissible={false}>
      <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-xl);text-align:center')}>¿Desde qué dispositivo entrás?</div>
      <div style={sx('font-size:var(--fs-sm);color:var(--muted);text-align:center;margin:6px 0 18px')}>
        Ajustamos la vista para que se vea bien. Podés cambiarlo después desde el botón de dispositivo.
      </div>
      <div style={sx('display:flex;gap:12px')}>
        <button type="button" onClick={() => setMode('mobile')} className="lu-press" style={card(auto === 'mobile')}>
          <PhoneGlyph />
          Celular
          {auto === 'mobile' && <span style={sx('font-size:var(--fs-2xs);font-weight:600;color:var(--primary)')}>sugerido</span>}
        </button>
        <button type="button" onClick={() => setMode('desktop')} className="lu-press" style={card(auto === 'desktop')}>
          <DesktopGlyph />
          PC
          {auto === 'desktop' && <span style={sx('font-size:var(--fs-2xs);font-weight:600;color:var(--primary)')}>sugerido</span>}
        </button>
      </div>
    </Overlay>
  )
}
