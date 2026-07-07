import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CatalogProvider } from './context/CatalogContext'
import { VentasProvider } from './context/VentasContext'
import { GpsProvider } from './context/GpsContext'
import AppShell from './components/AppShell'
import PhoneFrame from './components/PhoneFrame'
import GpsGate from './components/GpsGate'
import LoginView from './features/auth/LoginView'
import PendienteView from './features/auth/PendienteView'
import VendedorView from './features/vendedor/VendedorView'
import RepartidorView from './features/repartidor/RepartidorView'
import AdminView from './features/admin/AdminView'
import { sx } from './lib/sx'

/**
 * Enrutado por rol real (una sola app que degrada):
 *  - vendedor / repartidor → vista móvil con GPS obligatorio (GpsGate).
 *  - encargado / admin / superadmin → panel de escritorio (AdminView),
 *    que a su vez muestra más o menos módulos según el rol.
 */
function RoleRouter() {
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
  return <AdminView />
}

function Cargando() {
  return (
    <div style={sx('min-height:100vh;display:grid;place-items:center;background:var(--bg-app);color:var(--muted);font-family:var(--font-mono);font-size:13px')}>
      Cargando…
    </div>
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
          <AppShell>
            <RoleRouter />
          </AppShell>
        </GpsProvider>
      </VentasProvider>
    </CatalogProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ThemeProvider>
  )
}
