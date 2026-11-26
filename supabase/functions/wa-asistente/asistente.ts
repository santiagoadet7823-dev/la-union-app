// asistente.ts — procesamiento de los mensajes del número de CONSULTAS (dueño y encargados).
// Salió de `index.ts` el 09/11/2026 (plan 41) para que lo llamen las dos entradas con el mismo código:
// `wa-asistente` (el webhook de hoy) y `wa-entrada` (entrada única por número, cuando se reapunte).
// La lógica es la de siempre: solo cambió de archivo. Ver el encabezado de `index.ts`.
import { atajo, atajoAprendido, atajosAprendidos, elegirConsultasDetalle, juntar, pideAudio, pideCambio, type Eleccion, type Intercambio } from './lib/aiService.ts'
import { ejecutar, hoyEn } from './lib/consultas.ts'
import { corregir } from './lib/correcciones.ts'
import { bienvenida, TEXTOS } from './lib/respuestas.ts'
import { avisarEscribiendo, bajarAudio, enviarNotaDeVoz, enviarTexto } from './lib/whatsapp.ts'
import { AudioRechazado, hablar, transcribir } from '../_compartido/voz.ts'
import { atenderComando, comandoAuditor, tomarResumenPendiente } from '../_compartido/auditor.ts'

// Meta da 1000 mensajes de servicio por mes y por número. La voz manda dos por respuesta: desde acá
// se contesta solo con texto, para que el cupo alcance hasta fin de mes.
const TOPE_MENSUAL_CON_VOZ = 800
// Tope duro para todos los usuarios juntos (pedido del 07/11/2026: no pasar de los 1000 gratis). Con
// 995 enviados se deja de contestar; los 5 restantes cubren el aviso de "sin cupo" (uno por persona y
// por mes) y dos mensajes que se procesen al mismo tiempo justo en el límite.
const TOPE_MENSUAL = 1000
const TOPE_RESPUESTAS = TOPE_MENSUAL - 5
const VENTANA_CHARLA_MS = 30 * 60 * 1000

