import { useCallback, useEffect, useRef, useState } from 'react'
import { watchPosition, pedirUbicacionUnaVez } from '../services/geolocation'

/**
 * GPS en vivo real. Cuando `enabled` es true, suscribe al watch de posición del
 * dispositivo y devuelve la última posición conocida, actualizándose sola.
 *
 * En móvil el permiso NO se pide solo: hay que llamar `request()` desde un tap
 * del usuario. Tras conceder, el watch entrega posiciones sin volver a preguntar.
 *
 * @param {boolean} enabled
 * @returns {{ pos: {lat,lng,ts}|null, error: any|null, request: () => Promise }}
 */
export function useLivePosition(enabled) {
  const [pos, setPos] = useState(null)
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0) // fuerza reinicio del watch tras conceder permiso
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
      if (!active) stop()
    })
    return () => {
      active = false
      if (stopRef.current) { stopRef.current(); stopRef.current = null }
    }
  }, [enabled, nonce])

  // Latido (modo "por tiempo"): cada 15 s pedimos la posición aunque el watch por
  // movimiento no haya emitido. Sirve para (a) rellenar el recorrido cuando el
  // movimiento es lento y (b) que el fix no quede "viejo" (el GpsGate no da falso
  // "GPS apagado"). Combina con el "por distancia" del watch → recorrido más suave.
  useEffect(() => {
    if (!enabled) return
    const iv = setInterval(() => {
      pedirUbicacionUnaVez().then((p) => setPos(p)).catch(() => {})
    }, 15000)
    return () => clearInterval(iv)
  }, [enabled])

  const request = useCallback(() => {
    return pedirUbicacionUnaVez()
      .then((p) => {
        setPos(p)
        setError(null)
        setNonce((n) => n + 1) // reinicia el watch ahora que hay permiso
        return p
      })
      .catch((e) => {
        setError(e)
        throw e
      })
  }, [])

  return { pos, error, request }
}
