/**
 * Puerto de sincronización en tiempo real (Vendedor → Admin → Repartidor).
 * - Ahora: canal local. Un cambio de pedidos se propaga entre pestañas/roles
 *   del mismo dispositivo vía BroadcastChannel (+ storage events de respaldo).
 * - Producción multi-dispositivo: reemplazar por adaptador Firebase (Firestore
 *   onSnapshot + FCM) o Supabase Realtime. La API pub/sub se mantiene igual.
 */

const CHANNEL = 'launion:sync'

let bc = null
function channel() {
  if (bc) return bc
  if (typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel(CHANNEL)
  }
  return bc
}

/** Publica un evento de dominio (ej. 'pedidos-actualizados'). */
export function publicar(tipo, payload) {
  const msg = { tipo, payload, ts: Date.now() }
  channel()?.postMessage(msg)
}

/** Se suscribe a eventos. Devuelve función de baja. */
export function suscribir(handler) {
  const ch = channel()
  if (!ch) return () => {}
  const onMsg = (e) => handler(e.data)
  ch.addEventListener('message', onMsg)
  return () => ch.removeEventListener('message', onMsg)
}
