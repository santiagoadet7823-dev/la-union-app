import { supabase, hasSupabase } from './supabase'

/**
 * Ventana horaria de rastreo. Fuera de ese horario NO se publican posiciones, para no
 * saturar el backend si alguien deja la app abierta.
 *
 * Dos niveles (Feature D, 1.6.x):
 *   1. GLOBAL (app_config) — lo controla el superadmin, aplica a toda la operación.
 *   2. POR USUARIO (categorias_rastreo vía perfiles.id_categoria_rastreo) — si el usuario
 *      tiene una categoría asignada, su ventana MANDA sobre la global (ej. un vendedor que
 *      trabaja Ma/Ju 18:00–24:00). Si no tiene, cae al global (retrocompatible).
 *
 * `dentroDeHorario` ya soporta días y cruce de medianoche, así que 'hora_fin' = '24:00'
 * (o '00:00') funciona sin cambios. Cacheado unos minutos por usuario.
 */
let gCache = null
let gCacheAt = 0
const uCache = new Map() // userId → { cfg, at }
const TTL = 4 * 60000

async function cfgGlobal(force = false) {
  if (!force && gCache && Date.now() - gCacheAt < TTL) return gCache
  if (!hasSupabase) return { enabled: true, start: '00:00', end: '23:59', days: null }
  const { data } = await supabase.from('app_config').select('track_enabled, track_start, track_end, track_days').maybeSingle()
  gCache = {
    enabled: data?.track_enabled ?? true,
    start: data?.track_start || '07:30',
    end: data?.track_end || '22:00',
    // Días activos (1=Lun … 7=Dom). null/vacío = todos los días (retrocompatible).
    days: Array.isArray(data?.track_days) && data.track_days.length ? data.track_days : null,
  }
  gCacheAt = Date.now()
  return gCache
}

// Override por usuario: lee su categoría de rastreo (si tiene una activa). null → sin override.
async function cfgOverride(userId) {
  if (!hasSupabase || !userId) return null
  const { data } = await supabase
    .from('perfiles')
    .select('categorias_rastreo(dias, hora_inicio, hora_fin, activo)')
    .eq('id', userId).maybeSingle()
  const cat = data?.categorias_rastreo
  if (!cat || cat.activo === false) return null
  return {
    enabled: true,
    start: cat.hora_inicio || '07:30',
    end: cat.hora_fin || '22:00',
    days: Array.isArray(cat.dias) && cat.dias.length ? cat.dias : null,
  }
}

/**
 * Ventana efectiva de rastreo. Con `userId`, aplica el override por categoría si existe;
 * sin él (o sin categoría), devuelve el horario global.
 */
export async function getTrackConfig(userId = null, force = false) {
  if (userId) {
    const c = uCache.get(userId)
    if (!force && c && Date.now() - c.at < TTL) return c.cfg
    let cfg = null
    try { cfg = await cfgOverride(userId) } catch (_) {}
    if (!cfg) cfg = await cfgGlobal(force)
    uCache.set(userId, { cfg, at: Date.now() })
    return cfg
  }
  return cfgGlobal(force)
}

export function invalidarTrackCache() { gCache = null; uCache.clear() }

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
