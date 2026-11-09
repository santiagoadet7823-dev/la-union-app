// _compartido/meta.ts — todo lo que habla con Meta (WhatsApp Cloud API), en un solo lugar (regla 36).
// Lo usan `wa-asistente` (número de consultas) y `wa-entrada` (entrada única por número, plan 41).
//
// Nació el 09/11/2026 al separar el código de `wa-asistente/index.ts` y `wa-asistente/lib/whatsapp.ts`.
// La lógica es la misma; lo nuevo es que el número y el token son parámetros: cada distribuidora tiene
// su número de ventas con su propio token, y el de consultas sigue saliendo de las variables de siempre.
//
// ⚠️ Esta carpeta empieza con "_" para que no se confunda con una función: el router la toma como un
// slug más si alguien la pide por URL, pero no tiene index.ts y falla al arrancar (503), sin efectos.

// ── Firma del webhook ────────────────────────────────────────────────────────────────────────────
const bytes = (t: string) => new TextEncoder().encode(t)

/** Compara dos textos sin filtrar el largo o el prefijo del secreto por el tiempo de respuesta. */
export async function iguales(a: string, b: string) {
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', bytes(a)), crypto.subtle.digest('SHA-256', bytes(b))])
  const ax = new Uint8Array(x), ay = new Uint8Array(y)
  let dif = 0
  for (let i = 0; i < ax.length; i++) dif |= ax[i] ^ ay[i]
  return dif === 0
}

/** `X-Hub-Signature-256`: HMAC-SHA256 del cuerpo crudo con el secreto de la app de Meta. */
export async function firmaValida(cuerpo: Uint8Array, cabecera: string | null, secreto: string) {
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(cabecera ?? '')
  if (!m) return false
  const clave = await crypto.subtle.importKey('raw', bytes(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const firma = Uint8Array.from(m[1].match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  return crypto.subtle.verify('HMAC', clave, firma, cuerpo)
}

/**
 * Lo común de las dos entradas: secretos, verificación GET, firma y JSON. Devuelve la respuesta para
 * cortar (503/403/405/401/400 o el challenge) o el payload ya validado.
 */
export async function abrirWebhook(req: Request): Promise<{ respuesta: Response } | { payload: unknown }> {
  const secretoApp = Deno.env.get('WHATSAPP_APP_SECRET')
  const tokenVerificacion = Deno.env.get('WEBHOOK_VERIFY_TOKEN')
  // Sin secretos no se atiende: es preferible un error visible a un webhook sin validar.
  if (!secretoApp || !tokenVerificacion) return { respuesta: new Response('sin-configurar', { status: 503 }) }

  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams
    if (q.get('hub.mode') === 'subscribe' && await iguales(q.get('hub.verify_token') ?? '', tokenVerificacion)) {
      return { respuesta: new Response(q.get('hub.challenge') ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } }) }
    }
    return { respuesta: new Response('prohibido', { status: 403 }) }
  }
  if (req.method !== 'POST') return { respuesta: new Response('metodo-no-permitido', { status: 405 }) }

  const cuerpo = new Uint8Array(await req.arrayBuffer())
  if (!(await firmaValida(cuerpo, req.headers.get('x-hub-signature-256'), secretoApp))) {
    return { respuesta: new Response('firma-invalida', { status: 401 }) }
  }
  try {
    return { payload: JSON.parse(new TextDecoder().decode(cuerpo)) }
  } catch {
    return { respuesta: new Response('json-invalido', { status: 400 }) }
  }
}

// ── Lectura del payload ──────────────────────────────────────────────────────────────────────────
export type Cambio = {
  phoneNumberId: string | null
  mensajes: any[]
  estados: any[]
  contactos: any[]
}

const esMensaje = (m: any) => typeof m?.id === 'string' && /^[0-9]{8,15}$/.test(String(m?.from))

/** Un webhook puede traer varios números (`metadata.phone_number_id`) y, en cada uno, mensajes y estados. */
export function cambiosDe(payload: any): Cambio[] {
  const lista: Cambio[] = []
  for (const entrada of payload?.entry ?? []) {
    for (const cambio of entrada?.changes ?? []) {
      if (cambio?.field !== 'messages') continue
      const v = cambio?.value ?? {}
      lista.push({
        phoneNumberId: typeof v.metadata?.phone_number_id === 'string' ? v.metadata.phone_number_id : null,
        mensajes: (v.messages ?? []).filter(esMensaje),
        estados: (v.statuses ?? []).filter((s: any) => typeof s?.id === 'string' && typeof s?.status === 'string'),
        contactos: v.contacts ?? [],
      })
    }
  }
  return lista
}

