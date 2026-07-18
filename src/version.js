/**
 * Versión de la app instalada. Se compara contra `app_config.latest_version` en
 * Supabase para avisar (en el APK) que hay una versión nueva. SUBIR este número
 * en cada release del APK y actualizar `latest_version` en la tabla `app_config`.
 */
export const APP_VERSION = '1.5.23'
