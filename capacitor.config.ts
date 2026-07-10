import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.launion.app',
  appName: 'DisT-At',
  webDir: 'dist',
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
  },
}

export default config
