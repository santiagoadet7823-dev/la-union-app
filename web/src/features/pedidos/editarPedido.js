import { enqueueMutacion, flushMutaciones } from '../../services/sync/writeQueue'
import { uid } from '../../lib/uid'
import { precioDe } from '../../lib/precios'

/**
 * EDITAR UN PEDIDO YA CONFIRMADO.
 *
 * 🩸 POR QUÉ (03/09/2026, reunión con el dueño y un vendedor). Hasta hoy el pedido confirmado era
 * inmutable para quien lo tomó: dos cajones más a los cinco minutos, o un renglón equivocado,
 * obligaban a ANULAR y rehacerlo entero. Es el hermano de `anularPedido.js` y vive acá por la misma
 * razón (§7): nada de `supabase.from().update()` desde un componente — todo pasa por la cola, que
 * es lo que hace que un vendedor sin señal en el campo no pierda la corrección que acaba de hacer.
 *
 * 🔑 EL PRECIO DE LO VIEJO NO SE PUEDE MOVER, Y NO PORQUE ACÁ HAYA UNA CONDICIÓN QUE LO IMPIDA.
 * `pedido_items.precio_unitario` se copió en la línea cuando se tomó el pedido (`useJornada`), igual
 * que `descripcion`. Editar una línea vieja manda **sólo `cantidad`** en el payload, así que el
 * precio pactado sobrevive aunque entre medio haya entrado una lista nueva del ERP —que entra varias
 * veces por día—. La garantía es de forma, no de disciplina: no hay una línea que alguien pueda
 * olvidarse de escribir.
 *
 * ⚠️ Y bajar la cantidad NO recalcula el escalón por volumen. Si compró 12 al precio de 12 y
 * devuelve 4, paga 8 al precio de 12. Es la misma decisión del 27/08 para la entrega parcial: el
 * número se le prometió con el comerciante enfrente. Por eso acá **no** se llama a `precioPara`
 * sobre las líneas viejas: la única llamada a `precioDe` es para las líneas NUEVAS, que sí van al
 * precio de hoy.
 *
 * 🔴 UNA OPERACIÓN QUE RLS RECHAZA NO DA ERROR. Afecta cero filas y vuelve con éxito (está
 * explicado en `anularPedido.js`). Por eso la pantalla que llame a esto tiene que RELEER
 * (`recargar()` de `usePedidos`) y mostrar lo que quedó en la base, no lo que supusimos.
 */

/** Las líneas que la edición deja vivas, en la forma que espera la base. */
function lineasFinales(lineas, cantidades, nuevas) {
  const vivas = lineas
    .map((l) => ({ ...l, cantidad: Math.max(0, Math.round(Number(cantidades[l.id] ?? l.cantidad) || 0)) }))
    .filter((l) => l.cantidad > 0)
  return [...vivas, ...nuevas]
}

/**
 * El total y el peso que quedan. Se calcula ACÁ y no en la pantalla para que el número que se
 * guarda en `pedidos.monto_total` salga del mismo lugar que las líneas que se escriben — es la
 * regla 52 aplicada a la edición: el pie no puede divergir de los renglones de arriba.
 *
 * Cada línea aporta su PROPIO `precio_unitario`: las viejas el congelado, las nuevas el de hoy. Un
 * `totalesDeCarrito` acá estaría mal, porque recalcularía todo a precios de hoy.
 */
export function totalesDeLineas(lineas) {
  let total = 0
  let kg = 0
  let unidades = 0
  for (const l of lineas) {
    const c = Math.max(0, Math.round(Number(l.cantidad) || 0))
    if (!c) continue
    unidades += c
    total += c * (Number(l.precio_unitario) || 0)
    kg += c * (Number(l.peso_kg) || 0)
  }
  return { total, kg, unidades }
}

