import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { getAppConfig } from './data/appConfig'
import { getTrackConfig, dentroDeHorario } from './tracking'
import { persistence } from './persistence'
import { APP_VERSION } from '../version'
import { otaCheck, otaDownload } from './ota'
import { apkCheck, apkStartUpdate } from './apkUpdate'

/**
 * Actualización AUTOMÁTICA con la app cerrada, y aviso de que ya está lista.
 *
 * Se apoya en el watchdog que YA despierta la app cada ~30 min (push FCM + AlarmManager local, ver
 * push.js / alarm.js). En cada despertar, si hay versión nueva, la BAJA sola y recién entonces avisa
 * "ya está actualizada, tocá para abrir".
 *
 * 🩸 08/08/2026 — ANTES ESTO SOLO AVISABA, Y ESO NO ALCANZA. La versión 1.12.0 se publicó en los
 * tres canales, se mandaron 17 notificaciones sin una sola falla, y a las tres horas los 9 teléfonos
 * seguían en 1.11.0 — incluido el único que estaba online y había recibido el aviso. El cartel pedía
 * un toque que nadie daba: un vendedor en la calle no abre la app para actualizarla. Todo el aparato
 * de despliegue funcionaba y aun así el parque no se movía.
 *
 * Ahora el despertar hace el trabajo:
 *   · OTA (contenido web) → se descarga y queda ENCOLADA con `next()`. Se aplica sola en el próximo
 *     arranque; no se fuerza un `reload()` acá, que le reiniciaría la pantalla a alguien que puede
 *     estar en medio de un check-in.
 *   · APK (cambio nativo) → se descarga y se instala. Es silencioso en Android 12+ SI la app es su
 *     propio instalador de registro (ver ApkUpdaterPlugin); si no lo es, Android muestra su diálogo
 *     y el usuario lo confirma cuando levante el teléfono. En el peor caso queda igual que antes.
 *
 * El APK va PRIMERO, igual que en UpdatePrompt: trae el contenido web nuevo adentro, así que
 * bajar además la OTA sería descargar dos veces lo mismo.
 *
 * Límite honesto (idéntico al watchdog): despierta a la app viva-pero-dormida (Doze / kill suave);
 * NO revive un force-stop manual ni a los OEM que bloquean FCM. No hay forma de garantizar esto con
 * la app forzada a cerrar — ver memoria push-watchdog-fcm.
 *
 * Se actúa UNA vez por versión (se recuerda la última) para no re-descargar en cada despertar. La
 * marca se guarda SOLO si la descarga salió bien: si falla, el próximo despertar reintenta, que es
 * justo lo que se quiere con un teléfono que entra y sale de cobertura.
 *
 * 🩸 EL APK NECESITA SU PROPIO FRENO, y es por datos móviles, no por versión. `apkCheck()` sigue
 * devolviendo el mismo APK mientras la versión instalada esté por debajo de `min_version`, y esa
 * condición NO se levanta cuando la descarga termina: se levanta cuando el sistema termina de
 * INSTALAR. Entre una cosa y la otra puede pasar la jornada entera — el diálogo de Android espera a
 * que la persona levante el teléfono, y en los equipos que no son su propio instalador de registro
 * ese diálogo aparece siempre. Sin freno, cada despertar volvía a bajar los **21,7 MB** del .apk:
 * ~20 despertares en la jornada son ~430 MB por día y por teléfono, de datos del empleado, en
 * silencio. Por eso se recuerda el ÚLTIMO INTENTO por versión y se espera `APK_REINTENTO_MS`.
 *
 * El freno distingue los dos fracasos, que no son el mismo:
 *   · La descarga TIRA error (sin cobertura, GitHub caído) → no bajó nada, no gastó datos: se
 *     reintenta en el próximo despertar. Es justo el teléfono que entra y sale de cobertura.
 *   · La descarga RESUELVE y la instalación queda pendiente → los datos ya se gastaron y el .apk ya
 *     está en el disco. Reintentar antes de que la persona toque el diálogo no acelera nada.
 */
