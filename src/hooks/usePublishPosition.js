import { useEffect, useRef, useState } from 'react'
import { useLivePosition } from './useLivePosition'
import { enqueuePosicion, flushPosiciones } from '../services/sync/queue'
import { getTrackConfig, dentroDeHorario } from '../services/tracking'
import { distanciaMetros } from '../services/geolocation/geofence'
import { MIN_MOVE_M, KEEPALIVE_MS, ACCURACY_MAX_M, MAX_SPEED_MPS } from '../services/gpsConfig'

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
  const lastRef = useRef(null) // { lat, lng, ts, sentAt }
  const cfgRef = useRef(null)  // ventana horaria de rastreo

  // Carga (y refresca) la ventana horaria de rastreo controlada por el superadmin.
  // Además de guardarla, apaga/prende el sensor GPS en sí (no solo la subida) según
  // la ventana, y se recalibra justo en el borde (no solo cada 4 min).
  useEffect(() => {
    if (!enabled) return
    let alive = true
    let boundaryTimer = null

    const aplicar = (cfg) => {
      cfgRef.current = cfg
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

  useEffect(() => {
    if (!pos || !id || !idEmpresa) return

    // 0) Fuera del horario de rastreo → no publicar (ahorra backend si alguien deja
    //    la app abierta). Defensa adicional: el watch ya se detiene arriba, esto
    //    cubre el instante justo del borde mientras el watch termina de pararse.
    if (cfgRef.current && !dentroDeHorario(cfgRef.current)) return

    // 1) Precisión: los fixes imprecisos (interiores, mala señal) se ignoran. Es la
    //    causa principal de que el rastro "salte" lejos de la calle real.
    if (typeof pos.accuracy === 'number' && pos.accuracy > ACCURACY_MAX_M) return

    const prev = lastRef.current

    // 2) Salto imposible: si respecto al último punto bueno la velocidad implícita
    //    supera un máximo razonable, es un glitch de GPS → se descarta.
    if (prev) {
      const dt = Math.max(1, (pos.ts - prev.ts) / 1000)
      const dist = distanciaMetros(prev, pos)
      if (dist > MIN_MOVE_M && dist / dt > MAX_SPEED_MPS) return
    }

    const movio = !prev || distanciaMetros(prev, pos) >= MIN_MOVE_M
    const keepAlive = prev && Date.now() - prev.sentAt >= KEEPALIVE_MS
    if (!movio && !keepAlive) return

    lastRef.current = { lat: pos.lat, lng: pos.lng, ts: pos.ts, sentAt: Date.now() }
    // Guardar SIEMPRE en la cola local (no se pierde aunque no haya red) y luego
    // intentar subir. Cada punto conserva su hora real (pos.ts).
    const row = { id_usuario: id, rol, lat: pos.lat, lng: pos.lng, id_empresa: idEmpresa, ts: new Date(pos.ts || Date.now()).toISOString() }
    if (typeof pos.accuracy === 'number') row.accuracy = pos.accuracy
    enqueuePosicion(row)
    flushPosiciones()
  }, [pos, id, rol, idEmpresa])

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
