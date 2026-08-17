import { Capacitor } from '@capacitor/core'

/**
 * Configuración nativa de la UI al arrancar. Solo en la APK; en web/PWA es no-op.
 *
 * (1) Barra de estado INTEGRADA (sin edge-to-edge): el WebView queda DEBAJO de la barra
 *     (`setOverlaysWebView(false)`) y le pintamos el mismo color oscuro de la app
 *     (`#0C0C0C`, igual que el theme-color de index.html) con íconos claros (`Style.Dark`).
 *     Así la barra se ve como parte de la app y NO la tapa ningún contenido.
 *
 *     ⚠️ Antes se probó `overlay:true` (edge-to-edge): la app dibujaba detrás de una barra
 *     transparente, pero el header del AppShell (vendedor/admin) NO reserva
 *     `env(safe-area-inset-top)`, así que el contenido se metía debajo y TAPABA la barra de
 *     notificaciones (22/07/2026). Edge-to-edge exigiría paddear TODOS los tops; el modo
 *     no-overlay logra el look integrado sin tocar cada pantalla.
 *
 * (2) SPLASH controlado: el plugin arranca con `launchAutoHide:false` (capacitor.config.ts),
 *     así el splash cubre el warmup del WebView en frío + el parse de JS en OEMs que matan el
 *     proceso. Lo ocultamos acá, cuando React ya montó, en vez de dejar un hueco negro/blanco.
 *
 * Todo best-effort: si un plugin no está (APK viejo) o falla, no rompe el arranque.
 */
export async function initNativeUI() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})
    await StatusBar.setBackgroundColor({ color: '#0C0C0C' }).catch(() => {})
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
  } catch (_) { /* sin plugin / no soportado → seguir */ }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide().catch(() => {})
  } catch (_) { /* sin plugin → el splash se oculta solo por timeout */ }
}
