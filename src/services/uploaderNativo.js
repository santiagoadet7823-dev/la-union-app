import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { supabase } from './supabase'
import { setUploaderNativo } from './geolocation/tracker'
import {
  MIN_MOVE_M, STATIONARY_KEEPALIVE_MS, NEAR_LIVE_MS, NEAR_LIVE_RAPIDO_MS, VEL_UMBRAL_MPS, VEL_HIST_MS,
  ACCURACY_MAX_M, ACCURACY_CAPTURA_MAX_M, MAX_SPEED_MPS, MAX_SALTOS_SEGUIDOS,
  MIN_MOVE_URBANO_M, MIN_MOVE_RUTA_M, VEL_RUTA_MPS, NEAR_LIVE_QUIETO_MS,
  ACCURACY_RED_MAX_M, SILENCIO_MS, REPEDIDO_MIN_MS,
} from './gpsConfig'

/**
 * Bridge al uploader GPS NATIVO (Opción B, 24/07/2026). El servicio nativo (UploaderGpsService) captura
 * y postea las posiciones directo a la Edge Function `ingest-posiciones`, SIN pasar por el WebView, así
 * la ubicación sigue subiendo con la pantalla bloqueada (el JS se congela en Doze; esto no).
 *
 * Consolidación: mientras el uploader nativo corre, ES la fuente ÚNICA de subida — el pipeline JS deja
 * de encolar/subir (setUploaderNativo) para no duplicar puntos. Ver tracker.js.
 *
 * Se autentica con un TOKEN DE DISPOSITIVO (RPC mi_token_ingesta), no con el JWT (que vence en 1 h y no
 * es accesible desde nativo). El token se mintea al iniciar y se le pasa al servicio nativo.
 */
const UploaderGps = registerPlugin('UploaderGps')

// La Edge Function vive en el mismo proyecto Supabase que el resto del backend.
const BASE = import.meta.env.VITE_SUPABASE_URL || ''
const INGEST_URL = BASE ? `${BASE.replace(/\/$/, '')}/functions/v1/ingest-posiciones` : ''

let iniciado = false
// Token de dispositivo cacheado (RPC mi_token_ingesta). Se mintea una vez por sesión y se reusa en cada
// reempuje de config: sin esto, refrescar la ventana cada 4 min golpearía la RPC cada vez. Se limpia al
// detener/desloguear (detenerUploaderNativo) para no arrastrarlo a otra cuenta en el mismo teléfono.
let tokenCache = null

// 'HH:MM' → minuto del día (450 = 07:30). null/ inválido → -1 (sin límite).
function aMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return -1
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * Mintea el token (si no está cacheado), REEMPUJA la ventana horaria + los filtros al servicio nativo y
 * lo arranca. RE-INVOCABLE a propósito (no hay early-return por `iniciado`): así un cambio de horario
 * desde EmpresasView llega al teléfono sin reiniciar — el nativo relee la ventana de prefs en cada fix —
 * y si el servicio se auto-apagó (fuera de ventana con la hora vieja), `iniciar()` lo vuelve a levantar.
 *
 * `minMoveM`/`keepAliveMs` gobiernan el filtro por movimiento del servicio nativo (encolar solo si se
 * movió, o cada keepAlive estando quieto): así son ajustables por OTA sin recompilar el APK. Se pasa el
 * `cfg` ya cargado (por usePublishPosition) para no re-consultar getTrackConfig en cada reempuje.
 *
 * 🩸 `intervaloMs` sale de `NEAR_LIVE_MS`, NO de un literal (30/07/2026). Estuvo hardcodeado en 15000
 * mientras `gpsConfig.js` —el archivo que dice ser la única fuente de verdad de estas constantes—
 * declaraba 10 s. O sea que la constante existía, se documentaba, y el uploader nativo (que es el
 * que está en la calle) la ignoraba: bajar NEAR_LIVE_MS no hacía absolutamente nada. Los dos únicos
 * llamadores no pasan la opción, así que el default ES el valor real de producción.
 */
