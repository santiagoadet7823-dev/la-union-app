/**
 * LA VERSION DEL CODIGO QUE ESTA CORRIENDO, o sea la del BUNDLE.
 *
 * 🔴 SE SUBE EN CADA RELEASE, TAMBIEN EN LAS QUE VAN SOLO POR OTA. Acá decía "subir este número en
 * cada release del APK", y eso estaba mal — o al menos incompleto, y salió caro el 10/09/2026: se
 * publicaron tres OTA seguidas (1.28.0, 1.29.0, 1.30.0) dejando esta constante en 1.27.0, así que
 * los teléfonos recibían la actualización y seguían mostrando "App v1.27.0" en pantalla. El
 * reporte que volvió fue "me llegó una actualización pero sigue diciendo 1.27": no había forma de
 * confirmar que el cambio había llegado.
 *
 * Y no protegía nada. Esta constante viaja COMPILADA ADENTRO del bundle, así que es la versión del
 * bundle por construcción — no hay forma de que diga otra cosa que la del JS que se está
 * ejecutando (lo dice `useEstadoDispositivo`: "la OTA puede ir más adelante que el APK").
 *
 * ⚠️ NO ES LA DEL APK, Y NO SE COMPARA CONTRA `min_version`. La reinstalación nativa la decide
 * `services/apkUpdate.js` con `CapApp.getInfo().version`, que es el `versionName` de
 * `android/app/build.gradle` — otro número, que sí sube sólo cuando se compila un APK. Subir esta
 * constante no puede disparar ni evitar una reinstalación.
 *
 * Quien SÍ la lee es `services/updateNotify.js`, para no avisar de un APK que ya se tiene.
 */
export const APP_VERSION = '1.33.0'
