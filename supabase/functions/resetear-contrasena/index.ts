// resetear-contrasena — un admin/superadmin le pone una contraseña nueva a otra cuenta.
// 29/09/2026 (db/78).
//
// Por qué hace falta: es la respuesta a "¿cómo recupera la contraseña alguien sin email?" (las
// cuentas de `crear-usuario` con `usuario` en vez de `email` entran por
// `<usuario>@usuarios.dist-at.invalid` — RFC 2606, nadie puede recibir nada ahí, así que el enlace
// por mail de `enviarEnlaceContrasena` no sirve). También cubre a alguien con email real que
// simplemente se olvidó la contraseña y no tiene forma de recibir el enlace en el momento.
//
// Mismo patrón de doble cliente que crear-usuario / eliminar-usuario: se valida el JWT del que
// llama con SU token (respeta RLS) y recién ahí se usa la SERVICE_ROLE key.
//
// 🩸 LA AUTORIZACIÓN LA HACE LA RLS, NO UN IF A MANO. Se lee la fila objetivo con el cliente
// `asUser` (el del que llama): `perfiles_sel` ya deja pasar a un admin solo las de SU empresa (o
// sin empresa) y a un superadmin todas. Si la fila no aparece, no hace falta distinguir "no existe"
// de "no te toca" — para quien pide el reseteo es el mismo resultado, y no se le da a alguien de
// afuera una forma de confirmar que un id existe en otra empresa.
//
// La cuenta queda con `debe_cambiar_contrasena = true`: el Gate del front (App.jsx) bloquea la app
// con una pantalla de cambio obligatorio hasta que la persona ponga una contraseña propia. La
// contraseña generada se devuelve UNA vez en la respuesta — no se guarda en ningún lado — para que
// el admin se la dicte por teléfono, igual que la contraseña inicial del alta.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Misma receta que `generarPassword()` del front (usuarios/modelo.js): legible para dictar por
// teléfono ("sol-1234-rio"). Copiada, no importada — el front y esta función corren en runtimes
// distintos (Vite vs Deno) y no comparten build.
const SILABAS = ['sol', 'rio', 'mar', 'pan', 'luz', 'sal', 'mate', 'ruta', 'loma', 'nube', 'cerro', 'pampa', 'yerba', 'tren', 'faro', 'lago']
function generarPassword(): string {
  const r = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n
  const a = SILABAS[r(SILABAS.length)]
  let b = SILABAS[r(SILABAS.length)]
  if (b === a) b = SILABAS[(SILABAS.indexOf(a) + 3) % SILABAS.length]
  return `${a}-${String(1000 + r(9000))}-${b}`
}

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
    const { data: yo } = await asUser.from('perfiles').select('rol, activo').eq('id', uid).maybeSingle()
    if (!yo || !yo.activo) return json({ error: 'sin-perfil' }, 403)
    if (yo.rol !== 'admin' && yo.rol !== 'superadmin') return json({ error: 'sin-permiso' }, 403)

    // 2) Payload.
    const body = await req.json().catch(() => ({}))
    const id = String(body.id || '')
    if (!UUID_RE.test(id)) return json({ error: 'payload-invalido' }, 400)
    if (id === uid) return json({ error: 'propia-cuenta' }, 400) // para la propia, "Cambiar contraseña" en Mi cuenta

    // 3) La fila objetivo, con el token del que llama: si `perfiles_sel` no la deja pasar
    //    (otra empresa, o un admin mirando a alguien fuera de su alcance), no está autorizado.
    const { data: objetivo, error: errObj } = await asUser
      .from('perfiles').select('id, rol, sistema, usuario, email').eq('id', id).maybeSingle()
    if (errObj) return json({ error: errObj.message }, 500)
    if (!objetivo) return json({ error: 'no-existe-o-sin-permiso' }, 404)
    if (objetivo.sistema) return json({ error: 'perfil-de-sistema' }, 400)
    // Mismo límite que el trigger perfiles_guarda_cambios (db/77): un admin no toca a un superadmin.
    if (objetivo.rol === 'superadmin' && yo.rol !== 'superadmin') return json({ error: 'sin-permiso-superadmin' }, 403)

    // 4) Reseteo con service_role.
    // ⚠️ SIN VERIFICAR CONTRA LA BASE VIVA (29/09/2026): cambiar la contraseña por acá debería
    // revocar los refresh tokens ya emitidos para esta cuenta (comportamiento documentado de
    // GoTrue), pero no se probó en este proyecto que una sesión abierta en OTRO teléfono se corte
    // de verdad. Antes de contar con esto para el caso "recuperar un teléfono robado/perdido",
    // reproducirlo: loguear una sesión, resetear desde acá, y confirmar que esa sesión deja de
    // servir en el próximo refresh (no solo que la contraseña vieja ya no entra).
    const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
    const nuevaPassword = generarPassword()
    const { error: errPass } = await admin.auth.admin.updateUserById(id, { password: nuevaPassword })
    if (errPass) return json({ error: errPass.message }, 500)

    // `debe_cambiar_contrasena` con service_role: el trigger de db/77 no aplica sin auth.uid().
    const { error: errFlag } = await admin.from('perfiles').update({ debe_cambiar_contrasena: true }).eq('id', id)
    if (errFlag) return json({ error: errFlag.message }, 500)

    return json({ ok: true, id, usuario: objetivo.usuario, email: objetivo.email, password: nuevaPassword })
  } catch (e) {
    return json({ error: (e as Error)?.message || 'error-inesperado' }, 500)
  }
})
