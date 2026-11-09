// wa-entrada — entrada única de WhatsApp para todos los números de DisT-At (09/11/2026, plan 41 paso 2).
//
// GET  /functions/v1/wa-entrada  verificación del webhook de Meta.
// POST /functions/v1/wa-entrada  mensajes y estados, firmados por Meta.
//
// Un solo webhook por app de Meta, muchos números: cada cambio trae `metadata.phone_number_id` y se
// busca en `wa_numeros` (db/104):
//   · consultas → `wa-asistente/asistente.ts`, el MISMO código que atiende hoy (mismo tope de 1000).
//   · ventas    → `ventas.ts`: queda en el CRM (contacto, conversación, mensaje, archivo, estados).
//   · desconocido o inactivo → se ignora con un aviso en el log (no se guarda el texto).
// Compatibilidad: el número de consultas de siempre (`WHATSAPP_PHONE_NUMBER_ID`) se atiende aunque no
// esté cargado en `wa_numeros`, para que reapuntar el webhook acá no cambie nada para el dueño.
//
// 🔴 El webhook de Meta sigue apuntando a `wa-asistente` hasta que La Unión apruebe el CRM (paso 6).
//
// · `verify_jwt: false` como `wa-asistente`: la autenticación es la firma HMAC del cuerpo
//   (`FUNCTIONS_NO_VERIFY_JWT`). Usa los mismos secretos de la app de Meta.
// · Se responde 200 enseguida y se trabaja en segundo plano: si Meta no recibe respuesta, reintenta.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { abrirWebhook, cambiosDe, numeroDeConsultas } from '../_compartido/meta.ts'
import { atenderAsistente } from '../wa-asistente/asistente.ts'
import { atenderVentas, type NumeroVentas } from './ventas.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

type Numero = NumeroVentas & { proposito: 'consultas' | 'ventas'; activo: boolean }

async function despachar(cliente: any, payload: unknown) {
  const cambios = cambiosDe(payload)
  const ids = [...new Set(cambios.map((c) => c.phoneNumberId).filter((x): x is string => !!x))]
  const { data, error } = ids.length
    ? await cliente.from('wa_numeros').select('id, id_empresa, phone_number_id, proposito, token_ref, activo').in('phone_number_id', ids)
    : { data: [], error: null }
  if (error) throw new Error(`wa_numeros: ${error.message}`)
  const porId = new Map<string, Numero>((data ?? []).map((n: Numero) => [n.phone_number_id, n]))
  const consultasDeSiempre = numeroDeConsultas().phoneNumberId

  const trabajos: Promise<unknown>[] = []
  for (const c of cambios) {
    if (!c.mensajes.length && !c.estados.length) continue
    const n = c.phoneNumberId ? porId.get(c.phoneNumberId) : undefined
    // El asistente atiende un solo número: el de sus variables. Otro número "consultas" en la tabla
    // contestaría desde el número equivocado, así que se ignora hasta que el asistente sea multinúmero.
    const esConsultas = c.phoneNumberId === consultasDeSiempre && (!n || (n.activo && n.proposito === 'consultas'))
    if (esConsultas) {
      // Los estados (entregado, leído) del asistente no se guardan, como siempre.
      if (c.mensajes.length) trabajos.push(atenderAsistente(cliente, c.mensajes))
    } else if (n?.activo && n.proposito === 'ventas') {
      trabajos.push(atenderVentas(cliente, n, c))
    } else {
      console.warn(`wa-entrada: número sin destino (${n ? (n.activo ? n.proposito : 'inactivo') : 'no cargado'}); ` +
        `${c.mensajes.length} mensaje(s) y ${c.estados.length} estado(s) ignorados`)
    }
  }
  const rs = await Promise.allSettled(trabajos)
  for (const r of rs) if (r.status === 'rejected') console.error('wa-entrada:', String(r.reason))
}

Deno.serve(async (req) => {
  const abierto = await abrirWebhook(req)
  if ('respuesta' in abierto) return abierto.respuesta
  EdgeRuntime.waitUntil(despachar(db(), abierto.payload).catch((e) => console.error('wa-entrada:', String(e))))
  return new Response('ok', { status: 200 })
})
