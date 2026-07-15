import { useEffect, useRef, useState } from 'react'
import { useLivePosition } from './useLivePosition'
import { flushPosiciones } from '../services/sync/queue'
import { getTrackConfig, dentroDeHorario } from '../services/tracking'
import { setIdentidad, setConfig, reset as resetTracker } from '../services/geolocation/tracker'

/**
 * GPS en vivo + publicación en tiempo real. Lo usan Vendedor y Repartidor: cada
 * fix se emite/persiste POR MOVIMIENTO (no por tiempo): solo se envía cuando el
 * usuario se desplazó al menos MIN_MOVE_M metros desde el último punto enviado.
 * Así el rastro de la jornada queda limpio y sin puntos redundantes al estar quieto.
 *
 * Se agrega un keep-alive suave (KEEPALIVE_MS) para que el marcador en vivo del
 * Admin no parezca "caído" cuando el móvil está detenido en un cliente.
 *
 * `request()` pide el permiso con gesto del usuario (necesario en móvil).
 *
 * @param {{enabled:boolean, id:string, rol:'vendedor'|'repartidor', idEmpresa:string}} opts
 */

// Calcula cuántos ms faltan hasta el próximo límite (inicio o fin) de la ventana
// horaria, para recalcular `enHorario` justo en el borde y no hasta 4 min tarde.
// Tope de 4 min: igual se recalibra con el refresco periódico de la config.
function msHastaProximoLimite(cfg) {
  if (!cfg || cfg.enabled === false) return null
  const now = new Date()
  const cur = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
  const toSec = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 3600 + m * 60 }
  const start = toSec(cfg.start || '00:00')
  const end = toSec(cfg.end || '23:59')
  const candidatos = [start, end].map((s) => (s > cur ? s - cur : s - cur + 86400)).filter((d) => d > 0)
  if (!candidatos.length) return null
  return Math.min(Math.min(...candidatos) * 1000, 4 * 60000)
}

export function usePublishPosition({ enabled, id, rol, idEmpresa }) {
  const [enHorario, setEnHorario] = useState(true) // optimista: no bloquear el 1er watch mientras carga la config
  const { pos, error, request } = useLivePosition(enabled && enHorario)
  const cfgRef = useRef(null)  // ventana horaria de rastreo (para enHorario)

  // Identidad del tracker: sin esto, procesarFix (en el callback nativo) no encola.
  // reset() al deshabilitar/desmontar limpia `last` para no arrastrar posición entre
  // sesiones o roles.
  useEffect(() => {
    if (!enabled || !id || !idEmpresa) { resetTracker(); return }
    setIdentidad({ id, rol, idEmpresa })
    return () => resetTracker()
  }, [enabled, id, rol, idEmpresa])

  // Carga (y refresca) la ventana horaria de rastreo controlada por el superadmin.
  // Además de guardarla, apaga/prende el sensor GPS en sí (no solo la subida) según
  // la ventana, y se recalibra justo en el borde (no solo cada 4 min).
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let boundaryTimer = null

    const aplicar = (cfg) => {
      cfgRef.current = cfg
      setConfig(cfg) // el tracker lee la ventana horaria SÍNCRONO en procesarFix
      setEnHorario(dentroDeHorario(cfg))
      clearTimeout(boundaryTimer)
      const ms = msHastaProximoLimite(cfg)
      if (ms != null) boundaryTimer = setTimeout(() => { if (alive) aplicar(cfgRef.current) }, ms)
    }

    const load = () => getTrackConfig().then((c) => { if (alive) aplicar(c) }).catch(() => {})
    load()
    const iv = setInterval(load, 4 * 60000)
    return () => { alive = false; clearInterval(iv); clearTimeout(boundaryTimer) }
  }, [enabled])

  // El filtrado + encolado + subida de cada fix vive ahora en services/geolocation/
  // tracker.js (procesarFix), invocado SÍNCRONO desde el callback nativo del watch en
  // useLivePosition. Así la persistencia no depende del ciclo de render de React y
  // sigue guardando puntos con la pantalla bloqueada (el WebView congelado no dispara
  // effects). Este hook solo cablea identidad/config al tracker y reintenta el flush.

  // Reintentar la subida al recuperar conexión y cada tanto (por si el flush por
  // movimiento no alcanzó a vaciar la cola).
  useEffect(() => {
    if (!enabled) return
    flushPosiciones()
    const onOnline = () => flushPosiciones()
    window.addEventListener('online', onOnline)
    const iv = setInterval(() => flushPosiciones(), 30000)
    return () => { window.removeEventListener('online', onOnline); clearInterval(iv) }
  }, [enabled])

  return { pos, error, request, enHorario }
}
