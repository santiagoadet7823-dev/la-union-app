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

export type P = { lat: number; lng: number; ts?: string; acc?: number }

export const GAP_MAX = 1500      // m: salto mayor a esto → corta el trazo en dos segmentos
export const GAP_MS = 240000     // 4 min sin un solo fix → corta también (mismo umbral que lib/geo.limpiarTrazo)
export const STATIONARY_R = 40   // m: si la MEDIANA de distancia al centro es menor → estático (no rutear)
export const MIN_SEP = 25        // m: descarta puntos más cercanos que esto al anterior (jitter)
export const MAX_WP = 90         // waypoints máx por consulta /route
export const SPEED_MAX = 3.3     // m/s (~12 km/h): más rápido que esto = vehículo → motor de auto

/**
 * 🩸 PRECISIÓN QUE SEPARA UN FIX DE GPS DE UNO TRIANGULADO (ALGO 9, 03/08/2026).
 *
 * El uploader nativo descarta todo fix peor que 30 m (`gpsConfig.ACCURACY_MAX_M`), así que hasta hoy
 * en `posiciones` NO EXISTE un solo punto con `accuracy > 30`. Desde 1.9.0 sí: cuando el GPS se
 * calla más de 90 s, el teléfono triangula por antenas y WiFi para no dejar el hueco vacío. Esos
 * puntos valen para decir "por acá anduvo", y no valen para NADA más — con ±80 m de error no se
 * puede elegir una calle. Por eso quedan afuera del ruteo, y la precisión misma es la marca: no hizo
 * falta una columna nueva.
 */
export const ACC_GPS_MAX = 30

/**
 * 🩸 EL TRAMO A CIEGAS: LO QUE HACE QUE RUTEAR SEA INVENTAR (ALGO 9, 03/08/2026).
 *
 * Medido el 03/08/2026 sobre el día real de los tres vendedores de la empresa: con "Calles"
 * prendido el trazo dibujado medía ×1,63 · ×1,48 · ×1,75 el crudo del mismo día. O sea que entre el
 * 48 % y el 75 % del recorrido lo estaba inventando OSRM. La causa no es el motor —el de ALGO 8 es
 * el correcto— sino la ENTRADA: ese día el teléfono se calló de a 1 a 5 minutos por vez, y los
 * waypoints quedaron a 100-340 m unos de otros. `/route` entre dos puntos así no reconstruye nada:
 * elige el camino más corto y teje por calles por las que la persona no pasó. Ese es el zigzag.
 *
 * 🩸 Y EL CRITERIO ES EL TIEMPO, NO LA DISTANCIA. La primera versión de esta guarda miraba la
 * separación mediana en metros, y NO HABRÍA ATAJADO NI UN CASO: la mediana de Gabriel ese día es
 * 7,8 m —muy por debajo de cualquier techo razonable— porque los racimos de cuando está parado la
 * hunden, y los saltos ciegos quedan escondidos en la cola de la distribución.
 *
 * Lo que de verdad separa el caso bueno del malo:
 *   · en RUTA a 100 km/h, 130 m entre puntos se hacen en 5 s — y ahí OSRM da ×1,003, porque el
 *     camino es uno solo y no hay nada que adivinar;
 *   · en el PUEBLO, 200 m tardan 100 s — o sea que perdimos el teléfono, y entre esos dos puntos
 *     hay una grilla de calles donde cualquier camino es igual de plausible.
 * La distancia es la misma; lo que cambia es si hubo o no observación en el medio. Entonces se mide
 * el TIEMPO del salto, y se rutea solo si la mayor parte del tramo está efectivamente observada.
 *
 * CALIBRACIÓN, medida sobre los cuatro teléfonos que trabajaron el 03/08/2026 — qué porcentaje del
 * largo de su día se recorrió a ciegas:
 *   Gabriel Tevez 80,6 %  ·  Emanuel Arias 23,3 %  ·  Luis Mendoza 9,0 %  ·  Orlando Chavez 0,4 %
 * El 35 % cae justo entre el único teléfono que está fallando y los tres que andan bien: tres de los
 * cuatro días se siguen pegando a la calle, y el que no tiene datos se dibuja crudo. Si algún día
 * TODOS quedan crudos, el umbral está mal — pero antes de aflojarlo hay que mirar si lo que se rompió
 * es la captura.
 */
export const HUECO_CIEGO_MS = 45000   // más de 45 s sin un fix: lo que pasó en el medio no se sabe
export const CIEGO_MAX_FRAC = 0.35    // si más de un tercio del largo es ciego, no hay qué reconstruir

/** Racimo: puntos a menos de esto y dentro de esta ventana son "el mismo lugar" (ver promediarRacimos). */
export const RACIMO_R = 12
export const RACIMO_MS = 120000

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
 * Se queda con los fixes de GPS y aparta los triangulados por red. Los apartados NO se pierden: el
 * front los dibuja punteados (ver `limpiarTrazo` en lib/geo.js). Acá se van porque el ruteo con
 * ellos adentro sería peor que sin ellos — un punto de ±80 m arrastra la ruta a la calle de al lado.
 */
export const soloGps = (pts: P[]) => pts.filter((p) => p.acc == null || p.acc <= ACC_GPS_MAX)

