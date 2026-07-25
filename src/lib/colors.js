/**
 * Color estable por identificador (id de usuario). Sirve para diferenciar en el
 * mapa a cada vendedor/repartidor con un color propio y consistente entre el
 * marcador en vivo, la etiqueta y la reproducción de su jornada.
 *
 * Por defecto es determinístico (hash del id → paleta), pero el superadmin puede
 * FIJAR el color de un usuario a mano (perfiles.color_trazo). El override se hidrata
 * con `hydrateColores()` desde usePerfilesEquipo y `colorPorId` lo consulta primero:
 * así los 7 call sites que solo pasan `id` toman el color elegido sin tocarse.
 */
export const PALETA = [
  '#0EA5E9', // celeste
  '#F59E0B', // ámbar
  '#10B981', // verde
  '#EF4444', // rojo
  '#8B5CF6', // violeta
  '#EC4899', // rosa
  '#14B8A6', // teal
  '#F97316', // naranja
  '#6366F1', // índigo
  '#84CC16', // lima
]

// id (string) -> '#RRGGBB' elegido a mano por el superadmin. Vive a nivel de módulo, como la caché
// de usePerfilesEquipo: lo comparten todos los call sites de colorPorId sin pasar props extra.
const overrides = new Map()

/**
 * Refresca el mapa de overrides desde las filas de `perfiles` (que traen `color_trazo`).
 * Un `color_trazo` nulo/ausente borra el override → el usuario vuelve al color por hash.
 * Idempotente: se puede llamar en cada fetch de usePerfilesEquipo.
 */
export function hydrateColores(perfiles) {
  for (const p of perfiles || []) {
    if (p && p.color_trazo) overrides.set(String(p.id), p.color_trazo)
    else if (p) overrides.delete(String(p.id))
  }
}

export function colorPorId(id) {
  if (!id) return PALETA[0]
  const manual = overrides.get(String(id))
  if (manual) return manual // elegido por el superadmin, gana sobre el hash
  let h = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETA[h % PALETA.length]
}
