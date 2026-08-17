import { Capacitor, registerPlugin } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { getAppConfig } from './data/appConfig'
import { cmpVer } from '../lib/version'

/**
 * Actualización del APK NATIVO (reinstalación), complemento de la OTA (services/ota.js).
 *
 * La OTA de Capgo solo cambia el bundle web (JS/CSS): alcanza para la gran mayoría de los
 * cambios. Pero cuando cambia algo NATIVO (plugin nuevo, permiso del manifest, código Java),
 * la OTA no puede: hace falta reinstalar el .apk. Esto lo automatiza — hostea el .apk en un
 * GitHub Release y la app lo baja e inicia la instalación con UN solo diálogo del sistema.
 *
 * NO es silencioso puro: Android SIEMPRE exige que el usuario confirme "Instalar" para un APK
 * de fuera de Play Store (salvo Play Store o MDM Device Owner). Esto entrega la mínima fricción
 * posible gratis: cero pasar el archivo a mano.
 *
 * Regla de disparo: se avisa SOLO si la versión instalada está por debajo del piso
 * `app_config.min_version`. Así el prompt pesado de reinstalación aparece únicamente cuando de
 * verdad hace falta (cambio nativo); para todo lo demás sigue mandando la OTA. Mientras
 * `min_version` <= la instalada (hoy '1.0.0'), esto queda INERTE.
 */

// Plugin nativo (Android). En web/PWA `descargarEInstalar` no se llama nunca (apkCheck corta antes).
const ApkUpdater = registerPlugin('ApkUpdater')

// ¿Hay un APK más nuevo que hay que reinstalar? Devuelve {version, url} o null.
export async function apkCheck() {
  if (!Capacitor.isNativePlatform()) return null
  // Guarda para la flota MIXTA: un APK viejo (sin el plugin ApkUpdater) que recibe este JS por OTA
  // NO debe ofrecer la reinstalación — no la podría completar. Sin esto, mostraría un aviso que
  // falla al tocar "Actualizar". Esos equipos siguen solo con OTA hasta que instalen un APK con el
  // plugin. Ver [[apk-autoupdate]].
  if (!Capacitor.isPluginAvailable('ApkUpdater')) return null
  try {
    const cfg = await getAppConfig()
    if (!cfg?.apk_url || !cfg?.min_version) return null
    let instalada = null
    try { instalada = (await CapApp.getInfo())?.version || null } catch (_) {}
    if (!instalada) return null
    // Solo si la instalada quedó por debajo del piso exigido.
    if (cmpVer(instalada, cfg.min_version) >= 0) return null
    return { version: cfg.min_version, url: cfg.apk_url }
  } catch (_) { return null }
}

/**
 * Descarga el .apk (nativo, sin cruzar el binario por el bridge) y lanza el instalador del
 * sistema. El plugin devuelve `{ needsPermission: true }` si falta el permiso de "instalar apps
 * desconocidas": en ese caso ya abrió Ajustes; el usuario lo activa y reintenta.
 */
export async function apkStartUpdate({ url, version }) {
  const res = await ApkUpdater.descargarEInstalar({ url, version })
  return res || {}
}
