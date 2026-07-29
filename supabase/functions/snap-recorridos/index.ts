// snap-recorridos — devuelve los recorridos del día "pegados a calles".
//
// El rastro se pega a la red vial con OSRM /route en **perfil PEATÓN** (host FOSSGIS
// routed-foot). Antes usábamos router.project-osrm.org perfil `driving`, que reencaminaba
// a un peatón por calles de auto (respeta contramanos, evita peatonales/plazas/atajos) →
// inventaba tramos larguísimos (medido: 5632 m para una caminata real de 941 m). Con perfil
// `foot` el mismo pipeline da ~1037 m (fiel). No se usa /match: el /match del host público
// está capado por tamaño (TooBig incluso con 20 puntos).
//
// Antes de rutear: (1) cortamos por HUECO — salto grande o silencio de más de 4 min —, (2) cortamos
// por MODO (caminata vs. vehículo, por velocidad suavizada), (3) descartamos segmentos ESTÁTICOS
// (jitter con el teléfono quieto — si no, el ruteo los convierte en "vueltas" a la manzana; se
// detecta con la MEDIANA de distancia al centro, robusta a outliers), y (4) adelgazamos el jitter.
// Guarda anti-detour: si el ruteo por calles se alarga más de MAX_DETOUR× el crudo (calle
// equivocada), se dibuja el crudo del tramo — el snap nunca empeora el resultado.
//
// 🩸 EL CORTE POR MODO (ALGO 7, 30/07/2026) es lo que hace que esto sirva para algo. Sin él, el día
// entero quedaba en UN segmento y la guarda de DRIVE_LEN lo mandaba crudo completo: el botón
// "Calles" no pegaba nada a las calles en ningún día real. Ver el comentario de `splitModo`.
//
// Se cachea en recorridos_snap (service-role) POR TRAMO, no por día: durante la jornada el día
// cambia todo el tiempo y un cache por día no acierta nunca. Ver el bloque de cache.
import { createClient } from 'jsr:@supabase/supabase-js@2'
// La geometría (cortes por hueco y por modo, adelgazado, longitudes) vive en ./segmentar.ts, que se
// puede probar sin levantar Deno ni Supabase. Acá queda lo que necesita red: auth, consultas y OSRM.
import {
  type P, cap, firmaRun, isStationary, ms, pathLenLL, segLenP, splitGaps, splitModo, thin,
} from './segmentar.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// OSRM perfil PEATÓN (FOSSGIS). /route (no /match: el /match público está capado → TooBig).
const OSRM_ROUTE = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot'
const ALGO = 7            // versión del algoritmo; sube al cambiar la lógica → invalida el cache viejo
const MIN_RUN_M = 150     // m: un tramo a pie más corto que esto no vale una consulta a OSRM
const MAX_RUTEOS = 25     // techo de consultas OSRM por invocación (ver el comentario de abajo)
const MAX_DETOUR = 2.5    // si el ruteo por calles > esto × el crudo → usar crudo (anti calle inventada)
const DRIVE_LEN = 4000    // m: un tramo más largo que esto ya implica vehículo → tampoco snapear (perfil peatón)

