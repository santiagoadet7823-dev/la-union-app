import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { supabase, hasSupabase } from './supabase'

/**
 * Actualización OTA del contenido web (sin reinstalar el APK), con capgo.
 * Modelo self-hosted: el bundle nuevo (zip de `dist`, build CAP_BUILD) se sube a
 * un release y su versión/URL se guardan en `app_config` (Supabase). La app
 * chequea, descarga y aplica; recarga con el contenido nuevo.
 *
 * Los cambios NATIVOS (plugins nuevos) siguen necesitando un APK nuevo; esto cubre
 * el resto (pantallas, features, arreglos), que es la gran mayoría.
 */

// Marca el bundle actual como "bueno" (si no, capgo hace rollback por seguridad).
export async function otaReady() {
  if (!Capacitor.isNativePlatform()) return
  try { await CapacitorUpdater.notifyAppReady() } catch (_) {}
}

// ¿Hay un bundle más nuevo que el aplicado? Devuelve {version, url} o null.
export async function otaCheck() {
  if (!Capacitor.isNativePlatform() || !hasSupabase) return null
  try {
    const { data } = await supabase.from('app_config').select('bundle_version, bundle_url').maybeSingle()
    if (!data?.bundle_version || !data?.bundle_url) return null
    let currentVersion = 'builtin'
    try { currentVersion = (await CapacitorUpdater.current())?.bundle?.version || 'builtin' } catch (_) {}
    if (data.bundle_version === currentVersion) return null
    return { version: data.bundle_version, url: data.bundle_url }
  } catch (_) { return null }
}

// Descarga y aplica el bundle nuevo. `set` recarga la app con el contenido nuevo.
export async function otaApply({ version, url }) {
  const bundle = await CapacitorUpdater.download({ url, version })
  await CapacitorUpdater.set(bundle)
}
