/**
 * Puerto de persistencia. Aísla al resto de la app de DÓNDE se guardan los datos.
 * - Web / PWA:  localStorage (síncrono envuelto en promesa).
 * - Nativo (APK): SQLite (@capacitor-community/sqlite), tabla clave-valor.
 *
 * La API es async a propósito: los llamadores (cola GPS, cola de escrituras, caché
 * de perfil) no cambian según el backend. El store nativo tiene FALLBACK a
 * localStorage si SQLite no inicializa, para no romper la app nunca.
 *
 * Dos capas sobre el mismo backend:
 *   - `persistence.get/set/remove` — con JSON.stringify/parse, para guardar objetos (lo que usa
 *     casi todo el mundo: cachés, colas, el espejo de sesión).
 *   - `persistence.raw.get/set/remove` — strings tal cual entran y salen, SIN tocarlos. Existe para
 *     `services/supabase.js` (el storage de auth-js, Tarea 2.2.D, 29/09/2026): auth-js ya serializa
 *     la sesión a JSON él mismo y espera un `Storage` de verdad (string | null) — envolverlo con la
 *     capa de JSON de arriba le daría una SEGUNDA vuelta de stringify/parse que además rompería la
 *     migración: una sesión ya guardada en `localStorage` de una versión anterior (raw, sin envolver)
 *     se leería con un `JSON.parse` de más y volvería como OBJETO en vez de STRING.
 */
import { isNative } from '../platform'
import { conTimeout } from '../../lib/conTimeout'

/**
 * 🔴 LAS CACHÉS SE DESALOJAN ANTES QUE PERDER UNA ESCRITURA (18/09/2026).
 *
 * `localStorage` tiene ~5 MB por origen, y en la PWA acá viven la caché del catálogo (1,3 MB con
 * 2.000 clientes), la de recorridos del monitoreo (crece TODO el día: ~1 MB a la tarde) y la cola
 * de escrituras. El 18/09 la PC de la oficina se llenó a media mañana: `setItem` tiró
 * QuotaExceededError, este `catch` lo tragaba, y **cada zona y cada vendedor que se asignó desde
 * las 11:25 se vio en pantalla y no llegó nunca a la base** — la cola no pudo ni anotar la
 * mutación. Cero requests, cero errores en los logs: el peor modo de falla.
 *
 * Orden de prioridad, explícito: una escritura pendiente vale más que cualquier caché, porque la
 * caché se rehace de la red y la escritura no se rehace de ningún lado. Si no entra, se tiran las
 * cachés (de la más prescindible a la menos) y se reintenta. Si aun así no entra, se avisa fuerte
 * y se devuelve `false` para que el llamador NO crea que guardó.
 */
const CACHES_DESALOJABLES = ['lu-recorridos-cache', /^lu-catalogo-cache-/]
// Marca de "esta clave la tiene localStorage" del store nativo (ver el 🩸 de `nativeStoreRaw`).
const MARCA = '__lu_fb:'

export function desalojarCaches(exceptoKey) {
  let liberado = 0
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (!k || k === exceptoKey) continue
      const cache = CACHES_DESALOJABLES.some((p) => (p instanceof RegExp ? p.test(k) : p === k))
      if (!cache) continue
      liberado += (localStorage.getItem(k) || '').length
      localStorage.removeItem(k)
      // Y su marca de fallback (02/10/2026, revisión): sin el valor, la marca sola es una lápida y
      // `get` devolvería null aunque SQLite tenga el dato (catálogo/cartera sin red). Desalojar es
      // "esta copia no hace falta", no "la clave está borrada".
      localStorage.removeItem(MARCA + k)
    }
  } catch { /* nada que liberar */ }
  return liberado
}