/**
 * Qué fracción del LARGO de este tramo se recorrió a ciegas (sin un fix por más de HUECO_CIEGO_MS).
 * 0 = todo observado; 1 = no vimos nada en el medio. Es la entrada de la guarda que decide si vale
 * la pena rutear — ver el comentario de HUECO_CIEGO_MS.
 *
 * Se mide sobre el largo y no sobre la cantidad de hops a propósito: dos saltos ciegos de 200 m
 * pesan más que veinte pasitos observados de 9 m, que es exactamente el orden correcto.
 */
export function fraccionCiega(pts: P[]): number {
  let total = 0, ciego = 0
  for (let i = 1; i < pts.length; i++) {
    const d = hav(pts[i - 1], pts[i])
    total += d
    const dt = ms(pts[i]) - ms(pts[i - 1])
    if (Number.isFinite(dt) && dt > HUECO_CIEGO_MS) ciego += d
  }
  return total > 0 ? ciego / total : 0
}

/**
 * 🩸 EL RACIMO DE CUANDO ESTÁ PARADO, PROMEDIADO EN VEZ DE ADELGAZADO (ALGO 9, 03/08/2026).
 *
 * Parado en un cliente, el GPS deja un puñado de fixes desparramados en unos metros. `thin()` ya los
 * adelgaza, pero adelgazar CONSERVA UNO DE ELLOS —el primero— y ese bien puede ser el que está más
 * afuera: el garabato queda igual, solo que con menos puntos. Lo mismo vale para `simplificarTrazo`
 * (RDP) del lado del front, que por definición conserva los extremos, o sea justo los outliers.
 *
 * El centroide PESADO POR PRECISIÓN es lo que de verdad los colapsa: un fix de 3 m pesa cien veces
 * más que uno de 25 m (peso 1/acc²: es el error el que crece, y la varianza va con el cuadrado). Y
 * de paso le deja al ruteo waypoints limpios, así que más tramos pasan la guarda de dispersión.
 *
 * El racimo se mide siempre contra el PRIMER punto, nunca contra el centroide que se va moviendo:
 * si no, una caminata lenta encadenaría racimo tras racimo y se comería el trazo.
 *
 * 🩸 Y LA CERCANÍA SOLA NO ALCANZA (probado el 03/08/2026 antes de desplegar). Con radio de 12 m,
 * una caminata lenta —11 m entre puntos, que es la densidad que tanto costó conseguir— caía adentro
 * del racimo y se comía la MITAD de los puntos. Lo que separa "parado" de "caminando despacio" no es
 * la distancia entre fixes sino si AVANZAN: parado, los puntos oscilan alrededor de un centro y el
 * desplazamiento neto es mucho menor que el camino recorrido; caminando, neto ≈ camino. Por eso solo
 * se promedia si el neto es menos de la mitad del camino, y con 3 puntos como mínimo: dos fixes no
 * son evidencia de nada.
 *
 * El `ts` que sale es el del punto del MEDIO del racimo, no el primero ni el último: es el menos
 * sesgado para la velocidad que después calcula `splitModo`, y mantiene el orden temporal.
 */
export function promediarRacimos(pts: P[]): P[] {
  if (pts.length < 3) return pts.slice()
  const out: P[] = []
  let i = 0
  while (i < pts.length) {
    const base = pts[i]
    const t0 = ms(base)
    let j = i + 1
    while (j < pts.length && hav(base, pts[j]) <= RACIMO_R) {
      const t = ms(pts[j])
      if (Number.isFinite(t0) && Number.isFinite(t) && t - t0 > RACIMO_MS) break
      j++
    }
    const racimo = pts.slice(i, j)
    // ¿Oscila o avanza? Neto contra camino: ver el 🩸 de arriba.
    const avanza = racimo.length < 3 || hav(racimo[0], racimo[racimo.length - 1]) > 0.5 * segLenP(racimo)
    if (avanza) { out.push(base); i++; continue }
    {
      // Peso 1/acc², con piso de 1 m para no dividir por cero ni dejar que un fix "perfecto"
      // se lleve el racimo entero. Sin `acc` (dato viejo) el peso es 1: promedio simple.
      let wl = 0, wg = 0, w = 0
      for (const p of racimo) {
        const a = p.acc != null && p.acc > 1 ? p.acc : 1
        const k = p.acc == null ? 1 : 1 / (a * a)
        wl += p.lat * k; wg += p.lng * k; w += k
      }
      const medio = racimo[Math.floor(racimo.length / 2)]
      out.push({ lat: wl / w, lng: wg / w, ts: medio.ts, acc: median(racimo.map((p) => p.acc ?? 0)) })
    }
    i = j
  }
  return out
}

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
 * como UN segmento; y como después se descarta el ruteo de cualquier segmento de más de 4 km, el
 * día completo caía en esa guarda y se dibujaba crudo. Medido: la jornada del 29/07/2026
 * de un vendedor mide 73,5 km en un solo segmento. O sea que prender "Calles" no pegaba NADA a las
 * calles, en ningún día real, desde que existe el botón.
 *
 * La causa es que un día mezcla dos cosas distintas: caminar por el pueblo (que sí hay que rutear
 * con perfil peatón) y manejar entre localidades (que hay que rutear con perfil AUTO desde ALGO 8;
 * antes se dejaba crudo porque el perfil peatón inventa calles a esa velocidad). Cortar por tiempo
 * no las separa —el flujo de puntos es continuo— así que hay que cortar por VELOCIDAD.
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
