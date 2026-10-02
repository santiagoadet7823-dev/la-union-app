/**
 * Qué roles RASTREA la app: los que publican su posición en `posiciones` (`GpsContext`: vendedor,
 * repartidor y encargado). Admin, superadmin y marketing no salen a la calle ni se rastrean (db/38).
 *
 * Vive acá y no en `features/admin/usuarios/modelo.js` porque lo necesita `features/perfil/MiCuenta`,
 * que va en el bundle de arranque: importar `modelo.js` desde ahí arrastraba `services/gpsPerfil`
 * entero (+5,6 kB al bundle principal). `modelo.js` lo re-exporta, así que la fuente sigue siendo
 * una sola y sus consumidores no cambian.
 */
export const ROLES_RASTREADOS = ['vendedor', 'repartidor', 'encargado']
export const esRastreado = (rol) => ROLES_RASTREADOS.includes(rol)

/**
 * NOMBRE VISIBLE DE CADA ROL, y el color de su chip (01/10/2026, bloque C4 del rediseño).
 *
 * Estaba escrito CUATRO veces con diferencias: `ROLE_LABEL` de MiCuenta, `ROLE_META` de AppShell
 * (sin marketing: el chip decía "marketing" en minúscula), `ROLE_LABEL` de MiPerfilModal (sin
 * marketing tampoco) y un `roleLabel` en línea en cada supervisión (solo los tres gestores). Es la
 * regla 31 del CLAUDE.md aplicada a un texto: una sola tabla, y el que agregue un rol lo agrega acá.
 *
 * ⚠️ `features/admin/usuarios/modelo.js` tiene su propia tabla de la pantalla de Equipo; no se tocó
 * en este bloque (la pantalla es de otro frente). Unificarla es el paso siguiente.
 */
export const ROLE_LABEL = {
  superadmin: 'Superadmin',
  admin: 'Administrador',
  encargado: 'Encargado',
  vendedor: 'Vendedor',
  repartidor: 'Repartidor',
  marketing: 'Marketing',
}

// Color del punto del chip de rol (AppShell). Solo tokens: el rol no es un estado, así que repite
// el acento salvo donde ya había una distinción que la gente reconoce (vendedor verde, repartidor ocre).
export const ROLE_COLOR = {
  superadmin: 'var(--info)',
  admin: 'var(--primary)',
  encargado: 'var(--primary)',
  vendedor: 'var(--success)',
  repartidor: 'var(--warning)',
  marketing: 'var(--primary)',
}

/** Nombre visible de un rol; si no está en la tabla, el rol tal cual (o "—"). */
export const etiquetaRol = (rol) => ROLE_LABEL[rol] || rol || '—'
