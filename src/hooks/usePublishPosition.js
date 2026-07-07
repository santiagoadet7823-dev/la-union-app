import { useEffect, useRef } from 'react'
import { useLivePosition } from './useLivePosition'
import { publicarPosicion } from '../services/sync/realtime'
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

export function usePublishPosition({ enabled, id, rol, idEmpresa }) {
  const { pos, error, request } = useLivePosition(enabled)
  const lastRef = useRef(null) // { lat, lng, sentAt }

  useEffect(() => {
    if (!pos || !id || !idEmpresa) return
    const prev = lastRef.current
    const movio = !prev || distanciaMetros(prev, pos) >= MIN_MOVE_M
    const keepAlive = prev && Date.now() - prev.sentAt >= KEEPALIVE_MS
    if (!movio && !keepAlive) return
    lastRef.current = { lat: pos.lat, lng: pos.lng, sentAt: Date.now() }
    publicarPosicion({ id, rol, lat: pos.lat, lng: pos.lng, idEmpresa })
  }, [pos, id, rol, idEmpresa])

  return { pos, error, request }
}
