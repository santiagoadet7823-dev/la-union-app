import { supabase, hasSupabase } from '../supabase'
import { persistence } from '../persistence'

/**
 * Cola de ESCRITURAS offline genérica (altas/ediciones). Mismo espíritu que la cola
 * de posiciones, pero para mutaciones de catálogo (clientes, productos, zonas): si
 * no hay red, la operación NO se pierde — se guarda local y se sincroniza al volver
 * la conexión. Usa el puerto `persistence` (async), así en la APK puede pasar a
 * SQLite sin tocar este archivo.
 *
 * Cada mutación: { op_uid, table, op:'insert'|'upsert'|'update'|'updateMany'|'delete'|'borrarArchivos', payload, id?, ids?, onConflict?, verificar? }.
 * - insert:     upsert(onConflict:'id', ignoreDuplicates) → reintentar no duplica.
 * - upsert:     upsert(onConflict) que PISA: crea o reemplaza la fila de esa clave. `payload` puede
 *               ser una fila o un array (UNA entrada para N filas, como `updateMany`). Reintentar
 *               escribe lo mismo otra vez: es idempotente. Lo usa `clientes_fiscal` (db/88).
 * - update:     update(payload).eq('id', id).
 * - updateMany: update(payload).in('id', ids) → UNA entrada para N filas.
 * - delete:     delete().eq('id', id) → reintentar es idempotente (borrar lo ya borrado no falla).
 * - borrarArchivos: Storage, no tabla. `{ bucket, paths[] }` → remove(paths).
 * - verificar (opcional, update/updateMany/delete): pide `.select('id')` y trata CERO filas
 *   afectadas como fallo permanente (`SIN_FILAS`). Ver el 🩸 en el flush.
 * El id de las filas nuevas lo genera el cliente (uuid), así la fila optimista y la
 * de la base comparten el mismo id.
 *
 * 🩸 POR QUÉ EXISTE `updateMany` (28/07/2026): archivar los 195 clientes basura de la importación
 * encolaba 195 entradas de una. Con `MAX = 2000` y `slice(-MAX)`, una acción de lote puede empujar
 * fuera de la ventana mutaciones más VIEJAS todavía sin subir, y se pierden sin un solo aviso —
 * exactamente lo que prohíbe la regla 20 de CLAUDE.md ("nunca borrar de una cola"). Toda acción
 * masiva nueva tiene que entrar por acá, no por un `for` que llame N veces a `enqueueMutacion`.
 */
const KEY = 'lu-write-queue'
const QKEY = 'lu-write-cuarentena'
/** Nombre del evento que se emite en `window` cuando una mutación se aparta a cuarentena. */
export const EVENTO_CUARENTENA = 'lu-write-cuarentena'
const MAX = 2000
const MAX_Q = 500

let flushing = false
let started = false

/**
 * 🩸 CÓDIGOS QUE NO SE ARREGLAN REINTENTANDO — y por qué esto existe (28/08/2026).
 *
 * **Esta cola estuvo TAPONADA DOS DÍAS y nadie se enteró.** El 26/08 a las 15:29:09 una mutación
 * sobre el producto `0218` empezó a devolver **23505** (código duplicado). La cola es FIFO y hacía
 * `if (error) break` para CUALQUIER error, así que a partir de ese segundo **no subió una sola
 * mutación más**: 147 fotos que marketing cargó bien —los archivos estaban en Storage— quedaron sin
 * su `imagen_url`, y la persona las vio desaparecer del catálogo una y otra vez. Medido en los logs:
 * **665 PATCH con 409 en un solo día**, uno cada 30 segundos, contra el mismo id.
 *
 * Es EXACTAMENTE la regla 19 de CLAUDE.md —la lección que la cola de posiciones ya había pagado en
 * julio con 264 puntos atascados— que nunca se aplicó acá. Peor: el bloque de `borrarArchivos` de
 * más abajo ya razonaba sobre este mismo peligro ("un fallo de PERMISO no puede frenar la cola:
 * sería un archivo perdido bloqueando altas y ediciones detrás suyo") y lo resolvía para UNA
 * operación. Para el resto seguía cortando.
 *
 * ⚠️ `23505` no está en la lista de `queue.js` y acá es el que más importa: las posiciones suben con
 * `ignoreDuplicates`, las mutaciones de catálogo no.
 */
