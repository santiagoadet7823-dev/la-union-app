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

// Desde el 01/10/2026 el tema por defecto es Claro (decisión 1 del dueño): un valor que no sea
// `dark` (atributo ausente, basura) se pinta Claro, igual que el script de `index.html`.
const temaValido = (t) => (t === 'dark' ? 'dark' : 'light')

/**
 * Pinta lo que rodea a la app con el color del tema: el `theme-color` (barra del navegador en la
 * PWA de Android) y, en la APK, la barra de estado. Best-effort: en web solo toca el `<meta>`;
 * en la APK, un plugin ausente o un error no rompen nada.
 *
 * Recibe el tema RESUELTO (`light`/`dark`), nunca la preferencia: con "Automático" quien decide qué
 * color va es `ThemeContext`, que llama acá cada vez que el teléfono cambia de modo.
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
  // El tema ya lo resolvió el script de `index.html` y `ThemeContext` (`data-theme` en <html>, que
  // es siempre el resuelto: con "Automático" no dice `auto`, dice `light` o `dark`).
  await aplicarTemaNativo(document.documentElement.getAttribute('data-theme'))
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen')
    await SplashScreen.hide().catch(() => {})
  } catch (_) { /* sin plugin → el splash se oculta solo por timeout */ }
  // (02/10/2026) Al terminar de irse, el splash de Android 12+ (androidx `SplashScreen`) vuelve a
  // aplicar las barras del `postSplashScreenTheme` (`AppTheme.NoActionBar`) y PISA lo que acabamos de
  // poner: quedaba `#757575` con íconos blancos en Claro y `#000000` en Oscuro hasta el primer cambio
  // de tema (A5, informe 09 del emulador). `hide()` resuelve en el acto y el plugin no avisa cuándo se
  // fue el splash: en el emulador la vista se quitó 3,6 s DESPUÉS del `hide()` (y ahí pisó el estilo
  // de los íconos), así que una espera fija no alcanza. Durante 12 s se compara la barra con el tema
  // resuelto de ESE momento (si el usuario cambió de tema, gana el actual) y se repinta si no coincide.
  vigilarBarraTrasSplash()
}

async function vigilarBarraTrasSplash() {
  let StatusBar
  try { ({ StatusBar } = await import('@capacitor/status-bar')) } catch (_) { return }
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const t = temaValido(document.documentElement.getAttribute('data-theme'))
    try {
      const info = await StatusBar.getInfo()
      // `getInfo().style` dice `LIGHT` cuando los íconos son oscuros (fondo claro), igual que `Style.Light`.
      const bien = (info?.color || '').toUpperCase() === COLOR_TEMA[t].toUpperCase() &&
        info?.style === (t === 'light' ? 'LIGHT' : 'DARK')
      if (!bien) await aplicarTemaNativo(t)
    } catch (_) { return /* plugin sin getInfo: no hay cómo comparar */ }
  }
}
