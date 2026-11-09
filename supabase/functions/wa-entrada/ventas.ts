// ventas.ts — lo que entra por un número de VENTAS: queda en el CRM (db/104, plan 41 paso 2).
//
// Por cada mensaje: contacto (uno por empresa y wa_id), conversación abierta (una por contacto),
// mensaje (`wamid` único: un reintento de Meta no se guarda dos veces) y, si trae audio, imagen o
// documento, el archivo en el bucket privado `crm-media` (<empresa>/<conversación>/<wamid>.<ext>).
// Los audios se transcriben con el contenedor `voz`, igual que en el asistente.
// Los `statuses` de Meta (enviado, entregado, leído, falló) actualizan `estado_envio` de lo que salió.
//
// 🔴 El bot de ventas todavía NO contesta (paso 5 del plan 41). Mientras tanto, una conversación en
// estado `bot` queda guardada y visible en el CRM sin respuesta. No hay ningún número de ventas cargado
// en `wa_numeros` hasta que La Unión apruebe (paso 6), así que hoy esto no recibe mensajes reales.
//
// Token: `wa_numeros.token_ref` es el NOMBRE de una variable de entorno del contenedor de funciones
// (cargada como las de `configurar_whatsapp.sh`), nunca el valor (regla 25). Sin token se guarda el
// mensaje igual; lo único que no se puede es bajar el archivo.
import { clienteMeta, type Cambio, type ClienteMeta } from '../_compartido/meta.ts'
import { AudioRechazado, transcribir } from '../_compartido/voz.ts'

export type NumeroVentas = { id: string; id_empresa: string; phone_number_id: string; token_ref: string | null }

// Tipo de Meta → tipo del CRM (el CHECK de `crm_mensajes.tipo`).
const TIPOS: Record<string, string> = {
  text: 'texto', audio: 'audio', voice: 'audio', image: 'imagen', sticker: 'imagen',
  document: 'documento', video: 'documento', location: 'ubicacion',
}
const EXT: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/amr': 'amr', 'audio/aac': 'aac',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf', 'video/mp4': 'mp4',
}

/** El texto que se ve en la bandeja y en la burbuja. Lo que no es texto lleva una descripción corta. */
export function textoDe(m: any): string | null {
  switch (m.type) {
    case 'text': return String(m.text?.body ?? '').trim() || null
    // Sin texto: la bandeja muestra "🎤 Audio" (trigger de db/104) y la burbuja, la transcripción.
    case 'audio': case 'voice': return null
    case 'image': case 'video': case 'sticker': return m[m.type]?.caption ?? null
    case 'document': return m.document?.caption ?? m.document?.filename ?? null
    case 'location': {
      const l = m.location ?? {}
      const lugar = [l.name, l.address].filter(Boolean).join(' · ')
      return `📍 ${lugar ? lugar + ' ' : ''}(${l.latitude}, ${l.longitude})`
    }
    case 'button': return m.button?.text ?? null
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null
    case 'reaction': return `Reaccionó ${m.reaction?.emoji ?? ''} a un mensaje`.trim()
    default: return `[${String(m.type ?? 'desconocido')}: tipo de mensaje que el CRM todavía no muestra]`
  }
}

const idMedia = (m: any): string | null => m[m.type]?.id ?? null

/** Hora de Meta (segundos Unix). La ventana de 24 h se cuenta desde que el cliente escribió, no desde que llegó. */
function horaDe(m: any): string {
  const s = Number(m.timestamp)
  return Number.isFinite(s) && s > 1_600_000_000 ? new Date(s * 1000).toISOString() : new Date().toISOString()
}

async function contacto(cliente: any, empresa: string, waId: string, nombre: string | null) {
  const { data: hay, error: e1 } = await cliente.from('crm_contactos')
    .select('id, nombre_perfil').eq('id_empresa', empresa).eq('wa_id', waId).maybeSingle()
  if (e1) throw new Error(`crm_contactos: ${e1.message}`)
  if (hay) {
    if (nombre && nombre !== hay.nombre_perfil) {
      await cliente.from('crm_contactos').update({ nombre_perfil: nombre }).eq('id', hay.id)
    }
    return hay.id as string
  }
  // Que el cliente escriba primero es su consentimiento para que le contesten (opt-in).
  const { data, error } = await cliente.from('crm_contactos')
    .upsert({ id_empresa: empresa, wa_id: waId, nombre_perfil: nombre, opt_in_ts: new Date().toISOString() },
      { onConflict: 'id_empresa,wa_id', ignoreDuplicates: true }).select('id')
  if (error) throw new Error(`crm_contactos: ${error.message}`)
  if (data?.length) return data[0].id as string
  // Otro mensaje del mismo cliente lo creó al mismo tiempo.
  const { data: otra } = await cliente.from('crm_contactos').select('id').eq('id_empresa', empresa).eq('wa_id', waId).single()
  return otra.id as string
}

async function conversacion(cliente: any, numero: NumeroVentas, idContacto: string) {
  const abierta = () => cliente.from('crm_conversaciones').select('id, estado')
    .eq('id_contacto', idContacto).neq('estado', 'cerrada').maybeSingle()
  const { data: hay } = await abierta()
  if (hay) return hay as { id: string; estado: string }
  const { data, error } = await cliente.from('crm_conversaciones')
    .insert({ id_empresa: numero.id_empresa, id_numero: numero.id, id_contacto: idContacto, estado: 'bot' })
    .select('id, estado').single()
  if (!error) return data as { id: string; estado: string }
  // 23505: el índice `crm_conv_abierta_uq` frenó una segunda conversación abierta creada a la vez.
  if (error.code === '23505') {
    const { data: otra } = await abierta()
    if (otra) return otra as { id: string; estado: string }
  }
  throw new Error(`crm_conversaciones: ${error.message}`)
}

