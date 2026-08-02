import { useEffect, useRef, useState } from 'react'
import { useLivePosition } from './useLivePosition'
import { flushPosiciones, setUsuarioCola } from '../services/sync/queue'
import { getTrackConfig, dentroDeHorario } from '../services/tracking'
import { setIdentidad, setConfig, reset as resetTracker } from '../services/geolocation/tracker'
import { iniciarUploaderNativo, detenerUploaderNativo } from '../services/uploaderNativo'
import { isNative } from '../services/platform'

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
  // TODAS las ventanas, no solo la primera: con una jornada partida (8-12 y 16-20) mirar únicamente
  // la primera haría que el rastreo de la tarde arrancara tarde, hasta que lo destapara el refresco
  // periódico. Cada borde de cada ventana es un momento en que `enHorario` puede cambiar.
  const ventanas = cfg.ventanas && cfg.ventanas.length ? cfg.ventanas : [cfg]
  const bordes = []
  ventanas.forEach((v) => { bordes.push(toSec(v.start || '00:00'), toSec(v.end || '23:59')) })
  const candidatos = bordes.map((s) => (s > cur ? s - cur : s - cur + 86400)).filter((d) => d > 0)
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
  //
  // setUsuarioCola: la cola de posiciones es del DISPOSITIVO, no del usuario. Avisarle
  // quién está logueado ahora es lo que le permite descartar los puntos de una cuenta
  // anterior, que RLS rechaza para siempre y taponaban la cola entera (ver queue.js).
  // Se setea acá y no en AuthContext a propósito: solo los roles que se trackean tienen
  // por qué purgar la cola. Un admin que abre sesión en el teléfono de un vendedor no
  // debe borrarle los puntos que todavía podrían subir cuando el vendedor vuelva.
  useEffect(() => {
    if (!enabled || !id || !idEmpresa) { resetTracker(); setUsuarioCola(null); return }
    setIdentidad({ id, rol, idEmpresa })
    setUsuarioCola(id)
    return () => { resetTracker(); setUsuarioCola(null) }
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
      const dentro = dentroDeHorario(cfg)
      setEnHorario(dentro)
      // REEMPUJAR la ventana al servicio nativo cuando cambia la config (cada 4 min / en el borde). Sin
      // esto, un cambio de horario desde EmpresasView no llegaba al teléfono con el nativo ya corriendo:
      // configurar() solo se llamaba una vez al arrancar. `iniciarUploaderNativo` es re-invocable y
      // reempuja la ventana (el nativo la relee de prefs) + relevanta el servicio si se auto-apagó. En
      // web/PWA es no-op. Fuera de horario no se toca acá: el efecto [enabled, enHorario] lo detiene.
      if (isNative() && dentro) iniciarUploaderNativo(cfg, { userId: id })
      clearTimeout(boundaryTimer)
      const ms = msHastaProximoLimite(cfg)
      if (ms != null) boundaryTimer = setTimeout(() => { if (alive) aplicar(cfgRef.current) }, ms)
    }

    // Pasar `id`: aplica el override por categoría del usuario si tiene una (Feature D);
    // si no, getTrackConfig cae al horario global. Sin id, usa el global.
    const load = () => getTrackConfig(id).then((c) => { if (alive) aplicar(c) }).catch(() => {})
    load()
    const iv = setInterval(load, 4 * 60000)
    return () => { alive = false; clearInterval(iv); clearTimeout(boundaryTimer) }
  }, [enabled, id])

  // Uploader GPS NATIVO (Opción B): corre EN PARALELO al pipeline JS de arriba. El servicio nativo
  // captura y postea sin pasar por el WebView, así la ubicación sigue subiendo con la pantalla
  // bloqueada (el JS se congela en Doze). Se arranca dentro de horario y se detiene fuera / al
  // deshabilitar. En web/PWA es no-op. Es la versión "al lado" de validación (ver uploaderNativo.js).
  useEffect(() => {
    // 🩸 `cfgRef.current` en el condicional, no solo como argumento (02/08/2026). En el primer render
    // todavía es null —el efecto que lo llena es async— y arrancar el uploader con null hacía que
    // `iniciarUploaderNativo` cayera a `getTrackConfig()` SIN userId, o sea al horario GLOBAL: la
    // categoría de rastreo de la persona quedaba CAPADA por el horario general hasta el siguiente
    // `aplicar()` (hasta 4 minutos), y el servicio nativo arrancaba tarde o se cortaba temprano.
    // No hace falta arrancarlo acá: `aplicar()` lo hace apenas llega la config, con la ventana buena.
    if (enabled && enHorario && cfgRef.current) iniciarUploaderNativo(cfgRef.current, { userId: id })
    else if (!enabled || !enHorario) detenerUploaderNativo()
    return () => { detenerUploaderNativo() }
  }, [enabled, enHorario, id])

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
