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
const ACCURACY_MAX_M = 50   // fixes menos precisos que esto se descartan (causa #1 de "saltos")
const MAX_SPEED_MPS = 45    // ~160 km/h: un desplazamiento más rápido es un salto imposible → glitch

export function usePublishPosition({ enabled, id, rol, idEmpresa }) {
  const { pos, error, request } = useLivePosition(enabled)
  const lastRef = useRef(null) // { lat, lng, ts, sentAt }

  useEffect(() => {
    if (!pos || !id || !idEmpresa) return

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
    publicarPosicion({ id, rol, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, idEmpresa })
  }, [pos, id, rol, idEmpresa])

  return { pos, error, request }
}