export async function iniciarUploaderNativo(cfg = null, { intervaloMs = NEAR_LIVE_MS, userId = null } = {}) {
  if (!isNative() || !INGEST_URL) return
  try {
    if (!tokenCache) {
      const { data: token, error } = await supabase.rpc('mi_token_ingesta')
      if (error || !token) return // sin token no se puede autenticar el POST nativo
      tokenCache = token
    }
    // Dueño de los puntos de esta sesión. Se lee de la sesión viva y no del parámetro cuando este no
    // viene, para que NUNCA pueda quedar desfasado del token: los dos salen del mismo usuario.
    let dueno = userId
    if (!dueno) {
      const { data } = await supabase.auth.getSession()
      dueno = data?.session?.user?.id || null
    }
    // Ventana horaria (misma config que el JS): el servicio nativo la chequea solo, sin depender del WebView.
    //
    // 🩸 SIN fallback a `getTrackConfig()` sin userId (02/08/2026). Ese fallback devolvía el horario
    // GLOBAL, y como esto se escribe en las prefs, el servicio nativo quedaba corriendo con la ventana
    // general aunque la persona tuviera una categoría de rastreo propia: la categoría quedaba CAPADA
    // por el horario general. Pasaba en cada arranque en frío, porque el llamador todavía no tenía la
    // config cargada. Si no hay config del usuario, NO se empuja ventana — se espera a tenerla.
    const c = cfg
    if (!c) return
    const startMin = aMinutos(c.start)
    const endMin = aMinutos(c.end)
    const dias = Array.isArray(c.days) && c.days.length ? c.days.join(',') : ''
    // Jornada partida (1.8.0): todas las ventanas en una sola cadena `inicio-fin-dias;inicio-fin-dias`,
    // con los días separados por coma. El nativo la parsea y aplica la UNIÓN. Se manda además de
    // startMin/endMin/dias, que quedan como la primera ventana: un APK viejo ignora esta clave y
    // sigue funcionando con una sola ventana en vez de romperse.
    const vs = Array.isArray(c.ventanas) && c.ventanas.length ? c.ventanas : [c]
    const ventanas = vs
      .map((v) => `${aMinutos(v.start)}-${aMinutos(v.end)}-${Array.isArray(v.days) && v.days.length ? v.days.join(',') : ''}`)
      .join(';')
    await UploaderGps.configurar({
      token: tokenCache, url: INGEST_URL, intervaloMs, dueno,
      startMin, endMin, dias, ventanas,
      minMoveM: MIN_MOVE_M, keepAliveMs: STATIONARY_KEEPALIVE_MS,
      // Cadencia adaptativa por velocidad: el nativo captura más seguido en movimiento rápido (auto) para
      // que el trazo siga la calle, y vuelve a la lenta al frenar. Afinables por OTA (SharedPreferences).
      intervaloRapidoMs: NEAR_LIVE_RAPIDO_MS, velUmbralMps: VEL_UMBRAL_MPS, velHistMs: VEL_HIST_MS,
      // Umbrales de descarte (1.8.0): estaban hardcodeados en el Java y ahora viajan también por
      // prefs, así que se afinan por OTA.
      //
      // 🩸 Acá va el techo de CAPTURA (`ACCURACY_CAPTURA_MAX_M`, 120 m) y NO el de confianza
      // (`ACCURACY_MAX_M`, 30 m). Hasta 1.13.2 iba el de 30 y el servicio nativo tiraba el 66 % de
      // los fixes de Alejandro mercado, con el resultado de que 39,6 km de ruta no existieran en la
      // base. Lo que se captura y lo que se dibuja lleno son dos preguntas distintas: el techo de
      // 30 sigue vivo, del lado del dibujo (`limpiarTrazo`), decidiendo qué es línea y qué es
      // punteado. Ver el 🩸 de `ACCURACY_CAPTURA_MAX_M` en gpsConfig.js.
      // `accuracyConfM` lo estrena el APK 1.13.3+; los que están en la calle (1.13.0) ignoran la
      // clave y se quedan con su default de 30, así que mandarla ahora no rompe nada y evita tener
      // que acordarse cuando salga el APK.
      accuracyMaxM: ACCURACY_CAPTURA_MAX_M, accuracyConfM: ACCURACY_MAX_M, maxSpeedMps: MAX_SPEED_MPS,
      minJumpM: MIN_MOVE_M, maxSaltosSeguidos: MAX_SALTOS_SEGUIDOS,
      // 1.9.0 — guardado por DISTANCIA según el modo (el pedido del cliente), cadencia con "quieto"
      // confirmado por el acelerómetro, carril de triangulación durante un silencio y piso
      // anti-churn. Todos por prefs → se afinan por OTA sin recompilar el APK (regla 22-ter).
      minMoveUrbanoM: MIN_MOVE_URBANO_M, minMoveRutaM: MIN_MOVE_RUTA_M, velRutaMps: VEL_RUTA_MPS,
      intervaloQuietoMs: NEAR_LIVE_QUIETO_MS,
      accuracyRedMaxM: ACCURACY_RED_MAX_M, silencioMs: SILENCIO_MS,
      repedidoMinMs: REPEDIDO_MIN_MS,
    })
    await UploaderGps.iniciar()
    iniciado = true
    setUploaderNativo(true) // el JS deja de subir: el nativo es la fuente única
  } catch (_) { /* no romper el rastreo JS si el nativo falla */ }
}

