// snap-recorridos — devuelve los recorridos del día "pegados a calles".
//
// UN MOTOR POR MODO (ALGO 8, 03/08/2026): los tramos a pie van a OSRM /route en **perfil PEATÓN**
// (FOSSGIS routed-foot) y los tramos en vehículo a **perfil AUTO** (routed-car). Hasta ALGO 7 había
// un solo perfil y todo lo que fuera en vehículo se dibujaba crudo.
//
// El perfil no es un detalle de configuración: MEDIDO el 03/08/2026 sobre un recorrido real de esta
// empresa, con el mismo pipeline y los mismos puntos —
//   · tramo de RUTA a ~98 km/h (crudo 26.223 m): perfil auto 26.307 m (×1,003) · peatón 1.491.289 m (×57)
//   · tramo A PIE en el pueblo (crudo 2.035 m):  perfil peatón 3.008 m (×1,48) · auto 9.242 m (×4,5)
// Cada motor acierta en su modo y delira en el otro, y la guarda anti-detour rechaza los dos casos
// malos. O sea: el modo elige el motor, y la guarda es la red por si el modo se equivocó.
//
// 🩸 QUE EL SNAP NO PUEDA INVENTAR (ALGO 9, 03/08/2026). Medido sobre el día real de los tres
// vendedores de la empresa, el trazo dibujado con "Calles" prendido medía ×1,63 · ×1,48 · ×1,75 el
// crudo del mismo día: entre el 48 % y el 75 % del recorrido lo estaba inventando OSRM, y eso es el
// "zigzag" que reportó el cliente. El motor era el correcto; el problema era la ENTRADA — el
// teléfono se callaba de a 1 a 5 minutos y `/route` entre dos puntos así no reconstruye: elige el
// camino más corto y teje por calles por las que nadie pasó. Tres cambios, en orden de importancia:
//   · guarda de TRAMO A CIEGAS: si la mayor parte del largo se hizo sin fixes, va crudo;
//   · anti-detour POR MODO (1,5 pie / 1,8 auto): el ×2,5 anterior no rechazaba ninguno de los tres;
//   · racimos PROMEDIADOS por precisión antes de rutear (ver `promediarRacimos`).
// Y la respuesta trae `km.{crudo,pegado}` por persona, que es la única forma honesta de saber si un
// umbral sirvió: "se ve más pegado a la calle" fue exactamente la impresión que tapó el ×1,63.
// OJO al leer ese cociente: un día dibujado 100 % crudo da ~×0,86 y no ×1, porque lo que se dibuja
// es el rastro ADELGAZADO (`thin`). Lo que hay que mirar es que no se despegue hacia arriba.
//
// Antes de rutear: (0) apartamos los puntos TRIANGULADOS por red (accuracy > 30, ver ACC_GPS_MAX) y
// promediamos los racimos, (1) cortamos por HUECO — salto grande o silencio de más de 4 min —,
// (2) cortamos por MODO (caminata vs. vehículo, por velocidad suavizada), (3) descartamos segmentos
// ESTÁTICOS (jitter con el teléfono quieto — si no, el ruteo los convierte en "vueltas" a la
// manzana; se detecta con la MEDIANA de distancia al centro, robusta a outliers), (4) aplicamos la
// guarda de tramo a ciegas y (5) adelgazamos el jitter. Guarda anti-detour al final: si el ruteo por
// calles se alarga más de MAX_DETOUR_*× el crudo, se dibuja el crudo del tramo — el snap nunca
// empeora el resultado.
//
// 🩸 EL CORTE POR MODO (ALGO 7, 30/07/2026) es lo que hace que esto sirva para algo. Sin él, el día
// entero quedaba en UN segmento y la guarda de longitud lo mandaba crudo completo: el botón
// "Calles" no pegaba nada a las calles en ningún día real. Ver el comentario de `splitModo`.
// Desde ALGO 8 ese corte además ELIGE EL MOTOR, así que dejó de ser solo una guarda: es el ruteo.
//
// Se cachea en recorridos_snap (service-role) POR TRAMO, no por día: durante la jornada el día
// cambia todo el tiempo y un cache por día no acierta nunca. Ver el bloque de cache.
import { createClient } from 'jsr:@supabase/supabase-js@2'
// La geometría (cortes por hueco y por modo, adelgazado, longitudes) vive en ./segmentar.ts, que se
// puede probar sin levantar Deno ni Supabase. Acá queda lo que necesita red: auth, consultas y OSRM.
import {
  type P, CIEGO_MAX_FRAC, GAP_MS, cap, firmaRun, fraccionCiega, hav, isStationary, ms, pathLenLL,
  promediarRacimos, segLenP, soloGps, splitGaps, splitModo, thin,
} from './segmentar.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/* 🩸 UN MOTOR POR MODO (ALGO 8, 03/08/2026) — la palanca que faltaba.
 *
 * Hasta ALGO 7 había UN solo perfil, peatón, y por eso todo tramo en vehículo se dibujaba crudo:
 * el perfil peatón a esa velocidad inventa calles (medido 21/07/2026). En un día real de esta
 * empresa eso es la MAYOR PARTE de los kilómetros, así que el botón "Calles" se notaba poco aunque
 * estuviera encendido. La conclusión correcta no era "no rutear" sino **rutear con el motor que
 * corresponde**: FOSSGIS hostea los dos perfiles en la misma base.
 *
 * 🩸 `/match` (map matching) NO se puede usar, y no por gusto: sería el algoritmo correcto —usa
 * TODOS los puntos como evidencia en vez de reencaminar entre waypoints— pero el host público lo
 * tiene capado. MEDIDO el 03/08/2026 contra router.project-osrm.org con el rastro real de un
 * recorrido: 52 puntos → `TooBig`, 20 puntos → `TooBig`, 10 puntos con radio 50 m → "Radius search
 * size is too large". Con 10 puntos por consulta harían falta decenas de consultas por jornada
 * contra un host donado. Queda anotado como la mejora que habilita un OSRM propio, no como algo
 * que se pueda intentar de nuevo contra el público.
 *
 * Entonces, dos escalones por modo, y ninguno peor que hoy:
 *   vehículo → /route auto  →  crudo
 *   peatón   → /route foot  →  crudo
 * La guarda anti-detour se aplica a los dos: el snap NUNCA puede empeorar el trazo.
 */
const OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot'
const OSRM_CAR = 'https://routing.openstreetmap.de/routed-car/route/v1/driving'
// ⚠️ ALGO 11 (12/08/2026): sube porque los tramos QUIETOS ya no se descartan (ver el 🩸 abajo). Sin
// subirlo, los días ya cacheados seguirían devolviendo la geometría vieja —con los segmentos
// faltantes— y el arreglo no se vería hasta el día siguiente.
// ⚠️ ALGO 12 (17/08/2026): los conectores de hueco largo ahora se rutean (ver CONECTOR_MIN_M). Sube
// por el mismo motivo: los días ya cacheados no tienen esa pieza, y sin invalidar el cache el
// arreglo no se vería en NINGÚN día anterior — que son justo los que el cliente mira.
const ALGO = 12          // versión del algoritmo; sube al cambiar la lógica → invalida el cache viejo
const MIN_RUN_M = 80      // m: por debajo no vale una consulta a un host donado (era 150: una vuelta
                          // manzana de reparto entraba abajo de ese número y quedaba cruda)
const MAX_RUTEOS = 40     // techo de consultas OSRM por invocación (ver el comentario de abajo)
/* 🩸 ANTI-DETOUR POR MODO (ALGO 9, 03/08/2026). Estuvo en ×2,5 para los dos modos y con ese número
 * NO RECHAZABA NADA: medido el 03/08 sobre el día real de los tres vendedores, el trazo pegado medía
 * ×1,63 · ×1,48 · ×1,75 el crudo y los tres pasaban cómodos. Una guarda que nunca actúa no es una
 * guarda. Los números nuevos salen de lo que un ruteo HONESTO puede alargar sobre el rastro: una
 * calle real agrega esquinas y contramanos, no duplica el recorrido.
 *
 * Ojo con la tentación de apretarlos más: cuanto más separados están los puntos, más legítimamente
 * se alarga el ruteo — pero ese caso ya lo ataja `fraccionCiega` antes de gastar la consulta, que es
 * el lugar correcto. Esta guarda es la red para cuando `splitModo` se equivocó de motor. */