async function routeSeg(wps: P[]): Promise<number[][] | null> {
  if (wps.length < 2) return null
  const cs = wps.map((p) => `${p.lng},${p.lat}`).join(';')
  try {
    // Timeout (host de fair-use): sin esto un host lento cuelga la función entera (los
    // fetch son secuenciales). AbortError cae al catch → segmento crudo. UA para identificar
    // la app ante FOSSGIS (su política lo pide).
    const r = await fetch(`${OSRM_ROUTE}/${cs}?overview=full&geometries=geojson`, {
      headers: { 'User-Agent': 'la-union-app/1.0 (Distribuidora LA UNION)' },
      signal: AbortSignal.timeout(5000),
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
    const pos: { id_usuario: string; lat: number; lng: number; ts: string }[] = []
    let offset = 0
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      const { data: pagina, error: posErr } = await admin.from('posiciones')
        .select('id_usuario, lat, lng, ts').eq('id_empresa', idEmpresa).gte('ts', desde).lte('ts', hasta)
        .order('ts', { ascending: true }).order('id', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (posErr) return json({ error: posErr.message }, 500)
      if (!pagina || !pagina.length) break
      pos.push(...pagina)
      offset += pagina.length
    }

    const byUser: Record<string, P[]> = {}, lastTs: Record<string, string> = {}
    for (const p of pos || []) { if (!p.id_usuario) continue; (byUser[p.id_usuario] ||= []).push({ lat: p.lat, lng: p.lng, ts: p.ts }); lastTs[p.id_usuario] = p.ts }

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
    // Un tramo cuyo último punto es de hace menos de esto todavía está CRECIENDO: rutearlo es tirar
    // la consulta, porque en el próximo refresco tendrá puntos nuevos y otra firma. Se dibuja crudo
    // y se rutea cuando queda cerrado. Es lo que mantiene acotado el tráfico contra OSRM en vivo.
    const COLA_VIVA_MS = 10 * 60000
    let ruteos = 0
    let truncados = 0

    const recorridos: { id_usuario: string; geometrias: number[][][] }[] = []
    for (const [id, pts] of Object.entries(byUser)) {
      if (pts.length < 2) continue
      const previas = cache[id]?.algo === ALGO ? cache[id].piezas : []
      const porFirma = new Map<string, number[][]>(previas.map((p) => [p.f, p.g] as [string, number[][]]))

      const piezas: { f: string; g: number[][] }[] = []
      let osrmMiss = false
      for (const seg of splitGaps(pts)) {
        if (seg.length < 2) continue
        if (isStationary(seg)) continue // quieto (jitter) → no rutear vueltas falsas
        for (const run of splitModo(seg)) {
          if (run.pts.length < 2) continue
          const f = firmaRun(run.pts)
          const previo = porFirma.get(f)
          if (previo) { piezas.push({ f, g: previo }); continue }

          const crudo = thin(run.pts).map((p) => [p.lat, p.lng])
          const lenM = segLenP(run.pts)
          const finMs = ms(run.pts[run.pts.length - 1])
          const creciendo = Number.isFinite(finMs) && AHORA - finMs < COLA_VIVA_MS

          // Se dibuja CRUDO —sin consultar OSRM— cuando el ruteo peatón no puede ayudar o no
          // conviene todavía:
          //  - `run.auto`: se venía en vehículo. El perfil peatón a esa velocidad inventa calles
          //    (medido 21/07/2026: un vendedor manejando entre pueblos, el snap dibujaba una calle
          //    que no recorrió). El crudo nunca miente; el snap peatón sí.
          //  - `lenM > DRIVE_LEN`: 4 km no se hacen a pie, sea cual sea la velocidad media (si
          //    estuvo una hora parado en el medio, el promedio se hunde y no lo marcaría).
          //  - `lenM < MIN_RUN_M`: 150 m no justifican una consulta a un host donado.
          //  - `creciendo`: ver COLA_VIVA_MS.
          //  - presupuesto agotado: ver MAX_RUTEOS.
          if (run.auto || lenM > DRIVE_LEN || lenM < MIN_RUN_M || creciendo) { piezas.push({ f, g: crudo }); continue }
          if (ruteos >= MAX_RUTEOS) { truncados++; piezas.push({ f, g: crudo }); continue }

          ruteos++
          const g = await routeSeg(cap(thin(run.pts)))
          if (!g) { osrmMiss = true; piezas.push({ f, g: crudo }); continue }
          // Guarda anti-detour: se acepta el ruteo si NO se alarga demasiado respecto del crudo
          // (con 50 m de holgura). Si se alarga (calle equivocada), se dibuja el crudo adelgazado.
          piezas.push({ f, g: pathLenLL(g) <= MAX_DETOUR * lenM + 50 ? g : crudo })
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
    // `ruteos`/`truncados` viajan en la respuesta a propósito: un tope silencioso se lee como
    // "salió todo bien" cuando en realidad quedaron tramos sin pegar a la calle.
    return json({ recorridos, ruteos, truncados })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
