/**
 * Puerto de exención de optimización de batería (Doze).
 *
 * Motivo: sin esta exención, OEMs agresivos (Motorola) matan el proceso + el
 * foreground service a los segundos de bloquear la pantalla y el GPS deja de
 * capturar. Con la exención, el proceso sobrevive y el rastreo sigue bloqueado.
 *
 * Respaldado por el plugin nativo `BatteryOptimization` (android/.../
 * BatteryOptimizationPlugin.java). En web / APK viejo sin el plugin, degrada suave:
 * `estaExento` devuelve true (no molesta) y `pedirExencion` devuelve false.
 */
import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'

const BatteryOptimization = registerPlugin('BatteryOptimization')

/** ¿La app está exenta de optimización de batería? En web/sin plugin → true. */
export async function estaExento() {
  if (!isNative()) return true
  try {
    const r = await BatteryOptimization.isIgnoring()
    return !!(r && r.ignoring)
  } catch (_) {
    return true // APK sin el plugin todavía → no bloquear el flujo
  }
}

/**
 * Lanza el diálogo del sistema para quitar la optimización de batería. El usuario
 * responde en otra pantalla, así que el valor devuelto es el estado ANTES de que
 * conteste; re-chequear con `estaExento()` al volver a foreground.
 * @returns {Promise<boolean>} estado de exención (best-effort)
 */
export async function pedirExencion() {
  if (!isNative()) return true
  try {
    const r = await BatteryOptimization.request()
    return !!(r && r.ignoring)
  } catch (_) {
    return false
  }
}
