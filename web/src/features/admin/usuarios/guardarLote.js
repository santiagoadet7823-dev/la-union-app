import { supabase } from '../../../services/supabase'
import { hoyStr } from '../../../lib/format'
import { ROLES_EDITAN_CATALOGO, traducirError } from './modelo'

/**
 * "Guardar N cambios": manda el borrador ENTERO en tres pasos y devuelve qué salió y qué no.
 *
 *   1. Altas       → Edge Function `crear-usuario`, una por persona (crea en auth.users con la
 *                    service key; no se puede desde el front).
 *   2. Cambios     → RPC `guardar_usuarios_lote` (db/77): UNA llamada para todos, cada campo en su
 *                    propio subbloque en el servidor. Nunca un `for` de updates sueltos (brief §9).
 *   3. Eliminar y  → Edge Function `eliminar-usuario`: una llamada con todos los ítems.
 *      purgar
 *
 * El orden importa: las altas van primero porque sus horarios y su nivel viajan en el paso 2 con el
 * id nuevo; las eliminaciones van últimas porque no se pueden deshacer, y si la red se corta en el
 * medio es mejor haber guardado lo reversible.
 *
 * Nada de lo que falla se pierde: la vista llama a `aplicarGuardado` sólo con lo que salió bien.
 */

async function leerErrorInvoke(data, err) {
  // functions.invoke: ante un !2xx `data` viene null y el cuerpo {error} queda en err.context.
  let code = data?.error || null
  if (err && !code) {
    try { code = (await err.context.json())?.error } catch (_) { code = err.message }
  }
  return code
}

/** Traduce los campos del borrador a los de la RPC. `catalogo` viaja como `permisos`. */
function camposParaRpc(p, c) {
  const out = {}
  const rolNuevo = 'rol' in c ? c.rol : p?.rol
  if ('id_empresa' in c) out.id_empresa = c.id_empresa || null
  if ('rol' in c) out.rol = c.rol
  if ('nivel' in c && rolNuevo === 'encargado') out.nivel = c.nivel
  if ('numero' in c) out.numero = c.numero === '' ? null : String(c.numero)
  if ('categorias' in c) out.categorias = c.categorias
  if ('color_trazo' in c) out.color_trazo = c.color_trazo
  // `desde` se sella HOY en cada cambio: es la fecha contra la que se mide si el perfil aterrizó.
  if ('gps_perfil' in c) out.gps_perfil = c.gps_perfil ? { ...c.gps_perfil, desde: hoyStr() } : null
  if ('activo' in c) out.activo = c.activo

  // Permisos: el de catálogo es el único extra (db/23). Si el rol NUEVO ya edita catálogo por sí
  // mismo, se limpia: dejarlo guardado sería una promesa muda para el día en que a esa persona la
  // bajen a vendedor (mismo criterio que el guardado de 1.41.0).
  const base = (p?.permisos || []).filter((x) => x !== 'catalogo')
  if ('catalogo' in c) out.permisos = c.catalogo ? [...base, 'catalogo'] : base
  if ('rol' in c && ROLES_EDITAN_CATALOGO.includes(rolNuevo) && (p?.permisos || []).includes('catalogo')) out.permisos = base
  return out
}

/** Qué campo del borrador corresponde a cada campo que devuelve la RPC. */
const CAMPO_BORRADOR = { permisos: 'catalogo' }

/**
 * @param b          borrador de useBorrador
 * @param porId      { id: persona }
 * @returns {{ total, ok, fallas: [{pid, nombre, campo, motivo}], guardado: {campos, dels, altas}, errorTotal? }}
 */
