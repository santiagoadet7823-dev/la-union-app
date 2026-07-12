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
function initNative() {
  if (nativeReady) return nativeReady
  nativeReady = (async () => {
    try {
      const mod = await import('@capacitor-community/sqlite')
      const conn = new mod.SQLiteConnection(mod.CapacitorSQLite)
      const db = await conn.createConnection('launion', false, 'no-encryption', 1, false)
      await db.open()
      await db.execute('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);')
      sqlite = db
      return true
    } catch (e) {
      console.warn('[persistence] SQLite no disponible; se usa localStorage. Motivo:', e?.message || e)
      return false
    }
  })()
  return nativeReady
}

const nativeStore = {
  async get(key, fallback = null) {
    if (!(await initNative())) return webStore.get(key, fallback)
    try {
      const res = await sqlite.query('SELECT v FROM kv WHERE k = ?;', [key])
      const raw = res?.values?.[0]?.v
      return raw ? JSON.parse(raw) : fallback
    } catch {
      return webStore.get(key, fallback)
    }
  },
  async set(key, value) {
    if (!(await initNative())) return webStore.set(key, value)
    try {
      await sqlite.run('INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?);', [key, JSON.stringify(value)])
    } catch {
      return webStore.set(key, value)
    }
  },
  async remove(key) {
    if (!(await initNative())) return webStore.remove(key)
    try {
      await sqlite.run('DELETE FROM kv WHERE k = ?;', [key])
    } catch {
      return webStore.remove(key)
    }
  },
}

const store = isNative() ? nativeStore : webStore

export const persistence = store
export default store
