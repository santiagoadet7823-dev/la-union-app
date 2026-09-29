// mfa-codigos — genera 10 códigos de recuperación para la cuenta que llama, recién activado TOTP
// (o para renovarlos). 29/09/2026 (db/80, Tarea 2.2).
//
// Por qué una Edge Function: Supabase Auth no trae códigos de recuperación de fábrica (a diferencia
// de otros proveedores). Sin esto, perder el teléfono con la app autenticadora deja a la persona
// sin ninguna salida propia — tendría que esperar a que un admin la resetee a mano (mfa-resetear).
//
// 🩸 EXIGE aal2, no solo estar logueado. El endpoint le muestra a quien llama la llave que evita el
// segundo factor, así que hace falta haber demostrado YA tener ese factor (acabar de pasar el
// challenge+verify del enroll, o loguearse ya con el código). Se lee el claim `aal` del JWT a mano
// (`leerAal`): `verify_jwt` de la plataforma ya validó la firma antes de invocar la función, así que
// decodificar sin re-verificar acá es seguro — no hay una forma más directa en supabase-js de leer
// el aal del token que se recibió (el cliente SÍ tiene `getAuthenticatorAssuranceLevel()`, pero esto
// corre server-side con el Authorization header, no con una sesión del SDK).
//
// Llamar esto de nuevo BORRA los códigos anteriores y genera 10 nuevos — es la única forma de
// "renovarlos" si se gastaron o se perdió el papel donde se anotaron.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const CANT_CODIGOS = 10

function generarCodigo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 10)
    .replace(/^(.{5})(.{5})$/, '$1-$2')
}
async function hashCodigo(c: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(c))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
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
    if (leerAal(authHeader) !== 'aal2') return json({ error: 'requiere-aal2' }, 403)

    const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

    const codigos: string[] = []
    const filas: { id_usuario: string; hash: string }[] = []
    for (let i = 0; i < CANT_CODIGOS; i++) {
      const c = generarCodigo()
      codigos.push(c)
      filas.push({ id_usuario: uid, hash: await hashCodigo(c) })
    }

    // Se identifica la tanda VIEJA por id ANTES de tocar nada, y se inserta la nueva antes de
    // borrarla: así un fallo a mitad de camino deja a la persona con la tanda anterior todavía
    // válida (en vez de en cero códigos), y el borrado final nunca toca lo que se acaba de insertar
    // porque apunta a ids puntuales, no a "todos los de este usuario".
    const { data: viejos, error: errViejos } = await admin.from('mfa_codigos').select('id').eq('id_usuario', uid)
    if (errViejos) return json({ error: errViejos.message }, 500)
    const { error: errInsertar } = await admin.from('mfa_codigos').insert(filas)
    if (errInsertar) return json({ error: errInsertar.message }, 500)
    if (viejos && viejos.length > 0) {
      const { error: errBorrar } = await admin.from('mfa_codigos').delete().in('id', viejos.map((v) => v.id))
      if (errBorrar) return json({ error: errBorrar.message }, 500)
    }

    return json({ ok: true, codigos })
  } catch (e) {
    return json({ error: (e as Error)?.message || 'error-inesperado' }, 500)
  }
})
