import { ThemeProvider } from './context/ThemeContext'
import { AuthProvider, useAuth } from './context/AuthContext'
import { CatalogProvider } from './context/CatalogContext'
import { GpsProvider } from './context/GpsContext'
import { DeviceProvider } from './context/DeviceContext'
import AppShell from './components/AppShell'
import PhoneFrame from './components/PhoneFrame'
import GpsGate from './components/GpsGate'
import ErrorBoundary from './components/ErrorBoundary'
import UpdatePrompt from './components/UpdatePrompt'
import DeviceBanner from './components/DeviceBanner'
import LoginView from './features/auth/LoginView'
import PendienteView from './features/auth/PendienteView'
import { lazy, Suspense, useState } from 'react'
import { sx } from './lib/sx'
import { isNative } from './services/platform'

// Vistas pesadas (incluyen Leaflet / el panel completo) cargadas bajo demanda para
// que la pantalla de login aparezca sin bajar todo el bundle de una.
const VendedorView = lazy(() => import('./features/vendedor/VendedorView'))
const RepartidorView = lazy(() => import('./features/repartidor/RepartidorView'))
const AdminView = lazy(() => import('./features/admin/AdminView'))
const PropietarioView = lazy(() => import('./features/propietario/PropietarioView'))
const SupervisionMovil = lazy(() => import('./features/supervision/SupervisionMovil'))
// Shell de escritorio (PWA/.exe) para los roles de supervisión: sidebar izq + topbar +
// mapa + métricas. Reemplaza al AppShell+AdminView/PropietarioView SOLO en web.
const SupervisionDesktop = lazy(() => import('./features/supervision/SupervisionDesktop'))

// La supervisión móvil (mapa full-screen) es el diseño nuevo SOLO para la APK nativa.
// En web/PWA se mantiene el panel actual hasta el rediseño de escritorio (.exe).
// `?mobile=1` fuerza la vista en el navegador para previsualizarla.
function usarSupervisionMovil() {
  if (isNative()) return true
  try { return new URLSearchParams(window.location.search).get('mobile') === '1' } catch (_) { return false }
}

/**
 * Enrutado por rol real (una sola app que degrada):
 *  - vendedor / repartidor → vista móvil con GPS obligatorio (GpsGate).
 *  - encargado → es preventista Y auditor: alterna entre "Mi jornada" (misma
 *    vista del vendedor, con GPS) y "Panel" (auditoría). El switch vive en AppShell.
 *  - propietario → vista del dueño: solo lectura, pensada para el celular (sin GPS propio).
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
  if (rol === 'propietario') return <PropietarioView />
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
 * Hay sesión pero el perfil todavía no cargó (o falló por red lenta/cortada). Loader
 * acotado con reintento — nunca queda trabado como el "Cargando…" genérico.
 */
function CargandoPerfil({ error, onRetry }) {
  return (
    <div style={sx('min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:var(--bg-app);color:var(--text);text-align:center;padding:24px')}>
      <div style={sx('font-family:var(--font-mono);font-size:13px;color:var(--muted)')}>
        {error ? 'No pudimos cargar tu perfil (revisá tu conexión).' : 'Cargando tu perfil…'}
      </div>
      {error && (
        <button onClick={onRetry} style={sx('min-height:46px;padding:0 22px;background:var(--primary);color:var(--on-primary);border:none;border-radius:12px;font-weight:600;font-size:14px;cursor:pointer')}>
          Reintentar
        </button>
      )}
    </div>
  )
}

/**
 * Decide si el rol/estado actual debe ir a la supervisión móvil full-screen o al
 * AppShell con tabs. Único lugar que sabe esta regla — así no queda un booleano ad
 * hoc que hay que reinventar/recordar cada vez que se agregue un rol o vista.
 */
