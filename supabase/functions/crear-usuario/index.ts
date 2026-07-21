// crear-usuario — alta manual de usuarios por un admin / superadmin.
//
// Por qué una Edge Function y no una query desde el front: crear un usuario en
// auth.users requiere la SERVICE_ROLE key (auth.admin.createUser), que NUNCA puede
// vivir en el bundle del cliente. Acá corre server-side con esa key, pero antes
// valida contra el JWT del que llama que sea admin/superadmin ACTIVO — el mismo
// patrón de doble cliente (asUser + admin) que snap-recorridos.
//
// Reglas de escalada (se validan en el servidor, no se confía en el front):
//   - admin: solo crea en SU empresa y solo roles operativos (no superadmin).
//   - superadmin: elige empresa y cualquier rol.
// El alta es SIN confirmación de mail (email_confirm:true): el gate real de esta
// app no es el mail, es la aprobación (rol + activo), que acá ya queda seteada.
//
// El trigger handle_new_user inserta el perfil (rol=null, activo=false) al crearse
// el usuario; después lo actualizamos con el rol/empresa definitivos.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const ROLES_ADMIN = ['vendedor', 'repartidor', 'encargado', 'admin']
const ROLES_SUPER = [...ROLES_ADMIN, 'superadmin']
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)
  try {
    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // 1) Identidad y rol del que llama, con SU token (respeta RLS).
    const authHeader = req.headers.get('Authorization') || ''
    const asUser = createClient(SB_URL, ANON, { global: { headers: { Authorization: authHeader } } })
    const { data: ud } = await asUser.auth.getUser()
    const uid = ud?.user?.id
    if (!uid) return json({ error: 'no-auth' }, 401)
    const { data: perfil } = await asUser.from('perfiles').select('id_empresa, rol, activo').eq('id', uid).maybeSingle()
    if (!perfil || !perfil.activo) return json({ error: 'sin-perfil' }, 403)
    const esSuper = perfil.rol === 'superadmin'
    if (!esSuper && perfil.rol !== 'admin') return json({ error: 'sin-permiso' }, 403)

    // 2) Validación del payload.
    const body = await req.json().catch(() => ({}))
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const nombre = String(body.nombre || '').trim()
    const rol = String(body.rol || '').trim()
    const telefono = body.telefono ? String(body.telefono).trim() : null
    const numero = body.numero != null && body.numero !== '' ? Number(body.numero) : null

    if (!EMAIL_RE.test(email)) return json({ error: 'email-invalido' }, 400)
    if (password.length < 6) return json({ error: 'password-corta' }, 400) // mínimo de Supabase
    if (numero != null && !Number.isFinite(numero)) return json({ error: 'codigo-invalido' }, 400)

    // La empresa la MANDA el server, no el front: un admin no puede crear fuera de la suya.
    const idEmpresa = esSuper ? (body.id_empresa || perfil.id_empresa) : perfil.id_empresa
    if (!idEmpresa) return json({ error: 'sin-empresa' }, 400)

    // El rol permitido depende de quién crea: un admin NO puede fabricar un superadmin.
    const rolesPermitidos = esSuper ? ROLES_SUPER : ROLES_ADMIN
    if (!rolesPermitidos.includes(rol)) return json({ error: 'rol-no-permitido' }, 403)

    // 3) Alta con service_role. email_confirm:true = usable ya (sin mail de confirmación).
    const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
    const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: nombre || email },
    })
    if (errCrear || !creado?.user) {
      // 422 = email ya registrado; se lo devolvemos claro al admin.
      const yaExiste = /already|registered|exists/i.test(errCrear?.message || '')
      return json({ error: yaExiste ? 'email-ya-existe' : (errCrear?.message || 'error-alta') }, yaExiste ? 409 : 500)
    }
    const nuevoId = creado.user.id

    // 4) Completar el perfil (el trigger ya creó la fila base). Con service_role, así
    //    no dependemos de que las policies de perfiles permitan el update cruzado.
    const { error: errPerfil } = await admin.from('perfiles').update({
      nombre: nombre || null,
      email,
      rol,
      activo: true,
      id_empresa: idEmpresa,
      numero,
      telefono,
    }).eq('id', nuevoId)
    if (errPerfil) {
      // Rollback: si no pudimos dejar el perfil consistente, borramos el usuario
      // recién creado para no dejar una cuenta huérfana sin rol/empresa.
      await admin.auth.admin.deleteUser(nuevoId).catch(() => {})
      return json({ error: 'error-perfil: ' + errPerfil.message }, 500)
    }

    return json({ ok: true, id: nuevoId, email, rol, id_empresa: idEmpresa })
  } catch (e) {
    return json({ error: (e as Error)?.message || 'error-inesperado' }, 500)
  }
})
