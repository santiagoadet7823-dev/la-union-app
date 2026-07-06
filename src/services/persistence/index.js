/**
 * Puerto de persistencia. Aísla al resto de la app de DÓNDE se guardan los datos.
 * - Web / PWA:  localStorage (síncrono, suficiente para el volumen de una jornada).
 * - Nativo:     SQLite (@capacitor-community/sqlite) — ver nota de integración.
 *
 * La API es async a propósito para que migrar a SQLite no cambie los llamadores.
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
      /* cuota llena / modo privado: se ignora en la demo */
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

/*
 * INTEGRACIÓN NATIVA (fase Capacitor):
 * Implementar `nativeStore` con @capacitor-community/sqlite creando una tabla
 * clave-valor (o tablas relacionales pedidos/items) y exponiendo la misma API
 * { get, set, remove }. Mientras tanto, en nativo también usamos webStore como
 * fallback funcional (WebView expone localStorage).
 */
const store = isNative() ? webStore : webStore

export const persistence = store
export default store
