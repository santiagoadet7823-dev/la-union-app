// Mensajes armados del ARM (plan 46/51, rediseño de Claude Design). Funciones puras, sin IA: el
// texto sale de los datos del catálogo y del pedido, con formato de WhatsApp (*negrita*, viñetas).
// 🔑 Nunca se escribe un precio a mano: lo que se muestra sale de `precioPara` (la misma regla del
// servidor). Igual, lo que se cobra lo recalcula siempre `crm-ticket`.
// Lo que arma este archivo se PRECARGA en el cuadro de respuesta: es editable y nunca se envía solo.
import { normalizarEscalas, precioPara } from '../lib/precios'

export const pesos = (n) => '$ ' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const cant = (n) => Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })

/** "YERBA AMANDA 1KG UN" → "Yerba Amanda 1kg". Las medidas quedan en minúscula; el UN final se va. */
export function nombreLindo(desc) {
  const palabras = String(desc || '').trim().split(/\s+/)
  if (palabras.length > 1 && /^(UN|UNI|UNID|U)$/i.test(palabras[palabras.length - 1])) palabras.pop()
  return palabras.map((p) => {
    if (/\d/.test(p)) return p.toLowerCase()
    if (/^(X|C\/U)$/i.test(p)) return p.toLowerCase()
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
  }).join(' ')
}

const esFardo = (p) => String(p?.unidad_venta || '').toUpperCase() === 'FDO'
export const porU = (p) => (esFardo(p) ? 'el fardo' : 'c/u')
const unidadCorta = (p) => (esFardo(p) ? 'fdo' : 'u')

/** Precio de un producto del catálogo para una cantidad (lista, oferta o escala). */
export function precioDe(p, q = 1) {
  return precioPara({ price: p.precio_unitario, oferta: p.oferta, precioOferta: p.precio_oferta, escalas: p.escalas }, q)
}
export const tieneOferta = (p) => !!p?.oferta && Number(p.precio_oferta) > 0 && Number(p.precio_oferta) < Number(p.precio_unitario)
export const escalas = (p) => normalizarEscalas(p?.escalas)
export const textoEscala = (p, e = escalas(p)[0]) => (e ? `desde ${e.desde} ${unidadCorta(p)}: ${pesos(e.precio)}` : '')

/** "Mandar precio": uno o varios productos. */
export function msgPrecio(productos) {
  const ps = productos.filter(Boolean)
  if (!ps.length) return ''
  if (ps.length === 1) {
    const p = ps[0]
    const of = tieneOferta(p)
    let s = `*${nombreLindo(p.descripcion)}* — ${pesos(of ? p.precio_oferta : p.precio_unitario)} ${porU(p)}`
    if (of) s += ` 🔥 oferta (antes ${pesos(p.precio_unitario)})`
    else if (escalas(p).length) s += ` (${textoEscala(p)})`
    return s + (esFardo(p) ? '. ¿Cuántos te anoto?' : '. ¿Cuántas te anoto?')
  }
  // El encabezado sale de las palabras que comparten las descripciones ("Yerba Don Arregui"), no de la
  // categoría/marca: en el catálogo real las yerbas están en "Almacén" con marca "YERBAS".
  const listas = ps.map((p) => nombreLindo(p.descripcion).split(' '))
  const comunes = []
  for (let i = 0; i < 3; i++) {
    const w = listas[0][i]
    if (!w || /\d/.test(w) || !listas.every((l) => (l[i] || '').toLowerCase() === w.toLowerCase())) break
    comunes.push(i === 0 ? w.toLowerCase() : w)
  }
  const intro = comunes.length ? `Estas son las opciones de ${comunes.join(' ')}:` : 'Estas son las opciones:'
  return [
    intro,
    ...ps.map((p) => {
      const of = tieneOferta(p)
      const esc = !of && escalas(p).length ? ` (${textoEscala(p)})` : ''
      return `• *${nombreLindo(p.descripcion)}* — ${pesos(of ? p.precio_oferta : p.precio_unitario)}${esFardo(p) ? ' el fardo' : ''}${of ? ' 🔥 oferta' : esc}`
    }),
    '¿Cuál te anoto y cuántos?',
  ].join('\n')
}

/** Resumen del carrito para mandarle al cliente. `items`: renglones del ticket. */
export function msgResumen(items, total) {
  return [
    '🧾 *Resumen de tu pedido*',
    ...items.map((r) => `• ${cant(r.cantidad)} × ${nombreLindo(r.descripcion)} — ${pesos(r.subtotal)}`),
    `*Total: ${pesos(total ?? items.reduce((s, r) => s + Number(r.subtotal || 0), 0))}*`,
    '',
    '¿Te lo confirmo así?',
  ].join('\n')
}

/** Situación de un pedido ya exportado: etiqueta, colores y mensaje para el cliente. */
export const SITUACION = {
  pronto_despacho: { t: '📦 Pronto a despacho', clase: 'info', msg: (o) => `Hola! Tu pedido N° ${o.numero} ya está armado y pronto a despacho 📦. Te avisamos cuando salga.` },
  // db/111: exportado hace más de 48 h y sin datos de reparto (La Unión no marca entregas en la app).
  en_erp: { t: '🗂 Cargado en el ERP', clase: '', msg: (o) => `Hola! Tu pedido N° ${o.numero} ya está cargado en nuestro sistema 📦. ¿Necesitás algo más?` },
  en_camino: { t: '🚚 En camino', clase: 'primario', msg: (o) => `Hola! Tu pedido N° ${o.numero} está en camino${o.repartidor_nombre ? ` con ${o.repartidor_nombre}` : ''} 🚚. Llega hoy en el horario de reparto.` },
  entregado: { t: '✅ Entregado', clase: 'ok', msg: (o) => `Hola! Tu pedido N° ${o.numero} figura entregado ✅. Cualquier cosa avisanos por acá.` },
  no_entregado: { t: '⚠ No entregado', clase: 'aviso', msg: (o) => `Hola! Tu pedido N° ${o.numero} no se pudo entregar. ¿Coordinamos para la próxima visita?` },
}

/** Respuestas sugeridas (⚡) según la conversación. Siempre se precargan, nunca se envían. */
export function sugeridas({ cliente, items, total, pedidos, minutosVentana, yo, empresa }) {
  const s = []
  if (!cliente) s.push(['Pedir el nombre del comercio', '¿Me pasás el nombre del comercio y la dirección así te encuentro en el sistema?'])
  if (items?.length) s.push(['Te paso el resumen…', msgResumen(items, total)])
  const camino = (pedidos || []).find((o) => o.situacion === 'en_camino')
  if (camino) s.push(['Pedido en camino', SITUACION.en_camino.msg(camino)])
  if (minutosVentana != null && minutosVentana > 0 && minutosVentana < 120) {
    s.push(['Ventana por vencer', '¿Seguimos con el pedido? Si me respondés ahora te lo dejo cargado hoy.'])
  }
  const nombre = String(yo || '').split(' ')[0]
  s.push(['Saludo', `¡Hola! Soy ${nombre}${empresa ? ` de ${nombreLindo(empresa)}` : ''}. ¿En qué te ayudo?`])
  return s
}
