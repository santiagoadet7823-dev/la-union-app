import { useEffect, useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { sx } from '../../lib/sx'
import { btnSecundario } from '../../lib/botones'
import { textoQr } from '../../services/vidriera'

/**
 * LA VENTANA DEL QR. Solo dibuja el código y explica qué hacer con él.
 *
 * 🩸 YA NO ES DUEÑA DE LA SESIÓN (19/08/2026, pedido del cliente con la vidriera en uso). Hasta hoy
 * abría el hotspot al montar y lo cerraba al desmontar, así que **cerrar esta ventana desconectaba
 * la tablet** — y el vendedor la cierra todo el tiempo: para buscar un producto en su catálogo, para
 * revisar el pedido, para hablar. Ahora la sesión vive en `useVidriera`, un nivel más arriba, y esto
 * es una vista que se abre y se cierra sin consecuencias.
 *
 * El QR además **solo sirve una vez**: apenas la tablet escanea, esta pantalla no aporta nada más.
 * Cerrarla es lo normal, no un accidente que haya que evitar.
 *
 * ⚠️ El QR se genera con `QrPlugin` (ZXing nativo), el mismo que usa el modal "Invitar". No se suma
 * una librería de QR al bundle web para esto.
 *
 * props: { red, error, abriendo, fotos, bt, onCerrarVentana, onCerrarVidriera, onReintentar }
 */

const Qr = registerPlugin('Qr')

export default function EspejoTablet({ red, error, abriendo, fotos, bt, onCerrarVentana, onCerrarVidriera, onReintentar }) {
  const [qr, setQr] = useState(null)
  const [sinQr, setSinQr] = useState(false)

  useEffect(() => {
    if (!red) { setQr(null); return }
    let cancel = false
    ;(async () => {
      if (!Capacitor.isPluginAvailable('Qr')) { setSinQr(true); return }
      try {
        const { dataUrl } = await Qr.generar({ text: textoQr(red), size: 720 })
        if (!cancel) setQr(dataUrl)
      } catch (_) {
        if (!cancel) setSinQr(true)
      }
    })()
    return () => { cancel = true }
  }, [red])

  return (
    <div style={sx('position:fixed;top:0;right:0;bottom:0;left:0;z-index:var(--z-screen);background:var(--bg-app);color:var(--text);display:flex;flex-direction:column')}>
      <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>Vidriera</div>
          <div style={sx('font-size:11.5px;color:var(--faint)')}>
            {red ? 'La tablet ya puede escanear' : 'Abriendo la red…'}
          </div>
        </div>
        {/* Cierra la VENTANA, no el enlace: el vendedor vuelve a su catálogo y la tablet sigue
            conectada. Ése es todo el cambio del 19/08. */}
        <button onClick={onCerrarVentana} className="lu-press" style={{ ...btnSecundario, minHeight: 40, padding: '0 16px' }}>
          Volver
        </button>
      </div>

      <div style={sx('flex:1;overflow-y:auto;padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:14px')}>
        {abriendo && !red && (
          <div style={sx('display:flex;flex-direction:column;align-items:center;gap:10px;padding:34px 0')}>
            <span style={sx('width:11px;height:11px;border-radius:99px;background:var(--primary);animation:lu-blink 1.2s infinite')} />
            <div style={sx('font-size:13px;color:var(--muted)')}>Abriendo la red para la tablet…</div>
          </div>
        )}

        {error && (
          <div style={sx('width:100%;padding:14px;border-radius:14px;background:var(--danger-tint);font-size:13px;line-height:1.55')}>
            {error}
            {/* 🩸 REINTENTAR SIN CERRAR LA HOJA (18/08/2026). Hasta hoy este estado era un cartel y
                nada más: había que salir y volver a entrar, delante del cliente, para reintentar
                algo que falla justamente cuando hay alguien esperando. `abrir()` ya limpia el error
                y no hace nada si la sesión está viva, así que el botón es seguro de apretar dos
                veces. */}
            {onReintentar && !abriendo && (
              <button onClick={onReintentar} className="lu-press"
                style={sx('display:block;margin-top:12px;min-height:44px;padding:0 18px;border:1px solid var(--danger);border-radius:12px;background:transparent;color:var(--danger);font-size:13px;font-weight:600;cursor:pointer')}>
                Reintentar
              </button>
            )}
          </div>
        )}

        {red && (
          <>
            <div style={{ ...sx('width:270px;height:270px;display:grid;place-items:center;border-radius:16px;background:#fff;border:1px solid var(--line)'), overflow: 'hidden' }}>
              {qr
                ? <img src={qr} alt="Código para la tablet" style={sx('width:100%;height:100%;object-fit:contain')} />
                : sinQr
                  ? <div style={sx('font-size:12px;color:#666;text-align:center;padding:12px')}>La red está abierta, pero este APK no puede dibujar el código.</div>
                  : <div style={sx('font-size:12px;color:#666')}>Generando…</div>}
            </div>

            <div style={sx('font-size:12.5px;color:var(--muted);text-align:center;line-height:1.55;max-width:300px')}>
              Escanealo desde la tablet, en <b>Soy una tablet</b>. No usa datos: la red no tiene
              salida a internet.
            </div>

            {/* 🩸 EL CAMINO SIN CÁMARA (18/08/2026). Si la tablet está vinculada por Bluetooth con
                este celular, no hace falta apuntar a nada. Es un renglón y no un botón porque acá
                no hay que hacer nada: el sobre ya está saliendo, la que toca es la tablet. */}
            {bt && (
              <div style={sx('display:flex;align-items:center;gap:8px;padding:8px 13px;border-radius:99px;background:var(--info-tint);color:var(--muted);font-size:11.5px')}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--info)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 7l10 10-5 5V2l5 5L7 17" /></svg>
                O sin cámara: en la tablet, <b>Buscar por Bluetooth</b>
              </div>
            )}
            <div style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>
              {red.ssid} · {red.ip}:{red.puerto}
            </div>

            {/* 🩸 EL ESPEJO A MEDIAS SE AVISA ACÁ (18/08/2026), que es la pantalla que el vendedor
                mira justo antes de darle la tablet. La foto que la tablet ve sale de la carpeta del
                teléfono, no de internet: sin "Preparar catálogo" esos productos se le muestran al
                cliente en gris. No traba nada — el catálogo funciona igual, con precios y todo. */}
            {fotos && fotos.faltan > 0 && (
              <div style={sx('width:100%;max-width:340px;padding:11px 13px;border-radius:12px;background:var(--warning-tint);color:var(--muted);font-size:12px;line-height:1.5')}>
                Le faltan <b>{fotos.faltan}</b> de {fotos.total} fotos a este teléfono: esos
                productos se le muestran al cliente sin imagen. Se bajan desde <b>Mi cuenta →
                Preparar catálogo</b>, mejor con WiFi.
              </div>
            )}

            {/* El ÚNICO camino que corta el enlace de verdad. Va separado del "Volver" y pintado como
                acción destructiva justamente porque los dos botones se parecían demasiado. */}
            <button onClick={onCerrarVidriera} className="lu-press"
              style={sx('margin-top:14px;min-height:46px;padding:0 20px;border:1px solid var(--danger);border-radius:12px;background:var(--danger-tint);color:var(--danger);font-size:13.5px;font-weight:600;cursor:pointer')}>
              Cerrar vidriera y desconectar la tablet
            </button>
          </>
        )}
      </div>
    </div>
  )
}
