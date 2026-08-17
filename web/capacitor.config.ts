import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.launion.app',
  appName: 'DisT-At',
  webDir: 'dist',
  // NOTA: NO usar android.useLegacyBridge — rompe la publicación de posiciones en esta app
  // (el bridge legacy corta el pipeline de cola/SQLite; ver plan del 2026-07-13). El fix del
  // GPS en segundo plano/bloqueo se encara por otra vía.
  // App primaria: híbrida (Android/iOS). El mismo bundle web corre como PWA.
  plugins: {
    // Actualización OTA del contenido web (sin reinstalar el APK). autoUpdate:false
    // → la controlamos a mano: chequeamos app_config (Supabase) y aplicamos el
    // bundle nuevo desde UpdatePrompt. Ver src/services/ota.js.
    CapacitorUpdater: {
      autoUpdate: false,
    },
    // Login NATIVO de Google (selector de cuentas del sistema, sin navegador ni
    // deep link). El idToken resultante se canjea con supabase.auth.signInWithIdToken.
    // serverClientId = Client ID *Web* del proveedor Google de Supabase (público).
    // Se toma de la variable de entorno GOOGLE_WEB_CLIENT_ID al hacer `cap sync`.
    GoogleAuth: {
      scopes: ['profile', 'email'],
      // Client ID *Web* del proveedor Google de Supabase (público). El plugin en
      // Android lee la clave `clientId` (usa requestIdToken con ese id) → el idToken
      // resultante tiene ese `aud` y Supabase lo valida. `serverClientId` se deja por
      // compatibilidad iOS/offline.
      clientId: '253436593980-9em17irlog4t2n78c0g85tuksmbo8nqo.apps.googleusercontent.com',
      serverClientId: '253436593980-9em17irlog4t2n78c0g85tuksmbo8nqo.apps.googleusercontent.com',
      forceCodeForRefreshToken: false,
    },
    // GPS en segundo plano (breadcrumbs + geofencing). Requiere permisos nativos
    // declarados en AndroidManifest.xml / Info.plist (ver README, sección Nativo).
    BackgroundGeolocation: {},
    // Persistencia offline nativa. En web cae a IndexedDB/localStorage (ver
    // src/services/persistence).
    CapacitorSQLite: {
      iosDatabaseLocation: 'Library/CapacitorDatabase',
      iosIsEncryption: false,
      androidIsEncryption: false,
    },
    // Splash controlado a mano: NO se oculta solo (launchAutoHide:false). En OEMs que matan
    // el proceso (Huawei/Xiaomi/ZTE) cada apertura es en frío y el WebView tarda en pintar;
    // sin esto queda un hueco negro/blanco entre el splash del sistema y el primer render de
    // React. Lo ocultamos desde JS (App.jsx) recién cuando la app ya tiene contenido. El color
    // matchea el theme-color (#0C0C0C) de index.html para que no haya salto.
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#0C0C0C',
      showSpinner: false,
    },
  },
}

export default config
