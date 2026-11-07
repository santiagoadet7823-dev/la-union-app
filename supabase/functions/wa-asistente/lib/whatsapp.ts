// lib/whatsapp.ts — todo lo que habla con la Graph API de Meta.
const base = () => {
  const host = Deno.env.get('GRAPH_API_BASE') || 'https://graph.facebook.com'
  return `${host}/${Deno.env.get('GRAPH_API_VERSION') || 'v26.0'}`
}
const autorizacion = () => ({ Authorization: `Bearer ${Deno.env.get('WHATSAPP_TOKEN')}` })
const telefonoId = () => Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')

async function enviar(cuerpo: Record<string, unknown>) {
  const r = await fetch(`${base()}/${telefonoId()}/messages`, {
    method: 'POST',
    headers: { ...autorizacion(), 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ messaging_product: 'whatsapp', ...cuerpo }),
  })
  if (!r.ok) throw new Error(`meta-enviar-${r.status}: ${(await r.text()).slice(0, 300)}`)
  return r
}

/** Marca como leído y muestra "escribiendo…" mientras se procesa. Si falla, la charla sigue igual. */
export async function avisarEscribiendo(wamid: string) {
  try {
    await enviar({ status: 'read', message_id: wamid, typing_indicator: { type: 'text' } })
  } catch (e) {
    console.warn('wa-asistente: aviso de escritura', String(e))
  }
}

// 4096 es el máximo de Meta para un texto. Se responde siempre al `wa_id` que llegó en el webhook:
// así no hay que reconstruir el número (la trampa del 9 en los celulares argentinos).
export const enviarTexto = (a: string, texto: string) =>
  enviar({ to: a, type: 'text', text: { body: texto.slice(0, 4096), preview_url: false } })

/** La URL de descarga dura 5 minutos y también pide el token. */
export async function bajarAudio(idMedia: string): Promise<Uint8Array> {
  const info = await fetch(`${base()}/${idMedia}`, { headers: autorizacion(), signal: AbortSignal.timeout(20_000) })
  if (!info.ok) throw new Error(`meta-media-${info.status}`)
  const { url } = await info.json()
  // Con un receptor de prueba, la URL de descarga también tiene que ir a ese receptor.
  const host = Deno.env.get('GRAPH_API_BASE')
  const destino = host ? `${host}${new URL(url).pathname}` : url
  const r = await fetch(destino, { headers: autorizacion(), signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`meta-descarga-${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

export async function enviarNotaDeVoz(a: string, ogg: Uint8Array) {
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('type', 'audio/ogg')
  form.append('file', new Blob([ogg], { type: 'audio/ogg' }), 'respuesta.ogg')
  const r = await fetch(`${base()}/${telefonoId()}/media`, {
    method: 'POST', headers: autorizacion(), body: form, signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok) throw new Error(`meta-subir-${r.status}: ${(await r.text()).slice(0, 300)}`)
  const { id } = await r.json()
  await enviar({ to: a, type: 'audio', audio: { id, voice: true } })
}
