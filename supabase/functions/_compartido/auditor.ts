// _compartido/auditor.ts — auditor del asistente de CONSULTAS (09/11/2026, db/106, plan 44).
//
// Lo usan `wa-asistente` (comandos de Santiago y resumen pendiente) y `wa-auditor` (análisis nocturno y
// resumen de las 08:00). Solo toca el número de consultas: nada de ventas ni del CRM.
//
// 🔒 Lo "liviano" que se aplica solo (atajo, alias, frase de prueba) se valida acá con reglas fijas, no
// con la IA: el patrón de un atajo lo arma el código a partir de una frase, y no puede pisar ninguna
// frase de la prueba automática que espere otra consulta. Todo se aplica en tablas y se deshace igual.
import DEF from '../wa-asistente/lib/herramientas.json' with { type: 'json' }
import FRASES from '../wa-asistente/lib/frases_prueba.json' with { type: 'json' }
import { normalizar, olvidarAtajos } from '../wa-asistente/lib/aiService.ts'
import { olvidarAlias } from '../wa-asistente/lib/consultas.ts'
import { enviarTexto } from '../wa-asistente/lib/whatsapp.ts'

const TZ = 'America/Argentina/Salta'
export const CONSULTAS = new Set<string>([...(DEF.herramientas as any[]).map((h) => h[0] as string), 'precio_servicio', 'disculpa'])
// Consultas cuyos argumentos no salen del texto: un atajo puede atraparlas aunque la frase esté dentro de
// otra más larga. Las demás (con período, persona, cliente…) solo con el mensaje entero, así "cuánto
// facturamos" no le gana a "cuánto facturamos ayer".
const SIN_ARGUMENTOS_LIBRES = new Set(['dato_no_disponible', 'ayuda', 'equipo_en_calle', 'precio_servicio', 'disculpa'])

export const fechaSalta = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
export const inicioDia = (fecha: string) => new Date(`${fecha}T00:00:00-03:00`)
const ddmm = (fecha: string) => `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`

// ── Validación de lo liviano ─────────────────────────────────────────────────────────────────────
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
const palabras = (t: string) => normalizar(t).replace(/[^a-z0-9ñ]+/g, ' ').trim()

/** Arma el patrón de un atajo a partir de una frase. Devuelve null si la frase no sirve. */
export function patronAtajo(frase: string, consulta: string): string | null {
  const p = palabras(frase).split(' ').filter(Boolean)
  if (!p.length || p.join(' ').length < 4 || p.length > 8) return null
  const cuerpo = p.map(escapar).join('[^a-z0-9]+')
  return SIN_ARGUMENTOS_LIBRES.has(consulta) ? `(^|[^a-z0-9])${cuerpo}([^a-z0-9]|$)` : `^[^a-z0-9]*${cuerpo}[^a-z0-9]*$`
}

type FraseEsperada = { frase: string; consulta: string | null }
async function frasesReales(db: any, empresa: string): Promise<FraseEsperada[]> {
  const { data } = await db.from('wa_frases_reales').select('frase, consulta').eq('id_empresa', empresa).eq('activo', true)
  return data ?? []
}

/** Un atajo no puede pisar una frase de prueba (PREGUNTAS.md o frases reales) que espera otra consulta. */
export async function validarAtajo(db: any, empresa: string, patron: string, consulta: string): Promise<string | null> {
  if (!CONSULTAS.has(consulta)) return `la consulta ${consulta} no existe`
  if (patron.length > 300) return 'el patrón es demasiado largo'
  let re: RegExp
  try { re = new RegExp(patron) } catch { return 'el patrón no es válido' }
  const todas: FraseEsperada[] = [...(FRASES as FraseEsperada[]), ...(await frasesReales(db, empresa))]
  const pisa = todas.find((f) => (f.consulta ?? null) !== consulta && re.test(normalizar(f.frase)))
  return pisa ? `pisaría la frase de prueba "${pisa.frase}", que espera ${pisa.consulta ?? 'ninguna consulta'}` : null
}

