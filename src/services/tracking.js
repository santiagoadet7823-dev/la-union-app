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
  const { data } = await supabase.from('app_config').select('track_enabled, track_start, track_end, track_days').maybeSingle()
  cache = {
    enabled: data?.track_enabled ?? true,
    start: data?.track_start || '07:30',
    end: data?.track_end || '22:00',
    // Días activos (1=Lun … 7=Dom). null/vacío = todos los días (retrocompatible).
    days: Array.isArray(data?.track_days) && data.track_days.length ? data.track_days : null,
  }
  cacheAt = Date.now()
  return cache
}

export function invalidarTrackCache() { cache = null }

/** ¿La hora (y el día) actuales caen dentro de la ventana de rastreo? */
export function dentroDeHorario(cfg) {
  if (!cfg) return true
  if (cfg.enabled === false) return false
  const now = new Date()
  // Día de la semana en HORA LOCAL (regla 23: nunca UTC — el día también cambia con el offset −3).
  // getDay(): 0=Dom … 6=Sáb → ISO 1=Lun … 7=Dom. Si hay lista de días y hoy no está, no se rastrea.
  if (cfg.days && cfg.days.length) {
    const iso = now.getDay() === 0 ? 7 : now.getDay()
    if (!cfg.days.includes(iso)) return false
  }
  const cur = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = String(cfg.start || '00:00').split(':').map(Number)
  const [eh, em] = String(cfg.end || '23:59').split(':').map(Number)
  const start = sh * 60 + sm
  const end = eh * 60 + em
  return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end
}