/** Baja el archivo de Meta, lo guarda en `crm-media` y, si es audio, lo transcribe. Nunca tira: anota el error. */
async function guardarMedia(cliente: any, meta: ClienteMeta | null, empresa: string, conv: string, idMsj: number, m: any) {
  const id = idMedia(m)
  if (!id) return
  const cambios: Record<string, unknown> = {}
  try {
    if (!meta) throw new Error('sin-token: el número no tiene token cargado')
    const { datos, mime } = await meta.bajarMedia(id)
    const tipoMime = (mime ?? m[m.type]?.mime_type ?? 'application/octet-stream').split(';')[0].trim()
    const ruta = `${empresa}/${conv}/${m.id.replace(/[^A-Za-z0-9_.-]/g, '_')}.${EXT[tipoMime] ?? 'bin'}`
    const { error } = await cliente.storage.from('crm-media').upload(ruta, datos, { contentType: tipoMime, upsert: true })
    if (error) throw new Error(`crm-media: ${error.message}`)
    cambios.media_path = ruta
    cambios.media_mime = tipoMime
    if (m.type === 'audio' || m.type === 'voice') {
      try {
        cambios.transcripcion = (await transcribir(datos)) || null
      } catch (e) {
        cambios.error = e instanceof AudioRechazado ? 'audio-largo: no se transcribió' : `transcribir: ${String(e).slice(0, 300)}`
      }
    }
  } catch (e) {
    console.error('wa-entrada: media', String(e))
    cambios.error = String(e).slice(0, 500)
  }
  await cliente.from('crm_mensajes').update(cambios).eq('id', idMsj)
}

async function recibirVenta(cliente: any, numero: NumeroVentas, meta: ClienteMeta | null, m: any, contactos: any[]) {
  const nombre = contactos.find((c: any) => String(c?.wa_id) === String(m.from))?.profile?.name ?? null
  const idContacto = await contacto(cliente, numero.id_empresa, m.from, nombre)
  const conv = await conversacion(cliente, numero, idContacto)

  const { data: nuevo, error } = await cliente.from('crm_mensajes').upsert({
    id_empresa: numero.id_empresa,
    id_conversacion: conv.id,
    wamid: m.id,
    direccion: 'entra',
    autor: 'cliente',
    tipo: TIPOS[m.type] ?? 'texto',
    texto: textoDe(m)?.slice(0, 4096) ?? null,
    created_at: horaDe(m),
  }, { onConflict: 'wamid', ignoreDuplicates: true }).select('id')
  if (error) throw new Error(`crm_mensajes: ${error.message}`)
  if (!nuevo?.length) return // reintento de Meta: ya se guardó

  await guardarMedia(cliente, meta, numero.id_empresa, conv.id, nuevo[0].id, m)

  if (conv.estado === 'bot') {
    // Paso 5 del plan 41: acá contesta el bot de ventas (`wa-ventas`, Ollama local).
    console.log('wa-entrada: conversación en estado bot; el bot de ventas todavía no está (paso 5)')
  }
}

// Un estado nunca retrocede: Meta puede mandar "entregado" después de "leído".
const ORDEN: Record<string, number> = { enviando: 0, enviado: 1, entregado: 2, leido: 3 }
const ESTADO_META: Record<string, string> = { sent: 'enviado', delivered: 'entregado', read: 'leido', failed: 'fallo' }

async function actualizarEstado(cliente: any, empresa: string, s: any) {
  const nuevo = ESTADO_META[s.status]
  if (!nuevo) return
  const { data: msj } = await cliente.from('crm_mensajes').select('id, estado_envio')
    .eq('wamid', s.id).eq('id_empresa', empresa).eq('direccion', 'sale').maybeSingle()
  if (!msj) return // no salió desde el CRM (o es de otro número)
  if (nuevo === 'fallo') {
    const e = s.errors?.[0]
    const detalle = e ? `${e.code ?? ''} ${e.title ?? ''} ${e.error_data?.details ?? ''}`.trim() : 'falló sin detalle'
    await cliente.from('crm_mensajes').update({ estado_envio: 'fallo', error: `meta: ${detalle}`.slice(0, 500) }).eq('id', msj.id)
    return
  }
  if (msj.estado_envio === 'fallo' || (ORDEN[msj.estado_envio] ?? -1) >= ORDEN[nuevo]) return
  await cliente.from('crm_mensajes').update({ estado_envio: nuevo }).eq('id', msj.id)
}

export async function atenderVentas(cliente: any, numero: NumeroVentas, cambio: Cambio) {
  const token = numero.token_ref ? Deno.env.get(numero.token_ref) : undefined
  if (!token) console.warn(`wa-entrada: el número de ventas ${numero.id} no tiene token (token_ref sin cargar)`)
  const meta = token ? clienteMeta({ phoneNumberId: numero.phone_number_id, token }) : null

  const trabajos = [
    ...cambio.mensajes.map((m) => recibirVenta(cliente, numero, meta, m, cambio.contactos)),
    ...cambio.estados.map((s) => actualizarEstado(cliente, numero.id_empresa, s)),
  ]
  const rs = await Promise.allSettled(trabajos)
  for (const r of rs) if (r.status === 'rejected') console.error('wa-entrada: ventas', String(r.reason))
}
