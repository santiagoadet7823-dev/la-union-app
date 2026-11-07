// lib/respuestas.ts — arma el texto y la voz con los datos de la base. Módulo puro, sin red.
//
// 🔒 Todo número que llega al usuario sale de acá, tal como vino de la base. La voz es un resumen corto:
// el detalle queda en el texto para poder releerlo.
import { escaleraDe, precioPara } from './precios.js'

export type Respuesta = { texto: string; voz: string }
const ambos = (t: string): Respuesta => ({ texto: t, voz: t })

const TZ = 'America/Argentina/Salta'

// ── Formato ──────────────────────────────────────────────────────────────────────────────────────
// A mano y no con toLocaleString: el resultado no depende de los datos regionales del runtime.
export function plata(n: unknown): string {
  const v = Number(n) || 0
  const [entero, dec] = Math.abs(v).toFixed(2).split('.')
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${v < 0 ? '-' : ''}$${miles}${dec === '00' ? '' : ',' + dec}`
}

const UNIDADES = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const DECENAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const CENTENAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

function hasta999(n: number): string {
  if (n === 100) return 'cien'
  const partes: string[] = []
  if (n >= 100) partes.push(CENTENAS[Math.floor(n / 100)])
  const r = n % 100
  if (r > 0 && r < 30) partes.push(UNIDADES[r])
  else if (r >= 30) partes.push(DECENAS[Math.floor(r / 10)] + (r % 10 ? ` y ${UNIDADES[r % 10]}` : ''))
  return partes.join(' ')
}

export function enPalabras(n: number): string {
  n = Math.round(Math.abs(n))
  if (n === 0) return 'cero'
  const partes: string[] = []
  const millones = Math.floor(n / 1_000_000)
  const miles = Math.floor((n % 1_000_000) / 1000)
  const resto = n % 1000
  if (millones) partes.push(millones === 1 ? 'un millón' : `${enPalabras(millones)} millones`)
  if (miles) partes.push(miles === 1 ? 'mil' : `${hasta999(miles)} mil`)
  if (resto) partes.push(hasta999(resto))
  return partes.join(' ')
}

// Para escuchar alcanza con la magnitud: el número exacto está en el texto.
export function plataHablada(n: unknown): string {
  const v = Number(n) || 0
  const redondo = Math.abs(v) >= 100_000 ? Math.round(v / 1000) * 1000 : Math.round(v)
  return `${enPalabras(redondo)} ${Math.abs(redondo) === 1 ? 'peso' : 'pesos'}`.replace(/ millón pesos$/, ' millón de pesos').replace(/ millones pesos$/, ' millones de pesos')
}

export function fecha(iso: unknown): string {
  if (!iso) return '-'
  const s = String(iso)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}`
  return new Intl.DateTimeFormat('es-AR', { timeZone: TZ, day: '2-digit', month: '2-digit' }).format(new Date(s))
}
const pedidosTxt = (n: number) => `${n} ${n === 1 ? 'pedido' : 'pedidos'}`
const lineas = (a: unknown) => (Array.isArray(a) ? a : []) as any[]

// ── Textos fijos ─────────────────────────────────────────────────────────────────────────────────
export const TEXTOS = {
  fueraDeTema: 'Solo puedo consultar datos de La Unión: ventas, pedidos, clientes, precios y equipo. No puedo cambiar nada.',
  ayuda: 'Hola. Podés preguntarme por escrito o por audio, por ejemplo:\n• ¿Cuánto vendimos hoy?\n• ¿Quién vendió más esta semana?\n• ¿En qué anda el pedido 687?\n• ¿Qué le vendimos a Supermercado Olé?\n• ¿A cuánto está el aceite Prado?\n• ¿Quién está en la calle?\n• ¿Qué clientes hace un mes que no compran?',
  stock: 'No tengo datos de stock: DisT-At no lleva existencias. Sí puedo decirte precios y ventas.',
  soloTextoOAudio: 'Por ahora solo entiendo mensajes de texto y audios.',
  audioLargo: 'El audio es muy largo. Mandame uno de menos de 2 minutos.',
  audioVacio: 'No pude entender el audio. ¿Me lo mandás de nuevo o por escrito?',
  iaCaida: 'No puedo procesar consultas en este momento. Probá de nuevo en unos minutos.',
  errorConsulta: 'No pude leer ese dato en este momento. Probá de nuevo en unos minutos.',
}