function decidirSupervisionMovil({ nativo, rol, esEncargado, vista, esGestor }) {
  // El PROPIETARIO usa SIEMPRE la vista móvil de solo-lectura, tanto en la APK como en la
  // PWA: el dueño abre el sistema desde su celular (la PWA de escritorio es solo para PC/gestores).
  if (rol === 'propietario') return true
  if (!nativo) return false
  if (esEncargado && vista === 'panel') return true
  // Admin/superadmin en la APK: SIEMPRE supervisión móvil. La gestión se abre nativa desde
  // el botón "Menú"; ya no existe el panel de escritorio (AdminView/PWA) en el .apk.
  if (esGestor) return true
  return false
}

/**
 * App ya autenticada. Mantiene el estado del switch del encargado (Mi jornada /
 * Panel), persistido en localStorage. Para el resto de roles el switch no aplica.
 */
function AuthedApp() {
  const { rol } = useAuth()
  const esEncargado = rol === 'encargado'
  const esGestor = rol === 'admin' || rol === 'superadmin'
  const [vista, setVista] = useState(() => {
    try { return localStorage.getItem('lu-encargado-vista') || 'panel' } catch (_) { return 'panel' }
  })
  const cambiarVista = (v) => {
    try { localStorage.setItem('lu-encargado-vista', v) } catch (_) {}
    setVista(v)
  }

  // Supervisión móvil (full-screen, sin el marco del AppShell). Solo en la APK nativa
  // (o ?mobile=1 en web): dueño siempre; encargado en "Panel"; admin/superadmin siempre
  // (la gestión se abre nativa desde el botón "Menú", sin el AdminView de escritorio).
  const nativo = usarSupervisionMovil()
  const supMovil = decidirSupervisionMovil({ nativo, rol, esEncargado, vista, esGestor })
  if (supMovil) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<Cargando />}>
          <SupervisionMovil
            role={rol}
            onIrAJornada={esEncargado ? () => cambiarVista('jornada') : null}
          />
        </Suspense>
      </ErrorBoundary>
    )
  }

  // En WEB/PWA (no nativo) los roles de GESTIÓN usan el nuevo shell de ESCRITORIO
  // (sidebar izq + topbar + mapa + métricas) en vez del AppShell+AdminView: la PWA de
  // escritorio es solo para PC. Gestor (admin/superadmin) siempre; encargado solo en "Panel"
  // (en "Mi jornada" sigue con el PhoneFrame del vendedor). El PROPIETARIO NO entra acá: ya
  // salió arriba por supMovil (vista móvil de solo-lectura, celular). La APK también.
  const usaDesktop = !nativo && (esGestor || (esEncargado && vista === 'panel'))
  if (usaDesktop) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<Cargando />}>
          <SupervisionDesktop
            role={rol}
            vista={esEncargado ? vista : null}
            onIrAJornada={esEncargado ? () => cambiarVista('jornada') : null}
          />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <AppShell
      encargadoVista={esEncargado ? vista : null}
      onCambiarVista={cambiarVista}
    >
      <ErrorBoundary>
        <Suspense fallback={<Cargando />}>
          <RoleRouter vista={vista} />
        </Suspense>
      </ErrorBoundary>
    </AppShell>
  )
}

function Gate() {
  const { loading, session, aprobado, perfil, perfilLoading, perfilError, refetchPerfil } = useAuth()
  if (loading) return <Cargando />
  if (!session) return <LoginView />
  // Sesión OK pero el perfil aún no cargó (o falló): loader acotado, no "Cargando…" infinito.
  if (!perfil && (perfilLoading || perfilError)) return <CargandoPerfil error={perfilError} onRetry={refetchPerfil} />
  if (!aprobado) return <PendienteView />

  return (
    <CatalogProvider>
      <GpsProvider>
        <AuthedApp />
      </GpsProvider>
    </CatalogProvider>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <DeviceProvider>
        <AuthProvider>
          <ErrorBoundary>
            <Gate />
          </ErrorBoundary>
          <UpdatePrompt />
          <DeviceBanner />
        </AuthProvider>
      </DeviceProvider>
    </ThemeProvider>
  )
}
