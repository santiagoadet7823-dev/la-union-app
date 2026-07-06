import { useEffect, useRef, useState } from 'react'
import { watchPosition } from '../services/geolocation'

/**
 * GPS en vivo real. Cuando `enabled` es true, suscribe al watch de posición del
 * dispositivo (navigator.geolocation en PWA; background-geolocation en nativo) y
 * devuelve la última posición conocida, actualizándose sola.
 *
 * @param {boolean} enabled
 * @returns {{ pos: {lat,lng,ts}|null, error: any|null }}
 */
export function useLivePosition(enabled) {
  const [pos, setPos] = useState(null)
  const [error, setError] = useState(null)
  const stopRef = useRef(null)

  useEffect(() => {
    if (!enabled) {
      setPos(null)
      return
    }
    let active = true
    setError(null)
    watchPosition(
      (p) => { if (active) setPos(p) },
      (e) => { if (active) setError(e) }
    ).then((stop) => {
      stopRef.current = stop
      if (!active) stop() // se deshabilitó antes de resolver
    })
    return () => {
      active = false
      if (stopRef.current) { stopRef.current(); stopRef.current = null }
    }
  }, [enabled])

  return { pos, error }
}
