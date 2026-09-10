import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'

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
  const reloj = setTimeout(() => ctrl.abort(new Error(`timeout ${ms}ms`)), ms)
  const ajeno = init.signal
  if (ajeno) {
    if (ajeno.aborted) ctrl.abort(ajeno.reason)
    else ajeno.addEventListener('abort', () => ctrl.abort(ajeno.reason), { once: true })
  }
  return fetch(input, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(reloj))
}

export const supabase = hasSupabase
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        flowType: 'pkce',
        detectSessionInUrl: !isNative,
        lock: noHangLock,
      },
      global: { fetch: fetchConTimeout },
    })
  : null

export default supabase
