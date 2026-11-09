// _compartido/crm.ts — lo común de `crm-enviar` y `crm-ticket` (plan 41, paso 3; 09/11/2026).
//
// Quién llama (JWT → perfil activo con acceso 'operar'), la conversación con su número de ventas, la
// ventana de 24 h de Meta, el tope mensual de envíos y el envío REGISTRADO: primero se guarda el
// mensaje en `crm_mensajes` ('enviando', así aparece al instante en el CRM por Realtime), después se
// manda a Meta y se anota el `wamid` (con el que `wa-entrada` sigue entregado/leído/falló) o el error.
//
// · Permisos: los decide la base (`crm_acceso_de`, `crm_puede_operar`, db/104). Acá no se repite la regla.
// · Conversaciones `demo = true` (paso 6): no se habla con Meta; el mensaje queda como enviado sin
//   `wamid` y no cuenta para el tope. Así la demostración no gasta cupo ni le escribe a nadie.
// · El token del número sale de `Deno.env.get(wa_numeros.token_ref)`, igual que en `wa-entrada`.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { clienteMeta } from './meta.ts'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
export const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Un rechazo con código para el CRM (`error`) y, si sirve, datos para mostrar (quién tiene el control, el ticket actual). */
export class Rechazo extends Error {
  constructor(public status: number, public codigo: string, public extra: Record<string, unknown> = {}) {
    super(codigo)
  }
}

export const VENTANA_MS = 24 * 60 * 60 * 1000

export type Yo = { id: string; nombre: string; rol: string; id_empresa: string | null }
export type Conversacion = {
  id: string; id_empresa: string; id_numero: string | null; id_contacto: string; estado: string
  asignada_a: string | null; asignada_nombre: string | null; ultima_entrante_ts: string | null; demo: boolean
}
export type Contexto = {
  db: any          // service_role
  comoYo: any      // con el JWT de quien llama (para las RPC que usan auth.uid(), como crm_tomar)
  yo: Yo
}

/** Valida el JWT y que el perfil pueda OPERAR el CRM. Con 'crm_ver' (demostración) → 403. */
export async function abrir(req: Request): Promise<Contexto> {
  const url = Deno.env.get('SUPABASE_URL')!
  const comoYo = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const { data: ud } = await comoYo.auth.getUser()
  const uid = ud?.user?.id
  if (!uid) throw new Rechazo(401, 'no-auth')
  const db = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const [{ data: perfil }, { data: acceso, error }] = await Promise.all([
    db.from('perfiles').select('id, nombre, rol, id_empresa, activo').eq('id', uid).maybeSingle(),
    db.rpc('crm_acceso_de', { p_perfil: uid }),
  ])
  if (error) throw new Error(`crm_acceso_de: ${error.message}`)
  if (!perfil?.activo) throw new Rechazo(403, 'sin-perfil')
  if (acceso === 'ver') throw new Rechazo(403, 'solo-lectura', { mensaje: 'Modo demostración: solo lectura' })
  if (acceso !== 'operar') throw new Rechazo(403, 'sin-permiso')
  return { db, comoYo, yo: { id: perfil.id, nombre: perfil.nombre ?? 'Alguien', rol: perfil.rol, id_empresa: perfil.id_empresa } }
}

/**
 * La conversación, si quien llama puede operarla (su empresa, o cualquiera si es superadmin).
 * `control`: además tiene que tenerla asignada. Si está libre y `tomarSiLibre`, la toma con `crm_tomar`
 * (con SU sesión: el mismo `update … where asignada_a is null` atómico del CRM, con su mensaje de sistema).
 */
