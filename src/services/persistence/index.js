/**
 * Puerto de persistencia. Aísla al resto de la app de DÓNDE se guardan los datos.
 * - Web / PWA:  localStorage (síncrono envuelto en promesa).
 * - Nativo (APK): SQLite (@capacitor-community/sqlite), tabla clave-valor.
 *
 * La API es async a propósito: los llamadores (cola GPS, cola de escrituras, caché
 * de perfil) no cambian según el backend. El store nativo tiene FALLBACK a
 * localStorage si SQLite no inicializa, para no romper la app nunca.
 */
import { isNative } from '../platform'

const webStore = {
  async get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return fallback
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* cuota llena / modo privado */
    }
  },
  async remove(key) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* noop */
    }
  },
}

// --- Store nativo (SQLite) con init perezosa y fallback a webStore ---
let sqlite = null
let nativeReady = null
// Si un paso de SQLite se CUELGA (no tira error), el await nunca vuelve y la cola GPS queda
// trabada para siempre (no encola ni sube). El timeout fuerza el fallback a localStorage.
const conTimeout = (p, ms, etiqueta) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${etiqueta}`)), ms))])
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
const nativeStore = {
  async get(key, fallback = null) {
    if (!(await initNative())) return webStore.get(key, fallback)
    try {
      const res = await conTimeout(sqlite.query('SELECT v FROM kv WHERE k = ?;', [key]), 5000, 'query')
      const raw = res?.values?.[0]?.v
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return webStore.get(key, fallback)
    }
  },
  async set(key, value) {
    if (!(await initNative())) return webStore.set(key, value)
    try {
      await conTimeout(sqlite.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?);', [key, JSON.stringify(value)]), 5000, 'run-set')
    } catch {
      return webStore.set(key, value)
    }
  },
  async remove(key) {
    if (!(await initNative())) return webStore.remove(key)
    try {
      await conTimeout(sqlite.run('DELETE FROM kv WHERE k = ?;', [key]), 5000, 'run-remove')
    } catch {
      return webStore.remove(key)
    }
  },
}

const store = isNative() ? nativeStore : webStore

export const persistence = store
export default store