/**
 * Arma una línea nueva para un pedido que ya existe.
 *
 * 🔑 Acá está la otra mitad de la regla del cliente: el producto que se agrega HOY se cobra al
 * precio de HOY, resuelto por `precioDe` contra el catálogo actual — con su escalón por volumen si
 * la cantidad lo alcanza. Y se copian `descripcion` y `precio_unitario` en la fila, igual que hace
 * `guardarPedido`: dentro de seis meses el ticket tiene que seguir diciendo qué se vendió y a
 * cuánto, aunque marketing haya renombrado el producto.
 */
export function nuevaLinea(producto, cantidad, idPedido) {
  return {
    id: uid(),
    id_pedido: idPedido,
    id_producto: producto.id,
    descripcion: producto.name,
    cantidad,
    precio_unitario: precioDe(producto, cantidad),
    peso_kg: producto.kg || 0,
  }
}

/**
 * Qué cambió, en la forma que se guarda en `pedido_ediciones.cambios`. Se calcula sobre las líneas
 * ORIGINALES y las finales para que el registro diga el hecho ("de 12 a 8", "quitado", "agregado")
 * y no el estado, que ya está en las líneas.
 */
export function calcularCambios(lineas, cantidades, nuevas) {
  const cambios = []
  for (const l of lineas) {
    const antes = Math.max(0, Math.round(Number(l.cantidad) || 0))
    const despues = Math.max(0, Math.round(Number(cantidades[l.id] ?? l.cantidad) || 0))
    if (antes === despues) continue
    cambios.push({ id_producto: l.id_producto, descripcion: l.descripcion, de: antes, a: despues })
  }
  for (const n of nuevas) {
    cambios.push({ id_producto: n.id_producto, descripcion: n.descripcion, de: 0, a: n.cantidad })
  }
  return cambios
}

/**
 * Aplica la edición.
 *
 * 🔴 EL ORDEN DE LAS MUTACIONES NO ES INTERCAMBIABLE, y es el mismo razonamiento de `guardarPedido`
 * llevado al otro sentido. La cola es FIFO y corta al primer fallo:
 *
 *   1. **Las líneas primero.** Son lo que la policy puede rechazar (`items_upd`/`items_del` exigen
 *      que el pedido siga *Pendiente*). Si rebotan, la cabecera todavía no se tocó y el pedido queda
 *      COHERENTE con sus renglones viejos — que es el estado seguro. Al revés, un total nuevo sobre
 *      líneas viejas es un pedido que miente y que nadie sabe que miente.
 *   2. **La cabecera después**, con el total y el peso recalculados.
 *   3. **La auditoría al final**, porque es lo único que no cambia lo que se factura: si se pierde,
 *      se perdió el registro de un cambio que igual pasó — mejor eso que al revés.
 *
 * Todas son idempotentes: los updates llevan el `ts` en el `op_uid` (un reintento reescribe lo
 * mismo), el insert de líneas es `upsert` por `id` con `ignoreDuplicates`, y el delete de algo ya
 * borrado no falla.
 *
 * @param {object}   pedido      la fila que se está editando (necesita `id`, `id_empresa`, `monto_total`)
 * @param {object[]} lineas      las líneas ORIGINALES, tal como vinieron de la base
 * @param {object}   cantidades  { [idLinea]: nuevaCantidad } — sólo puede BAJAR (lo impide la pantalla)
 * @param {object[]} nuevas      líneas agregadas, armadas con `nuevaLinea()`
 * @param {string}   userId      quién edita
 * @param {object|null} pos      la posición ya adquirida por el watch (`useGps().pos`), no un fix nuevo
 */