const MAX_DETOUR_PIE = 1.5
const MAX_DETOUR_AUTO = 1.8
/* 🩸 Y EL DEL CONECTOR ES MÁS ESTRICTO QUE LOS DOS (17/08/2026). Un conector se compara contra una
 * RECTA de dos puntos, o sea la distancia más corta que existe entre ellos: cualquier camino real es
 * más largo por definición, así que el ×1,8 de auto —pensado contra un rastro observado— acá dejaría
 * pasar casi todo.
 *
 * Este número ES la prueba de que hay UN SOLO camino, y por eso el umbral vale lo que valen sus
 * mediciones. Los 7 tramos mudos reales, consultados contra el mismo host que usa el snap:
 *   17/08 16:22 ×1,042 · 17/08 09:08 ×1,036 · 15/08 19:20 ×1,106 · 15/08 11:52 ×1,008
 *   14/08 12:31 ×1,043 · 13/08 13:34 ×1,039 · 13/08 08:34 ×1,042
 * Y los 4 conectores que el pipeline real elige del día del 17/08: ×1,036 · ×1,005 · ×1,018 · ×1,042.
 * Todos por debajo de 1,11: la ruta mide casi exactamente lo que la recta, que es la firma de que no
 * hay otro camino. El ×1,25 los acepta con margen y rechaza cualquier caso donde OSRM tenga que dar
 * una vuelta grande para unir las puntas — que es justo cuando no se puede afirmar por dónde fue. */
const MAX_DETOUR_CONECTOR = 1.25
/* Conector de hueco largo: cuándo se rutea la recta que une dos segmentos. Los tres números están
 * elegidos para que en el PUEBLO no se active nunca — ver el 🩸 del bloque que los usa.
 *   · 5 km: un hueco urbano no llega ni cerca; el más largo del pueblo medido es de ~1 km.
 *   · 90 min: más que eso ya no es "iba viajando", es un teléfono apagado media tarde.
 *   · 8 m/s (29 km/h) de velocidad implícita: por debajo no se puede afirmar que fue en vehículo por
 *     una ruta, y a pie 5 km en 90 min da 0,9 m/s, muy lejos del umbral. */
const CONECTOR_MIN_M = 5000
const CONECTOR_MAX_MS = 90 * 60000
const CONECTOR_VEL_MIN_MPS = 8
/* 🩸 Y PRESUPUESTO PROPIO, SEPARADO DE `MAX_RUTEOS`. Los conectores se resuelven DESPUÉS de todos
 * los tramos de la persona, así que compartiendo el pote de 40 serían los primeros en quedarse sin
 * cupo — y justo en los días cargados, que son los que más tramos de ruta tienen. La feature
 * funcionaría los días tranquilos y fallaría en silencio los demás, que es el peor modo de fallar.
 * Son pocos por definición (el día más movido de Javier da 4) y son la diferencia entre "cruza el
 * campo" y "va por la ruta": se les reserva su propio cupo. */
const MAX_RUTEOS_CONECTOR = 8
/* 🩸 LA GUARDA DE LARGO ERA UN PROXY, Y DEJÓ DE HACER FALTA (ALGO 10, 04/08/2026). Estaba en 4.000 m
 * con el argumento "4 km no se hacen a pie, sea cual sea la velocidad media" — o sea, era una forma
 * indirecta de cazar un VEHÍCULO mal clasificado como peatón, en la época en que la clasificación se
 * decidía hop por hop y no se le podía creer. Ahora eso lo decide `SPEED_MAX` sobre una velocidad de
 * ventana, y encima el perfil peatón es DELIBERADAMENTE el motor de los viajes lentos por el pueblo
 * (medido: ×1,10 contra ×2,33 del auto). Con 4 km, un circuito de reparto de media mañana volvía a
 * caer en `crudos.largoPeaton` justo después de haberlo arreglado.
 *
 * Lo único que este número tiene que seguir evitando es pedirle al motor peatón una ruta ENTRE
 * LOCALIDADES, que es donde delira (medido ×57). A 30 km/h, 12 km son 24 minutos: para eso alcanza. */
const FOOT_LEN = 12000    // m: arriba de esto no se le pide una ruta al motor peatón
const UA = { 'User-Agent': 'la-union-app/1.0 (Distribuidora LA UNION)' }

/**
 * Ruteo entre waypoints. Devuelve `null` (no lanza) si no se pudo: el llamador dibuja crudo.
 * Timeout obligatorio (host de fair-use): sin esto un host lento cuelga la función entera, porque
 * los fetch son secuenciales. AbortError cae al catch.
 */
