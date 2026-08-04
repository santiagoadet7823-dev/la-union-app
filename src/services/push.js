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

import { registerPlugin } from '@capacitor/core'

const AlarmWatchdog = registerPlugin('AlarmWatchdog')
const KEY_TOKEN = 'lu-fcm-token'
// Canal e id del cartel que se postea con la app ABIERTA. El canal lo crea `LaUnionApp.onCreate()`
// (APK 1.10.0+); en un APK viejo `notificar` ignora el parámetro y cae en "actualizaciones", que es
// peor pero no rompe nada.
const CANAL_AVISOS = 'avisos'
const NOTIF_ALERTA_ID = 4191
// 🩸 La MISMA clave que usa `services/updateNotify.js` (KEY_VER). Si se cambia allá, se cambia acá:
// es el único punto de encuentro entre los dos caminos que pueden avisar de una versión nueva.
const KEY_UPDATE_VER = 'lu-update-notif-ver'
let tokenActual = null
let iniciado = false

// Hidratar el último token conocido al cargar el módulo (para que el primer latido ya lo lleve).
persistence.get(KEY_TOKEN).then((t) => { if (t && !tokenActual) tokenActual = t }).catch(() => {})

/** Token FCM conocido (sincrónico, para el payload del latido). null si todavía no hay. */
export function getFcmTokenSync() {
  return tokenActual
}

/**
 * 🩸 ¿ESTE TELÉFONO PUEDE MOSTRAR NOTIFICACIONES? (04/08/2026.)
 *
 * En Android 13+ `POST_NOTIFICATIONS` se pide en runtime y **una negativa queda pegada**: el sistema
 * no vuelve a preguntar. `initPush` registra en FCM igual —a propósito, porque los mensajes de DATOS
 * del watchdog no dependen de ese permiso— así que el teléfono TIENE token, el servidor cuenta
 * "enviado", FCM devuelve 200… y en la pantalla no aparece nada. Desde el servidor eso es
 * indistinguible de que la notificación llegó bien.
 *
 * Se lee en cada latido y se sube a `estado_dispositivo.notif_permiso` (db/29). Convierte "no me
 * llegan las notificaciones" en un dato por teléfono en vez de una conjetura.
 *
 * Devuelve 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale', o null en web / si el plugin
 * no está (APK viejo): null significa "no se sabe", que no es lo mismo que "denegado".
 */
export async function permisoNotificaciones() {
  if (!isNative()) return null
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const p = await PushNotifications.checkPermissions()
    return p?.receive || null
  } catch (_) { return null }
}

async function guardarToken(t) {
  if (!t || t === tokenActual) return
  tokenActual = t
  try { await persistence.set(KEY_TOKEN, t) } catch (_) { /* best-effort */ }
}

/**
 * 🩸 CON LA APP ABIERTA NO SE VEÍA NADA (04/08/2026).
 *
 * El plugin de Capacitor, al recibir un push, **no postea ninguna notificación**: reenvía el mensaje
 * al JS (`pushNotificationReceived`) y da por hecho que la app hará algo con él. Y hasta 1.9.0 esta
 * función solo miraba `tipo === 'actualizacion'`. O sea que mientras el supervisor tenía la app
 * ABIERTA mirando el mapa —el caso más común, porque es para eso que la abre— los avisos del equipo
 * llegaban, se contaban como "enviados" en el servidor y **desaparecían en silencio**.
 *
 * Android entrega el push al sistema (cartel automático) SOLO con la app en background o cerrada; en
 * primer plano el cartel lo tiene que dibujar la app. Eso es lo que hace esto.
 *
 * Todos los avisos comparten `id`, así que el nuevo REEMPLAZA al anterior en vez de apilar seis
 * carteles — la misma decisión que el `tag` del lado del servidor, por la misma razón.
 */
function mostrarAlerta(msg) {
  const titulo = msg?.title || 'Aviso del equipo'
  const cuerpo = msg?.body || ''
  if (!cuerpo) return
  AlarmWatchdog.notificar({ titulo, cuerpo, canal: CANAL_AVISOS, id: NOTIF_ALERTA_ID })
    .catch(() => { /* APK viejo sin el parámetro, o sin permiso: se pierde el cartel, no la app */ })
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
    PushNotifications.addListener('pushNotificationReceived', (msg) => {
      // Si el push YA es el aviso de actualización (Edge Function push-actualizacion), lo anotamos
      // como avisado para que `updateNotify.js` no postee un SEGUNDO cartel diciendo lo mismo
      // cuando el watchdog despierte la app. Los dos caminos conviven a propósito —el push necesita
      // internet, la alarma local no— pero el usuario tiene que ver un aviso, no dos.
      try {
        const d = msg?.data || {}
        if (d.tipo === 'actualizacion' && d.version) persistence.set(KEY_UPDATE_VER, String(d.version))
        if (d.tipo === 'alerta') mostrarAlerta(msg)
      } catch (_) { /* best-effort: nunca romper el despertar por esto */ }
      // El despertar sintético (visibilitychange) también refresca la campanita: `useAlertasEquipo`
      // ya recarga con ese evento cuando el documento está visible. No hace falta otro puente.
      try { onWake && onWake() } catch (_) {}
    })

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
