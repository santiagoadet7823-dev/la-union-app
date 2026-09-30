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
