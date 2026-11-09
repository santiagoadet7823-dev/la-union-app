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
//
// Desde el 09/11/2026 (plan 41) el procesamiento vive en `asistente.ts` y la firma en
// `_compartido/meta.ts`: los comparte `wa-entrada`, que va a reemplazar a esta entrada cuando se
// reapunte el webhook. Hasta entonces este archivo atiende igual que antes.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { abrirWebhook, mensajesDe } from '../_compartido/meta.ts'
import { atenderAsistente } from './asistente.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }

const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  const abierto = await abrirWebhook(req)
  if ('respuesta' in abierto) return abierto.respuesta
  EdgeRuntime.waitUntil(atenderAsistente(db(), mensajesDe(abierto.payload)))
  return new Response('ok', { status: 200 })
})
