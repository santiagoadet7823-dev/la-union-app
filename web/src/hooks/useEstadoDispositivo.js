import { useCallback, useEffect, useRef } from 'react'
import { App as CapApp } from '@capacitor/app'
import { supabase, hasSupabase } from '../services/supabase'
import { primerInstallMs, modeloDispositivo } from '../services/infoApp'
import { APP_VERSION } from '../version'
import { hoyStr } from '../lib/format'
import { ACCURACY_MAX_M } from '../services/gpsConfig'
import { pendingCount, pendientesCuarentena } from '../services/sync/queue'
import { getHeartbeat } from '../services/geolocation/tracker'
import { getFcmTokenSync, permisoNotificaciones } from '../services/push'
import { estadoUploaderNativo } from '../services/uploaderNativo'
import { estaExento } from '../services/battery'
import { isNative } from '../services/platform'

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
const CAMPOS = ['gps_ok', 'permiso', 'visible', 'bg_ok', 'app_version', 'apk_version', 'instalado_ts',
  'cola_pendiente', 'cuarentena_pendiente', 'gps_error', 'fcm_token',
  // Diagnóstico de red del servicio nativo. `red_desde`/`arranque_ts`/`apagado_ts` NO entran en la
  // comparación aunque se suban: son marcas de tiempo que acompañan a `red`, y meterlas acá haría
  // que un cambio de milisegundos disparara un upsert cada 2 minutos.
  'red',
  // Telemetría de captura: solo entran los que responden una pregunta de ESTADO. Los contadores
  // (`fix_total`, `fix_guardados`, `gps_repedidos`, `gps_silencio_max_ms`, …) suben con el latido
  // pero NO comparan: crecen en cada fix y dispararían un upsert cada 2 minutos, que es justo lo
  // que esta lista existe para evitar. `gps_intervalo_ms` SÍ entra: es la cadencia PEDIDA, un
  // estado que cambia pocas veces por jornada y cuyo cambio es exactamente lo que hay que ver.
  'fix_dueno', 'cuarentena_nativa', 'gps_intervalo_ms', 'notif_permiso',
  // 🩸 `bateria_exenta` (05/08/2026). Es la palanca de la que cuelga que el rastreo arranque al
  // horario: un teléfono exento de la optimización de batería queda fuera de la restricción de
  // Android 12+ que bloquea arrancar un foreground service desde background — el motivo por el que
  // el GPS a veces no arrancaba en todo el día hasta que alguien abría la app. Sin esta columna no
  // se puede saber cuántos de los teléfonos del parque están exentos, y todo el diagnóstico del
  // arranque tardío se hace a ciegas. Entra en la comparación porque es ESTADO y cambia pocas veces.
  'bateria_exenta',
  // Diagnóstico del arranque (1.11.0). Solo los dos que son ESTADO: `alarma_exacta` (¿el teléfono
  // consiguió la alarma exacta?) y `fgs_bloqueado` (¿el SO está rechazando el arranque?). Los tres
  // `_ts` se suben pero NO comparan — son marcas de tiempo que avanzan solas y dispararían un
  // upsert cada 2 minutos, que es justo lo que esta lista existe para evitar (mismo criterio que
  // `red_desde`). Y `alarma_proxima_ts` cambia en cada reprogramación, o sea siempre.
  'alarma_exacta', 'fgs_bloqueado',
  // Modelo del teléfono (db/39). Entra en la comparación porque es ESTADO puro: no cambia nunca en
  // un mismo aparato, así que no dispara upserts, pero hace que el primer latido que lo conozca sí
  // suba en vez de esperar los 10 min de FORZAR_MS.
  'modelo']

/**
 * Motivo legible del fallo de GPS. `permiso: 'denegado'` solo decía QUE fallaba, no
 * POR QUÉ, y eso dejó sin cerrar el caso del 18/07/2026 (un recorrido entero sin
 * capturar). El objeto de error de geolocalización trae `code` 1/2/3.
 */
function describirError(error) {
  if (!error) return null
  const code = error.code
  if (code === 1) return 'permiso denegado'
  if (code === 2) return 'posicion no disponible (GPS apagado o sin senal)'
  if (code === 3) return 'timeout esperando el fix'
  const msg = error.message || String(error)
  return msg.slice(0, 200)
}
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

