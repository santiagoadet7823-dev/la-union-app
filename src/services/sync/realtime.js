import { supabase, hasSupabase } from '../supabase'

/**
 * Telemetría en tiempo real sobre Supabase (reemplaza el MQTT del prototipo).
 *
 * Modelo de datos único: cada fix GPS se INSERTA en `posiciones`. Eso cumple dos
 * funciones a la vez:
 *   1) Deja el RASTRO de la jornada (breadcrumbs) para reproducir el recorrido.
 *   2) Vía Realtime (postgres_changes) el Admin recibe la posición en vivo.
 * El aislamiento por empresa lo garantiza RLS (el Admin solo ve su tenant).
 *
 * Las alertas (GPS on/off) son efímeras → canal broadcast por empresa.
 * La misma API (publicarPosicion / suscribirPosiciones / publicarAlerta /
 * suscribirAlertas / estadoConexion) que exponía services/telemetry, para no
 * tocar las vistas más de lo necesario.
 */

// ---------- Posiciones: vivo + persistencia ----------

/** Publica/persiste una posición. payload: {id, rol, lat, lng, accuracy?, idEmpresa} */
export async function publicarPosicion({ id, rol, lat, lng, accuracy, idEmpresa }) {
  if (!hasSupabase || !id || !idEmpresa) return
  const row = { id_usuario: id, rol, lat, lng, id_empresa: idEmpresa }
  if (typeof accuracy === 'number') row.accuracy = accuracy
  const { error } = await supabase.from('posiciones').insert(row)
  if (error) console.warn('[realtime] publicarPosicion:', error.message)
}

/**
 * Se suscribe a las posiciones entrantes (para el Admin). RLS filtra por empresa.
 * handler recibe {id_usuario, rol, lat, lng, ts, id_empresa}. Devuelve baja.
 */
export function suscribirPosiciones(handler) {
  if (!hasSupabase) return () => {}
  const ch = supabase
    .channel('rt-posiciones')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'posiciones' }, (payload) => {
      if (payload?.new) handler(payload.new)
    })
    .subscribe()
  return () => supabase.removeChannel(ch)
}

/**
 * Historial de posiciones de un usuario en el rango [desdeISO, hastaISO],
 * ordenado cronológicamente, para reproducir el recorrido de la jornada.
 */
export async function historialPosiciones(idUsuario, desdeISO, hastaISO) {
  if (!hasSupabase || !idUsuario) return []
  const { data, error } = await supabase
    .from('posiciones')
    .select('lat,lng,ts')
    .eq('id_usuario', idUsuario)
    .gte('ts', desdeISO)
    .lte('ts', hastaISO)
    .order('ts', { ascending: true })
  if (error) { console.warn('[realtime] historialPosiciones:', error.message); return [] }
  return data || []
}

// ---------- Alertas efímeras (GPS on/off) por empresa ----------

const alertChannels = new Map() // idEmpresa -> channel (para publicar)

function canalAlertas(idEmpresa) {
  const key = idEmpresa || 'sin-empresa'
  let ch = alertChannels.get(key)
  if (!ch) {
    ch = supabase.channel('alertas-' + key)
    ch.subscribe()
    alertChannels.set(key, ch)
  }
  return ch
}

/** Publica una alerta. payload: {id, nombre, rol, tipo:'gps-off'|'gps-on', idEmpresa, ts} */
export function publicarAlerta(payload) {
  if (!hasSupabase) return
  canalAlertas(payload.idEmpresa).send({ type: 'broadcast', event: 'alerta', payload })
}

/** Se suscribe a las alertas de una empresa (para el Admin). Devuelve baja. */
export function suscribirAlertas(handler, idEmpresa) {
  if (!hasSupabase) return () => {}
  const key = idEmpresa || 'sin-empresa'
  const ch = supabase
    .channel('alertas-sub-' + key)
    .on('broadcast', { event: 'alerta' }, ({ payload }) => handler(payload))
    .subscribe()
  return () => supabase.removeChannel(ch)
}

/** Estado de conexión del tiempo real. Supabase reconecta el socket solo. */
export function estadoConexion(cb) {
  if (!hasSupabase) { cb(false); return () => {} }
  cb(true)
  return () => {}
}
