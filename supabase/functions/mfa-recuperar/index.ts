// mfa-recuperar — recuperar el acceso con un código de recuperación cuando se perdió el teléfono
// con la app autenticadora. 29/09/2026 (db/80, Tarea 2.2).
//
// Por qué hace falta como Edge Function y no como `unenroll()` del cliente: Supabase exige aal2
// para que una persona borre su PROPIO factor por autoservicio — y el caso que esto resuelve es
// exactamente el opuesto: alguien en aal1 que NO puede llegar a aal2 porque perdió el dispositivo.
// Por eso corre server-side con la SERVICE_ROLE key: valida identidad con el JWT del que llama
// (aal1 alcanza, no hace falta más) y un código de recuperación de un solo uso hace de "la prueba"
// que reemplaza al segundo factor perdido.
//
// Borra TODOS los factores TOTP de la cuenta (no solo uno): si perdió el teléfono, cualquier otro
// factor que hubiera quedado activo en ESE mismo teléfono tampoco sirve. También borra el resto de
// los códigos de recuperación sin usar — son de un solo incidente, no se reciclan entre pérdidas.
// La persona vuelve a aal1 sin factor y el Gate la manda derecho a activar uno nuevo.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function hashCodigo(c: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(c))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
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

    const body = await req.json().catch(() => ({}))
    // Los códigos de `mfa-codigos` son 10 hex en minúscula con un guion en el medio ("a1b2c-d3e4f").
    // Se normaliza lo que tipea la persona (mayúsculas, sin guion, espacios, otro separador) antes de
    // hashear. Largo fuera de rango => inválido sin gastar un hash ni una consulta.
    const crudo = String(body.codigo || '')
    if (!crudo.trim()) return json({ error: 'falta-codigo' }, 400)
    const hex = crudo.slice(0, 64).toLowerCase().replace(/[^0-9a-f]/g, '')
    if (hex.length !== 10) return json({ error: 'codigo-invalido' }, 403)
    const codigo = `${hex.slice(0, 5)}-${hex.slice(5)}`

    const admin = createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })

    // Reclamo atómico, mismo patrón que codigos_registro (db/79): el WHERE usado_ts is null evita
    // que el mismo código se use dos veces si llegan dos pedidos a la vez.
    const hash = await hashCodigo(codigo)
    const { data: fila, error: errCodigo } = await admin
      .from('mfa_codigos')
      .update({ usado_ts: new Date().toISOString() })
      .eq('id_usuario', uid).eq('hash', hash).is('usado_ts', null)
      .select('id').maybeSingle()
    if (errCodigo) return json({ error: errCodigo.message }, 500)
    if (!fila) return json({ error: 'codigo-invalido' }, 403)

    const { data: factores, error: errFactores } = await admin.rpc('listar_factores_mfa', { p_id: uid })
    if (errFactores) {
      // Igual que la rama de `fallas`: no se le gasta el código por un error nuestro.
      await admin.from('mfa_codigos').update({ usado_ts: null }).eq('id', fila.id)
      return json({ error: 'no-se-pudo-completar' }, 500)
    }
    // 🩸 ACÁ NO HAY "MEJOR ESFUERZO": borrar el factor es el propósito central del endpoint, no un
    // paso secundario. Si falla, la persona queda con un TOTP verificado que no puede completar —
    // exactamente lo que estaba tratando de resolver— y no hay que reportar éxito ni gastarle el
    // resto de sus códigos de recuperación por eso.
    const fallas: string[] = []
    for (const factorId of factores || []) {
      const { error: errDel } = await admin.auth.admin.mfa.deleteFactor({ id: factorId, userId: uid })
      if (errDel) fallas.push(factorId)
    }
    if (fallas.length > 0) {
      // Se libera el código que acababa de reclamar (línea de arriba): que pueda reintentar con el
      // mismo, en vez de quedarse sin esa vía por un error transitorio nuestro.
      try { await admin.from('mfa_codigos').update({ usado_ts: null }).eq('id', fila.id) } catch (_) { /* best-effort */ }
      return json({ error: 'no-se-pudo-completar' }, 500)
    }
    // Recién con TODOS los factores borrados, el resto de los códigos de este incidente ya no
    // sirven: se generan de nuevo al reactivar. supabase-js no lanza (devuelve `{ error }`), así que
    // un try/catch solo no alcanza: si el delete falla, esos códigos quedan vigentes y hay que saberlo.
    const { error: errBorrar } = await admin.from('mfa_codigos').delete().eq('id_usuario', uid)
    let errAud: unknown = null
    try {
      const r = await admin.from('auditoria_seguridad').insert({ id_usuario: uid, id_actor: uid, accion: 'mfa_recuperado_por_codigo' })
      errAud = r.error
    } catch (e) { errAud = e } // la auditoría no puede tumbar la recuperación
    if (errBorrar || errAud) console.error('mfa-recuperar: pasos secundarios fallaron', { borrar: errBorrar?.message, auditoria: (errAud as Error)?.message })

    return json({ ok: true })
  } catch (e) {
    return json({ error: (e as Error)?.message || 'error-inesperado' }, 500)
  }
})
