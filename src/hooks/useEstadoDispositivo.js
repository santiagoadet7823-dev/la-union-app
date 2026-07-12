import { useCallback, useEffect, useRef } from 'react'
import { supabase, hasSupabase } from '../services/supabase'
import { APP_VERSION } from '../version'
import { ACCURACY_MAX_M } from '../services/gpsConfig'

/**
 * Latido de "salud" del dispositivo móvil. Cada tanto (y en transiciones) sube una
 * fila a `estado_dispositivo` con: si el GPS está OK, desde cuándo, el permiso
 * (best-effort), si la app está en primer plano, y si alguna vez latió en segundo
 * plano (confirma permiso "siempre"). Alimenta el informe "por qué no llega la señal".
 *
 * Es solo del propio usuario (RLS: id_usuario = auth.uid()). Falla suave: si no hay
 * red, el latido se pierde y el server lo interpreta como "sin señal" (que es la verdad).
 *
 * @param {{enabled:boolean, id:string, idEmpresa:string, rol:string, pos:any, error:any}} opts
 */
const STALE_MS = 120000   // sin fix nuevo por 2 min → GPS "no OK"
const LATIDO_MS = 120000  // sube estado cada 2 min

// gps_ok debe reflejar si ALGO se está publicando realmente, no solo si hay un fix
// fresco: usePublishPosition descarta los fixes con accuracy > ACCURACY_MAX_M antes
// de subirlos, así que un fix impreciso-pero-fresco no cuenta como "OK" acá tampoco.
function computeGpsOk(pos, error) {
  return !!pos && !error && Date.now() - (pos?.ts || 0) < STALE_MS
    && (typeof pos.accuracy !== 'number' || pos.accuracy <= ACCURACY_MAX_M)
}

export function useEstadoDispositivo({ enabled, id, idEmpresa, rol, pos, error }) {
  const gpsDesdeRef = useRef({ ok: null, since: Date.now() })
  const bgRef = useRef({ dia: null, ok: false }) // ¿latió en 2º plano hoy?

  // Última salud calculada (para poder subirla desde el intervalo y los listeners).
  const snapRef = useRef(() => ({}))
  snapRef.current = () => {
    const gpsOk = computeGpsOk(pos, error)
    // Transición de estado GPS → registrar "desde cuándo".
    if (gpsDesdeRef.current.ok !== gpsOk) gpsDesdeRef.current = { ok: gpsOk, since: Date.now() }
    const hoy = new Date().toISOString().slice(0, 10)
    if (bgRef.current.dia !== hoy) bgRef.current = { dia: hoy, ok: false }
    const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
    if (!visible && gpsOk) bgRef.current.ok = true // recibió fix estando en 2º plano → permiso "siempre"
    return {
      gps_ok: gpsOk,
      gps_desde: new Date(gpsDesdeRef.current.since).toISOString(),
      permiso: error ? 'denegado' : (bgRef.current.ok ? 'siempre' : 'ok'),
      visible,
      bg_ok: bgRef.current.ok,
    }
  }

  // Único punto de subida: colapsa llamadas concurrentes (intervalo + transición
  // disparando casi juntos al montar) en un solo upsert en vez de dos carreras
  // independientes contra la misma fila.
  const enviandoRef = useRef(false)
  const pendingRef = useRef(false)
  const enviar = useCallback(async () => {
    if (!enabled || !hasSupabase || !id || !idEmpresa) return
    if (enviandoRef.current) { pendingRef.current = true; return }
    enviandoRef.current = true
    do {
      pendingRef.current = false
      const s = snapRef.current()
      try {
        await supabase.from('estado_dispositivo').upsert({
          id_usuario: id, id_empresa: idEmpresa, rol, app_version: APP_VERSION,
          ts: new Date().toISOString(), updated_at: new Date().toISOString(), ...s,
        }, { onConflict: 'id_usuario' })
      } catch (_) { /* sin red → se pierde el latido, es esperable */ }
    } while (pendingRef.current)
    enviandoRef.current = false
  }, [enabled, id, idEmpresa, rol])

  useEffect(() => {
    if (!enabled || !hasSupabase || !id || !idEmpresa) return
    enviar() // al arrancar
    const iv = setInterval(enviar, LATIDO_MS)
    const onVis = () => enviar()
    const onOnline = () => enviar() // reintentar el latido al recuperar la red
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('online', onOnline)
    }
  }, [enabled, id, idEmpresa, rol, enviar])

  // Cuando cambia el estado GPS (aparece/desaparece el fix o hay error), latir enseguida.
  const gpsOkNow = computeGpsOk(pos, error)
  useEffect(() => {
    enviar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsOkNow, !!error])
}
