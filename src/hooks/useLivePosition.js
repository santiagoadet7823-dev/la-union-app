import { useCallback, useEffect, useRef, useState } from 'react'
import { watchPosition, pedirUbicacionUnaVez } from '../services/geolocation'
import { procesarFix } from '../services/geolocation/tracker'
import { iniciarMaquina } from '../services/geolocation/estados'

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
    let pararMaquina = null
    setError(null)
    watchPosition(
      // procesarFix persiste SIEMPRE (corre dentro del callback nativo, sobrevive al
      // congelamiento del WebView); setPos es solo para el marcador en vivo (React).
      (p) => { procesarFix(p); if (active) setPos(p) },
      (e) => { if (active) setError(e) }
    ).then((stop) => {
      stopRef.current = stop
      if (!active) stop()
    })

    // Ajusta el intervalo del GPS según el vendedor esté quieto o andando (ver estados.js).
    // Es ADITIVO: sin Activity Recognition (web, APK viejo, permiso denegado) iniciarMaquina
    // devuelve un no-op y el watch se comporta exactamente igual que antes.
    // getWatcherId se lee en el momento de cada cambio, no acá: el watch arranca async y
    // el id recién existe cuando resuelve la promesa de arriba.
    iniciarMaquina({ getWatcherId: () => (stopRef.current ? stopRef.current.watcherId : null) })
      .then((parar) => {
        pararMaquina = parar
        if (!active) parar() // el effect ya se limpió mientras esto resolvía
      })
      .catch(() => {}) // nunca debe tumbar el watch

    return () => {
      active = false
      if (pararMaquina) { pararMaquina(); pararMaquina = null }
      if (stopRef.current) { stopRef.current(); stopRef.current = null }
    }
  }, [enabled, nonce])

  // Latido (modo "por tiempo"): cada 60 s refrescamos la posición aunque el watch por
  // movimiento no haya emitido. Sirve para (a) rellenar el recorrido cuando el
  // movimiento es lento y (b) que el fix no quede "viejo" (el GpsGate no da falso
  // "GPS apagado"). Combina con el "por distancia" del watch → recorrido más suave.
  //
  // 60 s < KEEPALIVE_MS (90 s) → el marcador "vivo" nunca se cae. Antes era cada 15 s
  // CON maximumAge:0, que prohíbe la caché y fuerza una adquisición GPS nueva encima
  // del watch nativo que ya corre a 1 Hz: 240 adquisiciones extra de alta precisión
  // por hora. Con maximumAge:30000 el SO devuelve el fix reciente que el watch YA
  // adquirió, sin volver a encender el GPS. El botón "Activar GPS" (request) sigue
  // con maximumAge:0 porque ahí sí queremos un fix nuevo.
  //
  // Solo en FOREGROUND: usa navigator.geolocation (inútil en 2º plano) y el
  // setInterval se estrangula con la pantalla bloqueada. En background la captura la
  // sostiene el watch nativo de background-geolocation. Pasa por procesarFix para que
  // el keepalive del marcador (estando quieto) también se persista.
  useEffect(() => {
    if (!enabled) return
    const iv = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      pedirUbicacionUnaVez({ maximumAge: 30000 }).then((p) => { procesarFix(p); setPos(p) }).catch(() => {})
    }, 60000)
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