/** Todos los mensajes del payload, sin importar el número (lo que hacía `wa-asistente` desde el 07/11). */
export const mensajesDe = (payload: any): any[] => cambiosDe(payload).flatMap((c) => c.mensajes)

// ── Graph API ────────────────────────────────────────────────────────────────────────────────────
export type Numero = { phoneNumberId: string; token: string }

const base = () => {
  const host = Deno.env.get('GRAPH_API_BASE') || 'https://graph.facebook.com'
  return `${host}/${Deno.env.get('GRAPH_API_VERSION') || 'v26.0'}`
}

/** El número de consultas de siempre (`wa-asistente`), con las variables cargadas por configurar_whatsapp.sh. */
export const numeroDeConsultas = (): Numero => ({
  phoneNumberId: Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '',
  token: Deno.env.get('WHATSAPP_TOKEN') ?? '',
})

export function clienteMeta(n: Numero) {
  const autorizacion = () => ({ Authorization: `Bearer ${n.token}` })

  async function enviar(cuerpo: Record<string, unknown>) {
    const r = await fetch(`${base()}/${n.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { ...autorizacion(), 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }),
    })
    if (!r.ok) throw new Error(`meta-enviar-${r.status}: ${(await r.text()).slice(0, 300)}`)
    return r
  }

  /** Devuelve el `wamid` del mensaje que salió (para seguir su estado: entregado, leído, falló). */
  const wamidDe = async (r: Response): Promise<string | null> => {
    try { return (await r.json())?.messages?.[0]?.id ?? null } catch { return null }
  }

  return {
    /** Marca como leído y muestra "escribiendo…" mientras se procesa. Si falla, la charla sigue igual. */
    async avisarEscribiendo(wamid: string) {
      try {
        await enviar({ status: 'read', message_id: wamid, typing_indicator: { type: 'text' } })
      } catch (e) {
        console.warn('meta: aviso de escritura', String(e))
      }
    },

    // 4096 es el máximo de Meta para un texto. Se responde siempre al `wa_id` que llegó en el webhook:
    // así no hay que reconstruir el número (la trampa del 9 en los celulares argentinos).
    async enviarTexto(a: string, texto: string) {
      return wamidDe(await enviar({ to: a, type: 'text', text: { body: texto.slice(0, 4096), preview_url: false } }))
    },

    /** Audio, imagen o documento que mandó el cliente. La URL de descarga dura 5 minutos y también pide el token. */
    async bajarMedia(idMedia: string): Promise<{ datos: Uint8Array; mime: string | null }> {
      const info = await fetch(`${base()}/${idMedia}`, { headers: autorizacion(), signal: AbortSignal.timeout(20_000) })
      if (!info.ok) throw new Error(`meta-media-${info.status}`)
      const { url, mime_type } = await info.json()
      // Con un receptor de prueba, la URL de descarga también tiene que ir a ese receptor.
      const host = Deno.env.get('GRAPH_API_BASE')
      const destino = host ? `${host}${new URL(url).pathname}` : url
      const r = await fetch(destino, { headers: autorizacion(), signal: AbortSignal.timeout(30_000) })
      if (!r.ok) throw new Error(`meta-descarga-${r.status}`)
      return { datos: new Uint8Array(await r.arrayBuffer()), mime: mime_type ?? null }
    },

    async enviarNotaDeVoz(a: string, ogg: Uint8Array) {
      const form = new FormData()
      form.append('messaging_product', 'whatsapp')
      form.append('type', 'audio/ogg')
      form.append('file', new Blob([ogg], { type: 'audio/ogg' }), 'respuesta.ogg')
      const r = await fetch(`${base()}/${n.phoneNumberId}/media`, {
        method: 'POST', headers: autorizacion(), body: form, signal: AbortSignal.timeout(30_000),
      })
      if (!r.ok) throw new Error(`meta-subir-${r.status}: ${(await r.text()).slice(0, 300)}`)
      const { id } = await r.json()
      return wamidDe(await enviar({ to: a, type: 'audio', audio: { id, voice: true } }))
    },
  }
}

export type ClienteMeta = ReturnType<typeof clienteMeta>
