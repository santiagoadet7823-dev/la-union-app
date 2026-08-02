// Edge Function: avisar al supervisor cuando alguien del equipo deja de reportar o queda quieto.
//
// La invoca pg_cron cada 10 min. **Esta función no detecta nada**: la detección entera vive en la
// función SQL `vigilancia_equipo` (db/26). Acá solo se decide, se abre/cierra el incidente y se
// manda el push. La razón es de verificabilidad: una función SQL pura se prueba con un `select`
// contra la base viva, sin desplegar nada y sin esperar a que corra un cron.
//
// 🔑 El ANTIRREBOTE no está acá, está en el índice único parcial
// `alertas_equipo_abierta_uidx (id_usuario, tipo) where resuelta_ts is null`. Con un solo incidente
// abierto por persona y por tipo, este cron puede correr cada 10 minutos sin mandar 6 avisos por
// hora. No agregar lógica de "ya avisé" acá: se duplicaría el criterio en dos lugares.
//
// Los DOS tipos de aviso, y por qué son dos y no tres:
//   · sin_reportar — hace N minutos que no llega una posición, DENTRO de su ventana de rastreo.
//   · quieto       — sigue reportando, pero no se movió del mismo lugar (radio de 40 m).
// "Sin internet" NO es un tercer tipo: es el MOTIVO de un silencio y viaja en `alertas_equipo.motivo`.
// Dos push por el mismo hecho serían ruido.
//
// SECRETO requerido: FCM_SERVICE_ACCOUNT (el mismo que usan push-heartbeat y push-actualizacion).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarPush, getAccessToken } from './fcm.ts'

// Quién recibe los avisos de una empresa. El `superadmin` los recibe de TODAS: es quien opera el
// SaaS, no un supervisor de un tenant.
const ROLES_SUPERVISOR = ['admin', 'encargado', 'propietario']