const CODIGOS_PERMANENTES = new Set([
  '23505', // unique_violation — el código que ya existe en otro producto (el bug del 26/08)
  '42501', // violación de RLS
  '23514', // check constraint
  '22P02', // sintaxis inválida (uuid/numérico corrupto en la cola)
  '23503', // FK: la fila referenciada ya no existe
  /* 🩸 `P0001` — LA COLA VOLVIÓ A TAPONARSE, Y ESTA VEZ CON PEDIDOS (11/09/2026).
   *
   * Es el SQLSTATE de cualquier `raise exception` de plpgsql, o sea **toda regla de negocio escrita
   * en un trigger**. El caso real: `db/62` agregó el trigger que congela un pedido ya enviado a
   * facturación y, de paso, su backfill marcó como exportados los 20 pedidos que ya existían. El
   * encargado tocó "Anular" sobre uno de ésos, la base contestó `pedido-ya-exportado`, y como P0001
   * no estaba acá la cola lo tomó por transitorio: **22 rechazos en los logs entre las 17:44 y las
   * 21:25, el mismo PATCH cada 30 segundos, en DOS dispositivos a la vez**.
   *
   * Y lo que se llevó puesto no fue la anulación: fueron los **borrados encolados detrás**. La
   * pantalla decía "Pedido borrado definitivamente" y en el servidor no hubo un solo DELETE, porque
   * nunca le llegó el turno. Es la regla 19 otra vez, tercera vez que se paga (GPS en julio,
   * catálogo en agosto, pedidos ahora).
   *
   * Un `raise exception` es una decisión deliberada del otro lado: reintentarlo mil veces no lo
   * vuelve cierto. */
  'P0001', // raise exception de plpgsql — una regla de negocio dijo que no
  /* 🩸 `SIN_FILAS` — NO ES UN CÓDIGO DE POSTGRES, LO PONE ESTA COLA (13/09/2026).
   *
   * Un UPDATE o DELETE sobre una fila que la RLS esconde **no da error**: afecta cero filas y vuelve
   * con 200. La cola lo daba por subido, y la pantalla mostraba "listo" sobre algo que no pasó. La
   * defensa hasta hoy era RELEER la lista entera de pedidos después de cada acción (dos consultas
   * paginadas, con spinner, y sin red la lista quedaba vacía). Ahora las mutaciones que lo piden
   * (`verificar: true`) hacen `.select('id')` sobre el mismo request, y cero filas se aparta a
   * cuarentena como cualquier rechazo: reintentarlo daría cero otra vez. */
  'SIN_FILAS', // el servidor aceptó y no tocó ninguna fila (RLS la esconde, o ya no existe)
])

/**
 * 🩸 EL TOPE QUE HACE FALTA DE VERDAD (11/09/2026).
 *
 * La lista de arriba es una lista de códigos CONOCIDOS, y por definición el que tapona la cola es
 * siempre el que todavía no está en ella: 23505 en agosto, P0001 ahora. Catalogar de a uno es ir
 * siempre un incidente atrás.
 *
 * Así que además del catálogo hay un techo: una mutación que el servidor rechazó 20 veces se aparta,
 * diga lo que diga el código. Con un flush cada 30 s y otro en cada vuelta a primer plano, 20
 * rechazos **con respuesta del servidor** no son un problema de red, son un problema del dato.
 *
 * 🔴 Y ACÁ ESTÁ LA PARTE DELICADA: sólo cuentan los fallos en los que **el servidor contestó**
 * (`error.code` no vacío = viene de PostgREST). Un `Failed to fetch` NO suma. Si sumara, un vendedor
 * diez minutos sin señal en el campo vería sus pedidos irse a cuarentena por estar offline — que es
 * exactamente el desastre que esta cola existe para evitar. Sin red no se llega nunca al tope.
 */
const MAX_INTENTOS = 20

/** Nombre del evento que se emite en `window` cuando una mutación NO se pudo ni anotar. */
export const EVENTO_ESCRITURA_PERDIDA = 'lu-write-perdida'

