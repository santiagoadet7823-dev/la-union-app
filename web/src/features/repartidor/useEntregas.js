import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { enqueueMutacion, flushMutaciones } from '../../services/sync/writeQueue'
import { itemsDePedidos } from '../pedidos/usePedidos'

/**
 * LA HOJA DE ENTREGAS DEL REPARTIDOR.
 *
 * 🩸 POR QUÉ EXISTE (22/08/2026). `RepartidorView` arrancaba con `useState([])` y **nadie lo
 * llenaba nunca**: el comentario decía "las entregas reales llegarán de los pedidos asignados
 * (próxima etapa)" y esa etapa nunca llegó. La pantalla existía, el asistente de entrega andaba, el
 * pad de firma andaba — y todo se guardaba en estado local, así que al recargar no quedaba nada.
 *
 * 🔑 NO HIZO FALTA NINGUNA MIGRACIÓN, y vale la pena que quede escrito. Verificado contra la base
 * viva: `pedidos_sel`, `pedidos_upd`, `items_sel` e `items_upd` **ya** incluyen
 * `id_repartidor in (select ids_a_mi_cargo())`. La RLS se escribió pensando en este módulo. Para un
 * repartidor `ids_a_mi_cargo()` es él mismo, así que ve exactamente lo suyo **sin un solo filtro de
 * rol en el cliente** — misma disciplina que `usePedidos`: quién ve qué lo decide el servidor.
 *
 * ⚠️ LO QUE FALTABA ERA UN SOLO ESLABÓN: que algo ESCRIBA `id_repartidor`. Eso lo hace la pantalla
 * de gestión (`asignarRepartidor`), no ésta.
 */

/** [desde, hasta) del día de HOY en hora LOCAL. Salta es UTC−3 (regla 23). */
function rangoDeHoy() {
  const h = new Date()
  const desde = new Date(h.getFullYear(), h.getMonth(), h.getDate())
  const hasta = new Date(h.getFullYear(), h.getMonth(), h.getDate() + 1)
  return { desde: desde.toISOString(), hasta: hasta.toISOString() }
}

/**
 * 🔴 LOS ESTADOS SON LOS DE LA BASE, CON MAYÚSCULA Y ESPACIO.
 *
 * `RepartidorView` usaba `'en_camino'` y `'entregado'` en minúscula con guión bajo, que **no existen
 * en el CHECK de `pedidos.estado`** — un UPDATE con esos valores falla con 23514. Se traducen acá, en
 * un solo lugar, en vez de cambiar los nombres internos de la pantalla: son los que ordenan la lista
 * y los que eligen el color de la píldora, y estaban en una docena de lugares.
 */
const A_BASE = { pendiente: 'Pendiente', en_camino: 'En camino', entregado: 'Entregado', no_entregado: 'No entregado' }
const DE_BASE = { Pendiente: 'pendiente', 'En camino': 'en_camino', Entregado: 'entregado', 'No entregado': 'no_entregado' }

const SELECT = `
  id, numero, estado, monto_total, peso_total, created_at, ts_en_camino, ts_entregado,
  cliente:clientes!pedidos_id_cliente_fkey ( id, codigo, nombre_comercio, localidad, lat, lng )
`

const hhmm = (ts) => (ts ? new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : null)

/**
 * Los pedidos que este repartidor lleva hoy.
 *
 * Se filtra por `created_at` del día y no por una fecha de reparto: **no existe tal columna**. Es
 * una simplificación consciente y hay que saberla — un pedido tomado ayer y asignado hoy no aparece.
 * Cuando eso moleste, la respuesta es una columna de fecha de reparto, no ampliar el rango acá.
 */
export function useEntregas(idRepartidor) {
  const [estado, setEstado] = useState({ entregas: [], cargando: true, error: null })
  const [ciclo, setCiclo] = useState(0)
  const recargar = useCallback(() => setCiclo((n) => n + 1), [])
  const { desde, hasta } = useMemo(() => rangoDeHoy(), [ciclo])

  useEffect(() => {
    if (!idRepartidor) { setEstado({ entregas: [], cargando: false, error: null }); return }
    let vivo = true
    ;(async () => {
      setEstado((e) => ({ ...e, cargando: true }))
      try {
        const { data, error } = await supabase
          .from('pedidos')
          .select(SELECT)
          .eq('id_repartidor', idRepartidor)
          .neq('estado', 'Anulado')
          .gte('created_at', desde)
          .lt('created_at', hasta)
          .order('created_at', { ascending: true })
        if (error) throw error
        const pedidos = data || []
        // Las líneas en lote: son las cantidades que el repartidor confirma una por una, así que acá
        // sí se piden con la lista (a diferencia de gestión, que las trae recién al abrir un pedido).
        const lineas = await itemsDePedidos(pedidos.map((p) => p.id))
        if (!vivo) return
        setEstado({ cargando: false, error: null, entregas: pedidos.map((p) => mapEntrega(p, lineas.get(p.id) || [])) })
      } catch (e) {
        if (vivo) setEstado({ entregas: [], cargando: false, error: e?.message || 'sin conexión' })
      }
    })()
    return () => { vivo = false }
  }, [idRepartidor, desde, hasta, ciclo])

  return { ...estado, recargar }
}

