/**
 * MODO DEL TELÉFONO (claro u oscuro), para el tema "Automático" (01/10/2026, brief estético v2 §5).
 *
 * Envoltorio fino de `matchMedia('(prefers-color-scheme: dark)')`. `ThemeContext` pregunta acá y no
 * toca `matchMedia` directo, así la regla vive en un solo lugar.
 *
 * Por qué alcanza con `matchMedia` y NO hace falta un plugin nativo: el brief (§5.5) proponía uno
 * (`TemaSistema`) porque no se sabía si `prefers-color-scheme` se actualiza dentro del WebView cuando
 * la Activity maneja `uiMode` sola (sin recrearse). La medición del PR-0 en el emulador
 * (`_interno/informes/08_pr0_medicion_webview.md`, WebView 113, misma `BridgeActivity` y
 * `configChanges` que la app) lo respondió: con `cmd uimode night yes|no` la consulta cambia EN VIVO
 * en 0,1-0,6 s, sin recrear la Activity ni recargar, y un arranque en frío con el sistema en oscuro
 * ya arranca oscuro. El plugin no está planeado.
 *
 * Se vuelve a leer al volver a primer plano (`visibilitychange`): con la app en segundo plano el JS
 * puede estar congelado (servicio de GPS activo, pantalla bloqueada) y el evento perderse. No cuesta
 * nada y cubre WebViews de otros fabricantes que no se midieron.
 *
 * Best-effort: un `matchMedia` ausente o que lanza se lee como "claro", el tema por defecto
 * (decisión 1 del dueño), y nunca rompe el arranque.
 */

const MQ = '(prefers-color-scheme: dark)'

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
  const mq = consulta()
  return !!mq && mq.media !== 'not all'
}

/** ¿El teléfono está en modo oscuro ahora? Síncrona: es la misma lectura que el script de `index.html`. */
export function leerSistemaOscuro() {
  const mq = consulta()
  return !!(mq && mq.matches)
}

/**
 * Se suscribe a los cambios del modo del teléfono. `cb(oscuro: boolean)` puede llamarse con el mismo
 * valor más de una vez (re-sync al volver a primer plano): el que escucha tiene que tolerarlo.
 * Devuelve la función para desuscribirse. `ThemeContext` solo se suscribe en modo `auto`.
 */
export function escucharTemaSistema(cb) {
  const quitar = []
  const mq = consulta()
  if (mq) {
    const alCambiar = (e) => cb(!!e.matches)
    // `addListener` es el respaldo de los WebView viejos (MediaQueryList sin EventTarget).
    if (mq.addEventListener) {
      mq.addEventListener('change', alCambiar)
      quitar.push(() => mq.removeEventListener('change', alCambiar))
    } else if (mq.addListener) {
      mq.addListener(alCambiar)
      quitar.push(() => mq.removeListener(alCambiar))
    }
  }

  const alVolver = () => { if (document.visibilityState === 'visible') cb(leerSistemaOscuro()) }
  document.addEventListener('visibilitychange', alVolver)
  quitar.push(() => document.removeEventListener('visibilitychange', alVolver))

  return () => quitar.forEach((f) => { try { f() } catch (_) { /* noop */ } })
}