export type TipoAlias = 'persona' | 'cliente' | 'producto' | 'zona'
/** El alias tiene que llevar a un resultado concreto: una sola persona o cliente, algún producto. */
export async function validarAlias(db: any, empresa: string, perfil: string, tipo: TipoAlias, dice: string, es: string): Promise<string | null> {
  const d = palabras(dice), e = palabras(es)
  if (d.length < 2 || e.length < 2 || d.length > 80 || e.length > 80) return 'el alias es muy corto o muy largo'
  if (d === e) return 'el alias es igual al nombre'
  if (tipo === 'persona') {
    const { data } = await db.rpc('wa_buscar_personas', { p_empresa: empresa, p_texto: es, p_perfil: perfil })
    const n = (data?.personas ?? []).length
    return n === 1 ? null : `"${es}" da ${n} personas, tiene que dar una`
  }
  if (tipo === 'cliente') {
    const { data } = await db.rpc('wa_buscar_clientes', { p_empresa: empresa, p_texto: es })
    const n = Number(data?.total) || 0
    return n === 1 ? null : `"${es}" da ${n} clientes, tiene que dar uno`
  }
  if (tipo === 'producto') {
    const { data } = await db.rpc('wa_buscar_productos', { p_empresa: empresa, p_texto: es })
    return Number(data?.total) > 0 ? null : `"${es}" no encuentra productos`
  }
  return null
}

// ── Propuestas ───────────────────────────────────────────────────────────────────────────────────
const etiqueta = (p: any) => (p.peso === 'liviano' ? '🟢 liviano' : '🔵 Claude Code')
const linea = (p: any) => `*#${p.id}* ${etiqueta(p)} · ${p.titulo}${p.veces > 1 ? ` (×${p.veces})` : ''}`

async function propuesta(db: any, empresa: string, id: number) {
  const { data } = await db.from('wa_auditor_propuestas').select('*').eq('id_empresa', empresa).eq('id', id).maybeSingle()
  return data
}

async function marcar(db: any, id: number, estado: string, perfil: string | null) {
  await db.from('wa_auditor_propuestas').update({
    estado, decidido_por: perfil, decidido_ts: new Date().toISOString(), actualizado_ts: new Date().toISOString(),
  }).eq('id', id)
}

async function guardarFrases(db: any, empresa: string, idPropuesta: number, frases: any[]) {
  const filas = (frases ?? []).filter((f) => f?.frase).slice(0, 5).map((f) => ({
    id_empresa: empresa, frase: String(f.frase).slice(0, 300), consulta: f.consulta ?? null,
    argumentos: f.argumentos ?? {}, id_propuesta: idPropuesta,
  }))
  if (filas.length) {
    const { error } = await db.from('wa_frases_reales').insert(filas)
    if (error) throw new Error(`wa_frases_reales: ${error.message}`)
  }
}

/** Aplica una propuesta aprobada. Devuelve el texto para Santiago. */
async function aplicar(db: any, empresa: string, perfil: string, p: any): Promise<string> {
  const d = p.detalle ?? {}
  if (p.tipo === 'atajo') {
    const error = await validarAtajo(db, empresa, d.patron, d.consulta)
    if (error) return `No apliqué la #${p.id}: ${error}. Queda abierta; si querés, respondé «descartar ${p.id}».`
    const r = await db.from('wa_atajos_aprendidos').insert({
      id_empresa: empresa, patron: d.patron, consulta: d.consulta, argumentos: d.argumentos ?? {}, id_propuesta: p.id,
    })
    if (r.error) throw new Error(`wa_atajos_aprendidos: ${r.error.message}`)
    olvidarAtajos()
    await guardarFrases(db, empresa, p.id, d.frases)
  } else if (p.tipo === 'alias') {
    const error = await validarAlias(db, empresa, perfil, d.alias_tipo, d.dice, d.es)
    if (error) return `No apliqué la #${p.id}: ${error}. Queda abierta; si querés, respondé «descartar ${p.id}».`
    const r = await db.from('wa_alias').insert({ id_empresa: empresa, tipo: d.alias_tipo, dice: d.dice, es: d.es, id_propuesta: p.id })
    if (r.error) return `No apliqué la #${p.id}: ya hay un alias activo para "${d.dice}".`
    olvidarAlias()
  } else if (p.tipo === 'frase_prueba') {
    await guardarFrases(db, empresa, p.id, d.frases)
  } else {
    // Lo complejo no lo toca la IA local: queda anotado para Claude Code. Las frases reales se suman ya a
    // la prueba automática, así Claude Code tiene con qué medir el arreglo.
    await guardarFrases(db, empresa, p.id, d.frases)
    await marcar(db, p.id, 'para_claude', perfil)
    return `Listo, la #${p.id} queda para Claude Code. Cuando abras una sesión, pedile: «Ejecutá auditor\\PROMPT.md».`
  }
  await marcar(db, p.id, 'aplicada', perfil)
  return `Aplicada la #${p.id}: ${p.titulo}. Si algo sale mal, respondé «deshacer ${p.id}».`
}

