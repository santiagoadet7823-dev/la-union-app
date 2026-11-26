import { supabase } from '../../services/supabase'
import { enqueueMutacion, flushMutaciones } from '../../services/sync/writeQueue'
import { comprimirImagen } from '../../services/data/productoImagen'
import { uid } from '../../lib/uid'

/**
 * NOVEDADES DE LA ENTREGA (plan 53, 26/11/2026). Pedido del usuario: "una opción para dejar un mensaje
 * de observación o novedades para detallar cualquier cambio que quiera hacer el cliente en ese momento:
 * a veces pagan una parte en efectivo y otra transfieren, a veces devuelven mercadería o llega algo
 * roto". Sirve para el registro de incidentes del informe.
 *
 * Tabla `entrega_novedades` (db/114), por la cola offline como todo lo del repartidor. Las fotos
 * (hasta 2, comprimidas) van al bucket privado `novedades-entrega` en `<empresa>/<pedido>/<id>.jpg`:
 * la ruta se decide ANTES de subir y viaja en la fila, así la novedad se guarda aunque no haya señal y
 * la foto sube cuando vuelve (`reintentarFotos`). Las fotos pendientes esperan en localStorage.
 */
export const TIPOS_NOVEDAD = [
  ['pago_mixto', 'Pagó parte en efectivo y parte por transferencia'],
  ['devolucion', 'Devolvió mercadería'],
  ['rotura', 'Llegó algo roto o en mal estado'],
  ['cambio_cliente', 'Cambio que pidió el cliente'],
  ['otro', 'Otro'],
]
export const MOTIVOS_NO_ENTREGA = [
  ['no_entregado_cerrado', 'Comercio cerrado'],
  ['no_entregado_ausente', 'No estaba el responsable'],
  ['no_entregado_rechazo', 'Rechazó el pedido'],
  ['no_entregado_otro', 'Otro motivo'],
]
export const ETIQUETA_NOVEDAD = Object.fromEntries([...TIPOS_NOVEDAD, ...MOTIVOS_NO_ENTREGA])
export const BUCKET_NOVEDADES = 'novedades-entrega'
export const MAX_FOTOS = 2

const K_PEND = 'lu-novedad-fotos-pend'
const leerPend = () => { try { return JSON.parse(localStorage.getItem(K_PEND) || '[]') } catch (_) { return [] } }
const guardarPend = (l) => { try { localStorage.setItem(K_PEND, JSON.stringify(l)) } catch (_) { /* sin lugar: se pierde la foto, no la novedad */ } }

const aDataUrl = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob) })
const deDataUrl = async (d) => (await fetch(d)).blob()

async function subir(path, blob) {
  const { error } = await supabase.storage.from(BUCKET_NOVEDADES).upload(path, blob, { upsert: true, contentType: blob.type || 'image/jpeg' })
  if (error) throw error
}

/** ¿La novedad tiene algo para guardar? */
export function novedadVacia(n) {
  return !n || (!(n.tipos?.length) && !String(n.detalle || '').trim() && !(n.fotos?.length))
}

/**
 * @param {{ id }} pedido
 * @param {{ tipos: string[], efectivo?: string|number, transferencia?: string|number, detalle?: string, fotos?: File[] }} n
 * @param {{ idEmpresa, idRepartidor }} quien
 */
export async function guardarNovedad(pedido, n, { idEmpresa, idRepartidor }) {
  if (novedadVacia(n)) return null
  const id = uid()
  const num = (v) => { const x = Number(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(x) && x > 0 ? x : null }
  const fotos = []
  const porSubir = []
  for (const [i, f] of (n.fotos || []).slice(0, MAX_FOTOS).entries()) {
    const { blob } = await comprimirImagen(f, 1280, 0.7)
    const path = `${idEmpresa}/${pedido.id}/${id}-${i + 1}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`
    fotos.push(path)
    porSubir.push([path, blob])
  }
  const pagoMixto = n.tipos?.includes('pago_mixto')
  await enqueueMutacion({
    op_uid: `${id}:novedad`,
    table: 'entrega_novedades', op: 'insert', id,
    payload: {
      id, id_empresa: idEmpresa, id_pedido: pedido.id, id_repartidor: idRepartidor,
      tipos: n.tipos || [],
      monto_efectivo: pagoMixto ? num(n.efectivo) : null,
      monto_transferencia: pagoMixto ? num(n.transferencia) : null,
      detalle: String(n.detalle || '').trim().slice(0, 1000) || null,
      fotos,
    },
  })
  flushMutaciones()
  // La foto necesita que la fila del pedido sea visible (la policy del bucket mira el pedido), no la
  // novedad: se puede subir ya. Si falla, queda pendiente.
  for (const [path, blob] of porSubir) {
    try { await subir(path, blob) } catch (_) {
      try { guardarPend([...leerPend(), { path, data: await aDataUrl(blob) }]) } catch (_) { /* sin lugar */ }
    }
  }
  return id
}

/** Sube las fotos que quedaron sin señal. Se llama al abrir la hoja de entregas y cada tanto. */
export async function reintentarFotos() {
  const pend = leerPend()
  if (!pend.length) return 0
  const quedan = []
  for (const p of pend) {
    try { await subir(p.path, await deDataUrl(p.data)) } catch (_) { quedan.push(p) }
  }
  guardarPend(quedan)
  return pend.length - quedan.length
}

/** Las novedades de un pedido, con URL firmada de cada foto (para Gestión → detalle del pedido). */
export async function novedadesDePedido(idPedido) {
  const { data, error } = await supabase.from('entrega_novedades')
    .select('id, tipos, monto_efectivo, monto_transferencia, detalle, fotos, created_at, repartidor:perfiles!entrega_novedades_id_repartidor_fkey ( nombre )')
    .eq('id_pedido', idPedido)
    .order('created_at')
  if (error) throw error
  const out = []
  for (const n of data || []) {
    const urls = []
    for (const path of n.fotos || []) {
      const { data: s } = await supabase.storage.from(BUCKET_NOVEDADES).createSignedUrl(path, 3600)
      urls.push(s?.signedUrl || null)
    }
    out.push({ ...n, urls })
  }
  return out
}
