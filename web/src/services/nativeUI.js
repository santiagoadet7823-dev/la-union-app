import { Capacitor } from '@capacitor/core'

/**
 * Configuración nativa de la UI al arrancar. Solo en la APK; en web/PWA es no-op.
 *
 * (1) Barra de estado INTEGRADA (sin edge-to-edge): el WebView queda DEBAJO de la barra
 *     (`setOverlaysWebView(false)`) y le pintamos el fondo de la app SEGÚN EL TEMA
 *     (`COLOR_TEMA`: Claro `#F6F4EE` con íconos oscuros, `Style.Light`; Oscuro `#0E0E10` con
 *     íconos claros, `Style.Dark`). Así la barra se ve como parte de la app y NO la tapa ningún
 *     contenido. Hasta el 29/09/2026 iba fija en `#0C0C0C`, también con el tema Claro: quedaba
 *     una franja negra arriba de la app crema. `aplicarTemaNativo` la repinta en cada cambio de
 *     tema (lo llama `ThemeContext`).
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

/**
 * `--bg-app` de cada tema. Son los mismos hex que `index.css` y que el bootstrap de `index.html`:
 * la barra de estado nativa y el `theme-color` no resuelven `var(--x)`, así que van escritos a
 * mano. ⚠️ Si se cambia `--bg-app` en `index.css`, se cambia acá y en `index.html`.
 */
export const COLOR_TEMA = { light: '#F6F4EE', dark: '#0E0E10' }

const temaValido = (t) => (t === 'light' ? 'light' : 'dark')

/**
 * Pinta lo que rodea a la app con el color del tema: el `theme-color` (barra del navegador en la
 * PWA de Android) y, en la APK, la barra de estado. Best-effort: en web solo toca el `<meta>`;
 * en la APK, un plugin ausente o un error no rompen nada.
 */
export async function aplicarTemaNativo(theme) {
  const t = temaValido(theme)
  try {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', COLOR_TEMA[t])
  } catch (_) { /* sin DOM */ }
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar')
    await StatusBar.setBackgroundColor({ color: COLOR_TEMA[t] }).catch(() => {})
    // `Style.Dark` = texto claro para fondos oscuros; `Style.Light` = texto oscuro para fondos claros.
    await StatusBar.setStyle({ style: t === 'light' ? Style.Light : Style.Dark }).catch(() => {})
  } catch (_) { /* sin plugin / no soportado → seguir */ }
}

export async function initNativeUI() {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { StatusBar } = await import('@capacitor/status-bar')
    await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})
  } catch (_) { /* sin plugin / no soportado → seguir */ }
  // El tema ya lo resolvió el script de `index.html` y `ThemeContext` (`data-theme` en <html>).
  await aplicarTemaNativo(document.documentElement.getAttribute('data-theme'))
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide().catch(() => {})
  } catch (_) { /* sin plugin → el splash se oculta solo por timeout */ }
}
