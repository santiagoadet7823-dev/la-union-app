import { persistence } from './persistence'
import { enqueueMutacion, flushMutaciones } from './sync/writeQueue'
import { uid } from '../lib/uid'
import { hoyStr } from '../lib/format'

/**
 * JORNADA DE TRANSPORTE (17/09/2026, db/72). El estado "estoy en ruta" de la persona, como dato.
 *
 * Es un MÓDULO con estado a nivel de módulo y no un hook, por el mismo motivo que `tracker.js`
 * (regla 14): lo consume `iniciarUploaderNativo`, que corre fuera de React, y tiene que poder
 * preguntarlo de forma síncrona al armar las prefs del servicio nativo. Los componentes se cuelgan
 * con `suscribir()` (o con el hook `useTransporte`, que envuelve esto).
 *
 * Qué hace un tramo abierto:
 *   · En el TELÉFONO: `uploaderNativo.js` iguala las tres cadencias a `NEAR_LIVE_TRANSPORTE_MS`
 *     mientras `abierto()` sea verdadero. Es `fijar_cadencia` por evento. El nativo lee las prefs en
 *     cada fix, así que el cambio entra en la próxima transición de velocidad/actividad — o sea, al
 *     arrancar el vehículo. No hay comando "cambiá ya" (deuda D1 del plan): sería APK.
 *   · En la BASE: una fila en `tramos_transporte` con `inicio_ts` y, al cerrar, `fin_ts`. El panel
 *     pinta ese lapso del trazo en tinta y le pone hitos de hora; `alertas-equipo` deja de sospechar
 *     de la persona mientras esté abierto, y lo cierra solo al terminar su ventana de rastreo.
 *
 * Offline-first, como todo lo que escribe el teléfono en la calle: el estado local es la verdad
 * inmediata (persistido bajo `K_TRANSPORTE`, se restaura sólo si es de hoy — patrón de `K_JORNADA`
 * en `useJornada.js`), y la base se entera por la cola de escritura. El `id` lo genera el cliente
 * para que el reintento sea idempotente (`upsert … on conflict (id) do nothing` en `writeQueue`).
 * Si dos dispositivos con la misma cuenta abren a la vez, el índice único parcial de la base
 * rechaza al segundo con 23505 y la cola lo aparta a cuarentena — correcto: el tramo ya existe.
 */

const K_TRANSPORTE = 'lu-transporte'
/** Evento del documento: lo escucha `usePublishPosition` para reempujar las prefs al nativo. */
export const EVENTO_TRANSPORTE = 'lu-transporte'

/** `{ id, inicio_ts, origen, fecha, idUsuario }` o null. */
let actual = null
let cargado = false
const oyentes = new Set()

function avisar() {
  for (const fn of oyentes) { try { fn(actual) } catch (_) { /* un oyente roto no frena al resto */ } }
  try { window.dispatchEvent(new CustomEvent(EVENTO_TRANSPORTE, { detail: actual })) } catch (_) { /* sin window */ }
}

/**
 * Restaura el tramo persistido. Se llama una vez al montar la vista; hasta entonces `abierto()` es
 * false, que es el default seguro (cadencia adaptativa de siempre).
 *
 * Un tramo de OTRO día no se restaura: el cron ya lo cerró en la base (o lo va a cerrar) y la
 * persona no quiere arrancar la mañana con "en transporte desde ayer". Y uno de OTRA CUENTA
 * tampoco: la clave es del dispositivo, no del usuario (misma trampa que `lu-pos-queue`, regla 19),
 * así que si cambian de cuenta en el mismo teléfono el tramo del anterior se descarta en local —
 * en la base lo cierra el cron.
 */
export async function cargarTransporte(idUsuario) {
  if (cargado) return actual
  cargado = true
  try {
    const g = await persistence.get(K_TRANSPORTE, null)
    if (g && g.id && g.fecha === hoyStr() && (!g.idUsuario || g.idUsuario === idUsuario)) {
      actual = g
      avisar()
    } else if (g) {
      await persistence.set(K_TRANSPORTE, null)
    }
  } catch (_) { /* sin persistencia: se arranca cerrado */ }
  return actual
}

/** Sincrónico, para `iniciarUploaderNativo`. */
export function abierto() { return !!actual }
export function tramoActual() { return actual }

/**
 * Abre un tramo. `origen`: 'manual' (el botón) o 'reparto' (el repartidor marcó "En camino").
 * Idempotente: si ya hay uno abierto, devuelve ése y no escribe nada.
 */
export async function abrirTransporte(origen, { idUsuario, idEmpresa }) {
  if (actual) return actual
  if (!idUsuario || !idEmpresa) return null
  const inicio_ts = new Date().toISOString()
  const id = uid()
  actual = { id, inicio_ts, origen, fecha: hoyStr(), idUsuario }
  try { await persistence.set(K_TRANSPORTE, actual) } catch (_) { /* la cola igual lo sube */ }
  avisar()
  await enqueueMutacion({
    op_uid: id,
    table: 'tramos_transporte', op: 'insert',
    payload: { id, id_empresa: idEmpresa, id_usuario: idUsuario, inicio_ts, origen },
  })
  flushMutaciones()
  return actual
}

/** Cierra el tramo abierto (si hay). `cierre` es siempre 'manual' desde el teléfono. */
export async function cerrarTransporte(cierre = 'manual') {
  if (!actual) return
  const t = actual
  actual = null
  try { await persistence.set(K_TRANSPORTE, null) } catch (_) { /* idem */ }
  avisar()
  await enqueueMutacion({
    // El uid lleva el verbo: abrir y cerrar el mismo tramo son dos entradas distintas de la cola.
    op_uid: `${t.id}:fin`,
    table: 'tramos_transporte', op: 'update', id: t.id,
    payload: { fin_ts: new Date().toISOString(), cierre },
  })
  flushMutaciones()
}

/** Se llama con el tramo actual (o null) en cada cambio. Devuelve la función para desuscribirse. */
export function suscribirTransporte(fn) {
  oyentes.add(fn)
  return () => oyentes.delete(fn)
}

/** Sólo para pruebas y para el cierre de sesión: olvida el estado local sin escribir en la base. */
export async function resetTransporte() {
  actual = null
  cargado = false
  try { await persistence.set(K_TRANSPORTE, null) } catch (_) { /* nada */ }
  avisar()
}
