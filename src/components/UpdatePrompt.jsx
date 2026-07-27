import { useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { sx } from '../lib/sx'
import { isNative } from '../services/platform'
import { otaReady, otaCheck, otaDownload, otaReload } from '../services/ota'
import { apkCheck, apkStartUpdate } from '../services/apkUpdate'

/**
 * Aviso de "actualización disponible". Tres flujos:
 *  - Web/PWA: detecta un service worker nuevo y recarga a la versión nueva.
 *  - Nativo/APK (OTA): capgo — descarga el bundle web nuevo (app_config.bundle_*) y, al tocar
 *    "Reiniciar", lo aplica sin reinstalar. Cubre la mayoría de los cambios.
 *  - Nativo/APK (reinstalación): cuando cambió algo NATIVO, la OTA no alcanza. Si la versión
 *    instalada quedó por debajo de `app_config.min_version`, se baja el .apk (GitHub Releases)
 *    y se lanza el instalador de Android (un solo diálogo del sistema). Ver services/apkUpdate.
 *
 * En nativo se chequea el APK PRIMERO: si hay reinstalación pendiente manda esa (trae también el
 * web nuevo), y así nunca se muestran los dos avisos a la vez. Si no, cae a la OTA.
 */
export default function UpdatePrompt() {
  const [show, setShow] = useState(false)
  const [modo, setModo] = useState('ota') // 'ota' | 'apk' (solo relevante en nativo)
  const [fase, setFase] = useState('idle') // idle | descargando | listo | instalando | permiso | error
  const [msg, setMsg] = useState(null)
  const nativo = isNative()
  const updateRef = useRef(null) // web: updateSW
  const otaRef = useRef(null)    // nativo OTA: {version, url}
  const apkRef = useRef(null)    // nativo APK: {version, url}

  // Web/PWA: nuevo service worker disponible.
  useEffect(() => {
    if (nativo) return
    updateRef.current = registerSW({ onNeedRefresh() { setShow(true) } })
  }, [nativo])

  // Nativo: primero confirmar el bundle actual (evita rollback de capgo), después decidir qué
  // ofrecer. APK (reinstalación) tiene prioridad sobre la OTA; si no hay APK pendiente, OTA.
  useEffect(() => {
    if (!nativo) return
    let cancel = false
    otaReady()
    apkCheck().then((apk) => {
      if (cancel) return
      if (apk) { apkRef.current = apk; setModo('apk'); setShow(true); return }
      otaCheck().then((u) => { if (!cancel && u) { otaRef.current = u; setModo('ota'); setShow(true) } })
    })
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
    // NATIVO · REINSTALACIÓN DE APK
    if (modo === 'apk') {
      setFase('descargando'); setMsg(null)
      try {
        const res = await apkStartUpdate(apkRef.current)
        if (res?.needsPermission) {
          setFase('permiso')
          setMsg('Activá "Instalar apps desconocidas" para esta app y volvé a tocar Actualizar.')
        } else {
          // El instalador del sistema ya está en pantalla; la app pasa a segundo plano.
          setFase('instalando')
          setMsg('Seguí los pasos del instalador para completar la actualización.')
        }
      } catch (e) {
        setFase('error')
        setMsg('No se pudo descargar la actualización: ' + (e?.message || 'sin conexión'))
      }
      return
    }
    // NATIVO · OTA
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

  const esApk = nativo && modo === 'apk'

  const titulo = fase === 'listo' ? 'Actualización lista'
    : fase === 'instalando' ? 'Instalando…'
    : esApk ? 'Nueva versión de la app'
    : 'Actualización disponible'

  const texto = !nativo
    ? 'Hay una nueva versión de la app.'
    : msg ? msg
    : fase === 'descargando' ? 'Descargando la actualización…'
    : fase === 'listo' ? 'Actualización lista. Tocá Reiniciar para aplicarla.'
    : esApk ? 'Hay una versión nueva para instalar. Se descarga sola; solo confirmá la instalación.'
    : 'La app se actualiza sola, sin reinstalar.'

  const cta = !nativo ? 'Actualizar'
    : fase === 'descargando' ? '…'
    : fase === 'listo' ? 'Reiniciar app'
    : fase === 'instalando' ? 'Instalando…'
    : fase === 'permiso' ? 'Actualizar'
    : fase === 'error' ? 'Reintentar'
    : 'Actualizar'

  const ctaDisabled = fase === 'descargando' || fase === 'instalando'

  return (
    <div style={sx('position:fixed;left:12px;right:12px;bottom:12px;z-index:var(--z-toast);display:flex;justify-content:center;pointer-events:none')}>
      <div style={sx('pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:520px;width:100%;background:var(--surface);border:1px solid var(--primary);border-radius:14px;box-shadow:var(--shadow-lg);padding:12px 14px')}>
        <span style={sx('display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:9px;background:var(--primary-tint);color:var(--deep)')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
        </span>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('font-size:13px;font-weight:600')}>{titulo}</div>
          <div style={{ ...sx('font-size:11.5px;line-height:1.4'), color: fase === 'error' ? 'var(--danger)' : 'var(--muted)' }}>{texto}</div>
        </div>
        <button onClick={onCta} disabled={ctaDisabled} style={{ ...sx('flex:none;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:12.5px;font-weight:600;padding:8px 14px;cursor:pointer'), opacity: ctaDisabled ? 0.6 : 1 }}>
          {cta}
        </button>
      </div>
    </div>
  )
}
