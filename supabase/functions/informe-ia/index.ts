// informe-ia — la puerta de SÓLO LECTURA para un agente de IA (25/10/2026, db/95, plan 23 fase C).
//
// GET /functions/v1/informe-ia?desde=AAAA-MM-DD&hasta=AAAA-MM-DD[&zona=<uuid>][&partes=equipo,productos,catalogo]
//   Sin fechas: los últimos 7 días hasta AYER (hora de la empresa). Rango máximo: 92 días.
//   Devuelve un JSON con las RPC de db/95: `equipo` (ia_resumen_equipo), `productos`
//   (ia_productos_ventas) y `catalogo` (ia_cambios_catalogo).
//
// Mismo esquema que `export-pedidos`/`export-clientes`:
//   · `verify_jwt: false` — del otro lado hay un programa, no una sesión. En el servidor propio va en
//     `FUNCTIONS_NO_VERIFY_JWT` (`infra/selfhost/docker-compose.override.yml`) y en `SLUGS_REPO` de
//     `cargar_funciones.sh`.
//   · Token opaco en `ingesta_tokens` con `proposito = 'agente'` (db/95), validado con service_role.
//   · 🔑 `id_empresa` sale del TOKEN, nunca del request. Las RPC son sólo de service_role.
//   · No escribe nada en la base.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } })

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_DIAS = 92
const PARTES = ['equipo', 'productos', 'catalogo']

// La fecha de hoy en una zona horaria, como AAAA-MM-DD.
const hoyEn = (tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const sumarDias = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'GET') return json({ error: 'metodo-no-permitido' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    const auth = req.headers.get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
    if (!token) return json({ error: 'sin-token' }, 401)
    if (!UUID.test(token)) return json({ error: 'token-invalido' }, 401)

    const { data: tk } = await admin
      .from('ingesta_tokens')
      .select('id_empresa, revocado, proposito')
      .eq('token', token)
      .maybeSingle()
    if (!tk || tk.revocado) return json({ error: 'token-invalido' }, 401)
    if (tk.proposito !== 'agente') return json({ error: 'token-sin-permiso-de-agente' }, 401)

    const { data: emp } = await admin
      .from('empresas').select('nombre, export_erp').eq('id', tk.id_empresa).maybeSingle()
    const tz = (emp?.export_erp as Record<string, string> | null)?.zona_horaria || 'America/Argentina/Salta'

    const url = new URL(req.url)
    const ayer = sumarDias(hoyEn(tz), -1)
    const hasta = url.searchParams.get('hasta') || ayer
    const desde = url.searchParams.get('desde') || sumarDias(hasta, -6)
    const zona = url.searchParams.get('zona') || null
    const partes = (url.searchParams.get('partes') || PARTES.join(','))
      .split(',').map((s) => s.trim()).filter(Boolean)

    if (!FECHA.test(desde) || !FECHA.test(hasta) || Number.isNaN(dias(desde, hasta))) {
      return json({ error: 'fecha-invalida', formato: 'AAAA-MM-DD' }, 400)
    }
    if (dias(desde, hasta) < 0) return json({ error: 'rango-invertido' }, 400)
    if (dias(desde, hasta) + 1 > MAX_DIAS) return json({ error: 'rango-demasiado-largo', maximo_dias: MAX_DIAS }, 400)
    if (zona && !UUID.test(zona)) return json({ error: 'zona-invalida' }, 400)
    if (!partes.length || partes.some((p) => !PARTES.includes(p))) {
      return json({ error: 'partes-invalidas', validas: PARTES }, 400)
    }

    const salida: Record<string, unknown> = {
      empresa: emp?.nombre ?? null,
      desde, hasta, zona,
      zona_horaria: tz,
      generado: new Date().toISOString(),
    }
    const llamadas: Array<[string, string, Record<string, unknown>]> = [
      ['equipo', 'ia_resumen_equipo', { p_empresa: tk.id_empresa, p_desde: desde, p_hasta: hasta, p_zona: zona }],
      ['productos', 'ia_productos_ventas', { p_empresa: tk.id_empresa, p_desde: desde, p_hasta: hasta }],
      ['catalogo', 'ia_cambios_catalogo', { p_empresa: tk.id_empresa, p_desde: desde, p_hasta: hasta }],
    ]
    for (const [parte, rpc, args] of llamadas) {
      if (!partes.includes(parte)) continue
      const { data, error } = await admin.rpc(rpc, args)
      if (error) return json({ error: `rpc-${parte}`, detalle: error.message }, 500)
      salida[parte] = data
    }
    return json(salida)
  } catch (e) {
    return json({ error: 'excepcion', detalle: String((e as Error)?.message || e) }, 500)
  }
})
