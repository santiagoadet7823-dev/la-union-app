import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.launion.app',
  appName: 'LA UNIÓN',
  webDir: 'dist',
  // App primaria: híbrida (Android/iOS). El mismo bundle web corre como PWA.
  plugins: {
    // Login NATIVO de Google (selector de cuentas del sistema, sin navegador ni
    // deep link). El idToken resultante se canjea con supabase.auth.signInWithIdToken.
    // serverClientId = Client ID *Web* del proveedor Google de Supabase (público).
    // Se toma de la variable de entorno GOOGLE_WEB_CLIENT_ID al hacer `cap sync`.
    GoogleAuth: {
      scopes: ['profile', 'email'],
      serverClientId: process.env.GOOGLE_WEB_CLIENT_ID || '',
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
