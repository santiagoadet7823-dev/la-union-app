// lib/consultas.ts — las únicas consultas que puede hacer el asistente. Sin SQL generado por la IA.
//
// 🔑 `empresa` sale de `wa_asistente_usuarios`, nunca del mensaje ni del modelo. Los argumentos del
// modelo se validan acá como cualquier dato de afuera.
import * as R from './respuestas.ts'

const TZ = 'America/Argentina/Salta'
export const PERIODOS = ['hoy', 'ayer', 'semana', 'semana_pasada', 'mes', 'mes_pasado'] as const
type Periodo = (typeof PERIODOS)[number]

const NOMBRE_PERIODO: Record<Periodo, string> = {
  hoy: 'de hoy', ayer: 'de ayer', semana: 'de esta semana', semana_pasada: 'de la semana pasada',
  mes: 'de este mes', mes_pasado: 'del mes pasado',
}

export const hoyEn = (ahora = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)

const sumar = (f: string, n: number) => {
  const d = new Date(`${f}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Rango en fechas de Salta. La semana empieza el lunes. */
export function rangoDe(periodo: Periodo, ahora = new Date()) {
  const hoy = hoyEn(ahora)
  const diaSemana = (new Date(`${hoy}T12:00:00Z`).getUTCDay() + 6) % 7 // lunes = 0
  const lunes = sumar(hoy, -diaSemana)
  const primero = `${hoy.slice(0, 7)}-01`
  switch (periodo) {
    case 'hoy': return { desde: hoy, hasta: hoy }
    case 'ayer': return { desde: sumar(hoy, -1), hasta: sumar(hoy, -1) }
    case 'semana': return { desde: lunes, hasta: hoy }
    case 'semana_pasada': return { desde: sumar(lunes, -7), hasta: sumar(lunes, -1) }
    case 'mes': return { desde: primero, hasta: hoy }
    case 'mes_pasado': {
      const ultimo = sumar(primero, -1)
      return { desde: `${ultimo.slice(0, 7)}-01`, hasta: ultimo }
    }
  }
}

const periodoDe = (a: Record<string, unknown>): Periodo =>
  PERIODOS.includes(a.periodo as Periodo) ? (a.periodo as Periodo) : 'hoy'
const textoDe = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)

async function rpc(db: any, nombre: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(nombre, args)
  if (error) throw new Error(`${nombre}: ${error.message}`)
  return data
}

// `perfil` define el alcance (db/102): admin ve la empresa, el encargado solo a su gente. Buscar
// clientes y precios no lo usa: los clientes son de la distribuidora (db/40).
export async function ejecutar(db: any, empresa: string, perfil: string, consulta: string, a: Record<string, unknown>): Promise<R.Respuesta> {
  const periodo = periodoDe(a)
  const rango = rangoDe(periodo)
  const conRango = { p_empresa: empresa, p_desde: rango.desde, p_hasta: rango.hasta, p_perfil: perfil }
  const nombre = NOMBRE_PERIODO[periodo]

  switch (consulta) {
    case 'ventas_resumen':
      return R.ventasResumen(await rpc(db, 'wa_ventas', conRango), nombre)
    case 'ventas_por_vendedor':
      return R.ventasPorVendedor(await rpc(db, 'wa_ventas', conRango), nombre)
    case 'ventas_por_categoria':
      return R.ventasPorCategoria(await rpc(db, 'wa_ventas_categoria', conRango), nombre)
    case 'productos_mas_vendidos':
      return R.productosVendidos(await rpc(db, 'wa_productos_ventas', conRango), nombre)
    case 'buscar_pedido': {
      const numero = textoDe(a.numero)
      if (!/\d/.test(numero)) return { texto: '¿Qué número de pedido querés ver?', voz: '¿Qué número de pedido querés ver?' }
      return R.pedido(await rpc(db, 'wa_pedido', { p_empresa: empresa, p_numero: numero, p_perfil: perfil }), numero)
    }
    case 'pedidos_de_cliente': {
      const texto = textoDe(a.cliente)
      const b = await rpc(db, 'wa_buscar_clientes', { p_empresa: empresa, p_texto: texto })
      const clientes = b?.clientes ?? []
      if (!clientes.length) return { texto: `No encontré clientes con "${texto}".`, voz: 'No encontré clientes con ese nombre.' }
      // Un código exacto es uno solo aunque otros nombres también contengan esos dígitos.
      const exacto = clientes[0].por_codigo ? clientes[0] : null
      if (!exacto && clientes.length > 1) return R.clienteAmbiguo(b, texto)
      const elegido = exacto ?? clientes[0]
      return R.pedidosCliente(elegido, await rpc(db, 'wa_pedidos_cliente', { p_empresa: empresa, p_cliente: elegido.id, p_perfil: perfil }))
    }
    case 'precio_producto': {
      const texto = textoDe(a.producto)
      return R.productos(await rpc(db, 'wa_buscar_productos', { p_empresa: empresa, p_texto: texto }), texto)
    }
    case 'equipo_en_calle':
      return R.equipo(await rpc(db, 'wa_equipo', { p_empresa: empresa, p_perfil: perfil }))
    case 'clientes_sin_comprar': {
      const dias = Math.min(Math.max(Math.round(Number(a.dias)) || 30, 1), 365)
      return R.clientesSinComprar(await rpc(db, 'wa_clientes_sin_comprar', { p_empresa: empresa, p_dias: dias, p_perfil: perfil }))
    }
    case 'consulta_stock':
      return { texto: R.TEXTOS.stock, voz: R.TEXTOS.stock }
    case 'ayuda':
      return { texto: R.TEXTOS.ayuda, voz: 'Hola. Preguntame por ventas, pedidos, clientes, precios o el equipo, por escrito o por audio.' }
    default:
      return { texto: R.TEXTOS.fueraDeTema, voz: R.TEXTOS.fueraDeTema }
  }
}
