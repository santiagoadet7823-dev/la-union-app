// Edge Function: aviso de ACTUALIZACIÓN con la app cerrada (29/07/2026).
//
// Se invoca A MANO, como último paso de un release — publicar es un acto deliberado y el aviso
// también. NO tiene cron: un cron le insistiría a alguien que no puede actualizar (sin datos, sin
// espacio) y se vuelve ruido.
//
// 🩸 POR QUÉ EXISTE, SI YA HABÍA UN AVISO. `src/services/updateNotify.js` ya postea una
// notificación nativa cuando detecta versión nueva… pero SOLO corre cuando el watchdog despierta la
// app y ejecuta JS. Si el proceso no está vivo, no hay quien chequee la versión: era un aviso que
// dependía de que la app estuviera medio abierta, justo lo contrario de lo que se pedía.
//
// Este manda el push CON bloque `notification`, y ahí el cartel **lo dibuja Android**: no corre una
// sola línea de código nuestro. Con la app cerrada, igual se ve.
//
// Techo honesto, el mismo de siempre: si la app fue FORZADA a cerrar (force-stop), Android no le
// entrega FCM hasta que alguien la abra a mano. Tampoco vence a los OEM que bloquean FCM.
//
// Comparte el secreto FCM_SERVICE_ACCOUNT con push-heartbeat; el bloque getAccessToken es el mismo,
// deliberadamente sin refactorizar a un módulo compartido: las Edge Functions se despliegan sueltas
// y un import relativo entre carpetas de functions es una fuente de sorpresas en el deploy.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Misma ventana que el watchdog: un cartel a las 3 AM no lo arregla nadie y despierta el teléfono.
const HORA_INICIO = 6
const HORA_FIN = 22

function dentroDeVentana(): boolean {
  // Salta = UTC−3 fijo (sin horario de verano).
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

/** Compara 'a.b.c': true si `a` es estrictamente mayor que `b`. Igual que el de updateNotify.js. */
function esMayor(a: string, b: string): boolean {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0
  }
  return false
}

Deno.serve(async (req) => {
  try {
    const forzar = new URL(req.url).searchParams.get('forzar') === '1'
    if (!dentroDeVentana() && !forzar) {
      return new Response(JSON.stringify({ enviados: 0, motivo: 'fuera de ventana (6-22)' }), {
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

    // La versión sale de app_config, NO de un parámetro: así el aviso nunca puede anunciar algo
    // distinto de lo que los teléfonos van a bajar cuando toquen el cartel.
    const { data: cfg } = await supabase.from('app_config').select('latest_version').maybeSingle()
    const version = cfg?.latest_version
    if (!version) return new Response('app_config.latest_version vacío', { status: 400 })

    // Ventana de 30 días, no las 12 h del heartbeat: alguien que hoy no salió a la calle igual
    // necesita enterarse de que hay versión nueva.
    const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    const { data: filas, error } = await supabase
      .from('estado_dispositivo')
      .select('id_usuario, fcm_token, app_version')
      .not('fcm_token', 'is', null)
      .gte('ts', desde)
    if (error) return new Response('DB: ' + error.message, { status: 500 })

    // Solo a los ATRASADOS. Un cartel de "actualizá" a alguien que ya está en la última es ruido
    // que enseña a ignorar los carteles.
    const atrasados = (filas || []).filter((f) => !f.app_version || esMayor(version, f.app_version))
    const omitidos = (filas || []).length - atrasados.length

    const token = await getAccessToken(sa)
    const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`
    let ok = 0, fail = 0
    const errores: string[] = []

    for (const f of atrasados) {
      const msg = {
        message: {
          token: f.fcm_token,
          // CON `notification`: es lo que hace que Android lo muestre sin que la app corra nada.
          notification: {
            title: 'Actualización disponible',
            body: `DisT-At ${version} — tocá para actualizar.`,
          },
          // El `data` viaja igual y lo lee la app si está viva, para no mostrar DOS carteles
          // (ver services/push.js: marca esta versión como ya avisada).
          data: { tipo: 'actualizacion', version: String(version) },
          android: {
            priority: 'HIGH',
            // ⚠️ SIN `channel_id`. Nuestro canal "Actualizaciones" lo crea el plugin nativo recién
            // cuando notifica, así que puede no existir todavía en un teléfono — y apuntar a un
            // canal inexistente en Android 8+ hace que la notificación NO se muestre. Sin
            // especificarlo cae en el canal por defecto del SDK de FCM, que siempre existe.
            notification: { tag: 'lu-actualizacion' }, // mismo tag = reemplaza, no se apila
          },
        },
      }
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      })
      if (r.ok) ok++
      else { fail++; if (errores.length < 3) errores.push((await r.text()).slice(0, 200)) }
    }

    return new Response(JSON.stringify({
      version, enviados: ok, fallidos: fail, omitidos, total: (filas || []).length, errores,
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response('Error: ' + (e instanceof Error ? e.message : String(e)), { status: 500 })
  }
})
