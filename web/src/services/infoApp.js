import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'

/**
 * Puente al plugin nativo `InfoApp` (android/.../InfoAppPlugin.java): la fecha real de instalación
 * del APK (PackageManager.firstInstallTime). En web/PWA o APK viejo sin el plugin, degrada suave a null.
 * Pedido del cliente 24/07/2026: mostrar en supervisión hace cuánto se instaló la app.
 */
const InfoApp = registerPlugin('InfoApp')

/**
 * Epoch ms de la instalación del APK, o null si no aplica (web/PWA) o el plugin no responde.
 * @returns {Promise<number|null>}
 */
export async function primerInstallMs() {
  if (!isNative()) return null
  try {
    const r = await InfoApp.instalacion()
    const t = r && r.firstInstall
    return typeof t === 'number' && t > 0 ? t : null
  } catch (_) {
    return null // APK viejo sin el plugin → null (columna instalado_ts es nullable)
  }
}

/**
 * Modelo del teléfono (ej. `SM-A075M`), leído del userAgent del WebView. `null` si no se puede saber.
 *
 * 🩸 POR QUÉ HACE FALTA (13/08/2026, db/39). El parque NO registraba en ninguna tabla qué teléfono
 * es cada uno, así que la hipótesis del cliente —"creo que ellos tienen samsung a07"— no se podía ni
 * probar ni descartar. Y es la hipótesis que más importa, porque la diferencia entre los dos grupos
 * parece de HARDWARE: el 12-13/08, mismo día y misma ciudad, Gabriel tuvo 3 fixes de menos de 5 m en
 * 4.973 y Agustin 5.555 en 5.642. Si los cuatro que fallan comparten modelo y los dos sanos son
 * otro, la respuesta no es una constante de GPS.
 *
 * Sale de la UA y no de `@capacitor/device` para no sumar una dependencia, y sobre todo para que
 * llegue por OTA: un APK nuevo tardaría días en estar en la calle y la prueba es de esta semana.
 *
 * ⚠️ LÍMITE CONOCIDO — puede devolver null en todo el parque. Android WebView aplica *UA reduction*:
 * en vez del modelo manda la letra `K` y clava la versión en 10. No hay forma de sacarle el modelo a
 * una UA reducida, así que acá se devuelve null en vez de guardar `K`, que sería basura con forma de
 * dato. **Si `estado_dispositivo.modelo` queda null en todos, la reducción está activa y el dato hay
 * que sacarlo por el camino nativo** (`Build.MODEL`/`Build.MANUFACTURER` en `UploaderGpsPlugin.estado()`),
 * que además es el único que da el fabricante — la UA no lo trae nunca.
 */
export function modeloDispositivo() {
  try {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || ''
    // `(Linux; Android 14; SM-A075M Build/UP1A.231005.007; wv)` → SM-A075M
    // El `Build/…` es opcional: hay UAs que no lo traen.
    const m = /\(Linux; Android [\d.]+; ([^;)]+?)(?:\s+Build\/[^;)]*)?[;)]/.exec(ua)
    const modelo = m && m[1] ? m[1].trim() : ''
    // 'K' es el marcador de la UA reducida, no un modelo. Se descarta explícitamente.
    if (!modelo || modelo === 'K') return null
    return modelo.slice(0, 60)
  } catch (_) {
    return null // parseo defensivo: esto corre dentro del latido y no lo puede romper nunca
  }
}