/** Evento que se emite cuando el servidor le dio número a un pedido: `detail = { id, numero }`. */
export const EVENTO_PEDIDO_NUMERADO = 'lu-pedido-numerado'
const NKEY = 'lu-pedidos-numero'
const MAX_N = 300

/**
 * 🩸 EL CANDADO QUE FALTABA — Y POR QUÉ SE PERDÍAN PEDIDOS EN LA CALLE (22/10/2026, plan 19).
 *
 * Encolar y vaciar son leer → modificar → escribir sobre la MISMA clave, con un `await` de SQLite
 * en el medio. Sin exclusión, dos que se cruzan se pisan: el vaciado lee [A, B], el check-in lee
 * [A, B] y escribe [A, B, C], el vaciado escribe [B] → **C desapareció**. Lo mismo dos encolados
 * seguidos (`startVisit` encola la visita y el `updateCliente` del comercio casi a la vez).
 *
 * Medido en el log del servidor del 13 al 22/10: 39 altas de visita que nunca llegaron (1, 5, 8 y
 * 24 por día) y 27 pedidos rechazados por apuntar a esas visitas — que la cola mandó a cuarentena
 * sin que el vendedor se enterara. Más uso, más cruces: por eso crecía día a día.
 *
 * Todo leer→escribir de la cola y de la cuarentena pasa por acá, en fila. El request de red queda
 * AFUERA: con mala señal tarda 10 s, y encolar un pedido no puede esperar a eso.
 * 🔴 No anidar `enSerie` adentro de `enSerie`: el de adentro espera al de afuera, que espera al de
 * adentro.
 */
let cadena = Promise.resolve()
function enSerie(fn) {
  const r = cadena.then(fn)
  cadena = r.catch(() => {})
  return r
}

// Estricta: si la cola existe y no se pudo leer, LANZA. Devolver `[]` hacía que el próximo encolado
// escribiera `[nueva]` encima de la cola entera (ver `persistence.getEstricto`).
async function read() { return (await persistence.getEstricto(KEY, [])) || [] }

/** Saca la cabeza de la cola si sigue siendo `m` (en serie). */
function quitarCabeza(m) {
  return enSerie(async () => {
    const q = await read()
    if (q.length && q[0].op_uid === m.op_uid) await write(q.slice(1))
  })
}
/**
 * 🔴 SI LA COLA NO SE PUDO GUARDAR, SE DICE (18/09/2026). `persistence.set` devolvía `undefined`
 * pasara lo que pasara, y el 18/09 el `localStorage` de la PC de la oficina se llenó con las
 * cachés: cada asignación de zona desde las 11:25 quedó en pantalla y no llegó a la base — ni
 * request, ni error, ni cuarentena. `persistence` ahora desaloja cachés antes de fallar; si aun
 * así no entra, esto lanza, y la pantalla que encoló recibe el error en vez de un `ok: true`.
 */
async function write(arr) {
  const ok = await persistence.set(KEY, arr.length > MAX ? arr.slice(-MAX) : arr)
  if (ok === false) {
    try { window.dispatchEvent(new CustomEvent(EVENTO_ESCRITURA_PERDIDA, { detail: { pendientes: arr.length } })) } catch (_) { /* sin window */ }
    const e = new Error('No hay espacio en el navegador para guardar el cambio. Cerrá otras pestañas de la app o borrá los datos del sitio y volvé a intentar.')
    e.code = 'almacenamiento-lleno'
    throw e
  }
}

async function leerCuarentena() { return (await persistence.get(QKEY, [])) || [] }

/**
 * Aparta una mutación que no va a entrar nunca, para que la cola siga.
 *
 * 🩸 SE AÍSLA, NO SE BORRA (regla 20). El bundle 1.5.26 borró 264 puntos reales por hacer justo lo
 * contrario. Una mutación trabada es recuperable —se puede leer, entender y reaplicar a mano—; una
 * borrada no, y encima se lleva puesta la edición de alguien sin dejar rastro de qué era.
 */
