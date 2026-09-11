// export-pedidos — el endpoint por el que el ERP del cliente se lleva los pedidos para facturar.
// 10/09/2026.
//
// 🩸 POR QUÉ EXISTE. La distribuidora factura y arma la logística desde su sistema de gestión. Hasta
// hoy la única salida era un botón que bajaba un archivo y alguien lo copiaba a mano. Lo que el
// cliente pidió es ejecutar un comando que levante su servidor Java, que le pida los pedidos a esta
// función y escriba `Pedidos.txt` — trayendo SÓLO lo nuevo desde la petición anterior.
//
// CALCADO DE `ingest-precios`, con el sentido invertido:
//   · `verify_jwt: false` — no hay sesión de usuario del otro lado, hay un servidor.
//   · Token opaco en `ingesta_tokens`, validado con service_role.
//   · 🔑 LA REGLA DE ORO: `id_empresa` sale del TOKEN, nunca del request. El cliente no puede pedir
//     los pedidos de otra distribuidora.
//   · `proposito` propio (`pedidos`, db/62): un token de precios no lee la cartera de pedidos. De
//     las tres superficies ésta es la más sensible — expone qué compró cada comercio y a cuánto.
//
// 🔑 EL CURSOR ES UNA MARCA POR FILA, NO UN "MANDAME LO POSTERIOR A T". Está explicado en db/62 y es
// la decisión que sostiene todo esto: el vendedor toma pedidos sin señal y la cola los sube cuando
// aparece, así que un pedido de las 09:00 puede llegar a la base DESPUÉS del lote de las 17:00. Con
// un cursor de tiempo ese pedido no entra en ningún lote nunca, y nadie se entera.
//
// 🩸 ESTA FUNCIÓN NO DECIDE EL FORMATO. El layout de 25 campos vive en `lib/asciiPedidos.js`, el
// MISMO módulo que usa el botón de la app. Escribirlo acá sería la regla 36 de CLAUDE.md: dos
// runtimes con la misma regla, y el día que el ERP cambie una columna uno de los dos emite un
// archivo corrido sin fallar.
//
// ⚠️ `lib/` es una COPIA de `web/src/lib/`. Correr `node scripts/sync-export-pedidos.mjs` antes de
// desplegar. No editar la copia.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { armarAscii, CFG_POR_DEFECTO } from './lib/asciiPedidos.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Los ids se piden de a 100, igual que en la app: un `in` con mil uuid hace explotar la URL de
// PostgREST, y PostgREST además corta en 1.000 filas devolviendo 200 igual, sin ninguna señal.
const LOTE_IDS = 100

const SELECT_PEDIDOS = `id, numero, id_empresa, created_at, estado, monto_total, forma_pago,
  fecha_entrega, observaciones,
  cliente:clientes!pedidos_id_cliente_fkey ( codigo ),
  vendedor:perfiles!pedidos_id_vendedor_fkey ( codigo_erp )`

