// Edge Function: aviso de ACTUALIZACIÓN con la app cerrada (29/07/2026).
//
// 🩸 DEJÓ DE SER UN PASO MANUAL (04/08/2026). Se invocaba A MANO como último paso de un release, con
// el argumento de que publicar es un acto deliberado y el aviso también, y de que un cron le
// insistiría a alguien que no puede actualizar. El argumento era razonable; el resultado, no: **en
// 1.9.0 nadie la invocó**. `net._http_response` no tiene una sola respuesta de esta función, y un día
// después de publicar había **1 de 9 teléfonos** en la versión nueva. Cero avisos es peor que un
// aviso de más.
//
// Ahora la llama un cron cada hora dentro de la ventana 6-22, y el "no insistir" se resuelve con
// ESTADO en vez de con disciplina: `estado_dispositivo.aviso_version` (db/29) guarda de qué versión
// ya se le avisó a cada teléfono. Solo entran los que están atrasados **y** todavía no fueron
// avisados de ESTA versión, y se sella al mandar → exactamente **un aviso por teléfono y por
// versión**, entregado dentro de la hora de que el teléfono aparezca.
//
// `?forzar=1` ignora la ventana horaria; `?repetir=1` ignora el sello (para volver a avisar a mano).
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
//
// 🩸 SI SE INVOCA CON `net.http_post` (pg_net), PASARLE `timeout_milliseconds`. El default de pg_net
// es 5 s y esta función tarda más: primero canjea el JWT por un access_token de Google y después
// hace un POST por teléfono, en serie. Con 7 equipos ya se pasa. El primer intento del 29/07/2026
// murió con "Timeout of 5000 ms reached" y quedó sin saber si había mandado o no. Con 60000 devolvió
// {"enviados":7,"fallidos":0}.
//
// Reintentar es seguro: el `tag` de la notificación hace que Android REEMPLACE la anterior en vez de
// apilar otra, así que un doble disparo se ve como un solo cartel. Y desde el sello, un doble
// disparo directamente no manda nada.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Misma ventana que el watchdog: un cartel a las 3 AM no lo arregla nadie y despierta el teléfono.
const HORA_INICIO = 6
const HORA_FIN = 22

/**
 * 🩸 Primera versión del APK que crea el canal `actualizaciones` al ARRANCAR (LaUnionApp.java).
 * Antes lo creaba el plugin recién al notificar, así que mandarle `channel_id` a un teléfono más
 * viejo lo dejaría MUDO: Android 8+ descarta en silencio una notificación que apunta a un canal
 * inexistente. Por eso se decide por teléfono, con `estado_dispositivo.app_version`.
 *
 * Y por eso hasta ahora NO se mandaba `channel_id` nunca — con el costo de caer en el canal de
 * reserva del SDK ("Miscellaneous"), que no es de importancia alta y que varios OEM silencian de
 * fábrica. Ese era, muy probablemente, el "a los usuarios tampoco les llega la notificación de
 * actualizar".
 */
const VER_CANAL = '1.10.0'
const CANAL_ACT = 'actualizaciones'

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

/** true si `a` es mayor O IGUAL que `b`. Para el gate del canal, que incluye la versión exacta. */
const esMayorOIgual = (a: string | null, b: string) => !!a && (a === b || esMayor(a, b))

Deno.serve(async (req) => {
  try {
    const q = new URL(req.url).searchParams
    const forzar = q.get('forzar') === '1'
    const repetir = q.get('repetir') === '1'
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
      .select('id_usuario, fcm_token, app_version, aviso_version')
      .not('fcm_token', 'is', null)
      .gte('ts', desde)
    if (error) return new Response('DB: ' + error.message, { status: 500 })

    // Solo a los ATRASADOS. Un cartel de "actualizá" a alguien que ya está en la última es ruido
    // que enseña a ignorar los carteles.
    //
    // Y solo a los que TODAVÍA NO FUERON AVISADOS de esta versión: es lo que permite que esto corra
    // en cron cada hora sin volverse insistente. Un teléfono que estuvo apagado toda la mañana
    // recibe su aviso —uno— en cuanto aparece.
    const atrasados = (filas || []).filter((f) =>
      (!f.app_version || esMayor(version, f.app_version)) &&
      (repetir || f.aviso_version !== version))
    const omitidos = (filas || []).length - atrasados.length

    const token = await getAccessToken(sa)
    const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`
    let ok = 0, fail = 0
    const errores: string[] = []
    const avisados: string[] = []
    const muertos: string[] = []

    for (const f of atrasados) {
      const notif: Record<string, string> = { tag: 'lu-actualizacion' } // mismo tag = reemplaza
      // Ver VER_CANAL: solo a los APK que ya tienen el canal creado al arrancar.
      if (esMayorOIgual(f.app_version, VER_CANAL)) notif.channel_id = CANAL_ACT
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
          android: { priority: 'HIGH', notification: notif },
        },
      }
      const r = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      })
      if (r.ok) { ok++; avisados.push(f.id_usuario); continue }
      fail++
      const cuerpo = await r.text().catch(() => '')
      if (errores.length < 3) errores.push(cuerpo.slice(0, 200))
      // Token muerto: se borra (regla 34). Un fallo de RED no cuenta.
      if (r.status === 404 || /NotRegistered|UNREGISTERED|INVALID_ARGUMENT/.test(cuerpo)) {
        muertos.push(f.id_usuario)
      }
    }

    // El sello va DESPUÉS del envío y solo para los que salieron bien: si falló, el próximo pase del
    // cron lo reintenta. Es la diferencia entre "no insistir" y "perder el aviso".
    if (avisados.length) {
      await supabase.from('estado_dispositivo').update({ aviso_version: version }).in('id_usuario', avisados)
    }
    if (muertos.length) {
      await supabase.from('estado_dispositivo').update({ fcm_token: null }).in('id_usuario', muertos)
    }

    return new Response(JSON.stringify({
      version, enviados: ok, fallidos: fail, omitidos, total: (filas || []).length,
      tokens_muertos: muertos.length, errores,
    }), { headers: { 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response('Error: ' + (e instanceof Error ? e.message : String(e)), { status: 500 })
  }
})
