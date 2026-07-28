/**
 * Menú de GESTIÓN: qué pantallas existen y quién puede abrirlas.
 *
 * Esta tabla estaba DUPLICADA byte a byte en `SupervisionMovil.jsx` y `SupervisionDesktop.jsx`
 * (las dos vistas no comparten una sola línea de código). `CLAUDE.md §4` ya lo marcaba como deuda
 * con un "⚠️ están duplicadas — cambiar las dos". Se unificó acá el 28/07/2026, antes de tocar el
 * modelo de permisos: sumar un permiso nuevo en dos lugares y olvidarse de uno da un agujero
 * silencioso — la pantalla aparece en un canal y en el otro no.
 *
 * `roles`   → quién la ve por ser lo que es.
 * `permiso` → quién la ve por tener un permiso EXTRA, sin importar su rol (`perfiles.permisos`).
 *             Es lo que deja que un vendedor edite el catálogo sin dejar de ser vendedor.
 */
export const GESTION_ITEMS = [
  { key: 'clientes', label: 'Clientes', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'duplicados', label: 'Revisar repetidos', roles: ['admin', 'superadmin'] },
  { key: 'zonas', label: 'Zonas', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'catalogo', label: 'Catálogo', roles: ['encargado', 'admin', 'superadmin'], permiso: 'catalogo' },
  { key: 'faltante', label: 'Faltante', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'invitar', label: 'Invitar', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'usuarios', label: 'Usuarios', roles: ['admin', 'superadmin'] },
  { key: 'empresas', label: 'Empresas', roles: ['superadmin'] },
]

export const GESTION_TITLES = Object.fromEntries(GESTION_ITEMS.map((i) => [i.key, i.label]))

/**
 * Ítems visibles para un rol + sus permisos extra.
 *
 * `permisos` puede llegar `undefined`: el perfil se cachea local y una caché escrita antes de que
 * existiera la columna no la trae. Por eso el default y no un `permisos.includes` directo.
 */
export function itemsDeGestion(rol, permisos = []) {
  const p = Array.isArray(permisos) ? permisos : []
  return GESTION_ITEMS.filter((it) => it.roles.includes(rol) || (it.permiso && p.includes(it.permiso)))
}
