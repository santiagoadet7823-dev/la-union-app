import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { getAppConfig } from './data/appConfig'
import { getTrackConfig, dentroDeHorario } from './tracking'
import { persistence } from './persistence'
import { APP_VERSION } from '../version'

/**
 * Aviso de ACTUALIZACIÓN con la app cerrada (pedido del cliente, 1.6.x).
 *
 * Se apoya en el watchdog que YA despierta la app cada ~30 min (push FCM + AlarmManager local, ver
 * push.js / alarm.js). En cada despertar, si hay una versión nueva y estamos DENTRO del horario de
 * monitoreo del usuario, postea una notificación nativa ("tocá para actualizar"). Al tocarla se abre
 * la app y el UpdatePrompt/updater se encarga de instalar.
 *
 * Límite honesto (idéntico al watchdog): despierta a la app viva-pero-dormida (Doze / kill suave);
 * NO revive un force-stop manual ni a los OEM que bloquean FCM. No hay forma de garantizar el aviso
 * con la app forzada a cerrar — ver memoria push-watchdog-fcm.
 *
 * "Hay versión nueva" = app_config.latest_version distinto del APP_VERSION que corre. Tras actualizar
 * (OTA o APK), APP_VERSION pasa a ser el nuevo y deja de avisar. Se avisa UNA vez por versión (se
 * recuerda la última avisada) para no repetir en cada despertar.
 */
const AlarmWatchdog = registerPlugin('AlarmWatchdog')
const KEY_VER = 'lu-update-notif-ver'

// Compara 'a.b.c' — devuelve true si `nueva` es estrictamente mayor que `actual`.
function esMayor(nueva, actual) {
  const pa = String(nueva).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(actual).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0
  }
  return false
}

/**
 * Chequea y, si corresponde, notifica. Idempotente y barato: se llama en cada despertar del watchdog.
 * @param {string|null} userId para resolver el horario efectivo (categoría o global).
 */
export async function chequearYNotificarUpdate(userId = null) {
  if (!isNative()) return
  try {
    // Solo dentro del horario de monitoreo del usuario (no molestar de madrugada / fuera de jornada).
    const cfg = await getTrackConfig(userId)
    if (!dentroDeHorario(cfg)) return

    const data = await getAppConfig()
    const latest = data?.latest_version
    if (!latest || !esMayor(latest, APP_VERSION)) return // no hay novedad

    const yaAvisado = await persistence.get(KEY_VER, null)
    if (yaAvisado === latest) return // ya avisamos esta versión

    await AlarmWatchdog.notificar({
      titulo: 'Actualización disponible',
      cuerpo: `DisT-At ${latest} — tocá para actualizar.`,
    })
    await persistence.set(KEY_VER, latest)
  } catch (_) { /* best-effort: nunca romper el despertar del watchdog */ }
}
