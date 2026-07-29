/**
 * Geometría pura de snap-recorridos: cortar la jornada en tramos ruteables.
 *
 * Está separada de index.ts por una razón práctica: es la parte con lógica de verdad (y la que se
 * equivocó durante meses sin que nadie lo notara — ver `splitModo`), y acá se puede PROBAR sin
 * levantar Deno ni Supabase. index.ts queda con lo que no se puede testear sin red: auth, consultas
 * y el fetch a OSRM.
 *
 * Un import relativo DENTRO de la carpeta de la función es seguro para el deploy; lo que no se
 * puede es importar entre carpetas de functions distintas (ver el encabezado de push-actualizacion).
 */

export type P = { lat: number; lng: number; ts?: string }

export const GAP_MAX = 1500      // m: salto mayor a esto → corta el trazo en dos segmentos
export const GAP_MS = 240000     // 4 min sin un solo fix → corta también (mismo umbral que lib/geo.limpiarTrazo)
export const STATIONARY_R = 40   // m: si la MEDIANA de distancia al centro es menor → estático (no rutear)
export const MIN_SEP = 25        // m: descarta puntos más cercanos que esto al anterior (jitter)
export const MAX_WP = 90         // waypoints máx por consulta /route
export const SPEED_MAX = 3.3     // m/s (~12 km/h): más rápido que esto = vehículo (el perfil peatón inventa calles)

export const hav = (a: P, b: P) => {
  const R = 6371000, d = Math.PI / 180
  const dlat = (b.lat - a.lat) * d, dlng = (b.lng - a.lng) * d
  const s = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dlng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }

/** ¿Todo este tramo es el mismo lugar? Mediana de distancias al centro (robusta a outliers). */
export function isStationary(pts: P[]): boolean {
  const center = { lat: median(pts.map((p) => p.lat)), lng: median(pts.map((p) => p.lng)) }
  return median(pts.map((p) => hav(center, p))) < STATIONARY_R
}

export const ms = (p: P) => (p.ts ? new Date(p.ts).getTime() : NaN)

/**
 * Corta por HUECO: salto grande en el espacio o silencio largo en el tiempo. El corte temporal se
 * agregó el 30/07/2026 — sin él, un GPS que se pierde 6 minutos quedaba dentro del mismo segmento
 * y OSRM tenía que inventar cómo unir sus dos extremos.
 */
export function splitGaps(pts: P[]): P[][] {
  if (!pts.length) return []
  const segs: P[][] = []; let cur: P[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const dt = ms(pts[i]) - ms(pts[i - 1])
    if (hav(pts[i - 1], pts[i]) > GAP_MAX || dt > GAP_MS) { segs.push(cur); cur = [pts[i]] } else cur.push(pts[i])
  }
  segs.push(cur); return segs
}

/**
 * 🩸 CORTE POR MODO — el arreglo que hace que el botón "Calles" exista de verdad (30/07/2026).
 *
 * Hasta hoy el día se cortaba SOLO por saltos de más de 1500 m, así que una jornada entera quedaba
 * como UN segmento; y como después se descarta el ruteo de cualquier segmento de más de DRIVE_LEN
 * (4 km), el día completo caía en esa guarda y se dibujaba crudo. Medido: la jornada del 29/07/2026
 * de un vendedor mide 73,5 km en un solo segmento. O sea que prender "Calles" no pegaba NADA a las
 * calles, en ningún día real, desde que existe el botón.
 *
 * La causa es que un día mezcla dos cosas distintas: caminar por el pueblo (que sí hay que rutear
 * con perfil peatón) y manejar entre localidades (que hay que dejar crudo, porque el perfil peatón
 * inventa calles a esa velocidad). Cortar por tiempo no las separa —el flujo de puntos es continuo—
 * así que hay que cortar por VELOCIDAD.
 *
 * La clasificación se SUAVIZA con una ventana de 3 hops: un solo fix rápido en medio de una
 * caminata (o un semáforo en medio de un viaje) no puede partir el tramo en tres.
 */
export function splitModo(seg: P[]): { pts: P[]; auto: boolean }[] {
  // Con 2 puntos no hay ventana que suavizar, pero sí hay un hop: se clasifica igual. Sin esto un
  // salto de 500 m en 10 s (o sea, un auto) entraría al ruteo peatón por no tener tercer punto.
  if (seg.length < 3) {
    if (seg.length < 2) return [{ pts: seg, auto: false }]
    const dt = (ms(seg[1]) - ms(seg[0])) / 1000
    return [{ pts: seg, auto: dt > 0 && hav(seg[0], seg[1]) / dt > SPEED_MAX }]
  }
  // Un valor por HOP (seg.length - 1): ¿este tramo entre dos puntos fue a velocidad de vehículo?
  const rapido: boolean[] = []
  for (let i = 1; i < seg.length; i++) {
    const dt = (ms(seg[i]) - ms(seg[i - 1])) / 1000
    rapido.push(dt > 0 ? hav(seg[i - 1], seg[i]) / dt > SPEED_MAX : false)
  }
  // Mayoría en una ventana de 3 hops centrada.
  const suave = rapido.map((_, i) => {
    let n = 0, t = 0
    for (let j = Math.max(0, i - 1); j <= Math.min(rapido.length - 1, i + 1); j++) { t++; if (rapido[j]) n++ }
    return n * 2 > t
  })
  const runs: { pts: P[]; auto: boolean }[] = []
  let cur: P[] = [seg[0]]
  let modo = suave[0]
  for (let i = 0; i < suave.length; i++) {
    if (suave[i] !== modo) {
      runs.push({ pts: cur, auto: modo })
      cur = [seg[i]] // el punto de la bisagra pertenece a los DOS tramos: si no, quedan despegados
      modo = suave[i]
    }
    cur.push(seg[i + 1])
  }
  runs.push({ pts: cur, auto: modo })
  // Tramos de un solo punto: se absorben en el anterior antes que quedar sueltos.
  const out: { pts: P[]; auto: boolean }[] = []
  for (const r of runs) {
    if (r.pts.length < 2 && out.length) out[out.length - 1].pts.push(...r.pts)
    else out.push(r)
  }
  return out
}

/** Firma de un tramo, para cachearlo por separado. Ver el bloque de cache incremental de index.ts. */
export const firmaRun = (r: P[]) => `${r[0]?.ts || ''}|${r[r.length - 1]?.ts || ''}|${r.length}`

/** Adelgaza el jitter: descarta puntos a menos de MIN_SEP del último conservado. */
export function thin(pts: P[]): P[] {
  if (pts.length <= 2) return pts.slice()
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) if (hav(out[out.length - 1], pts[i]) >= MIN_SEP) out.push(pts[i])
  out.push(pts[pts.length - 1]); return out
}

/** Recorta a MAX_WP waypoints (el techo de una consulta /route), conservando los extremos. */
export function cap(pts: P[]): P[] {
  if (pts.length <= MAX_WP) return pts
  const step = pts.length / MAX_WP, out: P[] = []
  for (let i = 0; i < MAX_WP; i++) out.push(pts[Math.floor(i * step)])
  out[out.length - 1] = pts[pts.length - 1]; return out
}

// Longitud de un rastro crudo (P[]) y de una geometría ruteada ([lat,lng][]).
export const segLenP = (s: P[]) => { let L = 0; for (let i = 1; i < s.length; i++) L += hav(s[i - 1], s[i]); return L }
export const pathLenLL = (g: number[][]) => { let L = 0; for (let i = 1; i < g.length; i++) L += hav({ lat: g[i - 1][0], lng: g[i - 1][1] }, { lat: g[i][0], lng: g[i][1] }); return L }