export async function conversacion(ctx: Contexto, idConv: unknown,
  opciones: { control: boolean; tomarSiLibre?: boolean; antesDeTomar?: (c: Conversacion) => void }) {
  if (typeof idConv !== 'string' || !/^[0-9a-f-]{36}$/i.test(idConv)) throw new Rechazo(400, 'conversacion-invalida')
  const leer = async () => {
    const { data, error } = await ctx.db.from('crm_conversaciones')
      .select('id, id_empresa, id_numero, id_contacto, estado, asignada_a, asignada_nombre, ultima_entrante_ts, demo')
      .eq('id', idConv).maybeSingle()
    if (error) throw new Error(`crm_conversaciones: ${error.message}`)
    return data as Conversacion | null
  }
  const ok = async (exigir: boolean) => {
    const { data, error } = await ctx.db.rpc('crm_puede_operar', { p_perfil: ctx.yo.id, p_conv: idConv, p_exigir_control: exigir })
    if (error) throw new Error(`crm_puede_operar: ${error.message}`)
    return data === true
  }

  let c = await leer()
  // Una conversación de otra empresa se contesta igual que una que no existe: no se confirma que exista.
  if (!c || !(await ok(false))) throw new Rechazo(404, 'conversacion-inexistente')
  if (c.estado === 'cerrada') throw new Rechazo(409, 'conversacion-cerrada')
  // Lo que haría rebotar la acción se mira ANTES de tomar: un envío rechazado no deja el chat tomado.
  opciones.antesDeTomar?.(c)
  if (!opciones.control || c.asignada_a === ctx.yo.id) return c

  if (c.asignada_a === null && opciones.tomarSiLibre) {
    const { data, error } = await ctx.comoYo.rpc('crm_tomar', { p_conv: idConv, p_forzar: false })
    if (error) throw new Error(`crm_tomar: ${error.message}`)
    if (data?.ok) {
      c = await leer()
      if (c && (await ok(true))) return c
    }
    throw new Rechazo(409, 'sin-control', { asignada_nombre: data?.asignada_nombre ?? null })
  }
  throw new Rechazo(409, 'sin-control', { asignada_nombre: c.asignada_nombre })
}

/** ¿Se puede mandar texto libre? Meta solo lo deja hasta 24 h después del último mensaje del cliente. */
export function ventanaAbierta(c: Conversacion, ahora = Date.now()) {
  if (!c.ultima_entrante_ts) return false
  return ahora - new Date(c.ultima_entrante_ts).getTime() < VENTANA_MS
}

export function exigirVentana(c: Conversacion) {
  if (c.demo) return
  if (!ventanaAbierta(c)) {
    throw new Rechazo(409, 'fuera-de-ventana', {
      mensaje: 'Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo deja escribirle con una plantilla aprobada.',
      ultima_entrante_ts: c.ultima_entrante_ts,
    })
  }
}

/** Primer instante del mes en curso en la Argentina (UTC−3, sin horario de verano). */
function inicioDeMesAR(ahora = new Date()) {
  const ar = new Date(ahora.getTime() - 3 * 3600_000)
  return new Date(Date.UTC(ar.getUTCFullYear(), ar.getUTCMonth(), 1, 3)).toISOString()
}

/** Tope mensual de envíos del número de ventas (`crm_parametros.tope_mensual`). Solo cuentan los que salieron a Meta. */
async function exigirCupo(ctx: Contexto, c: Conversacion) {
  const { data: par } = await ctx.db.from('crm_parametros').select('tope_mensual').eq('id_empresa', c.id_empresa).maybeSingle()
  const tope = par?.tope_mensual ?? 1000
  const { count, error } = await ctx.db.from('crm_mensajes').select('id', { count: 'exact', head: true })
    .eq('id_empresa', c.id_empresa).eq('direccion', 'sale').not('wamid', 'is', null).gte('created_at', inicioDeMesAR())
  if (error) throw new Error(`crm_mensajes (cupo): ${error.message}`)
  if ((count ?? 0) >= tope) throw new Rechazo(429, 'sin-cupo', { tope })
}

async function metaDe(ctx: Contexto, c: Conversacion) {
  if (!c.id_numero) throw new Rechazo(409, 'sin-numero')
  const { data: n, error } = await ctx.db.from('wa_numeros')
    .select('phone_number_id, token_ref, activo, proposito').eq('id', c.id_numero).maybeSingle()
  if (error) throw new Error(`wa_numeros: ${error.message}`)
  if (!n?.activo || n.proposito !== 'ventas') throw new Rechazo(409, 'numero-inactivo')
  const token = n.token_ref ? Deno.env.get(n.token_ref) : undefined
  if (!token) throw new Rechazo(503, 'numero-sin-token')
  return clienteMeta({ phoneNumberId: n.phone_number_id, token })
}

