import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { supabase } from './supabase'
import { getTrackConfig } from './tracking'
import { setUploaderNativo } from './geolocation/tracker'

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

// 'HH:MM' → minuto del día (450 = 07:30). null/ inválido → -1 (sin límite).
function aMinutos(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return -1
  return Number(m[1]) * 60 + Number(m[2])
}

/** Mintea el token del usuario actual, pasa la ventana horaria y arranca el servicio nativo. Idempotente. */
export async function iniciarUploaderNativo({ intervaloMs = 10000 } = {}) {
  if (!isNative() || iniciado || !INGEST_URL) return
  try {
    const { data: token, error } = await supabase.rpc('mi_token_ingesta')
    if (error || !token) return // sin token no se puede autenticar el POST nativo
    // Ventana horaria (misma config que el JS): el servicio nativo la chequea solo, sin depender del WebView.
    const cfg = await getTrackConfig().catch(() => null)
    const startMin = cfg ? aMinutos(cfg.start) : -1
    const endMin = cfg ? aMinutos(cfg.end) : -1
    const dias = cfg && Array.isArray(cfg.days) && cfg.days.length ? cfg.days.join(',') : ''
    await UploaderGps.configurar({ token, url: INGEST_URL, intervaloMs, startMin, endMin, dias })
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
}

/** Diagnóstico: { configurado, cola, ultimaOk } o null en web. */
export async function estadoUploaderNativo() {
  if (!isNative()) return null
  try { return await UploaderGps.estado() } catch (_) { return null }
}
