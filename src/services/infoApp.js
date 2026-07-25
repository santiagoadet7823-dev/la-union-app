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