interface FilaVigilancia {
  id_usuario: string
  id_empresa: string
  nombre: string | null
  rol: string
  ultimo_ts: string | null
  minutos_silencio: number
  lat: number | null
  lng: number | null
  quieto_desde: string | null
  minutos_quieto: number
  en_ventana: boolean
  red: string | null
  red_desde: string | null
  arranque_ts: string | null
  apagado_ts: string | null
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** Hora local de Salta (UTC−3 fijo, sin horario de verano) como HH:MM. */
function hhmm(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(new Date(iso).getTime() - 3 * 3600 * 1000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** "2 h 15 min" — la duración se lee, no se calcula mentalmente. */
function dur(min: number): string {
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

/**
 * Por qué se quedó callado, si el teléfono lo pudo contar. Devuelve null cuando no sabemos, y eso
 * está bien: es mejor un aviso sin explicación que una explicación inventada.
 *
 * Ojo con el límite real: el teléfono solo puede reportar que estuvo sin red CUANDO VUELVE a tener
 * red. Así que en el momento en que se abre el incidente esto casi siempre es null, y se llena
 * después. Por eso el motivo se recalcula en cada pasada del cron, no solo al abrir.
 */
function motivoDe(f: FilaVigilancia, desde: string): string | null {
  if (f.red === 'avion') return `modo avión desde las ${hhmm(f.red_desde)}`
  if (f.red === 'sin-red') return `sin internet desde las ${hhmm(f.red_desde)}`
  const t = new Date(desde).getTime()
  if (f.arranque_ts && new Date(f.arranque_ts).getTime() > t) {
    return `el teléfono se reinició a las ${hhmm(f.arranque_ts)}`
  }
  if (f.apagado_ts && new Date(f.apagado_ts).getTime() > t) {
    return `el teléfono se apagó a las ${hhmm(f.apagado_ts)}`
  }
  return null
}

Deno.serve(async () => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ---- 1) Umbrales. Viven en app_config, al lado de la ventana de rastreo.
    const { data: cfg } = await supabase
      .from('app_config')
      .select('alertas_activas, alerta_silencio_min, alerta_quieto_min')
      .maybeSingle()
    if (cfg?.alertas_activas === false) {
      return json({ motivo: 'alertas apagadas', abiertas: 0, cerradas: 0, enviados: 0 })
    }
    const minSil = cfg?.alerta_silencio_min ?? 30
    const minQui = cfg?.alerta_quieto_min ?? 120

    // ---- 2) Detección (toda en SQL).
    const { data: filas, error: errVig } = await supabase.rpc('vigilancia_equipo', {
      p_min_silencio: minSil,
      p_min_quieto: minQui,
    })
    if (errVig) return json({ error: 'vigilancia_equipo: ' + errVig.message }, 500)
    const vig = (filas || []) as FilaVigilancia[]

    // ---- 3) Qué corresponde AHORA, por persona.
    //
    // Fuera de la ventana de rastreo no corresponde nada: el rastreo se apaga solo a las 18:00 y un
    // vendedor que no reporta a las 21:00 no es un problema, es que terminó de trabajar.
    //
    // `quieto` exige que la persona SIGA reportando. Si dejó de hacerlo también está trivialmente
    // quieta, y ese caso ya lo cubre `sin_reportar`: sin esta condición saldrían dos avisos por el
    // mismo hecho.
    const corresponde = new Map<string, Set<string>>()
    const porUsuario = new Map<string, FilaVigilancia>()
    for (const f of vig) {
      porUsuario.set(f.id_usuario, f)
      const tipos = new Set<string>()
      if (f.en_ventana) {
        if (f.minutos_silencio >= minSil) tipos.add('sin_reportar')
        else if (f.minutos_quieto >= minQui) tipos.add('quieto')
      }
      corresponde.set(f.id_usuario, tipos)
    }

    // ---- 4) Qué hay abierto.
    const { data: abiertasRaw, error: errAb } = await supabase
      .from('alertas_equipo')
      .select('id, id_empresa, id_usuario, tipo, desde, avisada_ts, minutos, motivo')
      .is('resuelta_ts', null)
    if (errAb) return json({ error: 'alertas_equipo: ' + errAb.message }, 500)
    const abiertas: Record<string, any>[] = abiertasRaw || []
    const clave = (u: string, t: string) => `${u}|${t}`
    const yaAbierto = new Map(abiertas.map((a) => [clave(a.id_usuario, a.tipo), a]))

    // ---- 5) Abrir lo que falta.
    const aAbrir: Record<string, unknown>[] = []
    for (const [uid, tipos] of corresponde) {
      const f = porUsuario.get(uid)!
      for (const tipo of tipos) {
        if (yaAbierto.has(clave(uid, tipo))) continue
        const desde = tipo === 'sin_reportar'
          ? (f.ultimo_ts || new Date(Date.now() - f.minutos_silencio * 60000).toISOString())
          : (f.quieto_desde || new Date(Date.now() - f.minutos_quieto * 60000).toISOString())
        aAbrir.push({
          id_empresa: f.id_empresa,
          id_usuario: uid,
          tipo,
          desde,
          minutos: tipo === 'sin_reportar' ? f.minutos_silencio : f.minutos_quieto,
          lat: f.lat,
          lng: f.lng,
          motivo: motivoDe(f, desde),
        })
      }
    }
    let nuevas: Record<string, any>[] = []
    if (aAbrir.length) {
      // `ignoreDuplicates` cubre la carrera de dos invocaciones simultáneas del cron: el índice
      // único parcial la rechazaría con 23505 y perderíamos el lote entero.
      const { data, error } = await supabase
        .from('alertas_equipo')
        .upsert(aAbrir, { ignoreDuplicates: true })
        .select('id, id_empresa, id_usuario, tipo, desde, minutos, motivo')
      if (error) return json({ error: 'insert alertas: ' + error.message }, 500)
      nuevas = data || []
    }

    // ---- 6) Cerrar lo que ya no corresponde, y refrescar minutos/motivo de lo que sigue abierto.
    const aCerrar = abiertas.filter((a) => !(corresponde.get(a.id_usuario)?.has(a.tipo)))
    if (aCerrar.length) {
      const { error } = await supabase
        .from('alertas_equipo')
        .update({ resuelta_ts: new Date().toISOString() })
        .in('id', aCerrar.map((a) => a.id))
      if (error) return json({ error: 'cerrar alertas: ' + error.message }, 500)
    }
    // Los que siguen abiertos se actualizan para que el panel muestre el número de ahora y para que
    // el motivo aparezca cuando el teléfono por fin lo puede contar (ver motivoDe).
    for (const a of abiertas) {
      if (aCerrar.includes(a)) continue
      const f = porUsuario.get(a.id_usuario)
      if (!f) continue
      const min = a.tipo === 'sin_reportar' ? f.minutos_silencio : f.minutos_quieto
      const mot = motivoDe(f, a.desde)
      if (min === a.minutos && mot === a.motivo) continue
      await supabase.from('alertas_equipo').update({ minutos: min, motivo: mot }).eq('id', a.id)
    }

    // ---- 7) Push. Solo por APERTURAS nuevas y por CIERRES que ya se habían avisado (si nadie supo
    //         del problema, avisar que se resolvió es ruido).
    const cierresAvisables = aCerrar.filter((a) => a.avisada_ts)
    if (!nuevas.length && !cierresAvisables.length) {
      return json({ abiertas: 0, cerradas: aCerrar.length, enviados: 0, fallidos: 0, omitidos: 0 })
    }

    const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') || '{}')
    if (!sa.client_email || !sa.private_key || !sa.project_id) {
      return json({ error: 'Falta FCM_SERVICE_ACCOUNT', abiertas: nuevas.length, cerradas: aCerrar.length }, 500)
    }

    // Destinatarios: supervisores con token. Los superadmin reciben de TODAS las empresas — son
    // quienes operan el SaaS, no supervisores de un tenant.
    //
    // Dos consultas y el join en JS, a propósito: el embed `estado_dispositivo(fcm_token)` de
    // PostgREST depende de que exista la FK declarada entre las dos tablas, y si algún día alguien
    // la borra esto fallaría en silencio justo cuando más se necesita.
    const { data: sups } = await supabase
      .from('perfiles')
      .select('id, id_empresa, rol')
      .in('rol', [...ROLES_SUPERVISOR, 'superadmin'])
      .eq('activo', true)
    const { data: disp } = await supabase
      .from('estado_dispositivo')
      .select('id_usuario, fcm_token')
      .not('fcm_token', 'is', null)
    const tokenDe = new Map((disp || []).map((d: Record<string, any>) => [d.id_usuario, d.fcm_token as string]))
    const destinos = (sups || [])
      .map((s: Record<string, any>) => ({
        id: s.id as string,
        empresa: s.id_empresa as string,
        global: s.rol === 'superadmin',
        token: tokenDe.get(s.id) || null,
      }))
      .filter((d) => !!d.token)

    const accessToken = await getAccessToken(sa)
    let enviados = 0, fallidos = 0, omitidos = 0
    const errores: string[] = []
    const tokensMuertos = new Set<string>()

    const mandar = async (idEmpresa: string, sujeto: string, titulo: string, cuerpo: string, tag: string, data: Record<string, string>) => {
      // El SUJETO del aviso nunca lo recibe: un encargado es a la vez supervisado y supervisor, y
      // avisarle a él que dejó de reportar no le sirve a nadie.
      const para = destinos.filter((d) => (d.global || d.empresa === idEmpresa) && d.id !== sujeto)
      if (!para.length) { omitidos++; return }
      for (const d of para) {
        if (tokensMuertos.has(d.id)) continue // ya sabemos que su token no sirve
        const r = await enviarPush({ accessToken, projectId: sa.project_id, token: d.token!, titulo, cuerpo, tag, data })
        if (r.ok) { enviados++; continue }
        fallidos++
        if (r.muerto) tokensMuertos.add(d.id)
        if (r.error && errores.length < 10) errores.push(r.error)
      }
    }

    for (const a of nuevas) {
      const f = porUsuario.get(a.id_usuario)
      const quien = f?.nombre || 'Un móvil'
      const min = a.minutos ?? 0
      const titulo = a.tipo === 'sin_reportar' ? `Sin reportar · ${quien}` : `Quieto ${dur(min)} · ${quien}`
      let cuerpo = a.tipo === 'sin_reportar'
        ? `Hace ${dur(min)} que no manda ubicación. Última señal ${hhmm(a.desde)}.`
        : `Sigue reportando pero no se movió desde las ${hhmm(a.desde)}.`
      if (a.motivo) cuerpo += ` (${a.motivo})`
      await mandar(a.id_empresa, a.id_usuario, titulo, cuerpo, `lu-alerta-${a.id_usuario}-${a.tipo}`,
        { clase: a.tipo, id_usuario: a.id_usuario, alerta_id: a.id })
    }
    if (nuevas.length) {
      await supabase
        .from('alertas_equipo')
        .update({ avisada_ts: new Date().toISOString() })
        .in('id', nuevas.map((a) => a.id))
    }

    for (const a of cierresAvisables) {
      const f = porUsuario.get(a.id_usuario)
      const quien = f?.nombre || 'Un móvil'
      const titulo = a.tipo === 'sin_reportar' ? `Volvió a reportar · ${quien}` : `Se movió · ${quien}`
      const cuerpo = a.tipo === 'sin_reportar'
        ? `Estuvo ${dur(a.minutos ?? 0)} sin mandar ubicación.`
        : `Estuvo ${dur(a.minutos ?? 0)} en el mismo lugar.`
      await mandar(a.id_empresa, a.id_usuario, titulo, cuerpo, `lu-alerta-${a.id_usuario}-${a.tipo}`,
        { clase: 'resuelta', id_usuario: a.id_usuario })
    }

    // Limpieza de tokens muertos. Se hace al final y en un solo update para no interferir con el
    // envío. `estado_dispositivo` lo vuelve a llenar solo la próxima vez que ese teléfono abra la
    // app y se registre en FCM.
    if (tokensMuertos.size) {
      await supabase
        .from('estado_dispositivo')
        .update({ fcm_token: null })
        .in('id_usuario', [...tokensMuertos])
    }

    // Los contadores viajan SIEMPRE en la respuesta: un tope o un fallo silencioso hace que esto
    // parezca funcionar durante semanas. Misma regla que `truncados` en snap-recorridos.
    return json({
      evaluados: vig.length,
      abiertas: nuevas.length,
      cerradas: aCerrar.length,
      enviados,
      fallidos,
      omitidos,
      destinatarios: destinos.length,
      tokens_muertos: tokensMuertos.size,
      errores,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