/**
 * Último día en que el teléfono capturó una posición ESTANDO EN SEGUNDO PLANO.
 *
 * 🩸 Existe por el caso de Zura (18/08/2026). `bgRef` se reinicia todos los días y vive en RAM, así
 * que nadie fuera de este hook podía saber si el rastreo de fondo alguna vez funcionó — y el aviso
 * que pide "Permitir siempre" (`PermisoSiemprePrompt`) estaba decidiendo si reaparecer mirando
 * SOLO la exención de batería. Resultado: quien concedía la batería pero no el permiso de fondo no
 * volvía a ver el cartel NUNCA, y su teléfono quedaba marcando solo con la app abierta. Medido:
 * 2.250 m de recorrido sin un punto, con el latido del JS fresco y el servicio nativo sin entregar
 * un fix en 14 h.
 *
 * Va en `localStorage` a secas, como `lu-permiso-siempre-visto`: es un dato de presentación, hay
 * que leerlo SÍNCRONO en el primer render del aviso, y perderlo solo cuesta un cartel de más.
 */
const BG_DIA_KEY = 'lu-bg-ultimo-dia'

function marcarBgHoy(dia) {
  try { if (localStorage.getItem(BG_DIA_KEY) !== dia) localStorage.setItem(BG_DIA_KEY, dia) } catch (_) { /* modo privado */ }
}

/** 'YYYY-MM-DD' del último día con captura en segundo plano, o null si no pasó nunca. */
export function diaUltimoBg() {
  try { return localStorage.getItem(BG_DIA_KEY) || null } catch (_) { return null }
}

