// lib/aiService.ts — le pregunta al modelo local QUÉ consulta corresponde. Nada más.
//
// 🔒 El modelo elige una herramienta de esta lista y sus argumentos, y ahí termina su trabajo. No ve
// datos del negocio y no redacta la respuesta. Por eso no puede inventar un monto, y un nombre de
// cliente en la base no puede meterle instrucciones. Lo que devuelva como texto libre se descarta: en
// la prueba del 07/11 le pidieron un chiste y lo contó en vez de negarse.

export type Intercambio = { pregunta: string; consulta: string | null; argumentos: unknown }
export type Eleccion = { consulta: string; argumentos: Record<string, unknown> }

// Herramientas y prompt viven en herramientas.json (plan 40): la prueba automática
// (pruebas/probar_frases.py) lee el mismo archivo, así lo que se prueba es lo que corre.
import DEF from './herramientas.json' with { type: 'json' }

/** Formato de Ollama. Un argumento escrito como texto ("periodo") es un tipo de `DEF.tipos`. */
export function armarHerramientas(def: any) {
  return def.herramientas.map(([name, description, args]: [string, string, Record<string, unknown>]) => {
    const properties = Object.fromEntries(Object.entries(args).map(([k, v]) => [k, typeof v === 'string' ? def.tipos[v] : v]))
    return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required: Object.keys(properties) } } }
  })
}

export const HERRAMIENTAS = armarHerramientas(DEF)
const NOMBRES = new Set(HERRAMIENTAS.map((h: any) => h.function.name))
const SISTEMA = (DEF.sistema as string[]).join('\n')

// El modelo no alcanza para esto: en la prueba del 07/11, "anula el pedido 687" eligió buscar_pedido y
// mostró el pedido sin aclarar nada, y quien lo pidió podía creer que se había anulado. Solo mira el
// comienzo del mensaje, para no confundir preguntas como "cuántos pedidos se anularon".
const PIDE_CAMBIO = /^(?:(?:che|dale|hola|por favor|porfa|podes|podrias|quiero|quisiera|necesito|hay que|me)[\s,]+)*(?:anul|borr|elimin|cancel|modific|cambi|agreg|asign|carg|cre)(?:a|ar|ame|alo|ala|alos|alas|arlo|arla)\b/

/** Preguntas que el modelo confunde con ventas aunque el sistema no tenga el dato (plan 40: "¿cuánto
 * cobramos hoy?" daba el total vendido en 2 de 2 pruebas). Se resuelven antes del modelo, con las
 * reglas de `atajos` en herramientas.json, que la prueba automática también usa. */
const ATAJOS = (DEF.atajos as [string, string, Record<string, unknown>][]).map(([re, consulta, argumentos]) => ({ re: new RegExp(re), consulta, argumentos }))

/** Minúsculas y sin acentos: así se comparan atajos, alias y comandos. */
export const normalizar = (texto: string) => texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function atajo(texto: string): Eleccion | null {
  const t = normalizar(texto)
  const a = ATAJOS.find((x) => x.re.test(t))
  return a ? { consulta: a.consulta, argumentos: { ...a.argumentos } } : null
}

/** Atajos que aprobó Santiago desde el auditor (tabla `wa_atajos_aprendidos`, plan 44). Van después de
 * los del archivo y antes del modelo. Un patrón roto se saltea: nunca deja al asistente sin contestar. */
export type AtajoAprendido = { patron: string; consulta: string; argumentos: Record<string, unknown> }

// Se releen cada 5 minutos; aplicar o deshacer desde el auditor borra la caché. Si la tabla falla, se
// sigue sin ellos.
let cacheAtajos: { empresa: string; hasta: number; lista: AtajoAprendido[] } | null = null
export function olvidarAtajos() { cacheAtajos = null }
export async function atajosAprendidos(db: any, empresa: string): Promise<AtajoAprendido[]> {
  if (!cacheAtajos || cacheAtajos.empresa !== empresa || cacheAtajos.hasta < Date.now()) {
    const { data } = await db.from('wa_atajos_aprendidos').select('patron, consulta, argumentos')
      .eq('id_empresa', empresa).eq('activo', true).order('id')
    cacheAtajos = { empresa, hasta: Date.now() + 5 * 60_000, lista: data ?? [] }
  }
  return cacheAtajos.lista
}
export function atajoAprendido(texto: string, lista: AtajoAprendido[]): Eleccion | null {
  const t = normalizar(texto)
  for (const a of lista) {
    if (!NOMBRES.has(a.consulta) && a.consulta !== 'precio_servicio') continue
    try {
      if (new RegExp(a.patron).test(t)) return { consulta: a.consulta, argumentos: { ...(a.argumentos ?? {}) } }
    } catch { /* patrón inválido: se ignora */ }
  }
  return null
}

