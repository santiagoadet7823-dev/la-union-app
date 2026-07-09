import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import './index.css'
import App from './App.jsx'

// OTA (capgo): confirmar el bundle apenas arranca. Si no se llama a tiempo, capgo
// asume que la actualización falló y hace rollback (la app "vuelve a la anterior").
if (Capacitor.isNativePlatform()) {
  import('@capgo/capacitor-updater')
    .then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady().catch(() => {}))
    .catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
