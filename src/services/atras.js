import { App as CapApp } from '@capacitor/app'
import { isNative } from './platform'

/**
 * Botón ATRÁS de Android (y gesto de deslizar desde el borde, que Android entrega
 * por el mismo evento).
 *
 * 20/07/2026 — Hasta hoy la app no escuchaba `backButton`. Con el listener sin
 * registrar, Capacitor aplica el comportamiento por defecto: si no hay historial
 * de navegación, **cierra la app**. Y como esta app no tiene router, NUNCA hay
 * historial. O sea que estando en el dashboard, el atrás no cerraba la hoja: te
 * sacaba de la aplicación.
 *
 * Cómo funciona: una PILA de handlers. Cada overlay que se abre apila su función
 * de cierre y la desapila al desmontarse. El atrás ejecuta el ÚLTIMO apilado —
 * que es siempre el de más arriba en pantalla — y no propaga.
 *
 * 🚨 Si la pila está vacía se llama `minimizeApp()`, NUNCA `exitApp()`.
 * `exitApp()` mata el proceso y con él el foreground service de ubicación: el
 * repartidor dejaría de emitir sin enterarse. Minimizar lo manda a segundo plano
 * dejando el servicio vivo, que es justo el modo en que la app tiene que trabajar.
 */

const pila = []
let listener = null

/**
 * Apila un handler de cierre y devuelve la función para desapilarlo.
 * Idempotente al desapilar: llamarla dos veces no saca el handler de otro.
 */
export function apilarAtras(handler) {
  const entrada = { handler }
  pila.push(entrada)
  return () => {
    const i = pila.indexOf(entrada)
    if (i !== -1) pila.splice(i, 1)
  }
}

/** Arranca el listener nativo. Se llama una vez, desde main.jsx. */
export function iniciarAtras() {
  if (!isNative() || listener) return
  listener = CapApp.addListener('backButton', () => {
    const arriba = pila[pila.length - 1]
    if (arriba) { arriba.handler(); return }
    CapApp.minimizeApp()
  })
}

/** Solo para tests / limpieza. */
export function _pilaAtras() { return pila }