/**
 * Detiene el servicio nativo y devuelve la subida al JS (fuera de horario).
 *
 * 🩸 SIN el guard `!iniciado` (02/08/2026). Lo tenía, y era la mitad del bug de multi-cuenta:
 * `iniciado` es una variable de MÓDULO, así que vale `false` en cada arranque en frío del WebView.
 * Pero el servicio nativo sobrevive a ese arranque —lo levantan BootReceiver y AlarmReceiver sin
 * pasar por el JS—, así que en el caso que importa (la app se reabrió y ahora hay otro rol logueado)
 * detener() se rendía sin hacer nada y el servicio seguía subiendo con el token viejo.
 * `stopService()` es idempotente: llamarlo de más no cuesta nada, y el guard costaba el bug.
 */
export async function detenerUploaderNativo() {
  if (!isNative()) return
  setUploaderNativo(false) // el JS vuelve a ser el que sube
  try { await UploaderGps.detener() } catch (_) { /* best-effort */ }
  iniciado = false
  tokenCache = null // que un re-login en el mismo teléfono re-mintee (no arrastrar el token de otra cuenta)
}

/**
 * 🩸 Cierre de sesión: detiene el servicio Y LE SACA EL TOKEN.
 *
 * Detenerlo no alcanza. Para el uploader nativo el token ES la identidad, y quedaba guardado en las
 * prefs del teléfono después de cerrar sesión; con él, `BootReceiver` y `AlarmReceiver` (cada 30 min)
 * volvían a levantar el servicio —los dos arrancan con solo ver un token— y el teléfono seguía
 * subiendo posiciones a nombre de la cuenta anterior. Como `ingest-posiciones` saca id_usuario e
 * id_empresa DEL TOKEN, esas filas quedaban atribuidas a alguien que no estaba ahí, en una tabla que
 * no tiene policy de UPDATE ni de DELETE: incorregibles.
 *
 * La cola NO se toca (regla 20): los puntos sin subir siguen siendo de su dueño y esperan.
 */
export async function cerrarSesionUploader() {
  if (!isNative()) return
  setUploaderNativo(false)
  // No se intenta un último flush acá a propósito: arrancar un foreground service en pleno cierre de
  // sesión, para que quizás suba, es peor que esperar. Los puntos pendientes quedan en la cola con su
  // dueño estampado y se suben solos cuando esa cuenta vuelva a entrar en este teléfono.
  try { await UploaderGps.cerrarSesion() } catch (_) { /* best-effort */ }
  iniciado = false
  tokenCache = null
}

/**
 * Diagnóstico del servicio nativo. En web devuelve null; en un APK viejo (<1.7.0) devuelve solo
 * `{ configurado, cola, ultimaOk }` y los campos de red quedan undefined — de ahí que todo lo que
 * lo consuma tenga que tolerar el null.
 *
 * Campos (APK 1.7.0+):
 *   · configurado : hay token y URL guardados
 *   · cola        : puntos capturados que todavía no se pudieron subir
 *   · ultimaOk    : epoch ms del último POST 2xx
 *   · red         : 'ok' | 'sin-red' | 'avion'  ← por qué no sube
 *   · redDesde    : epoch ms desde que está en ese estado
 *   · arranqueTs  : epoch ms del último BOOT_COMPLETED
 *   · apagadoTs   : epoch ms del último ACTION_SHUTDOWN (best-effort: no caza la batería agotada)
 *
 * 🩸 El límite que hay que tener presente: esto solo se puede LEER y subir cuando el teléfono
 * volvió a tener red. Sirve para EXPLICAR un silencio después, nunca para detectarlo mientras
 * pasa — de eso se encarga `vigilancia_equipo` en el servidor.
 */
export async function estadoUploaderNativo() {
  if (!isNative()) return null
  try { return await UploaderGps.estado() } catch (_) { return null }
}
