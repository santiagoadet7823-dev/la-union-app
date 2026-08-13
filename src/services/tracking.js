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
// Último `gps_perfil` conocido por usuario. Es la red de contención para el caso sin red — ver
// `cfgGps`, abajo.
const ultimoGps = new Map() // userId → gps_perfil crudo (o null)

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
 * Perfil de GPS del usuario (`perfiles.gps_perfil`, db/39). null = automático, que es lo que tiene
 * todo el mundo por defecto. Viaja como `cfg.gps` hasta `uploaderNativo`, que lo traduce a
 * parámetros con `services/gpsPerfil.js` — acá NO se interpreta, solo se transporta.
 *
 * Se lee acá y no del `perfil` de AuthContext a propósito: este camino ya tiene refresco periódico
 * (TTL de 4 min desde usePublishPosition) e invalidación desde el panel (`invalidarTrackCache`, que
 * UsuariosView ya llama al guardar). Colgado de `perfil`, un cambio del superadmin habría tardado
 * hasta el próximo `cargarPerfil`, que no tiene periodicidad.
 *
 * 🩸 SI LA CONSULTA FALLA, SE CONSERVA EL ÚLTIMO VALOR CONOCIDO — no se cae a "automático". La
 * diferencia importa justo cuando importa: un corte de datos a media mañana revertiría en silencio
 * la prueba de esa persona, y la medición del día quedaría contaminada sin que nadie se entere. Un
 * `null` que SÍ vino de la base sí se honra: así sacar el override desde el panel llega al teléfono.
 */
async function cfgGps(userId) {
  if (!hasSupabase || !userId) return null
  try {
    const { data, error } = await supabase.from('perfiles').select('gps_perfil').eq('id', userId).maybeSingle()
    if (error) throw error
    const gps = data?.gps_perfil ?? null
    ultimoGps.set(userId, gps)
    return gps
  } catch (_) {
    return ultimoGps.has(userId) ? ultimoGps.get(userId) : null
  }
}

/**
 * Ventana efectiva de rastreo. Con `userId`, aplica el override por categoría si existe;
 * sin él (o sin categoría), devuelve el horario global. Adosa además el perfil de GPS en `cfg.gps`.
 */
export async function getTrackConfig(userId = null, force = false) {
  if (userId) {
    const c = uCache.get(userId)
    if (!force && c && Date.now() - c.at < TTL) return c.cfg
    let cfg = null
    try { cfg = await cfgOverride(userId) } catch (_) {}
    if (!cfg) cfg = await cfgGlobal(force)
    // El perfil de GPS es ORTOGONAL a la ventana horaria, así que se resuelve aparte y se adosa al
    // final: adentro de `cfgOverride` se perdería para todos los que no tienen categoría de rastreo
    // propia, que son la mayoría — y son justo las cuatro personas de la prueba.
    //
    // ⚠️ El spread NO es cosmético: `cfgGlobal` devuelve el objeto `gCache` COMPARTIDO. Escribirle
    // `cfg.gps = …` encima le pegaría el perfil de una persona a todas las demás que caigan al
    // horario global.
    cfg = { ...cfg, gps: await cfgGps(userId) }
    uCache.set(userId, { cfg, at: Date.now() })
    return cfg
  }
  return cfgGlobal(force)
}

// `ultimoGps` NO se limpia acá a propósito: no es una caché de lectura sino el respaldo para cuando
// la consulta falla. Vaciarlo dejaría a un teléfono sin red cayendo a "automático" justo después de
// una invalidación, que es lo que `cfgGps` existe para evitar. La próxima lectura exitosa lo pisa.
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

/**
 * A qué hora tendría que haber ARRANCADO el rastreo de esta persona un día dado: el `start` más
 * temprano entre las ventanas que aplican a ese día de la semana. Devuelve minutos del día, o null
 * si ese día no se rastrea (o no hay config).
 *
 * 🩸 VIVE ACÁ Y NO EN EL REPORTE, y no es una preferencia de organización. La regla 36 dice que la
 * ventana de rastreo ya está implementada TRES veces —esta, `VentanaRastreo.java` y `en_ventana` en
 * SQL— y que nada las sincroniza: escribir el filtro de días una cuarta vez, dentro de una pantalla
 * de reportes, sería agregar un lugar más donde puede divergir en silencio. Acá reusa el MISMO
 * `v.days` y el mismo `aMinutosDelDia` que `enVentana`, así que si alguien cambia la semántica de
 * los días, esto cambia con ella.
 *
 * Se usa para medir el retraso de arranque, que es el problema de campo mejor documentado del
 * proyecto: mediana de 51 min sobre 29 días hábiles, 79 % de los días con más de 15 min.
 *
 * @param {object} cfg lo que devuelve getTrackConfig
 * @param {Date} fecha el día a evaluar (se usa solo su día de la semana, en hora local)
 */
export function inicioProgramado(cfg, fecha) {
  if (!cfg || cfg.enabled === false) return null
  const ventanas = cfg.ventanas && cfg.ventanas.length ? cfg.ventanas : [cfg]
  const iso = fecha.getDay() === 0 ? 7 : fecha.getDay()
  let mejor = null
  for (const v of ventanas) {
    if (v.days && v.days.length && !v.days.includes(iso)) continue
    const m = aMinutosDelDia(v.start, 0)
    if (mejor == null || m < mejor) mejor = m
  }
  return mejor
}
