import { useState } from 'react'
import { sx } from '../../lib/sx'
import { isNative } from '../../services/platform'
import { abrirAjustesUbicacion } from '../../services/geolocation'

/**
 * Aviso de un paso (una sola vez) para que el móvil active "Permitir siempre" la
 * ubicación. Android 11+ NO deja pedirlo por diálogo: solo se activa desde los
 * Ajustes del teléfono. Este aviso lo explica y lleva de un toque a esa pantalla.
 *
 * No bloquea: es un cartel encima de la app que se puede posponer. Solo en nativo.
 * Se muestra una vez (localStorage `lu-permiso-siempre-visto`).
 */
const VISTO_KEY = 'lu-permiso-siempre-visto'

export default function PermisoSiemprePrompt() {
  const [oculto, setOculto] = useState(() => {
    try { return !isNative() || localStorage.getItem(VISTO_KEY) === '1' } catch (_) { return !isNative() }
  })
  const [abriendo, setAbriendo] = useState(false)

  if (oculto) return null

  const cerrar = () => {
    try { localStorage.setItem(VISTO_KEY, '1') } catch (_) {}
    setOculto(true)
  }
  const abrir = async () => {
    setAbriendo(true)
    await abrirAjustesUbicacion()
    setAbriendo(false)
    cerrar() // al volver de ajustes, no repetir el aviso
  }

  return (
    <div style={sx('position:fixed;inset:0;z-index:400;display:flex;align-items:flex-end;justify-content:center')}>
      <div onClick={cerrar} style={sx('position:absolute;inset:0;background:var(--scrim)')} />
      <div style={sx('position:relative;width:100%;max-width:460px;background:var(--surface);border:1px solid var(--line2);border-radius:22px 22px 0 0;box-shadow:var(--shadow-lg);padding:22px 20px calc(22px + env(safe-area-inset-bottom));animation:lu-rise .26s ease')}>
        <div style={sx('width:38px;height:4px;border-radius:99px;background:var(--line2);margin:0 auto 16px')} />
        <div style={sx('display:flex;align-items:center;gap:12px;margin-bottom:12px')}>
          <div style={sx('width:46px;height:46px;flex:none;border-radius:14px;background:var(--warning-tint);color:var(--warning);display:grid;place-items:center')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
          </div>
          <div style={sx('flex:1;min-width:0')}>
            <div style={sx('font-family:var(--font-display);font-weight:700;font-size:17px')}>Activá "Permitir siempre"</div>
            <div style={sx('font-size:11.5px;color:var(--muted);font-family:var(--font-mono);margin-top:1px')}>Ubicación en segundo plano</div>
          </div>
        </div>
        <div style={sx('font-size:13.5px;color:var(--muted);line-height:1.55;margin-bottom:16px')}>
          Para que tu recorrido no se corte cuando bloqueás la pantalla o cambiás de app, la ubicación
          tiene que estar en <b style={sx('color:var(--text)')}>Permitir siempre</b>. Tocá abajo y en la
          pantalla de Android elegí: <b style={sx('color:var(--text)')}>Ubicación → Permitir siempre</b>.
        </div>
        <button onClick={abrir} disabled={abriendo} style={sx('width:100%;min-height:50px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border:none;border-radius:14px;font-weight:600;font-size:15px;cursor:pointer')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></svg>
          {abriendo ? 'Abriendo ajustes…' : 'Abrir ajustes de ubicación'}
        </button>
        <button onClick={cerrar} style={sx('width:100%;min-height:44px;margin-top:8px;background:transparent;color:var(--muted);border:none;font-weight:600;font-size:13.5px;cursor:pointer')}>
          Más tarde
        </button>
      </div>
    </div>
  )
}
