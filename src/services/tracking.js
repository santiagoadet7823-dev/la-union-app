import { supabase, hasSupabase } from './supabase'

/**
 * Ventana horaria de rastreo (global, en app_config). Fuera de ese horario NO se
 * publican posiciones, para no saturar el backend si alguien deja la app abierta.
 * Lo controla el superadmin. Cacheado unos minutos.
 */
let cache = null
let cacheAt = 0
const TTL = 4 * 60000

export async function getTrackConfig(force = false) {
  if (!force && cache && Date.now() - cacheAt < TTL) return cache
  if (!hasSupabase) return { enabled: true, start: '00:00', end: '23:59' }
  const { data } = await supabase.from('app_config').select('track_enabled, track_start, track_end').maybeSingle()
  cache = {
    enabled: data?.track_enabled ?? true,
    start: data?.track_start || '07:30',
    end: data?.track_end || '22:00',
  }
  cacheAt = Date.now()
  return cache
}

export function invalidarTrackCache() { cache = null }

/** ¿La hora actual cae dentro de la ventana de rastreo? */
export function dentroDeHorario(cfg) {
  if (!cfg) return true
  if (cfg.enabled === false) return false
  const now = new Date()
  const cur = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = String(cfg.start || '00:00').split(':').map(Number)
  const [eh, em] = String(cfg.end || '23:59').split(':').map(Number)
  const start = sh * 60 + sm
  const end = eh * 60 + em
  return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end
}