// ─────────────────────────────────────────────────────────────────────────────
// Primitivos RAW: strings tal cual, sin JSON. Acá vive TODA la lógica de fallback
// (SQLite → localStorage) y de "si no entra, desalojar cachés y reintentar" — una sola vez.
// ─────────────────────────────────────────────────────────────────────────────
const webStoreRaw = {
  async get(key) {
    try { return localStorage.getItem(key) } catch { return null }
  },
  async set(key, raw) {
    try {
      localStorage.setItem(key, raw)
      return true
    } catch (e) {
      // Una caché que no entra no se pelea por el lugar: se descarta y listo (se rehace de la red).
      const esCache = CACHES_DESALOJABLES.some((p) => (p instanceof RegExp ? p.test(key) : p === key))
      if (esCache) { console.warn('[persistence] caché descartada por falta de espacio:', key, Math.round(raw.length / 1024), 'KB'); return false }
      const liberado = desalojarCaches(key)
      try {
        localStorage.setItem(key, raw)
        console.warn('[persistence] almacenamiento lleno: se desalojaron', Math.round(liberado / 1024), 'KB de caché para guardar', key)
        return true
      } catch (e2) {
        console.error('[persistence] NO SE PUDO GUARDAR', key, '· almacenamiento lleno o bloqueado:', e2?.message || e?.message)
        return false
      }
    }
  },
  async remove(key) {
    try { localStorage.removeItem(key) } catch { /* noop */ }
  },
}

// --- Store nativo (SQLite) con init perezosa y fallback a webStoreRaw ---
let sqlite = null
let nativeReady = null
// Si un paso de SQLite se CUELGA (no tira error), el await nunca vuelve y la cola GPS queda
// trabada para siempre (no encola ni sube). El timeout fuerza el fallback a localStorage.
function initNative() {
  if (nativeReady) return nativeReady
  nativeReady = (async () => {
    try {
      const mod = await import('@capacitor-community/sqlite')
      const conn = new mod.SQLiteConnection(mod.CapacitorSQLite)
      const db = await conTimeout(conn.createConnection('launion', false, 'no-encryption', 1, false), 5000, 'createConnection')
      await conTimeout(db.open(), 5000, 'open')
      await conTimeout(db.execute('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);'), 5000, 'createTable')
      sqlite = db
      return true
    } catch (e) {
      console.warn('[persistence] SQLite no disponible; se usa localStorage. Motivo:', e?.message || e)
      return false
    }
  })()
  return nativeReady
}

