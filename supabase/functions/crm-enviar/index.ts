// crm-enviar — la persona del CRM le escribe al cliente por WhatsApp (plan 41, paso 3; 09/11/2026).
//
// POST /functions/v1/crm-enviar  (con JWT; NO va en FUNCTIONS_NO_VERIFY_JWT)
//   { conversacion, tipo: 'texto', texto }
//   { conversacion, tipo: 'imagen', base64, mime, texto? }   jpeg | png | webp, hasta 5 MB
//   { conversacion, tipo: 'audio',  base64, mime }           ogg (opus) | mp4 | mpeg | aac | amr, hasta 5 MB
// → { ok: true, id, estado_envio, wamid } · errores: { error: '<código>', ... }
//
// Reglas (las valida el servidor, no se confía en el navegador):
//   · Permiso 'crm' (o superadmin). Con 'crm_ver' → 403 'solo-lectura'.
//   · La conversación tiene que estar asignada a quien envía. Si está libre, el envío la toma
//     (`crm_tomar`, atómico); si la tiene otro → 409 'sin-control' con `asignada_nombre`.
//   · Ventana de 24 h desde el último mensaje del cliente; afuera → 409 'fuera-de-ventana'
//     (hace falta una plantilla aprobada: etapa 8 del plan).
//   · Tope mensual del número (`crm_parametros.tope_mensual`) → 429 'sin-cupo'.
//   · El audio del navegador sale en webm en Chrome: Meta no lo acepta → 415 'formato-no-aceptado'
//     (la web tiene que grabar en ogg/opus; se resuelve en el paso 4).
import { atender, conversacion, enviarAlCliente, exigirVentana, Rechazo, type Salida } from '../_compartido/crm.ts'

const MAX_BYTES = 5 * 1024 * 1024
const MIMES: Record<string, string[]> = {
  imagen: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/amr'],
}

function bytesDe(b64: unknown): Uint8Array {
  if (typeof b64 !== 'string' || !b64) throw new Rechazo(400, 'archivo-vacio')
  // 4 caracteres de base64 = 3 bytes: se corta antes de decodificar algo enorme.
  if (b64.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw new Rechazo(413, 'archivo-grande', { max_bytes: MAX_BYTES })
  try {
    return Uint8Array.from(atob(b64.replace(/^data:[^,]*,/, '')), (ch) => ch.charCodeAt(0))
  } catch {
    throw new Rechazo(400, 'base64-invalido')
  }
}

function salidaDe(cuerpo: any): Salida {
  const tipo = cuerpo.tipo ?? 'texto'
  if (tipo === 'texto') {
    const texto = typeof cuerpo.texto === 'string' ? cuerpo.texto.trim() : ''
    if (!texto) throw new Rechazo(400, 'texto-vacio')
    if (texto.length > 4096) throw new Rechazo(400, 'texto-largo', { max: 4096 })
    return { tipo: 'texto', texto }
  }
  if (tipo === 'imagen' || tipo === 'audio') {
    const mime = String(cuerpo.mime ?? '').split(';')[0].trim().toLowerCase()
    if (!MIMES[tipo].includes(mime)) throw new Rechazo(415, 'formato-no-aceptado', { aceptados: MIMES[tipo] })
    const datos = bytesDe(cuerpo.base64)
    if (datos.length > MAX_BYTES) throw new Rechazo(413, 'archivo-grande', { max_bytes: MAX_BYTES })
    if (tipo === 'audio') return { tipo, datos, mime }
    const epigrafe = typeof cuerpo.texto === 'string' ? cuerpo.texto.trim().slice(0, 1024) : ''
    return { tipo, datos, mime, texto: epigrafe || null }
  }
  throw new Rechazo(400, 'tipo-invalido')
}

Deno.serve((req) => atender(req, async (ctx, cuerpo) => {
  const salida = salidaDe(cuerpo) // primero lo barato: un pedido mal formado no toma el control
  const c = await conversacion(ctx, cuerpo.conversacion, { control: true, tomarSiLibre: true, antesDeTomar: exigirVentana })
  return { ok: true, ...(await enviarAlCliente(ctx, c, salida)) }
}))
