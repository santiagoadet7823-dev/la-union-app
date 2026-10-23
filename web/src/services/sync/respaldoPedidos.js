import { isNative } from '../platform'
import { supabase, hasSupabase } from '../supabase'
import { persistence } from '../persistence'
import { enqueueMutacion, flushMutaciones, cuarentenaMutaciones, EVENTO_PEDIDO_NUMERADO } from './writeQueue'

/**
 * 🩸 UN ARCHIVO POR PEDIDO, FUERA DE LA COLA (23/10/2026, plan 22).
 *
 * Gabriel tomó 7 pedidos sin señal y llegaron 3. Ya con el candado y la lectura estricta del plan
 * 19, los 4 que faltan no dejaron rastro en el servidor —ni el pedido ni su visita—: la app se
 * cerró a las 12:00, al reabrir pidió login, y la cola que subió a las 14:04 era la de las 11:11.
 * Todo lo encolado después se perdió en el teléfono, en la capa de SQLite/localStorage.
 *
 * La cola es UNA clave que se reescribe entera en cada cambio: si esa escritura no llega a disco,
 * se pierde todo lo nuevo junto. Esto es la red debajo: un archivo propio por pedido en
 * `Directory.Data` (privado y persistente), escrito antes de encolar y borrado recién cuando el
 * servidor confirma el número. Al arrancar, y cada tanto, todo archivo cuyo pedido no esté ni en la
 * cola ni en cuarentena se vuelve a encolar. `registrar_pedido` es idempotente por `id`, así que
 * reencolar uno que ya subió no lo duplica.
 *
 * Solo en el APK: en la web la cola vive en un único localStorage y no hay disco aparte.
 */
const CARPETA = 'pedidos-respaldo'
const ruta = (id) => `${CARPETA}/${id}.json`
const KEY_COLA = 'lu-write-queue'

async function fs() {
  const mod = await import('@capacitor/filesystem')
  return { Filesystem: mod.Filesystem, Directory: mod.Directory }
}

/** Guarda el pedido en su archivo. `true` si quedó en disco. */
export async function guardarRespaldo(id, args) {
  if (!isNative()) return false
  try {
    const { Filesystem, Directory } = await fs()
    await Filesystem.writeFile({
      path: ruta(id), directory: Directory.Data, encoding: 'utf8', recursive: true,
      data: JSON.stringify({ id, args, ts: new Date().toISOString() }),
    })
    return true
  } catch (e) {
    console.warn('[respaldoPedidos] no se pudo guardar', id, e?.message || e)
    return false
  }
}

async function borrarRespaldo(id) {
  try {
    const { Filesystem, Directory } = await fs()
    await Filesystem.deleteFile({ path: ruta(id), directory: Directory.Data })
  } catch (_) { /* ya no estaba */ }
}

let reponiendo = false
/** Reencola los pedidos respaldados que no están ni en la cola ni en cuarentena. */
export async function reponerRespaldos() {
  if (!isNative() || reponiendo) return
  reponiendo = true
  try {
    const { Filesystem, Directory } = await fs()
    let archivos = []
    try { archivos = (await Filesystem.readdir({ path: CARPETA, directory: Directory.Data })).files || [] } catch (_) { return }
    if (!archivos.length) return
    // Estricta: si la cola no se puede leer, no se sabe qué falta y no se reencola nada.
    const cola = (await persistence.getEstricto(KEY_COLA, [])) || []
    const cuarentena = await cuarentenaMutaciones().catch(() => [])
    const vivos = new Set([...cola, ...cuarentena].map((m) => m.op_uid))
    let repuestos = 0
    for (const f of archivos) {
      const nombre = typeof f === 'string' ? f : f.name
      if (!nombre?.endsWith('.json')) continue
      const id = nombre.slice(0, -5)
      if (vivos.has(id)) continue
      let r
      try { r = JSON.parse((await Filesystem.readFile({ path: ruta(id), directory: Directory.Data, encoding: 'utf8' })).data) } catch (_) { continue }
      if (!r?.args) { await borrarRespaldo(id); continue }
      // Con red se pregunta primero: si ya está en la base (subió y el borrado del archivo no llegó),
      // se borra el archivo y listo. Así un pedido que después se borró en gestión no resucita.
      if (hasSupabase) {
        const { data, error } = await supabase.from('pedidos').select('id').eq('id', id).maybeSingle()
        if (!error && data) { await borrarRespaldo(id); continue }
      }
      await enqueueMutacion({ op_uid: id, op: 'rpc', fn: 'registrar_pedido', table: 'pedidos', args: r.args })
      repuestos++
    }
    if (repuestos) {
      console.warn('[respaldoPedidos] pedidos repuestos en la cola:', repuestos)
      flushMutaciones()
    }
  } catch (e) {
    console.warn('[respaldoPedidos] no se pudo reponer', e?.message || e)
  } finally {
    reponiendo = false
  }
}

let iniciado = false
/** Borra el archivo cuando el servidor numera el pedido, y repone al arrancar y cada 5 min. */
export function iniciarRespaldoPedidos() {
  if (iniciado || !isNative() || typeof window === 'undefined') return
  iniciado = true
  window.addEventListener(EVENTO_PEDIDO_NUMERADO, (e) => { if (e?.detail?.id) borrarRespaldo(e.detail.id) })
  setTimeout(() => reponerRespaldos(), 8000)
  setInterval(() => reponerRespaldos(), 5 * 60 * 1000)
}
