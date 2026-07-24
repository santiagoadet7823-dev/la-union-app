// Edge Function: watchdog por push (FCM).
//
// La invoca pg_cron cada ~30 min. Busca los móviles ACTIVOS del día que tengan token FCM y les
// manda un mensaje de DATOS silencioso (data-only, alta prioridad) para DESPERTAR la app: aunque
// el vendedor no la mire, refresca su latido (estado_dispositivo) y destapa la cola de posiciones.
// Así sabemos de verdad si apagó GPS o datos.
//
// Realidad Android (honesta): ayuda contra el kill "suave" y refresca el estado; NO revive un
// force-stop ni vence a los OEM que bloquean FCM. Ver src/services/push.js.
//
// SECRETO requerido (NO va al repo): FCM_SERVICE_ACCOUNT = el JSON de la cuenta de servicio de
// Firebase (Config. del proyecto → Cuentas de servicio → Generar clave privada), pegado tal cual.
// Se carga con:  supabase secrets set FCM_SERVICE_ACCOUNT="$(cat clave.json)"  (o por el dashboard).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Ventana horaria de trabajo (hora local de Salta, UTC−3 sin horario de verano). El cron corre
// cada 30 min las 24 h, pero fuera de esta franja NO mandamos nada: un push a las 3 AM despierta
// el teléfono y gasta batería sin ningún beneficio (nadie está trabajando). Ajustar acá el rango.
const HORA_INICIO = 6   // 0..23 inclusivo
const HORA_FIN = 22     // 1..24 exclusivo

function dentroDeVentana(): boolean {
  // Salta = UTC−3 fijo. Hora local = (horaUTC − 3) mod 24.
  const horaSalta = (new Date().getUTCHours() + 24 - 3) % 24
  return horaSalta >= HORA_INICIO && horaSalta < HORA_FIN
}

// --- Auth de FCM: firmar un JWT con la cuenta de servicio y canjearlo por un access_token OAuth.
async function getAccessToken(sa: any): Promise<string> {
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

  // Importar la private_key (PEM PKCS#8) y firmar RS256.
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

Deno.serve(async () => {
  try {
    // Fuera del horario de trabajo no despertamos a nadie (batería). El cron igual corre 24 h.
    if (!dentroDeVentana()) {
      return new Response(JSON.stringify({ enviados: 0, fallidos: 0, total: 0, motivo: 'fuera de ventana' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') || '{}')
    if (!sa.client_email || !sa.private_key || !sa.project_id) {
      return new Response('Falta FCM_SERVICE_ACCOUNT', { status: 500 })
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Móviles con token cuyo último latido fue hace menos de 12 h (evita spamear tokens muertos).
    const desde = new Date(Date.now() - 12 * 3600 * 1000).toISOString()
    const { data: filas, error } = await supabase
      .from('estado_dispositivo')
      .select('id_usuario, fcm_token, ts')
      .not('fcm_token', 'is', null)
      .gte('ts', desde)
    if (error) return new Response('DB: ' + error.message, { status: 500 })

    const token = await getAccessToken(sa)
    const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`
    let ok = 0, fail = 0
    for (const f of filas || []) {
      // Mensaje de DATOS silencioso: sin `notification`, alta prioridad → despierta la app sin
      // molestar al usuario con un cartel.
      const msg = {
        message: {
          token: f.fcm_token,
          data: { tipo: 'watchdog', ts: String(Date.now()) },
          android: { priority: 'HIGH' },
        },
      }
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      })
      if (r.ok) ok++
      else fail++
    }
    return new Response(JSON.stringify({ enviados: ok, fallidos: fail, total: (filas || []).length }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response('Error: ' + (e instanceof Error ? e.message : String(e)), { status: 500 })
  }
})
