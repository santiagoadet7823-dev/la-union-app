/**
 * 🩸 LA CUENTA ACTIVA DE ESTE TELÉFONO: QUIÉN HIZO EL ÚLTIMO LOGIN EXPLÍCITO (02/10/2026).
 *
 * Incidente del 02/10/2026 (motorola edge 30 neo, APK 1.44.0): se cerró la sesión del superadmin,
 * se entró con Google con otra cuenta y, sin ningún login de por medio, a los ~2 min el teléfono
 * estaba otra vez con la sesión del superadmin (el siguiente "Cerrar sesión" salió con SU token).
 * La causa de fondo era el storage partido entre SQLite y localStorage (ver el 🩸 de
 * `services/persistence/index.js`), pero lo que lo hizo POSIBLE es que la app aceptaba cualquier
 * sesión que supabase-js le entregara: `onAuthStateChange` la aplicaba sin preguntar de quién era.
 *
 * Esta es la segunda defensa, independiente del storage: se recuerda el `user.id` de la cuenta que
 * completó el último login EXPLÍCITO (Google, contraseña, registro, deep link de login) y
 * cualquier sesión de OTRA cuenta que aparezca sola se rechaza.
 *
 * Vive en localStorage a secas y no en el puerto durable a propósito: hay que leerla SÍNCRONO
 * (desde el callback de `onAuthStateChange` y desde el `getItem` del storage de auth-js), y no
 * puede depender del mismo storage del que desconfía.
 *
 * ⚠️ SOLO SE HACE CUMPLIR EN EL APK. En la web (PWA y escritorio) la sesión vive en UN solo
 * localStorage, compartido por todas las pestañas: no hay storage partido que la resucite, y entrar
 * con otra cuenta en una pestaña ES entrar en todas (supabase-js lo avisa por BroadcastChannel).
 * Rechazar ahí cerraría la sesión recién abierta en la otra pestaña, porque el storage es el mismo.
 * En la web la cuenta activa se lleva igual (sigue a la sesión que haya), pero nunca se rechaza.
 *
 * Tres estados:
 *   - `null`  → nunca se guardó (primer arranque después de actualizar a 1.44.1). La primera sesión
 *               que aparezca se ADOPTA una vez: no se le cierra la sesión a todo el equipo.
 *   - `''`    → ninguna: se cerró sesión (o se rechazó una ajena). Nada entra sin login explícito.
 *   - `<id>`  → la cuenta que entró. Sólo una sesión de ese id se acepta sin login explícito.
 */
import { isNative } from './platform'

const KEY = 'lu-cuenta-activa'

/**
 * 🩸 COPIA EN MEMORIA, Y SI NO SE PUEDE GUARDAR SE BORRA (02/10/2026, revisión). Con localStorage
 * lleno, `setItem` tira y quedaba el valor ANTERIOR ('' u otro id): cada login legítimo se
 * rechazaba en bucle, sin salida. Ahora el valor nuevo vale igual en esta corrida (memoria, que se
 * lee primero), y en disco se borra la clave: al reabrir, la guarda vuelve a "adoptar" (`null`) en
 * vez de rechazar con un dato viejo.
 */
let enMemoria // undefined = todavía no se leyó ni se fijó en esta corrida

export function leerCuentaActiva() {
  if (enMemoria !== undefined) return enMemoria
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function fijarCuentaActiva(id) {
  enMemoria = id || ''
  try {
    localStorage.setItem(KEY, enMemoria)
  } catch {
    try { localStorage.removeItem(KEY) } catch { /* modo privado: queda solo la copia en memoria */ }
  }
}

// ---- Login explícito en curso (Google nativo, contraseña, registro, deep link) ----
// Mientras dura, la sesión que se está creando todavía no es la "activa": quien la pidió la adopta
// apenas vuelve la llamada, con el `data.session` que devolvió el servidor (no con lo que haya en
// el storage).
let loginsEnCurso = 0
export const empezarLoginExplicito = () => { loginsEnCurso++ }
export const terminarLoginExplicito = () => { loginsEnCurso = Math.max(0, loginsEnCurso - 1) }
export const hayLoginExplicito = () => loginsEnCurso > 0

// ---- Aviso de sesión ajena encontrada en el storage (lo dispara `services/supabase.js`) ----
let manejador = null
let pendiente = null
export function avisarSesionAjena(info) {
  if (manejador) { const fn = manejador; setTimeout(() => fn(info), 0) } else pendiente = info
}
export function alDetectarSesionAjena(fn) {
  manejador = fn
  if (pendiente) { const p = pendiente; pendiente = null; setTimeout(() => fn(p), 0) }
  return () => { if (manejador === fn) manejador = null }
}

/** ¿Se hace cumplir la guarda? Solo en el APK (ver el ⚠️ de arriba). */
export const guardaActiva = () => isNative()

/**
 * ¿Esta sesión puede ocupar el teléfono sin un login explícito? Devuelve el `user.id` de la sesión
 * si es de OTRA cuenta que la activa (o sea: hay que rechazarla), o `null` si está todo bien.
 * Sin efectos: lo usa el storage de auth-js en cada lectura.
 */
export function cuentaAjena(idSesion) {
  if (!idSesion || !guardaActiva()) return null
  if (hayLoginExplicito()) return null
  const activa = leerCuentaActiva()
  if (activa === null || activa === idSesion) return null
  return idSesion
}
