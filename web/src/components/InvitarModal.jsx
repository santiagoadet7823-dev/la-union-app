import { useEffect, useRef, useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { sx } from '../lib/sx'
import { isNative } from '../services/platform'
import { getAppConfig } from '../services/data/appConfig'
import Overlay from './Overlay'

/**
 * Ventana flotante "Invitar / agregar personal": muestra un QR que apunta a la descarga de la app.
 * El nuevo integrante lo escanea con su celular y baja el APK.
 *
 * El QR se genera en NATIVO (QrPlugin, ZXing) para no sumar una librería de QR al bundle web. La URL
 * sale de `app_config.apk_url` (el mismo .apk que publica el auto-updater); si todavía no está
 * cargada, cae al listado de releases del repo.
 */

const Qr = registerPlugin('Qr')
const RELEASES_URL = 'https://github.com/santiagoadet7823-dev/la-union-app/releases'

export default function InvitarModal({ open, onClose, onToast }) {
  const [url, setUrl] = useState(null)
  const [qr, setQr] = useState(null)
  const [fase, setFase] = useState('cargando') // cargando | ok | sin-qr | error
  // Retener la última URL durante la animación de salida del Overlay (gotcha §7.2 de CLAUDE.md).
  const urlRef = useRef(null)
  if (url) urlRef.current = url

  useEffect(() => {
    if (!open) return
    let cancel = false
    setFase('cargando'); setQr(null)
    ;(async () => {
      let destino = RELEASES_URL
      try {
        const cfg = await getAppConfig()
        if (cfg?.apk_url) destino = cfg.apk_url
      } catch (_) {}
      if (cancel) return
      setUrl(destino)
      // El QR solo se genera en el APK (plugin nativo Qr). En web/PWA, o en un APK viejo que recibió
      // este JS por OTA pero no trae el plugin, se muestra el link para copiar en vez de romper.
      if (!isNative() || !Capacitor.isPluginAvailable('Qr')) { setFase('sin-qr'); return }
      try {
        const { dataUrl } = await Qr.generar({ text: destino, size: 640 })
        if (cancel) return
        setQr(dataUrl); setFase('ok')
      } catch (_) {
        if (!cancel) setFase('error')
      }
    })()
    return () => { cancel = true }
  }, [open])

  const copiar = async () => {
    const u = urlRef.current
    if (!u) return
    try {
      await navigator.clipboard.writeText(u)
      onToast?.('Link copiado')
    } catch (_) {
      onToast?.('Copiá el link manualmente')
    }
  }

  return (
    <Overlay
      open={open}
      onClose={onClose}
      title="Invitar a la app"
      subtitle="El nuevo integrante escanea el código con su celular para descargar la app."
      maxWidth={380}
      footer={
        <>
          <button onClick={copiar} className="lu-press" style={{ ...btnGhost, flex: 1, minHeight: 44 }}>Copiar link</button>
          <button onClick={onClose} className="lu-press" style={{ ...btnPrimary, flex: 1, minHeight: 44 }}>Listo</button>
        </>
      }
    >
      <div style={sx('display:flex;flex-direction:column;align-items:center;gap:14px;padding:4px 0')}>
        <div style={{ ...sx('width:230px;height:230px;display:grid;place-items:center;border-radius:14px;background:#fff;border:1px solid var(--line)'), overflow: 'hidden' }}>
          {fase === 'cargando' && <span style={sx('font-size:12px;color:var(--faint);font-family:var(--font-mono)')}>Generando…</span>}
          {fase === 'ok' && qr && <img src={qr} alt="QR de descarga" style={sx('width:100%;height:100%;object-fit:contain')} />}
          {fase === 'sin-qr' && (
            <span style={sx('font-size:11.5px;color:var(--muted);text-align:center;line-height:1.5;padding:0 16px')}>
              El código QR se ve desde la app en el celular. En la PC, compartí el link de abajo.
            </span>
          )}
          {fase === 'error' && <span style={sx('font-size:12px;color:var(--danger);text-align:center;padding:0 16px')}>No se pudo generar el código.</span>}
        </div>
        <div style={sx('width:100%;font-size:11px;font-family:var(--font-mono);color:var(--muted);word-break:break-all;text-align:center;line-height:1.5')}>
          {url || '—'}
        </div>
      </div>
    </Overlay>
  )
}

const btnPrimary = { ...sx('padding:7px 13px;border:none;border-radius:9px;background:var(--primary);color:var(--on-primary);font-size:12px;font-weight:600;cursor:pointer') }
const btnGhost = { ...sx('padding:7px 11px;border:1px solid var(--line2);border-radius:9px;background:transparent;color:var(--muted);font-size:12px;font-weight:600;cursor:pointer') }