async function aislar(m, motivo) {
  const marcada = { ...m, _motivo: motivo, _aislado_en: new Date().toISOString() }
  // En serie y con lectura estricta: una cuarentena que no se pudo leer no se pisa con `[marcada]`.
  // Si falla, lanza: la mutación queda al frente de la cola y el próximo flush la vuelve a aislar.
  const q = await enSerie(async () => {
    let c = ((await persistence.getEstricto(QKEY, [])) || []).concat([marcada])
    if (c.length > MAX_Q) c = c.slice(-MAX_Q)
    try { await persistence.set(QKEY, c) } catch (_) { /* si no entra, ya estaba trabada igual */ }
    return c
  })
  console.warn(`[writeQueue] mutación a CUARENTENA (${motivo}):`, m.op, m.table, m.id, '· en cuarentena:', q.length)
  // Aviso para las pantallas que aplicaron la mutación en local sin releer (usePedidos, 13/09/2026):
  // lo que mostraron ya no es lo que hay en la base, y tienen que revalidar. Es un evento del
  // documento y no un callback registrado porque la cola no sabe quién está montado.
  try { window.dispatchEvent(new CustomEvent(EVENTO_CUARENTENA, { detail: { table: m.table, op: m.op, id: m.id, motivo } })) } catch (_) { /* sin window (tests, SSR) */ }
}

/**
 * Ejecuta la consulta y devuelve su `error` (o null). Con `m.verificar`, pide las filas afectadas
 * y convierte "ninguna" en el error sintético `SIN_FILAS` (ver CODIGOS_PERMANENTES). Sin el flag,
 * es exactamente el request de siempre: ninguna op de catálogo cambia de comportamiento.
 */
async function conVerificacion(m, consulta) {
  if (!m.verificar) {
    const { error } = await consulta
    return error || null
  }
  const { data, error } = await consulta.select('id')
  if (error) return error
  if (!Array.isArray(data) || data.length === 0) {
    return { code: 'SIN_FILAS', message: `${m.op} sobre ${m.table} no afectó ninguna fila (RLS, o la fila ya no existe)` }
  }
  return null
}

/** Encola una mutación para sincronizar. Lanza si no se pudo anotar: quien encola tiene que saberlo. */
export function enqueueMutacion(mut) {
  return enSerie(async () => {
    const q = await read()
    q.push(mut)
    await write(q)
  })
}

/** Anota el número que el servidor le dio a un pedido y avisa a las pantallas. */
async function anotarNumero(id, numero) {
  if (!id || !numero) return
  try {
    const mapa = (await persistence.get(NKEY, {})) || {}
    mapa[id] = numero
    const claves = Object.keys(mapa)
    if (claves.length > MAX_N) for (const k of claves.slice(0, claves.length - MAX_N)) delete mapa[k]
    await persistence.set(NKEY, mapa)
  } catch (_) { /* el número igual está en la base; esto es solo para el ticket */ }
  try { window.dispatchEvent(new CustomEvent(EVENTO_PEDIDO_NUMERADO, { detail: { id, numero } })) } catch (_) { /* sin window */ }
}

/** El número que el servidor ya le dio a un pedido de este teléfono, o null si todavía no subió. */
export async function numeroDePedido(id) {
  try { return ((await persistence.get(NKEY, {})) || {})[id] || null } catch (_) { return null }
}

/**
 * Espera hasta `ms` a que el servidor numere el pedido `id`. Devuelve el número o null (sin señal,
 * o la cola tenía cosas delante). Nunca inventa uno: si vuelve null, el ticket dice PENDIENTE.
 */
export function esperarNumero(id, ms = 8000) {
  return new Promise((resolve) => {
    let listo = false
    const fin = (n) => {
      if (listo) return
      listo = true
      clearTimeout(t)
      clearInterval(iv)
      try { window.removeEventListener(EVENTO_PEDIDO_NUMERADO, oir) } catch (_) { /* sin window */ }
      resolve(n || null)
    }
    const oir = (e) => { if (e?.detail?.id === id) fin(e.detail.numero) }
    const mirar = () => numeroDePedido(id).then((n) => { if (n) fin(n) })
    const t = setTimeout(() => fin(null), ms)
    // El evento es lo rápido; mirar lo anotado cada segundo es el respaldo si el evento se perdió.
    const iv = setInterval(mirar, 1000)
    try { window.addEventListener(EVENTO_PEDIDO_NUMERADO, oir) } catch (_) { /* sin window */ }
    mirar()
  })
}

