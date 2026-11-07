// wa-asistente — asistente de WhatsApp para el dueño y el encargado (07/11/2026, db/101, plan 38).
//
// GET  /functions/v1/wa-asistente  verificación del webhook de Meta.
// POST /functions/v1/wa-asistente  mensajes de WhatsApp, firmados por Meta.
//
// Solo consulta: lo único que escribe son las tablas `wa_*`. El modelo elige una consulta de una lista
// (lib/aiService.ts) y la respuesta sale de la base (lib/respuestas.ts). Modelo, transcripción y voz
// corren en contenedores de esta PC, sin puertos publicados (infra/selfhost/voz).
//
// · `verify_jwt: false`: del otro lado está Meta, que no tiene sesión. La autenticación es la firma
//   HMAC del cuerpo. En el servidor propio va en `FUNCTIONS_NO_VERIFY_JWT` y en `SLUGS_REPO`.
// · Se responde 200 enseguida y se trabaja en segundo plano: si Meta no recibe respuesta, reintenta.
//   Por los reintentos, `wamid` es único: un mensaje repetido no se procesa dos veces.
// · Un número no autorizado no recibe respuesta ni le gasta el cupo de mensajes a la empresa.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { elegirConsulta, pideCambio, type Intercambio } from './lib/aiService.ts'
import { ejecutar } from './lib/consultas.ts'
import { TEXTOS } from './lib/respuestas.ts'
import { avisarEscribiendo, bajarAudio, enviarNotaDeVoz, enviarTexto } from './lib/whatsapp.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

const VOZ_URL = () => Deno.env.get('VOZ_URL') || 'http://voz:8080'
// Meta da 1000 mensajes de servicio por mes y por número. La voz manda dos por respuesta: desde acá
// se contesta solo con texto, para que el cupo alcance hasta fin de mes.
const TOPE_MENSUAL_CON_VOZ = 800
// Tope duro para todos los usuarios juntos (pedido del 07/11/2026: no pasar de los 1000 gratis). Con
// 995 enviados se deja de contestar; los 5 restantes cubren el aviso de "sin cupo" (uno por persona y
// por mes) y dos mensajes que se procesen al mismo tiempo justo en el límite.
const TOPE_MENSUAL = 1000
const TOPE_RESPUESTAS = TOPE_MENSUAL - 5
const VENTANA_CHARLA_MS = 30 * 60 * 1000

const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

// ── Autenticación ────────────────────────────────────────────────────────────────────────────────
const bytes = (t: string) => new TextEncoder().encode(t)

async function iguales(a: string, b: string) {
  // Comparar los resúmenes evita filtrar el largo o el prefijo del secreto por el tiempo de respuesta.
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', bytes(a)), crypto.subtle.digest('SHA-256', bytes(b))])
  const ax = new Uint8Array(x), ay = new Uint8Array(y)
  let dif = 0
  for (let i = 0; i < ax.length; i++) dif |= ax[i] ^ ay[i]
  return dif === 0
}