// ── Consultas ────────────────────────────────────────────────────────────────────────────────────
export function ventasResumen(d: any, periodo: string): Respuesta {
  const anulados = Number(d.anulados) || 0
  if (!Number(d.pedidos)) return ambos(`Sin pedidos tomados ${periodo}.`)
  return {
    texto: `Ventas ${periodo}: *${plata(d.monto)}*\n${pedidosTxt(Number(d.pedidos))} de ${d.clientes} ${Number(d.clientes) === 1 ? 'cliente' : 'clientes'}${anulados ? `\n${anulados} anulado${anulados === 1 ? '' : 's'} (no suman)` : ''}\n_Son pedidos tomados, no facturación._`,
    voz: `Ventas ${periodo}: ${plataHablada(d.monto)}, en ${enPalabras(Number(d.pedidos))} ${Number(d.pedidos) === 1 ? 'pedido' : 'pedidos'}.`,
  }
}

export function ventasPorVendedor(d: any, periodo: string): Respuesta {
  const filas = lineas(d.por_vendedor)
  if (!filas.length) return ambos(`Sin pedidos tomados ${periodo}.`)
  const detalle = filas.map((f, i) => `${i + 1}. ${f.nombre}: ${plata(f.monto)} (${pedidosTxt(Number(f.pedidos))})`).join('\n')
  const top = filas[0]
  return {
    texto: `Ventas por vendedor ${periodo}:\n${detalle}\n\nTotal: *${plata(d.monto)}*`,
    voz: `Ventas ${periodo}: primero ${top.nombre}, con ${plataHablada(top.monto)}. El detalle está en el mensaje.`,
  }
}

export function ventasPorCategoria(filas: any[], periodo: string): Respuesta {
  if (!filas.length) return ambos(`Sin ventas ${periodo}.`)
  const detalle = filas.slice(0, 10).map((f, i) => `${i + 1}. ${f.categoria}: ${plata(f.monto)}`).join('\n')
  return {
    texto: `Ventas por categoría ${periodo}:\n${detalle}`,
    voz: `Ventas ${periodo}: primero ${filas[0].categoria}, con ${plataHablada(filas[0].monto)}.`,
  }
}

export function productosVendidos(d: any, periodo: string): Respuesta {
  const top = lineas(d.mas_vendidos).slice(0, 5)
  const caida = lineas(d.en_caida).slice(0, 3)
  if (!top.length && !caida.length) return ambos(`Sin ventas de productos ${periodo}.`)
  const a = top.map((p, i) => `${i + 1}. ${p.descripcion}: ${plata(p.monto)} (${Number(p.cant)} u.)`).join('\n')
  const b = caida.map((p) => `• ${p.descripcion}: ${plata(p.monto)} (antes ${plata(p.monto_prev)})`).join('\n')
  return {
    texto: `Más vendidos ${periodo}:\n${a || '-'}${b ? `\n\nEn caída:\n${b}` : ''}`,
    voz: top.length ? `Más vendido ${periodo}: ${top[0].descripcion}. El detalle está en el mensaje.` : `Sin ventas ${periodo}, pero hay productos en caída. El detalle está en el mensaje.`,
  }
}

export function pedido(d: any, numero: string): Respuesta {
  if (!d) return ambos(`No encontré el pedido ${numero}.`)
  const entrega = d.ts_entregado ? `Entregado el ${fecha(d.ts_entregado)}` : d.fecha_entrega ? `Entrega: ${fecha(d.fecha_entrega)}` : 'Sin fecha de entrega'
  return {
    texto: `Pedido *${d.numero}*: ${d.estado}\nCliente: ${d.cliente || '-'}${d.codigo_cliente ? ` (${d.codigo_cliente})` : ''}\nMonto: ${plata(d.monto)} · ${d.renglones} renglones\nTomado el ${fecha(d.created_at)} por ${d.vendedor || '-'}\n${entrega}${d.repartidor ? `\nRepartidor: ${d.repartidor}` : ''}`,
    voz: `El pedido de ${d.cliente || 'ese cliente'} está ${String(d.estado).toLowerCase()}, por ${plataHablada(d.monto)}.`,
  }
}

export function clienteAmbiguo(b: any, busqueda: string): Respuesta {
  const total = Number(b.total) || 0
  const lista = lineas(b.clientes).map((c) => `• ${c.nombre_comercio} (código ${c.codigo})`).join('\n')
  const mas = total > 6 ? `\n…y ${total - 6} más. Decime un nombre más exacto.` : ''
  return {
    texto: `Encontré ${total} clientes con "${busqueda}". ¿Cuál es?\n${lista}${mas}`,
    voz: `Encontré ${enPalabras(total)} clientes con ese nombre. Decime cuál, los tenés en el mensaje.`,
  }
}

export function pedidosCliente(cliente: any, filas: any[]): Respuesta {
  if (!filas.length) return ambos(`${cliente.nombre_comercio} no tiene pedidos cargados.`)
  const detalle = filas.map((p) => `• ${p.numero} · ${fecha(p.created_at)} · ${plata(p.monto)} · ${p.estado}`).join('\n')
  return {
    texto: `Últimos pedidos de *${cliente.nombre_comercio}*:\n${detalle}`,
    voz: `El último pedido de ${cliente.nombre_comercio} es del ${fecha(filas[0].created_at)}, por ${plataHablada(filas[0].monto)}.`,
  }
}

