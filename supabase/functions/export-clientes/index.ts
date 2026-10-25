// export-clientes — el endpoint por el que el ERP del cliente se lleva altas, modificaciones y bajas.
// 07/10/2026 (db/86, nunca aplicada) → 25/10/2026 (db/92, plan 24).
//
// 🩸 POR QUÉ EXISTE. DisT-At da de alta los clientes (el código lo asigna el servidor, ver db/92) y el
// ERP de La Unión lee SOLO lo que le mandamos. Su PC baja `Clientes.txt` de acá cada 30 minutos con
// `scripts/cliente/bajar-clientes.ps1`, y su importador hace upsert por código.
//
// CALCADO DE `export-pedidos`, línea por línea. Lo que vale allá vale acá:
//   · `verify_jwt: false` — no hay sesión de usuario del otro lado, hay una tarea programada.
//     🔴 En el servidor propio, además, sumarla a `FUNCTIONS_NO_VERIFY_JWT`
//     (`infra/selfhost/docker-compose.override.yml`) y a `SLUGS` de `cargar_funciones.sh`.
//   · Token opaco en `ingesta_tokens`, validado con service_role.
//   · 🔑 LA REGLA DE ORO: `id_empresa` sale del TOKEN, nunca del request.
//   · `proposito` propio (`clientes`, db/92): un token de pedidos no lee la cartera y viceversa.
//
// 🔑 EL CURSOR ES UNA VERSIÓN POR FILA (db/92, 25/10/2026): `export_version` sube con cada cambio de
// un dato que viaja y `export_enviada` es la que se llevó el ERP. No es un "mandame lo posterior a
// T": un cliente creado sin señal a las 09:00 puede llegar a la base después del lote de las 09:30.
// Cada fila del archivo es el estado completo + ALTA / MODIFICACION / BAJA (lo decide la RPC). Las
// bajas de clientes BORRADOS salen de las lápidas (`clientes_export_bajas`).
//
// 🩸 ESTA FUNCIÓN NO DECIDE EL FORMATO. Vive en `lib/asciiClientes.js`.
//
// ⚠️ `lib/` es una COPIA de `web/src/lib/`. Correr `node scripts/sync-export-clientes.mjs` antes de
// desplegar. No editar la copia.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { armarClientes } from './lib/asciiClientes.js'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// De a 100, como en `export-pedidos`: un `in` con mil uuid hace explotar la URL de PostgREST.
const LOTE_IDS = 100

const SELECT_CLIENTES = `id, codigo, nombre_comercio, localidad, telefono, contacto, lat, lng,
  creado_ts, created_at,
  vendedor:perfiles!clientes_id_vendedor_fkey ( codigo_erp, numero ),
  fiscal:clientes_fiscal ( condicion_iva, cuit )`
