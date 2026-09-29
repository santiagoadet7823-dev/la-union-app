import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { sx } from '../../lib/sx'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../context/AuthContext'
import { APP_VERSION } from '../../version'
import Isotipo from '../../components/Isotipo'

/**
 * ACEPTAR POLÍTICA DE PRIVACIDAD — bloquea el Gate entero. 29/09/2026 (db/81, Tarea 2.3).
 *
 * Solo aparece cuando `app_config.politica_version` tiene un valor (el documento ya pasó revisión
 * legal y se publicó) Y esta cuenta todavía no aceptó esa versión exacta. Mientras la versión sea
 * null, esta pantalla no se muestra NUNCA — el gate está apagado a propósito.
 *
 * Va DESPUÉS de la 2FA en el Gate: no tiene sentido pedirle esto a una sesión que ni siquiera separó
 * la verificación en dos pasos.
 */
export default function AceptarPolitica() {
  const { refetchPolitica, politicaUrl, signOut } = useAuth()
  const [aceptando, setAceptando] = useState(false)
  const [error, setError] = useState('')

  async function aceptar() {
    if (aceptando) return
    setAceptando(true); setError('')
    const { error: errRpc } = await supabase.rpc('aceptar_documento', {
      p_documento: 'politica_privacidad',
      p_plataforma: Capacitor.isNativePlatform() ? 'android' : 'web',
      p_version_app: APP_VERSION,
    })
    setAceptando(false)
    if (errRpc) {
      // 'sin-version-vigente': se apagó el gate justo mientras esta pantalla estaba abierta (raro,
      // pero posible) — no es un error de la persona, refetchPolitica() la saca de acá sola.
      if (/sin-version-vigente/.test(errRpc.message)) { await refetchPolitica(); return }
      setError('No se pudo guardar. Probá de nuevo en un momento.')
      return
    }
    await refetchPolitica()
  }

  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;background:var(--bg-app);color:var(--text);padding:24px 20px;box-sizing:border-box')}>
      <div style={sx('width:100%;max-width:420px;margin:0 auto;display:flex;flex-direction:column;flex:1')}>
        <div style={{ ...sx('display:flex;flex-direction:column;align-items:center;margin-top:24px'), '--gy': '10px' }}>
          <div style={sx('width:64px;height:64px;border-radius:18px;background:#0C0C0C;display:grid;place-items:center;border:1px solid var(--line)')}>
            <Isotipo size={44} />
          </div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:var(--fs-xl);letter-spacing:.03em;text-align:center')}>
            Actualizamos la política de privacidad
          </div>
          <div style={sx('font-size:var(--fs-md);color:var(--muted);text-align:center;line-height:1.5')}>
            Antes de seguir, necesitamos que la leas y la aceptes. Explica qué información registra la
            aplicación durante tu jornada, para qué se usa y qué derechos tenés sobre ella.
          </div>
        </div>

        <div style={{ ...sx('display:flex;flex-direction:column;margin-top:28px'), '--gy': '12px' }}>
          {politicaUrl ? (
            <a href={politicaUrl} target="_blank" rel="noreferrer" className="lu-press"
              style={sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:52px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line2);color:var(--text);font-size:var(--fs-md);font-weight:600;text-decoration:none')}>
              Leer la política completa
            </a>
          ) : (
            <div style={sx('font-size:var(--fs-sm);color:var(--muted);text-align:center;line-height:1.5')}>
              Pedile el texto completo a tu administrador si todavía no lo viste.
            </div>
          )}

          {error && <div style={sx('font-size:var(--fs-sm);color:var(--danger);line-height:1.5;text-align:center')}>{error}</div>}

          <button onClick={aceptar} disabled={aceptando} className="lu-press"
            style={{ ...sx('display:flex;align-items:center;justify-content:center;width:100%;min-height:56px;border-radius:var(--r-md);background:var(--primary);color:var(--on-primary);border:none;font-size:var(--fs-lg);font-weight:700'), '--gx': '10px', cursor: aceptando ? 'wait' : 'pointer', opacity: aceptando ? 0.7 : 1 }}>
            {aceptando && <span className="lu-spin" style={{ width: 20, height: 20, borderRadius: 999, border: '2.5px solid rgba(0,0,0,.18)', borderTopColor: 'var(--on-primary)' }} />}
            <span>{aceptando ? 'Guardando…' : 'Acepto'}</span>
          </button>
          <button onClick={signOut}
            style={sx('min-height:44px;background:transparent;border:none;font-size:var(--fs-sm);color:var(--muted);cursor:pointer')}>
            Cerrar sesión
          </button>
        </div>

        <div style={sx('flex:1;min-height:20px')} />
      </div>
    </div>
  )
}