/** Sube las mutaciones pendientes en orden (FIFO). Corta al primer fallo/sin red. */
export async function flushMutaciones() {
  if (!hasSupabase || flushing) return
  // NOTA: NO cortar por `navigator.onLine === false`. En algunos WebView de la APK ese flag
  // queda mal (reporta offline estando conectado) y bloqueaba TODAS las mutaciones (altas/
  // ediciones de catálogo) estando la red OK. Si no hay red, el request falla y se reintenta
  // igual — el guard sobra y era una fuente de "no sincroniza nada". Igual criterio que queue.js.
  flushing = true
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const q = await enSerie(read)
      if (!q.length) break
      const m = q[0]
      let error = null
      if (m.op === 'insert') {
        ({ error } = await supabase.from(m.table).upsert(m.payload, { onConflict: 'id', ignoreDuplicates: true }))
      } else if (m.op === 'upsert') {
        /* A diferencia de `insert`, NO ignora el duplicado: la segunda carga del CUIT de un cliente
         * tiene que reemplazar a la primera (22/10/2026, plan 20). Sólo viajan las columnas del
         * payload, así que una columna que no se mandó no se pisa con NULL. */
        ({ error } = await supabase.from(m.table).upsert(m.payload, { onConflict: m.onConflict || 'id' }))
      } else if (m.op === 'rpc') {
        /* Una función de la base en UN request (22/10/2026). La primera es `registrar_pedido`
         * (db/87): cabecera + renglones en una transacción, idempotente por id, y devuelve el número
         * que el ticket muestra. Sin red falla como cualquier request y se reintenta igual. */
        const { data, error: eRpc } = await supabase.rpc(m.fn, m.args || {})
        error = eRpc || null
        if (!error && m.fn === 'registrar_pedido') await anotarNumero(m.args?.p_pedido?.id, data)
      } else if (m.op === 'update') {
        error = await conVerificacion(m, supabase.from(m.table).update(m.payload).eq('id', m.id))
      } else if (m.op === 'updateMany') {
        // Sin ids no hay nada que hacer, y `.in('id', [])` es un no-op caro: se descarta.
        if (Array.isArray(m.ids) && m.ids.length) {
          error = await conVerificacion(m, supabase.from(m.table).update(m.payload).in('id', m.ids))
        }
      } else if (m.op === 'delete') {
        error = await conVerificacion(m, supabase.from(m.table).delete().eq('id', m.id))
      } else if (m.op === 'borrarArchivos') {
        /* 🩸 LA FOTO NO SE BORRABA NUNCA (18/08/2026). `deleteProducto` encolaba el DELETE de la
         * fila y no tocaba Storage, así que cada producto eliminado dejaba su imagen para siempre.
         * Medido el 18/08: **626 fotos huérfanas (13 MB) contra 0 productos**.
         *
         * Va por la cola y no por un `await` suelto en el contexto porque las mutaciones de
         * catálogo van SIEMPRE por acá (es regla del repo): si se borra un producto sin red, el
         * DELETE de la fila se encola y la foto tiene que seguir el mismo camino. Si no, la fila
         * se va al reconectar y el archivo queda huérfano igual — el bug, con más pasos.
         *
         * ⚠️ IDEMPOTENTE Y SIN TAPONAR: `remove()` sobre algo que ya no está **no es error** en la
         * API de Storage, así que un reintento pasa limpio. Y un fallo de PERMISO tampoco puede
         * frenar la cola: sería un archivo perdido bloqueando altas y ediciones de catálogo detrás
         * suyo, que es mucho peor que la foto que quedó. Por eso el error se anota y NO se propaga
         * (la cola corta al primer `error` no nulo, ver el `if (error) break` de abajo).
         */
        const { error: eStorage } = await supabase.storage.from(m.bucket).remove(m.paths || [])
        if (eStorage) console.warn('[writeQueue] no se pudo borrar el archivo', m.paths, eStorage.message)
      } else {
        // Op desconocida. Se descarta igual (si no, tapona la cola para siempre), pero se GRITA:
        // el caso real es un APK que revierte a un bundle OTA anterior y se encuentra con
        // mutaciones encoladas por una versión más nueva. Antes esto pasaba en absoluto silencio.
        console.error('[writeQueue] operación desconocida, se descarta', m)
      }
      /* 🩸 ACÁ ESTABA EL `if (error) break` A SECAS, y costó dos días de fotos (28/08/2026).
       *
       * Un error TRANSITORIO (sin red, timeout, 5xx) se corta y se reintenta: no se pierde nada y
       * el orden se respeta. Uno PERMANENTE no se arregla nunca, y dejarlo al frente de una cola
       * FIFO **bloquea todo lo que venga detrás para siempre** — que es literalmente lo que pasó.
       *
       * La diferencia importa más de lo que parece: el síntoma no es "falla", es "se guardó y
       * después desapareció". La persona ve la foto en pantalla (el merge optimista ya la puso),
       * cierra, vuelve, y no está. Y el servidor no muestra nada raro: sólo un PATCH que reintenta.
       */
      if (error) {
        if (CODIGOS_PERMANENTES.has(error.code)) {
          await aislar(m, `${error.code}: ${error.message}`)
          await quitarCabeza(m)
          continue // la cola SIGUE con la próxima
        }
        /* El servidor contestó, pero con un error que no está catalogado. Se cuenta. Un
         * `Failed to fetch` no trae `code` y por lo tanto no suma: sin red no se llega al tope. */
        const contestoElServidor = !!error.code
        if (contestoElServidor) {
          const intentos = (m._intentos || 0) + 1
          if (intentos >= MAX_INTENTOS) {
            await aislar(m, `${error.code}: ${error.message} (${intentos} intentos)`)
            await quitarCabeza(m)
            continue // la cola SIGUE: el techo cumplió su función
          }
          await enSerie(async () => {
            const qi = await read()
            if (qi.length && qi[0].op_uid === m.op_uid) {
              qi[0] = { ...qi[0], _intentos: intentos }
              await write(qi)
            }
          })
        }
        break // transitorio: se reintenta en el próximo flush, sin perder el orden
      }
      // Re-leer adentro del candado: lo que se encoló mientras volaba el request queda.
      await quitarCabeza(m)
    }
  } catch (_) {
    /* sin red: las mutaciones quedan encoladas */
  } finally {
    flushing = false
  }
}

