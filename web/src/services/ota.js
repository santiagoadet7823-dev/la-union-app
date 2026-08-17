import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { getAppConfig } from './data/appConfig'

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
  if (!Capacitor.isNativePlatform()) return null
  try {
    const data = await getAppConfig()
    if (!data?.bundle_version || !data?.bundle_url) return null
    let currentVersion = 'builtin'
    try { currentVersion = (await CapacitorUpdater.current())?.bundle?.version || 'builtin' } catch (_) {}
    if (data.bundle_version === currentVersion) return null
    return { version: data.bundle_version, url: data.bundle_url }
  } catch (_) { return null }
}

// Descarga el bundle nuevo y lo DEJA LISTO para el próximo reinicio (next). No
// recarga acá: así podemos mostrar "listo → reiniciar" y aplicar con otaReload().
export async function otaDownload({ version, url }) {
  const bundle = await CapacitorUpdater.download({ url, version })
  if (!bundle?.id) throw new Error('La descarga no devolvió el paquete.')
  await CapacitorUpdater.next({ id: bundle.id })
  return bundle
}

// Aplica el bundle encolado y reinicia la app con el contenido nuevo.
export async function otaReload() {
  await CapacitorUpdater.reload()
}
