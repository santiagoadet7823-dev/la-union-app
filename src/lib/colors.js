/**
 * Color estable por identificador (id de usuario). Sirve para diferenciar en el
 * mapa a cada vendedor/repartidor con un color propio y consistente entre el
 * marcador en vivo, la etiqueta y la reproducción de su jornada.
 */
const PALETA = [
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

export function colorPorId(id) {
  if (!id) return PALETA[0]
  let h = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return PALETA[h % PALETA.length]
}
