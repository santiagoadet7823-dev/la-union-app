/**
 * Detección de plataforma. Se resuelve sin importar @capacitor/core de forma dura
 * para que el bundle web funcione aunque Capacitor no esté instalado todavía.
 */
export function isNative() {
  const cap = typeof window !== 'undefined' && window.Capacitor
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform())
}
