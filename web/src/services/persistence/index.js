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

// Las operaciones también van con timeout: si el query/run se cuelga (no solo la init),
// caemos a localStorage en vez de dejar el await colgado (lo que trababa la cola GPS y, al
// leerla desde el latido de estado, podía colgar también la telemetría).
const nativeStoreRaw = {
  async get(key) {
    if (!(await initNative())) return webStoreRaw.get(key)
    try {
      const res = await conTimeout(sqlite.query('SELECT v FROM kv WHERE k = ?;', [key]), 5000, 'query')
      return res?.values?.[0]?.v ?? null
    } catch {
      return webStoreRaw.get(key)
    }
  },
  async set(key, raw) {
    if (!(await initNative())) return webStoreRaw.set(key, raw)
    try {
      await conTimeout(sqlite.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?);', [key, raw]), 5000, 'run-set')
      return true
    } catch {
      return webStoreRaw.set(key, raw)
    }
  },
  async remove(key) {
    if (!(await initNative())) return webStoreRaw.remove(key)
    try {
      await conTimeout(sqlite.run('DELETE FROM kv WHERE k = ?;', [key]), 5000, 'run-remove')
    } catch {
      return webStoreRaw.remove(key)
    }
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
