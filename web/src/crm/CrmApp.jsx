import { useCallback, useEffect, useState } from 'react'
import { ThemeProvider } from '../context/ThemeContext'
import { AuthProvider, useAuth } from '../context/AuthContext'
import { TenantProvider } from '../context/TenantContext'
import ErrorBoundary from '../components/ErrorBoundary'
import LoginView from '../features/auth/LoginView'
import PendienteView from '../features/auth/PendienteView'
import CambioContrasenaObligatorio from '../features/auth/CambioContrasenaObligatorio'
import MfaActivar from '../features/auth/MfaActivar'
import MfaVerificar from '../features/auth/MfaVerificar'
import AceptarPolitica from '../features/auth/AceptarPolitica'
import { supabase } from '../services/supabase'
import Escritorio from './Escritorio'

/**
 * CRM de WhatsApp (crm.dist-at.com, plan 41 paso 4).
 *
 * El ingreso es EL MISMO de la app (AuthContext: Google o usuario y contraseña, 2FA, política,
 * cambio de contraseña obligatorio): se reusan las pantallas tal cual, en el mismo orden que el
 * `Gate` de `App.jsx`. Lo único propio es la última puerta: `crm_acceso()` ('operar' | 'ver' | null).
 * El rol solo no alcanza (db/104): sin el permiso `crm` o `crm_ver` en el perfil no se entra.
 */
function Centro({ children }) {
  return <div className="crm-centro">{children}</div>
}

function SinAcceso() {
  const { signOut, perfil } = useAuth()
  return (
    <Centro>
      <div className="crm-tarjeta" style={{ maxWidth: 420 }}>
        <div className="crm-marca">DisT-At <span>CRM</span></div>
        <h1 className="crm-h1">No tenés acceso al CRM</h1>
        <p className="crm-muted">
          Tu usuario{perfil?.nombre ? ` (${perfil.nombre})` : ''} entra a DisT-At, pero no tiene el permiso del CRM de
          WhatsApp. Pedíselo al administrador de tu empresa.
        </p>
        <button className="crm-btn" onClick={signOut}>Cerrar sesión</button>
      </div>
    </Centro>
  )
}

function Esperando({ texto, error, onRetry }) {
  return (
    <Centro>
      <div className="crm-muted crm-mono">{error ? `No pudimos cargar ${texto}. Probá de nuevo.` : `Cargando ${texto}…`}</div>
      {error && <button className="crm-btn crm-btn-primario" onClick={onRetry}>Reintentar</button>}
    </Centro>
  )
}

function PuertaCrm() {
  const { user } = useAuth()
  const [acceso, setAcceso] = useState(undefined) // undefined = consultando
  const [error, setError] = useState(false)

  const consultar = useCallback(async () => {
    setError(false)
    setAcceso(undefined)
    const { data, error: e } = await supabase.rpc('crm_acceso')
    if (e) { setError(true); return }
    setAcceso(data || null)
  }, [])

  useEffect(() => { if (user?.id) consultar() }, [user?.id, consultar])

  if (acceso === undefined) return <Esperando texto="tu acceso al CRM" error={error} onRetry={consultar} />
  if (!acceso) return <SinAcceso />
  return (
    <TenantProvider>
      <Escritorio acceso={acceso} />
    </TenantProvider>
  )
}

function Gate() {
  const { loading, session, aprobado, perfil, perfilLoading, perfilError, refetchPerfil, mfaNivel, mfaSiguiente,
    mfaError, refetchMfa, mfaObligatoria, politicaPendiente, politicaError, refetchPolitica } = useAuth()

  if (loading) return <Esperando texto="DisT-At" />
  if (!session) return <LoginView />
  if (!perfil && (perfilLoading || perfilError)) return <Esperando texto="tu perfil" error={perfilError} onRetry={refetchPerfil} />
  if (!aprobado) return <PendienteView />
  if (perfil?.debe_cambiar_contrasena) return <CambioContrasenaObligatorio />
  if (mfaNivel === null) return <Esperando texto="tu verificación" error={mfaError} onRetry={refetchMfa} />
  if (mfaNivel === 'aal1' && mfaSiguiente === 'aal1') {
    if (mfaObligatoria === null) return <Esperando texto="la configuración de seguridad" error={politicaError} onRetry={refetchPolitica} />
    if (mfaObligatoria) return <MfaActivar />
  }
  if (mfaSiguiente === 'aal2' && mfaNivel !== 'aal2') return <MfaVerificar />
  if (politicaPendiente === null) return <Esperando texto="tu estado de aceptación" error={politicaError} onRetry={refetchPolitica} />
  if (politicaPendiente) return <AceptarPolitica />
  return <PuertaCrm />
}

export default function CrmApp() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ErrorBoundary>
          <Gate />
        </ErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  )
}