/** Cantidad de mutaciones pendientes (para diagnóstico/estado). */
export async function pendingMutaciones() { return ((await persistence.get(KEY, [])) || []).length }

/**
 * Las mutaciones aisladas, para poder MOSTRARLAS y decidir qué hacer con ellas.
 *
 * 🩸 No alcanza con aislar: hay que **verlo**. El taponamiento del 26/08 duró dos días porque no
 * había ningún número que mirar — la persona cargaba fotos, la pantalla decía que sí, y nadie tenía
 * forma de saber que nada estaba subiendo. Una cola que se cura sola y en silencio sigue siendo una
 * cola que miente, sólo que más despacio.
 */
export async function cuarentenaMutaciones() { return await leerCuarentena() }

/** Vacía la cuarentena. Sólo para después de haber MIRADO qué había (regla 20). */
export function limpiarCuarentena() { return enSerie(() => persistence.set(QKEY, [])) }

/**
 * 🩸 RESCATE: VUELVE A ENCOLAR, UNA SOLA VEZ, LO QUE LA CUARENTENA TIENE Y YA PUEDE ENTRAR (22/10/2026).
 *
 * Los 27 pedidos de la calle quedaron aislados por un 23503 (su visita se había perdido). Desde
 * db/87 la base crea la visita que falta, así que el mismo pedido ahora entra. `debeVolver(m)`
 * decide qué vuelve; lo que vuelve se marca `_rescatado` y sale de la cuarentena — si vuelve a
 * rebotar, `aislar` lo trae de nuevo, con la marca, y no se reintenta más (no hay ciclo).
 * Va al FINAL de la cola y en orden de dependencia: visitas → pedidos → renglones (la policy
 * `items_ins` exige el pedido padre). Cola y cuarentena se reescriben en el mismo turno del candado.
 * Devuelve cuántas volvieron.
 *
 * `forzar` (25/10/2026, plan 23): el botón "Reintentar envío" lo pide una PERSONA, así que vuelve
 * también lo ya marcado `_rescatado`. No hay ciclo: cada vuelta la dispara un toque.
 */
