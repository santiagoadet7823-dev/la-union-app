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
  fueraDeTema: 'Solo puedo consultar datos de La Unión: ventas, pedidos, clientes, precios, equipo, visitas y zonas. No puedo cambiar nada.',
  ayuda: 'Hola. Podés preguntarme por escrito o por audio, por ejemplo:\n• ¿Cuánto vendimos hoy?\n• ¿Quién vendió más esta semana?\n• ¿En qué anda el pedido 687?\n• ¿Qué le vendimos a Supermercado Olé?\n• ¿A cuánto está el aceite Prado?\n• ¿Quién está en la calle?\n• ¿Qué clientes hace un mes que no compran?\n• ¿Cómo viene Juan este mes?\n• ¿Desde dónde toma los pedidos Juan?\n• ¿Qué zona conviene pasar a WhatsApp?',
  stock: 'No tengo datos de stock: DisT-At no lleva existencias. Sí puedo decirte precios y ventas.',
  soloTextoOAudio: 'Por ahora solo entiendo mensajes de texto y audios.',
  audioLargo: 'El audio es muy largo. Mandame uno de menos de 2 minutos.',
  audioVacio: 'No pude entender el audio. ¿Me lo mandás de nuevo o por escrito?',
  iaCaida: 'No puedo procesar consultas en este momento. Probá de nuevo en unos minutos.',
  errorConsulta: 'No pude leer ese dato en este momento. Probá de nuevo en unos minutos.',
  ejemplos: '• ¿Cuánto vendimos hoy?\n• ¿Quién vendió más esta semana?\n• ¿En qué anda el pedido 687?\n• ¿A cuánto está el aceite Prado?\n• ¿Quién está en la calle?\n• ¿Cómo viene Juan este mes?\n• ¿Desde dónde toma los pedidos Juan?\n• ¿Qué zona conviene pasar a WhatsApp?',
  sinCupo: 'Se terminaron los mensajes gratis de este mes. Vuelvo a responder el 1.º del mes que viene.',
  precioServicio: 'El precio del servicio lo va a cotizar Santiago cuando termine este mes de prueba. Mientras tanto, lo podés usar gratis.',
}

// Prueba gratuita de noviembre de 2026 (pedido del 07/11). Después de esa fecha la bienvenida no la menciona.
const PRUEBA_GRATIS_HASTA = '2026-11-30'

/** Primer mensaje de cada persona. Meta no deja escribir primero sin plantilla paga: la bienvenida va
 * como respuesta a lo primero que mande. */