export async function editarPedido({ pedido, lineas, cantidades, nuevas = [], userId, pos = null }) {
  // La hora la pone el cliente, igual que en `anularPedido`: la edición puede subir horas después.
  const ts = new Date().toISOString()
  const finales = lineasFinales(lineas, cantidades, nuevas)
  const { total, kg } = totalesDeLineas(finales)
  const cambios = calcularCambios(lineas, cantidades, nuevas)

  // Sin cambios no se encola nada. Guardar una edición vacía dejaría una fila de auditoría que
  // dice que alguien tocó el pedido cuando no tocó nada.
  if (!cambios.length) return { pedido, cambios: [] }

  // ── 1. Las líneas ──────────────────────────────────────────────────────────────────────────
  for (const l of lineas) {
    const antes = Math.max(0, Math.round(Number(l.cantidad) || 0))
    const despues = Math.max(0, Math.round(Number(cantidades[l.id] ?? l.cantidad) || 0))
    if (antes === despues) continue
    if (despues === 0) {
      // Se quita la línea entera. NO se deja en `cantidad = 0`: un producto que el comerciante no se
      // llevó no es un renglón en cero, es un renglón que no está — y un cero ensucia el ticket
      // impreso, el TSV de facturación y todo reporte que cuente renglones.
      await enqueueMutacion({ op_uid: `${l.id}:quitar:${ts}`, table: 'pedido_items', op: 'delete', id: l.id })
    } else {
      // 🔑 SÓLO `cantidad`. `precio_unitario` no viaja en el payload y por eso no se puede pisar.
      await enqueueMutacion({
        op_uid: `${l.id}:editar:${ts}`,
        table: 'pedido_items', op: 'update', id: l.id,
        payload: { cantidad: despues },
      })
    }
  }

  if (nuevas.length) {
    // Un solo insert con el array: la cola lo hace `upsert` por `id`, así que un reintento no
    // duplica renglones. Encolarlos de a uno serían N entradas que pueden empujar mutaciones más
    // viejas fuera de la ventana de la cola (el motivo por el que existe `updateMany`).
    await enqueueMutacion({ op_uid: `${pedido.id}:sumar:${ts}`, table: 'pedido_items', op: 'insert', payload: nuevas })
  }

  // ── 2. La cabecera ─────────────────────────────────────────────────────────────────────────
  await enqueueMutacion({
    op_uid: `${pedido.id}:totales:${ts}`,
    table: 'pedidos', op: 'update', id: pedido.id,
    payload: { monto_total: total, peso_total: kg },
  })

  // ── 3. La auditoría ────────────────────────────────────────────────────────────────────────
  // El cliente pidió explícitamente que quede DÓNDE y CUÁNDO se modificó. Las coordenadas salen de
  // la posición que el watch ya tiene, no se pide un fix nuevo — mismo criterio que `guardarPedido`:
  // esperar un GPS con el comerciante enfrente es peor que guardar la última buena.
  const edicion = {
    id: uid(),
    id_empresa: pedido.id_empresa,
    id_pedido: pedido.id,
    id_usuario: userId,
    ts,
    lat: pos?.lat ?? null,
    lng: pos?.lng ?? null,
    accuracy: pos?.accuracy ?? null,
    cambios,
    monto_antes: pedido.monto_total ?? null,
    monto_despues: total,
  }
  await enqueueMutacion({ op_uid: edicion.id, table: 'pedido_ediciones', op: 'insert', payload: edicion })

  flushMutaciones()

  // Se devuelve cómo queda, para que la pantalla lo muestre sin esperar la red. Pero la pantalla
  // igual tiene que RELEER: esto es lo que pedimos, no necesariamente lo que la base aceptó.
  return { pedido: { ...pedido, monto_total: total, peso_total: kg }, lineas: finales, cambios, edicion }
}

/**
 * Las ediciones de un pedido, para mostrarlas en el detalle. Lectura directa y no por la cola: es
 * historial, no una escritura.
 */
export async function edicionesDePedido(supabase, idPedido) {
  const { data, error } = await supabase
    .from('pedido_ediciones')
    .select('id, id_usuario, ts, lat, lng, accuracy, cambios, monto_antes, monto_despues, usuario:perfiles!pedido_ediciones_id_usuario_fkey ( nombre )')
    .eq('id_pedido', idPedido)
    .order('ts', { ascending: false })
  if (error) throw error
  return (data || []).map((e) => ({ ...e, nombre: e.usuario?.nombre || null }))
}
