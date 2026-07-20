import { useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { sx } from '../lib/sx'
import { isNative } from '../services/platform'
import { otaReady, otaCheck, otaDownload, otaReload } from '../services/ota'

/**
 * Aviso de "actualización disponible":
 *  - Web/PWA: detecta un service worker nuevo y recarga a la versión nueva.
 *  - Nativo/APK: OTA con capgo — descarga el bundle nuevo (app_config) y, al tocar
 *    "Reiniciar", lo aplica sin reinstalar. Flujo explícito: Actualizar → descarga
 *    → "Listo · Reiniciar app".
 */
export default function UpdatePrompt() {
  const [show, setShow] = useState(false)
  const [fase, setFase] = useState('idle') // idle | descargando | listo | error
  const [msg, setMsg] = useState(null)
  const nativo = isNative()
  const updateRef = useRef(null) // web: updateSW
  const otaRef = useRef(null)    // nativo: {version, url}

  // Web/PWA: nuevo service worker disponible.
  useEffect(() => {
    if (nativo) return
    updateRef.current = registerSW({ onNeedRefresh() { setShow(true) } })
  }, [nativo])

  // Nativo: confirmar el bundle actual y chequear si hay uno más nuevo.
  useEffect(() => {
    if (!nativo) return
    let cancel = false
    otaReady()
    otaCheck().then((u) => { if (!cancel && u) { otaRef.current = u; setShow(true) } })
    return () => { cancel = true }
  }, [nativo])

  if (!show) return null

  const onCta = async () => {
    // WEB
    if (!nativo) {
      const updateSW = updateRef.current
      if (updateSW) updateSW(true); else window.location.reload()
      return
    }
    // NATIVO
    if (fase === 'listo') { try { await otaReload() } catch (_) {} return }
    setFase('descargando'); setMsg(null)
    try {
      await otaDownload(otaRef.current)
      setFase('listo')
    } catch (e) {
      setFase('error')
      setMsg('No se pudo descargar: ' + (e?.message || 'sin conexión'))
    }
  }

  const texto = !nativo
    ? 'Hay una nueva versión de la app.'
    : fase === 'descargando' ? 'Descargando la actualización…'
    : fase === 'listo' ? 'Actualización lista. Tocá Reiniciar para aplicarla.'
    : fase === 'error' ? msg
    : 'La app se actualiza sola, sin reinstalar.'

  const cta = !nativo ? 'Actualizar'
    : fase === 'descargando' ? '…'
    : fase === 'listo' ? 'Reiniciar app'
    : fase === 'error' ? 'Reintentar'
    : 'Actualizar'

  return (
    <div style={sx('position:fixed;left:12px;right:12px;bottom:12px;z-index:var(--z-toast);display:flex;justify-content:center;pointer-events:none')}>
      <div style={sx('pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:520px;width:100%;background:var(--surface);border:1px solid var(--primary);border-radius:14px;box-shadow:var(--shadow-lg);padding:12px 14px')}>
        <span style={sx('display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:9px;background:var(--primary-tint);color:var(--deep)')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
        </span>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('font-size:13px;font-weight:600')}>{fase === 'listo' ? 'Actualización lista' : 'Actualización disponible'}</div>
          <div style={{ ...sx('font-size:11.5px;line-height:1.4'), color: fase === 'error' ? 'var(--danger)' : 'var(--muted)' }}>{texto}</div>
        </div>
        <button onClick={onCta} disabled={fase === 'descargando'} style={{ ...sx('flex:none;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:12.5px;font-weight:600;padding:8px 14px;cursor:pointer'), opacity: fase === 'descargando' ? 0.6 : 1 }}>
          {cta}
        </button>
      </div>
    </div>
  )
}