async function waIdDe(ctx: Contexto, c: Conversacion): Promise<string> {
  const { data, error } = await ctx.db.from('crm_contactos').select('wa_id').eq('id', c.id_contacto).single()
  if (error) throw new Error(`crm_contactos: ${error.message}`)
  return data.wa_id
}

export type Salida =
  | { tipo: 'texto'; texto: string }
  | { tipo: 'ticket'; texto: string }
  | { tipo: 'imagen'; datos: Uint8Array; mime: string; texto?: string | null }
  | { tipo: 'audio'; datos: Uint8Array; mime: string }

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/amr': 'amr',
}

/**
 * Manda algo al cliente y lo deja registrado como mensaje de la persona. Devuelve la fila.
 * Antes de llamar: `conversacion(..., { control: true })` y `exigirVentana`.
 */
export async function enviarAlCliente(ctx: Contexto, c: Conversacion, s: Salida) {
  if (!c.demo) await exigirCupo(ctx, c)
  const meta = c.demo ? null : await metaDe(ctx, c)
  const waId = c.demo ? null : await waIdDe(ctx, c)

  // El archivo queda en `crm-media` para que el CRM lo muestre (el de Meta vence).
  let media_path: string | null = null
  if (s.tipo === 'imagen' || s.tipo === 'audio') {
    media_path = `${c.id_empresa}/${c.id}/sale-${crypto.randomUUID()}.${EXT[s.mime] ?? 'bin'}`
    const { error } = await ctx.db.storage.from('crm-media').upload(media_path, s.datos, { contentType: s.mime })
    if (error) throw new Error(`crm-media: ${error.message}`)
  }

  const { data: fila, error } = await ctx.db.from('crm_mensajes').insert({
    id_empresa: c.id_empresa,
    id_conversacion: c.id,
    direccion: 'sale',
    autor: 'persona',
    id_perfil: ctx.yo.id,
    autor_nombre: ctx.yo.nombre,
    tipo: s.tipo,
    texto: 'texto' in s ? (s.texto ?? null) : null,
    media_path,
    media_mime: 'mime' in s ? s.mime : null,
    estado_envio: c.demo ? 'enviado' : 'enviando',
  }).select('id').single()
  if (error) throw new Error(`crm_mensajes: ${error.message}`)

  await ctx.db.from('crm_conversaciones').update({ ultima_actividad_ts: new Date().toISOString() }).eq('id', c.id)
  if (c.demo) return { id: fila.id, estado_envio: 'enviado', wamid: null }

  try {
    let wamid: string | null
    if (s.tipo === 'imagen') wamid = await meta!.enviarImagen(waId!, s.datos, s.mime, s.texto)
    else if (s.tipo === 'audio') wamid = await meta!.enviarAudio(waId!, s.datos, s.mime)
    else wamid = await meta!.enviarTexto(waId!, s.texto)
    // Si `wa-entrada` ya anotó "entregado" por este wamid (carrera), no se vuelve atrás.
    await ctx.db.from('crm_mensajes').update({ wamid, estado_envio: 'enviado' }).eq('id', fila.id).eq('estado_envio', 'enviando')
    return { id: fila.id, estado_envio: 'enviado', wamid }
  } catch (e) {
    const detalle = String(e).slice(0, 500)
    console.error('crm: envío a Meta', detalle)
    await ctx.db.from('crm_mensajes').update({ estado_envio: 'fallo', error: detalle }).eq('id', fila.id)
    throw new Rechazo(502, 'meta-fallo', { id: fila.id, detalle })
  }
}

/** Corre el manejador y traduce `Rechazo` a JSON; cualquier otra cosa es 500 con el detalle en el log. */
export async function atender(req: Request, manejar: (ctx: Contexto, cuerpo: any) => Promise<unknown>) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)
  try {
    const ctx = await abrir(req)
    const cuerpo = await req.json().catch(() => null)
    if (!cuerpo || typeof cuerpo !== 'object') throw new Rechazo(400, 'json-invalido')
    return json(await manejar(ctx, cuerpo))
  } catch (e) {
    if (e instanceof Rechazo) return json({ error: e.codigo, ...e.extra }, e.status)
    console.error('crm:', String(e))
    return json({ error: 'error-interno' }, 500)
  }
}
