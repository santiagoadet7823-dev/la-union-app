import { createContext, useContext } from 'react'
import { useDeviceMode } from '../hooks/useDeviceMode'

/**
 * Modo de dispositivo compartido por toda la app (panel responsive). Lo consumen
 * AdminView y sus subvistas para colapsar los layouts de escritorio en celular.
 */
const DeviceContext = createContext(null)

export function DeviceProvider({ children }) {
  const value = useDeviceMode()
  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>
}

export function useDevice() {
  const ctx = useContext(DeviceContext)
  if (!ctx) throw new Error('useDevice debe usarse dentro de <DeviceProvider>')
  return ctx
}
