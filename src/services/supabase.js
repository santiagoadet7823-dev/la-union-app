import { createClient } from '@supabase/supabase-js'

/**
 * Cliente único de Supabase (backend de producción: datos, realtime, auth, storage).
 * Config desde variables de entorno (ver .env.example).
 */
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const hasSupabase = Boolean(url && anonKey)

if (!hasSupabase) {
  // No rompemos el build; las vistas muestran aviso si falta configuración.
  console.warn('[supabase] Falta VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en .env.local')
}

export const supabase = hasSupabase
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null

export default supabase