export async function firmaValida(cuerpo: Uint8Array, cabecera: string | null, secreto: string) {
  const m = /^sha256=([0-9a-fA-F]{64})$/.exec(cabecera ?? '')
  if (!m) return false
  const clave = await crypto.subtle.importKey('raw', bytes(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  const firma = Uint8Array.from(m[1].match(/.{2}/g)!.map((h) => parseInt(h, 16)))
  return crypto.subtle.verify('HMAC', clave, firma, cuerpo)
}

// ── Voz ──────────────────────────────────────────────────────────────────────────────────────────
class AudioRechazado extends Error {}

async function transcribir(audio: Uint8Array): Promise<string> {
  const r = await fetch(`${VOZ_URL()}/transcribir`, { method: 'POST', body: audio, signal: AbortSignal.timeout(150_000) })
  if (r.status === 413) throw new AudioRechazado('audio-largo')
  if (!r.ok) throw new Error(`voz-transcribir-${r.status}`)
  return ((await r.json()).texto ?? '').trim()
}

async function hablar(texto: string): Promise<Uint8Array> {
  const r = await fetch(`${VOZ_URL()}/hablar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!r.ok) throw new Error(`voz-hablar-${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

// ── Procesamiento de un mensaje ──────────────────────────────────────────────────────────────────
async function historial(cliente: any, waId: string, wamid: string): Promise<Intercambio[]> {
  const desde = new Date(Date.now() - VENTANA_CHARLA_MS).toISOString()
  const { data } = await cliente.from('wa_mensajes')
    .select('texto, consulta, argumentos')
    .eq('wa_id', waId).eq('autorizado', true).eq('estado', 'respondido')
    .neq('wamid', wamid).gte('recibido_ts', desde)
    .order('recibido_ts', { ascending: false }).limit(3)
  return (data ?? []).filter((m: any) => m.texto).reverse()
    .map((m: any) => ({ pregunta: m.texto, consulta: m.consulta, argumentos: m.argumentos }))
}

// Meta cuenta por mes calendario en UTC.
const inicioDelMes = () => {
  const ahora = new Date()
  return new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1)).toISOString()
}

async function enviadosDelMes(cliente: any) {
  const { data } = await cliente.from('wa_mensajes').select('enviados').gt('enviados', 0).gte('recibido_ts', inicioDelMes())
  return (data ?? []).reduce((s: number, m: any) => s + m.enviados, 0)
}

// Cupo agotado: se avisa una vez por persona y por mes, y después silencio hasta el mes que viene.
async function sinCupo(cliente: any, msg: any, usados: number) {
  const { count } = await cliente.from('wa_mensajes').select('id', { count: 'exact', head: true })
    .eq('wa_id', msg.from).eq('error', 'sin-cupo').gt('enviados', 0).gte('recibido_ts', inicioDelMes())
  let enviados = 0
  if (!count && usados < TOPE_MENSUAL) {
    try { await enviarTexto(msg.from, TEXTOS.sinCupo); enviados = 1 } catch (e) { console.error('wa-asistente: aviso cupo', String(e)) }
  }
  await cliente.from('wa_mensajes').update({ estado: 'ignorado', error: 'sin-cupo', enviados }).eq('wamid', msg.id)
}

async function procesar(cliente: any, msg: any, empresa: string) {
  const inicio = Date.now()
  const waId: string = msg.from
  let enviados = 0
  let texto: string | null = msg.type === 'text' ? String(msg.text?.body ?? '').trim() : null
  let consulta: string | null = null
  let argumentos: unknown = null
  let conVoz = false
  let respuestaFinal = ''

  const contestar = async (t: string) => {
    await enviarTexto(waId, t)
    enviados++
    respuestaFinal = t
  }

  try {
    await avisarEscribiendo(msg.id)
    const esAudio = msg.type === 'audio' || msg.type === 'voice'

    let audioRechazado = false
    if (esAudio) {
      try {
        texto = await transcribir(await bajarAudio(msg.audio?.id ?? msg.voice?.id))
      } catch (e) {
        if (!(e instanceof AudioRechazado)) throw e
        audioRechazado = true
      }
    }

    if (!esAudio && msg.type !== 'text') {
      await contestar(TEXTOS.soloTextoOAudio)
    } else if (audioRechazado) {
      await contestar(TEXTOS.audioLargo)
    } else {
      if (!texto) {
        await contestar(TEXTOS.audioVacio)
      } else {
        let respuesta: { texto: string; voz: string }
        try {
          const eleccion = pideCambio(texto) ? null : await elegirConsulta(texto, await historial(cliente, waId, msg.id))
          consulta = eleccion?.consulta ?? null
          argumentos = eleccion?.argumentos ?? null
          respuesta = eleccion
            ? await ejecutar(cliente, empresa, eleccion.consulta, eleccion.argumentos)
            : { texto: TEXTOS.fueraDeTema, voz: TEXTOS.fueraDeTema }
        } catch (e) {
          console.error('wa-asistente: consulta', String(e))
          const t = String(e).includes('ollama') || e instanceof DOMException || e instanceof TypeError ? TEXTOS.iaCaida : TEXTOS.errorConsulta
          respuesta = { texto: t, voz: t }
        }

        // Lo transcripto va a la vista: así se nota enseguida si el audio se entendió mal.
        await contestar(esAudio ? `Entendí: "${texto}"\n\n${respuesta.texto}` : respuesta.texto)

        if (esAudio && (await enviadosDelMes(cliente)) + enviados < TOPE_MENSUAL_CON_VOZ) {
          try {
            await enviarNotaDeVoz(waId, await hablar(respuesta.voz))
            enviados++
            conVoz = true
          } catch (e) {
            // El texto ya salió: sin voz, la persona igual tiene su respuesta.
            console.error('wa-asistente: voz', String(e))
          }
        }
      }
    }
    await cliente.from('wa_mensajes').update({
      texto, consulta, argumentos, respuesta: respuestaFinal, estado: 'respondido', enviados, con_voz: conVoz,
      ms_total: Date.now() - inicio, respondido_ts: new Date().toISOString(),
    }).eq('wamid', msg.id)
  } catch (e) {
    console.error('wa-asistente: mensaje', String(e))
    // Nunca queda mudo: si falló antes de contestar, se intenta avisar.
    if (enviados === 0) {
      try { await contestar(TEXTOS.errorConsulta) } catch (e2) { console.error('wa-asistente: aviso', String(e2)) }
    }
    await cliente.from('wa_mensajes').update({
      texto, consulta, argumentos, estado: 'error', error: String(e).slice(0, 500), enviados,
      ms_total: Date.now() - inicio,
    }).eq('wamid', msg.id)
  }
}

async function recibir(cliente: any, msg: any) {
  const { data: usuario } = await cliente.from('wa_asistente_usuarios')
    .select('id_empresa').eq('wa_id', msg.from).eq('activo', true).maybeSingle()

  const { data: nuevo, error } = await cliente.from('wa_mensajes').upsert({
    wamid: msg.id,
    wa_id: msg.from,
    id_empresa: usuario?.id_empresa ?? null,
    autorizado: !!usuario,
    tipo: String(msg.type ?? 'desconocido').slice(0, 30),
    estado: usuario ? 'recibido' : 'ignorado',
  }, { onConflict: 'wamid', ignoreDuplicates: true }).select('id')
  if (error) throw new Error(`wa_mensajes: ${error.message}`)

  if (!nuevo?.length) return // reintento de Meta: ya se procesó
  if (!usuario) { console.warn('wa-asistente: número no autorizado'); return }
  const usados = await enviadosDelMes(cliente)
  if (usados >= TOPE_RESPUESTAS) return sinCupo(cliente, msg, usados)
  await procesar(cliente, msg, usuario.id_empresa)
}

function mensajesDe(payload: any): any[] {
  const lista: any[] = []
  for (const entrada of payload?.entry ?? []) {
    for (const cambio of entrada?.changes ?? []) {
      if (cambio?.field !== 'messages') continue
      // `statuses` (entregado, leído) también llega por acá y no se procesa.
      for (const m of cambio?.value?.messages ?? []) {
        if (typeof m?.id === 'string' && /^[0-9]{8,15}$/.test(String(m?.from))) lista.push(m)
      }
    }
  }
  return lista
}

// ── Entrada ──────────────────────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const secretoApp = Deno.env.get('WHATSAPP_APP_SECRET')
  const tokenVerificacion = Deno.env.get('WEBHOOK_VERIFY_TOKEN')
  // Sin secretos no se atiende: es preferible un error visible a un webhook sin validar.
  if (!secretoApp || !tokenVerificacion) return new Response('sin-configurar', { status: 503 })

  if (req.method === 'GET') {
    const q = new URL(req.url).searchParams
    if (q.get('hub.mode') === 'subscribe' && await iguales(q.get('hub.verify_token') ?? '', tokenVerificacion)) {
      return new Response(q.get('hub.challenge') ?? '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
    }
    return new Response('prohibido', { status: 403 })
  }
  if (req.method !== 'POST') return new Response('metodo-no-permitido', { status: 405 })

  const cuerpo = new Uint8Array(await req.arrayBuffer())
  if (!(await firmaValida(cuerpo, req.headers.get('x-hub-signature-256'), secretoApp))) {
    return new Response('firma-invalida', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(cuerpo))
  } catch {
    return new Response('json-invalido', { status: 400 })
  }

  const cliente = db()
  const trabajo = Promise.allSettled(mensajesDe(payload).map((m) => recibir(cliente, m))).then((rs) => {
    for (const r of rs) if (r.status === 'rejected') console.error('wa-asistente:', String(r.reason))
  })
  EdgeRuntime.waitUntil(trabajo)
  return new Response('ok', { status: 200 })
})
