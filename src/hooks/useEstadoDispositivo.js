import { useCallback, useEffect, useRef } from 'react'
import { supabase, hasSupabase } from '../services/supabase'
import { APP_VERSION } from '../version'
import { hoyStr } from '../lib/format'
import { ACCURACY_MAX_M } from '../services/gpsConfig'
import { pendingCount } from '../services/sync/queue'
import { getHeartbeat } from '../services/geolocation/tracker'

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
const LATIDO_MS = 120000  // se evalúa el estado cada 2 min (solo sube si cambió)
const FORZAR_MS = 600000  // ...pero al menos cada 10 min sí o sí (ver abajo)

// Campos de ESTADO que deciden si vale la pena subir el latido. `ts`/`updated_at`
// quedan afuera a propósito: cambian siempre y anularían la comparación.
const CAMPOS = ['gps_ok', 'permiso', 'visible', 'bg_ok', 'app_version', 'cola_pendiente']
function mismoEstado(a, b) {
  return !!a && !!b && CAMPOS.every((k) => a[k] === b[k])
}

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
  const hbRef = useRef(null) // heartbeat del tracker (captura real, incl. background)

  // Última salud calculada (para poder subirla desde el intervalo y los listeners).
  const snapRef = useRef(() => ({}))
  snapRef.current = () => {
    // El heartbeat del tracker prueba captura reciente aunque el `pos` de React esté
    // viejo por congelamiento del WebView con la pantalla bloqueada.
    const hb = hbRef.current
    const hbFresco = !!hb && Date.now() - (hb.ultimaCapturaTs || 0) < STALE_MS
    const gpsOk = computeGpsOk(pos, error) || hbFresco
    // Transición de estado GPS → registrar "desde cuándo".
    if (gpsDesdeRef.current.ok !== gpsOk) gpsDesdeRef.current = { ok: gpsOk, since: Date.now() }
    const hoy = hoyStr()
    if (bgRef.current.dia !== hoy) bgRef.current = { dia: hoy, ok: false }
    const visible = typeof document !== 'undefined' && document.visibilityState === 'visible'
    if (!visible && gpsOk) bgRef.current.ok = true // recibió fix estando en 2º plano → permiso "siempre"
    if (hbFresco && hb.ultimaBg) bgRef.current.ok = true // capturó en background (callback nativo)
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
  const ultimoPayloadRef = useRef(null) // último estado efectivamente subido
  const ultimoEnvioRef = useRef(0)
  const enviar = useCallback(async () => {
    if (!enabled || !hasSupabase || !id || !idEmpresa) return
    if (enviandoRef.current) { pendingRef.current = true; return }
    enviandoRef.current = true
    do {
      pendingRef.current = false
      // Captura real (incl. background). Solo se honra si es del usuario actual
      // (clave device-global → evitar heredar el heartbeat de otra sesión).
      const hb = await getHeartbeat().catch(() => null)
      hbRef.current = hb && hb.id === id ? hb : null
      const s = snapRef.current()
      const cola = await pendingCount().catch(() => null) // diagnóstico: puntos en cola sin subir
      // Subir solo si algún campo de estado cambió: antes el upsert corría cada 120 s
      // aunque no hubiera novedad (30 requests/hora de puro ruido). Igual se fuerza un
      // envío cada FORZAR_MS para refrescar el `ts`: Supervisión (EstadoEquipo)
      // clasifica por antigüedad del timestamp y sin latido el equipo parece caído.
      const estado = { app_version: APP_VERSION, cola_pendiente: cola, ...s }
      const vencido = Date.now() - ultimoEnvioRef.current >= FORZAR_MS
      if (mismoEstado(ultimoPayloadRef.current, estado) && !vencido) continue
      try {
        await supabase.from('estado_dispositivo').upsert({
          id_usuario: id, id_empresa: idEmpresa, rol,
          ts: new Date().toISOString(), updated_at: new Date().toISOString(), ...estado,
        }, { onConflict: 'id_usuario' })
        // Solo se marca como enviado si el upsert no tiró: si falló (sin red), el
        // próximo latido tiene que reintentar en vez de creer que ya está arriba.
        ultimoPayloadRef.current = estado
        ultimoEnvioRef.current = Date.now()
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
