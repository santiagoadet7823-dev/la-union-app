// wa-auditor — auditor nocturno del asistente de CONSULTAS (09/11/2026, db/106, plan 44).
//
// POST /functions/v1/wa-auditor?paso=analizar[&dia=AAAA-MM-DD]   (pg_cron, 01:00–03:50 de Salta, cada 10 min)
// POST /functions/v1/wa-auditor?paso=resumen[&dia=AAAA-MM-DD]    (pg_cron, 08:00 de Salta)
//
// Solo el número de consultas (Santiago, Darsh y Javier). No toca ventas ni el CRM.
//
// · Pide el header `x-auditor-token` (Vault `wa_auditor_token`, lo pone `_cron_llamar_auditor`): la
//   clave anon es pública y sola no alcanza.
// · Responde 202 enseguida y trabaja en segundo plano (pg_net corta a los 60 s).
// · IA LOCAL: el mismo Ollama del asistente, de a un mensaje, con salida JSON forzada. No gasta tokens
//   de ninguna nube. Lo que propone la IA se valida con reglas fijas antes de ofrecerlo (`_compartido/auditor.ts`).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import DEF from '../wa-asistente/lib/herramientas.json' with { type: 'json' }
import { normalizar } from '../wa-asistente/lib/aiService.ts'
import {
  CONSULTAS, fechaSalta, inicioDia, patronAtajo, resumenDiario, validarAlias, validarAtajo, type TipoAlias,
} from '../_compartido/auditor.ts'

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }
const db = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const LOTE = 8
const PRESUPUESTO_MS = 280_000 // el worker corta a los 400 s
const TOPE_RESPUESTAS = 995    // el mismo del asistente (asistente.ts)

// ── Clasificación con la IA local ────────────────────────────────────────────────────────────────
const CAUSAS = ['bien', 'herramienta_equivocada', 'falta_herramienta', 'falta_dato', 'transcripcion', 'nombre_no_encontrado', 'otro']
const ESQUEMA = {
  type: 'object',
  properties: {
    causa: { type: 'string', enum: CAUSAS },
    debio_consulta: { type: 'string', enum: [...CONSULTAS, 'ninguna'] },
    debio_argumentos: { type: 'object' },
    arreglo: { type: 'string', enum: ['ninguno', 'atajo', 'alias', 'ejemplo_prompt', 'herramienta_nueva', 'otro'] },
    frase_clave: { type: 'string' },
    alias_tipo: { type: 'string', enum: ['ninguno', 'persona', 'cliente', 'producto', 'zona'] },
    alias_dice: { type: 'string' },
    alias_es: { type: 'string' },
    explicacion: { type: 'string' },
  },
  required: ['causa', 'debio_consulta', 'arreglo', 'explicacion'],
}

const SISTEMA = [
  'Revisás mensajes de un asistente interno de WhatsApp de una distribuidora de alimentos. El asistente NO redacta: elige una consulta de la lista y la respuesta sale de la base de datos.',
  'Tu trabajo: decir si eligió bien y qué cambio simple lo arreglaría. Respondé solo con el JSON pedido.',
  'Consultas que existen:',
  ...(DEF.herramientas as any[]).map((h) => `- ${h[0]}: ${h[1]}`),
  '- precio_servicio: cuánto cuesta el asistente',
  'Causas:',
  '- bien: la respuesta corresponde a lo que preguntó (también si dijo con dato_no_disponible que no hay un dato que el sistema no tiene, o si correctamente no respondió un pedido de cambio).',
  '- herramienta_equivocada: había una consulta correcta en la lista y eligió otra o ninguna. Poné cuál en debio_consulta.',
  '- falta_herramienta: la pregunta tiene sentido para el negocio pero ninguna consulta de la lista la cubre.',
  '- falta_dato: pidió un dato que el sistema no tiene y la respuesta no lo aclaró bien.',
  '- transcripcion: era un audio y la transcripción salió mal.',
  '- nombre_no_encontrado: usó un apodo o un nombre distinto del cargado (por ejemplo "Gabi" por "Gabriel").',
  'Arreglos:',
  '- atajo: solo si una frase corta del mensaje (2 a 5 palabras, en frase_clave, copiada tal cual del mensaje) siempre significa la misma consulta.',
  '- alias: solo si en la charla aparece el nombre real; alias_dice = cómo lo dijo, alias_es = el nombre real.',
  '- ejemplo_prompt: el modelo necesita un ejemplo para no confundirse.',
  '- herramienta_nueva: hace falta una consulta nueva.',
  'explicacion: una oración en español, de menos de 200 caracteres.',
].join('\n')

