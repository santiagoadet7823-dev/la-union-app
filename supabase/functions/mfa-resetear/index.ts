// mfa-resetear — un admin/superadmin resetea la 2FA de otra cuenta que perdió el teléfono y
// tampoco tiene (o gastó) sus códigos de recuperación. 29/09/2026 (db/80, Tarea 2.2).
//
// Mismo patrón que crear-usuario / resetear-contrasena: doble cliente (asUser respeta RLS para
// autorizar, admin con service_role recién después de autorizado) y la autorización la hace la
// RLS de `perfiles_sel`, no un IF a mano — si la fila objetivo no aparece con el token del que
// llama, no está autorizado (misma empresa que un admin, o cualquiera si es superadmin).
//
// 🩸 EXIGE aal2 de quien llama, no solo ser admin. Resetear la 2FA de otra cuenta es una acción tan
// sensible como para pedirle a quien la ejecuta que también haya probado tener su propio segundo
// factor — no alcanza con haber iniciado sesión con contraseña nomás.
//
// Deja a la cuenta objetivo sin ningún factor (aal1) y le cierra las sesiones abiertas
// (`cerrar_sesiones_usuario`, db/80): si el motivo fue un teléfono robado, ese teléfono no puede
// seguir usando la sesión vieja mientras la persona reactiva desde uno nuevo. Con un factor
// VERIFICADO, `admin.mfa.deleteFactor` ya cierra sesión sola (documentado), pero se llama la RPC
// igual para cubrir el caso sin factor verificado — típicamente alguien que activó a medias.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function leerAal(authHeader: string): string {
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload.aal || 'aal1'
  } catch (_) { return 'aal1' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)
  try {
    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('Authorization') || ''
    const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: authHeader } } })
    const { data: ud } = await asUser.auth.getUser()
    const uid = ud?.user?.id
    if (!uid) return json({ error: 'no-auth' }, 401)
    const { data: yo } = await asUser.from('perfiles').select('rol, activo').eq('id', uid).maybeSingle()
    if (!yo || !yo.activo) return json({ error: 'sin-perfil' }, 403)
    if (yo.rol !== 'admin' && yo.rol !== 'superadmin') return json({ error: 'sin-permiso' }, 403)
    if (leerAal(authHeader) !== 'aal2') return json({ error: 'requiere-aal2' }, 403)

    const body = await req.json().catch(() => ({}))
    const id = String(body.id || '')
    if (!UUID_RE.test(id)) return json({ error: 'payload-invalido' }, 400)
    if (id === uid) return json({ error: 'propia-cuenta' }, 400) // para la propia: recuperar con código, o reemplazar el factor ya autenticado

    // La fila objetivo con el token del que llama: si perfiles_sel no la deja pasar, no está autorizado.
    const { data: objetivo, error: errObj } = await asUser
      .from('perfiles').select('id, rol, sistema').eq('id', id).maybeSingle()
    if (errObj) return json({ error: errObj.message }, 500)
    if (!objetivo) return json({ error: 'no-existe-o-sin-permiso' }, 404)
    if (objetivo.sistema) return json({ error: 'perfil-de-sistema' }, 400)
    if (objetivo.rol === 'superadmin' && yo.rol !== 'superadmin') return json({ error: 'sin-permiso-superadmin' }, 403)

    const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

    const { data: factores, error: errFactores } = await admin.rpc('listar_factores_mfa', { p_id: id })
    if (errFactores) return json({ error: errFactores.message }, 500)
    // 🩸 Borrar el factor es el propósito central de este endpoint, no un paso secundario: si
    // alguno falla, no se reporta éxito — el admin necesita saber que el reseteo quedó a medias.
    const fallas: string[] = []
    for (const factorId of factores || []) {
      const { error: errDel } = await admin.auth.admin.mfa.deleteFactor({ id: factorId, userId: id })
      if (errDel) fallas.push(factorId)
    }
    if (fallas.length > 0) return json({ error: 'no-se-pudo-completar' }, 500)
    try { await admin.from('mfa_codigos').delete().eq('id_usuario', id) } catch (_) { /* best-effort */ }
    try { await admin.rpc('cerrar_sesiones_usuario', { p_id: id }) } catch (_) { /* best-effort, ver comentario de arriba */ }
    try {
      await admin.from('auditoria_seguridad').insert({ id_usuario: id, id_actor: uid, accion: 'mfa_reseteado_por_admin' })
    } catch (_) { /* la auditoría no puede tumbar el reseteo */ }

    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error)?.message || 'error-inesperado' }, 500)
  }
})