export async function guardarLote(b, porId) {
  const guardado = { campos: [], dels: [], altas: [], cobs: [] }
  const fallas = []
  let total = 0
  let ok = 0

  // ── 1) Altas ──────────────────────────────────────────────────────────────
  const extras = [] // horarios y nivel de las altas, que viajan con el lote
  for (const [tmp, a] of Object.entries(b.altas)) {
    total++
    try {
      const { data, error } = await supabase.functions.invoke('crear-usuario', {
        body: { email: a.email, password: a.password, nombre: a.nombre, rol: a.rol, id_empresa: a.id_empresa, numero: a.numero || null },
      })
      const code = await leerErrorInvoke(data, error)
      if (code || error || !data?.id) throw new Error(code || error?.message || 'error-alta')
      ok++
      guardado.altas.push(tmp)
      const campos = {}
      if (a.rol === 'encargado' && a.nivel) campos.nivel = a.nivel
      if (a.categorias?.length) campos.categorias = a.categorias
      if (Object.keys(campos).length) extras.push({ id: data.id, campos })
    } catch (e) {
      fallas.push({ pid: tmp, nombre: a.nombre || a.email, campo: '_alta', motivo: traducirError(e.message) })
    }
  }

  // ── 2) Cambios ────────────────────────────────────────────────────────────
  const lote = []
  for (const [pid, c] of Object.entries(b.cambios)) {
    if (b.del[pid]) continue // se va a eliminar: tocarle el rol antes no tiene sentido
    const campos = camposParaRpc(porId[pid], c)
    if (Object.keys(campos).length) lote.push({ id: pid, campos })
  }
  const nCambios = lote.reduce((a, it) => a + Object.keys(b.cambios[it.id] || {}).length, 0)
  total += nCambios
  if (lote.length || extras.length) {
    const { data, error } = await supabase.rpc('guardar_usuarios_lote', { p_cambios: [...lote, ...extras] })
    if (error) {
      // La llamada entera falló (sin red, sesión vencida): TODO queda en el borrador.
      for (const it of lote) {
        for (const campo of Object.keys(b.cambios[it.id] || {})) {
          fallas.push({ pid: it.id, nombre: porId[it.id]?.nombre, campo, motivo: traducirError(error.message) })
        }
      }
      if (!ok && !Object.keys(b.del).length && !Object.keys(b.cob || {}).length) {
        return { total, ok, fallas, guardado, errorTotal: traducirError(error.message) }
      }
    } else {
      const extrasIds = new Set(extras.map((e) => e.id))
      const porPersona = {}
      for (const r of data || []) {
        if (extrasIds.has(r.id)) {
          // Los horarios o el nivel de un alta recién creada: la cuenta YA existe, así que no se
          // puede reintentar como alta. Se avisa para que se corrija desde su ficha.
          if (!r.ok) fallas.push({ pid: r.id, nombre: 'Alta nueva', campo: r.campo, motivo: 'la cuenta se creó, pero ' + traducirError(r.error) + '. Corregilo desde su ficha.' })
          continue
        }
        const campoB = CAMPO_BORRADOR[r.campo] || r.campo
        ;(porPersona[r.id] ||= {})[campoB] = porPersona[r.id][campoB] === false ? false : r.ok
        if (!r.ok) fallas.push({ pid: r.id, nombre: porId[r.id]?.nombre, campo: campoB, motivo: traducirError(r.error) })
      }
      for (const it of lote) {
        for (const campo of Object.keys(b.cambios[it.id] || {})) {
          const res = porPersona[it.id]?.[campo]
          // Un campo del borrador que no generó campo en la RPC (p. ej. nivel de alguien que deja
          // de ser encargado) se da por guardado: el servidor ya lo resolvió con el rol.
          if (res === false) continue
          ok++
          guardado.campos.push({ pid: it.id, campo })
        }
      }
    }
  }

  // ── 2-bis) Coberturas del día canceladas ─────────────────────────────────
  // Un DELETE por lote sobre `coberturas_zona`; la policy `_del` (db/76) sólo deja a admin y
  // superadmin, además de la propia persona. 0 filas borradas = la RLS no dejó: no es un éxito.
  const cobIds = Object.keys(b.cob || {})
  total += cobIds.length
  if (cobIds.length) {
    const { data, error } = await supabase.from('coberturas_zona').delete().in('id', cobIds).select('id')
    const borradas = new Set((data || []).map((r) => r.id))
    for (const id of cobIds) {
      if (!error && borradas.has(id)) { ok++; (guardado.cobs ||= []).push(id) } else {
        const c = b.cob[id]
        fallas.push({ pid: c?.pid, nombre: c?.por, campo: '_cob', motivo: error ? traducirError(error.message) : 'sin permiso' })
      }
    }
  }

  // ── 3) Eliminar y purgar ──────────────────────────────────────────────────
  const items = Object.entries(b.del).map(([id, modo]) => ({ id, modo }))
  total += items.length
  if (items.length) {
    const { data, error } = await supabase.functions.invoke('eliminar-usuario', { body: { items } })
    const code = await leerErrorInvoke(data, error)
    if (code || error || !Array.isArray(data?.resultados)) {
      for (const it of items) fallas.push({ pid: it.id, nombre: porId[it.id]?.nombre, campo: '_del', modo: it.modo, motivo: traducirError(code || error?.message) })
    } else {
      for (const r of data.resultados) {
        if (r.ok) { ok++; guardado.dels.push(r.id) } else {
          fallas.push({ pid: r.id, nombre: porId[r.id]?.nombre, campo: '_del', modo: r.modo, motivo: traducirError(r.error) })
        }
      }
    }
  }

  return { total, ok, fallas, guardado }
}
