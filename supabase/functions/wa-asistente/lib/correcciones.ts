// Plan 53 (26/11/2026): correcciones en código, DESPUÉS de que el modelo elige, para lo que qwen 4B
// confunde y no depende del modelo. Sale de las consultas reales de Javier (wa_mensajes 321-337):
//  - «Alejandro mercado cuántos pedidos a más de 150 mt» → el modelo eligió ventas: con Agustín andaba
//    porque los ejemplos del prompt eran todos de Agustín. Ahora: «más de N m/mt/mts/metros» o «lejos
//    del comercio» → control_visitas, siempre.
//  - El modelo a veces deja `persona` vacía aunque el mensaje nombre a alguien del equipo: se completa
//    con el nombre que aparece en el texto (solo si hay UNO).
//  - «entre el día 22 de noviembre hasta hoy» → caía en ultimos_30. Ahora el rango se lee del texto
//    (`_desde`/`_hasta`, lo usa consultas.ts) y pisa el período.
import type { Eleccion } from './aiService.ts'

const norm = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

const CON_PERSONA = new Set(['ventas_por_vendedor', 'productos_mas_vendidos', 'primer_pedido_dia', 'rendimiento_vendedor',
  'control_visitas', 'clientes_sin_visitar'])
const CON_PERIODO = new Set(['ventas_resumen', 'ventas_por_vendedor', 'ventas_por_categoria', 'productos_mas_vendidos',
  'rendimiento_vendedor', 'control_visitas', 'avisos_equipo'])

const RE_LEJOS = /\b(a )?mas de \d+ ?(m|mt|mts|metro|metros)\b|\blejos del (comercio|negocio|cliente|local)\b/

export const esLejos = (texto: string) => RE_LEJOS.test(norm(texto))

/** El nombre del equipo que aparece en el texto: primero nombre completo; si no, un nombre o apellido que
 *  identifique a una sola persona. Null si no hay o si es ambiguo. */
export function personaEnTexto(texto: string, nombres: string[]): string | null {
  const t = ` ${norm(texto).replace(/[^a-z0-9ñ ]/g, ' ')} `
  const completos = nombres.filter((n) => n && t.includes(` ${norm(n)} `))
  if (completos.length === 1) return completos[0]
  if (completos.length > 1) return null
  const porPalabra = new Map<string, Set<string>>()
  for (const n of nombres) {
    for (const w of norm(n).split(' ')) {
      if (w.length < 4) continue
      if (!porPalabra.has(w)) porPalabra.set(w, new Set())
      porPalabra.get(w)!.add(n)
    }
  }
  const hallados = new Set<string>()
  for (const [w, quienes] of porPalabra) {
    if (t.includes(` ${w} `)) { if (quienes.size > 1) return null; quienes.forEach((q) => hallados.add(q)) }
  }
  return hallados.size === 1 ? [...hallados][0] : null
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'setiembre',
  'octubre', 'noviembre', 'diciembre']
const mesNum = (m: string) => { const i = MESES.indexOf(m); return i < 0 ? null : (i >= 9 ? i : i + 1) }
const dosDig = (n: number) => String(n).padStart(2, '0')

/** Un día del texto («22», «22 de noviembre», «22/11», «hoy») → AAAA-MM-DD, en el año de `hoy`. */
function dia(s: string, hoy: string, mesDefecto: number): string | null {
  s = s.trim()
  if (/^hoy$/.test(s)) return hoy
  if (/^ayer$/.test(s)) { const d = new Date(`${hoy}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
  let m = s.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/)
  if (m) return armar(+m[1], +m[2], hoy)
  m = s.match(/^(\d{1,2})(?: de (\w+))?$/)
  if (m) { const mes = m[2] ? mesNum(m[2]) : mesDefecto; return mes ? armar(+m[1], mes, hoy) : null }
  return null
}
function armar(d: number, mes: number, hoy: string) {
  if (d < 1 || d > 31 || mes < 1 || mes > 12) return null
  let y = +hoy.slice(0, 4)
  const f = `${y}-${dosDig(mes)}-${dosDig(d)}`
  if (f > hoy) y -= 1 // «el 28 de diciembre» dicho en enero es del año pasado
  return `${y}-${dosDig(mes)}-${dosDig(d)}`
}

const DIA = String.raw`(hoy|ayer|\d{1,2}\s*/\s*\d{1,2}|\d{1,2}(?: de \w+)?)`
const RE_RANGO = new RegExp(String.raw`\b(?:desde|entre|del)(?: el)?(?: dia)? ${DIA} (?:hasta|al|y|a)(?: el)?(?: dia)?(?: de)? ${DIA}\b`)
const RE_DESDE = new RegExp(String.raw`\bdesde(?: el)?(?: dia)? ${DIA}\b`)

/** «desde el 22 de noviembre hasta hoy», «entre el 10 y el 20», «del 1/11 al 15/11», «desde el 22». */
export function rangoLibre(texto: string, hoy: string): { desde: string; hasta: string } | null {
  const t = norm(texto)
  const mesHoy = +hoy.slice(5, 7)
  let m = t.match(RE_RANGO)
  if (m) {
    // «del 10 al 20 de noviembre»: el mes del segundo vale para el primero.
    const mes2 = m[2].match(/ de (\w+)$/)?.[1]
    const d2 = dia(m[2], hoy, mesHoy)
    const d1 = dia(m[1], hoy, mes2 ? (mesNum(mes2) ?? mesHoy) : (d2 ? +d2.slice(5, 7) : mesHoy))
    if (d1 && d2) return d1 <= d2 ? { desde: d1, hasta: d2 } : { desde: d2, hasta: d1 }
  }
  m = t.match(RE_DESDE)
  if (m) { const d1 = dia(m[1], hoy, mesHoy); if (d1 && d1 <= hoy) return { desde: d1, hasta: hoy } }
  return null
}

export function corregir(texto: string, elecciones: Eleccion[], nombres: string[], hoy: string): Eleccion[] {
  let out = elecciones.map((e) => ({ consulta: e.consulta, argumentos: { ...(e.argumentos ?? {}) } }))
  if (esLejos(texto) && !out.some((e) => e.consulta === 'control_visitas')) {
    const base = out.find((e) => CON_PERIODO.has(e.consulta))?.argumentos ?? {}
    out = [{ consulta: 'control_visitas', argumentos: { periodo: base.periodo ?? 'hoy', persona: base.persona ?? '' } }]
  }
  const quien = personaEnTexto(texto, nombres)
  const rango = rangoLibre(texto, hoy)
  for (const e of out) {
    if (quien && CON_PERSONA.has(e.consulta) && !String(e.argumentos.persona ?? '').trim()) e.argumentos.persona = quien
    if (rango && CON_PERIODO.has(e.consulta)) { e.argumentos._desde = rango.desde; e.argumentos._hasta = rango.hasta }
  }
  return out
}
