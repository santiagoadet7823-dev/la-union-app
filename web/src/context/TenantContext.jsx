import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { supabase, hasSupabase } from '../services/supabase'
import { invalidarTrackCache } from '../services/tracking'
import { invalidarPerfilesEquipo } from '../hooks/usePerfilesEquipo'

/**
 * Empresa que se está MIRANDO. Fase 7 de PLAN_SAAS.md §3.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * 🚨 REGLA 11 — ESTO LO CONSUMEN SOLO LAS RUTAS DE LECTURA. NO HAY EXCEPCIONES.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 *
 * `AuthContext.idEmpresa` sigue siendo la empresa de IDENTIDAD y no cambia nunca. Estos archivos
 * tienen que seguir leyendo `useAuth()` y están marcados NO TOCAR:
 *
 *   GpsContext.jsx · GpsGate.jsx · usePublishPosition.js · geolocation/tracker.js ·
 *   useEstadoDispositivo.js · vendedor/useJornada.js · los inserts de CatalogContext.jsx ·
 *   admin/UsuariosView.jsx · las rutas de Storage `${idEmpresa}/…`
 *
 * Si el scope llegara a la escritura de GPS, un superadmin mirando otra empresa escribiría SUS
 * propias posiciones dentro de los datos de ese cliente. Y `posiciones` no tiene policy de UPDATE
 * ni de DELETE (verificado en base viva, 30/07/2026): esa fila no se puede corregir ni borrar
 * desde el cliente. Es irreversible, y por eso la regla es tan terminante.
 *
 * ── Por qué esto es solo JS ────────────────────────────────────────────────────────────────
 * RLS **ya** deja al superadmin leer todos los tenants: `posiciones_sel`, `perfiles_sel`,
 * `estado_disp_sel` y `empresas_sel` arrancan todas con `es_superadmin()` como disyunción. Lo
 * único que se lo tapaba era el `.eq('id_empresa')` del frontend, puesto a propósito como defensa
 * en profundidad (ver el comentario de useEquipoEnVivo.js:17-20). Este contexto no abre ningún
 * permiso nuevo: elige cuál de los que ya tiene se usa.
 *
 * ── El valor `TODAS` ───────────────────────────────────────────────────────────────────────
 * `idEmpresaActiva === TODAS` ('*') significa "sin filtro de empresa". Es un centinela con forma
 * de string y no `null` a propósito: media docena de hooks hacen `if (!idEmpresa) return` para
 * decir "todavía no sé quién soy", y un null ahí se leería como "no cargado" en vez de "todas".
 */
const TenantContext = createContext(null)

export const TODAS = '*'

export function TenantProvider({ children }) {
  const { idEmpresa, rol, user } = useAuth()
  const [empresas, setEmpresas] = useState([])
  const [activa, setActiva] = useState(null)

  // Solo el superadmin puede mirar otra empresa. No es una preferencia de UI: es el único rol al
  // que RLS le devuelve filas de otros tenants, así que para cualquier otro el selector mostraría
  // opciones que no producen datos.
  const esSuper = rol === 'superadmin'

  useEffect(() => {
    if (!hasSupabase || !esSuper) { setEmpresas([]); return }
    let vivo = true
    supabase.from('empresas').select('id, nombre').order('nombre')
      .then(({ data }) => { if (vivo) setEmpresas(data || []) })
    return () => { vivo = false }
  }, [esSuper])

  // Scope inicial: lo último elegido por ESTE usuario, o su empresa de identidad. La clave lleva
  // el userId para que dos cuentas en el mismo teléfono no se hereden el scope.
  const claveScope = user?.id ? `lu-empresa-activa-${user.id}` : null
  useEffect(() => {
    if (!idEmpresa) { setActiva(null); return }
    if (!esSuper) { setActiva(idEmpresa); return } // sin permiso de cambiar: siempre la propia
    let guardada = null
    try { guardada = claveScope ? localStorage.getItem(claveScope) : null } catch (_) { /* modo privado */ }
    setActiva(guardada || idEmpresa)
  }, [idEmpresa, esSuper, claveScope])

  /**
   * Cambiar de empresa mirada. La HIGIENE DE CACHÉS es la parte peligrosa (PLAN_SAAS §3.3): sin
   * esto se cambia de empresa y se siguen viendo los datos de la anterior, que es peor que no
   * tener el selector.
   *
   * `lu-recorridos-cache` NO hace falta borrarla acá: la lectura de `useRecorridosDelDia` valida
   * `cache.idEmpresa === idEmpresa` antes de hidratar, así que una entrada de otro tenant se
   * descarta sola (a lo sumo hay un cache-miss). Eso ya estaba resuelto y documentado ahí; lo que
   * NO estaba resuelto es lo de abajo.
   */
  const setEmpresaActiva = useCallback((id) => {
    if (!esSuper) return
    setActiva(id)
    try { if (claveScope) localStorage.setItem(claveScope, id) } catch (_) { /* modo privado */ }
    invalidarPerfilesEquipo()  // Map por empresa con TTL de 60 s: sin esto, un minuto de nombres viejos
    invalidarTrackCache()      // ventana de rastreo cacheada 4 min
  }, [esSuper, claveScope])

  // Al cerrar sesión se olvida el scope: si no, el próximo que entre en este dispositivo abriría
  // mirando la empresa que estaba viendo el anterior.
  useEffect(() => {
    if (user || !claveScope) return
    try { localStorage.removeItem(claveScope) } catch (_) { /* no pasa nada */ }
  }, [user, claveScope])

  const valor = useMemo(() => ({
    idEmpresaActiva: activa,
    empresasDisponibles: empresas,
    puedeCambiarScope: esSuper && empresas.length > 1,
    setEmpresaActiva,
    // Está mirando algo que NO es su empresa: lo consume el badge y lo que deshabilita las altas.
    esOverride: !!activa && activa !== idEmpresa,
    esTodas: activa === TODAS,
    nombreActiva: activa === TODAS
      ? 'Todas las empresas'
      : (empresas.find((e) => e.id === activa)?.nombre || null),
  }), [activa, empresas, esSuper, idEmpresa, setEmpresaActiva])

  return <TenantContext.Provider value={valor}>{children}</TenantContext.Provider>
}

/**
 * Scope de LECTURA. Fuera de un provider devuelve la empresa de identidad, así ninguna pantalla
 * se rompe por montarse en un árbol sin TenantProvider (y sigue viendo lo suyo, que es el
 * comportamiento seguro).
 */
export function useTenant() {
  const ctx = useContext(TenantContext)
  const { idEmpresa } = useAuth()
  if (ctx) return ctx
  return {
    idEmpresaActiva: idEmpresa,
    empresasDisponibles: [],
    puedeCambiarScope: false,
    setEmpresaActiva: () => {},
    esOverride: false,
    esTodas: false,
    nombreActiva: null,
  }
}
