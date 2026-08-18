import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth'
import { supabase, hasSupabase } from '../services/supabase'
import { persistence } from '../services/persistence'
import { fetchPerfil, leerCachePerfil, escribirCachePerfil, borrarCachePerfil, actualizarMiPerfil as actualizarMiPerfilSvc } from '../services/data/perfiles'
import { cerrarSesionUploader } from '../services/uploaderNativo'

// Espejo de la sesión para el auto-login OFFLINE. El access token dura 1 h y, al reabrir la app
// sin internet pasada esa hora, getSession() intenta refrescar contra la red, falla y devuelve
// null → la app expulsaba a Login. Guardamos la última sesión conocida en el puerto durable
// (SQLite nativo / localStorage web) y, si getSession falla offline, la restauramos: la app abre
// igual (modo sin conexión) y se sincroniza sola al volver la red. NO se borra en un SIGNED_OUT
// transitorio (un refresh fallido offline emite SIGNED_OUT); solo la borra el signOut() explícito.
const SESSION_KEY = 'lu-session-cache'
const leerCacheSesion = () => persistence.get(SESSION_KEY, null)
const escribirCacheSesion = (s) => { if (s?.access_token) persistence.set(SESSION_KEY, s) }
const borrarCacheSesion = () => persistence.set(SESSION_KEY, null)

/**
 * Última cuenta que entró en ESTE teléfono: { nombre, email }. Es lo que le permite al login
 * saludar con "Continuar como José" en vez de una pantalla en blanco (diseño v1.4).
 *
 * 🩸 Guarda SOLO nombre y email — nunca la contraseña ni ningún token. El espejo de sesión
 * (SESSION_KEY) es otra cosa y va por el puerto durable; esto es un dato de presentación y va en
 * localStorage a secas para poder leerlo SÍNCRONO en el primer render del login (con la lectura
 * async del puerto, la tarjeta aparecería un instante después y la pantalla saltaría).
 *
 * NO se borra en signOut: cerrar sesión no es "este teléfono no es más mío", y justamente después
 * de cerrar sesión es cuando más sirve que el login sepa quién sos. Se pisa sola con la próxima
 * cuenta que entre.
 */
/**
 * ¿El servidor RECHAZÓ el refresh token, o simplemente no se pudo preguntar?
 *
 * La diferencia decide si se conserva el espejo de sesión o se manda a iniciar sesión, así que
 * equivocarse acá cuesta caro en las dos direcciones: de más, se expulsa a un vendedor que estaba
 * sin señal; de menos, la app queda abierta con un token muerto haciendo consultas que devuelven
 * vacío en silencio.
 *
 * Solo cuentan las respuestas donde el servidor dijo "este token no vale": **400, 401 y 403**. Un
 * 5xx es Supabase con un mal momento y un `status` ausente es que no hubo respuesta (sin red,
 * DNS, avión): los dos son transitorios y conservan el espejo.
 */
function esRechazoDelServidor(error) {
  const s = error?.status
  return s === 400 || s === 401 || s === 403
}

const ULTIMO_KEY = 'lu-ultimo-ingreso'
const RECORDAR_KEY = 'lu-recordar-usuario'

export function leerUltimoIngreso() {
  try {
    const raw = localStorage.getItem(ULTIMO_KEY)
    const v = raw ? JSON.parse(raw) : null
    return v && v.email ? v : null
  } catch (_) { return null }
}

/** El "Recordar mi usuario" del login. Prendido salvo que se lo apague explícitamente. */
export function quiereRecordar() {
  try { return localStorage.getItem(RECORDAR_KEY) !== '0' } catch (_) { return true }
}

/** Lo llama el login al tocar la casilla. Apagarlo borra además lo que ya estaba guardado. */
export function setRecordarUsuario(valor) {
  try {
    localStorage.setItem(RECORDAR_KEY, valor ? '1' : '0')
    if (!valor) localStorage.removeItem(ULTIMO_KEY)
  } catch (_) { /* modo privado: la preferencia dura lo que dure la sesión */ }
}

function recordarIngreso(s) {
  const u = s?.user
  if (!u?.email) return
  if (!quiereRecordar()) return // la persona pidió que este teléfono no se acuerde de ella
  const m = u.user_metadata || {}
  try {
    localStorage.setItem(ULTIMO_KEY, JSON.stringify({
      email: u.email,
      nombre: m.full_name || m.name || '',
      foto: m.avatar_url || m.picture || '',
    }))
  } catch (_) { /* modo privado: el login arranca sin tarjeta, y no pasa nada */ }
}

