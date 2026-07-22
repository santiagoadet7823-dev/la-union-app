import { Capacitor } from '@capacitor/core'

/**
 * Configuración nativa de la UI al arrancar. Solo en la APK; en web/PWA es no-op.
 *
 * (1) Barra de estado EDGE-TO-EDGE: `setOverlaysWebView(true)` hace que el WebView dibuje
 *     DETRÁS de una barra de estado transparente. Recién ahí `env(safe-area-inset-top)`
 *     devuelve la altura real de la barra, y todo el chrome (que YA usa ese inset:
 *     SupervisionMovil, VendedorView, GestionHost…) se acomoda solo. Sin esto, Capacitor
 *     deja el WebView por debajo de la barra, el inset vale 0 y la barra queda como una banda
 *     suelta con color/íconos que no combinan → se veía "tosco como PWA" en Moto G10 y Xiaomi
 *     (22/07/2026). `Style.Dark` = íconos CLAROS (blancos), para el chrome oscuro de la app.
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
    await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {})
  } catch (_) { /* sin plugin / no soportado → seguir */ }
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide().catch(() => {})
  } catch (_) { /* sin plugin → el splash se oculta solo por timeout */ }
}