// Plan 53: los nombres del equipo, para completar la persona que el modelo deja vacía (caché 5 min).
let cacheEquipo: { empresa: string; hasta: number; nombres: string[] } | null = null
async function nombresEquipo(cliente: any, empresa: string): Promise<string[]> {
  if (cacheEquipo && cacheEquipo.empresa === empresa && cacheEquipo.hasta > Date.now()) return cacheEquipo.nombres
  const { data } = await cliente.from('perfiles').select('nombre').eq('id_empresa', empresa).eq('activo', true)
    .in('rol', ['vendedor', 'repartidor', 'encargado', 'admin'])
  const nombres = (data ?? []).map((p: any) => String(p.nombre || '').trim()).filter(Boolean)
  cacheEquipo = { empresa, hasta: Date.now() + 5 * 60_000, nombres }
  return nombres
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

// ¿Ya le contestamos alguna vez a este número? Si no, lo primero que recibe es la bienvenida.
async function esPrimeraVez(cliente: any, waId: string, wamid: string) {
  const { count } = await cliente.from('wa_mensajes').select('id', { count: 'exact', head: true })
    .eq('wa_id', waId).gt('enviados', 0).neq('wamid', wamid)
  return !count
}

async function procesar(cliente: any, msg: any, empresa: string, perfil: string, nombre: string, esSuper: boolean) {
  const inicio = Date.now()
  const waId: string = msg.from
  let enviados = 0
  let texto: string | null = msg.type === 'text' ? String(msg.text?.body ?? '').trim() : null
  let consulta: string | null = null
  let argumentos: unknown = null
  let conVoz = false
  let respuestaFinal = ''
  // Para el auditor (plan 44): cómo se eligió y cómo terminó cada mensaje, y cuánto tardó cada etapa.
  let origen: string | null = null
  let resultado: string | null = null
  let toolCalls: unknown = null
  let modelo: string | null = null
  let msIa: number | null = null
  let msConsulta: number | null = null
  let msVoz: number | null = null

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
      origen = 'fijo'; resultado = 'no_soportado'
      await contestar(TEXTOS.soloTextoOAudio)
    } else if (audioRechazado) {
      origen = 'fijo'; resultado = 'audio_fallido'
      await contestar(TEXTOS.audioLargo)
    } else {
      if (!texto) {
        origen = 'fijo'; resultado = 'audio_fallido'
        await contestar(TEXTOS.audioVacio)
      } else {
        let respuesta: { texto: string; voz: string }
        // Comandos del auditor ("aplicar 3", "auditoría"): solo el superadmin; para el resto siguen el camino normal.
        const comando = esSuper ? comandoAuditor(texto) : null
        try {
          if (comando) {
            origen = 'comando'; resultado = 'comando'
            const t = await atenderComando(cliente, empresa, perfil, comando)
            respuesta = { texto: t, voz: t }
          } else {
            let elecciones: Eleccion[]
            const fijo = pideCambio(texto) ? null : atajo(texto)
            const aprendido = pideCambio(texto) || fijo ? null : atajoAprendido(texto, await atajosAprendidos(cliente, empresa))
            if (pideCambio(texto)) { elecciones = []; origen = 'pide_cambio' }
            else if (fijo) { elecciones = [fijo]; origen = 'atajo' }
            else if (aprendido) { elecciones = [aprendido]; origen = 'aprendido' }
            else {
              origen = 'modelo'
              const t0 = Date.now()
              const d = await elegirConsultasDetalle(texto, await historial(cliente, waId, msg.id))
              msIa = Date.now() - t0
              elecciones = d.elecciones; toolCalls = d.crudo; modelo = d.modelo
            }
            // Plan 53: lo que el modelo confunde y se puede decidir con el texto (pedidos lejos, persona, fechas).
            if (elecciones.length && origen !== 'pide_cambio') {
              elecciones = corregir(texto, elecciones, await nombresEquipo(cliente, empresa).catch(() => []), hoyEn())
            }
            ;({ consulta, argumentos } = juntar(elecciones))
            // Varias consultas: una respuesta debajo de la otra, en el orden en que se pidieron.
            const nombres = elecciones.map((e) => e.consulta)
            const t1 = Date.now()
            const partes = await Promise.all(elecciones.map((e) => ejecutar(cliente, empresa, perfil, e.consulta, e.argumentos, nombres)))
            msConsulta = partes.length ? Date.now() - t1 : null
            respuesta = partes.length
              ? { texto: partes.map((p) => p.texto).join('\n\n'), voz: partes.map((p) => p.voz).join(' ') }
              : { texto: TEXTOS.fueraDeTema, voz: TEXTOS.fueraDeTema }
            // Lo más importante de las partes: una repregunta pesa más que un "no encontré" o un dato que no hay.
            const tipos: string[] = partes.map((p) => p.tipo ?? '')
            resultado = !partes.length ? (origen === 'pide_cambio' ? 'pide_cambio' : 'fuera_de_tema')
              : (['repregunta', 'no_encontrado', 'dato_no_disponible'].find((t) => tipos.includes(t)) ?? 'ok')
          }
        } catch (e) {
          console.error('wa-asistente: consulta', String(e))
          const caida = String(e).includes('ollama') || e instanceof DOMException || e instanceof TypeError
          const t = caida ? TEXTOS.iaCaida : TEXTOS.errorConsulta
          resultado = caida ? 'ia_caida' : 'error_consulta'
          respuesta = { texto: t, voz: t }
        }

        // Un "hola" de alguien nuevo ya quedó contestado con la bienvenida: no se manda la ayuda repetida.
        const yaContestado = primeraVez && consulta === 'ayuda'
        // Lo transcripto va a la vista: así se nota enseguida si el audio se entendió mal.
        if (!yaContestado) await contestar(esAudio ? `Entendí: "${texto}"\n\n${respuesta.texto}` : respuesta.texto)

        // Nota de voz: si la pregunta vino en audio, o si escrita pide "respondeme en audio".
        const quiereVoz = esAudio || pideAudio(texto)
        if (!yaContestado && quiereVoz && (await enviadosDelMes(cliente)) + enviados < TOPE_MENSUAL_CON_VOZ) {
          const t2 = Date.now()
          try {
            await enviarNotaDeVoz(waId, await hablar(respuesta.voz))
            enviados++
            conVoz = true
          } catch (e) {
            // El texto ya salió: sin voz, la persona igual tiene su respuesta.
            console.error('wa-asistente: voz', String(e))
          }
          msVoz = Date.now() - t2
        }
      }
    }

    // El resumen del auditor que no salió a las 08:00 (ventana de 24 h cerrada) sale ahora: este mensaje
    // la abrió. Va después de la respuesta, como un mensaje aparte.
    if (esSuper) {
      try {
        const pendiente = await tomarResumenPendiente(cliente, empresa)
        if (pendiente) { await enviarTexto(waId, pendiente); enviados++ }
      } catch (e) { console.error('wa-asistente: resumen pendiente', String(e)) }
    }

    await cliente.from('wa_mensajes').update({
      texto, consulta, argumentos, respuesta: respuestaFinal, estado: 'respondido', enviados, con_voz: conVoz,
      ms_total: Date.now() - inicio, respondido_ts: new Date().toISOString(),
      origen, resultado, tool_calls: toolCalls, modelo, ms_ia: msIa, ms_consulta: msConsulta, ms_voz: msVoz,
    }).eq('wamid', msg.id)
  } catch (e) {
    console.error('wa-asistente: mensaje', String(e))
    // Nunca queda mudo: si falló antes de contestar, se intenta avisar.
    if (enviados === 0) {
      try { await contestar(TEXTOS.errorConsulta) } catch (e2) { console.error('wa-asistente: aviso', String(e2)) }
    }
    await cliente.from('wa_mensajes').update({
      texto, consulta, argumentos, estado: 'error', error: String(e).slice(0, 500), enviados,
      ms_total: Date.now() - inicio, origen, resultado, tool_calls: toolCalls, modelo, ms_ia: msIa,
    }).eq('wamid', msg.id)
  }
}

export async function recibir(cliente: any, msg: any) {
  const { data: usuario } = await cliente.from('wa_asistente_usuarios')
    .select('id_empresa, id_perfil, perfiles(nombre, rol)').eq('wa_id', msg.from).eq('activo', true).maybeSingle()

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
  await procesar(cliente, msg, usuario.id_empresa, usuario.id_perfil, nombre, usuario.perfiles?.rol === 'superadmin')
}


/** Atiende todos los mensajes del número de consultas. Cada uno por separado: si uno falla, los demás siguen. */
export async function atenderAsistente(cliente: any, mensajes: any[]) {
  const rs = await Promise.allSettled(mensajes.map((m) => recibir(cliente, m)))
  for (const r of rs) if (r.status === 'rejected') console.error('wa-asistente:', String(r.reason))
}
