// crm-ticket — el ticket del pedido de una conversación, editable y confirmable desde el CRM
// (plan 41, paso 3; 09/11/2026).
//
// POST /functions/v1/crm-ticket  (con JWT; NO va en FUNCTIONS_NO_VERIFY_JWT)
//   { accion: 'guardar',   conversacion, version|null, items: [{ id_producto, cantidad }] }
//   { accion: 'enviar',    conversacion, version }   manda el resumen al cliente para que confirme
//   { accion: 'confirmar', conversacion, version }   crea el pedido real y le avisa al cliente
//   { accion: 'cancelar',  conversacion, version }
// → { ok: true, ticket, ... } · errores: { error: '<código>', ... }
//
// Reglas:
//   · Permiso 'crm' y tener el CONTROL de la conversación (no se toma solo: editar un ticket ajeno
//     sin haber tomado el chat es justo lo que el cartel "Controlado por" quiere evitar).
//   · 🔑 Precios: los calcula SIEMPRE el servidor con `precioPara` (la copia sincronizada de
//     `web/src/lib/precios.js` en `wa-asistente/lib`, regla 52). Del navegador solo se aceptan
//     producto y cantidad; cualquier precio que mande se ignora.
//   · `version`: cada cambio la sube en 1 y exige la que se leyó. Si otro editó en el medio →
//     409 'ticket-cambio' con el ticket actual, y el CRM lo vuelve a mostrar.
//   · Confirmar: exige el contacto vinculado a un cliente (`crm_vincular_cliente`) y renglones. Antes
//     recalcula los precios: si cambiaron desde la última edición, guarda los nuevos y devuelve 409
//     'precios-cambiaron' para que la persona los vea antes de confirmar.
//     El pedido entra por `registrar_pedido` (db/87: cabecera y renglones en una transacción) con el
//     contrato de db/71: origen 'whatsapp', vendedor del comercio, sin visita ni coordenadas.
//   · Conversación `demo` (paso 6): confirmar NO crea un pedido real (queda "DEMO-…") y no se habla con Meta.
import { atender, conversacion, enviarAlCliente, exigirVentana, Rechazo, ventanaAbierta,
  type Contexto, type Conversacion } from '../_compartido/crm.ts'
import { precioPara, redondearCant } from '../wa-asistente/lib/precios.js'

const MAX_RENGLONES = 200
const MAX_CANTIDAD = 99_999

type Renglon = {
  id_producto: string; codigo: string | null; descripcion: string; cantidad: number
  precio_unitario: number; subtotal: number; peso_kg: number; motivo: string
}

const centavos = (n: number) => Math.round(n * 100) / 100
const pesos = (n: number) => '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const cant = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 2 })

/** De lo que pidió la persona (producto + cantidad) a renglones con precio del servidor. */
async function armarRenglones(ctx: Contexto, empresa: string, pedidos: unknown): Promise<Renglon[]> {
  if (!Array.isArray(pedidos)) throw new Rechazo(400, 'items-invalidos')
  // El mismo producto dos veces se suma: el precio por escala depende de la cantidad total.
  const porId = new Map<string, number>()
  for (const it of pedidos as any[]) {
    const id = it?.id_producto
    const q = redondearCant(Number(it?.cantidad))
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Rechazo(400, 'items-invalidos')
    if (!(q > 0)) continue
    porId.set(id, redondearCant((porId.get(id) ?? 0) + q))
  }
  if (porId.size > MAX_RENGLONES) throw new Rechazo(400, 'demasiados-renglones', { max: MAX_RENGLONES })
  for (const q of porId.values()) if (q > MAX_CANTIDAD) throw new Rechazo(400, 'cantidad-excesiva', { max: MAX_CANTIDAD })
  if (!porId.size) return []

  const { data, error } = await ctx.db.from('productos')
    .select('id, codigo, descripcion, precio_unitario, oferta, precio_oferta, escalas, peso_kg')
    .eq('id_empresa', empresa).is('descontinuado_ts', null).in('id', [...porId.keys()])
  if (error) throw new Error(`productos: ${error.message}`)
  const prods = new Map((data ?? []).map((p: any) => [p.id, p]))
  const faltan = [...porId.keys()].filter((id) => !prods.has(id))
  if (faltan.length) throw new Rechazo(400, 'producto-inexistente', { ids: faltan })

  return [...porId.entries()].map(([id, cantidad]) => {
    const p: any = prods.get(id)
    const r = precioPara({ price: p.precio_unitario, oferta: p.oferta, precioOferta: p.precio_oferta, escalas: p.escalas }, cantidad)
    return {
      id_producto: id, codigo: p.codigo ?? null, descripcion: p.descripcion, cantidad,
      precio_unitario: r.precio, subtotal: centavos(r.precio * cantidad), peso_kg: Number(p.peso_kg) || 0, motivo: r.motivo,
    }
  })
}

