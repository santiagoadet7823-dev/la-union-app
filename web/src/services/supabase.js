import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { persistence } from './persistence'
import { cuentaAjena, leerCuentaActiva, avisarSesionAjena } from './cuentaActiva'

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

// En el APK (Capacitor) el login de Google vuelve por deep link (com.launion.app://auth)
// y la sesión se crea a mano con exchangeCodeForSession (ver AuthContext). Por eso:
//  - flowType 'pkce': el intercambio code→sesión usa el verifier guardado por la app.
//  - detectSessionInUrl OFF en nativo: evita que el auto-parseo compita con nuestro
//    manejo del deep link (en web sigue ON para el retorno por URL normal).
const isNative = Capacitor.isNativePlatform()

// El candado por defecto de supabase-js usa `navigator.locks`, que en el WebView de
// Android (sobre todo tras estar en segundo plano / ahorro de energía) puede COLGARSE
// y dejar `getSession()` sin resolver → app trabada en "Cargando…". En el APK hay un
// solo WebView (sin multi-pestaña), así que un lock que simplemente ejecuta la función
// es seguro y elimina el cuelgue.
const noHangLock = async (_name, _acquireTimeout, fn) => fn()

/**
 * 🩸 TODA LLAMADA SE ABORTA A LOS 10 s (10/09/2026). Hasta hoy este cliente salía con el `fetch`
 * crudo del WebView: **cero `AbortController` en todo `web/src`**.
 *
 * 🔴 EL ESCENARIO QUE ROMPE NO ES "SIN RED", ES "UNA RAYITA". Sin red limpia el fetch falla
 * enseguida con "Failed to fetch" y la app cae a sus cachés y a la cola, que están bien hechas y
 * funcionan. Pero el vendedor en la calle no está en modo avión: está en EDGE o en una celda
 * saturada, donde el socket ABRE y no vuelve nunca. Ahí el fetch no falla — espera el timeout de
 * TCP, que son ~2 minutos. Y en esos dos minutos la app no está offline: está colgada.
 *
 * Lo que se veía: "Cargando clientes…" con los 2.016 clientes ya guardados en el teléfono, abrir
 * un pedido en una pantalla muerta sin spinner ni error, y —lo peor— el flush de la cola de
 * escrituras trabado detrás de su propio flag, o sea la cola "sin subir" justo cuando hay algo de
 * señal para subir.
 *
 * ⚠️ 10 s y no 3: con EDGE una consulta legítima del catálogo puede tardar varios segundos, y un
 * timeout corto convertiría "lento" en "roto" cuando la red SÍ iba a responder. Lo que se está
 * cortando son los dos minutos, no la lentitud.
 *
 * ⚠️ NO se reintenta acá. Cada llamador ya sabe qué hacer con un fallo —caché, cola, degradar en
 * silencio— y un reintento escondido en el transporte multiplicaría sockets justo cuando la red
 * está mal, que es el problema que vinimos a resolver.
 *
 * 🔑 `signal` propio del llamador: si ya viene uno (supabase-js lo usa en `abortSignal()`), se
 * respeta y se aborta con el que dispare primero.
 */
const TIMEOUT_MS = 10000

/**
 * ⚠️ EL STORAGE VA CON UN TECHO MUCHO MÁS ALTO, y no es un detalle. Por este mismo `fetch` pasan
 * las FOTOS de los productos, y subir una imagen por datos móviles pasa de 10 s sin ningún
 * problema: con el techo corto, cargar el catálogo visual fallaría siempre y habríamos cambiado un
 * bug por otro peor. Lo que se está acotando es una consulta que no vuelve, no una transferencia
 * que legítimamente tarda.
 */
const TIMEOUT_STORAGE_MS = 120000
const esStorage = (input) => {
  const u = typeof input === 'string' ? input : input?.url || ''
  return u.includes('/storage/v1/')
}

const fetchConTimeout = (input, init = {}) => {
  const ms = esStorage(input) ? TIMEOUT_STORAGE_MS : TIMEOUT_MS
  const ctrl = new AbortController()
  // `AbortError` y no un `Error` cualquiera (18/09/2026): postgrest-js ≥ 2.110 reintenta los GET
  // tres veces (1/2/4 s) ante cualquier fallo de red que NO sea un abort. Con `new Error(...)` el
  // timeout contaba como fallo de red y una página colgada tardaba ~47 s en fallar, contra el
  // «NO se reintenta acá» de arriba. Con el nombre correcto lo respeta y falla a los 10 s.
  const reloj = setTimeout(() => ctrl.abort(new DOMException(`timeout ${ms}ms`, 'AbortError')), ms)
  const ajeno = init.signal
  if (ajeno) {
    if (ajeno.aborted) ctrl.abort(ajeno.reason)
    else ajeno.addEventListener('abort', () => ctrl.abort(ajeno.reason), { once: true })
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(reloj))
}

