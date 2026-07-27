/**
 * Comparación de versiones "x.y.z" por tramos NUMÉRICOS. Devuelve <0, 0 o >0.
 *
 * NO comparar versiones como strings: '1.5.9' > '1.5.42' en orden lexicográfico
 * (el '9' > '4'), y eso hacía que un equipo con 1.5.9 pareciera más nuevo que uno
 * con 1.5.42. Tolera null/faltantes tratándolos como 0.
 *
 * Vive acá (y no duplicado) porque lo usan tanto la supervisión (EstadoEquipo, para
 * marcar equipos atrasados) como el updater de APK (services/apkUpdate, para decidir
 * si hay que reinstalar).
 */
export function cmpVer(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}
