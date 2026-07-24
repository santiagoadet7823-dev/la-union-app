import { isNative } from './platform'
import { persistence } from './persistence'

/**
 * Push (FCM) — SOLO para el "watchdog": el backend manda un mensaje silencioso cada ~30 min
 * (Edge Function + pg_cron) para DESPERTAR la app y que, aunque el vendedor no la mire, refresque
 * su latido y siga publicando en segundo plano. Sirve para saber de verdad si apagó GPS o datos.
 *
 * Realidad de Android (honesta): esto ayuda contra el kill "suave" (Android reclama el proceso) y
 * refresca el estado, pero NO revive un force-stop manual ni vence a los OEM que bloquean FCM. Para
 * eso siguen mandando el permiso "Siempre" + excluir de batería (que ya avisa EstadoEquipo).
 *
 * El token FCM se guarda acá (módulo + persistencia) y `useEstadoDispositivo` lo sube en el latido
 * (columna estado_dispositivo.fcm_token), así el backend sabe a qué teléfono mandarle.
 */

const KEY_TOKEN = 'lu-fcm-token'
let tokenActual = null
let iniciado = false

// Hidratar el último token conocido al cargar el módulo (para que el primer latido ya lo lleve).
persistence.get(KEY_TOKEN).then((t) => { if (t && !tokenActual) tokenActual = t }).catch(() => {})

/** Token FCM conocido (sincrónico, para el payload del latido). null si todavía no hay. */
export function getFcmTokenSync() {
  return tokenActual
}

async function guardarToken(t) {
  if (!t || t === tokenActual) return
  tokenActual = t
  try { await persistence.set(KEY_TOKEN, t) } catch (_) { /* best-effort */ }
}

/**
 * Inicializa el push una sola vez (solo en la APK). Pide permiso de notificaciones, registra el
 * dispositivo en FCM y captura el token. Al recibir el ping silencioso, invoca `onWake` para que
 * la app refresque su latido / re-arme lo que haga falta desde JS.
 *
 * @param {() => void} [onWake] callback al recibir un push (app viva/en 2º plano).
 */
export async function initPush(onWake) {
  if (iniciado || !isNative()) return
  iniciado = true
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')

    // Token nuevo (o rotado): guardarlo. El latido lo sube en el próximo envío.
    PushNotifications.addListener('registration', (token) => { guardarToken(token?.value) })
    PushNotifications.addListener('registrationError', () => { /* sin token: el watchdog no aplica a este equipo */ })
    // Mensaje recibido con la app viva o en 2º plano → despertar el latido/re-armado.
    PushNotifications.addListener('pushNotificationReceived', () => { try { onWake && onWake() } catch (_) {} })

    // Permiso (Android 13+ pide POST_NOTIFICATIONS en runtime; en <13 se concede solo).
    let permiso = await PushNotifications.checkPermissions()
    if (permiso.receive === 'prompt' || permiso.receive === 'prompt-with-rationale') {
      permiso = await PushNotifications.requestPermissions()
    }
    // Aunque el usuario no acepte MOSTRAR notificaciones, igual registramos: los mensajes de DATOS
    // (silenciosos) del watchdog llegan por FCM sin depender del permiso de mostrar.
    await PushNotifications.register()
  } catch (_) {
    // Si el plugin/FCM no está disponible (ej. equipo sin Play Services), el watchdog simplemente
    // no aplica a ese teléfono; el resto de la app sigue igual.
    iniciado = false
  }
}