/**
 * 🔴 LA SESIÓN NO SE PIERDE POR FALTA DE ESPACIO (18/09/2026). auth-js guarda la sesión con
 * `localStorage.setItem` crudo, sin `try/catch` (`helpers.js` → `setItemAsync`). Con el storage
 * lleno —el caso del 18/09 en la PC de la oficina— un refresh que no puede guardarse pierde el
 * refresh token ya ROTADO en el servidor: la sesión queda muerta en el próximo intento y la app
 * abre con 401/vacíos.
 *
 * 🩸 Y EN LA APK, EL PROBLEMA NO ES EL ESPACIO: ES EL WEBVIEW (29/09/2026, Tarea 2.2.D). El
 * `localStorage` de un WebView de Android es un archivo que Chrome/System WebView administra como
 * dato de navegación, no como archivo privado de la app — One UI (Samsung) lo evicciona bajo presión
 * de memoria mucho más agresivo que los archivos propios de la app, y algunos flujos de "optimizar
 * batería" limpian datos de WebView por su cuenta. El resultado, reportado por el dueño: la sesión
 * se pierde sola y pediría la verificación en dos pasos de nuevo en medio de la jornada.
 *
 * El arreglo es `persistence.raw` (puerto ya usado en toda la app: cola GPS, caché de catálogo, el
 * espejo de sesión de AuthContext) — en el APK es SQLite vía el plugin nativo, un archivo PROPIO de
 * la app que Android no confunde con datos de navegador descartables; en la PWA sigue siendo
 * `localStorage` ni más ni menos que antes (mismo backend, cero cambio de comportamiento en web).
 *
 * ⚠️ `.raw`, NO `persistence.get/set` a secas — esto NO es cosmético. auth-js ya serializa la
 * sesión a JSON él mismo y espera un `Storage` de verdad (string | null); `persistence.get/set`
 * hacen SU PROPIO `JSON.stringify`/`JSON.parse` alrededor de lo que reciben, pensados para guardar
 * objetos (cachés, colas). Usarlos acá envolvería el string de auth-js en una segunda capa de JSON
 * — y peor, ROMPERÍA LA MIGRACIÓN: quien ya tiene una sesión guardada en `localStorage` por una
 * versión anterior (raw, sin envolver, que ES JSON válido) se leería con un `JSON.parse` de más y
 * volvería un OBJETO en vez de un STRING, y auth-js no sabría qué hacer con eso. `persistence.raw`
 * pasa los strings tal cual, sin tocarlos — ver el comentario grande en `persistence/index.js`.
 *
 * auth-js acepta storage asíncrono: `SupportedStorage` en `@supabase/auth-js` está tipado como
 * `Promisify<Pick<Storage, 'getItem'|'setItem'|'removeItem'>>` (confirmado contra la librería
 * instalada), así que un `getItem`/`setItem`/`removeItem` que devuelven Promise andan igual.
 *
 * ⚠️ NO hace falta un APK nuevo para que esto llegue: el plugin de SQLite ya está empaquetado en el
 * APK actual (lo usa `persistence` para la cola GPS y el espejo de sesión desde antes), así que este
 * cambio es solo JS y se distribuye por el canal OTA normal.
 *
 * ⚠️ COSTO DE LA MIGRACIÓN, UNA SOLA VEZ: en el APK, la sesión vieja vivía en el `localStorage` del
 * WebView; a partir de esta actualización, auth-js busca en SQLite, donde todavía no hay nada. El
 * primer arranque después de instalar esta OTA pide loguearse de nuevo — a todo el equipo, una sola
 * vez — y de ahí en más la sesión vive en el lugar durable. La PWA no paga este costo: sigue en el
 * mismo `localStorage` de siempre, sin ningún corte.
 */
/**
 * 🩸 Y LO QUE SE LEE DE ACÁ SE MIRA ANTES DE ENTREGARLO (02/10/2026). supabase-js relee la sesión
 * del storage por su cuenta —cada request (`_useSession`), el tick de auto-refresh de 30 s, cada
 * vuelta del WebView a primer plano (`_recoverAndRefresh`)— y usa lo que encuentra SIN emitir
 * ningún evento: el 02/10 el "Cerrar sesión" salió con el token de una cuenta que ya había cerrado
 * sesión 2 min antes, mientras la pantalla mostraba la otra. Si la sesión guardada es de una cuenta
 * distinta de la del último login explícito (`services/cuentaActiva.js`), no se entrega: auth-js
 * ve "sin sesión" y AuthContext cierra todo y manda a ingresar de nuevo.
 */
const esClaveDeSesion = (k) => /^sb-.+-auth-token$/.test(k)

const authStorage = {
  getItem: async (k) => {
    const v = await persistence.raw.get(k)
    if (v == null || !esClaveDeSesion(k)) return v
    let id = null
    try { id = JSON.parse(v)?.user?.id || null } catch (_) { return v }
    const ajena = cuentaAjena(id)
    if (!ajena) return v
    console.warn('[supabase] 🩸 sesión guardada de OTRA cuenta; no se entrega', { guardada: ajena, activa: leerCuentaActiva() })
    avisarSesionAjena({ origen: 'storage', recibida: ajena })
    return null
  },
  setItem: (k, v) => persistence.raw.set(k, v),
  removeItem: (k) => persistence.raw.remove(k),
}

export const supabase = hasSupabase
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        flowType: 'pkce',
        detectSessionInUrl: !isNative,
        lock: noHangLock,
        storage: authStorage,
      },
      global: { fetch: fetchConTimeout },
    })
  : null

export default supabase