/** Un pedido de la base → la forma que ya dibuja `RepartidorView`. */
function mapEntrega(p, lineas) {
  return {
    id: p.id,
    // Lo que se MUESTRA es el número legible (`000001`), el mismo del ticket impreso y del export
    // para facturar. El uuid queda para las mutaciones y no se le enseña a nadie.
    numero: p.numero || '—',
    client: p.cliente?.nombre_comercio || 'Comercio sin nombre',
    loc: p.cliente?.localidad || '',
    lat: p.cliente?.lat ?? null,
    lng: p.cliente?.lng ?? null,
    kg: Number(p.peso_total) || 0,
    monto: Number(p.monto_total) || 0,
    status: DE_BASE[p.estado] || 'pendiente',
    tomado: hhmm(p.created_at) || '—',
    entregado: hhmm(p.ts_entregado),
    items: lineas.map((l) => ({
      idLinea: l.id,
      name: l.descripcion || '—',
      gen: Number(l.cantidad) || 0,
      entregada: l.cantidad_entregada,
    })),
  }
}

/**
 * Cambia el estado del pedido. Por la cola: el repartidor está en la calle, y la calle no tiene
 * señal garantizada.
 *
 * La hora la pone el CLIENTE y no `now()` de la base, por el mismo motivo que en la anulación: si
 * sube dos horas después, lo que interesa es cuándo se entregó, no cuándo llegó el dato.
 */
export async function marcarEstado(pedido, status) {
  const estado = A_BASE[status]
  if (!estado) throw new Error('Estado desconocido: ' + status)
  const ts = new Date().toISOString()
  const payload = { estado }
  if (status === 'en_camino') payload.ts_en_camino = ts
  if (status === 'entregado') payload.ts_entregado = ts
  await enqueueMutacion({
    // El uid lleva el verbo y la hora: tocar dos veces deja dos entradas idénticas y la segunda es
    // un no-op, pero dos cambios distintos no se pisan.
    op_uid: `${pedido.id}:estado:${estado}:${ts}`,
    table: 'pedidos', op: 'update', id: pedido.id, payload,
  })
  flushMutaciones()
  return { ...pedido, status, entregado: status === 'entregado' ? hhmm(ts) : pedido.entregado }
}

/**
 * Los motivos de faltante, y el que viene elegido de entrada.
 *
 * 🩸 VIVEN ACÁ, AL LADO DEL GUARDADO (22/08/2026). Estaban en `RepartidorView`, y el default
 * —"Sin stock"— existía **sólo en el render**: `motivos[k] || 'Sin stock'`. Así que el chip se
 * dibujaba elegido y, si el repartidor no lo tocaba, `motivos` seguía vacío y se guardaba **null**.
 * Medido en la verificación del 22/08: una línea con `cantidad_entregada = 0` quedó con
 * `motivo_faltante = NULL` mientras la pantalla mostraba "Sin stock" seleccionado.
 *
 * Es el modo de falla típico de tener la misma decisión en dos lugares: la pantalla decía una cosa y
 * el dato guardaba otra, sin error y sin nada que se viera raro. Ahora el default es UNO y lo usan
 * los dos.
 */
export const MOTIVO_CHIPS = ['Sin stock', 'Rechazado', 'Otro']
export const MOTIVO_POR_DEFECTO = MOTIVO_CHIPS[0]

/**
 * Lo que realmente se entregó de cada renglón.
 *
 * ⚠️ Va DESPUÉS del cambio de estado y en mutaciones separadas: la cola es FIFO y corta al primer
 * fallo, así que si una línea rebota, el pedido igual quedó marcado como entregado y el faltante se
 * reintenta solo. Al revés —líneas primero— un rechazo dejaría al repartidor sin poder cerrar la
 * entrega delante del cliente.
 */
export async function guardarEntregado(pedido, cantidades, motivos) {
  const ts = new Date().toISOString()
  for (const it of pedido.items) {
    if (!it.idLinea) continue
    const entregada = Number(cantidades[it.idLinea] ?? it.gen) || 0
    const payload = { cantidad_entregada: entregada }
    // El motivo sólo se guarda si de verdad faltó algo: un "Otro" pegado a una entrega completa es
    // ruido que después nadie sabe interpretar.
    // El mismo default que dibuja la pantalla: si no tocaron ningún chip, vale el primero — que es
    // lo que el repartidor VIO elegido. Guardar null acá era mentirle al reporte de faltante.
    if (entregada < it.gen) payload.motivo_faltante = String(motivos[it.idLinea] || MOTIVO_POR_DEFECTO).slice(0, 120)
    await enqueueMutacion({
      op_uid: `${it.idLinea}:entregado:${ts}`,
      table: 'pedido_items', op: 'update', id: it.idLinea, payload,
    })
  }
  flushMutaciones()
}

/**
 * Asigna (o desasigna, con `null`) un repartidor. La usa la pantalla de GESTIÓN, no la del
 * repartidor — es el eslabón que faltaba en toda la app.
 *
 * La policy ya lo permite y no hace falta migración: para un `admin`, `ids_a_mi_cargo()` es su
 * empresa entera, así que tanto el `USING` como el `WITH CHECK` de `pedidos_upd` se satisfacen por
 * `id_vendedor`, **antes y después** del cambio. Para un `encargado` funciona sólo con los pedidos
 * de su propia gente, que es exactamente lo que corresponde.
 */
export async function asignarRepartidor(pedido, idRepartidor) {
  const ts = new Date().toISOString()
  await enqueueMutacion({
    op_uid: `${pedido.id}:repartidor:${idRepartidor || 'ninguno'}:${ts}`,
    table: 'pedidos', op: 'update', id: pedido.id,
    payload: { id_repartidor: idRepartidor || null },
  })
  flushMutaciones()
  return { ...pedido, id_repartidor: idRepartidor || null }
}