/**
 * 🩸 UNA CLAVE NUNCA QUEDA PARTIDA ENTRE SQLITE Y LOCALSTORAGE (02/10/2026).
 *
 * Hasta 1.44.0 el fallback era POR OPERACIÓN y sin memoria: cada get/set/remove probaba SQLite y,
 * si tiraba o pasaba los 5 s, hacía ESA operación en localStorage y se olvidaba. Así una misma
 * clave podía tener un valor en cada lado, y cuál se leía dependía de si la PRÓXIMA operación de
 * SQLite andaba o no. Con la sesión de Supabase (`services/supabase.js` guarda acá su token) eso es
 * un agujero de seguridad, no un detalle:
 *   - login de A cuyo `set` cae a localStorage (SQLite ocupado: la cola GPS, el catálogo de 1,3 MB)
 *     → A queda en localStorage;
 *   - "Cerrar sesión" de A: el `remove` en SQLite ANDA → se borra SQLite… y la copia de
 *     localStorage queda viva;
 *   - login de B: `set` en SQLite → B en SQLite;
 *   - la próxima lectura que se demore o falle en SQLite devolvía la copia de localStorage: la
 *     SESIÓN DE A, con su access token todavía vigente.
 * supabase-js relee el storage solo (tick de auto-refresh cada 30 s, `_recoverAndRefresh` cada vez
 * que el WebView vuelve a primer plano — el selector de cuentas de Google, un diálogo de permisos
 * de GPS…) y, si encuentra una sesión válida, emite SIGNED_IN con ELLA.
 *
 * 🩸 Incidente del 02/10/2026 (motorola edge 30 neo, APK 1.44.0): cerrar sesión del superadmin →
 * entrar con Google con otra cuenta → cambiar de vista ("Ir a mi jornada", arranca el GPS y la cola
 * en SQLite) → el próximo "Cerrar sesión", 2 min después, salió con el token del SUPERADMIN. El
 * teléfono había vuelto solo a la cuenta anterior, sin ningún login de por medio.
 *
 * La regla ahora: una clave vive en SQLite, SALVO que tenga la marca `__lu_fb:<clave>` en
 * localStorage; con la marca, lo que manda es localStorage (y si ahí no hay valor, la clave está
 * BORRADA — la marca sola es una lápida).
 *   - `set` que cae a localStorage → escribe el valor Y la marca.
 *   - `set` que anda en SQLite → borra la copia de localStorage y la marca.
 *   - `remove` → borra de LOS DOS lados siempre; si el DELETE de SQLite no confirma, deja la lápida.
 *   - `get` con marca → localStorage. Sin marca → SQLite, y si SQLite falla devuelve `null`: un
 *     valor de localStorage sin marca es por definición viejo (de antes de SQLite, de un fallback de
 *     antes de este arreglo, o la sesión pre-migración de la Tarea 2.2.D) y NO se resucita.
 * Los timeouts siguen (nada se cuelga: la cola GPS depende de eso). Lo que se agrega es memoria de
 * QUÉ lado tiene la verdad.
 *
 * ⚠️ Un `conTimeout` vencido NO cancela la operación de SQLite: puede aterrizar DESPUÉS, y una
 * escritura vieja aterrizando tarde pisaría a una nueva. Dos registros por clave lo cubren:
 *   - `enVuelo`: escrituras en SQLite que todavía no terminaron DE VERDAD (desde que salen hasta que
 *     el plugin contesta, con techo o sin él). Un `set` exitoso con otra escritura de la misma clave
 *     todavía en vuelo NO levanta la marca: guarda también en localStorage, que sigue mandando.
 *   - `ultima`: la última escritura iniciada. Sólo ELLA decide la marca y la copia local cuando
 *     termina; una más vieja que vuelve tarde (o cae al fallback tarde) no toca nada.
 */
const enVuelo = new Map()
const ultima = new Map()
let secuencia = 0

const tieneMarca = (key) => {
  try { return localStorage.getItem(MARCA + key) !== null } catch { return false }
}
const ponerMarca = (key) => {
  try { localStorage.setItem(MARCA + key, '1'); return true } catch { return false }
}
const sacarMarca = (key) => {
  try { localStorage.removeItem(MARCA + key) } catch { /* noop */ }
}
const borrarCopiaLocal = (key) => {
  try { localStorage.removeItem(key) } catch { /* noop */ }
}

/** Guarda en localStorage como dueño de la clave (valor + marca). `false` si no entró. */
async function guardarEnRespaldo(key, raw) {
  const ok = await webStoreRaw.set(key, raw)
  if (!ok) {
    // 🩸 No entró en ninguno de los dos lados (02/10/2026, revisión). Si quedaban la marca y una copia
    // vieja de un fallback anterior, `get` devolvería ESE valor para siempre, aunque la escritura
    // vencida aterrice después en SQLite. Se suelta localStorage y manda SQLite.
    borrarCopiaLocal(key)
    sacarMarca(key)
    return false
  }
  if (!ponerMarca(key)) {
    // Sin marca, la copia quedaría huérfana (y vieja la próxima vez): mejor no dejarla.
    borrarCopiaLocal(key)
    return false
  }
  return true
}