const SELECT_ITEMS =
  'id_pedido, codigo_producto, descripcion, cantidad, precio_unitario, producto:productos ( codigo )'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // QUIÉN PIDE. Sale de los headers de la CDN y NO del payload, para que el emisor no se pueda
  // renombrar a sí mismo y dos máquinas con el mismo token se distingan (la lección de db/60).
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || null
  const agente = req.headers.get('user-agent') || null

  try {
    const url = new URL(req.url)
    const probar = url.searchParams.get('probar') === '1'
    const repetir = url.searchParams.get('repetir') === '1'
    const lotePedido = url.searchParams.get('lote')
    const latin1 = (url.searchParams.get('enc') || '').toLowerCase() === 'latin1'

    const auth = req.headers.get('authorization') || ''
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
    if (!token) return json({ error: 'sin-token' }, 401)

    // 1) El token → identidad. El request no aporta ni la empresa ni el usuario.
    const { data: tk } = await admin
      .from('ingesta_tokens')
      .select('id_usuario, id_empresa, revocado, proposito')
      .eq('token', token)
      .maybeSingle()
    if (!tk || tk.revocado) return json({ error: 'token-invalido' }, 401)
    if (tk.proposito !== 'pedidos') return json({ error: 'token-sin-permiso-de-pedidos' }, 401)

    /* 🩸 UN PEDIDO RECHAZADO TAMBIÉN DEJA FILA. Es la lección textual de `ingest-precios`: los 400
     * se devolvían antes de llegar a la capa que escribía la bitácora, así que un emisor que fallaba
     * siempre no dejaba una sola marca en la base — y "cero errores registrados" se leía como "está
     * todo bien". No estaba todo bien: había dos máquinas mandando con el mismo token.
     *
     * Va en `catch` propio: si la bitácora falla, el que pide tiene que recibir igual su error.
     *
     * 🩸 Y EL `catch` NO ALCANZABA (11/09/2026). `supabase-js` **no lanza**: devuelve `{ error }`.
     * Así que este try/catch no se ejecutaba nunca y todo fallo de escritura se perdía en silencio
     * — que es literalmente el bug contra el que advierte el párrafo de arriba, cometido en la
     * función que lo escribe. Medido: la tabla estaba VACÍA con 20 pedidos marcados como
     * exportados, y cuatro `duplicate key` en los logs que nadie vio. Ahora el error se lee y se
     * grita por consola; seguir sin propagarlo es correcto (la bitácora no puede tapar la
     * respuesta), pero callarlo no. */
    const registrar = async (fila: Record<string, unknown>) => {
      try {
        const { error } = await admin.from('exportaciones_pedidos').insert({
          id_empresa: tk.id_empresa,
          id_usuario: tk.id_usuario,
          ip,
          agente,
          origen: 'endpoint',
          ...fila,
        })
        if (error) console.error('[export-pedidos] no se pudo registrar en la bitácora:', error.message, fila)
      } catch (e) { console.error('[export-pedidos] excepción al registrar:', String(e)) }
    }

    /* Completa la fila que `tomar_lote_pedidos` YA creó junto con el lote (db/64). Es un update y
     * no un insert: el registro nace en la misma transacción que marca los pedidos, y lo que falta
     * cuando llega hasta acá es sólo lo que la RPC no podía saber — el tamaño del archivo, los
     * renglones emitidos, y quién lo pidió desde qué máquina. */
    const completar = async (loteN: number, fila: Record<string, unknown>) => {
      try {
        const { error } = await admin.from('exportaciones_pedidos')
          .update({ ip, agente, ...fila })
          .eq('id_empresa', tk.id_empresa)
          .eq('lote', loteN)
        if (error) console.error('[export-pedidos] no se pudo completar el lote', loteN, error.message)
      } catch (e) { console.error('[export-pedidos] excepción al completar:', String(e)) }
    }
    const rechazar = async (motivo: string, status: number, extra: Record<string, unknown> = {}) => {
      await registrar({ error: motivo })
      return json({ error: motivo, ...extra }, status)
    }

    // 2) Qué pedidos van en esta respuesta.
    let ids: string[] = []
    let lote: number | null = null

    if (lotePedido || repetir) {
      /* REPONER. Para el caso "la respuesta salió bien pero el archivo se perdió del lado del
       * cliente" (disco lleno, proceso muerto, carpeta equivocada). Sin esto esos pedidos no vuelven
       * NUNCA: el cursor ya avanzó y el layout no tiene forma de pedirlos de nuevo.
       * No mueve el cursor: sale de los ids guardados en la bitácora. */
      let q = admin.from('exportaciones_pedidos')
        .select('lote, ids')
        .eq('id_empresa', tk.id_empresa)
        .not('lote', 'is', null)
      q = lotePedido
        ? q.eq('lote', Number(lotePedido))
        : q.order('lote', { ascending: false })
      const { data } = await q.limit(1).maybeSingle()
      if (!data) return await rechazar('lote-inexistente', 404, { lote: lotePedido || 'ultimo' })
      lote = data.lote
      ids = data.ids || []
    } else {
      /* 🔑 EL LOTE SE TOMA CON UNA RPC QUE MARCA Y DEVUELVE EN UN SOLO STATEMENT (db/62). Un
       * `select` seguido de un `update` tendría una ventana entre los dos, y esa ventana es
       * exactamente el bug que hace que dos ejecuciones del `.bat` se lleven el mismo pedido. */
      const { data, error } = await admin.rpc('tomar_lote_pedidos', {
        p_empresa: tk.id_empresa,
        p_usuario: tk.id_usuario,
        p_marcar: !probar,
      })
      if (error) return await rechazar('tomar-lote', 500, { detalle: error.message })
      ids = (data || []).map((r: { id_pedido: string }) => r.id_pedido)
      lote = data?.[0]?.lote ?? null
      if (probar) lote = null // una prueba no reserva número de lote
    }

    /* 3) Sin novedades. 204 y no un 200 vacío: el script del cliente distingue "no hay nada" de
     * "vino un archivo vacío", y con eso decide NO pisar el `Pedidos.txt` anterior — que podría ser
     * un lote que su ERP todavía no consumió. */
    if (!ids.length) {
      if (!probar && !repetir && !lotePedido) await registrar({ lote: null, pedidos: 0, filas: 0 })
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'X-Pedidos': '0', 'X-Filas': '0' },
      })
    }

    // 4) Los datos. Mismas relaciones y mismo orden que `usePedidos`, para que el archivo del canal
    // automático y el del botón de la app sean el mismo archivo.
    const pedidos: Record<string, unknown>[] = []
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const { data, error } = await admin.from('pedidos')
        .select(SELECT_PEDIDOS)
        .in('id', ids.slice(i, i + LOTE_IDS))
        .order('created_at', { ascending: true })
      if (error) return await rechazar('leer-pedidos', 500, { detalle: error.message })
      for (const p of data || []) {
        const fila = p as Record<string, any>
        pedidos.push({
          ...fila,
          comercio: { codigo: fila.cliente?.codigo || '' },
          codigoVendedor: fila.vendedor?.codigo_erp || null,
        })
      }
    }

    const lineasPorPedido = new Map<string, Record<string, unknown>[]>()
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const { data, error } = await admin.from('pedido_items')
        .select(SELECT_ITEMS)
        .in('id_pedido', ids.slice(i, i + LOTE_IDS))
        .order('descripcion', { ascending: true })
      if (error) return await rechazar('leer-lineas', 500, { detalle: error.message })
      for (const l of data || []) {
        const fila = l as Record<string, any>
        const arr = lineasPorPedido.get(fila.id_pedido) || []
        // El código sale de la LÍNEA (db/62). La relación es respaldo para los pedidos anteriores a
        // la migración; el orden del `||` no es intercambiable.
        arr.push({ ...fila, codigoProducto: fila.codigo_producto || fila.producto?.codigo || null })
        lineasPorPedido.set(fila.id_pedido, arr)
      }
    }

    // 5) Las constantes del layout, de la empresa (db/62). No se escriben en el código: 11 de los 25
    // campos son constantes cuyo significado el cliente todavía no confirmó.
    const { data: emp } = await admin
      .from('empresas').select('export_erp').eq('id', tk.id_empresa).maybeSingle()
    const cfg = { ...CFG_POR_DEFECTO, ...(emp?.export_erp || {}) }

    const { texto, filas, sinLineas } = armarAscii(pedidos, lineasPorPedido, cfg)

    /* La codificación es una de las preguntas abiertas: hoy se manda UTF-8 sin BOM (el archivo del
     * cliente no tiene BOM, y esos tres bytes quedarían pegados adelante del primer campo, que es un
     * número). Si su importador resulta esperar Latin-1, el script del cliente agrega `?enc=latin1`
     * y no hay que desplegar nada. Lo que no entra en Latin-1 se reemplaza por '?': un carácter
     * perdido es mejor que un archivo que el importador rechaza entero. */
    const cuerpo = latin1
      ? Uint8Array.from([...texto].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63)))
      : new TextEncoder().encode(texto)

    /* `sinLineas` cuenta pedidos que NO se emitieron por no tener renglones. La RPC ya los deja
     * fuera del lote, así que debería ser siempre 0: si aparece, es una señal de que algo borró
     * renglones entre que se tomó el lote y se leyeron los datos. */
    const detalle = sinLineas ? `sin-lineas:${sinLineas}` : null
    const reposicion = repetir || !!lotePedido

    if (!probar && !reposicion && lote != null) {
      await completar(lote, { pedidos: pedidos.length, filas, bytes: cuerpo.length, error: detalle })
    }

    /* 🔴 UNA REPOSICIÓN NO ES UN LOTE NUEVO, Y ASÍ ERA COMO SE ROMPÍA TODO. Antes este camino caía
     * en el mismo `registrar({ lote, … })` de arriba e intentaba insertar OTRA fila con el mismo
     * `(id_empresa, lote)` — contra un índice único. Esos son los cuatro `duplicate key` de los
     * logs, y el motivo por el que la bitácora quedaba vacía y el contador de lotes no avanzaba
     * nunca.
     *
     * La re-bajada igual tiene que dejar rastro: es el caso "el archivo se me perdió del lado del
     * cliente", y saber cuántas veces pasó importa. Va como evento con `lote = null`, que el índice
     * no alcanza (es `where lote is not null`), y con su propio `origen` para no confundirlo con la
     * emisión original. */
    if (!probar && reposicion) {
      await registrar({
        lote: null,
        pedidos: pedidos.length,
        filas,
        bytes: cuerpo.length,
        ids,
        origen: 'repeticion',
        error: detalle,
      })
    }

    return new Response(cuerpo, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': `text/plain; charset=${latin1 ? 'iso-8859-1' : 'utf-8'}`,
        'Content-Disposition': 'attachment; filename="Pedidos.txt"',
        // El script del cliente los deja en su registro diario: es el único lugar donde alguien del
        // lado de ellos puede notar que un día no llegó nada.
        'X-Lote': String(lote ?? ''),
        'X-Pedidos': String(pedidos.length),
        'X-Filas': String(filas),
      },
    })
  } catch (e) {
    return json({ error: 'excepcion', detalle: String((e as Error)?.message || e) }, 500)
  }
})
