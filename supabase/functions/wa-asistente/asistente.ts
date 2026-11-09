// asistente.ts — procesamiento de los mensajes del número de CONSULTAS (dueño y encargados).
// Salió de `index.ts` el 09/11/2026 (plan 41) para que lo llamen las dos entradas con el mismo código:
// `wa-asistente` (el webhook de hoy) y `wa-entrada` (entrada única por número, cuando se reapunte).
// La lógica es la de siempre: solo cambió de archivo. Ver el encabezado de `index.ts`.
import { atajo, elegirConsultas, juntar, pideAudio, pideCambio, type Eleccion, type Intercambio } from './lib/aiService.ts'
import { ejecutar, hoyEn } from './lib/consultas.ts'
import { bienvenida, TEXTOS } from './lib/respuestas.ts'
import { avisarEscribiendo, bajarAudio, enviarNotaDeVoz, enviarTexto } from './lib/whatsapp.ts'
import { AudioRechazado, hablar, transcribir } from '../_compartido/voz.ts'

// Meta da 1000 mensajes de servicio por mes y por número. La voz manda dos por respuesta: desde acá
// se contesta solo con texto, para que el cupo alcance hasta fin de mes.
const TOPE_MENSUAL_CON_VOZ = 800
// Tope duro para todos los usuarios juntos (pedido del 07/11/2026: no pasar de los 1000 gratis). Con
// 995 enviados se deja de contestar; los 5 restantes cubren el aviso de "sin cupo" (uno por persona y
// por mes) y dos mensajes que se procesen al mismo tiempo justo en el límite.
const TOPE_MENSUAL = 1000
const TOPE_RESPUESTAS = TOPE_MENSUAL - 5
const VENTANA_CHARLA_MS = 30 * 60 * 1000

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

// ¿Ya le contestamos alguna vez a este número? Si no, lo primero que recibe es la bienvenida.
async function esPrimeraVez(cliente: any, waId: string, wamid: string) {
  const { count } = await cliente.from('wa_mensajes').select('id', { count: 'exact', head: true })
    .eq('wa_id', waId).gt('enviados', 0).neq('wamid', wamid)
  return !count
}

async function procesar(cliente: any, msg: any, empresa: string, perfil: string, nombre: string) {
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
    const primeraVez = await esPrimeraVez(cliente, waId, msg.id)
    if (primeraVez) await contestar(bienvenida(nombre, hoyEn()))

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
          const a = pideCambio(texto) ? null : atajo(texto)
          const elecciones: Eleccion[] = pideCambio(texto) ? [] : a ? [a] : await elegirConsultas(texto, await historial(cliente, waId, msg.id))
          ;({ consulta, argumentos } = juntar(elecciones))
          // Varias consultas: una respuesta debajo de la otra, en el orden en que se pidieron.
          const nombres = elecciones.map((e) => e.consulta)
          const partes = await Promise.all(elecciones.map((e) => ejecutar(cliente, empresa, perfil, e.consulta, e.argumentos, nombres)))
          respuesta = partes.length
            ? { texto: partes.map((p) => p.texto).join('\n\n'), voz: partes.map((p) => p.voz).join(' ') }
            : { texto: TEXTOS.fueraDeTema, voz: TEXTOS.fueraDeTema }
        } catch (e) {
          console.error('wa-asistente: consulta', String(e))
          const t = String(e).includes('ollama') || e instanceof DOMException || e instanceof TypeError ? TEXTOS.iaCaida : TEXTOS.errorConsulta
          respuesta = { texto: t, voz: t }
        }

        // Un "hola" de alguien nuevo ya quedó contestado con la bienvenida: no se manda la ayuda repetida.
        const yaContestado = primeraVez && consulta === 'ayuda'
        // Lo transcripto va a la vista: así se nota enseguida si el audio se entendió mal.
        if (!yaContestado) await contestar(esAudio ? `Entendí: "${texto}"\n\n${respuesta.texto}` : respuesta.texto)

        // Nota de voz: si la pregunta vino en audio, o si escrita pide "respondeme en audio".
        const quiereVoz = esAudio || pideAudio(texto)
        if (!yaContestado && quiereVoz && (await enviadosDelMes(cliente)) + enviados < TOPE_MENSUAL_CON_VOZ) {
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

export async function recibir(cliente: any, msg: any) {
  const { data: usuario } = await cliente.from('wa_asistente_usuarios')
    .select('id_empresa, id_perfil, perfiles(nombre)').eq('wa_id', msg.from).eq('activo', true).maybeSingle()

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
  // Solo el primer nombre: "Darsh Lajitas" → "Darsh".
  const nombre = String(usuario.perfiles?.nombre ?? '').trim().split(/\s+/)[0] || ''
  await procesar(cliente, msg, usuario.id_empresa, usuario.id_perfil, nombre)
}


/** Atiende todos los mensajes del número de consultas. Cada uno por separado: si uno falla, los demás siguen. */
export async function atenderAsistente(cliente: any, mensajes: any[]) {
  const rs = await Promise.allSettled(mensajes.map((m) => recibir(cliente, m)))
  for (const r of rs) if (r.status === 'rejected') console.error('wa-asistente:', String(r.reason))
}
