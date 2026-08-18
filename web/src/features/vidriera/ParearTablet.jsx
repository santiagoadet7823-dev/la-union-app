import { useCallback, useEffect, useRef, useState } from 'react'
import { sx } from '../../lib/sx'
import { btnPrimario, btnSecundario } from '../../lib/botones'
import { disponible, escanear, conectar, pedirCatalogo, desconectar } from '../../services/vidrieraTablet'
import { disponible as btDisponible, buscar as buscarBt } from '../../services/vidrieraBluetooth'

/**
 * EMPAREJAMIENTO DE LA TABLET. Escanea el QR del celular del vendedor, se une a su red y trae el
 * catálogo. Vive ANTES del `Gate` de `App.jsx`: **la tablet no se loguea nunca** — no toca Supabase,
 * no tiene sesión, no tiene GPS y no cuenta como dispositivo del parque. Todo lo que muestra se lo
 * dio el celular por el enlace local.
 *
 * Eso no es una limitación, es la propiedad que hace que la función exista: sin sesión no hay
 * superficie de RLS, no hay nada que revocar si la tablet se pierde, y —lo que pidió el cliente— la
 * tablet **no puede consumir datos**, porque la red a la que se une no tiene salida a internet.
 *
 * 🩸 Y por eso da igual que en la tablet no se pueda crear una cuenta de Google (18/08/2026): no
 * hace falta ninguna.
 *
 * Los cuatro estados son visibles a propósito. Cuando esto falle va a ser delante de un cliente, y
 * "no funciona" es lo que obliga a repetir la prueba con un cable puesto: cada paso dice en qué
 * quedó (leí el código / me uní a la red / pedí el catálogo) para que el vendedor pueda contarlo por
 * teléfono.
 */

const PASOS = {
  inicio: 'Tocá para escanear el código del vendedor.',
  escaneando: 'Apuntá a la pantalla del celular…',
  buscandoBt: 'Buscando el celular del vendedor por Bluetooth…',
  uniendo: 'Uniéndome a la red del vendedor…',
  pidiendo: 'Trayendo el catálogo…',
}

export default function ParearTablet({ onListo, onSalir }) {
  const [paso, setPaso] = useState('inicio')
  const [error, setError] = useState(null)
  const [via, setVia] = useState(null)
  const vivo = useRef(true)
  useEffect(() => () => { vivo.current = false }, [])

  /**
   * 🩸 DOS CAMINOS PARA LO MISMO (18/08/2026). `porBluetooth` cambia SOLO cómo llega el sobre de la
   * red; todo lo que sigue —unirse, pedir el catálogo, el manejo de error— es idéntico, y por eso
   * está en una sola función. El QR sigue siendo el camino por defecto: Bluetooth entró porque la
   * cámara de esta tablet no enfoca bien, no porque el QR estuviera mal.
   */
  const emparejar = useCallback(async (porBluetooth = false) => {
    setError(null)
    try {
      setPaso(porBluetooth ? 'buscandoBt' : 'escaneando')
      const sesion = porBluetooth ? await buscarBt() : await escanear()
      if (!vivo.current) return

      setPaso('uniendo')
      const r = await conectar(sesion)
      if (!vivo.current) return
      setVia(r?.via || null)

      setPaso('pidiendo')
      const catalogo = await pedirCatalogo(sesion)
      if (!vivo.current) return

      onListo?.({ sesion, catalogo })
    } catch (e) {
      if (!vivo.current) return
      // Si algo falló después de unirse, hay que SOLTAR la red: si no, la tablet queda atada a un
      // hotspot sin internet y sin servidor, o sea sin nada.
      desconectar()
      setPaso('inicio')
      setError(e?.message || 'No se pudo emparejar.')
    }
  }, [onListo])

  const trabajando = paso !== 'inicio'

  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;padding:32px;background:var(--bg);color:var(--text);text-align:center')}>
      <div style={sx('width:72px;height:72px;border-radius:22px;background:var(--primary-tint);display:grid;place-items:center')}>
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5A2.5 2.5 0 0 1 18.5 21H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
          <path d="M7 12h10" />
        </svg>
      </div>

      <div>
        <div style={sx('font-family:var(--font-display);font-weight:600;font-size:22px')}>Vidriera</div>
        <div style={sx('font-size:14px;color:var(--muted);margin-top:6px;max-width:420px;line-height:1.5')}>
          {PASOS[paso]}
        </div>
      </div>

      {trabajando && (
        <div style={sx('display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--faint)')}>
          <span style={sx('width:9px;height:9px;border-radius:99px;background:var(--primary);animation:lu-blink 1.2s infinite')} />
          {paso === 'uniendo' && via ? `Conectando (${via})` : 'Un momento'}
        </div>
      )}

      {error && (
        <div style={sx('max-width:420px;padding:12px 14px;border-radius:14px;background:var(--danger-tint);color:var(--text);font-size:13px;line-height:1.5')}>
          {error}
        </div>
      )}

      {!disponible() && (
        <div style={sx('max-width:420px;padding:12px 14px;border-radius:14px;background:var(--warning-tint);color:var(--muted);font-size:12.5px;line-height:1.5')}>
          Esta pantalla necesita la app instalada en la tablet (no funciona desde el navegador).
        </div>
      )}

      <div style={sx('display:flex;gap:10px;margin-top:4px')}>
        <button
          className="lu-press"
          onClick={() => emparejar(false)}
          disabled={trabajando || !disponible()}
          style={{ ...btnPrimario, minWidth: 200, opacity: (trabajando || !disponible()) ? 0.55 : 1 }}
        >
          {error ? 'Reintentar' : 'Escanear código'}
        </button>
        {/* El camino SIN cámara. Va como acción secundaria y no como principal: necesita que
            alguien haya vinculado los dos aparatos una vez en el depósito, y si eso no pasó, el
            mensaje de error lo dice y manda al QR. */}
        {btDisponible() && (
          <button className="lu-press" onClick={() => emparejar(true)} disabled={trabajando}
            style={{ ...btnSecundario, minWidth: 190, opacity: trabajando ? 0.55 : 1 }}>
            Buscar por Bluetooth
          </button>
        )}
        {onSalir && (
          <button className="lu-press" onClick={onSalir} disabled={trabajando} style={{ ...btnSecundario, minWidth: 120 }}>
            Volver
          </button>
        )}
      </div>
    </div>
  )
}
