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

/**
 * Override por usuario: sus categorías de rastreo activas. null → sin override (horario global).
 *
 * Desde 1.8.0 pueden ser VARIAS (tabla puente `perfiles_categorias_rastreo`), con semántica de
 * UNIÓN: se rastrea si CUALQUIERA aplica. Eso es lo que habilita la jornada partida — 8-12 y 16-20,
 * sin rastreo entre medio —, que con una sola ventana obligaba a elegir entre rastrear el almuerzo
 * o perder la tarde.
 *
 * FORMA DEL RESULTADO: se mantiene `{enabled, start, end, days}` de la PRIMERA ventana, además de
 * `ventanas: [...]` con todas. Es a propósito: media docena de consumidores (el uploader nativo, el
 * cálculo del próximo borde, updateNotify) leen `start`/`end` directo, y cambiarles la forma de
 * golpe habría sido tocar todo el pipeline de GPS por una feature de horarios. Los que entienden
 * `ventanas` usan la unión; los que no, siguen viendo una ventana válida.
 */
async function cfgOverride(userId) {
  if (!hasSupabase || !userId) return null
  const { data } = await supabase
    .from('perfiles_categorias_rastreo')
    .select('categorias_rastreo(dias, hora_inicio, hora_fin, activo)')
    .eq('id_usuario', userId)
  const cats = (data || [])
    .map((f) => f.categorias_rastreo)
    .filter((c) => c && c.activo !== false)
  if (!cats.length) return null
  const ventanas = cats.map((cat) => ({
    start: cat.hora_inicio || '07:30',
    end: cat.hora_fin || '22:00',
    // `days` vacío = TODOS los días (no hereda los del global). Ojo: el espejo SQL hacía lo
    // contrario y esa divergencia se corrigió junto con esto — ver db/27.
    days: Array.isArray(cat.dias) && cat.dias.length ? cat.dias : null,
  }))
  // Orden estable por hora de inicio: así `start`/`end` (la ventana de compatibilidad) es siempre
  // la primera del día y no la que devolvió la base por casualidad.
  ventanas.sort((a, b) => String(a.start).localeCompare(String(b.start)))
  return {
    // Una categoría activa IGNORA el `track_enabled` global a propósito (comportamiento de siempre,
    // documentado en db/26 §: si al superadmin se le apaga el rastreo general, quien tiene horario
    // propio lo conserva).
    enabled: true,
    start: ventanas[0].start,
    end: ventanas[0].end,
    days: ventanas[0].days,
    ventanas,
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

/** 'HH:MM' → minuto del día. */
export function aMinutosDelDia(hhmm, porDefecto = 0) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''))
  if (!m) return porDefecto
  return Number(m[1]) * 60 + Number(m[2])
}

/** ¿`ahora` cae dentro de UNA ventana `{start, end, days}`? */
function enVentana(v, ahora) {
  // Día de la semana en HORA LOCAL (regla 23: nunca UTC — el día también cambia con el offset −3).
  // getDay(): 0=Dom … 6=Sáb → ISO 1=Lun … 7=Dom. Si hay lista de días y hoy no está, no se rastrea.
  if (v.days && v.days.length) {
    const iso = ahora.getDay() === 0 ? 7 : ahora.getDay()
    if (!v.days.includes(iso)) return false
  }
  const cur = ahora.getHours() * 60 + ahora.getMinutes()
  const start = aMinutosDelDia(v.start, 0)
  const end = aMinutosDelDia(v.end, 23 * 60 + 59)
  // start > end = ventana que cruza la medianoche ('22:00'–'06:00').
  return start <= end ? cur >= start && cur <= end : cur >= start || cur <= end
}

/**
 * ¿La hora (y el día) actuales caen dentro de la ventana de rastreo?
 *
 * Con varias ventanas (categorías múltiples) la semántica es de UNIÓN: alcanza con que UNA aplique.
 * Es lo que permite una jornada partida sin rastrear el hueco del mediodía.
 */
export function dentroDeHorario(cfg) {
  if (!cfg) return true
  if (cfg.enabled === false) return false
  const now = new Date()
  const ventanas = cfg.ventanas && cfg.ventanas.length ? cfg.ventanas : [cfg]
  return ventanas.some((v) => enVentana(v, now))
}
