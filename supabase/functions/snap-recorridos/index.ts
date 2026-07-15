// snap-recorridos — devuelve los recorridos del día "pegados a calles".
//
// El rastro se pega a la red vial con OSRM /route en **perfil PEATÓN** (host FOSSGIS
// routed-foot). Antes usábamos router.project-osrm.org perfil `driving`, que reencaminaba
// a un peatón por calles de auto (respeta contramanos, evita peatonales/plazas/atajos) →
// inventaba tramos larguísimos (medido: 5632 m para una caminata real de 941 m). Con perfil
// `foot` el mismo pipeline da ~1037 m (fiel). No se usa /match: el /match del host público
// está capado por tamaño (TooBig incluso con 20 puntos).
//
// Antes de rutear: (1) cortamos en SALTOS grandes (teleports/pérdida de GPS), (2)
// descartamos segmentos ESTÁTICOS (jitter con el teléfono quieto — si no, el ruteo los
// convierte en "vueltas" a la manzana; se detecta con la MEDIANA de distancia al centro,
// robusta a outliers), y (3) adelgazamos el jitter. Guarda anti-detour: si el ruteo por
// calles se alarga más de MAX_DETOUR× el crudo (calle equivocada), se dibuja el crudo del
// segmento — el snap nunca empeora el resultado. Se cachea en recorridos_snap (service-role);
// el cache se invalida por `algo` (versión del algoritmo).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// OSRM perfil PEATÓN (FOSSGIS). /route (no /match: el /match público está capado → TooBig).
const OSRM_ROUTE = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot'
const ALGO = 3            // versión del algoritmo; sube al cambiar la lógica → invalida el cache viejo
const GAP_MAX = 1500      // m: salto mayor a esto → corta el trazo en dos segmentos
const STATIONARY_R = 40   // m: si la MEDIANA de distancia al centro es menor → estático (no rutear)
const MIN_SEP = 25        // m: descarta puntos más cercanos que esto al anterior (jitter)
const MAX_WP = 90         // waypoints máx por consulta /route
const MAX_DETOUR = 2.5    // si el ruteo por calles > esto × el crudo → usar crudo (anti calle inventada)

type P = { lat: number; lng: number }
const hav = (a: P, b: P) => {
  const R = 6371000, d = Math.PI / 180
  const dlat = (b.lat - a.lat) * d, dlng = (b.lng - a.lng) * d
  const s = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(dlng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
function isStationary(pts: P[]): boolean {
  const center = { lat: median(pts.map((p) => p.lat)), lng: median(pts.map((p) => p.lng)) }
  return median(pts.map((p) => hav(center, p))) < STATIONARY_R
}
function splitGaps(pts: P[]): P[][] {
  const segs: P[][] = []; let cur: P[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    if (hav(pts[i - 1], pts[i]) > GAP_MAX) { segs.push(cur); cur = [pts[i]] } else cur.push(pts[i])
  }
  segs.push(cur); return segs
}
function thin(pts: P[]): P[] {
  if (pts.length <= 2) return pts.slice()
  const out = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) if (hav(out[out.length - 1], pts[i]) >= MIN_SEP) out.push(pts[i])
  out.push(pts[pts.length - 1]); return out
}
function cap(pts: P[]): P[] {
  if (pts.length <= MAX_WP) return pts
  const step = pts.length / MAX_WP, out: P[] = []
  for (let i = 0; i < MAX_WP; i++) out.push(pts[Math.floor(i * step)])
  out[out.length - 1] = pts[pts.length - 1]; return out
}
// Longitud de un rastro crudo (P[]) y de una geometría ruteada ([lat,lng][]).
const segLenP = (s: P[]) => { let L = 0; for (let i = 1; i < s.length; i++) L += hav(s[i - 1], s[i]); return L }
const pathLenLL = (g: number[][]) => { let L = 0; for (let i = 1; i < g.length; i++) L += hav({ lat: g[i - 1][0], lng: g[i - 1][1] }, { lat: g[i][0], lng: g[i][1] }); return L }
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
    const { data: pos, error: posErr } = await admin.from('posiciones')
      .select('id_usuario, lat, lng, ts').eq('id_empresa', idEmpresa).gte('ts', desde).lte('ts', hasta)
      .order('ts', { ascending: true })
    if (posErr) return json({ error: posErr.message }, 500)

    const byUser: Record<string, P[]> = {}, lastTs: Record<string, string> = {}
    for (const p of pos || []) { if (!p.id_usuario) continue; (byUser[p.id_usuario] ||= []).push({ lat: p.lat, lng: p.lng }); lastTs[p.id_usuario] = p.ts }

    const { data: cacheRows } = await admin.from('recorridos_snap')
      .select('id_usuario, geometria, puntos, algo').eq('id_empresa', idEmpresa).eq('fecha', fecha)
    const cache: Record<string, { geometria: number[][][]; puntos: number; algo: number }> = {}
    for (const r of cacheRows || []) cache[r.id_usuario] = { geometria: r.geometria, puntos: r.puntos, algo: r.algo }

    const recorridos: { id_usuario: string; geometrias: number[][][] }[] = []
    for (const [id, pts] of Object.entries(byUser)) {
      if (pts.length < 2) continue
      const cached = cache[id]
      if (cached && cached.algo === ALGO && cached.puntos === pts.length && Array.isArray(cached.geometria) && cached.geometria.length) {
        recorridos.push({ id_usuario: id, geometrias: cached.geometria }); continue
      }
      const segmentos: number[][][] = []; let osrmMiss = false
      for (const seg of splitGaps(pts)) {
        if (seg.length < 2) continue
        if (isStationary(seg)) continue // quieto (jitter) → no rutear vueltas falsas
        const g = await routeSeg(cap(thin(seg)))
        if (!g) { osrmMiss = true; segmentos.push(thin(seg).map((p) => [p.lat, p.lng])); continue }
        // Guarda anti-detour: se acepta el ruteo si NO se alarga demasiado respecto del crudo
        // (con 50 m de holgura). Si se alarga (calle equivocada), se dibuja el crudo adelgazado.
        if (pathLenLL(g) <= MAX_DETOUR * segLenP(seg) + 50) segmentos.push(g)
        else segmentos.push(thin(seg).map((p) => [p.lat, p.lng]))
      }
      recorridos.push({ id_usuario: id, geometrias: segmentos })
      // Cachear salvo que OSRM haya FALLADO en algún segmento (así se reintenta cuando el host
      // vuelva). Los segmentos rechazados por la guarda SÍ se cachean (son determinísticos). El
      // cache se re-arma solo cuando cambia la cantidad de puntos del día.
      if (segmentos.length === 0 || !osrmMiss) {
        await admin.from('recorridos_snap').upsert({
          id_empresa: idEmpresa, id_usuario: id, fecha, geometria: segmentos, algo: ALGO,
          puntos: pts.length, ultimo_ts: lastTs[id], updated_at: new Date().toISOString(),
        }, { onConflict: 'id_usuario,fecha' })
      }
    }
    return json({ recorridos })
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
