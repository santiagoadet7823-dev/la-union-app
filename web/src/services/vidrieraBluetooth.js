import { Capacitor, registerPlugin } from '@capacitor/core'
import { isNative } from './platform'
import { PROTOCOLO, sobreDe } from './vidriera'

/**
 * VIDRIERA POR BLUETOOTH — el camino alternativo al QR para pasarle la red a la tablet.
 *
 * 🩸 SOLO VIAJA EL SOBRE (~120 bytes: SSID, clave, IP, puerto y token). El catálogo y las fotos
 * siguen por WiFi: son ~13 MB y por RFCOMM tardarían minutos delante de un cliente. Esto reemplaza
 * a la CÁMARA, no al enlace — la decisión de que los datos van por `LocalOnlyHotspot` no se toca.
 *
 * ⚠️ **El QR sigue siendo el camino por defecto.** Esto bajó de necesario a cómodo cuando achicar
 * el código a 105 caracteres arregló casi todo el problema de escaneo. Si Bluetooth no está, está
 * apagado o falla, las dos pantallas siguen funcionando exactamente como antes: `disponible()` da
 * false y el botón no se dibuja.
 *
 * El sobre es el MISMO objeto que `textoQr` — a propósito. Dos formatos para el mismo dato son dos
 * parsers que se desincronizan, y ya hay una versión de protocolo que los cubre a los dos.
 */

const EnlaceBluetooth = registerPlugin('EnlaceBluetooth')

export function disponible() {
  return isNative() && Capacitor.isPluginAvailable('EnlaceBluetooth')
}

/** ¿Hay radio y está prendida? Para poder decirle al vendedor "prendé el Bluetooth" y no "falló". */
export async function estado() {
  try {
    return await EnlaceBluetooth.disponible()
  } catch (_) {
    return { hay: false, prendido: false }
  }
}

/**
 * CELULAR: deja el sobre disponible por Bluetooth hasta que se cierre la vidriera.
 *
 * Best-effort a propósito: si esto falla, la vidriera igual quedó abierta y el QR igual sirve. No
 * se le rompe la pantalla al vendedor por un camino que es una comodidad.
 */
export async function publicar(red) {
  try {
    await EnlaceBluetooth.publicar({ sobre: JSON.stringify(sobreDe(red)) })
    return true
  } catch (_) {
    return false
  }
}

/** Cierra el servicio Bluetooth. Va junto con `cerrarVidriera()`, nunca por separado. */
export async function detener() {
  try { await EnlaceBluetooth.detener() } catch (_) { /* ya estaba cerrado */ }
}

/**
 * TABLET: busca el sobre en los celulares ya vinculados.
 *
 * Valida la versión del protocolo igual que el escáner de QR: si un día el formato cambia, una
 * tablet vieja tiene que poder decir "actualizá la app" en vez de conectarse y mostrar mal el
 * catálogo.
 */
export async function buscar() {
  const { sobre } = await EnlaceBluetooth.buscar()
  let d
  try { d = JSON.parse(sobre) } catch (_) { throw new Error('El celular contestó algo que no entiendo.') }
  if (!d || typeof d !== 'object') throw new Error('El celular contestó algo que no entiendo.')
  if (d.v !== PROTOCOLO) {
    throw new Error(d.v > PROTOCOLO
      ? 'La app de esta tablet quedó vieja para ese celular. Actualizala.'
      : 'El celular del vendedor tiene una versión vieja de la app.')
  }
  if (!d.s || !d.k || !d.i || !d.p || !d.t) throw new Error('El sobre llegó incompleto.')
  return { ssid: d.s, clave: d.k, ip: d.i, puerto: d.p, token: d.t }
}
