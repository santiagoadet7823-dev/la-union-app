import { useEffect, useState } from 'react'
import { sx } from '../../lib/sx'
import { isNative } from '../../services/platform'
import { abrirAjustesUbicacion } from '../../services/geolocation'
import { estaExento, pedirExencion, abrirAutostart } from '../../services/battery'
import Overlay from '../../components/Overlay'

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
  // Dos condiciones distintas, y mezclarlas rompía la animación de salida:
  //   - `nuncaMostrar`: no corresponde el aviso (no es nativo, o ya se vio). No se
  //     renderiza NADA, ni siquiera el Overlay.
  //   - `abierto`: el usuario lo cerró. Acá sí hay que quedarse montado mientras
  //     corre la animación de salida, así que NO se puede hacer `return null`.
  const [nuncaMostrar] = useState(() => {
    try { return !isNative() || localStorage.getItem(VISTO_KEY) === '1' } catch (_) { return !isNative() }
  })
  const [abierto, setAbierto] = useState(!nuncaMostrar)
  const [abriendo, setAbriendo] = useState(false)
  const [exento, setExento] = useState(null) // null = aún no chequeado (no renderiza para evitar flash)

  // Estado de exención de batería: refresca al montar y al volver a foreground (el
  // usuario responde el diálogo del sistema en otra pantalla).
  useEffect(() => {
    if (!abierto) return
    let vivo = true
    const chequear = () => estaExento().then((v) => { if (vivo) setExento(v) }).catch(() => {})
    chequear()
    const onVis = () => { if (document.visibilityState === 'visible') chequear() }
    document.addEventListener('visibilitychange', onVis)
    return () => { vivo = false; document.removeEventListener('visibilitychange', onVis) }
  }, [abierto])

  if (nuncaMostrar) return null

  const cerrar = () => setAbierto(false)
  // El "ya lo vio" se persiste cuando el overlay terminó de irse, no antes.
  const marcarVisto = () => { try { localStorage.setItem(VISTO_KEY, '1') } catch (_) {} }
  const abrir = async () => {
    setAbriendo(true)
    await abrirAjustesUbicacion()
    setAbriendo(false)
    cerrar() // al volver de ajustes, no repetir el aviso
  }
  const pedirBateria = async () => {
    await pedirExencion() // el estado real llega por el visibilitychange al volver del diálogo del sistema
  }
  const abrirInicioAuto = async () => {
    await abrirAutostart() // abre la lista de autostart del OEM (o el detalle de la app como fallback)
  }

  return (
    <Overlay open={abierto} onClose={marcarVisto} variant="sheet" maxWidth={460}>
        <div style={sx('display:flex;align-items:center;gap:12px;margin-bottom:12px')}>
          <div style={sx('width:46px;height:46px;flex:none;border-radius:var(--r-lg);background:var(--warning-tint);color:var(--warning);display:grid;place-items:center')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
          </div>
          <div style={sx('flex:1;min-width:0')}>
            <div style={sx('font-family:var(--font-display);font-weight:700;font-size:var(--fs-lg)')}>Activá "Permitir siempre"</div>
            <div style={sx('font-size:var(--fs-xs);color:var(--muted);font-family:var(--font-mono);margin-top:1px')}>Ubicación en segundo plano</div>
          </div>
        </div>
        <div style={sx('font-size:13.5px;color:var(--muted);line-height:1.55;margin-bottom:12px')}>
          Para que tu recorrido no se corte cuando bloqueás la pantalla o cambiás de app, la ubicación
          tiene que estar en <b style={sx('color:var(--text)')}>Permitir siempre</b>. Tocá abajo y en la
          pantalla de Android elegí: <b style={sx('color:var(--text)')}>Ubicación → Permitir siempre</b>.
        </div>
        <div style={sx('font-size:12.5px;color:var(--muted);line-height:1.5;margin-bottom:12px;padding:10px 12px;background:var(--warning-tint);border:1px solid var(--warning);border-radius:12px')}>
          <b style={sx('color:var(--text)')}>Clave:</b> quitá la restricción de batería. Sin esto el
          teléfono corta el GPS a los pocos segundos de bloquear la pantalla.
        </div>
        {exento === true && (
          <div style={sx('display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:50px;background:var(--success-tint,var(--warning-tint));color:var(--success,var(--text));border:1px solid var(--success,var(--line2));border-radius:14px;font-weight:600;font-size:14px;margin-bottom:8px')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            Batería sin restricciones
          </div>
        )}
        {exento === false && (
          <button onClick={pedirBateria} style={sx('width:100%;min-height:50px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--warning);color:var(--on-primary,#fff);border:none;border-radius:14px;font-weight:600;font-size:15px;cursor:pointer;margin-bottom:8px')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="6" width="18" height="12" rx="2" /><path d="M23 10v4" /></svg>
            Quitar restricción de batería
          </button>
        )}
        {/* Inicio automático (autostart): lista APARTE de la batería en Xiaomi/Huawei/Oppo/Vivo.
            Sin esto el SO mata el proceso y el GPS deja de grabar aunque la batería esté sin
            restricciones. Se muestra siempre (no sabemos la marca desde JS de forma fiable). */}
        <button onClick={abrirInicioAuto} className="lu-press" style={sx('width:100%;min-height:50px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--surface);color:var(--text);border:1px solid var(--line2);border-radius:14px;font-weight:600;font-size:15px;cursor:pointer;margin-bottom:8px')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" /></svg>
          Permitir inicio automático
        </button>
        <div style={sx('font-size:11.5px;color:var(--faint);line-height:1.5;margin-bottom:10px;text-align:center')}>
          En Xiaomi, Huawei y similares, activá <b style={sx('color:var(--muted)')}>Inicio automático</b> para la app.
        </div>
        <button onClick={abrir} disabled={abriendo} style={sx('width:100%;min-height:50px;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--primary);color:var(--on-primary);border:none;border-radius:14px;font-weight:600;font-size:15px;cursor:pointer')}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></svg>
          {abriendo ? 'Abriendo ajustes…' : 'Abrir ajustes de ubicación'}
        </button>
        <button type="button" onClick={cerrar} className="lu-press" style={sx('width:100%;min-height:44px;margin-top:8px;background:transparent;color:var(--muted);border:none;font-weight:600;font-size:13.5px;cursor:pointer')}>
          Más tarde
        </button>
    </Overlay>
  )
}
