import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CatalogProvider } from './context/CatalogContext'
import { VentasProvider } from './context/VentasContext'
import { GpsProvider } from './context/GpsContext'
import { DeviceProvider } from './context/DeviceContext'
import AppShell from './components/AppShell'
import PhoneFrame from './components/PhoneFrame'
import GpsGate from './components/GpsGate'
import UpdatePrompt from './components/UpdatePrompt'
import DeviceBanner from './components/DeviceBanner'
import LoginView from './features/auth/LoginView'
import PendienteView from './features/auth/PendienteView'
import { lazy, Suspense, useState } from 'react'
import { sx } from './lib/sx'

// Vistas pesadas (incluyen Leaflet / el panel completo) cargadas bajo demanda para
// que la pantalla de login aparezca sin bajar todo el bundle de una.
const VendedorView = lazy(() => import('./features/vendedor/VendedorView'))
const RepartidorView = lazy(() => import('./features/repartidor/RepartidorView'))
const AdminView = lazy(() => import('./features/admin/AdminView'))

/**
 * Enrutado por rol real (una sola app que degrada):
 *  - vendedor / repartidor → vista móvil con GPS obligatorio (GpsGate).
 *  - encargado → es preventista Y auditor: alterna entre "Mi jornada" (misma
 *    vista del vendedor, con GPS) y "Panel" (auditoría). El switch vive en AppShell.
 *  - admin / superadmin → panel de escritorio (AdminView).
 */
function RoleRouter({ vista }) {
  const { rol } = useAuth()

  if (rol === 'vendedor' || rol === 'repartidor') {
    return (
      <PhoneFrame>
        <GpsGate>
          {rol === 'repartidor' ? <RepartidorView /> : <VendedorView />}
        </GpsGate>
      </PhoneFrame>
    )
  }
  if (rol === 'encargado' && vista === 'jornada') {
    return (
      <PhoneFrame>
        <GpsGate>
          <VendedorView />
        </GpsGate>
      </PhoneFrame>
    )
  }
  return <AdminView />
}

function Cargando() {
  return (
    <div style={sx('min-height:100vh;display:grid;place-items:center;background:var(--bg-app);color:var(--muted);font-family:var(--font-mono);font-size:13px')}>
      Cargando…
    </div>
  )
}

/**
 * App ya autenticada. Mantiene el estado del switch del encargado (Mi jornada /
 * Panel), persistido en localStorage. Para el resto de roles el switch no aplica.
 */
function AuthedApp() {
  const { rol } = useAuth()
  const esEncargado = rol === 'encargado'
  const [vista, setVista] = useState(() => {
    try { return localStorage.getItem('lu-encargado-vista') || 'panel' } catch (_) { return 'panel' }
  })
  const cambiarVista = (v) => {
    try { localStorage.setItem('lu-encargado-vista', v) } catch (_) {}
    setVista(v)
  }

  return (
    <AppShell encargadoVista={esEncargado ? vista : null} onCambiarVista={cambiarVista}>
      <Suspense fallback={<Cargando />}>
        <RoleRouter vista={vista} />
      </Suspense>
    </AppShell>
  )
}

function Gate() {
  const { loading, session, aprobado } = useAuth()
  if (loading) return <Cargando />
  if (!session) return <LoginView />
  if (!aprobado) return <PendienteView />

  return (
    <CatalogProvider>
      <VentasProvider>
        <GpsProvider>
          <AuthedApp />
        </GpsProvider>
      </VentasProvider>
    </CatalogProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <DeviceProvider>
        <AuthProvider>
          <Gate />
          <UpdatePrompt />
          <DeviceBanner />
        </AuthProvider>
      </DeviceProvider>
    </ThemeProvider>
  )
}
