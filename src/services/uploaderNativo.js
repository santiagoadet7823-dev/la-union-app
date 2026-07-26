import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { supabase } from './supabase'
import { getTrackConfig } from './tracking'
import { setUploaderNativo } from './geolocation/tracker'
import { MIN_MOVE_M, STATIONARY_KEEPALIVE_MS } from './gpsConfig'

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
 */
export async function iniciarUploaderNativo(cfg = null, { intervaloMs = 15000 } = {}) {
  if (!isNative() || !INGEST_URL) return
  try {
    if (!tokenCache) {
      const { data: token, error } = await supabase.rpc('mi_token_ingesta')
      if (error || !token) return // sin token no se puede autenticar el POST nativo
      tokenCache = token
    }
    // Ventana horaria (misma config que el JS): el servicio nativo la chequea solo, sin depender del WebView.
    const c = cfg || await getTrackConfig().catch(() => null)
    const startMin = c ? aMinutos(c.start) : -1
    const endMin = c ? aMinutos(c.end) : -1
    const dias = c && Array.isArray(c.days) && c.days.length ? c.days.join(',') : ''
    await UploaderGps.configurar({
      token: tokenCache, url: INGEST_URL, intervaloMs,
      startMin, endMin, dias,
      minMoveM: MIN_MOVE_M, keepAliveMs: STATIONARY_KEEPALIVE_MS,
    })
    await UploaderGps.iniciar()
    iniciado = true
    setUploaderNativo(true) // el JS deja de subir: el nativo es la fuente única
  } catch (_) { /* no romper el rastreo JS si el nativo falla */ }
}

/** Detiene el servicio nativo y devuelve la subida al JS (fuera de horario / logout). */
export async function detenerUploaderNativo() {
  if (!isNative() || !iniciado) return
  setUploaderNativo(false) // el JS vuelve a ser el que sube
  try { await UploaderGps.detener() } catch (_) { /* best-effort */ }
  iniciado = false
  tokenCache = null // que un re-login en el mismo teléfono re-mintee (no arrastrar el token de otra cuenta)
}

/** Diagnóstico: { configurado, cola, ultimaOk } o null en web. */
export async function estadoUploaderNativo() {
  if (!isNative()) return null
  try { return await UploaderGps.estado() } catch (_) { return null }
}