const recortar = (t: unknown, n: number) => { const s = String(t ?? ''); return s.length > n ? s.slice(0, n) + '…' : s }

async function clasificar(contexto: string) {
  const base = Deno.env.get('OLLAMA_URL') || 'http://ollama:11434'
  const modelo = Deno.env.get('OLLAMA_MODEL') || 'qwen3.5:4b'
  const r = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(90_000),
    // num_ctx igual al del asistente: otro valor obliga a Ollama a recargar el modelo.
    body: JSON.stringify({
      model: modelo, stream: false, think: false, format: ESQUEMA,
      options: { temperature: 0, num_ctx: 4096, num_predict: 300 },
      messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: contexto }],
    }),
  })
  if (!r.ok) throw new Error(`ollama-${r.status}`)
  const d = await r.json()
  return JSON.parse(d?.message?.content ?? '{}')
}

async function contextoDe(cliente: any, m: any, motivos: string[]) {
  const [{ data: antes }, { data: despues }] = await Promise.all([
    cliente.from('wa_mensajes').select('texto, consulta').eq('wa_id', m.wa_id).lt('recibido_ts', m.recibido_ts)
      .not('texto', 'is', null).gte('recibido_ts', new Date(new Date(m.recibido_ts).getTime() - 30 * 60_000).toISOString())
      .order('recibido_ts', { ascending: false }).limit(1),
    cliente.from('wa_mensajes').select('texto').eq('wa_id', m.wa_id).gt('recibido_ts', m.recibido_ts)
      .not('texto', 'is', null).order('recibido_ts').limit(1),
  ])
  return [
    `Señales: ${motivos.join(', ')}`,
    antes?.[0] ? `Mensaje anterior: "${recortar(antes[0].texto, 200)}" (consulta ${antes[0].consulta ?? 'ninguna'})` : '',
    `${m.tipo === 'audio' || m.tipo === 'voice' ? 'Audio transcripto' : 'Pregunta'}: "${recortar(m.texto, 300)}"`,
    `Eligió: ${m.consulta ?? 'ninguna'} ${m.argumentos ? JSON.stringify(m.argumentos) : ''}`,
    `Respuesta enviada: "${recortar(m.respuesta, 600)}"`,
    despues?.[0] ? `Lo siguiente que escribió la persona: "${recortar(despues[0].texto, 200)}"` : '',
  ].filter(Boolean).join('\n')
}

// ── Propuestas ───────────────────────────────────────────────────────────────────────────────────
type Nueva = { tipo: string; peso: 'liviano' | 'complejo'; clave: string; titulo: string; detalle: any }

function pedidoClaude(p: any, ejemplos: any[]) {
  const d = p.detalle ?? {}
  return [
    `Auditor del asistente de CONSULTAS (wa-asistente), propuesta #${p.id}: ${p.titulo} (×${p.veces}).`,
    d.causa ? `Causa según la IA local (revisar, puede equivocarse): ${d.causa}. ${d.explicacion ?? ''}` : '',
    'Mensajes reales:',
    ...ejemplos.map((m) => `- «${recortar(m.texto, 200)}» → eligió ${m.consulta ?? 'ninguna'}${d.debio && d.debio !== 'ninguna' ? `; debió ${d.debio}` : ''}`),
    'Antes de cambiar: probar_frases.sh (≥ 98/99, 0 graves) y, después, con --con-aprendidos.',
  ].filter(Boolean).join('\n')
}

async function guardarPropuesta(cliente: any, empresa: string, n: Nueva, idMensaje: number, frase: any) {
  const { data: abierta } = await cliente.from('wa_auditor_propuestas').select('*')
    .eq('id_empresa', empresa).eq('clave', n.clave).in('estado', ['nueva', 'enviada']).maybeSingle()
  let p = abierta
  if (p) {
    const ejemplos = [...new Set([...(p.ejemplos ?? []), idMensaje])].slice(-5)
    const frases = [...(p.detalle?.frases ?? []), ...(frase ? [frase] : [])].slice(-5)
    const { data } = await cliente.from('wa_auditor_propuestas').update({
      veces: ejemplos.length > (p.ejemplos ?? []).length ? p.veces + 1 : p.veces, ejemplos,
      detalle: { ...p.detalle, frases }, actualizado_ts: new Date().toISOString(),
    }).eq('id', p.id).select('*').single()
    p = data
  } else {
    const { data, error } = await cliente.from('wa_auditor_propuestas').insert({
      id_empresa: empresa, tipo: n.tipo, peso: n.peso, clave: n.clave, titulo: n.titulo.slice(0, 160),
      detalle: { ...n.detalle, frases: frase ? [frase] : [] }, ejemplos: [idMensaje],
    }).select('*').single()
    if (error) throw new Error(`wa_auditor_propuestas: ${error.message}`)
    p = data
  }
  if (p.peso === 'complejo') {
    const { data: ej } = await cliente.from('wa_mensajes').select('texto, consulta').in('id', p.ejemplos)
    await cliente.from('wa_auditor_propuestas').update({ pedido_claude: pedidoClaude(p, ej ?? []) }).eq('id', p.id)
  }
}

