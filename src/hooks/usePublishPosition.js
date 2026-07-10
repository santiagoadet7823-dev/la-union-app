import { useEffect, useRef } from 'react'
import { useLivePosition } from './useLivePosition'
import { enqueuePosicion, flushPosiciones } from '../services/sync/queue'
import { getTrackConfig, dentroDeHorario } from '../services/tracking'
import { distanciaMetros } from '../services/geolocation/geofence'

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
const MIN_MOVE_M = 12       // metros de desplazamiento mínimos para registrar un punto
const KEEPALIVE_MS = 90000  // reenvío de cortesía aunque no se mueva (marcador "vivo")
const ACCURACY_MAX_M = 50   // fixes menos precisos que esto se descartan (causa #1 de "saltos")
const MAX_SPEED_MPS = 45    // ~160 km/h: un desplazamiento más rápido es un salto imposible → glitch

export function usePublishPosition({ enabled, id, rol, idEmpresa }) {
  const { pos, error, request } = useLivePosition(enabled)
  const lastRef = useRef(null) // { lat, lng, ts, sentAt }
  const cfgRef = useRef(null)  // ventana horaria de rastreo

  // Carga (y refresca) la ventana horaria de rastreo controlada por el superadmin.
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () => getTrackConfig().then((c) => { if (alive) cfgRef.current = c }).catch(() => {})
    load()
    const iv = setInterval(load, 4 * 60000)
    return () => { alive = false; clearInterval(iv) }
  }, [enabled])

  useEffect(() => {
    if (!pos || !id || !idEmpresa) return

    // 0) Fuera del horario de rastreo → no publicar (ahorra backend si alguien deja
    //    la app abierta). El GPS local sigue para la app; solo no se sube.
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

  return { pos, error, request }
}
