import mqtt from 'mqtt'

/**
 * Telemetría en vivo cross-device (Vendedor → Admin) por MQTT sobre WebSocket.
 * El teléfono publica su posición GPS; la PC del Admin la recibe en tiempo real.
 *
 * Usa un broker público (sin cuenta ni API key) para el prototipo. En producción
 * se reemplaza por Firebase Realtime DB / Supabase Realtime detrás de esta misma
 * API (publicarPosicion / suscribirPosiciones), sin tocar las vistas.
 */

const BROKER = 'wss://broker.emqx.io:8084/mqtt'
// Tópico único de esta app (evita cruces con otros demos del broker público).
export const TOPIC = 'launion/lajitas/telemetria/v1'
export const TOPIC_ALERTAS = 'launion/lajitas/alertas/v1'

let client = null

function getClient() {
  if (client) return client
  client = mqtt.connect(BROKER, {
    clientId: 'launion_' + Math.random().toString(16).slice(2),
    reconnectPeriod: 3000,
    connectTimeout: 8000,
    clean: true,
  })
  return client
}

/** Publica la posición del vendedor. payload: {id, nombre, lat, lng, ts} */
export function publicarPosicion(payload) {
  const c = getClient()
  const msg = JSON.stringify(payload)
  if (c.connected) c.publish(TOPIC, msg, { qos: 0 })
  else c.once('connect', () => c.publish(TOPIC, msg, { qos: 0 }))
}

/** Se suscribe a las posiciones entrantes. Devuelve función de baja. */
export function suscribirPosiciones(handler) {
  const c = getClient()
  const sub = () => c.subscribe(TOPIC)
  if (c.connected) sub()
  else c.on('connect', sub)

  const onMsg = (topic, buf) => {
    if (topic !== TOPIC) return
    try {
      handler(JSON.parse(buf.toString()))
    } catch {
      /* mensaje inválido: ignorar */
    }
  }
  c.on('message', onMsg)
  return () => c.off('message', onMsg)
}

/** Publica una alerta (ej. GPS desactivado). payload: {id, nombre, rol, tipo, ts} */
export function publicarAlerta(payload) {
  const c = getClient()
  const msg = JSON.stringify(payload)
  if (c.connected) c.publish(TOPIC_ALERTAS, msg, { qos: 1 })
  else c.once('connect', () => c.publish(TOPIC_ALERTAS, msg, { qos: 1 }))
}

/** Se suscribe a las alertas entrantes (para el Admin). Devuelve función de baja. */
export function suscribirAlertas(handler) {
  const c = getClient()
  const sub = () => c.subscribe(TOPIC_ALERTAS)
  if (c.connected) sub()
  else c.on('connect', sub)

  const onMsg = (topic, buf) => {
    if (topic !== TOPIC_ALERTAS) return
    try {
      handler(JSON.parse(buf.toString()))
    } catch {
      /* mensaje inválido: ignorar */
    }
  }
  c.on('message', onMsg)
  return () => c.off('message', onMsg)
}

/** Notifica el estado de conexión (true/false). Devuelve función de baja. */
export function estadoConexion(cb) {
  const c = getClient()
  cb(c.connected)
  const on = () => cb(true)
  const off = () => cb(false)
  c.on('connect', on)
  c.on('close', off)
  c.on('offline', off)
  return () => { c.off('connect', on); c.off('close', off); c.off('offline', off) }
}
