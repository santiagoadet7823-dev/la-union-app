// lib/aiService.ts — le pregunta al modelo local QUÉ consulta corresponde. Nada más.
//
// 🔒 El modelo elige una herramienta de esta lista y sus argumentos, y ahí termina su trabajo. No ve
// datos del negocio y no redacta la respuesta. Por eso no puede inventar un monto, y un nombre de
// cliente en la base no puede meterle instrucciones. Lo que devuelva como texto libre se descarta: en
// la prueba del 07/11 le pidieron un chiste y lo contó en vez de negarse.

export type Intercambio = { pregunta: string; consulta: string | null; argumentos: unknown }
export type Eleccion = { consulta: string; argumentos: Record<string, unknown> }

const PERIODO = {
  type: 'string',
  enum: ['hoy', 'ayer', 'semana', 'semana_pasada', 'mes', 'mes_pasado'],
  description: 'semana y mes son los que están en curso',
}
const herramienta = (name: string, description: string, properties: Record<string, unknown> = {}) => ({
  type: 'function',
  function: {
    name,
    description,
    parameters: { type: 'object', properties, required: Object.keys(properties) },
  },
})

export const HERRAMIENTAS = [
  herramienta('ventas_resumen', 'Total vendido y cantidad de pedidos de un período', { periodo: PERIODO }),
  herramienta('ventas_por_vendedor', 'Ranking de ventas por vendedor en un período', { periodo: PERIODO }),
  herramienta('ventas_por_categoria', 'Ventas por rubro o categoría en un período', { periodo: PERIODO }),
  herramienta('productos_mas_vendidos', 'Productos más vendidos y productos en caída en un período', { periodo: PERIODO }),
  herramienta('buscar_pedido', 'Estado de un pedido por su número', { numero: { type: 'string' } }),
  herramienta('pedidos_de_cliente', 'Últimos pedidos de un cliente, buscado por nombre o código', { cliente: { type: 'string' } }),
  herramienta('precio_producto', 'Precio y ofertas de un producto del catálogo', { producto: { type: 'string' } }),
  herramienta('equipo_en_calle', 'Qué vendedores y repartidores están trabajando ahora y su último reporte'),
  herramienta('clientes_sin_comprar', 'Clientes que dejaron de comprar hace N días', { dias: { type: 'integer' } }),
  herramienta('consulta_stock', 'Cualquier pregunta sobre stock, existencias o depósito'),
  herramienta('ayuda', 'Saludos, agradecimientos o preguntas sobre qué puede hacer el asistente'),
]
const NOMBRES = new Set(HERRAMIENTAS.map((h) => h.function.name))

const SISTEMA = `Sos el asistente interno de una distribuidora de alimentos. Para contestar, llamá a UNA herramienta.
Si te hablan de otro tema o te piden modificar, borrar o crear algo, no llames ninguna herramienta.
Los mensajes pueden venir de un audio transcripto y tener errores: interpretá la intención.
Si el mensaje sigue la charla anterior ("y ayer?", "y el de Pérez?"), usá la misma herramienta y cambiá solo lo que pide.
"un mes" son 30 días; "dos meses", 60.`

// El modelo no alcanza para esto: en la prueba del 07/11, "anula el pedido 687" eligió buscar_pedido y
// mostró el pedido sin aclarar nada, y quien lo pidió podía creer que se había anulado. Solo mira el
// comienzo del mensaje, para no confundir preguntas como "cuántos pedidos se anularon".
const PIDE_CAMBIO = /^(?:(?:che|dale|hola|por favor|porfa|podes|podrias|quiero|quisiera|necesito|hay que|me)[\s,]+)*(?:anul|borr|elimin|cancel|modific|cambi|agreg|asign|carg|cre)(?:a|ar|ame|alo|ala|alos|alas|arlo|arla)\b/

export function pideCambio(texto: string) {
  const t = texto.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return PIDE_CAMBIO.test(t)
}

export function armarMensajes(texto: string, historial: Intercambio[]) {
  const mensajes: { role: string; content: string }[] = [{ role: 'system', content: SISTEMA }]
  for (const h of historial) {
    mensajes.push({ role: 'user', content: h.pregunta })
    mensajes.push({
      role: 'assistant',
      content: h.consulta ? `Usé ${h.consulta} con ${JSON.stringify(h.argumentos ?? {})}` : 'No correspondía ninguna herramienta.',
    })
  }
  mensajes.push({ role: 'user', content: texto })
  return mensajes
}

/** Devuelve la consulta elegida, o null si no corresponde ninguna. Tira error si el modelo no responde. */
export async function elegirConsulta(texto: string, historial: Intercambio[]): Promise<Eleccion | null> {
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
      tools: HERRAMIENTAS,
      options: { temperature: 0, num_ctx: 4096, num_predict: 120 },
      messages: armarMensajes(texto, historial),
    }),
  })
  if (!r.ok) throw new Error(`ollama-${r.status}`)
  const datos = await r.json()
  const llamada = datos?.message?.tool_calls?.[0]?.function
  if (!llamada || !NOMBRES.has(llamada.name)) return null
  const argumentos = llamada.arguments && typeof llamada.arguments === 'object' ? llamada.arguments : {}
  return { consulta: llamada.name, argumentos }
}