async function routeSeg(wps: P[], base: string): Promise<number[][] | null> {
  if (wps.length < 2) return null
  const cs = wps.map((p) => `${p.lng},${p.lat}`).join(';')
  try {
    const r = await fetch(`${base}/${cs}?overview=full&geometries=geojson`, {
      headers: UA, signal: AbortSignal.timeout(5000),
    })
    const d = await r.json()
    if (d.code !== 'Ok') return null
    const g = d.routes?.[0]?.geometry?.coordinates
    if (!g || g.length < 2) return null
    return g.map(([lng, lat]: number[]) => [lat, lng])
  } catch (_) { return null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const SB_URL = Deno.env.get('SUPABASE_URL')!, ANON = Deno.env.get('SUPABASE_ANON_KEY')!, SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authHeader = req.headers.get('Authorization') || ''
    const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: authHeader } } })
    const { data: ud } = await asUser.auth.getUser()
    const uid = ud?.user?.id
    if (!uid) return json({ error: 'no-auth' }, 401)
    const { data: perfil } = await asUser.from('perfiles').select('id_empresa, rol, activo').eq('id', uid).maybeSingle()
    if (!perfil || !perfil.activo) return json({ error: 'sin-perfil' }, 403)

    const body = await req.json().catch(() => ({}))
    const esSuper = perfil.rol === 'superadmin'
    const idEmpresa = (esSuper && body.id_empresa) ? body.id_empresa : perfil.id_empresa
    if (!idEmpresa) return json({ recorridos: [] })
    const fecha: string = body.fecha || new Date().toISOString().slice(0, 10)
    const desde: string = body.desde || `${fecha}T00:00:00`
    const hasta: string = body.hasta || `${fecha}T23:59:59`

    const admin = createClient(SB_URL, SERVICE)
    // Se PAGINA hasta agotar. PostgREST corta la respuesta en `max-rows` (1000) y devuelve 200
    // igual, sin señal de que faltan filas. Como acá se pide la empresa ENTERA del día en una
    // sola consulta, una jornada con varios móviles supera las 1000 fácil y llegaba recortada a
    // las primeras horas: TODO lo posterior quedaba sin snapear y no se dibujaba (bug 21/07/2026:
    // 5.205 puntos/empresa, corte a las 08:11 → la visita de la tarde de un vendedor a Apolinario
    // Saravia no aparecía en el mapa; sus puntos estaban intactos en la tabla). Mismo bug que ya
    // se arregló del lado del cliente en useRecorridosDelDia.js; a esta función nunca se le aplicó.
    //
    // Se avanza por la cantidad REALMENTE recibida y se corta con una página vacía (no con "vino
    // menos de PAGE"): si el `max-rows` del server fuese menor que PAGE, la 1ª página vendría corta
    // y perderíamos el resto en silencio — el mismo bug. El desempate por `id` da un orden TOTAL:
    // dos filas con el mismo `ts` no se reparten entre páginas.
    const PAGE = 1000
    const MAX_VUELTAS = 200 // techo de seguridad (~200k puntos/empresa/día): nunca un bucle infinito
    const pos: { id_usuario: string; lat: number; lng: number; ts: string; accuracy: number | null }[] = []
    let offset = 0
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const { data: pagina, error: posErr } = await admin.from('posiciones')
        // `accuracy` desde ALGO 9: es lo que distingue un fix de GPS de uno triangulado por red
        // (ver ACC_GPS_MAX en segmentar.ts) y lo que pesa el centroide de los racimos.
        .select('id_usuario, lat, lng, ts, accuracy').eq('id_empresa', idEmpresa).gte('ts', desde).lte('ts', hasta)
        .order('ts', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (posErr) return json({ error: posErr.message }, 500)
      if (!pagina || !pagina.length) break
      pos.push(...pagina)
      offset += pagina.length
    }

    const byUser: Record<string, P[]> = {}, lastTs: Record<string, string> = {}
    for (const p of pos || []) { if (!p.id_usuario) continue; (byUser[p.id_usuario] ||= []).push({ lat: p.lat, lng: p.lng, ts: p.ts, acc: p.accuracy ?? undefined }); lastTs[p.id_usuario] = p.ts }

    /* 🩸 CACHE INCREMENTAL, POR TRAMO (30/07/2026). Antes la fila entera valía solo si
     * `cached.puntos === pts.length`, o sea que DURANTE EL DÍA el cache no servía nunca: cada punto
     * nuevo lo invalidaba y se recalculaba la jornada completa. Con el día en un solo segmento eso
     * costaba 0 consultas a OSRM (todo caía en la guarda de DRIVE_LEN), así que no se notaba. Con
     * el corte por modo pasaría a costar una decena de consultas cada 60 segundos, por persona, a
     * un host de fair-use donado — la forma más rápida de que nos bloqueen.
     *
     * Ahora se guarda una lista de piezas `{f, g}`: `f` identifica el tramo (primer ts, último ts,
     * cantidad de puntos) y `g` es su geometría. Un tramo ya cerrado no cambia nunca, así que se
     * reusa tal cual; lo único que se recalcula es la cola del día, que es la que crece.
     */
    const { data: cacheRows } = await admin.from('recorridos_snap')
      .select('id_usuario, geometria, puntos, algo').eq('id_empresa', idEmpresa).eq('fecha', fecha)
    const cache: Record<string, { piezas: { f: string; g: number[][] }[]; algo: number }> = {}
    for (const r of cacheRows || []) {
      const g = r.geometria
      // Formato viejo (ALGO ≤ 6: array de geometrías sueltas, sin firma). El chequeo de `algo` ya
      // lo descarta; esto es para no reventar si alguna fila quedara rezagada.
      const nuevo = Array.isArray(g) && g.length && !Array.isArray(g[0]) && typeof g[0]?.f === 'string'
      cache[r.id_usuario] = { piezas: nuevo ? g : [], algo: r.algo }
    }

    const AHORA = Date.now()
    /* Un tramo cuyo último punto es de hace menos de esto todavía está CRECIENDO: rutearlo es tirar
     * la consulta, porque en el próximo refresco tendrá puntos nuevos y otra firma. Se dibuja crudo
     * y se rutea cuando queda cerrado. Es lo que mantiene acotado el tráfico contra OSRM en vivo.
     *
     * 03/08/2026: bajado de 10 min a GAP_MS (4). No es un número a ojo — es el ÚNICO valor
     * correcto: pasados 4 minutos de silencio, `splitGaps` corta y el próximo punto abre un
     * segmento NUEVO, así que este tramo ya no puede crecer más. Con 10 minutos, la cola del día
     * —justo el pedazo que se está mirando en vivo— quedaba cruda sin ninguna razón.
     */
    const COLA_VIVA_MS = GAP_MS
    let ruteos = 0
    let truncados = 0
    // Desglose de por qué un tramo quedó crudo. Viaja en la respuesta: un tope silencioso se lee
    // como "salió todo bien" cuando en realidad quedaron tramos sin pegar a la calle.
    const crudos = { corto: 0, largoPeaton: 0, creciendo: 0, presupuesto: 0, osrm: 0, detour: 0, ciego: 0, quieto: 0 }
    let autos = 0, pies = 0   // tramos enviados a cada motor
    let conectados = 0        // conectores de hueco largo que se rutearon por calle (ver el 🩸 abajo)
    let ruteosConector = 0    // presupuesto PROPIO de los conectores (ver MAX_RUTEOS_CONECTOR)
    let triangulados = 0      // puntos apartados por venir de red y no de GPS
    // 🩸 LA MEDIDA QUE DECIDE SI ESTO SIRVE. Sin el cociente pegado/crudo, "se ve más pegado a la
    // calle" es una impresión — y el 03/08/2026 la impresión decía que estaba bien mientras el snap
    // inventaba el 63 % del recorrido. Viaja en la respuesta y llega al front por `_meta`.
    const km: Record<string, { crudo: number; pegado: number }> = {}

    const recorridos: { id_usuario: string; geometrias: number[][][]; conectores: number[][][] }[] = []
    for (const [id, ptsCrudos] of Object.entries(byUser)) {
      // Orden del pipeline (ALGO 9): triangulados afuera → racimos promediados → corte por hueco y
      // por modo → guarda de tramo a ciegas → ruteo por perfil → anti-detour. Cada paso le entrega
      // al siguiente algo más limpio; invertirlos rompe el sentido de los umbrales.
      const conGps = soloGps(ptsCrudos)
      triangulados += ptsCrudos.length - conGps.length
      const pts = promediarRacimos(conGps)
      if (pts.length < 2) continue
      const previas = cache[id]?.algo === ALGO ? cache[id].piezas : []
      const porFirma = new Map<string, number[][]>(previas.map((p) => [p.f, p.g] as [string, number[][]]))

      const piezas: { f: string; g: number[][]; c?: boolean }[] = []
      const mio = (km[id] ||= { crudo: 0, pegado: 0 })
      let osrmMiss = false
      // Bordes entre segmentos consecutivos: el ÚLTIMO punto de uno y el PRIMERO del siguiente. Es
      // lo que el front une con una recta llena (`trazos.js`, conectores), y lo que se rutea abajo.
      const bordes: [P, P][] = []
      let finAnterior: P | null = null
      for (const seg of splitGaps(pts)) {
        if (seg.length < 2) continue
        if (finAnterior) bordes.push([finAnterior, seg[0]])
        finAnterior = seg[seg.length - 1]
        /* 🩸 QUIETO SIGNIFICA "NO RUTEAR", NO "NO DIBUJAR" (12/08/2026).
         *
         * Hasta hoy acá había un `continue` que **descartaba el segmento entero**. Como el front usa
         * SOLO la geometría pegada cuando viene no vacía (`construirLeaflet`: `segs && segs.length`),
         * cada segmento que caía acá **desaparecía del mapa** al prender "Calles".
         *
         * Lo reportó el cliente con el mecanismo exacto: *"al tener un ruido de gps el pegado a
         * calles no sabe a cuál va y elimina el trazo"*. Y es literal, porque `isStationary` mide la
         * mediana de distancia al centro contra `STATIONARY_R` = 40 m: en un teléfono con 20 m de
         * error, un tramo caminado de un par de cuadras la cumple. Medido sobre la jornada del
         * 12/08, metros que desaparecían con el snap prendido:
         *
         *   Nelson rojas    1 de 1 segmento  ·  6.446 m  ·  **el 100 % de su día**
         *   Luis Mendoza    3 de 5           ·  5.230 m  ·  62 %
         *   Gabriel tevez   1 de 3           ·  1.591 m  ·  18 %
         *   Javier          3 de 7           ·     47 m  ·   0 %
         *   Orlando · Agustin (precisión 1,6 m)  ·  0 m  ·   0 %
         *
         * La correlación es con el RUIDO, no con la persona: los de 14-20 m de mediana perdían el
         * trazo, los de 1,6 m no perdían nada.
         *
         * La intención original era correcta —rutear jitter inventa vueltas— pero la ejecución tiró
         * el dato en vez de dejarlo crudo. Con el snap APAGADO esos mismos puntos SÍ se dibujan, así
         * que prender "Calles" borraba parte del recorrido: eso nunca puede pasar.
         */
        const quieto = isStationary(seg)
        for (const run of splitModo(seg)) {
          if (run.pts.length < 2) continue
          const f = firmaRun(run.pts)
          const lenM = segLenP(run.pts)
          const previo = porFirma.get(f)
          if (previo) { mio.crudo += lenM; mio.pegado += pathLenLL(previo); piezas.push({ f, g: previo }); continue }

          const crudo = thin(run.pts).map((p) => [p.lat, p.lng])
          const finMs = ms(run.pts[run.pts.length - 1])
          const creciendo = Number.isFinite(finMs) && AHORA - finMs < COLA_VIVA_MS
          const usarCrudo = (motivo: keyof typeof crudos) => {
            crudos[motivo]++
            mio.crudo += lenM; mio.pegado += pathLenLL(crudo)
            piezas.push({ f, g: crudo })
          }

          // Se dibuja CRUDO —sin consultar OSRM— cuando no se puede ayudar o no conviene todavía:
          //  - `lenM < MIN_RUN_M`: 80 m no justifican una consulta a un host donado.
          //  - `!run.auto && lenM > FOOT_LEN`: ver el bloque de FOOT_LEN.
          //  - `creciendo`: ver COLA_VIVA_MS.
          //  - presupuesto agotado: ver MAX_RUTEOS.
          // Quieto: se dibuja crudo y no se consulta OSRM (ver el 🩸 de arriba). Va PRIMERO para no
          // gastar presupuesto de ruteo en un tramo que de todas formas no se va a rutear.
          if (quieto) { usarCrudo('quieto'); continue }
          if (lenM < MIN_RUN_M) { usarCrudo('corto'); continue }
          if (!run.auto && lenM > FOOT_LEN) { usarCrudo('largoPeaton'); continue }
          if (creciendo) { usarCrudo('creciendo'); continue }
          // 🩸 GUARDA DE TRAMO A CIEGAS (ALGO 9): si la mayor parte del largo se recorrió sin que
          // el teléfono reportara, no hay nada que reconstruir y rutear es inventar. El umbral es de
          // TIEMPO y no de distancia — ver HUECO_CIEGO_MS, y por qué la mediana en metros no servía.
          // Va ANTES del presupuesto a propósito: no gastar una consulta en un tramo que igual se
          // iba a rechazar, así el presupuesto queda para los que sí se pueden reconstruir.
          //
          // ⚠️ Se probó relajar esta guarda para tramos largos de vehículo, pensando que era acá donde
          // se perdía la ruta de González a Lajitas. **Medido con el código real sobre el día real:
          // no es acá.** Un hueco de 27 min supera `GAP_MS`, así que el tramo mudo ni siquiera es
          // parte de un `run` — es el borde ENTRE dos segmentos, y se arregla ruteando el CONECTOR
          // (ver el 🩸 más abajo). Los 2.073 puntos de Javier del 17/08 dan 2 tramos ciegos, de 1,8 y
          // 1,1 km: ninguna relajación de este umbral los habría tocado. Queda anotado para que nadie
          // vuelva a intentarlo por acá.
          if (fraccionCiega(run.pts) > CIEGO_MAX_FRAC) { usarCrudo('ciego'); continue }
          if (ruteos >= MAX_RUTEOS) { truncados++; usarCrudo('presupuesto'); continue }

          ruteos++
          // 🩸 EL MOTOR LO ELIGE EL MODO. Un tramo en vehículo ruteado con perfil peatón atraviesa
          // peatonales y plazas; uno a pie ruteado con perfil auto respeta contramanos y da vueltas
          // que la persona no dio. Es el mismo error en dos direcciones.
          const g = await routeSeg(cap(thin(run.pts)), run.auto ? OSRM_CAR : OSRM_FOOT)
          if (run.auto) autos++; else pies++
          if (!g) { osrmMiss = true; usarCrudo('osrm'); continue }
          // Guarda anti-detour: se acepta el ruteo si NO se alarga demasiado respecto del crudo
          // (con 50 m de holgura). Si se alarga (calle equivocada), se dibuja el crudo adelgazado.
          const ok = pathLenLL(g) <= (run.auto ? MAX_DETOUR_AUTO : MAX_DETOUR_PIE) * lenM + 50
          if (!ok) { usarCrudo('detour'); continue }
          mio.crudo += lenM; mio.pegado += pathLenLL(g)
          piezas.push({ f, g })
        }
      }

      /* 🩸 EL CONECTOR TAMBIÉN VA POR LA RUTA (17/08/2026) — y es ACÁ, no en la guarda de tramo
       * ciego, donde vivía el problema que reportó el cliente.
       *
       * El reporte, textual: *"no puede estar en González y aparecer en Lajitas, debió ir por la
       * ruta"*. La primera hipótesis fue que el tramo mudo entraba como un `run` ciego y la guarda lo
       * rechazaba. **Se probó con el código real contra el día real y es FALSA**: un hueco de 27 min
       * supera `GAP_MS`, así que `splitGaps` corta ahí y los 25 km **nunca son parte de ningún
       * segmento** — son el borde ENTRE dos. `fraccionCiega` no los ve porque no están adentro de
       * nada. De los 2.073 puntos de Javier del 17/08 salen 2 tramos ciegos, de 1,8 y 1,1 km.
       *
       * Lo que dibuja la línea a campo traviesa es el CONECTOR del front (`trazos.js`), que es
       * sólido desde 1.14.3 —a pedido explícito— y une las dos puntas con una recta.
       *
       * Entonces se rutea el conector, con las tres condiciones que lo hacen honesto:
       *   · largo ≥ CONECTOR_MIN_M — en el pueblo NO se activa: ahí una recta corta sobre un hueco
       *     es menos mentira que inventar una calle de una grilla donde todas son plausibles;
       *   · velocidad implícita de vehículo y hueco de menos de 90 min — un teléfono apagado media
       *     tarde no autoriza a afirmar que fue por ningún lado;
       *   · y la prueba de que hay UN SOLO camino: la ruta no puede medir más de MAX_DETOUR_CONECTOR
       *     veces la recta. Medido sobre los 7 tramos mudos reales: entre ×1,008 y ×1,106.
       *
       * Los km: se suma la RECTA al crudo y la RUTA al pegado. Las dos describen el mismo
       * desplazamiento, así que el cociente pegado/crudo —la medida que dice si el snap está
       * inventando— sigue significando lo mismo. Sumar solo el pegado lo inflaría.
       *
       * 🩸 Y VIAJAN EN SU PROPIO CAMPO, NO MEZCLADOS EN `geometrias`. El front tiene una red de
       * contención —`cubreElRecorrido`, en `trazos.js`— que descarta el snap entero si lo pegado
       * cubre menos que el crudo; es lo que impide que el snap borre recorrido, y el comentario que
       * la acompaña dice que se queda para siempre. Un conector agrega largo que **no tiene
       * contraparte cruda** (el hueco no está en `segmentos`), así que mezclarlo ahí inflaría el
       * lado "pegado" de esa comparación y podría tapar un snap que sí borró tramos. Separados, la
       * guarda sigue comparando lo mismo contra lo mismo.
       */
      for (const [a, b] of bordes) {
        const recta = hav(a, b)
        if (recta < CONECTOR_MIN_M) continue
        const dt = ms(b) - ms(a)
        if (!Number.isFinite(dt) || dt <= 0 || dt > CONECTOR_MAX_MS) continue
        if (recta / (dt / 1000) < CONECTOR_VEL_MIN_MPS) continue
        const f = firmaRun([a, b])
        const previo = porFirma.get(f)
        if (previo) { mio.crudo += recta; mio.pegado += pathLenLL(previo); piezas.push({ f, g: previo, c: true }); continue }
        if (ruteosConector >= MAX_RUTEOS_CONECTOR) { truncados++; continue }
        ruteosConector++
        const g = await routeSeg([a, b], OSRM_CAR)
        if (!g) { osrmMiss = true; continue }
        // Sin la holgura de +50 m que usan los otros: sobre 25 km no cambia nada, y acá el número ES
        // la prueba de unicidad del camino, no una tolerancia de dibujo.
        if (pathLenLL(g) > MAX_DETOUR_CONECTOR * recta) { crudos.ciego++; continue }
        conectados++
        mio.crudo += recta; mio.pegado += pathLenLL(g)
        piezas.push({ f, g, c: true })
      }

      // `c` marca conector. Se cachea junto con lo demás (misma firma, mismo determinismo) pero sale
      // por un campo aparte — ver el 🩸 de arriba sobre `cubreElRecorrido`.
      recorridos.push({
        id_usuario: id,
        geometrias: piezas.filter((p) => !p.c).map((p) => p.g),
        conectores: piezas.filter((p) => p.c).map((p) => p.g),
      })
      // Cachear salvo que OSRM haya FALLADO en algún tramo (así se reintenta cuando el host vuelva).
      // Los rechazados por la guarda SÍ se cachean: son determinísticos.
      if (piezas.length === 0 || !osrmMiss) {
        await admin.from('recorridos_snap').upsert({
          id_empresa: idEmpresa, id_usuario: id, fecha, geometria: piezas, algo: ALGO,
          puntos: pts.length, ultimo_ts: lastTs[id], updated_at: new Date().toISOString(),
        }, { onConflict: 'id_usuario,fecha' })
      }
    }
    // `ruteos`/`truncados` y el desglose viajan en la respuesta a propósito: un tope silencioso se
    // lee como "salió todo bien" cuando en realidad quedaron tramos sin pegar a la calle. Es
    // también la única forma de medir si un cambio de umbral sirvió o no ("se ve más pegado" es una
    // impresión, no un dato).
    // `km.{crudo,pegado}` (ALGO 9) son LA medida: si el cociente se despega HACIA ARRIBA, el snap
    // está inventando calles, y eso no se ve mirando el mapa — el 03/08/2026 se veía "más pegado"
    // con un ×1,63. Un día 100 % crudo da ~×0,86 (se dibuja el rastro adelgazado), no ×1.
    // Redondeados a metros para no mandar 14 decimales.
    const r2 = (n: number) => Math.round(n)
    return json({
      recorridos, ruteos, truncados, autos, pies, conectados, crudos, triangulados,
      km: Object.fromEntries(Object.entries(km).map(([k, v]) => [k, { crudo: r2(v.crudo), pegado: r2(v.pegado) }])),
    })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