const AlarmWatchdog = registerPlugin('AlarmWatchdog')
const KEY_VER = 'lu-update-notif-ver'
const KEY_APK = 'lu-update-apk-intento'
// 6 h ⇒ como mucho 2 descargas por jornada (43 MB) en vez de ~20 (430 MB). Sigue habiendo un
// reintento por turno para el equipo que se quedó a mitad de camino.
const APK_REINTENTO_MS = 6 * 60 * 60 * 1000

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
 * Chequea, ACTUALIZA y notifica. Idempotente y barato: se llama en cada despertar del watchdog.
 * @param {string|null} userId para resolver el horario efectivo (categoría o global).
 */
export async function chequearYNotificarUpdate(userId = null) {
  if (!isNative()) return
  try {
    // Solo dentro del horario de monitoreo del usuario. Vale tanto para no notificar de madrugada
    // como para no gastarle datos móviles a las 3 AM bajando un bundle.
    const cfg = await getTrackConfig(userId)
    if (!dentroDeHorario(cfg)) return

    const data = await getAppConfig()
    const latest = data?.latest_version
    if (!latest || !esMayor(latest, APP_VERSION)) return // no hay novedad

    const yaHecho = await persistence.get(KEY_VER, null)
    if (yaHecho === latest) return // esta versión ya se bajó en un despertar anterior

    // --- APK primero: un cambio nativo no lo puede cubrir la OTA, y el .apk ya trae el web nuevo.
    const apk = await apkCheck()
    if (apk) {
      // No se marca `KEY_VER`: la instalación la termina el sistema y puede quedar a mitad de camino
      // (por ejemplo esperando que el usuario confirme). Si se completó, en el próximo despertar
      // `apkCheck` ya devuelve null y cae a la rama de abajo. Lo que sí se marca es el intento, para
      // no re-descargar 21,7 MB cada media hora mientras ese diálogo espera (ver el encabezado).
      if (!(await tocaReintentarApk(apk.version))) return
      await apkStartUpdate(apk)
      // Recién acá: si `descargarEInstalar` tiró, no se gastaron datos y conviene reintentar ya.
      await persistence.set(KEY_APK, `${apk.version}|${Date.now()}`)
      await avisar(latest, 'Se está instalando la versión nueva. Tocá para abrir cuando termine.')
      return
    }

    // --- OTA: se descarga y queda encolada para el próximo arranque.
    const ota = await otaCheck()
    if (ota) {
      await otaDownload(ota)
      await persistence.set(KEY_VER, latest)
      await avisar(latest, 'Ya está lista. Tocá para abrir la app actualizada.')
    }
  } catch (_) { /* best-effort: nunca romper el despertar del watchdog */ }
}

/**
 * ¿Pasó `APK_REINTENTO_MS` desde el último intento para ESTA versión? Un `min_version` nuevo
 * reintenta enseguida (la marca vieja no le aplica), que es lo que se quiere: si se publica un APK
 * de urgencia no tiene que esperar 6 h.
 */
async function tocaReintentarApk(version) {
  const marca = await persistence.get(KEY_APK, null)
  if (!marca) return true
  const [ver, ts] = String(marca).split('|')
  if (ver !== String(version)) return true
  const t = parseInt(ts, 10)
  // Sin fecha usable se reintenta: perder una actualización es peor que una descarga de más.
  if (!Number.isFinite(t)) return true
  // Un reloj movido hacia atrás dejaría `Date.now() - t` negativo y congelaría los reintentos
  // para siempre; se trata como marca inválida.
  const dt = Date.now() - t
  return dt < 0 || dt >= APK_REINTENTO_MS
}

/** El cartel. Tocarlo abre la app (lo resuelve el PendingIntent del plugin). */
async function avisar(version, cuerpo) {
  try {
    await AlarmWatchdog.notificar({
      titulo: `DisT-At ${version} actualizada`,
      cuerpo,
    })
  } catch (_) {}
}
