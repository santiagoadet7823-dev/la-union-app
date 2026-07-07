import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { supabase, hasSupabase } from '../services/supabase'

/**
 * Sesión + perfil del usuario (multi-tenant). El perfil trae {rol, id_empresa, activo}.
 * El acceso a la app se decide con esto: sin sesión → Login; sesión pendiente
 * (sin rol o inactivo) → Pendiente; ok → app según rol.
 */
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [perfil, setPerfil] = useState(null)
  const [loading, setLoading] = useState(true)

  const cargarPerfil = useCallback(async (userId) => {
    if (!userId) { setPerfil(null); return }
    const { data } = await supabase.from('perfiles').select('*').eq('id', userId).maybeSingle()
    setPerfil(data || null)
  }, [])

  useEffect(() => {
    if (!hasSupabase) { setLoading(false); return }
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await cargarPerfil(data.session?.user?.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s)
      await cargarPerfil(s?.user?.id)
      setLoading(false)
    })

    return () => { active = false; sub.subscription.unsubscribe() }
  }, [cargarPerfil])

  const signInWithGoogle = () =>
    supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + (import.meta.env.BASE_URL || '/') },
    })

  const signOut = () => supabase.auth.signOut()

  const value = {
    session,
    user: session?.user || null,
    perfil,
    rol: perfil?.rol || null,
    idEmpresa: perfil?.id_empresa || null,
    activo: !!perfil?.activo,
    aprobado: !!perfil?.activo && !!perfil?.rol,
    loading,
    hasSupabase,
    signInWithGoogle,
    signOut,
    refetchPerfil: () => cargarPerfil(session?.user?.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
