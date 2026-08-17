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
// 16 colores elegidos para ser lo más DISTINTOS posible entre sí (antes eran 10 y varios
// azules/verdes se confundían). Hues repartidos por toda la rueda + dos tonos "no arcoíris"
// (marrón, pizarra) para sumar variedad. Si aún así dos vendedores caen en colores parecidos,
// el superadmin puede fijar el color a mano (perfiles.color_trazo, ver UsuariosView).
export const PALETA = [
  '#E11D48', // rojo
  '#F97316', // naranja
  '#F59E0B', // ámbar
  '#EAB308', // amarillo
  '#84CC16', // lima
  '#22C55E', // verde
  '#0D9488', // teal
  '#06B6D4', // cian
  '#0EA5E9', // celeste
  '#2563EB', // azul
  '#6366F1', // índigo
  '#8B5CF6', // violeta
  '#C026D3', // magenta
  '#EC4899', // rosa
  '#9A3412', // marrón
  '#475569', // pizarra
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