// Mismos campos que `mapProducto` (CatalogContext) para que `precioPara` decida igual que la app.
const aProducto = (p: any) => ({
  price: Number(p.precio_unitario) || 0,
  oferta: !!p.oferta,
  precioOferta: p.precio_oferta != null ? Number(p.precio_oferta) : null,
  escalas: p.escalas,
})

export function productos(b: any, busqueda: string): Respuesta {
  const filas = lineas(b.productos)
  const deBaja = lineas(b.de_baja)
  if (!filas.length) {
    if (deBaja.length) return ambos(`Lo encontré dado de baja: ${deBaja.join(', ')}. No está vigente en el catálogo.`)
    return ambos(`No encontré productos con "${busqueda}".`)
  }
  const detalle = filas.map((p) => {
    const prod = aProducto(p)
    const vale = precioPara(prod, 1)
    let linea = `• ${p.descripcion}: *${plata(vale.precio)}*`
    if (vale.motivo === 'oferta') linea += ` en oferta (lista ${plata(vale.base)})`
    const escalones = escaleraDe(prod)
    if (escalones.length) linea += `\n  ${escalones.map((e: any) => `desde ${e.desde}: ${plata(e.precio)}`).join(' · ')}`
    return linea
  }).join('\n')
  const total = Number(b.total) || filas.length
  const primero = filas[0]
  const precioPrimero = precioPara(aProducto(primero), 1).precio
  return {
    texto: `${detalle}${total > filas.length ? `\n…y ${total - filas.length} más. Decime un nombre más exacto.` : ''}`,
    voz: filas.length === 1
      ? `${primero.descripcion} está ${plataHablada(precioPrimero)}.`
      : `Encontré ${enPalabras(total)} productos. Los precios están en el mensaje.`,
  }
}

export function equipo(filas: any[]): Respuesta {
  const enHorario = filas.filter((f) => f.en_ventana)
  if (!enHorario.length) {
    const conVentas = filas.filter((f) => Number(f.pedidos_hoy) > 0)
    const extra = conVentas.length ? `\nCon pedidos hoy:\n${conVentas.map((f) => `• ${f.nombre}: ${pedidosTxt(Number(f.pedidos_hoy))}, ${plata(f.monto_hoy)}`).join('\n')}` : ''
    return { texto: `Ahora no hay nadie en horario de rastreo.${extra}`, voz: 'Ahora no hay nadie en horario de rastreo.' }
  }
  const reportando = enHorario.filter((f) => f.minutos_silencio != null && Number(f.minutos_silencio) <= 30)
  const detalle = enHorario.map((f) => {
    const m = f.minutos_silencio
    const estado = m == null ? '⚪ sin reportar hoy' : Number(m) <= 30 ? `🟢 hace ${m} min` : `🔴 hace ${m} min`
    return `• ${f.nombre} (${f.rol}): ${estado} · ${Number(f.visitas_hoy)} visitas · ${pedidosTxt(Number(f.pedidos_hoy))}`
  }).join('\n')
  return {
    texto: `En horario: ${enHorario.length} · reportando: ${reportando.length}\n${detalle}`,
    // "uno" y no "un": acá el número va solo, sin sustantivo atrás.
    voz: `En horario: ${enPalabras(enHorario.length).replace(/\bun$/, 'uno')}. Reportando: ${enPalabras(reportando.length).replace(/\bun$/, 'uno')}. El detalle está en el mensaje.`,
  }
}

export function clientesSinComprar(d: any): Respuesta {
  const total = Number(d.total) || 0
  const nunca = Number(d.nunca_compraron) || 0
  const notaNunca = nunca ? `\n\nAparte, ${nunca} de la cartera no tienen ningún pedido en DisT-At.` : ''
  if (!total) return ambos(`Ningún cliente que venía comprando lleva más de ${d.dias} días sin comprar.${notaNunca}`)
  const detalle = lineas(d.clientes).map((c) => `• ${c.nombre_comercio} (${c.codigo}): último ${fecha(c.ultima)}`).join('\n')
  return {
    texto: `${total} ${total === 1 ? 'cliente lleva' : 'clientes llevan'} más de ${d.dias} días sin comprar${total > 10 ? '; estos son los 10 que dejaron más recientemente' : ''}:\n${detalle}${notaNunca}`,
    voz: `${enPalabras(total)} ${total === 1 ? 'cliente lleva' : 'clientes llevan'} más de ${enPalabras(Number(d.dias))} días sin comprar. La lista está en el mensaje.`,
  }
}
