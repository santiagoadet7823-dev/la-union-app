import { supabase, hasSupabase } from '../supabase'

/**
 * Config global de la app (fila única en `app_config`): versión OTA + ventana de
 * rastreo. Punto único de lectura para OTA (services/ota) y el horario de tracking.
 */
export async function getAppConfig() {
  if (!hasSupabase) return null
  const { data } = await supabase.from('app_config').select('*').maybeSingle()
  return data || null
}