async function deshacer(db: any, empresa: string, perfil: string, p: any): Promise<string> {
  if (!['aplicada', 'para_claude'].includes(p.estado)) return `La #${p.id} no está aplicada (estado: ${p.estado}).`
  const ahora = new Date().toISOString()
  for (const t of ['wa_atajos_aprendidos', 'wa_alias', 'wa_frases_reales']) {
    await db.from(t).update({ activo: false, desactivado_ts: ahora }).eq('id_empresa', empresa).eq('id_propuesta', p.id).eq('activo', true)
  }
  olvidarAlias(); olvidarAtajos()
  await marcar(db, p.id, p.estado === 'para_claude' ? 'descartada' : 'deshecha', perfil)
  return `Deshecha la #${p.id}. El asistente vuelve a responder como antes (puede tardar hasta 5 minutos).`
}

async function ver(db: any, p: any): Promise<string> {
  const d = p.detalle ?? {}
  const { data: msgs } = await db.from('wa_mensajes').select('texto, consulta').in('id', (p.ejemplos ?? []).slice(0, 3))
  const ejemplos = (msgs ?? []).filter((m: any) => m.texto)
    .map((m: any) => `• «${String(m.texto).slice(0, 120)}» → ${m.consulta ?? 'ninguna'}`).join('\n')
  const partes = [
    linea(p),
    d.explicacion ? `Por qué: ${d.explicacion}` : '',
    ejemplos ? `Mensajes:\n${ejemplos}` : '',
    `Estado: ${p.estado}.`,
    ['nueva', 'enviada'].includes(p.estado)
      ? `Respondé «aplicar ${p.id}» o «descartar ${p.id}».${p.peso === 'complejo' ? ' Aplicarla no cambia nada sola: la deja anotada para una sesión de Claude Code.' : ''}`
      : '',
  ]
  return partes.filter(Boolean).join('\n')
}

async function lista(db: any, empresa: string): Promise<string> {
  const { data } = await db.from('wa_auditor_propuestas').select('id, titulo, peso, veces')
    .eq('id_empresa', empresa).in('estado', ['nueva', 'enviada'])
    .order('veces', { ascending: false }).order('id').limit(8)
  if (!data?.length) return 'No hay propuestas abiertas del auditor.'
  return `Propuestas abiertas del auditor:\n${data.map(linea).join('\n')}\n\n${instrucciones(data[0].id)}`
}

/** Con un número real: el 10/11 «Respondé "ver N"» se leyó al pie de la letra («ver n 15», «Aplicar N#15»). */
export const instrucciones = (id: number) =>
  `Respondé con el número, por ejemplo «ver ${id}», «aplicar ${id}» o «descartar ${id}». «auditoría» muestra todas.`

// ── Comandos de Santiago ─────────────────────────────────────────────────────────────────────────
export type Comando = { accion: 'lista' | 'ver' | 'aplicar' | 'descartar' | 'deshacer' | 'formato' | 'uso'; id?: number; ids?: number[] }

/** Tolera cómo se escribe de verdad: «ver n 15», «Ver N #15», «Aplicar N#15», «aplicá la 15», «aplicar 15 y 16».
 * «ver …» sin números de propuesta sigue el camino normal («ver las ventas de hoy», «ver pedido 687»). Un
 * «aplicar/descartar/deshacer» que no se entiende contesta el formato: no tiene sentido mandárselo al modelo. */
