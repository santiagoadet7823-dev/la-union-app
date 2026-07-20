import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.jsx'
import { iniciarAtras } from './services/atras'

// OTA (capgo): confirmar el bundle apenas arranca. Si no se llama a tiempo, capgo
// asume que la actualización falló y hace rollback (la app "vuelve a la anterior").
if (Capacitor.isNativePlatform()) {
  import('@capgo/capacitor-updater')
    .then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady().catch(() => {}))
    .catch(() => {})
}

// Botón atrás de Android. Sin esto, el atrás CIERRA la app (no hay router, así que
// nunca hay historial que consumir). Ver services/atras.js.
iniciarAtras()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