/**
 * Sesión + perfil del usuario (multi-tenant). El perfil trae {rol, id_empresa, activo}.
 * El acceso a la app se decide con esto: sin sesión → Login; sesión pendiente
 * (sin rol o inactivo) → Pendiente; ok → app según rol.
 */
const AuthContext = createContext(null)

// Client ID *Web* del proveedor Google de Supabase (público). Se pasa a
// GoogleAuth.initialize para que el idToken nativo tenga ese `aud` y Supabase lo valide.
const GOOGLE_WEB_CLIENT_ID = '253436593980-9em17irlog4t2n78c0g85tuksmbo8nqo.apps.googleusercontent.com'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [perfil, setPerfil] = useState(null)
  const [loading, setLoading] = useState(true)
  const [perfilLoading, setPerfilLoading] = useState(false)
  const [perfilError, setPerfilError] = useState(false)
  const [authError, setAuthError] = useState(null) // error del login nativo
  const [authStatus, setAuthStatus] = useState(null) // diagnóstico en pantalla del login nativo
  /**
   * Contador que sube UNA vez: cuando la app arrancó con un token vencido y después consiguió uno
   * bueno. Los hooks de LECTURA lo llevan en sus dependencias para volver a consultar lo que se
   * les cayó con 401 en el arranque. No es un "refrescar cada tanto": sube solo saliendo de un
   * arranque degradado. Ver el comentario largo de `restaurarDesdeEspejo`.
   */
  const [authEpoch, setAuthEpoch] = useState(0)
  // El access_token con el que se abrió en modo degradado, o null si el arranque fue sano.
  const tokenDegradadoRef = useRef(null)

  // Carga el perfil con timeout + reintentos, sin colgar la app: si la red está
  // lenta/cortada (ahorro de energía), no deja "Cargando…" para siempre.
  //
  // Offline-first: el perfil se cachea localmente. Si hay caché para este usuario,
  // se usa DE INMEDIATO (el Gate deja pasar y el GPS arranca ya) mientras se
  // revalida en segundo plano. Si la red falla y hay caché, NO se marca error —
  // seguir con el perfil viejo es mejor que trabar la app sin GPS al reabrirla
  // sin señal (ver AuthContext/App.jsx: Gate bloquea todo mientras !perfil).
  const cargarPerfil = useCallback(async (userId) => {
    if (!userId) { setPerfil(null); setPerfilError(false); setPerfilLoading(false); return }
    const cached = await leerCachePerfil(userId)
    if (cached) { setPerfil(cached); setPerfilError(false) }
    setPerfilLoading(true)
    if (!cached) setPerfilError(false)
    try {
      const { data } = await fetchPerfil(userId)
      if (data) { setPerfil(data); escribirCachePerfil(userId, data) }
      else if (!cached) setPerfil(null)
      setPerfilError(false)
    } catch (_) {
      if (!cached) setPerfilError(true) // sin caché y sin red → el Gate ofrece "Reintentar"
    } finally {
      setPerfilLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!hasSupabase) { setLoading(false); return }
    let active = true
    // Red de seguridad: nunca quedarse trabado en "Cargando…".
    const safety = setTimeout(() => { if (active) setLoading(false) }, 6000)

    // Restaura la sesión espejada cuando getSession no la devuelve (offline / refresh fallido).
    // Setea el estado de React para que el Gate pase, y le pasa los tokens a supabase-js para que
    // pueda refrescar solo al volver la red. El token vencido no importa offline (ninguna API
    // responde igual). Devuelve la sesión restaurada, o null si no había espejo.
    const restaurarDesdeEspejo = async () => {
      const cached = await leerCacheSesion()
      if (!cached || !active) return null
      setSession(cached)
      cargarPerfil(cached.user?.id)
      // 🩸 EL `await` NO ES COSMÉTICO (18/08/2026). Hasta hoy este `setSession` salía sin esperar y
      // con el error tragado, así que el Gate dejaba pasar a la app con el token VENCIDO del
      // espejo. Todas las pantallas montan y disparan sus consultas en ese instante — perfiles,
      // `ultimas_posiciones`, los recorridos del día— y las tres se iban con ese token muerto:
      // **401, y el mapa vacío**. Treinta segundos después supabase-js refrescaba solo y
      // `onAuthStateChange` actualizaba la sesión… pero ningún hook depende de `session`, así que
      // nada volvía a consultar y el mapa se quedaba vacío hasta cerrar sesión y volver a entrar.
      // Ése era el "después de una actualización o de terminar la jornada no aparecen las
      // ubicaciones": los dos casos son una REAPERTURA con el token ya vencido.
      // Esperarlo hace que la app arranque con el token bueno cuando hay red.
      tokenDegradadoRef.current = cached.access_token
      try {
        const { data, error } = await supabase.auth.setSession({
          access_token: cached.access_token, refresh_token: cached.refresh_token,
        })
        if (!error && data?.session?.access_token && data.session.access_token !== cached.access_token) {
          tokenDegradadoRef.current = null
          if (active) { escribirCacheSesion(data.session); setSession(data.session) }
        } else if (error && esRechazoDelServidor(error)) {
          // 🩸 Y ACÁ ESTÁ LA PARTE QUE HACÍA EL BUG INVISIBLE. Si el servidor CONTESTA que el
          // refresh token ya no vale (400/401/403), la sesión está muerta y no hay nada que
          // esperar: sin esto, la app seguía abierta con un token vencido y **las consultas salían
          // como `anon`** — o sea que RLS devolvía CERO FILAS *sin un solo error*. El mapa quedaba
          // vacío, sin cartel, sin nada en consola, indistinguible de un día sin recorridos.
          // Reproducido el 18/08/2026 con el token vencido hacía 9,1 h: 0 marcadores, 0 trazos y
          // `[recorridos] carga completa VACÍA`.
          // El espejo se borra SOLO en este caso. Un fallo de red (o un 5xx de Supabase) sigue
          // conservándolo: ése es todo el motivo por el que el espejo existe (auto-login offline).
          await borrarCacheSesion()
          if (active) { setSession(null); setPerfil(null) }
          return null
        }
      } catch (_) { /* offline: se abre igual, en modo sin conexión (es el motivo del espejo) */ }
      return cached
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      if (data.session) {
        escribirCacheSesion(data.session)
        setSession(data.session)
        cargarPerfil(data.session.user?.id) // en background
      } else {
        // Sin sesión viva: puede ser primer arranque (no hay espejo → Login) o reapertura offline
        // con el token vencido (hay espejo → abrir igual, modo sin conexión).
        await restaurarDesdeEspejo()
      }
      setLoading(false) // NO esperamos el perfil (offline-first)
      clearTimeout(safety)
    }).catch(async () => {
      if (!active) return
      await restaurarDesdeEspejo()
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      // Solo ESCRIBIR el espejo cuando hay sesión. NO borrarlo ante un `s` null: un refresh
      // fallido offline emite SIGNED_OUT y perderíamos el auto-login. El borrado va en signOut().
      if (s) {
        escribirCacheSesion(s); recordarIngreso(s); setSession(s); cargarPerfil(s.user?.id)
        // La OTRA mitad del arreglo. Si la app arrancó con el token vencido y SIN red (el `await`
        // de arriba no pudo renovarlo), las consultas del arranque ya fallaron con 401. Cuando la
        // red vuelve, supabase-js refresca solo y cae acá: ese es el único momento en que se sabe
        // que lo que falló ahora puede funcionar. `authEpoch` avisa a los hooks de lectura para
        // que vuelvan a consultar.
        //
        // ⚠️ Se compara el TOKEN, no se cuenta el evento: `onAuthStateChange` dispara también al
        // suscribirse y en cada refresco normal (~cada hora). Bumpear en todos recargaría la
        // jornada entera —~200 KB por datos móviles— sin que nada estuviera roto.
        if (tokenDegradadoRef.current && s.access_token !== tokenDegradadoRef.current) {
          tokenDegradadoRef.current = null
          setAuthEpoch((n) => n + 1)
        }
      }
      setLoading(false)
    })

    return () => { active = false; clearTimeout(safety); sub.subscription.unsubscribe() }
  }, [cargarPerfil])

  // Captura el retorno del login de Google cuando la app corre en nativo (deep link
  // com.launion.app://auth). Google → callback de Supabase → 302 al deep link, que
  // reabre la app con ?code=... (PKCE) o, como fallback, #access_token=...
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    const sub = CapApp.addListener('appUrlOpen', async ({ url }) => {
      if (!url || !url.includes('auth')) return
      try { await Browser.close() } catch (_) {}
      try {
        const parsed = new URL(url)
        // 1) Error explícito devuelto por el proveedor / Supabase.
        const err = parsed.searchParams.get('error_description') || parsed.searchParams.get('error')
        if (err) { setAuthError(decodeURIComponent(err)); return }

        // 2) Flujo PKCE normal: ?code=... → intercambio por sesión.
        const code = parsed.searchParams.get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) setAuthError(error.message)
          else setAuthError(null)
          return
        }

        // 3) Fallback flujo implícito: #access_token=...&refresh_token=...
        const hash = (parsed.hash || '').replace(/^#/, '')
        const hp = new URLSearchParams(hash)
        const access_token = hp.get('access_token')
        const refresh_token = hp.get('refresh_token')
        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (error) setAuthError(error.message)
          else setAuthError(null)
          return
        }

        setAuthError('No se recibió el código de acceso de Google. Revisá que com.launion.app://auth esté en las Redirect URLs de Supabase.')
      } catch (e) {
        setAuthError(e?.message || 'Error procesando el retorno del login.')
      }
    })
    return () => { sub.then((s) => s.remove()) }
  }, [])

  const signInWithGoogle = async () => {
    setAuthError(null)

    // NATIVO (APK): login con el selector de cuentas de Android (sin navegador ni
    // deep link, que no funcionaban en estos equipos). El idToken se canjea por
    // sesión de Supabase con signInWithIdToken.
    if (Capacitor.isNativePlatform()) {
      try {
        // El plugin NO auto-inicializa el cliente en Android (load() vacío): hay que
        // llamar initialize() antes de signIn(), o signIn() crashea (cliente null).
        setAuthStatus('0/3 · Inicializando Google…')
        await GoogleAuth.initialize({
          clientId: GOOGLE_WEB_CLIENT_ID,
          scopes: ['profile', 'email'],
          grantOfflineAccess: false,
        })
        setAuthStatus('1/3 · Abriendo Google…')
        const res = await GoogleAuth.signIn()
        const idToken = res?.authentication?.idToken || res?.idToken || null
        setAuthStatus(`2/3 · Cuenta: ${res?.email || '¿?'} · idToken ${idToken ? 'OK (' + idToken.length + ')' : 'FALTA'}`)
        if (!idToken) {
          setAuthError('Google no devolvió idToken. res=' + JSON.stringify(res).slice(0, 260))
          return { error: true }
        }
        const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken })
        if (error) {
          setAuthError(`Supabase rechazó el token: ${error.message} (status ${error.status ?? '?'})`)
          setAuthStatus(null)
          return { error }
        }
        setAuthStatus(`3/3 · Sesión ${data?.session ? 'creada' : 'NO'} · ${data?.user?.email || '¿?'}`)
        return { error: null }
      } catch (e) {
        setAuthError('Excepción en el login: ' + (e?.message || JSON.stringify(e) || String(e)).slice(0, 260))
        setAuthStatus(null)
        return { error: e }
      }
    }

    // WEB / PWA: flujo OAuth por redirección del navegador (funciona en la web).
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + (import.meta.env.BASE_URL || '/') },
    })
    if (error) setAuthError(error.message)
    return { data, error }
  }

  // Ingreso con email + contraseña, para las cuentas que da de alta el admin
  // (ver Edge Function crear-usuario). Convive con Google: el onAuthStateChange de
  // arriba levanta la sesión y dispara la carga del perfil igual que en el OAuth.
  const signInWithPassword = async ({ email, password }) => {
    setAuthError(null)
    const correo = (email || '').trim().toLowerCase()
    if (!correo || !password) {
      const msg = 'Ingresá tu email y contraseña.'
      setAuthError(msg)
      return { error: { message: msg } }
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email: correo, password })
    // Mensaje humano para el error más común; el resto se muestra tal cual.
    if (error) setAuthError(/invalid login/i.test(error.message) ? 'Email o contraseña incorrectos.' : error.message)
    return { data, error }
  }

  /**
   * Manda el mail con el enlace para poner una contraseña nueva (diseño v1.4).
   *
   * Hasta ahora no existía NINGÚN camino: si un vendedor se olvidaba la contraseña tenía que
   * llamar al admin para que se la cambiara a mano.
   *
   * ⚠️ DOS COSAS QUE HAY QUE MIRAR EN EL PANEL DE SUPABASE, no se resuelven desde acá:
   *   1. `redirectTo` tiene que estar en la lista de Redirect URLs, o el enlace del mail no
   *      vuelve a la app.
   *   2. El enlace vence según la config de Auth (por defecto 1 hora). El diseño proponía decir
   *      "vale 30 minutos": NO se escribe ningún número en la UI hasta confirmar el valor real,
   *      porque un número inventado en una pantalla de ayuda es peor que no decir nada.
   *
   * No revela si el email existe (Supabase tampoco): responder distinto según eso deja averiguar
   * quién tiene cuenta. Por eso la pantalla dice siempre lo mismo.
   */
  const enviarEnlaceContrasena = async (email) => {
    const correo = (email || '').trim().toLowerCase()
    if (!correo) return { error: { message: 'Escribí tu email.' } }
    const { error } = await supabase.auth.resetPasswordForEmail(correo, {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}`,
    })
    return { error }
  }

  // Auto-edición del propio perfil (nombre + teléfono) vía RPC. En éxito, mergea
  // el resultado en el estado y refresca la caché (offline-first, igual que el resto).
  const actualizarMiPerfil = async ({ nombre, telefono, fotoUrl, setFoto }) => {
    const { data, error } = await actualizarMiPerfilSvc({ nombre, telefono, fotoUrl, setFoto })
    if (error) return { error }
    if (data) {
      setPerfil((prev) => ({ ...(prev || {}), ...data }))
      escribirCachePerfil(session?.user?.id, { ...(perfil || {}), ...data })
    }
    return { data, error: null }
  }

  const signOut = async () => {
    // 🩸 PRIMERO: soltar el uploader NATIVO (02/08/2026). Va antes que nada porque necesita la
    // sesión viva, y porque si algo de lo de abajo falla el teléfono no puede quedar rastreando a
    // nombre de esta cuenta. Hasta 1.7.0 el signOut no lo tocaba: el token quedaba en las prefs y
    // AlarmReceiver volvía a levantar el servicio cada 30 min, así que el teléfono seguía subiendo
    // posiciones de esta persona mientras había OTRA logueada. Ver services/uploaderNativo.js.
    try { await cerrarSesionUploader() } catch (_) { /* nunca bloquear el logout */ }
    // En nativo, cerrar también la sesión de Google borra la cuenta cacheada (así
    // el próximo ingreso deja elegir otra cuenta). OJO: el plugin no inicializa el
    // cliente solo; si no se llamó signIn en esta sesión, signOut() crashea (cliente
    // null). Por eso initialize() primero.
    if (Capacitor.isNativePlatform()) {
      try {
        await GoogleAuth.initialize({ clientId: GOOGLE_WEB_CLIENT_ID, scopes: ['profile', 'email'], grantOfflineAccess: false })
        await GoogleAuth.signOut()
      } catch (_) {}
    }
    // Borra el perfil cacheado de este usuario para que no quede filtrado a otra
    // cuenta que inicie sesión después en el mismo dispositivo.
    borrarCachePerfil(session?.user?.id)
    // Sign-out EXPLÍCITO: borra el espejo de sesión y limpia el estado a mano. El listener
    // onAuthStateChange ya no procesa `s` null (para sobrevivir a los SIGNED_OUT offline), así
    // que la baja de sesión visible se hace acá.
    borrarCacheSesion()
    setSession(null)
    setPerfil(null)
    setAuthStatus(null)
    setAuthError(null)
    await supabase.auth.signOut()
  }

  const value = {
    session,
    user: session?.user || null,
    perfil,
    rol: perfil?.rol || null,
    // Permisos EXTRA, además del rol (`perfiles.permisos`). El `?? []` no es decorativo: el perfil
    // se cachea local (SQLite/localStorage) y una caché escrita antes de que existiera la columna
    // llega sin ella. Sin el default, todo consumidor reventaría hasta la próxima revalidación
    // online — justo en el arranque offline, que es cuando la caché se usa.
    permisos: perfil?.permisos ?? [],
    idEmpresa: perfil?.id_empresa || null,
    activo: !!perfil?.activo,
    aprobado: !!perfil?.activo && !!perfil?.rol,
    loading,
    perfilLoading,
    perfilError,
    hasSupabase,
    authError,
    authStatus,
    authEpoch,
    signInWithGoogle,
    signInWithPassword,
    enviarEnlaceContrasena,
    signOut,
    actualizarMiPerfil,
    refetchPerfil: () => cargarPerfil(session?.user?.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
