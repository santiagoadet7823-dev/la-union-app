import { Capacitor, registerPlugin } from '@capacitor/core'

/**
 * MODO DEL TELÉFONO (claro u oscuro), para el tema "Automático" (01/10/2026, brief estético v2 §5.5).
 *
 * Único envoltorio de las dos fuentes posibles. `ThemeContext` pregunta acá y no sabe cuál respondió:
 *
 *   1. El plugin nativo `TemaSistema` (APK). Lee `uiMode` de la Activity y avisa en
 *      `handleOnConfigurationChanged`, que es la señal directa: la Activity NO se recrea al cambiar
 *      el modo (`uiMode` está en `configChanges`) y no hay garantía de que `prefers-color-scheme`
 *      se actualice dentro del WebView. ⚠️ **El plugin TODAVÍA NO EXISTE**: va en el próximo APK
 *      (bloque APK-A del brief). Un APK viejo que recibe este JS por OTA tiene que seguir andando:
 *      `isPluginAvailable` da `false` y se cae al punto 2. Mismo patrón que `vidriera.js` y
 *      `apkUpdate.js` (flota mixta).
 *   2. `matchMedia('(prefers-color-scheme: dark)')`: PWA, navegador de escritorio y APK sin plugin.
 *
 * Cuando hay plugin, MANDA ÉL y no se escucha `matchMedia`: dos fuentes que se contradicen harían
 * parpadear el tema. En las dos variantes se vuelve a leer al volver a primer plano
 * (`visibilitychange`): con la app en segundo plano el JS puede estar congelado y el evento del
 * cambio perderse (servicio de GPS activo, pantalla bloqueada).
 *
 * Todo best-effort: un plugin que falla o un `matchMedia` que lanza se leen como "claro", que es el
 * tema por defecto (decisión 1 del dueño), y nunca rompen el arranque.
 */

const MQ = '(prefers-color-scheme: dark)'
const TemaSistema = registerPlugin('TemaSistema')

export function hayPluginTema() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('TemaSistema')
  } catch (_) {
    return false
  }
}

function consulta() {
  try {
    return typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(MQ) : null
  } catch (_) {
    return null
  }
}

/**
 * ¿El dispositivo informa su modo? Si no (WebView sin `prefers-color-scheme`: la consulta vuelve como
 * `not all`), "Automático" se muestra deshabilitado y una preferencia `auto` guardada se resuelve a
 * Claro (brief §5.6).
 */
export function sistemaInformaModo() {
  if (hayPluginTema()) return true
  const mq = consulta()
  return !!mq && mq.media !== 'not all'
}

/** Lectura síncrona (solo `matchMedia`): es la que usa el primer render, igual que el script de `index.html`. */
export function leerSistemaOscuroSync() {
  const mq = consulta()
  return !!(mq && mq.matches)
}

/** Lectura asíncrona: si hay plugin, la respuesta nativa; si no (o si falla), `matchMedia`. */
export async function leerSistemaOscuro() {
  if (hayPluginTema()) {
    try {
      const r = await TemaSistema.obtener()
      return !!(r && r.oscuro)
    } catch (_) { /* plugin con error → matchMedia */ }
  }
  return leerSistemaOscuroSync()
}

/**
 * Se suscribe a los cambios del modo del teléfono. `cb(oscuro: boolean)` puede llamarse con el mismo
 * valor más de una vez (re-sync al volver a primer plano): el que escucha tiene que tolerarlo.
 * Devuelve la función para desuscribirse. `ThemeContext` solo se suscribe en modo `auto`.
 */
export function escucharTemaSistema(cb) {
  let vivo = true
  const avisar = (oscuro) => { if (vivo) cb(!!oscuro) }
  const quitar = []

  if (hayPluginTema()) {
    try {
      const h = TemaSistema.addListener('cambio', (e) => avisar(e && e.oscuro))
      quitar.push(() => { Promise.resolve(h).then((x) => x.remove()).catch(() => {}) })
    } catch (_) { /* sin listener: queda el re-sync de abajo */ }
    leerSistemaOscuro().then(avisar)
  } else {
    const mq = consulta()
    if (mq) {
      const alCambiar = (e) => avisar(e.matches)
      // `addListener` es el respaldo de los WebView viejos (MediaQueryList sin EventTarget).
      if (mq.addEventListener) {
        mq.addEventListener('change', alCambiar)
        quitar.push(() => mq.removeEventListener('change', alCambiar))
      } else if (mq.addListener) {
        mq.addListener(alCambiar)
        quitar.push(() => mq.removeListener(alCambiar))
      }
    }
  }

  const alVolver = () => { if (document.visibilityState === 'visible') leerSistemaOscuro().then(avisar) }
  document.addEventListener('visibilitychange', alVolver)
  quitar.push(() => document.removeEventListener('visibilitychange', alVolver))

  return () => {
    vivo = false
    quitar.forEach((f) => { try { f() } catch (_) { /* noop */ } })
  }
}
