import { createContext, useContext } from 'react'
import { useAuth } from './AuthContext'
import { usePublishPosition } from '../hooks/usePublishPosition'

/**
 * GPS compartido para las vistas móviles. Corre un único watch para el usuario
 * logueado (vendedor/repartidor) y publica/persiste su posición por movimiento.
 * El Admin no usa GPS.
 *
 * La identidad (id/nombre/rol/empresa) viene del perfil real de Supabase.
 */
const GpsContext = createContext(null)

export function GpsProvider({ children }) {
  const { user, perfil, rol, idEmpresa } = useAuth()
  // El encargado también es preventista y se trackea: publica su posición como los
  // roles móviles (aunque en modo "Panel" no haya GpsGate bloqueando la pantalla).
  const esMovil = rol === 'vendedor' || rol === 'repartidor' || rol === 'encargado'
  const id = user?.id || null
  const nombre = perfil?.nombre || user?.email || 'Usuario'

  // GPS obligatorio: siempre habilitado para roles móviles (sin toggle para apagarlo).
  const gps = usePublishPosition({ enabled: esMovil, id, rol, idEmpresa })

  return (
    <GpsContext.Provider value={{ ...gps, id, nombre, rol, idEmpresa, esMovil }}>
      {children}
    </GpsContext.Provider>
  )
}

export function useGps() {
  const ctx = useContext(GpsContext)
  if (!ctx) throw new Error('useGps debe usarse dentro de <GpsProvider>')
  return ctx
}