export function pideCambio(texto: string) {
  return PIDE_CAMBIO.test(normalizar(texto))
}

/** "respondeme en audio", "mandamelo en nota de voz": un mensaje escrito que pide la respuesta hablada. */
export function pideAudio(texto: string) {
  const t = texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return /\b(en|por|con|un|una|como)\s+(audio|nota de voz|mensaje de voz)\b/.test(t)
}

// Un mensaje puede pedir varias cosas ("cuánto se vendió, quién vendió y qué productos"). En la
// consulta guardada van separadas por coma y los argumentos, en una lista con el mismo orden.
export const MAX_CONSULTAS = 3
export function juntar(elecciones: Eleccion[]) {
  if (!elecciones.length) return { consulta: null, argumentos: null }
  return elecciones.length === 1
    ? { consulta: elecciones[0].consulta, argumentos: elecciones[0].argumentos }
    : { consulta: elecciones.map((e) => e.consulta).join(','), argumentos: elecciones.map((e) => e.argumentos) }
}

export function armarMensajes(texto: string, historial: Intercambio[]) {
  const mensajes: { role: string; content: string }[] = [{ role: 'system', content: SISTEMA }]
  for (const h of historial) {
    mensajes.push({ role: 'user', content: h.pregunta })
    const nombres = h.consulta ? h.consulta.split(',') : []
    const args = nombres.length > 1 && Array.isArray(h.argumentos) ? h.argumentos : [h.argumentos]
    mensajes.push({
      role: 'assistant',
      content: nombres.length
        ? 'Usé ' + nombres.map((n, i) => `${n} con ${JSON.stringify(args[i] ?? {})}`).join(' y ')
        : 'No correspondía ninguna herramienta.',
    })
  }
  mensajes.push({ role: 'user', content: texto })
  return mensajes
}

/** Devuelve las consultas elegidas (hasta MAX_CONSULTAS, sin repetir), o [] si no corresponde ninguna.
 * Tira error si el modelo no responde. Antes se usaba solo la primera y se perdía el resto del pedido
 * (08/11: "cuánto se vendió, quién vendió y qué productos" contestó solo el total). */
export async function elegirConsultas(texto: string, historial: Intercambio[]): Promise<Eleccion[]> {
  return (await elegirConsultasDetalle(texto, historial)).elecciones
}

/** Igual que `elegirConsultas`, más lo que devolvió el modelo tal cual (para el auditor, plan 44). */
export async function elegirConsultasDetalle(texto: string, historial: Intercambio[]): Promise<{ elecciones: Eleccion[]; crudo: unknown[]; modelo: string }> {
  const base = Deno.env.get('OLLAMA_URL') || 'http://ollama:11434'
  const modelo = Deno.env.get('OLLAMA_MODEL') || 'qwen3.5:4b'
  const r = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 90 s: el primer mensaje después de un reinicio además carga el modelo en memoria.
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: modelo,
      stream: false,
      think: false,
      // Plan 49: con OLLAMA_KEEP_ALIVE=24h, después de un día sin consultas el modelo se descargaba y la
      // primera respuesta tardó 51 s (18/11). -1 = queda en memoria (3 GB) hasta reiniciar Ollama.
      keep_alive: -1,
      tools: HERRAMIENTAS,
      // 240: alcanza para tres llamadas con sus argumentos.
      options: { temperature: 0, num_ctx: 8192, num_predict: 240 },
      messages: armarMensajes(texto, historial),
    }),
  })
  if (!r.ok) throw new Error(`ollama-${r.status}`)
  const datos = await r.json()
  const elegidas: Eleccion[] = []
  const vistas = new Set<string>()
  for (const c of datos?.message?.tool_calls ?? []) {
    const llamada = c?.function
    if (!llamada || !NOMBRES.has(llamada.name)) continue
    const argumentos = llamada.arguments && typeof llamada.arguments === 'object' ? llamada.arguments : {}
    const clave = llamada.name + JSON.stringify(argumentos)
    if (vistas.has(clave)) continue
    vistas.add(clave)
    elegidas.push({ consulta: llamada.name, argumentos })
  }
  // "hola, cuánto vendimos": el saludo no suma una ayuda al lado de la respuesta.
  const utiles = elegidas.length > 1 ? elegidas.filter((e) => e.consulta !== 'ayuda') : elegidas
  const crudo = (datos?.message?.tool_calls ?? []).slice(0, 6).map((c: any) => c?.function ?? c)
  return { elecciones: utiles.slice(0, MAX_CONSULTAS), crudo, modelo }
}
