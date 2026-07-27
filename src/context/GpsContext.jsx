import { createContext, useContext, useEffect } from 'react'
import { useAuth } from './AuthContext'
import { usePublishPosition } from '../hooks/usePublishPosition'
import { useEstadoDispositivo } from '../hooks/useEstadoDispositivo'
import { initPush } from '../services/push'
import { initAlarm } from '../services/alarm'
import { chequearYNotificarUpdate } from '../services/updateNotify'
import { isNative } from '../services/platform'

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

  // Latido de salud del dispositivo (para el informe "por qué no llega la señal").
  useEstadoDispositivo({ enabled: esMovil, id, idEmpresa, rol, pos: gps.pos, error: gps.error })

  // Watchdog por push (FCM): registra el token para que el backend pueda despertar la app cada
  // ~30 min. Solo en la APK y para roles móviles. Al recibir el ping, disparamos un
  // visibilitychange sintético → refresca el latido Y destapa las colas (mismo handler que ya
  // corre al volver a primer plano). Ver services/push.js.
  useEffect(() => {
    if (!esMovil || !isNative()) return
    const despertar = () => {
      try { document.dispatchEvent(new Event('visibilitychange')) } catch (_) {}
      // En cada despertar del watchdog, avisar si hay versión nueva (solo en horario). Best-effort.
      chequearYNotificarUpdate(id)
    }
    // Canal 1 — push FCM: despierta cada ~30 min PERO necesita internet.
    initPush(despertar)
    // Canal 2 — alarma local (AlarmManager): despierta cada ~30 min SIN internet, dentro de la
    // ventana horaria de trabajo (así no molesta de madrugada). Cubre el caso "apagó los datos".
    // Ventana SUPERSET (6–24): con las categorías de rastreo por usuario (Feature D) hay jornadas
    // que llegan hasta las 24:00; el wake nativo debe cubrirlas. El corte fino real lo hace el
    // gating JS (enHorario en usePublishPosition) según la ventana efectiva de cada usuario.
    initAlarm(despertar, { intervaloMin: 30, horaInicio: 6, horaFin: 24 })
  }, [esMovil])

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
