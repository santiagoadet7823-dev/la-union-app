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

export const supabase = hasSupabase
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        flowType: 'pkce',
        detectSessionInUrl: !isNative,
        lock: noHangLock,
      },
    })
  : null

export default supabase