export function useEstadoDispositivo({ enabled, id, idEmpresa, rol, pos, error }) {
  const gpsDesdeRef = useRef({ ok: null, since: Date.now() })
  const bgRef = useRef({ dia: null, ok: false }) // ¿latió en 2º plano hoy?
  const hbRef = useRef(null) // heartbeat del tracker (captura real, incl. background)
  // Versión NATIVA del APK (versionName). Distinta de APP_VERSION, que es la del bundle OTA (JS):
  // la OTA puede ir más adelante que el APK. Sirve para cazar un APK viejo sin los plugins nativos
  // nuevos (ej. <1.5.42 sin push). Se lee una sola vez; en web/PWA getInfo no aplica → queda null.
  const apkRef = useRef(null)
  // Fecha real de instalación del APK (epoch ms → ISO), leída una vez del plugin nativo InfoApp.
  // null en web/PWA o APK viejo sin el plugin. Sirve para "instalada hace X" en supervisión.
  const instaladoRef = useRef(null)

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
    // Se deja constancia en disco: es lo único que sobrevive al reinicio diario de `bgRef` y a que
    // se cierre la app, y es lo que le permite al aviso de "Permitir siempre" saber si hace falta.
    if (bgRef.current.ok) marcarBgHoy(hoy)
    return {
      gps_ok: gpsOk,
      gps_desde: new Date(gpsDesdeRef.current.since).toISOString(),
      permiso: error ? 'denegado' : (bgRef.current.ok ? 'siempre' : 'ok'),
      visible,
      bg_ok: bgRef.current.ok,
      gps_error: describirError(error),
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
      const cuar = await pendientesCuarentena().catch(() => null) // puntos aislados (ver queue.js)
      // Por qué el teléfono estuvo callado: sin internet, en modo avión, o se reinició. Lo sabe el
      // servicio NATIVO (el WebView congelado en Doze no puede observar nada, y `navigator.onLine`
      // miente — regla 12). En web y en APKs <1.7.0 esto viene null y no se sube nada.
      const nat = await estadoUploaderNativo().catch(() => null)
      const diagRed = nat && nat.red ? {
        red: nat.red,
        red_desde: nat.redDesde ? new Date(nat.redDesde).toISOString() : null,
        arranque_ts: nat.arranqueTs ? new Date(nat.arranqueTs).toISOString() : null,
        apagado_ts: nat.apagadoTs ? new Date(nat.apagadoTs).toISOString() : null,
      } : null
      // Telemetría de CAPTURA (1.8.0). La tabla `posiciones` solo guarda los puntos que sobrevivieron
      // a los filtros, así que desde SQL era imposible distinguir "el filtro de movimiento descartó"
      // de "el sistema operativo no entregó fixes" — y son arreglos opuestos. Con estos contadores la
      // pregunta se responde con un select en vez de adivinando. Ver UploaderGpsService.
      //
      // `fix_dueno` es la otra mitad: dice a nombre de quién está capturando el teléfono. Si no
      // coincide con `id_usuario`, hay un desfase de sesión y hay que verlo acá, no descubrirlo por
      // un recorrido raro en el mapa de otra persona.
      const diagCaptura = nat && typeof nat.fixes === 'number' ? {
        fix_total: nat.fixes,
        fix_guardados: nat.guardados,
        fix_desc_precision: nat.descPrecision,
        fix_desc_salto: nat.descSalto,
        fix_desc_movimiento: nat.descMovimiento,
        fix_ultimo_ts: nat.ultimoFixAt ? new Date(nat.ultimoFixAt).toISOString() : null,
        fix_dueno: nat.dueno || null,
        cuarentena_nativa: typeof nat.cuarentena === 'number' ? nat.cuarentena : null,
        // 🩸 Telemetría de 1.9.0 (db/29, 04/08/2026). El plugin la devolvía desde que se publicó
        // 1.9.0 y acá se TIRABA: no había columnas, así que la pregunta que motivó toda esa versión
        // —¿el WakeLock arregló los silencios, o hay que ir al carril de red?— no se podía responder
        // con un select. `gps_silencio_max_ms` es la que decide; `gps_repedidos` mide el churn de
        // requestLocationUpdates (en decenas está bien, en cientos no); `gps_intervalo_ms` es la
        // cadencia PEDIDA, para contrastarla contra la ENTREGADA, que sale de `posiciones`.
        gps_intervalo_ms: typeof nat.intervalo === 'number' ? nat.intervalo : null,
        gps_repedidos: typeof nat.repedidos === 'number' ? nat.repedidos : null,
        gps_silencio_max_ms: typeof nat.silencioMax === 'number' ? nat.silencioMax : null,
        gps_fixes_red: typeof nat.fixesRed === 'number' ? nat.fixesRed : null,
      } : null
      // 🩸 Diagnóstico del ARRANQUE (1.11.0, db/30). Las tres preguntas que "a veces no inicia"
      // mezclaba en una, y que piden arreglos distintos: ¿la alarma corrió? ¿quedó armada para el
      // horario y es exacta? ¿Android está rechazando el arranque del foreground service?
      // En un APK <1.11.0 estos campos vienen undefined y no se sube nada (mismo criterio que
      // `diagRed`: omitir es distinto de escribir null, ver el 🩸 de fcm_token).
      const diagArranque = nat && typeof nat.fgsBloqueado === 'number' ? {
        alarma_ultima_ts: nat.alarmaTs ? new Date(nat.alarmaTs).toISOString() : null,
        alarma_proxima_ts: nat.alarmaProx ? new Date(nat.alarmaProx).toISOString() : null,
        alarma_exacta: !!nat.alarmaExacta,
        fgs_bloqueado: nat.fgsBloqueado,
        fgs_bloqueado_ts: nat.fgsBloqueadoTs ? new Date(nat.fgsBloqueadoTs).toISOString() : null,
      } : null
      // Subir solo si algún campo de estado cambió: antes el upsert corría cada 120 s
      // aunque no hubiera novedad (30 requests/hora de puro ruido). Igual se fuerza un
      // envío cada FORZAR_MS para refrescar el `ts`: Supervisión (EstadoEquipo)
      // clasifica por antigüedad del timestamp y sin latido el equipo parece caído.
      // fcm_token: para que el backend (watchdog) sepa a qué teléfono mandar el push. Puede ser
      // null hasta que FCM registre el dispositivo; se sube en cuanto aparece.
      // Permiso de notificaciones: se lee en cada latido y no una sola vez, porque el usuario lo
      // puede apagar desde Ajustes con la app abierta — y ese es justo el caso que hay que ver.
      const notif = await permisoNotificaciones().catch(() => null)
      // Exención de optimización de batería. Se lee en cada latido por el mismo motivo que el
      // permiso de notificaciones: el usuario la puede conceder (o revocar) desde Ajustes en
      // cualquier momento, y ese cambio es justo el evento que hay que ver. En web devuelve `true`
      // (degrada suave, ver battery.js), así que se omite si no es nativo para no ensuciar el dato.
      const exenta = isNative() ? await estaExento().catch(() => null) : null
      // 🩸 UN TOKEN NULL NO PISA AL QUE YA ESTÁ (04/08/2026). `fcm_token` viajaba SIEMPRE, así que
      // un latido que corriera ANTES de que FCM registrara el dispositivo escribía null encima del
      // token bueno — y el registro es asincrónico, igual que la hidratación desde persistencia, así
      // que el PRIMER latido de cada arranque en frío llega con null casi seguro. Medido: el
      // superadmin —la persona que reportó "no me llegan las notificaciones"— tenía token a las
      // 20:16 y `fcm_token = null` a las 23:31, después de cambiar de cuenta en el mismo teléfono.
      // Sin token no le llega NADA: ni los avisos del equipo ni el de actualización. Y se cura solo
      // solo si esa misma sesión vuelve a latir; si la persona cambia de cuenta antes, queda
      // inalcanzable hasta que vuelva a entrar.
      //
      // Omitirlo cuando no lo tenemos es lo correcto: el upsert deja la columna como estaba. "No sé
      // el token" y "este teléfono no tiene token" son cosas distintas, y solo el backend puede
      // afirmar la segunda (regla 34: se borra ante un rechazo EXPLÍCITO de FCM, no ante una duda).
      const fcm = getFcmTokenSync()
      // 🩸 LA PWA NO PISA LA IDENTIDAD DEL TELÉFONO (05/08/2026) — por qué al superadmin no le
      // llegaba el aviso de actualizar.
      //
      // `estado_dispositivo` tiene UNA fila por USUARIO (`onConflict: 'id_usuario'`) pero describe un
      // DISPOSITIVO. Quien usa la PWA en la PC y el APK en el teléfono tiene una sola fila que se
      // pelean los dos, y gana el último que latió. Como la PWA se autoactualiza sola desde GitHub
      // Pages, SIEMPRE reporta la versión más nueva: la fila del superadmin decía `app_version`
      // 1.10.0 por la web, aunque su teléfono estuviera en otra.
      //
      // Y `push-actualizacion` solo le manda a los ATRASADOS (`esMayor(latest, app_version)`). Con la
      // web tapando la versión real, el superadmin nunca entraba en esa lista: su `aviso_version`
      // estaba en null mientras los otros 9 teléfonos tenían 1.10.0 — o sea que no es que el aviso
      // se perdiera, es que NUNCA SE LE MANDÓ NI UNO.
      //
      // Estos cinco campos describen el APK, así que en web se OMITEN. Es el mismo criterio que ya
      // estaba escrito para `fcm_token`: "no sé" y "no tiene" son cosas distintas, y omitir deja la
      // columna como estaba en vez de borrarla. Un usuario que solo usa la PWA queda con
      // `app_version` null y sin token, así que la función lo filtra igual (`fcm_token is not null`).
      //
      // `modelo` va en este grupo por el mismo motivo, y no es teórico: alguien que abre la PWA desde
      // el navegador de un Android le escribiría a la fila el modelo de ESE teléfono, que puede no ser
      // el que trabaja. Se omite si es null (misma lógica que `fcm_token`): "todavía no sé" no pisa
      // al que ya está — y acá puede ser null para siempre si el WebView reduce la UA (ver
      // `modeloDispositivo`).
      const modelo = isNative() ? modeloDispositivo() : null
      const identidad = isNative() ? {
        app_version: APP_VERSION,
        apk_version: apkRef.current,
        instalado_ts: instaladoRef.current,
        notif_permiso: notif,
        bateria_exenta: exenta,
        ...(modelo ? { modelo } : {}),
      } : {}
      const estado = { cola_pendiente: cola, cuarentena_pendiente: cuar, ...identidad, ...(fcm ? { fcm_token: fcm } : {}), ...diagRed, ...diagCaptura, ...diagArranque, ...s }
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
    // Capturar la versión del APK una sola vez. En web/PWA getInfo no aplica → apkRef queda null.
    CapApp.getInfo().then((i) => { apkRef.current = i?.version || null }).catch(() => {})
    // Fecha de instalación del APK (una sola vez, del plugin nativo). null en web/PWA.
    primerInstallMs().then((ms) => { instaladoRef.current = ms ? new Date(ms).toISOString() : null }).catch(() => {})
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
