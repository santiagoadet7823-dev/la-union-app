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
 *
 * 🔴 `marketing` (12/08/2026) figura en UN SOLO ítem, y esa es toda su superficie de gestión. No es
 * un rol "chico de admin": no ve reportes, ni la cartera, ni zonas, ni usuarios, ni el mapa. Si
 * algún día aparece en una segunda fila de esta tabla, es una decisión de producto — escribirla
 * acá, no deducirla. Ver `db/38_rol_marketing.sql`.
 */
/**
 * GRUPOS (01/10/2026, decisión del dueño, pregunta 8 del brief v2; hoja "Cuenta y Navegación"
 * 4a/4b). Once pantallas en una sola lista plana no se recorrían: Gestión va en tres grupos, y el
 * mismo agrupamiento lo usan el destino Gestión de la APK (`SupervisionMovil`), el del panel de
 * dirección y los rótulos del sidebar de escritorio. Por eso vive en la tabla y no en cada pantalla
 * (regla 31: si cada una agrupara a su manera, un ítem nuevo caería en grupos distintos).
 *
 *   operacion → lo del día a día: reportes, pedidos, cartera, zonas, catálogo, faltante.
 *   equipo    → la gente: la ficha de cada uno ("Usuarios" pasa a llamarse "Equipo") e invitar.
 *   sistema   → mantenimiento de datos y de cuenta: repetidos, respaldo, empresas.
 *
 * Un ítem nuevo TIENE que decir su `grupo`: sin él no aparece en ninguna lista agrupada (y el
 * autochequeo de `gruposDeGestion` lo avisa en la consola de desarrollo).
 */
export const GESTION_GRUPOS = [
  { k: 'operacion', titulo: 'Operación' },
  { k: 'equipo', titulo: 'Equipo' },
  { k: 'sistema', titulo: 'Sistema' },
]

// El orden de esta tabla ES el orden en pantalla, dentro de cada grupo (hoja 4a).
export const GESTION_ITEMS = [
  { key: 'reportes', label: 'Reportes', grupo: 'operacion', roles: ['encargado', 'admin', 'superadmin'] },
  // Revisar y anular pedidos (db/45). El alcance real lo pone `pedidos_sel` en el servidor: el
  // encargado ve SOLO a su gente (`ids_a_mi_cargo()`), no toda la empresa. Esta tabla decide quién
  // ve la pantalla; la base decide qué hay adentro.
  { key: 'pedidos', label: 'Pedidos', grupo: 'operacion', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'clientes', label: 'Clientes', grupo: 'operacion', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'zonas', label: 'Zonas', grupo: 'operacion', roles: ['encargado', 'admin', 'superadmin'] },
  // Catálogo no figura en la hoja 4a (que dibuja 10 filas); va en Operación porque es trabajo del
  // día a día y porque es la ÚNICA fila de marketing y del vendedor con permiso `catalogo`.
  { key: 'catalogo', label: 'Catálogo', grupo: 'operacion', roles: ['encargado', 'admin', 'superadmin', 'marketing'], permiso: 'catalogo' },
  { key: 'faltante', label: 'Faltante', grupo: 'operacion', roles: ['encargado', 'admin', 'superadmin'] },
  // El encargado entra desde v1.5 (24/09/2026) en SOLO LECTURA: ve la ficha de su equipo sin un
  // solo control. Qué personas ve lo decide `perfiles_sel` (db/40, su nivel); que no pueda escribir
  // lo garantizan la RLS de `perfiles` y la guarda de db/77, no esta tabla.
  // El rótulo es "Equipo" desde el 01/10/2026 (decisión del dueño); la clave sigue siendo
  // `usuarios` para no tocar el despacho ni la pantalla (`UsuariosView`).
  { key: 'usuarios', label: 'Equipo', grupo: 'equipo', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'invitar', label: 'Invitar por QR', grupo: 'equipo', roles: ['encargado', 'admin', 'superadmin'] },
  { key: 'duplicados', label: 'Revisar repetidos', grupo: 'sistema', roles: ['admin', 'superadmin'] },
  // Respaldo mensual: los recorridos se purgan a los 45 días (db/42) y esto es la ÚNICA salida
  // del historial fuera de Supabase. Solo admin y superadmin — exporta la empresa entera.
  { key: 'respaldo', label: 'Respaldo', grupo: 'sistema', roles: ['admin', 'superadmin'] },
  { key: 'empresas', label: 'Empresas', grupo: 'sistema', roles: ['superadmin'] },
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

/**
 * Los mismos ítems de `itemsDeGestion`, en grupos: `[{ k, titulo, items: [...] }]`, sin grupos
 * vacíos (un encargado no tiene "Sistema"; marketing solo ve Operación → Catálogo).
 */
export function gruposDeGestion(rol, permisos = []) {
  const visibles = itemsDeGestion(rol, permisos)
  if (import.meta.env?.DEV) {
    const sinGrupo = visibles.filter((it) => !GESTION_GRUPOS.some((g) => g.k === it.grupo))
    if (sinGrupo.length) console.warn('[gestion] ítems sin grupo, no se van a ver agrupados:', sinGrupo.map((it) => it.key))
  }
  return GESTION_GRUPOS
    .map((g) => ({ ...g, items: visibles.filter((it) => it.grupo === g.k) }))
    .filter((g) => g.items.length > 0)
}