/** Una ESCRITURA en SQLite con techo de 5 s, anotada en `enVuelo` hasta que termine de verdad. */
async function escribirSqlite(key, promesa, etiqueta) {
  enVuelo.set(key, (enVuelo.get(key) || 0) + 1)
  // Se registra ANTES que el `conTimeout`: cuando la operación termina, este descuento corre
  // primero, así que al volver del `await` de abajo la propia escritura ya no cuenta.
  const descontar = () => {
    const n = (enVuelo.get(key) || 1) - 1
    if (n > 0) enVuelo.set(key, n); else enVuelo.delete(key)
  }
  promesa.then(descontar, descontar)
  return conTimeout(promesa, 5000, etiqueta)
}

// Las operaciones también van con timeout: si el query/run se cuelga (no solo la init),
// caemos a localStorage en vez de dejar el await colgado (lo que trababa la cola GPS y, al
// leerla desde el latido de estado, podía colgar también la telemetría).
const nativeStoreRaw = {
  async get(key) {
    // Sin SQLite en esta corrida, localStorage es el único lugar: se lee tal cual (como siempre).
    if (!(await initNative())) return webStoreRaw.get(key)
    if (tieneMarca(key)) return webStoreRaw.get(key)
    try {
      const res = await conTimeout(sqlite.query('SELECT v FROM kv WHERE k = ?;', [key]), 5000, 'query')
      return res?.values?.[0]?.v ?? null
    } catch (e) {
      console.warn('[persistence] no se pudo leer', key, 'de SQLite:', e?.message || e)
      return null
    }
  },
  async set(key, raw) {
    // Sin SQLite, se guarda CON marca: si en la próxima corrida SQLite sí arranca, la fila vieja que
    // tenga no le gana a este valor.
    if (!(await initNative())) return guardarEnRespaldo(key, raw)
    const mia = ++secuencia
    ultima.set(key, mia)
    let enSqlite = true
    try {
      await escribirSqlite(key, sqlite.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?);', [key, raw]), 'run-set')
    } catch {
      enSqlite = false
    }
    // Ya hay una escritura más nueva de esta clave: ella decide. Este valor quedó viejo.
    if (ultima.get(key) !== mia) return true
    if (enSqlite && !enVuelo.has(key)) {
      borrarCopiaLocal(key)
      sacarMarca(key)
      return true
    }
    // SQLite falló/venció, o hay otra escritura de la clave en vuelo que podría aterrizar después:
    // localStorage manda hasta el próximo set limpio.
    return guardarEnRespaldo(key, raw)
  },
  async remove(key) {
    const mia = ++secuencia
    ultima.set(key, mia)
    // De LOS DOS lados, siempre. La lápida va ANTES del DELETE: mientras SQLite no confirma, un get
    // concurrente ya ve la clave borrada en vez del valor viejo.
    borrarCopiaLocal(key)
    ponerMarca(key)
    if (!(await initNative())) return
    let enSqlite = true
    try {
      await escribirSqlite(key, sqlite.run('DELETE FROM kv WHERE k = ?;', [key]), 'run-remove')
    } catch {
      enSqlite = false
    }
    if (ultima.get(key) !== mia) return
    if (enSqlite && !enVuelo.has(key)) { sacarMarca(key); return }
    // Queda la lápida: SQLite puede seguir teniendo la fila (o recibirla tarde), y no se lee.
    borrarCopiaLocal(key)
    ponerMarca(key)
  },
}

const storeRaw = isNative() ? nativeStoreRaw : webStoreRaw

// ─────────────────────────────────────────────────────────────────────────────
// Capa con JSON, para el resto de la app (objetos: cachés, colas, el espejo de sesión).
// ─────────────────────────────────────────────────────────────────────────────
export const persistence = {
  async get(key, fallback = null) {
    const raw = await storeRaw.get(key)
    if (raw == null) return fallback
    try { return JSON.parse(raw) } catch { return fallback }
  },
  async set(key, value) {
    return storeRaw.set(key, JSON.stringify(value))
  },
  async remove(key) {
    return storeRaw.remove(key)
  },
  /** Sin JSON — ver el comentario de arriba. Lo usa services/supabase.js (storage de auth-js). */
  raw: storeRaw,
}
export default persistence