const totalDe = (rs: Renglon[]) => centavos(rs.reduce((s, r) => s + r.subtotal, 0))

async function borrador(ctx: Contexto, c: Conversacion) {
  const { data, error } = await ctx.db.from('crm_tickets').select('*').eq('id_conversacion', c.id).eq('estado', 'borrador').maybeSingle()
  if (error) throw new Error(`crm_tickets: ${error.message}`)
  return data
}

/** Cambia el borrador solo si nadie lo tocó desde `version`. Sube la versión. */
async function cambiar(ctx: Contexto, c: Conversacion, version: unknown, cambios: Record<string, unknown>) {
  const v = Number(version)
  if (!Number.isInteger(v) || v < 1) throw new Rechazo(400, 'version-invalida')
  const { data, error } = await ctx.db.from('crm_tickets')
    .update({ ...cambios, version: v + 1, editado_por: ctx.yo.id, editado_nombre: ctx.yo.nombre, updated_at: new Date().toISOString() })
    .eq('id_conversacion', c.id).eq('estado', 'borrador').eq('version', v)
    .select('*')
  if (error) throw new Error(`crm_tickets: ${error.message}`)
  if (!data?.length) throw new Rechazo(409, 'ticket-cambio', { ticket: await borrador(ctx, c) })
  return data[0]
}

async function sistema(ctx: Contexto, c: Conversacion, texto: string) {
  const { error } = await ctx.db.rpc('_crm_sistema', { p_conv: c.id, p_texto: texto })
  if (error) console.error('crm-ticket: mensaje de sistema', error.message)
}

async function idClienteDe(ctx: Contexto, c: Conversacion): Promise<string | null> {
  const { data } = await ctx.db.from('crm_contactos').select('id_cliente').eq('id', c.id_contacto).single()
  return data?.id_cliente ?? null
}

function resumen(t: any) {
  const lineas = (t.items as Renglon[]).map((r) => `• ${cant(r.cantidad)} × ${r.descripcion} — ${pesos(r.subtotal)}`)
  return ['🧾 *Tu pedido*', ...lineas, '', `*Total: ${pesos(Number(t.total))}*`, '',
    'Respondé *SÍ* para confirmarlo o decinos qué querés cambiar.'].join('\n')
}

async function guardar(ctx: Contexto, c: Conversacion, cuerpo: any) {
  const items = await armarRenglones(ctx, c.id_empresa, cuerpo.items)
  const total = totalDe(items)
  const hay = await borrador(ctx, c)
  if (!hay) {
    if (cuerpo.version != null) throw new Rechazo(409, 'ticket-cambio', { ticket: null })
    const { data, error } = await ctx.db.from('crm_tickets').insert({
      id_empresa: c.id_empresa, id_conversacion: c.id, id_cliente: await idClienteDe(ctx, c), items, total,
      creado_por: ctx.yo.id, editado_por: ctx.yo.id, editado_nombre: ctx.yo.nombre,
    }).select('*').single()
    // 23505: otro creó el borrador al mismo tiempo (índice `crm_ticket_borrador_uq`).
    if (error?.code === '23505') throw new Rechazo(409, 'ticket-cambio', { ticket: await borrador(ctx, c) })
    if (error) throw new Error(`crm_tickets: ${error.message}`)
    return { ok: true, ticket: data }
  }
  // Sin versión, quien llama cree que no hay ticket: otro lo creó mientras tanto.
  if (cuerpo.version == null) throw new Rechazo(409, 'ticket-cambio', { ticket: hay })
  return { ok: true, ticket: await cambiar(ctx, c, cuerpo.version, { items, total }) }
}

