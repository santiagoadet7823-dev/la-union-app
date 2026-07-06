import { createContext, useContext, useEffect, useState } from 'react'

export const ROLES = {
  vendedor: { id: 'vendedor', label: 'Vendedor', device: 'móvil' },
  repartidor: { id: 'repartidor', label: 'Repartidor', device: 'móvil' },
  admin: { id: 'admin', label: 'Admin', device: 'escritorio' },
}

const STORAGE_KEY = 'launion:currentRole'
const RoleContext = createContext(null)

export function RoleProvider({ children }) {
  const [currentRole, setCurrentRole] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved && ROLES[saved]) return saved
    } catch {
      /* noop */
    }
    return 'vendedor'
  })

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, currentRole)
    } catch {
      /* noop */
    }
  }, [currentRole])

  return (
    <RoleContext.Provider value={{ currentRole, setCurrentRole, roles: ROLES }}>
      {children}
    </RoleContext.Provider>
  )
}

export function useRole() {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole debe usarse dentro de <RoleProvider>')
  return ctx
}
