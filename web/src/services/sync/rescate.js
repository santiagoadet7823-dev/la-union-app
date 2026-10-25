import { supabase, hasSupabase } from '../supabase'
import { persistence } from '../persistence'
import { APP_VERSION } from '../../version'
import { cuarentenaMutaciones, flushMutaciones, pendingMutaciones, reencolarCuarentena } from './writeQueue'

/**
 * 🩸 RESCATE DE LOS PEDIDOS AISLADOS EN EL TELÉFONO (22/10/2026, plan 19).
 *
 * Del 13 al 22/10 la cola de escrituras perdió altas de visita (ver el candado en `writeQueue.js`),
 * y cada pedido de esas visitas rebotó con 23503 y quedó en la CUARENTENA del teléfono, sin aviso.
 * El vendedor lo daba por hecho; el panel y el ERP no lo tenían. Esto hace dos cosas, una vez por
 * arranque con sesión:
 *
 * 1. SUBE UNA COPIA de la cuarentena y de la jornada de hoy a `rescate_cola` (db/87). Es lo que
 *    permite ver DESDE EL SERVIDOR qué quedó aislado en cada teléfono, incluso lo que no se pueda
 *    reenviar solo — y cruzarlo con lo que el vendedor recuerda (el "151" de Agustín). Solo si
 *    cambió desde la última vez que se subió: no es telemetría, es una foto para revisar.
 * 2. VUELVE A ENCOLAR los pedidos, renglones y visitas de ESTA cuenta que rebotaron por algo que
 *    db/87 ya arregla (23503 visita faltante; 42501/SIN_FILAS por sesión vacía), una sola vez.
 *
 * Nada de esto borra: lo que no vuelve sigue en cuarentena (regla 20).
 */
const K_JORNADA = 'lu-jornada-abierta'
const K_SUBIDO = 'lu-rescate-subido'
const TABLAS = new Set(['visitas', 'pedidos', 'pedido_items'])
const MOTIVOS = ['23503', '42501', 'SIN_FILAS']

const corridos = new Set()

/** ¿La mutación es de esta cuenta? Los renglones no tienen dueño propio: van con su pedido. */
function esMia(m, userId) {
  const p = m.payload || m.args?.p_pedido || {}
  if (m.table === 'pedido_items') return true
  return p.id_vendedor === userId || p.id_usuario === userId
}

/** Firma barata para no volver a subir la misma foto en cada arranque. */
function firma(txt) {
  let h = 0
  for (let i = 0; i < txt.length; i++) h = ((h << 5) - h + txt.charCodeAt(i)) | 0
  return `${txt.length}:${h}`
}

export async function rescatarPedidos({ userId, idEmpresa }) {
  if (!hasSupabase || !userId || !idEmpresa) return
  const clave = `${userId}:${idEmpresa}`
  if (corridos.has(clave)) return
  corridos.add(clave)

  try {
    const cuarentena = (await cuarentenaMutaciones()) || []
    const jornada = await persistence.get(K_JORNADA, null)
    const visitados = jornada?.visitState
      ? Object.entries(jornada.visitState).map(([idCliente, v]) => ({ idCliente, ...v }))
      : []

    // 1. La foto. Solo si hay algo que mirar y cambió desde la última subida.
    // `servidorListo`: que `rescate_cola` acepte la foto PRUEBA que db/87 está aplicada — y sin
    // db/87 el reenvío rebotaría otra vez, quedaría marcado `_rescatado` y no se reintentaría más.
    let servidorListo = false
    if (cuarentena.length || visitados.length) {
      const contenido = {
        cuarentena,
        jornada: jornada ? { fecha: jornada.fecha, visitados } : null,
        en_cola: await pendingMutaciones().catch(() => null),
      }
      const f = firma(JSON.stringify(contenido))
      if ((await persistence.get(K_SUBIDO, null)) === f) {
        servidorListo = true // esta misma foto ya entró antes
      } else {
        const { error } = await supabase.from('rescate_cola').insert({
          id_empresa: idEmpresa,
          id_usuario: userId,
          dispositivo: typeof navigator !== 'undefined' ? navigator.userAgent : null,
          version: APP_VERSION,
          contenido,
        })
        // Si no subió (sin red, o db/87 todavía no aplicada) se reintenta en el próximo arranque.
        if (!error) { servidorListo = true; await persistence.set(K_SUBIDO, f) } else corridos.delete(clave)
      }
    }

    // 2. El reenvío. Va DESPUÉS de la foto: la foto tiene que mostrar lo que había, no lo que quedó.
    if (!servidorListo || !cuarentena.length) return
    const vuelven = await reencolarCuarentena((m) =>
      TABLAS.has(m.table) && esMia(m, userId) && MOTIVOS.some((c) => String(m._motivo || '').startsWith(c)))
    if (vuelven) {
      console.warn(`[rescate] ${vuelven} mutaciones de pedidos/visitas vuelven de la cuarentena a la cola`)
      flushMutaciones()
    }
  } catch (e) {
    console.warn('[rescate] no se pudo completar:', e?.message || e)
    corridos.delete(clave) // que lo intente de nuevo en el próximo montaje
  }
}

/**
 * REINTENTO A MANO (25/10/2026, plan 23). Lo dispara el botón "Reintentar envío": vuelve a la cola
 * TODO lo de la cuarentena que `debeVolver` acepte —sin filtrar por motivo y aunque ya se haya
 * rescatado una vez—, lo manda y cuenta lo que volvió a quedar aislado. Nada se borra (regla 20):
 * lo que rebota otra vez vuelve a la cuarentena por `aislar`.
 * Devuelve `{ vuelven, quedan, enCola }`: `quedan` = lo que `debeVolver` acepta y volvió a la
 * cuarentena; `enCola` = la cola entera después del envío (sin señal, lo reencolado sigue ahí y NO
 * se puede contar como enviado).
 */
export async function reintentarCuarentena(debeVolver = () => true) {
  const vuelven = await reencolarCuarentena(debeVolver, { forzar: true })
  if (vuelven) await flushMutaciones()
  const quedan = ((await cuarentenaMutaciones()) || []).filter(debeVolver).length
  const enCola = (await pendingMutaciones().catch(() => 0)) || 0
  return { vuelven, quedan, enCola }
}

/** Lo de pedidos de ESTA cuenta: lo que reintenta el vendedor desde su pantalla. */
export const esPedidoDe = (userId) => (m) => TABLAS.has(m.table) && esMia(m, userId)
