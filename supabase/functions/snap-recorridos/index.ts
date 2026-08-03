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
  type P, CIEGO_MAX_FRAC, GAP_MS, cap, firmaRun, fraccionCiega, isStationary, ms, pathLenLL,
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
const ALGO = 9           // versión del algoritmo; sube al cambiar la lógica → invalida el cache viejo
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
const FOOT_LEN = 4000     // m: un tramo A PIE más largo que esto no es a pie → no rutear con perfil
                          // peatón. NO aplica a los tramos en vehículo, que ahora tienen su motor.
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
    const crudos = { corto: 0, largoPeaton: 0, creciendo: 0, presupuesto: 0, osrm: 0, detour: 0, ciego: 0 }
    let autos = 0, pies = 0   // tramos enviados a cada motor
    let triangulados = 0      // puntos apartados por venir de red y no de GPS
    // 🩸 LA MEDIDA QUE DECIDE SI ESTO SIRVE. Sin el cociente pegado/crudo, "se ve más pegado a la
    // calle" es una impresión — y el 03/08/2026 la impresión decía que estaba bien mientras el snap
    // inventaba el 63 % del recorrido. Viaja en la respuesta y llega al front por `_meta`.
    const km: Record<string, { crudo: number; pegado: number }> = {}

    const recorridos: { id_usuario: string; geometrias: number[][][] }[] = []
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

      const piezas: { f: string; g: number[][] }[] = []
      const mio = (km[id] ||= { crudo: 0, pegado: 0 })
      let osrmMiss = false
      for (const seg of splitGaps(pts)) {
        if (seg.length < 2) continue
        if (isStationary(seg)) continue // quieto (jitter) → no rutear vueltas falsas
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
          //  - `!run.auto && lenM > FOOT_LEN`: 4 km no se hacen a pie, sea cual sea la velocidad
          //    media (si estuvo una hora parado en el medio, el promedio se hunde y no lo marcaría
          //    como vehículo). Con perfil peatón eso inventa calles. A los tramos EN VEHÍCULO este
          //    límite ya no les aplica: tienen su propio motor.
          //  - `creciendo`: ver COLA_VIVA_MS.
          //  - presupuesto agotado: ver MAX_RUTEOS.
          if (lenM < MIN_RUN_M) { usarCrudo('corto'); continue }
          if (!run.auto && lenM > FOOT_LEN) { usarCrudo('largoPeaton'); continue }
          if (creciendo) { usarCrudo('creciendo'); continue }
          // 🩸 GUARDA DE TRAMO A CIEGAS (ALGO 9): si la mayor parte del largo se recorrió sin que
          // el teléfono reportara, no hay nada que reconstruir y rutear es inventar. El umbral es de
          // TIEMPO y no de distancia — ver HUECO_CIEGO_MS, y por qué la mediana en metros no servía.
          // Va ANTES del presupuesto a propósito: no gastar una consulta en un tramo que igual se
          // iba a rechazar, así el presupuesto queda para los que sí se pueden reconstruir.
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

      recorridos.push({ id_usuario: id, geometrias: piezas.map((p) => p.g) })
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
      recorridos, ruteos, truncados, autos, pies, crudos, triangulados,
      km: Object.fromEntries(Object.entries(km).map(([k, v]) => [k, { crudo: r2(v.crudo), pegado: r2(v.pegado) }])),
    })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
