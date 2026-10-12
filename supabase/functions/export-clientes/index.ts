// export-clientes — el endpoint por el que el ERP del cliente se lleva los clientes nuevos.
// 07/10/2026 (db/86).
//
// 🩸 POR QUÉ EXISTE. Desde esta fecha dist-at da de alta los clientes (con el código correlativo
// libre más bajo, ver db/86) y el ERP los recibe. Su PC baja `Clientes.txt` de acá cada 30 minutos
// con `scripts/cliente/bajar-clientes.ps1`, y su importador lo carga.
//
// CALCADO DE `export-pedidos`, línea por línea. Lo que vale allá vale acá:
//   · `verify_jwt: false` — no hay sesión de usuario del otro lado, hay una tarea programada.
//     🔴 En el servidor propio, además, sumarla a `FUNCTIONS_NO_VERIFY_JWT`
//     (`infra/selfhost/docker-compose.override.yml`) y a `SLUGS` de `cargar_funciones.sh`.
//   · Token opaco en `ingesta_tokens`, validado con service_role.
//   · 🔑 LA REGLA DE ORO: `id_empresa` sale del TOKEN, nunca del request.
//   · `proposito` propio (`clientes`, db/86): un token de pedidos no lee la cartera y viceversa.
//
// 🔑 EL CURSOR ES UNA MARCA POR FILA (`clientes.exportado_ts`), no un "mandame lo posterior a T": un
// cliente creado sin señal a las 09:00 puede llegar a la base después del lote de las 09:30.
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
  vendedor:perfiles!clientes_id_vendedor_fkey ( codigo_erp, numero )`

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

    // 2) Qué clientes van en esta respuesta.
    let ids: string[] = []
    let lote: number | null = null

    if (loteCliente || repetir) {
      /* REPONER: "la respuesta salió bien pero el archivo se perdió del lado del cliente". No mueve
       * el cursor: sale de los ids guardados en la bitácora. */
      let q = admin.from('exportaciones_clientes')
        .select('lote, ids')
        .eq('id_empresa', tk.id_empresa)
        .not('lote', 'is', null)
      q = loteCliente
        ? q.eq('lote', Number(loteCliente))
        : q.order('lote', { ascending: false })
      const { data } = await q.limit(1).maybeSingle()
      if (!data) return await rechazar('lote-inexistente', 404, { lote: loteCliente || 'ultimo' })
      lote = data.lote
      ids = data.ids || []
    } else {
      // 🔑 Marca y devuelve en un solo statement (db/86, calcada de db/62).
      const { data, error } = await admin.rpc('tomar_lote_clientes', {
        p_empresa: tk.id_empresa,
        p_usuario: tk.id_usuario,
        p_marcar: !probar,
      })
      if (error) return await rechazar('tomar-lote', 500, { detalle: error.message })
      ids = (data || []).map((r: { id_cliente: string }) => r.id_cliente)
      lote = data?.[0]?.lote ?? null
      if (probar) lote = null // una prueba no reserva número de lote
    }

    /* 3) Sin novedades: 204 y no un 200 vacío. El script del cliente no pisa el `Clientes.txt`
     * anterior, que podría ser un lote que su ERP todavía no importó. */
    if (!ids.length) {
      if (!probar && !repetir && !loteCliente) await registrar({ lote: null, clientes: 0 })
      return new Response(null, {
        status: 204,
        headers: { ...cors, 'X-Clientes': '0' },
      })
    }

    // 4) Los datos, en el orden de alta (el mismo que devuelve la RPC).
    const orden = new Map(ids.map((id, i) => [id, i]))
    const clientes: Record<string, unknown>[] = []
    for (let i = 0; i < ids.length; i += LOTE_IDS) {
      const { data, error } = await admin.from('clientes')
        .select(SELECT_CLIENTES)
        .in('id', ids.slice(i, i + LOTE_IDS))
      if (error) return await rechazar('leer-clientes', 500, { detalle: error.message })
      for (const c of data || []) clientes.push(c as Record<string, unknown>)
    }
    clientes.sort((a, b) => (orden.get(a.id as string) ?? 0) - (orden.get(b.id as string) ?? 0))

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
