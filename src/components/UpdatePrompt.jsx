import { useEffect, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { Browser } from '@capacitor/browser'
import { sx } from '../lib/sx'
import { isNative } from '../services/platform'
import { supabase, hasSupabase } from '../services/supabase'
import { APP_VERSION } from '../version'

/**
 * Aviso de "actualización disponible":
 *  - Web/PWA: detecta un service worker nuevo (registerSW) y ofrece recargar a la
 *    versión nueva con un toque.
 *  - Nativo/APK: compara APP_VERSION contra `app_config.latest_version` (Supabase).
 *    Si hay una versión más nueva, avisa; si hay `apk_url`, la abre para descargar
 *    (el APK no se auto-actualiza, pero la opción ya queda integrada).
 */
export default function UpdatePrompt() {
  const [show, setShow] = useState(false)
  const [apkUrl, setApkUrl] = useState(null)
  const nativo = isNative()
  const updateRef = useRef(null)

  // Web/PWA: nuevo SW disponible.
  useEffect(() => {
    if (nativo) return
    updateRef.current = registerSW({
      onNeedRefresh() { setShow(true) },
    })
  }, [nativo])

  // Nativo/APK: comparar versión contra la config remota.
  useEffect(() => {
    if (!nativo || !hasSupabase) return
    let cancel = false
    supabase.from('app_config').select('latest_version, apk_url').maybeSingle()
      .then(({ data }) => {
        if (cancel || !data?.latest_version) return
        if (data.latest_version !== APP_VERSION) {
          setApkUrl(data.apk_url || null)
          setShow(true)
        }
      })
    return () => { cancel = true }
  }, [nativo])

  if (!show) return null

  const puedeAplicar = !nativo || !!apkUrl
  const texto = nativo
    ? (apkUrl ? 'Hay una nueva versión de la app disponible.' : 'Hay una nueva versión. Pedí el APK actualizado al administrador.')
    : 'Hay una nueva versión de la app.'
  const cta = nativo ? (apkUrl ? 'Descargar' : 'Entendido') : 'Actualizar'

  const onCta = async () => {
    if (nativo) {
      if (apkUrl) { try { await Browser.open({ url: apkUrl }) } catch (_) {} }
      setShow(false)
      return
    }
    const updateSW = updateRef.current
    if (updateSW) updateSW(true) // recarga con el SW nuevo aplicado
    else window.location.reload()
  }

  return (
    <div style={sx('position:fixed;left:12px;right:12px;bottom:12px;z-index:300;display:flex;justify-content:center;pointer-events:none')}>
      <div style={sx('pointer-events:auto;display:flex;align-items:center;gap:12px;max-width:520px;width:100%;background:var(--surface);border:1px solid var(--primary);border-radius:14px;box-shadow:var(--shadow-lg);padding:12px 14px')}>
        <span style={sx('display:grid;place-items:center;width:32px;height:32px;flex:none;border-radius:9px;background:var(--primary-tint);color:var(--deep)')}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v6h-6" /></svg>
        </span>
        <div style={sx('flex:1;min-width:0')}>
          <div style={sx('font-size:13px;font-weight:600')}>Actualización disponible</div>
          <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.4')}>{texto}</div>
        </div>
        {!puedeAplicar && (
          <button onClick={() => setShow(false)} style={sx('flex:none;border:1px solid var(--line2);border-radius:10px;background:transparent;color:var(--muted);font-size:12.5px;font-weight:600;padding:8px 12px;cursor:pointer')}>{cta}</button>
        )}
        {puedeAplicar && (
          <button onClick={onCta} style={sx('flex:none;border:none;border-radius:10px;background:var(--primary);color:var(--on-primary);font-size:12.5px;font-weight:600;padding:8px 14px;cursor:pointer')}>{cta}</button>
        )}
      </div>
    </div>
  )
}
