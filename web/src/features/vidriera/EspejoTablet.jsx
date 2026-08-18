import { useCallback, useEffect, useRef, useState } from 'react'
import { Capacitor, registerPlugin } from '@capacitor/core'
import { sx } from '../../lib/sx'
import { fmtPesos } from '../../lib/format'
import { btnPrimario, btnSecundario } from '../../lib/botones'
import { abrirVidriera, cerrarVidriera, textoQr, alTocar, alCaerse, disponible } from '../../services/vidriera'

/**
 * EL QR QUE MUESTRA EL VENDEDOR. Levanta el hotspot local, publica el catálogo y dibuja el código
 * para que la tablet del cliente lo escanee. Después queda escuchando: cada producto que el cliente
 * toca aparece acá como un cartel con el botón de sumarlo al carrito.
 *
 * Es la mitad de la vidriera que corre en el celular; la otra es `ParearTablet` + `VidrieraTablet`.
 *
 * ⚠️ SE CIERRA SIEMPRE AL SALIR. El hotspot gasta batería y el teléfono ya vive al límite con el
 * GPS, así que `cerrarVidriera()` va en el desmontaje y no solo en el botón: si el vendedor sale con
 * el atrás de Android, igual se apaga.
 *
 * ⚠️ El QR se genera con `QrPlugin` (ZXing nativo), el mismo que usa el modal "Invitar". No se suma
 * una librería de QR al bundle web para esto.
 *
 * 🩸 El toque del cliente NO entra solo al carrito. Aparece como cartel y el vendedor decide: el
 * pedido es suyo y su cliente puede estar señalando para preguntar un precio, no para comprar.
 * `onSumar` es el que efectivamente lo agrega.
 */

const Qr = registerPlugin('Qr')

