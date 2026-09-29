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
// público normal de Supabase dejaría la cuenta atascada sin confirmar para siempre. Por eso, pase
// lo que pase acá, la cuenta sale SIEMPRE sin rol y sin empresa — cero acceso a nada hasta que un
// admin la revise y la asigne, exactamente igual que una cuenta de Google sin aprobar.
//
// 🩸 CÓDIGOS DE UN SOLO USO, NO UN SECRET FIJO (db/79, 29/09/2026). La primera versión comparaba
// contra un código único compartido por todos — y el dueño hizo la pregunta correcta: si ese
// código circula entre los mismos vendedores, cualquiera que lo sepa puede seguir creando cuentas
// pendientes sin límite (no expone datos, pero satura la cola de aprobación y el cupo de
// usuarios). Ahora cada código sirve UNA sola vez y vence solo (tabla `codigos_registro`,
// RPC `generar_codigo_registro`, ambas de db/79). El UPDATE que lo reclama lleva
// `WHERE usado_ts is null AND expira_ts > now()`: es la forma de que dos pedidos con el mismo
// código llegando a la vez no puedan ganar los dos — el segundo encuentra 0 filas.
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
    const body = await req.json().catch(() => ({}))
    const usuario = String(body.usuario || '').trim().toLowerCase()
    const password = String(body.password || '')
    const nombre = String(body.nombre || '').trim()
    const telefono = body.telefono ? String(body.telefono).trim() : null
    // Formato libre al tipear (mayúsculas, espacios, guion de por medio); se normaliza antes de
    // buscarlo. El código lo generó generar_codigo_registro() como "XXXXX-XXXXX" en mayúscula.
    const codigo = String(body.codigo || '').trim().toUpperCase().replace(/\s+/g, '')

    if (!USUARIO_RE.test(usuario)) return json({ error: 'usuario-invalido' }, 400)
    if (password.length < 6) return json({ error: 'password-corta' }, 400) // mínimo de Supabase
    // Sin admin creando la cuenta, el nombre es lo único que permite identificar a quién
    // aprobar/asignar en la cola de pendientes — a diferencia de crear-usuario, acá NO es opcional.
    if (!nombre) return json({ error: 'falta-nombre' }, 400)
    if (!codigo) return json({ error: 'falta-codigo' }, 400)

    const SB_URL = Deno.env.get('SUPABASE_URL')!
    const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

    // Reclamar el código ANTES de crear la cuenta, con el WHERE como guardia atómica (db/79): dos
    // pedidos con el mismo código a la vez no pueden ganar los dos, el segundo encuentra 0 filas.
    // Un solo mensaje para "no existe" / "ya se usó" / "venció": no hay motivo para que alguien
    // afuera distinga esos tres casos probando códigos al azar.
    const { data: reclamo, error: errCodigo } = await admin
      .from('codigos_registro')
      .update({ usado_ts: new Date().toISOString(), usuario_registrado: usuario })
      .eq('codigo', codigo)
      .is('usado_ts', null)
      .gt('expira_ts', new Date().toISOString())
      .select('id')
      .maybeSingle()
    if (errCodigo) return json({ error: errCodigo.message }, 500)
    if (!reclamo) return json({ error: 'codigo-invalido-o-usado' }, 403)

    const email = `${usuario}@${DOMINIO_USUARIO}`
    const { data: creado, error: errCrear } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: nombre },
    })
    if (errCrear || !creado?.user) {
      // El código ya se marcó usado arriba pero la cuenta no se pudo crear (choque de usuario, casi
      // siempre): se libera para no desperdiciar la invitación que el admin armó para esta persona.
      // try/catch y no `.catch()`: el builder de supabase-js es thenable, no una Promise real, y no
      // garantiza tener `.catch()` (a diferencia de `admin.auth.admin.deleteUser`, que sí es nativo).
      try { await admin.from('codigos_registro').update({ usado_ts: null, usuario_registrado: null }).eq('id', reclamo.id) } catch (_) { /* best-effort */ }
      const yaExiste = /already|registered|exists/i.test(errCrear?.message || '')
      return json({ error: yaExiste ? 'usuario-ya-existe' : (errCrear?.message || 'error-alta') }, yaExiste ? 409 : 500)
    }
    const nuevoId = creado.user.id

    // El trigger handle_new_user ya insertó el perfil pendiente (rol null, activo false, sin
    // empresa — mira new.email/user_metadata, no sabe nada de `usuario`). Acá solo se completa eso.
    // Nunca rol, nunca id_empresa: los asigna un admin a mano, después, desde el menú Usuarios.
    const { error: errPerfil } = await admin.from('perfiles').update({ usuario, telefono }).eq('id', nuevoId)
    if (errPerfil) {
      // Rollback: sin esto quedaría una cuenta huérfana que nadie pidió, bloqueando además ese
      // nombre de usuario para siempre (el índice único de db/78). El código se libera igual.
      await admin.auth.admin.deleteUser(nuevoId).catch(() => {})
      try { await admin.from('codigos_registro').update({ usado_ts: null, usuario_registrado: null }).eq('id', reclamo.id) } catch (_) { /* best-effort */ }
      return json({ error: 'error-perfil: ' + errPerfil.message }, 500)
    }

    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error)?.message || 'error-inesperado' }, 500)
  }
})
