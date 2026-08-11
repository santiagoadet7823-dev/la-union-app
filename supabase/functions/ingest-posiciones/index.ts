// ingest-posiciones — endpoint de ingesta del uploader NATIVO de GPS (Opción B, 24/07/2026).
//
// Por qué existe: el plugin JS de background-geolocation muere con el WebView congelado (Doze), así
// que la subida "en vivo" se corta con la pantalla bloqueada. El servicio NATIVO (foreground service
// propio) postea acá directo, sin depender del WebView. Como nativo no tiene la sesión de Supabase
// (el JWT vence en 1 h y no es accesible), se autentica con un TOKEN DE DISPOSITIVO (tabla
// ingesta_tokens, uno por usuario, revocable). La función lo valida con service_role e inserta en
// `posiciones` mapeando id_usuario/id_empresa/rol desde el token — el cliente NO puede falsear a quién.
//
// Idempotente por client_uid (mismo criterio que la cola JS): reintentos del servicio nativo no
// duplican. Ver también db/16_ingesta_tokens.sql y CLAUDE.md (regla 6: el índice de client_uid no es parcial).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_PUNTOS = 500          // tope por request: el servicio nativo agrupa; más que esto es abuso
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/* 🩸 TELEMETRÍA QUE NO DEPENDE DEL WEBVIEW (1.13.3, 11/08/2026).
 *
 * Los contadores del servicio nativo (`fix_total`, `fix_desc_precision`, `gps_silencio_max_ms`…)
 * viajaban SOLO en el latido, que lo escribe el JS. Y el JS se congela: el 11/08 los últimos latidos
 * del parque eran de las 07:37, 09:05, 09:47 y 11:17 mientras esos mismos cuatro teléfonos seguían
 * subiendo puntos hasta las 14:45 por este endpoint. O sea que **justo cuando un teléfono falla, el
 * diagnóstico deja de llegar** — y una tabla que compara contadores entre personas está comparando
 * cortes de horas distintas sin decirlo.
 *
 * El uploader nativo postea cada 5-10 s cuando hay red, así que la telemetría viene gratis con el
 * lote. Se escribe en el MISMO upsert de `estado_dispositivo` y con su propio `telemetria_ts`, que
 * es lo que permite saber de cuándo es cada número.
 *
 * ⚠️ Solo campos que produce el servicio nativo. `fcm_token`, `bg_ok`, `permiso` y compañía siguen
 * siendo del JS y NO se tocan acá: un upsert que los mandara en null los borraría, que es
 * exactamente el bug del token FCM nulo (10/08). Por eso la lista es explícita y corta.
 *
 * ⚠️ `updated_at` NO se toca: sigue significando "último latido del JS" (verificado: la tabla no
 * tiene triggers). Si esto lo moviera, un teléfono con el WebView muerto figuraría vivo — y hay
 * media docena de lugares que usan esa columna para decidir justamente eso. Por eso la telemetría
 * nativa lleva su propio `telemetria_ts`.
 */
const CAMPOS_TEL = [
  'fix_total', 'fix_guardados', 'fix_desc_precision', 'fix_desc_precision_racha',
  'fix_desc_salto', 'fix_desc_movimiento', 'gps_fixes_red', 'gps_repedidos',
  'cuarentena_nativa', 'gps_intervalo_ms', 'gps_silencio_max_ms',
] as const

// ts: acepta epoch ms (número) o ISO (string). Devuelve ISO o null.
function tsISO(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v).toISOString()
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null }
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)
  try {
    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(SB_URL, SERVICE)

    const body = await req.json().catch(() => null)
    const token = body?.token
    const puntos = body?.puntos
    if (!token || typeof token !== 'string') return json({ error: 'sin-token' }, 401)
    if (!Array.isArray(puntos)) return json({ error: 'sin-puntos' }, 400)
    if (puntos.length === 0) return json({ insertados: 0 })
    if (puntos.length > MAX_PUNTOS) return json({ error: 'demasiados-puntos', max: MAX_PUNTOS }, 413)

    // 1) Validar el token → identidad. El cliente NO decide id_usuario/id_empresa: salen de acá.
    const { data: tk } = await admin
      .from('ingesta_tokens')
      .select('id_usuario, id_empresa, revocado')
      .eq('token', token)
      .maybeSingle()
    if (!tk || tk.revocado) return json({ error: 'token-invalido' }, 401)

    // rol para la columna posiciones.rol (display). Del perfil, no del cliente.
    const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', tk.id_usuario).maybeSingle()
    const rol = perfil?.rol ?? null

    // 2) Mapear y validar cada punto. Se descartan los inválidos en silencio (no cortar todo por uno).
    const filas = []
    for (const p of puntos) {
      const lat = num(p?.lat)
      const lng = num(p?.lng)
      const ts = tsISO(p?.ts)
      const client_uid = typeof p?.client_uid === 'string' && p.client_uid ? p.client_uid : null
      if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) continue
      if (!ts || !client_uid) continue
      const fila: Record<string, unknown> = {
        id_usuario: tk.id_usuario, id_empresa: tk.id_empresa, rol,
        lat, lng, ts, client_uid,
      }
      const acc = num(p?.accuracy); if (acc !== null) fila.accuracy = acc
      const bat = num(p?.bateria); if (bat !== null) fila.bateria = bat
      filas.push(fila)
    }
    if (filas.length === 0) return json({ insertados: 0, descartados: puntos.length })

    // 3) Upsert idempotente por client_uid (reintentos nativos no duplican).
    const { error } = await admin.from('posiciones').upsert(filas, { onConflict: 'client_uid', ignoreDuplicates: true })
    if (error) return json({ error: 'insert', detalle: error.message }, 500)

    // 4) Telemetría del servicio nativo, si vino. Va DESPUÉS del upsert y su fallo no rompe la
    // ingesta: perder un diagnóstico es molesto, perder puntos es irreversible.
    const tel = body?.tel
    if (tel && typeof tel === 'object') {
      const fila: Record<string, unknown> = {
        id_usuario: tk.id_usuario, id_empresa: tk.id_empresa,
        telemetria_ts: new Date().toISOString(),
      }
      for (const k of CAMPOS_TEL) {
        const v = num((tel as Record<string, unknown>)[k])
        // null = "el servicio todavía no lo sabe" y se OMITE, nunca se escribe: mandar null pisaría
        // el último valor bueno. Es la lección del token FCM (10/08), aplicada acá por adelantado.
        if (v !== null && v >= 0) fila[k] = Math.round(v)
      }
      if (Object.keys(fila).length > 3) {
        await admin.from('estado_dispositivo').upsert(fila, { onConflict: 'id_usuario' })
      }
    }

    return json({ insertados: filas.length, descartados: puntos.length - filas.length })
  } catch (e) {
    return json({ error: 'excepcion', detalle: String((e as Error)?.message || e) }, 500)
  }
})
