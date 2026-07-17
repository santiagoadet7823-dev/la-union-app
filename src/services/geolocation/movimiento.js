/**
 * Puente de Activity Recognition (¿el vendedor se está moviendo?).
 *
 * Motivo: el GPS corre a 1 Hz máxima precisión toda la jornada porque la app no sabe si
 * el vendedor está quieto o andando. El coprocesador de movimiento contesta esa pregunta
 * a costo ~cero y permite prender el GPS fino sólo cuando hace falta.
 *
 * Esto es SÓLO el puente: emite las transiciones crudas que manda el plugin nativo
 * `Movimiento` (android/.../MovimientoPlugin.java). La máquina de estados (cuándo
 * prender/apagar el GPS) NO va acá.
 *
 * En web / APK viejo sin el plugin degrada suave: `movimientoDisponible()` da false y
 * `escucharMovimiento()` es no-op, así que el llamador se queda con el GPS de siempre.
 */
import { registerPlugin } from '@capacitor/core'
import { isNative } from '../platform'

const Movimiento = registerPlugin('Movimiento')

/**
 * ¿Se puede usar Activity Recognition? (permiso concedido + Play Services presente).
 * En web, sin el plugin o ante cualquier error → false.
 * @returns {Promise<boolean>}
 */
export async function movimientoDisponible() {
  if (!isNative()) return false
  try {
    const r = await Movimiento.disponible()
    return !!(r && r.disponible)
  } catch (_) {
    return false // APK sin el plugin todavía
  }
}

/**
 * Arranca la escucha de transiciones. `cb` se llama una vez por transición.
 *
 * Ojo: la primera llamada puede disparar el diálogo de permiso (API 29+). Si el usuario
 * lo deniega, el nativo rechaza y esto queda sin emitir nada — no tira.
 *
 * @param {(ev: { actividad: 'quieto'|'caminando'|'vehiculo'|'bicicleta',
 *                transicion: 'entra'|'sale' }) => void} cb
 * @returns {() => void} función para parar la escucha (idempotente, no-op en web)
 */
export function escucharMovimiento(cb) {
  if (!isNative()) return () => {}

  let parado = false

  try {
    Movimiento.escuchar({}, (ev, err) => {
      // Permiso denegado / Play Services ausente / registro fallido: no emitir.
      if (err || !ev || parado) return
      cb({ actividad: ev.actividad, transicion: ev.transicion })
    })
  } catch (_) {
    return () => {} // APK sin el plugin todavía
  }

  return () => {
    if (parado) return
    parado = true
    try {
      Movimiento.parar()
    } catch (_) {
      // Nada que hacer: igual dejamos de emitir por la bandera de arriba.
    }
  }
}