export default function EspejoTablet({ productos, comercio, onSumar, onCerrar }) {
  const [fase, setFase] = useState('abriendo') // abriendo | listo | error
  const [error, setError] = useState(null)
  const [qr, setQr] = useState(null)
  const [red, setRed] = useState(null)
  const [aviso, setAviso] = useState(null)   // producto tocado por el cliente
  const [mirados, setMirados] = useState([]) // todo lo que tocó, para el resumen del final
  const vivo = useRef(true)
  const timer = useRef(null)

  useEffect(() => () => {
    vivo.current = false
    clearTimeout(timer.current)
    cerrarVidriera()
  }, [])

  // Abrir el enlace y dibujar el QR. Corre una sola vez.
  useEffect(() => {
    let cancel = false
    ;(async () => {
      try {
        const r = await abrirVidriera({ productos, comercio })
        if (cancel || !vivo.current) return
        setRed(r)
        const texto = textoQr(r, comercio)
        if (Capacitor.isPluginAvailable('Qr')) {
          const { dataUrl } = await Qr.generar({ text: texto, size: 720 })
          if (cancel || !vivo.current) return
          setQr(dataUrl)
        }
        setFase('listo')
      } catch (e) {
        if (cancel || !vivo.current) return
        setError(e?.message || 'No se pudo abrir la vidriera.')
        setFase('error')
      }
    })()
    return () => { cancel = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Los toques del cliente y la caída del enlace.
  useEffect(() => {
    if (fase !== 'listo') return
    const offToque = alTocar((t) => {
      if (!vivo.current || !t?.id) return
      const p = productos.find((x) => x.id === t.id)
      if (!p) return
      setAviso(p)
      setMirados((m) => (m.some((x) => x.id === p.id) ? m : [...m, p]))
      // El cartel se va solo: si el cliente toca cinco cosas seguidas, el vendedor no puede quedar
      // cerrando carteles a mano mientras habla.
      clearTimeout(timer.current)
      timer.current = setTimeout(() => { if (vivo.current) setAviso(null) }, 9000)
    })
    const offCaida = alCaerse(() => {
      if (!vivo.current) return
      setError('Se cortó el enlace con la tablet (el teléfono cerró la red).')
      setFase('error')
    })
    return () => { offToque(); offCaida() }
  }, [fase, productos])

  const sumar = useCallback((p) => {
    onSumar?.(p)
    setAviso(null)
  }, [onSumar])

  if (!disponible()) {
    return (
      <Marco onCerrar={onCerrar} titulo="Vidriera">
        <div style={sx('font-size:13px;color:var(--muted);line-height:1.6;text-align:center')}>
          Esta función necesita la app instalada en el celular (no funciona desde el navegador).
        </div>
      </Marco>
    )
  }

  return (
    <Marco onCerrar={onCerrar} titulo="Vidriera" subtitulo={comercio?.name || null} mirados={mirados}>
      {fase === 'abriendo' && (
        <div style={sx('display:flex;flex-direction:column;align-items:center;gap:10px;padding:30px 0')}>
          <span style={sx('width:11px;height:11px;border-radius:99px;background:var(--primary);animation:lu-blink 1.2s infinite')} />
          <div style={sx('font-size:13px;color:var(--muted)')}>Abriendo la red para la tablet…</div>
        </div>
      )}

      {fase === 'error' && (
        <div style={sx('padding:14px;border-radius:14px;background:var(--danger-tint);font-size:13px;line-height:1.55')}>
          {error}
        </div>
      )}

      {fase === 'listo' && (
        <>
          <div style={sx('display:flex;flex-direction:column;align-items:center;gap:12px')}>
            <div style={{ ...sx('width:250px;height:250px;display:grid;place-items:center;border-radius:16px;background:#fff;border:1px solid var(--line)'), overflow: 'hidden' }}>
              {qr
                ? <img src={qr} alt="Código para la tablet" style={sx('width:100%;height:100%;object-fit:contain')} />
                : <div style={sx('font-size:12px;color:#666;text-align:center;padding:12px')}>La red está abierta, pero este APK no puede dibujar el código.</div>}
            </div>
            <div style={sx('font-size:12.5px;color:var(--muted);text-align:center;line-height:1.5;max-width:280px')}>
              Escanealo desde la tablet, en <b>Soy una tablet</b>. No usa datos: la red no tiene
              salida a internet.
            </div>
            {red && (
              <div style={sx('font-family:var(--font-mono);font-size:10.5px;color:var(--faint)')}>
                {red.ssid} · {red.ip}:{red.puerto}
              </div>
            )}
          </div>

          {/* CARTEL EMERGENTE — lo que el cliente está tocando en la tablet. */}
          {aviso && (
            <div className="lu-rise" style={sx('margin-top:16px;padding:12px;border-radius:16px;background:var(--surface);border:1.5px solid var(--primary);box-shadow:var(--shadow-lg)')}>
              <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--primary);margin-bottom:6px')}>
                El cliente está mirando{comercio?.name ? ` · ${comercio.name}` : ''}
              </div>
              <div style={sx('display:flex;align-items:center;gap:11px')}>
                {aviso.imagen
                  ? <img src={aviso.imagen} alt="" style={sx('width:52px;height:52px;flex:none;border-radius:12px;object-fit:cover;background:var(--surface2)')} />
                  : <div style={sx('width:52px;height:52px;flex:none;border-radius:12px;background:var(--surface2)')} />}
                <div style={sx('flex:1;min-width:0')}>
                  <div style={{ ...sx('font-size:13px;font-weight:500;line-height:1.3'), display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{aviso.name}</div>
                  <div style={sx('font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--deep);margin-top:2px')}>
                    {fmtPesos(aviso.oferta && aviso.precioOferta != null ? aviso.precioOferta : aviso.price)}
                  </div>
                </div>
              </div>
              <div style={sx('display:flex;gap:8px;margin-top:11px')}>
                <button className="lu-press" onClick={() => sumar(aviso)} style={{ ...btnPrimario, flex: 1, minHeight: 44 }}>Sumar al carrito</button>
                <button className="lu-press" onClick={() => setAviso(null)} style={{ ...btnSecundario, minHeight: 44, padding: '0 16px' }}>Después</button>
              </div>
            </div>
          )}
        </>
      )}
    </Marco>
  )
}

/**
 * El marco de la hoja. El resumen de "qué miró" va al pie y en chico: no es para leer durante la
 * visita, es para que el vendedor sepa al cerrar qué le interesó al cliente y no compró.
 */
function Marco({ titulo, subtitulo, mirados = [], onCerrar, children }) {
  return (
    <div style={sx('position:fixed;top:0;right:0;bottom:0;left:0;z-index:var(--z-screen);background:var(--bg-app);color:var(--text);display:flex;flex-direction:column')}>
      <div style={sx('flex:none;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:14px 16px;border-bottom:1px solid var(--line);background:var(--surface)')}>
        <div>
          <div style={sx('font-family:var(--font-display);font-weight:600;font-size:17px')}>{titulo}</div>
          {subtitulo && <div style={sx('font-size:11.5px;color:var(--faint)')}>{subtitulo}</div>}
        </div>
        <button onClick={onCerrar} className="lu-press"
          style={sx('min-height:40px;padding:0 14px;border-radius:var(--r-md);border:1px solid var(--line2);background:transparent;color:var(--muted);font-size:12.5px;font-weight:600;cursor:pointer')}>
          Cerrar
        </button>
      </div>
      <div style={sx('flex:1;overflow-y:auto;padding:18px 16px 24px')}>{children}</div>
      {mirados.length > 0 && (
        <div style={sx('flex:none;padding:10px 16px 14px;border-top:1px solid var(--line);background:var(--surface)')}>
          <div style={sx('font-size:10.5px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);margin-bottom:4px')}>
            Miró {mirados.length} {mirados.length === 1 ? 'producto' : 'productos'}
          </div>
          <div style={sx('font-size:11.5px;color:var(--muted);line-height:1.45;max-height:44px;overflow:hidden')}>
            {mirados.map((p) => p.name).join(' · ')}
          </div>
        </div>
      )}
    </div>
  )
}
