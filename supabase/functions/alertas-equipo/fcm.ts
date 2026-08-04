// Auth de FCM y envío de un mensaje. Archivo hermano de index.ts, como segmentar.ts en
// snap-recorridos.
//
// ⚠️ `getAccessToken` es la TERCERA copia (las otras dos están en push-heartbeat/index.ts y
// push-actualizacion/index.ts). La duplicación de esas dos fue deliberada para no hacer imports
// relativos entre carpetas de functions; acá al menos queda en un archivo aparte y con una firma
// reusable. **Si aparece una cuarta, va a `_shared/fcm.ts` y se migran las tres.**

export interface CuentaServicio {
  client_email: string
  private_key: string
  project_id: string
}

/** Firma un JWT RS256 con la cuenta de servicio y lo canjea por un access_token OAuth. */
export async function getAccessToken(sa: CuentaServicio): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claim)}`

  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey(
    'pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned)),
  )
  const sigB64 = btoa(String.fromCharCode(...sig)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sigB64}`,
    }),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error('No access_token: ' + JSON.stringify(json))
  return json.access_token
}

/**
 * Manda una notificación VISIBLE a un teléfono.
 *
 * Dos decisiones que ya costaron un bug y no se cambian:
 *
 * 1. **Con bloque `notification`**: así el cartel lo dibuja Android sin una sola línea de código de
 *    la app. Un `data`-only necesita el proceso vivo, y el caso que nos importa es justo el
 *    contrario (el supervisor tiene la app cerrada).
 * 2. 🩸 **`channel_id` SOLO a los teléfonos que lo tienen** (04/08/2026). Hasta 1.9.0 no se mandaba
 *    nunca, y con razón: el canal "actualizaciones" lo creaba el plugin nativo recién CUANDO
 *    notificaba, así que podía no existir, y apuntar a un canal inexistente en Android 8+ hace que
 *    la notificación **no se muestre**. El costo de esa defensa era caer en el canal de reserva del
 *    SDK ("Miscellaneous"), que no es de importancia alta y que varios OEM silencian de fábrica —
 *    o sea, exactamente el "no me llegan las notificaciones" que reportó el cliente.
 *    Desde el APK 1.10.0 el canal `avisos` se crea en `LaUnionApp.onCreate()`, así que apuntarle es
 *    seguro. Pero **el parque es mixto**: mandarle `channel_id` a un teléfono en 1.9.0 lo dejaría
 *    MUDO. Por eso el llamador decide por teléfono, mirando `estado_dispositivo.app_version`, y acá
 *    el campo simplemente no viaja si no vino.
 *
 * El `tag` hace que un aviso REEMPLACE al anterior del mismo incidente en vez de apilarse: si el
 * cron vuelve a avisar por la misma persona, no queremos seis carteles.
 */
export async function enviarPush(opts: {
  accessToken: string
  projectId: string
  token: string
  titulo: string
  cuerpo: string
  tag: string
  canal?: string | null
  data?: Record<string, string>
}): Promise<{ ok: boolean; error?: string; muerto?: boolean }> {
  const notifAndroid: Record<string, string> = { tag: opts.tag }
  if (opts.canal) notifAndroid.channel_id = opts.canal
  const msg = {
    message: {
      token: opts.token,
      notification: { title: opts.titulo, body: opts.cuerpo },
      data: { tipo: 'alerta', ...(opts.data || {}) },
      android: { priority: 'HIGH', notification: notifAndroid },
    },
  }
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${opts.projectId}/messages:send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    })
    if (r.ok) return { ok: true }
    const cuerpo = await r.text()
    // Token MUERTO: la app se desinstaló o Firebase lo rotó. FCM lo dice con 404 NotRegistered o
    // con 400 INVALID_ARGUMENT. Hay que borrarlo de la base, si no cada aviso desperdicia un envío
    // y `fallidos` queda clavado en un número > 0 para siempre — que es peor que el desperdicio,
    // porque tapa las fallas de verdad. Detectado el 30/07/2026: un teléfono con la app vieja
    // (1.6.6, sin latido desde el día anterior) hacía fallar todos los envíos.
    const muerto = r.status === 404 || /NotRegistered|UNREGISTERED|INVALID_ARGUMENT/.test(cuerpo)
    return { ok: false, muerto, error: `${r.status} ${cuerpo.slice(0, 160)}` }
  } catch (e) {
    // Un fallo de RED no es un token muerto: se reintenta en la próxima pasada del cron.
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