async function enviar(ctx: Contexto, c: Conversacion, cuerpo: any) {
  const t = await borrador(ctx, c)
  if (!t) throw new Rechazo(404, 'sin-ticket')
  if (t.version !== Number(cuerpo.version)) throw new Rechazo(409, 'ticket-cambio', { ticket: t })
  if (!t.items?.length) throw new Rechazo(409, 'ticket-vacio')
  exigirVentana(c)
  const envio = await enviarAlCliente(ctx, c, { tipo: 'ticket', texto: resumen(t) })
  // El resumen ya salió: se anota sin exigir versión (no cambia lo que se vende).
  const { data: ticket } = await ctx.db.from('crm_tickets')
    .update({ enviado_ts: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', t.id).select('*').single()
  return { ok: true, ticket: ticket ?? t, envio }
}

async function confirmar(ctx: Contexto, c: Conversacion, cuerpo: any) {
  const t = await borrador(ctx, c)
  if (!t) throw new Rechazo(404, 'sin-ticket')
  if (t.version !== Number(cuerpo.version)) throw new Rechazo(409, 'ticket-cambio', { ticket: t })
  if (!t.items?.length) throw new Rechazo(409, 'ticket-vacio')

  const idCliente = await idClienteDe(ctx, c)
  if (!idCliente) throw new Rechazo(409, 'sin-cliente', { mensaje: 'Vinculá el contacto con un cliente antes de confirmar.' })
  const { data: cli } = await ctx.db.from('clientes').select('id, id_vendedor, nombre_comercio')
    .eq('id', idCliente).eq('id_empresa', c.id_empresa).is('archivado_ts', null).maybeSingle()
  if (!cli) throw new Rechazo(409, 'sin-cliente', { mensaje: 'El cliente vinculado ya no está activo.' })

  // Precios de HOY: si cambiaron desde la última edición, se guardan y se muestran antes de confirmar.
  const items = await armarRenglones(ctx, c.id_empresa, t.items)
  const total = totalDe(items)
  if (total !== Number(t.total) || JSON.stringify(items.map((r) => r.precio_unitario)) !==
      JSON.stringify((t.items as Renglon[]).map((r) => Number(r.precio_unitario)))) {
    const ticket = await cambiar(ctx, c, t.version, { items, total })
    throw new Rechazo(409, 'precios-cambiaron', { ticket })
  }

  // Se reserva el ticket (versión +1): desde acá ninguna otra edición con la versión vieja entra.
  const reservado = await cambiar(ctx, c, t.version, { id_cliente: idCliente })

  let idPedido: string | null = null
  let numero: string
  if (c.demo) {
    numero = `DEMO-${String(reservado.id).slice(0, 6).toUpperCase()}`
  } else {
    idPedido = crypto.randomUUID()
    const { data, error } = await ctx.db.rpc('registrar_pedido', {
      p_pedido: {
        id: idPedido, id_empresa: c.id_empresa, id_vendedor: cli.id_vendedor ?? null, id_cliente: idCliente,
        id_visita: null, estado: 'Pendiente', monto_total: total,
        peso_total: centavos(items.reduce((s, r) => s + r.peso_kg * r.cantidad, 0)),
        origen: 'whatsapp', observaciones: `Pedido por WhatsApp, confirmado en el CRM por ${ctx.yo.nombre}`,
      },
      p_items: items.map((r) => ({
        id_producto: r.id_producto, descripcion: r.descripcion, cantidad: r.cantidad,
        precio_unitario: r.precio_unitario, peso_kg: r.peso_kg, codigo_producto: r.codigo,
      })),
    })
    // El ticket queda en borrador (con la versión nueva) y se puede volver a intentar.
    if (error) throw new Rechazo(500, 'pedido-fallo', { detalle: error.message, ticket: reservado })
    numero = data
  }

  const { data: fin, error: e2 } = await ctx.db.from('crm_tickets').update({
    estado: 'confirmado', id_pedido: idPedido, numero_pedido: numero, confirmado_ts: new Date().toISOString(),
    version: reservado.version + 1, editado_por: ctx.yo.id, editado_nombre: ctx.yo.nombre, updated_at: new Date().toISOString(),
  }).eq('id', reservado.id).select('*').single()
  // El pedido ya existe: un fallo acá no lo deshace, se avisa para que no se confirme dos veces.
  if (e2) console.error('crm-ticket: pedido creado pero ticket sin marcar', idPedido, e2.message)
  await sistema(ctx, c, `${ctx.yo.nombre} confirmó el pedido N° ${numero} (${pesos(total)}) para ${cli.nombre_comercio}`)

  // Aviso al cliente: solo dentro de la ventana de 24 h. Si falla, el pedido queda igual.
  let aviso: unknown = { enviado: false, motivo: 'fuera-de-ventana' }
  if (c.demo || ventanaAbierta(c)) {
    try {
      aviso = await enviarAlCliente(ctx, c, {
        tipo: 'texto', texto: `✅ ¡Listo! Tu pedido N° ${numero} quedó confirmado por ${pesos(total)}. Gracias.`,
      })
    } catch (e) {
      aviso = { enviado: false, motivo: e instanceof Rechazo ? e.codigo : 'error' }
    }
  }
  return { ok: true, ticket: fin ?? { ...reservado, estado: 'confirmado', numero_pedido: numero, id_pedido: idPedido }, numero_pedido: numero, aviso }
}

async function cancelar(ctx: Contexto, c: Conversacion, cuerpo: any) {
  const ticket = await cambiar(ctx, c, cuerpo.version, { estado: 'cancelado' })
  await sistema(ctx, c, `${ctx.yo.nombre} canceló el ticket`)
  return { ok: true, ticket }
}

const ACCIONES: Record<string, (ctx: Contexto, c: Conversacion, cuerpo: any) => Promise<unknown>> = {
  guardar, enviar, confirmar, cancelar,
}

Deno.serve((req) => atender(req, async (ctx, cuerpo) => {
  const accion = ACCIONES[cuerpo.accion]
  if (!accion) throw new Rechazo(400, 'accion-invalida')
  const c = await conversacion(ctx, cuerpo.conversacion, { control: true })
  return accion(ctx, c, cuerpo)
}))