export function comandoAuditor(texto: string): Comando | null {
  const t = normalizar(texto).replace(/[.!¡¿?:]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^(auditoria|auditor|propuestas|ver propuestas|ver auditoria)$/.test(t)) return { accion: 'lista' }
  // Plan 49: «Cómo vienen las consultas ?» (18/11) fue a la ayuda y tardó 51 s.
  if (/^(como (vienen|van|viene|va|anda|andan|esta|estan) (las consultas|el asistente|el bot|los mensajes)( del (asistente|bot))?|uso del (asistente|bot)|estadisticas( del (asistente|bot))?|resumen del (asistente|bot))$/.test(t)) return { accion: 'uso' }
  const m = t.match(/^(ver|mostrame|mostra|aplicar|aplica|aplicala|aplicalo|descartar|descarta|descartala|descartalo|deshacer|deshace|deshacela|deshacelo|deshaz)\b(.*)$/)
  if (!m) return null
  const accion: Comando['accion'] = m[1].startsWith('apli') ? 'aplicar' : m[1].startsWith('descart') ? 'descartar'
    : m[1].startsWith('desha') ? 'deshacer' : 'ver'
  const resto = m[2].replace(/#/g, ' ').replace(/[,;\-]/g, ' ')
    .replace(/\b(la|las|el|los|propuestas?|prop|numeros?|nro|num|n|no|y|e)\b/g, ' ').replace(/\s+/g, ' ').trim()
  if (/^\d{1,7}( \d{1,7}){0,7}$/.test(resto)) {
    const ids = [...new Set(resto.split(' ').map(Number))]
    return { accion, id: ids[0], ids }
  }
  if (accion === 'ver') return resto ? null : { accion: 'lista' }
  return { accion: 'formato' }
}

async function uno(db: any, empresa: string, perfil: string, accion: Comando['accion'], id: number): Promise<string> {
  const p = await propuesta(db, empresa, id)
  if (!p) return accion === 'ver'
    ? `No encontré la propuesta #${id}. Si buscás un pedido, escribí «pedido ${id}».`
    : `No encontré la propuesta #${id}.`
  if (accion === 'ver') return ver(db, p)
  if (accion === 'deshacer') return deshacer(db, empresa, perfil, p)
  if (!['nueva', 'enviada'].includes(p.estado)) return `La #${p.id} ya está ${p.estado}.`
  if (accion === 'descartar') {
    await marcar(db, p.id, 'descartada', perfil)
    return `Descartada la #${p.id}.`
  }
  return aplicar(db, empresa, perfil, p)
}

export async function atenderComando(db: any, empresa: string, perfil: string, c: Comando): Promise<string> {
  if (c.accion === 'lista') return lista(db, empresa)
  if (c.accion === 'uso') return usoAsistente(db, empresa)
  if (c.accion === 'formato') {
    const { data } = await db.from('wa_auditor_propuestas').select('id').eq('id_empresa', empresa)
      .in('estado', ['nueva', 'enviada']).order('id').limit(1)
    return `No entendí el número de la propuesta. ${instrucciones(data?.[0]?.id ?? 15)}`
  }
  const ids = c.ids?.length ? c.ids : [c.id!]
  const partes: string[] = []
  for (const id of ids) partes.push(await uno(db, empresa, perfil, c.accion, id))
  return partes.join('\n\n')
}

/** Plan 49: cómo viene el asistente en los últimos 7 días, sin modelo. */
export async function usoAsistente(db: any, empresa: string, ahora = new Date()): Promise<string> {
  const desde = new Date(ahora.getTime() - 7 * 86_400_000).toISOString()
  const [{ data: msgs }, { data: usuarios }, { data: hall }, { count: abiertas }] = await Promise.all([
    db.from('wa_mensajes').select('wa_id, consulta, resultado, origen, ms_total').eq('id_empresa', empresa).eq('autorizado', true)
      .in('estado', ['respondido', 'error']).gte('recibido_ts', desde),
    db.from('wa_asistente_usuarios').select('wa_id, perfiles(nombre)').eq('id_empresa', empresa),
    db.from('wa_auditor_hallazgos').select('motivos, causa, wa_mensajes!inner(recibido_ts)').eq('id_empresa', empresa)
      .gte('wa_mensajes.recibido_ts', desde),
    db.from('wa_auditor_propuestas').select('id', { count: 'exact', head: true }).eq('id_empresa', empresa).in('estado', ['nueva', 'enviada']),
  ])
  const consultas = (msgs ?? []).filter((m: any) => !['comando', 'auditor'].includes(m.origen ?? ''))
  if (!consultas.length) return 'En los últimos 7 días nadie le hizo consultas al asistente.'
  const cuenta = (claves: string[]) => {
    const m = new Map<string, number>()
    for (const k of claves) m.set(k, (m.get(k) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }
  const nombre = new Map((usuarios ?? []).map((u: any) => [u.wa_id, String(u.perfiles?.nombre ?? 'otro').split(/s+/)[0]]))
  const porPersona = cuenta(consultas.map((m: any) => nombre.get(m.wa_id) ?? 'otro'))
  const temas = cuenta(consultas.flatMap((m: any) => String(m.consulta ?? 'ninguna').split(',').filter(Boolean)))
  const conDato = consultas.filter((m: any) => m.resultado === 'ok').length
  const otros = cuenta(consultas.filter((m: any) => m.resultado && m.resultado !== 'ok').map((m: any) => NOMBRE_RESULTADO[m.resultado] ?? m.resultado))
  const ms = consultas.map((m: any) => Number(m.ms_total)).filter((x: number) => x > 0).sort((a: number, b: number) => a - b)
  const mediana = ms.length ? Math.round(ms[Math.floor(ms.length / 2)] / 1000) : null
  const lentas = ms.filter((x: number) => x > 30_000).length
  const senales = cuenta((hall ?? []).flatMap((h: any) => (h.motivos ?? []).filter((x: string) => x !== 'muestra')).map((x: string) => NOMBRE_MOTIVO[x] ?? x))
  return [
    '📊 *Asistente · últimos 7 días*',
    `${consultas.length} consultas (${porPersona.map(([n, c]) => `${n} ${c}`).join(', ')}).`,
    `Con dato: ${conDato}${otros.length ? ` · ${otros.map(([n, c]) => `${c} ${n}`).join(', ')}` : ''}.`,
    `Lo más preguntado: ${temas.slice(0, 4).map(([n, c]) => `${NOMBRE_CONSULTA[n] ?? n} (${c})`).join(', ')}.`,
    mediana != null ? `Tiempo de respuesta: ${mediana} s la mitad de las veces${lentas ? `; ${lentas} tardaron más de 30 s` : ''}.` : '',
    senales.length ? `Señales del auditor: ${senales.map(([n, c]) => `${c} ${n}`).join(', ')}.` : 'El auditor no marcó problemas.',
    abiertas ? `Propuestas abiertas: ${abiertas}. Escribí «auditoría» para verlas.` : 'Sin propuestas abiertas.',
  ].filter(Boolean).join('\n')
}

const NOMBRE_RESULTADO: Record<string, string> = {
  no_encontrado: 'sin encontrar el nombre', dato_no_disponible: 'datos que no tenemos', repregunta: 'repreguntas',
  fuera_de_tema: 'fuera de tema', error: 'con error',
}
const NOMBRE_CONSULTA: Record<string, string> = {
  ventas_resumen: 'ventas', ventas_por_vendedor: 'ventas por vendedor', ventas_por_categoria: 'ventas por rubro',
  productos_mas_vendidos: 'productos', primer_pedido_dia: 'primer pedido', buscar_pedido: 'pedidos', pedidos_de_cliente: 'clientes',
  precio_producto: 'precios', equipo_en_calle: 'equipo en la calle', clientes_sin_comprar: 'clientes sin comprar',
  rendimiento_vendedor: 'rendimiento', control_visitas: 'control de visitas', avisos_equipo: 'avisos', analisis_zonas: 'zonas',
  dato_no_disponible: 'datos que no tenemos', ayuda: 'ayuda',
}

const recortarTexto = (t: unknown, n: number) => { const x = String(t ?? '').replace(/s+/g, ' ').trim(); return x.length > n ? x.slice(0, n) + '…' : x }
const NOMBRE_CAUSA: Record<string, string> = {
  herramienta_equivocada: 'la IA cree que eligió mal', falta_herramienta: 'ninguna consulta lo cubre', falta_dato: 'dato que no tenemos',
  transcripcion: 'audio mal transcripto', nombre_no_encontrado: 'nombre no encontrado', otro: 'dudosa',
}

// ── Resumen diario ───────────────────────────────────────────────────────────────────────────────
const NOMBRE_MOTIVO: Record<string, string> = {
  error: 'con error', fuera_de_tema: 'fuera de tema', pide_cambio: 'pidieron cambiar algo', repregunta: 'repreguntas',
  no_encontrado: 'sin encontrar el nombre', dato_no_disponible: 'datos que no tenemos', audio: 'audios no entendidos',
  lento: 'lentos (+30 s)', queja: 'quejas', reformula: 'preguntadas de nuevo',
}

/** Arma el resumen del día `fecha` (Salta) y marca como enviadas las propuestas que incluye. */
export async function armarResumen(db: any, empresa: string, fecha: string): Promise<string | null> {
  const desde = inicioDia(fecha), hasta = new Date(desde.getTime() + 86_400_000)
  const [{ data: msgs }, { data: usuarios }, { data: hall }, { data: props }] = await Promise.all([
    db.from('wa_mensajes').select('wa_id, origen').eq('id_empresa', empresa).eq('autorizado', true)
      .in('estado', ['respondido', 'error']).gte('recibido_ts', desde.toISOString()).lt('recibido_ts', hasta.toISOString()),
    db.from('wa_asistente_usuarios').select('wa_id, perfiles(nombre)').eq('id_empresa', empresa),
    db.from('wa_auditor_hallazgos').select('motivos, causa, wa_mensajes!inner(id, recibido_ts, texto, consulta)').eq('id_empresa', empresa)
      .gte('wa_mensajes.recibido_ts', desde.toISOString()).lt('wa_mensajes.recibido_ts', hasta.toISOString()),
    // Plan 49: una propuesta compleja de UN solo mensaje no va al resumen (15/11: 4 de 4 eran falsas). Se ve
    // con «auditoría» y entra al resumen cuando se repite.
    db.from('wa_auditor_propuestas').select('id, titulo, peso, veces').eq('id_empresa', empresa).eq('estado', 'nueva')
      .or('peso.eq.liviano,veces.gte.2').order('veces', { ascending: false }).order('id').limit(5),
  ])
  const consultas = (msgs ?? []).filter((m: any) => !['comando', 'auditor'].includes(m.origen ?? ''))
  if (!consultas.length && !props?.length) return null

  const nombre = new Map((usuarios ?? []).map((u: any) => [u.wa_id, String(u.perfiles?.nombre ?? 'otro').split(/\s+/)[0]]))
  const porPersona = new Map<string, number>()
  for (const m of consultas) porPersona.set(nombre.get(m.wa_id) ?? 'otro', (porPersona.get(nombre.get(m.wa_id) ?? 'otro') ?? 0) + 1)
  const motivos = new Map<string, number>()
  for (const h of hall ?? []) for (const mo of h.motivos ?? []) if (mo !== 'muestra') motivos.set(mo, (motivos.get(mo) ?? 0) + 1)
  // Plan 49: «1 de la muestra al azar mal respondidas» no decía cuál. Se listan los mensajes: la IA local
  // se equivoca seguido y el que decide es Santiago.
  const revisar = (hall ?? []).filter((h: any) => h.causa && !['bien', 'operativo', 'sin_senal'].includes(h.causa))
    .sort((a: any, b: any) => a.wa_mensajes.id - b.wa_mensajes.id)

  const lineas = [`🧾 *Auditor del asistente* · ${ddmm(fecha)}`]
  lineas.push(consultas.length
    ? `${consultas.length} consultas (${[...porPersona].map(([n, c]) => `${n} ${c}`).join(', ')}).`
    : 'Sin consultas ese día.')
  const fallas = [...motivos].sort((a, b) => b[1] - a[1]).map(([m, c]) => `${c} ${NOMBRE_MOTIVO[m] ?? m}`)
  if (consultas.length) lineas.push(fallas.length ? `Señales: ${fallas.join(', ')}.` : 'Sin señales de falla.')
  if (revisar.length) {
    lineas.push('', `Para revisar (${revisar.length}):`, ...revisar.slice(0, 3).map((h: any) =>
      `• «${recortarTexto(h.wa_mensajes.texto, 70)}» → ${h.wa_mensajes.consulta ?? 'ninguna'} (${NOMBRE_CAUSA[h.causa] ?? h.causa})`))
  }
  if (props?.length) {
    lineas.push('', 'Propuestas:', ...props.map(linea), '', instrucciones(props[0].id))
    await db.from('wa_auditor_propuestas').update({ estado: 'enviada', actualizado_ts: new Date().toISOString() })
      .in('id', props.map((p: any) => p.id)).eq('estado', 'nueva')
  }
  return lineas.join('\n')
}

/** Superadmins activos de la empresa: los únicos que reciben el resumen y pueden usar los comandos. */
export async function destinatarios(db: any, empresa: string): Promise<{ wa_id: string; id_perfil: string }[]> {
  const { data } = await db.from('wa_asistente_usuarios').select('wa_id, id_perfil, perfiles!inner(rol)')
    .eq('id_empresa', empresa).eq('activo', true).eq('perfiles.rol', 'superadmin')
  return data ?? []
}

/** ¿La ventana de 24 h de Meta está abierta? (con 15 min de margen) */
async function ventanaAbierta(db: any, waId: string) {
  const desde = new Date(Date.now() - (24 * 60 - 15) * 60_000).toISOString()
  const { count } = await db.from('wa_mensajes').select('id', { count: 'exact', head: true })
    .eq('wa_id', waId).eq('autorizado', true).neq('tipo', 'auditor').gte('recibido_ts', desde)
  return !!count
}

/** Manda el texto y lo registra en `wa_mensajes`, así cuenta para el tope mensual del asistente. */
async function mandarYRegistrar(db: any, empresa: string, waId: string, texto: string, clave: string) {
  await enviarTexto(waId, texto)
  await db.from('wa_mensajes').insert({
    wamid: `auditor:${clave}:${waId}:${Date.now()}`, wa_id: waId, id_empresa: empresa, autorizado: true, tipo: 'auditor',
    respuesta: texto, estado: 'respondido', origen: 'auditor', resultado: 'auditor', enviados: 1,
    respondido_ts: new Date().toISOString(),
  })
}

/** Resumen de las 08:00. Uno por día: si ya existe, no hace nada. */
export async function resumenDiario(db: any, empresa: string, fecha: string, cupoLibre: () => Promise<boolean>) {
  const { data: ya } = await db.from('wa_auditor_resumenes').select('estado').eq('id_empresa', empresa).eq('fecha', fecha).maybeSingle()
  if (ya) return `ya estaba (${ya.estado})`
  const ayer = fechaSalta(new Date(inicioDia(fecha).getTime() - 12 * 3_600_000))
  const texto = await armarResumen(db, empresa, ayer)
  const fila = { id_empresa: empresa, fecha, texto: texto ?? '', estado: texto ? 'pendiente' : 'sin_novedad' }
  const { error } = await db.from('wa_auditor_resumenes').insert(fila)
  if (error) return `ya estaba (${error.message})` // otra corrida lo creó al mismo tiempo
  if (!texto) return 'sin novedad'
  let enviados = 0
  for (const d of await destinatarios(db, empresa)) {
    if (!(await ventanaAbierta(db, d.wa_id)) || !(await cupoLibre())) continue
    await mandarYRegistrar(db, empresa, d.wa_id, texto, fecha)
    enviados++
  }
  if (enviados) {
    await db.from('wa_auditor_resumenes').update({ estado: 'enviado', enviado_ts: new Date().toISOString() })
      .eq('id_empresa', empresa).eq('fecha', fecha)
  }
  return enviados ? 'enviado' : 'pendiente (ventana cerrada o sin cupo)'
}

/** Si hay un resumen pendiente, lo devuelve y lo marca como enviado (junto con los más viejos). Lo llama
 * `wa-asistente` después de contestarle a un superadmin: su mensaje abrió la ventana de 24 h. */
export async function tomarResumenPendiente(db: any, empresa: string): Promise<string | null> {
  const { data } = await db.from('wa_auditor_resumenes').select('fecha, texto').eq('id_empresa', empresa)
    .eq('estado', 'pendiente').order('fecha', { ascending: false }).limit(1)
  if (!data?.length) return null
  const { data: marcadas } = await db.from('wa_auditor_resumenes').update({ estado: 'enviado', enviado_ts: new Date().toISOString() })
    .eq('id_empresa', empresa).eq('estado', 'pendiente').select('fecha')
  // Otra respuesta al mismo tiempo ya lo tomó: no se manda dos veces.
  return marcadas?.some((m: any) => m.fecha === data[0].fecha) ? data[0].texto : null
}
