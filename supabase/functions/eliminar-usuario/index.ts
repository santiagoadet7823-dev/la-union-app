// eliminar-usuario — Eliminar o Purgar cuentas, sólo superadmin (menú Usuarios v1.5, db/77).
//
// Por qué una Edge Function: borrar de auth.users y crear el perfil marcador "Usuario eliminado"
// necesitan la SERVICE_ROLE key, que nunca puede vivir en el bundle. Mismo patrón de doble cliente
// que crear-usuario: se valida el JWT del que llama (superadmin ACTIVO) y recién ahí se usa la key.
//
// Qué hace por cada ítem {id, modo}:
//   1. Bloquea la propia cuenta y el último superadmin (la función SQL lo vuelve a chequear: la
//      guarda del servidor es la de la base, ésta es para devolver un motivo claro).
//   2. Busca el marcador "Usuario eliminado" de la empresa de esa persona; si no existe, lo crea
//      (auth.admin.createUser con un email .invalid que nadie puede recibir, sin contraseña usable).
//   3. Llama a `_eliminar_usuario`, que en UNA transacción reasigna pedidos, recorridos y visitas
//      al marcador (o borra recorridos y visitas si es purgar) y borra la cuenta de auth.users.
//
// Los ítems se procesan uno por uno y cada uno devuelve su resultado: el menú Usuarios muestra
// "3 de 4 guardados" y deja en el borrador lo que falló.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function marcadorDe(admin: SupabaseClient, idEmpresa: string): Promise<string> {
  const { data: hay, error: errBuscar } = await admin.from('perfiles')
    .select('id').eq('id_empresa', idEmpresa).eq('sistema', true).limit(1).maybeSingle()
  if (errBuscar) throw new Error('marcador: ' + errBuscar.message)
  if (hay?.id) return hay.id

  // El dominio .invalid está reservado (RFC 2606): ningún correo llega nunca ahí. La contraseña
  // es aleatoria y no se guarda: la cuenta no puede usarse para entrar.
  const email = `usuario-eliminado+${idEmpresa}@dist-at.invalid`
  const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID() + crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: 'Usuario eliminado' },
  })
  if (errCrear || !creado?.user) throw new Error('marcador: ' + (errCrear?.message || 'no se pudo crear'))
  const id = creado.user.id
  // Service role: la guarda de perfiles (db/77) no aplica sin auth.uid().
  const { error: errPerfil } = await admin.from('perfiles').update({
    nombre: 'Usuario eliminado', rol: null, activo: false, id_empresa: idEmpresa, sistema: true,
  }).eq('id', id)
  if (errPerfil) {
    await admin.auth.admin.deleteUser(id).catch(() => {})
    throw new Error('marcador: ' + errPerfil.message)
  }
  return id
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)
  try {
    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1) Identidad del que llama, con SU token.
    const authHeader = req.headers.get('Authorization') || ''
    const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: authHeader } } })
    const { data: ud } = await asUser.auth.getUser()
    const uid = ud?.user?.id
    if (!uid) return json({ error: 'no-auth' }, 401)
    const { data: yo } = await asUser.from('perfiles').select('rol, activo').eq('id', uid).maybeSingle()
    if (!yo || !yo.activo) return json({ error: 'sin-perfil' }, 403)
    if (yo.rol !== 'superadmin') return json({ error: 'sin-permiso' }, 403)

    // 2) Payload.
    const body = await req.json().catch(() => ({}))
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length || items.length > 50) return json({ error: 'payload-invalido' }, 400)

    const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
    const resultados: Array<Record<string, unknown>> = []

    for (const it of items) {
      const id = String(it?.id || '')
      const modo = it?.modo === 'purgar' ? 'purgar' : it?.modo === 'eliminar' ? 'eliminar' : null
      if (!UUID_RE.test(id) || !modo) { resultados.push({ id, ok: false, error: 'payload-invalido' }); continue }
      if (id === uid) { resultados.push({ id, modo, ok: false, error: 'propia-cuenta' }); continue }
      try {
        const { data: p, error: errP } = await admin.from('perfiles')
          .select('id, id_empresa, rol, activo, sistema').eq('id', id).maybeSingle()
        if (errP) throw new Error(errP.message)
        if (!p) { resultados.push({ id, modo, ok: false, error: 'no-existe' }); continue }
        if (p.sistema) { resultados.push({ id, modo, ok: false, error: 'perfil-de-sistema' }); continue }
        if (!p.id_empresa) {
          // Un pendiente sin empresa no tiene historia que conservar: se borra la cuenta y listo
          // (la cascada se lleva el perfil). No hace falta marcador.
          const { error: errDel } = await admin.auth.admin.deleteUser(id)
          if (errDel) throw new Error(errDel.message)
          resultados.push({ id, modo, ok: true, detalle: { sinEmpresa: true } })
          continue
        }
        const marcador = await marcadorDe(admin, p.id_empresa)
        const { data: detalle, error: errRpc } = await admin.rpc('_eliminar_usuario', {
          p_id: id, p_purgar: modo === 'purgar', p_marcador: marcador,
        })
        if (errRpc) throw new Error(errRpc.message)
        resultados.push({ id, modo, ok: true, detalle })
      } catch (e) {
        resultados.push({ id, modo, ok: false, error: (e as Error)?.message || 'error-inesperado' })
      }
    }

    return json({ resultados })
  } catch (e) {
    return json({ error: (e as Error)?.message || 'error-inesperado' }, 500)
  }
})
