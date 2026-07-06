import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.launion.app',
  appName: 'LA UNIÓN',
  webDir: 'dist',
  // App primaria: híbrida (Android/iOS). El mismo bundle web corre como PWA.
  plugins: {
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