export function bienvenida(nombre: string, hoy: string): string {
  const prueba = hoy <= PRUEBA_GRATIS_HASTA ? ' Este mes lo podés usar gratis, como prueba.' : ''
  return `Hola ${nombre}. Soy el asistente de WhatsApp de DisT-At: te ayudo a seguir a los vendedores y repartidores de una forma más práctica, por escrito o por audio.\n\nSirve para consultar en el momento, sin abrir la app, las ventas, los pedidos, los clientes y cómo trabaja el equipo en la calle: quién bajó, desde dónde toma los pedidos cada vendedor y qué zonas conviene atender por WhatsApp para bajar costos. Solo consulta: no cambia ningún dato.${prueba}\n\nPodés preguntarme, por ejemplo:\n${TEXTOS.ejemplos}`
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

// ── Plan 40: rendimiento, control de visitas, avisos y zonas ────────────────────────────────────
// 🔒 Los desvíos se informan como INDICIO con sus datos, nunca como acusación (decisión del 07/11):
// un pedido tomado por teléfono o un comercio mal ubicado en el mapa también dan "lejos".

const nombreCorto = (n: unknown) => String(n ?? '').split(/\s+/)[0] || String(n ?? '')
const hora = (min: unknown) => {
  const m = Math.round(Number(min))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
const coma = (n: unknown) => String(n ?? '').replace('.', ',')
const km = (n: unknown) => `${miles(Number(n) || 0)} km`
const distancia = (m: unknown) => (Number(m) >= 1000 ? `${(Number(m) / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(Number(m))} m`)
export function plataCorta(n: unknown): string {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1).replace('.', ',')} M`
  if (Math.abs(v) >= 1000) return `$${Math.round(v / 1000)} mil`
  return plata(v)
}

export function personaAmbigua(lista: any[], busqueda: string): Respuesta {
  return {
    texto: `Hay ${lista.length} personas con "${busqueda}". ¿Cuál?\n${lista.map((p) => `• ${p.nombre} (${p.rol})`).join('\n')}`,
    voz: `Hay ${enPalabras(lista.length)} personas con ese nombre. Decime cuál, las tenés en el mensaje.`,
  }
}

type Indicio = { lejosAlto: boolean; puntoPropio: boolean; pocos: boolean; lineas: string[] }

/** Lo que dicen los pedidos de UNA persona sobre dónde se tomaron. `d` es lo que devuelve wa_control_visitas. */
export function indicio(f: any, d: any): Indicio {
  const lineas: string[] = []
  const conDato = Number(f.con_dato) || 0
  const pocos = conDato < Number(d.min_pedidos || 10)
  const pct = Number(f.pct_lejos) || 0
  const equipo = d.pct_equipo != null ? Number(d.pct_equipo) : null
  if (pocos) {
    lineas.push(`Pocos pedidos con GPS confiable (${conDato}): no alcanza para sacar conclusiones.`)
    return { lejosAlto: false, puntoPropio: false, pocos, lineas }
  }
  // Muchos más pedidos lejos que el resto: 1,5 veces la mediana del equipo y al menos 25 %.
  const lejosAlto = equipo != null && pct >= 25 && pct >= 1.5 * equipo
  lineas.push(`${f.lejos} de ${conDato} pedidos (${pct} %) se tomaron a más de ${d.lejos_m} m del comercio${equipo != null ? ` (equipo: ${equipo} %)` : ''}.`)
  const puntoClientes = Number(f.punto_clientes) || 0
  const hayPunto = puntoClientes >= Number(d.punto_min_clientes || 5) && Number(f.punto_mediana_m) > 1000
  const puntoPropio = hayPunto && !f.punto_compartido
  if (hayPunto) {
    lineas.push(`${f.punto_pedidos} pedidos de ${puntoClientes} comercios distintos salieron de un mismo lugar, a unos ${distancia(f.punto_mediana_m)} de los comercios, en ${f.punto_dias} ${Number(f.punto_dias) === 1 ? 'día' : 'días'}.`)
    lineas.push(f.punto_compartido
      ? 'Desde ese lugar también cargan pedidos otros del equipo: posiblemente sea la oficina o el depósito.'
      : 'Ese lugar no lo usa nadie más del equipo.')
  }
  return { lejosAlto, puntoPropio, pocos, lineas }
}

const CIERRE_INDICIO = 'Puede que no esté visitando a todos los comercios: conviene revisarlo. También puede tratarse de pedidos por teléfono o de comercios mal ubicados en el mapa.'

export function controlVisitas(d: any, periodo: string, unaPersona: boolean): Respuesta {
  const filas = lineas(d.personas)
  if (!filas.length) return ambos(`Sin pedidos tomados ${periodo}.`)
  const base = `\n_Basado en: GPS del celular al confirmar cada pedido (solo lecturas con error menor a 30 m)._`
  if (unaPersona) {
    const f = filas[0]
    const ind = indicio(f, d)
    const extra: string[] = []
    if (f.km != null) extra.push(`Recorrió ${km(f.km)} en ${f.dias_gps} ${Number(f.dias_gps) === 1 ? 'día' : 'días'}, ${String(f.horas).replace('.', ',')} h en la calle y ${f.paradas} paradas.`)
    if (Number(f.visitas)) extra.push(`Visitas: ${f.visitas}; ${f.check_in_lejos} con la llegada marcada lejos del comercio.`)
    const alerta = ind.lejosAlto || ind.puntoPropio
    return {
      texto: `*${f.nombre}* ${periodo}:\n${ind.lineas.join('\n')}${extra.length ? '\n' + extra.join('\n') : ''}${alerta ? `\n\n⚠️ ${CIERRE_INDICIO}` : ind.pocos ? '' : '\n\nNada fuera de lo común frente al resto del equipo.'}${base}`,
      voz: alerta
        ? `${nombreCorto(f.nombre)} tomó el ${enPalabras(Number(f.pct_lejos))} por ciento de los pedidos lejos del comercio. Puede que no esté visitando: conviene revisarlo. El detalle está en el mensaje.`
        : ind.pocos ? `De ${nombreCorto(f.nombre)} hay pocos datos para sacar conclusiones.` : `${nombreCorto(f.nombre)} no muestra nada fuera de lo común. El detalle está en el mensaje.`,
    }
  }
  const marcados: string[] = []
  const detalle = filas.slice(0, 10).map((f) => {
    const ind = indicio(f, d)
    const alerta = ind.lejosAlto || ind.puntoPropio
    if (alerta) marcados.push(nombreCorto(f.nombre))
    const pct = ind.pocos ? 'pocos datos' : `${f.pct_lejos} % lejos`
    return `• ${f.nombre}: ${pct}${alerta ? ' ⚠️' : ''}${f.km != null ? ` · ${km(f.km)}` : ''}`
  }).join('\n')
  return {
    texto: `Pedidos tomados lejos del comercio (más de ${d.lejos_m} m) ${periodo}:\n${detalle}${d.pct_equipo != null ? `\nMediana del equipo: ${d.pct_equipo} %` : ''}${marcados.length ? `\n\n⚠️ = indicio para revisar. Preguntame "¿desde dónde toma los pedidos ${marcados[0]}?" para ver el detalle.` : ''}${base}`,
    voz: marcados.length
      ? `Para revisar: ${marcados.join(', ')}. El detalle está en el mensaje.`
      : 'Nadie se aparta mucho del resto del equipo. El detalle está en el mensaje.',
  }
}

// Tasa por día trabajado y comparación con sus 4 semanas anteriores.
const porDia = (v: unknown, dias: unknown) => (Number(dias) > 0 ? Number(v) / Number(dias) : 0)
// Baja: menos del 70 % de lo de antes; suba: más del 130 % (mismos cortes que `ia_resumen_equipo`, db/95).
function cambio(actual: number, antes: number, fmt: (n: number) => string = fmtNum): { flecha: string; baja: boolean; sube: boolean } {
  if (!antes) return { flecha: '', baja: false, sube: false }
  const r = actual / antes
  if (r < 0.7) return { flecha: ` ⬇️ (antes ${fmt(antes)})`, baja: true, sube: false }
  if (r > 1.3) return { flecha: ` ⬆️ (antes ${fmt(antes)})`, baja: false, sube: true }
  return { flecha: '', baja: false, sube: false }
}
const fmtNum = (n: number) => (n >= 100 ? miles(n) : n.toFixed(1).replace('.', ','))

export function rendimiento(filas: any[], control: any, periodo: string, clave: string, unaPersona: boolean): Respuesta {
  if (!filas.length) return ambos(`Sin actividad ${periodo}.`)
  const enCurso = clave === 'hoy' || clave === 'semana' || clave === 'mes' ? '\n_El período está en curso; comparo por día trabajado._' : ''
  const base = '\n_Basado en: visitas y pedidos cargados en la app, comparados por día trabajado con las 4 semanas anteriores._'
  const resumen = (f: any) => {
    const ped = cambio(porDia(f.pedidos, f.dias), porDia(f.pedidos_base, f.dias_base))
    const vis = cambio(porDia(f.visitas, f.dias), porDia(f.visitas_base, f.dias_base))
    const mon = cambio(porDia(f.monto, f.dias), porDia(f.monto_base, f.dias_base), (n) => plata(Math.round(n)))
    const tarde = f.arranque_min != null && f.arranque_base != null && Number(f.arranque_min) > Number(f.arranque_base) + 45
    return { ped, vis, mon, tarde, baja: ped.baja || vis.baja || mon.baja || tarde }
  }
  if (unaPersona) {
    const f = filas[0]
    if (!Number(f.dias)) return ambos(`${f.nombre} no tiene visitas ni pedidos ${periodo}.`)
    const r = resumen(f)
    const efect = Number(f.visitas) ? Math.round((100 * Number(f.pedidos)) / Number(f.visitas)) : null
    let texto = `*${f.nombre}* ${periodo} (${f.dias} ${Number(f.dias) === 1 ? 'día trabajado' : 'días trabajados'}), por día:\n` +
      `• Visitas: ${fmtNum(porDia(f.visitas, f.dias))}${r.vis.flecha}\n` +
      `• Pedidos: ${fmtNum(porDia(f.pedidos, f.dias))}${r.ped.flecha}\n` +
      `• Venta: ${plata(Math.round(porDia(f.monto, f.dias)))}${r.mon.flecha}\n` +
      (efect != null ? `• Efectividad: ${efect} % de las visitas con pedido\n` : '') +
      (f.arranque_min != null ? `• Arranca a las ${hora(f.arranque_min)}${f.arranque_base != null ? ` (antes ${hora(f.arranque_base)})` : ''}${r.tarde ? ' ⬇️' : ''}\n` : '') +
      `Total ${periodo}: ${plata(f.monto)} en ${pedidosTxt(Number(f.pedidos))}.`
    // Combinación (plan 40): si bajó algo, se suma dónde tomó los pedidos.
    const fc = lineas(control?.personas)[0]
    let alerta = false
    if (fc) {
      const ind = indicio(fc, control)
      alerta = ind.lejosAlto || ind.puntoPropio
      if (r.baja || alerta) {
        texto += `\n\nDónde tomó los pedidos:\n${ind.lineas.join('\n')}`
        if (alerta) texto += `\n⚠️ ${CIERRE_INDICIO}`
        texto += `\nPara el detalle: "¿desde dónde toma los pedidos ${nombreCorto(f.nombre)}?"`
      }
    }
    return {
      texto: texto + enCurso + base,
      voz: `${nombreCorto(f.nombre)} ${r.baja ? 'viene más bajo que sus semanas anteriores' : r.mon.sube || r.ped.sube ? 'viene mejor que sus semanas anteriores' : 'viene parejo con sus semanas anteriores'}` +
        (alerta ? ', pero tomó muchos pedidos lejos del comercio: conviene revisarlo' : '') +
        (r.baja || alerta ? '. El detalle está en el mensaje.' : `: ${plataHablada(f.monto)} ${periodo}.`),
    }
  }
  const bajaron: string[] = []
  const detalle = filas.filter((f) => Number(f.dias) > 0).slice(0, 12).map((f) => {
    const r = resumen(f)
    if (r.baja) bajaron.push(nombreCorto(f.nombre))
    return `• ${f.nombre}: ${plata(f.monto)} · ${fmtNum(porDia(f.pedidos, f.dias))} ped/día${r.ped.baja || r.mon.baja ? ' ⬇️' : r.mon.sube ? ' ⬆️' : ''}${r.vis.baja ? ' · menos visitas' : ''}${r.tarde ? ' · arranca tarde' : ''}`
  }).join('\n')
  const sinActividad = filas.filter((f) => !Number(f.dias) && Number(f.dias_base) > 0).map((f) => nombreCorto(f.nombre))
  return {
    texto: `Equipo ${periodo}, contra sus 4 semanas anteriores:\n${detalle}${sinActividad.length ? `\nSin actividad: ${sinActividad.join(', ')}` : ''}${bajaron.length ? `\n\n⬇️ Bajaron: ${bajaron.join(', ')}. Preguntame "¿cómo viene ${bajaron[0]}?" para el detalle.` : ''}${enCurso}${base}`,
    voz: bajaron.length ? `Bajaron frente a sus semanas anteriores: ${bajaron.join(', ')}. El detalle está en el mensaje.` : 'Nadie bajó frente a sus semanas anteriores. El detalle está en el mensaje.',
  }
}

export function avisos(filas: any[], periodo: string): Respuesta {
  if (!filas.length) return ambos(`Sin avisos del equipo ${periodo}.`)
  const detalle = filas.slice(0, 12).map((f) => {
    const partes = [
      Number(f.sin_reportar) ? `${f.sin_reportar} sin reportar` : '',
      Number(f.quieto) ? `${f.quieto} quieto mucho tiempo` : '',
      Number(f.transporte) ? `${f.transporte} viaje sin declarar` : '',
    ].filter(Boolean)
    return `• ${f.nombre}: ${partes.join(', ')} (el más largo: ${coma(Math.round((Number(f.max_minutos) / 60) * 10) / 10)} h)`
  }).join('\n')
  return {
    texto: `Avisos del equipo ${periodo}:\n${detalle}\n_"Sin reportar" = el celular no mandó ubicación (apagado, sin señal o sin datos)._`,
    voz: `${filas[0].nombre.split(' ')[0]} es quien tuvo más avisos ${periodo}: ${enPalabras(Number(filas[0].total))}. El detalle está en el mensaje.`,
  }
}

export function zonas(d: any, busqueda: string): Respuesta {
  const filas = lineas(d.zonas)
  if (!filas.length) return ambos(busqueda ? `No encontré zonas con "${busqueda}".` : 'No hay zonas con clientes para analizar.')
  const conCostos = !!d.con_costos
  const sinCostos = conCostos ? '' : '\n_Para estimar el ahorro en pesos, cargá el costo por km, por hora de vendedor y por visita._'
  const base = '\n_Basado en: últimos 30 días de visitas, pedidos y GPS. "Listos para WhatsApp" = compraron 3 o más veces en 60 días y tienen teléfono cargado. Es una estimación._'
  const linea = (z: any) => {
    const costo = z.costo != null ? ` · cuesta ≈ ${plataCorta(z.costo)} (${String(z.costo_sobre_venta).replace('.', ',')} % de la venta)` : ''
    return `• *${z.nombre}*${z.vendedor ? ` (${nombreCorto(z.vendedor)})` : ''}: ${plataCorta(z.monto)} vendidos, ${z.visitas} visitas, ${km(z.km)}, ${String(z.horas).replace('.', ',')} h${costo}`
  }
  const propuesta = (z: any) => Number(z.listos_wa) > 0
    ? `Propuesta: pasar a pedidos por WhatsApp a ${z.listos_wa} de ${z.clientes} comercios (los que compran parejo y tienen teléfono), con una visita por mes. Serían ${z.visitas_ahorrables} visitas menos por mes${z.ahorro != null ? `, unos *${plataCorta(z.ahorro)}* de ahorro` : ''}.`
    : `No hay comercios listos para WhatsApp: ${Number(z.compran_parejo)} compran parejo pero solo ${z.con_telefono} de ${z.clientes} tienen teléfono cargado.`
  if (filas.length === 1) {
    const z = filas[0]
    return {
      texto: `Zona ${linea(z).slice(2)}\n${z.pedidos} pedidos de ${z.clientes} comercios.\n\n${propuesta(z)}${sinCostos}${base}`,
      voz: Number(z.listos_wa) > 0
        ? `En ${z.nombre} se ${Number(z.listos_wa) === 1 ? 'podría pasar a WhatsApp un comercio' : `podrían pasar a WhatsApp ${enPalabras(Number(z.listos_wa))} comercios`} y ahorrar ${Number(z.visitas_ahorrables) === 1 ? 'una visita' : `${enPalabras(Number(z.visitas_ahorrables))} visitas`} por mes. El detalle está en el mensaje.`
        : `En ${z.nombre} todavía no hay comercios listos para WhatsApp. El detalle está en el mensaje.`,
    }
  }
  const candidatas = [...filas].filter((z) => Number(z.listos_wa) > 0)
    .sort((a, b) => Number(b.ahorro ?? b.visitas_ahorrables) - Number(a.ahorro ?? a.visitas_ahorrables)).slice(0, 5)
  // Con menos de 10 visitas en 30 días el porcentaje es ruido (una zona con 4 visitas salía primera).
  const caras = filas.filter((z) => Number(z.visitas) >= 10).slice(0, 3)
  const textoCand = candidatas.length
    ? candidatas.map((z) => `• *${z.nombre}*: ${z.listos_wa} comercios listos, ${z.visitas_ahorrables} visitas menos por mes${z.ahorro != null ? ` (≈ ${plataCorta(z.ahorro)})` : ''}`).join('\n')
    : '• Ninguna: faltan teléfonos cargados en los comercios que compran parejo.'
  return {
    texto: `Candidatas para vender por WhatsApp con una visita por mes:\n${textoCand}\n\n${conCostos ? 'Las más caras de atender frente a lo que venden' : 'Las que más km recorren por lo que venden'}:\n${caras.map(linea).join('\n') || '• Ninguna zona con 10 visitas o más.'}\n\nPara una zona: "¿cuánto cuesta la zona de ${String(candidatas[0]?.nombre ?? caras[0]?.nombre ?? filas[0].nombre).toLowerCase()}?"${sinCostos}${base}`,
    voz: candidatas.length
      ? `La mejor candidata para pasar a WhatsApp es ${candidatas[0].nombre}, con ${enPalabras(Number(candidatas[0].listos_wa))} comercios listos. El detalle está en el mensaje.`
      : 'Todavía no hay zonas listas para WhatsApp: faltan teléfonos cargados. El detalle está en el mensaje.',
  }
}

const NO_DISPONIBLE: Record<string, string> = {
  stock: 'No tengo datos de stock: DisT-At no lleva existencias. Sí puedo decirte precios, lo más vendido y lo que está en caída.',
  deudas: 'No tengo deudas, cuenta corriente ni cobranzas: eso lo lleva el sistema de facturación. Sí puedo decirte lo vendido y los pedidos de cada cliente.',
  ganancia: 'No tengo costos de mercadería, así que no puedo calcular ganancia ni margen. Sí puedo decirte cuánto se vendió y qué se vende más.',
  sueldos: 'No tengo sueldos ni comisiones. Sí puedo decirte cuánto vendió cada uno y cómo viene frente a sus semanas anteriores.',
  entregas: 'Los repartidores todavía no marcan las entregas en la app, así que no tengo ese dato. Sí puedo decirte el estado de un pedido o quién está en la calle.',
  motivos: 'Los motivos de no compra todavía no se están cargando, así que no tengo ese dato. Sí puedo decirte cuántas visitas terminaron sin pedido, en "¿cómo viene…?".',
  otro: 'Ese dato no lo tengo en DisT-At. Puedo consultarte ventas, pedidos, clientes, precios, el equipo, las visitas y las zonas.',
}
export function datoNoDisponible(tema: string): Respuesta {
  return ambos(NO_DISPONIBLE[tema] ?? NO_DISPONIBLE[tema === 'consulta_stock' ? 'stock' : 'otro'])
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