const ORDEN_RESCATE = { visitas: 0, pedidos: 1, pedido_items: 2 }
export function reencolarCuarentena(debeVolver, { forzar = false } = {}) {
  return enSerie(async () => {
    const cuar = (await persistence.getEstricto(QKEY, [])) || []
    const vuelven = cuar.filter((m) => (forzar || !m._rescatado) && debeVolver(m))
    if (!vuelven.length) return 0
    const quedan = cuar.filter((m) => !vuelven.includes(m))
    const ordenadas = vuelven
      .map((m, i) => ({ m, i }))
      .sort((a, b) => ((ORDEN_RESCATE[a.m.table] ?? 9) - (ORDEN_RESCATE[b.m.table] ?? 9)) || (a.i - b.i))
      .map(({ m }) => {
        const { _motivo, _aislado_en, _intentos, ...limpia } = m
        return { ...limpia, _rescatado: { motivo: _motivo || null, aislado_en: _aislado_en || null } }
      })
    const q = await read()
    await write(q.concat(ordenadas))
    await persistence.set(QKEY, quedan)
    return ordenadas.length
  })
}

/**
 * Las mutaciones pendientes de UNA tabla, para poder MOSTRARLAS.
 *
 * 🩸 Existe por "Mis pedidos" (20/08/2026). Un vendedor sin señal confirma un pedido, entra a
 * revisarlo y —si la lista saliera solo de Supabase— no lo encuentra: la fila todavía está acá,
 * esperando red. Que no aparezca se lee como "se perdió", que es justo lo contrario de lo que la
 * cola garantiza. Una pantalla que no puede ver la cola tiene que mentir sobre ella.
 *
 * Devuelve los payloads crudos, no filas de la base: quien las muestre tiene que marcarlas como
 * "sin subir" y no mezclarlas de callado con lo confirmado.
 */
export async function pendientesDe(table, op = 'insert') {
  const q = (await persistence.get(KEY, [])) || [] // solo para mostrar: no hace falta la estricta
  const out = []
  for (const m of q) {
    if (m.table === table && m.op === op) out.push(m.payload)
    // Desde la 1.44.3 el pedido viaja como `registrar_pedido` (cabecera + renglones en una sola
    // mutación). Para quien lo muestra sigue siendo un alta de `pedidos` y otra de `pedido_items`.
    else if (op === 'insert' && m.op === 'rpc' && m.fn === 'registrar_pedido') {
      if (table === 'pedidos' && m.args?.p_pedido) out.push(m.args.p_pedido)
      if (table === 'pedido_items' && m.args?.p_items) out.push(m.args.p_items)
    }
  }
  return out
}

/**
 * Arranca el auto-flush (una sola vez): al volver a primer plano, al recuperar red y cada 30 s.
 *
 * 🩸 FALTABA `visibilitychange`, Y ES EL DISPARADOR QUE MÁS IMPORTA (10/09/2026). La cola de GPS
 * (`queue.js:230-236`) lo tiene desde siempre y su propio comentario lo llama "el disparador
 * clave"; `INFORME_AUDITORIA.md` dice "las dos colas" — pero ésta se había quedado con la mitad.
 *
 * Por qué es el que importa: en segundo plano el WebView de Android CONGELA los timers y no
 * entrega el evento `online`. O sea que los otros dos disparadores no corren justo durante lo que
 * pasa de verdad en la calle — el teléfono en el bolsillo, entrando y saliendo de cobertura. El
 * momento en que hay red Y la app puede ejecutar código es exactamente cuando el vendedor la
 * vuelve a mirar, y ese momento es este evento.
 *
 * Sin esto, un pedido tomado sin señal esperaba al primer `setInterval` que el sistema dejara
 * correr, que podía ser mucho después de que hubiera red.
 */
export function startWriteQueue() {
  if (started || typeof window === 'undefined') return
  started = true
  flushMutaciones()
  window.addEventListener('online', () => flushMutaciones())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flushMutaciones()
  })
  setInterval(() => flushMutaciones(), 30000)
}
