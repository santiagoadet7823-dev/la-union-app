import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import { getAppConfig } from './data/appConfig'
import { persistence } from './persistence'

/**
 * Actualización OTA del contenido web (sin reinstalar el APK), con capgo.
 * Modelo self-hosted: el bundle nuevo (zip de `dist`, build CAP_BUILD) se sube a
 * un release y su versión/URL se guardan en `app_config` (Supabase). La app
 * chequea, descarga y aplica; recarga con el contenido nuevo.
 *
 * Los cambios NATIVOS (plugins nuevos) siguen necesitando un APK nuevo; esto cubre
 * el resto (pantallas, features, arreglos), que es la gran mayoría.
 */

/**
 * 🩸 QUÉ SABE LA APP DE SU PROPIA ACTUALIZACIÓN, Y POR QUÉ HAY QUE CONTARLO (20/08/2026).
 *
 * El 19/08 se publicó 1.19.0 por los tres canales: el bundle quedó arriba y correcto (verificado
 * bajándolo y abriéndolo), `app_config` apuntando a él, y `push-actualizacion` devolvió
 * **12 enviados · 0 fallidos**. Al día siguiente los NUEVE equipos seguían reportando `1.18.1`, y
 * el pedido que hizo el dueño para probar no se guardó — porque estaba corriendo el código viejo.
 *
 * Lo grave no fue eso: fue que **no había forma de saber en cuál de los tres estados estaba cada
 * teléfono**. "Falló la descarga", "se descargó y espera un arranque en frío" y "ni siquiera lo
 * intentó" se ven exactamente igual desde el servidor: `app_version` sigue diciendo la vieja en los
 * tres casos, porque la escribe el bundle que está corriendo.
 *
 * `estadoOta()` es lo que el latido sube para distinguirlos:
 *   · `aplicado`  — el bundle que REALMENTE está corriendo (`builtin` = el que vino en el APK).
 *   · `encolado`  — se descargó y espera el próximo arranque en frío. Es el caso invisible.
 *   · `error`     — la última descarga falló, con su mensaje.
 *
 * Se guarda en `persistence` (no en memoria) porque el dato tiene que sobrevivir justamente al
 * reinicio que estamos tratando de detectar.
 */
const K_OTA = 'lu-ota-estado'

/** Lo que sabemos de la actualización: para el latido y para la pantalla de Mi cuenta. */
export async function estadoOta() {
  if (!Capacitor.isNativePlatform()) return { aplicado: null, encolado: null, error: null }
  let aplicado = 'builtin'
  try { aplicado = (await CapacitorUpdater.current())?.bundle?.version || 'builtin' } catch (_) {}
  const guardado = (await persistence.get(K_OTA, null)) || {}
  // Si lo encolado ya es lo aplicado, el reinicio ocurrió y la marca sobra: dejarla puesta haría
  // que el panel siguiera diciendo "pendiente" sobre algo que ya pasó.
  const encolado = guardado.encolado && guardado.encolado !== aplicado ? guardado.encolado : null
  return { aplicado, encolado, error: guardado.error || null }
}

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
  try {
    const bundle = await CapacitorUpdater.download({ url, version })
    if (!bundle?.id) throw new Error('La descarga no devolvió el paquete.')
    await CapacitorUpdater.next({ id: bundle.id })
    // Queda anotado que ESTA versión está lista y esperando un arranque en frío. Es el estado que
    // el 19/08 fue invisible durante un día entero.
    await persistence.set(K_OTA, { encolado: version, error: null, ts: Date.now() })
    return bundle
  } catch (e) {
    // El error se guarda ANTES de propagarlo: quien llama puede tragárselo (el watchdog lo hace, a
    // propósito, para no romper el despertar) y entonces nadie se enteraría nunca.
    await persistence.set(K_OTA, { encolado: null, error: String(e?.message || e).slice(0, 200), ts: Date.now() })
    throw e
  }
}

// Aplica el bundle encolado y reinicia la app con el contenido nuevo.
export async function otaReload() {
  await CapacitorUpdater.reload()
}