// `fiscal` (db/88, plan 20): la PK de `clientes_fiscal` es `id_cliente`, así que PostgREST lo trae
// como objeto (o null si el cliente no tiene datos fiscales), no como array.

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // QUIÉN PIDE. De los headers de la CDN y NO del payload (la lección de db/60).
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || null
  const agente = req.headers.get('user-agent') || null

  try {
    const url = new URL(req.url)
    const probar = url.searchParams.get('probar') === '1'
    const repetir = url.searchParams.get('repetir') === '1'
    const loteCliente = url.searchParams.get('lote')
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
    if (tk.proposito !== 'clientes') return json({ error: 'token-sin-permiso-de-clientes' }, 401)

    /* 🩸 UN PEDIDO RECHAZADO TAMBIÉN DEJA FILA, y `supabase-js` NO LANZA: devuelve `{ error }`. Las
     * dos lecciones de `export-pedidos` (11/09/2026), juntas: se lee el error y se grita por consola,
     * pero la bitácora nunca tapa la respuesta al que pide. */
    const registrar = async (fila: Record<string, unknown>) => {
      try {
        const { error } = await admin.from('exportaciones_clientes').insert({
          id_empresa: tk.id_empresa,
          id_usuario: tk.id_usuario,
          ip,
          agente,
          origen: 'endpoint',
          ...fila,
        })
        if (error) console.error('[export-clientes] no se pudo registrar en la bitácora:', error.message, fila)
      } catch (e) { console.error('[export-clientes] excepción al registrar:', String(e)) }
    }

    // Completa la fila que `tomar_lote_clientes` YA creó junto con el lote (patrón de db/64).
    const completar = async (loteN: number, fila: Record<string, unknown>) => {
      try {
        const { error } = await admin.from('exportaciones_clientes')
          .update({ ip, agente, ...fila })
          .eq('id_empresa', tk.id_empresa)
          .eq('lote', loteN)
        if (error) console.error('[export-clientes] no se pudo completar el lote', loteN, error.message)
      } catch (e) { console.error('[export-clientes] excepción al completar:', String(e)) }
    }
    const rechazar = async (motivo: string, status: number, extra: Record<string, unknown> = {}) => {
      await registrar({ error: motivo })
      return json({ error: motivo, ...extra }, status)
    }

    // 2) Qué va en esta respuesta: una fila por cliente o lápida, ya en el orden del archivo.
    type Fila = { id_cliente: string | null; id_baja: number | null; tipo: string; lote: number }
    let filasLote: Fila[] = []
    let lote: number | null = null

    if (loteCliente || repetir) {
      /* REPONER: "la respuesta salió bien pero el archivo se perdió del lado del cliente". No mueve
       * el cursor: sale de lo guardado en la bitácora, con el estado ACTUAL de cada cliente. */
      const { data, error } = await admin.rpc('repetir_lote_clientes_json', {
        p_empresa: tk.id_empresa,
        p_lote: loteCliente ? Number(loteCliente) : null,
      })
      if (error) return await rechazar('repetir-lote', 500, { detalle: error.message })
      if (!data?.length) return await rechazar('lote-inexistente', 404, { lote: loteCliente || 'ultimo' })
      filasLote = data
      lote = data[0].lote
    } else {
      /* 🔑 Marca y devuelve en una sola transacción (db/92, calcada de db/62).
       * 🩸 La versión `_json` (db/93): la `returns table` pasaba por el `max-rows` de PostgREST (1000)
       * y el primer lote (2029) quedaba marcado entero pero llegaba cortado. */
      const { data, error } = await admin.rpc('tomar_lote_clientes_json', {
        p_empresa: tk.id_empresa,
        p_usuario: tk.id_usuario,
        p_marcar: !probar,
      })
      if (error) return await rechazar('tomar-lote', 500, { detalle: error.message })
      filasLote = data || []
      lote = filasLote[0]?.lote ?? null
      if (probar) lote = null // una prueba no reserva número de lote
    }

    const ids = filasLote.filter((f) => f.id_cliente).map((f) => f.id_cliente as string)
    const bajas = filasLote.filter((f) => f.id_baja != null).map((f) => f.id_baja as number)

    /* 3) Sin novedades: 204 y no un 200 vacío. El script del cliente no pisa el `Clientes.txt`
     * anterior, que podría ser un lote que su ERP todavía no importó. */
    if (!filasLote.length) {
      if (!probar && !repetir && !loteCliente) await registrar({ lote: null, clientes: 0 })
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'X-Clientes': '0' },
      })
    }

    // 4) Los datos. Se arman en el orden de la RPC: primero las lápidas, después por hora de alta.
    const porId = new Map<string, Record<string, unknown>>()
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const { data, error } = await admin.from('clientes')
        .select(SELECT_CLIENTES)
        .in('id', ids.slice(i, i + LOTE_IDS))
      if (error) return await rechazar('leer-clientes', 500, { detalle: error.message })
      for (const c of data || []) porId.set(c.id as string, c as Record<string, unknown>)
    }
    const lapidas = new Map<number, Record<string, unknown>>()
    for (let i = 0; i < bajas.length; i += LOTE_IDS) {
      const { data, error } = await admin.from('clientes_export_bajas')
        .select('id, codigo, nombre_comercio')
        .in('id', bajas.slice(i, i + LOTE_IDS))
      if (error) return await rechazar('leer-bajas', 500, { detalle: error.message })
      for (const b of data || []) lapidas.set(b.id as number, b as Record<string, unknown>)
    }
    const clientes = filasLote
      .map((f) => {
        const base = f.id_cliente ? porId.get(f.id_cliente) : lapidas.get(f.id_baja as number)
        return base ? { ...base, tipo: f.tipo } : null
      })
      .filter((c): c is Record<string, unknown> => c !== null)

    // 5) La zona horaria de la empresa, del mismo `export_erp` que usa el archivo de pedidos.
    const { data: emp } = await admin
      .from('empresas').select('export_erp').eq('id', tk.id_empresa).maybeSingle()

    const { texto, filas } = armarClientes(clientes, emp?.export_erp || null)

    // Misma decisión que `export-pedidos`: UTF-8 sin BOM, y Latin-1 a pedido del script.
    const cuerpo = latin1
      ? Uint8Array.from([...texto].map((c) => (c.charCodeAt(0) < 256 ? c.charCodeAt(0) : 63)))
      : new TextEncoder().encode(texto)

    const reposicion = repetir || !!loteCliente

    if (!probar && !reposicion && lote != null) {
      await completar(lote, { clientes: filas, bytes: cuerpo.length })
    }

    // 🔴 Una reposición NO es un lote nuevo: va como evento con `lote = null` (el índice único es
    // `where lote is not null`), con su propio `origen`. Ver el mismo bloque en `export-pedidos`.
    if (!probar && reposicion) {
      await registrar({
        lote: null,
        clientes: filas,
        bytes: cuerpo.length,
        ids,
        bajas,
        origen: 'repeticion',
      })
    }

    return new Response(cuerpo, {
      status: 200,
      headers: {
        ...cors,
        'Content-Type': `text/plain; charset=${latin1 ? 'iso-8859-1' : 'utf-8'}`,
        'Content-Disposition': 'attachment; filename="Clientes.txt"',
        'X-Lote': String(lote ?? ''),
        'X-Clientes': String(filas),
      },
    })
  } catch (e) {
    return json({ error: 'excepcion', detalle: String((e as Error)?.message || e) }, 500)
  }
})