/** Pasa la sugerencia de la IA a una propuesta, validando lo liviano con reglas fijas. */
async function proponer(cliente: any, m: any, perfil: string, s: any) {
  const empresa = m.id_empresa
  const texto = String(m.texto ?? '')
  const debio = CONSULTAS.has(s.debio_consulta) ? s.debio_consulta : null
  const base = { causa: s.causa, explicacion: recortar(s.explicacion, 200), debio: s.debio_consulta }
  const frase = { frase: recortar(texto, 300), consulta: debio, argumentos: s.debio_argumentos ?? {} }

  if (s.arreglo === 'alias' && s.alias_tipo && s.alias_tipo !== 'ninguno' && s.alias_dice && s.alias_es
      && normalizar(texto).includes(normalizar(s.alias_dice))) {
    const tipo = s.alias_tipo as TipoAlias
    if (!(await validarAlias(cliente, empresa, perfil, tipo, s.alias_dice, s.alias_es))) {
      return guardarPropuesta(cliente, empresa, {
        tipo: 'alias', peso: 'liviano', clave: `alias:${tipo}:${normalizar(s.alias_dice)}`,
        titulo: `Alias: «${s.alias_dice}» es ${s.alias_es} (${tipo})`,
        detalle: { ...base, alias_tipo: tipo, dice: recortar(s.alias_dice, 80), es: recortar(s.alias_es, 80) },
      }, m.id, null)
    }
  }
  if (s.arreglo === 'atajo' && debio && s.frase_clave && normalizar(texto).includes(normalizar(s.frase_clave))) {
    const patron = patronAtajo(s.frase_clave, debio)
    // Con argumentos libres el atajo es del mensaje entero: tiene que coincidir con este mensaje.
    if (patron && new RegExp(patron).test(normalizar(texto)) && !(await validarAtajo(cliente, empresa, patron, debio))) {
      return guardarPropuesta(cliente, empresa, {
        tipo: 'atajo', peso: 'liviano', clave: `atajo:${debio}:${patron}`,
        titulo: `Atajo: «${recortar(s.frase_clave, 60)}» → ${debio}`,
        detalle: { ...base, patron, consulta: debio, argumentos: s.debio_argumentos ?? {} },
      }, m.id, frase)
    }
  }
  // Lo demás es complejo: un solo pedido por tipo de problema, que junta los ejemplos.
  const grupos: Record<string, [string, string]> = {
    herramienta_equivocada: [`prompt:${debio ?? 'ninguna'}`, `Elige mal: debería ser ${debio ?? 'ninguna consulta'}`],
    falta_herramienta: ['falta_herramienta', 'Preguntas que ninguna consulta cubre'],
    falta_dato: ['falta_dato', 'Piden datos que el sistema no tiene'],
    transcripcion: ['transcripcion', 'Audios mal transcriptos'],
    nombre_no_encontrado: ['nombres', 'Nombres o apodos que no encuentra'],
    otro: ['otro', 'Otras respuestas dudosas'],
  }
  const g = grupos[s.causa]
  if (!g) return
  return guardarPropuesta(cliente, empresa, { tipo: 'claude', peso: 'complejo', clave: g[0], titulo: g[1], detalle: base },
    m.id, s.causa === 'herramienta_equivocada' ? frase : null)
}

