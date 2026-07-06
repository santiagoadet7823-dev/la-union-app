import { ThemeProvider } from './context/ThemeContext'
import { RoleProvider, useRole } from './context/RoleContext'
import { CatalogProvider } from './context/CatalogContext'
import { VentasProvider } from './context/VentasContext'
import AppShell from './components/AppShell'
import PhoneFrame from './components/PhoneFrame'
import VendedorView from './features/vendedor/VendedorView'
import RepartidorView from './features/repartidor/RepartidorView'
import AdminView from './features/admin/AdminView'

function RoleRouter() {
  const { currentRole } = useRole()

  if (currentRole === 'admin') {
    return <AdminView />
  }
  // Vendedor y Repartidor son móviles: se muestran dentro de un marco de teléfono.
  return (
    <PhoneFrame>
      {currentRole === 'repartidor' ? <RepartidorView /> : <VendedorView />}
    </PhoneFrame>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <RoleProvider>
        <CatalogProvider>
          <VentasProvider>
            <AppShell>
              <RoleRouter />
            </AppShell>
          </VentasProvider>
        </CatalogProvider>
      </RoleProvider>
    </ThemeProvider>
  )
}
