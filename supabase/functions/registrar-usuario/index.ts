// registrar-usuario — alta propia, sin admin de por medio: un empleado sin email real elige SU
// usuario y contraseña. 29/09/2026 (db/78, segunda tanda del login por usuario).
//
// Por qué existe: `crear-usuario` necesita que un admin YA logueado la llame. El pedido real es
// que cada persona pueda darse de alta con el usuario que quiera y que el dueño, después, la
// asigne a la empresa que corresponda — el mismo circuito que YA existe para quien entra con
// Google y queda "pendiente de aprobación" (rol null, activo false, sin empresa), solo que acá no
// hay ningún admin creándola a mano. LoginView tenía un cartel que decía "acá no hay registro
// abierto, entrá con Google"; esto es exactamente lo que ese comentario dejaba pendiente.
//
// 🩸 ES UN ENDPOINT PÚBLICO DE VERDAD (sin JWT, sin sesión previa) — no hay otra forma: quien llama
// todavía no tiene cuenta. Usa la SERVICE_ROLE key porque el email sintético
// (`<usuario>@usuarios.dist-at.invalid`, RFC 2606) nunca puede confirmarse por correo: el signUp
// público normal de Supabase dejaría la cuenta atascada sin confirmar para siempre. Como no hay
// ningún JWT que autorice la llamada, el único freno posible es un CÓDIGO DE INVITACIÓN compartido
// (`CODIGO_REGISTRO`, un secret de esta función — NUNCA en el bundle del cliente ni en una tabla
// legible por anon). No es autenticación real: cualquiera con el código puede pedir una cuenta.
// Por eso, pase lo que pase acá, la cuenta sale SIEMPRE sin rol y sin empresa — cero acceso a nada
// hasta que un admin la revise y la asigne, exactamente igual que una cuenta de Google sin aprobar.
//
// ⚠️ Esto no reemplaza ni bloquea el signUp nativo de Supabase (si "Allow new users to sign up"
// sigue prendido en el panel, alguien podría igual crear una cuenta con un email cualquiera por esa
// vía, sin pasar por el código). No es un agujero nuevo: esa cuenta también saldría pendiente y sin
// acceso — el mismo piso que ya existe. Cerrar del todo esa puerta es un cambio de config de Auth
// aparte, con su propio OK.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// Mismo formato que el CHECK de la base (db/78) y que crear-usuario.
const USUARIO_RE = /^[a-z0-9._-]{3,30}$/
const DOMINIO_USUARIO = 'usuarios.dist-at.invalid'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'metodo-no-permitido' }, 405)
  try {
    // El registro llega apagado por defecto: sin el secret configurado, falla cerrado en vez de
    // dejar pasar cualquier alta sin freno.
    const CODIGO = Deno.env.get('CODIGO_REGISTRO')
    if (!CODIGO) return json({ error: 'registro-no-configurado' }, 500)

    const body = await req.json().catch(() => ({}))
    // Comparación insensible a mayúsculas: el código se dicta por WhatsApp y el teclado de un
    // celular capitaliza solo. No es una contraseña de verdad, es un freno anti-spam.
    const codigo = String(body.codigo || '').trim().toLowerCase()
    if (!codigo || codigo !== CODIGO.trim().toLowerCase()) return json({ error: 'codigo-registro-invalido' }, 403)

    const usuario = String(body.usuario || '').trim().toLowerCase()
    const password = String(body.password || '')
    const nombre = String(body.nombre || '').trim()
    const telefono = body.telefono ? String(body.telefono).trim() : null

    if (!USUARIO_RE.test(usuario)) return json({ error: 'usuario-invalido' }, 400)
    if (password.length < 6) return json({ error: 'password-corta' }, 400) // mínimo de Supabase
    // Sin admin creando la cuenta, el nombre es lo único que permite identificar a quién
    // aprobar/asignar en la cola de pendientes — a diferencia de crear-usuario, acá NO es opcional.
    if (!nombre) return json({ error: 'falta-nombre' }, 400)

    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

    const email = `${usuario}@${DOMINIO_USUARIO}`
    const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: nombre },
    })
    if (errCrear || !creado?.user) {
      const yaExiste = /already|registered|exists/i.test(errCrear?.message || '')
      return json({ error: yaExiste ? 'usuario-ya-existe' : (errCrear?.message || 'error-alta') }, yaExiste ? 409 : 500)
    }
    const nuevoId = creado.user.id

    // El trigger handle_new_user ya insertó el perfil pendiente (rol null, activo false, sin
    // empresa — mira new.email/user_metadata, no sabe nada de `usuario`). Acá solo se completa eso.
    // Nunca rol, nunca id_empresa: los asigna un admin a mano, después, desde el menú Usuarios.
    const { error: errPerfil } = await admin.from('perfiles').update({ usuario, telefono }).eq('id', nuevoId)
    if (errPerfil) {
      // Rollback: sin esto quedaría una cuenta huérfana que nadie pidió y que además
      // bloquearía ese nombre de usuario para siempre (el índice único de db/78).
      await admin.auth.admin.deleteUser(nuevoId).catch(() => {})
      return json({ error: 'error-perfil: ' + errPerfil.message }, 500)
    }

    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error)?.message || 'error-inesperado' }, 500)
  }
})