// ── Pasos ────────────────────────────────────────────────────────────────────────────────────────
async function analizar(cliente: any, dia: string) {
  const inicio = Date.now()
  // Señales del día anterior (en Salta): idempotente, se puede llamar en cada corrida.
  const desde = inicioDia(dia), hasta = new Date(desde.getTime() + 86_400_000)
  const { error: eSen } = await cliente.rpc('wa_auditor_senales', { p_desde: desde.toISOString(), p_hasta: hasta.toISOString() })
  if (eSen) throw new Error(`wa_auditor_senales: ${eSen.message}`)

  const viejo = new Date(Date.now() - 15 * 60_000).toISOString()
  const { data: pend } = await cliente.from('wa_auditor_hallazgos').select('id, motivos, intentos, id_mensaje')
    .or(`estado.eq.pendiente,and(estado.eq.analizando,tomado_ts.lt.${viejo})`).lt('intentos', 3)
    .order('created_at').limit(LOTE)
  let hechos = 0
  for (const h of pend ?? []) {
    if (Date.now() - inicio > PRESUPUESTO_MS) break
    const { data: tomado } = await cliente.from('wa_auditor_hallazgos')
      .update({ estado: 'analizando', tomado_ts: new Date().toISOString(), intentos: h.intentos + 1 })
      .eq('id', h.id).eq('intentos', h.intentos).select('id')
    if (!tomado?.length) continue // lo tomó otra corrida
    try {
      const { data: m } = await cliente.from('wa_mensajes').select('*').eq('id', h.id_mensaje).single()
      // Error o lentitud sin otra señal: es operativo, la IA no tiene nada que mirar.
      const soloOperativo = h.motivos.every((x: string) => x === 'error' || x === 'lento')
      if (soloOperativo || !m.texto) {
        await cliente.from('wa_auditor_hallazgos').update({ estado: 'analizado', causa: 'operativo', analizado_ts: new Date().toISOString() }).eq('id', h.id)
        continue
      }
      const s = await clasificar(await contextoDe(cliente, m, h.motivos))
      if (!CAUSAS.includes(s.causa)) throw new Error(`causa inválida: ${s.causa}`)
      await cliente.from('wa_auditor_hallazgos').update({
        estado: 'analizado', causa: s.causa, sugerencia: s, error: null, analizado_ts: new Date().toISOString(),
      }).eq('id', h.id)
      const { data: u } = await cliente.from('wa_asistente_usuarios').select('id_perfil').eq('wa_id', m.wa_id).maybeSingle()
      if (s.causa !== 'bien' && u?.id_perfil) await proponer(cliente, m, u.id_perfil, s)
      hechos++
    } catch (e) {
      console.error('wa-auditor: hallazgo', h.id, String(e))
      await cliente.from('wa_auditor_hallazgos').update({
        estado: h.intentos + 1 >= 3 ? 'error' : 'pendiente', error: String(e).slice(0, 300),
      }).eq('id', h.id)
    }
  }
  console.log(`wa-auditor: analizados ${hechos} de ${pend?.length ?? 0} en ${Date.now() - inicio} ms`)
}

async function resumen(cliente: any, dia: string) {
  const inicioMes = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString()
  const cupoLibre = async () => {
    const { data } = await cliente.from('wa_mensajes').select('enviados').gt('enviados', 0).gte('recibido_ts', inicioMes)
    return (data ?? []).reduce((s: number, m: any) => s + m.enviados, 0) < TOPE_RESPUESTAS
  }
  const { data: empresas } = await cliente.from('wa_asistente_usuarios').select('id_empresa').eq('activo', true)
  for (const empresa of new Set((empresas ?? []).map((e: any) => e.id_empresa as string))) {
    console.log('wa-auditor: resumen', empresa, await resumenDiario(cliente, empresa, dia, cupoLibre))
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('método no permitido', { status: 405 })
  const cliente = db()
  const { data: valido } = await cliente.rpc('wa_auditor_token_valido', { p_token: req.headers.get('x-auditor-token') ?? '' })
  if (valido !== true) return new Response('no autorizado', { status: 401 })

  const url = new URL(req.url)
  const paso = url.searchParams.get('paso')
  const diaParam = url.searchParams.get('dia')
  if (diaParam && !/^\d{4}-\d{2}-\d{2}$/.test(diaParam)) return new Response('dia inválido', { status: 400 })
  const hoy = fechaSalta()
  // analizar: por defecto el día anterior; resumen: el de hoy (cubre el día anterior).
  const ayer = fechaSalta(new Date(inicioDia(hoy).getTime() - 12 * 3_600_000))
  let tarea: Promise<unknown>
  if (paso === 'analizar') tarea = analizar(cliente, diaParam ?? ayer)
  else if (paso === 'resumen') tarea = resumen(cliente, diaParam ?? hoy)
  else return new Response('paso desconocido', { status: 400 })
  EdgeRuntime.waitUntil(tarea.catch((e) => console.error(`wa-auditor: ${paso}`, String(e))))
  return new Response('ok', { status: 202 })
})
