import { supabase } from '../supabase'
import { persistence } from '../persistence'

/**
 * Capa de datos del perfil del usuario (multi-tenant). Aísla la query a Supabase, el
 * timeout/reintentos y la caché local, para que AuthContext solo orqueste estado.
 * La caché permite que el Gate deje pasar (y el GPS arranque) al reabrir sin señal.
 */
const perfilCacheKey = (userId) => `lu-perfil-cache-${userId}`

export async function leerCachePerfil(userId) {
  if (!userId) return null
  return await persistence.get(perfilCacheKey(userId))
}

export function escribirCachePerfil(userId, perfil) {
  if (userId && perfil) persistence.set(perfilCacheKey(userId), perfil)
}

export function borrarCachePerfil(userId) {
  if (userId) persistence.remove(perfilCacheKey(userId))
}

/**
 * Trae el perfil con timeout + reintentos, sin colgar la app. Devuelve { data } (la
 * fila o null). Lanza tras agotar los reintentos (para que el llamador decida si hay
 * caché con la que seguir).
 */
export async function fetchPerfil(userId, { intentos = 3, timeoutMs = 8000 } = {}) {
  let lastErr = null
  for (let i = 0; i < intentos; i++) {
    try {
      const { data } = await Promise.race([
        supabase.from('perfiles').select('*').eq('id', userId).maybeSingle(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs)),
      ])
      return { data }
    } catch (e) {
      lastErr = e
      if (i < intentos - 1) await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastErr || new Error('perfil no disponible')
}
