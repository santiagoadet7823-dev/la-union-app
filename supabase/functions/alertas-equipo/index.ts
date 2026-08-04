// Edge Function: avisar al supervisor cuando alguien del equipo deja de reportar o queda quieto,
// y —desde el 04/08/2026— mandarle un RESUMEN por hora del estado del equipo.
//
// La invoca pg_cron: cada 10 min sin parámetros (incidentes) y una vez por hora con `?resumen=1`.
// **Esta función no detecta nada**: la detección entera vive en la función SQL `vigilancia_equipo`
// (db/26). Acá solo se decide, se abre/cierra el incidente y se manda el push. La razón es de
// verificabilidad: una función SQL pura se prueba con un `select` contra la base viva, sin desplegar
// nada y sin esperar a que corra un cron.
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
// 🩸 QUÉ MERECE INTERRUMPIR A ALGUIEN (04/08/2026). Medido sobre el 03/08: a las 08:00, apertura de
// la ventana de rastreo, se abrieron **6 incidentes de golpe** —todos los que tenían el teléfono
// apagado— y después, durante 9 horas, no salió ni uno más aunque siguieran mudos. Cuatro de esos
// seis eran de gente que directamente no usa la app. Un supervisor que recibe seis carteles juntos a
// la mañana y silencio el resto del día aprende a ignorar los carteles, que es lo peor que le puede
// pasar a un sistema de avisos. Tres cambios, y ninguno toca la DETECCIÓN ni el histórico:
//   1. **"Nunca arrancó" no es "dejó de reportar".** Quien no encendió el teléfono no protagoniza una
//      transición: es un estado, y va al resumen, no a un push individual. El incidente se abre
//      igual (el panel y el histórico no cambian); lo que no sale es la interrupción.
//   2. **Si en la misma pasada se abren varios, va UN push agrupado.**
//   3. **Resumen por hora** con `tag` fijo: Android REEMPLAZA el cartel anterior, así que el
//      supervisor termina con UNA tarjeta que se actualiza sola en vez de doce.
//
// SECRETO requerido: FCM_SERVICE_ACCOUNT (el mismo que usan push-heartbeat y push-actualizacion).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarPush, getAccessToken } from './fcm.ts'

// Quién recibe los avisos de una empresa. El `superadmin` los recibe de TODAS: es quien opera el
// SaaS, no un supervisor de un tenant.
const ROLES_SUPERVISOR = ['admin', 'encargado', 'propietario']

/**
 * 🩸 Primera versión del APK que tiene el canal `avisos` creado al arrancar (LaUnionApp.java).
 * Mandarle `channel_id` a un teléfono más viejo lo dejaría MUDO —el canal no existe y Android 8+
 * descarta la notificación en silencio—, así que se decide por teléfono. Ver el 🩸 de fcm.ts.
 */
const VER_CANAL = '1.10.0'
const CANAL_AVISOS = 'avisos'

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

/** Solo el primer nombre: en un cuerpo de una línea, los apellidos gastan lugar sin informar. */
const corto = (n: string | null) => (n || 'Un móvil').split(' ')[0]

/** Compara 'a.b.c': true si `a` es mayor o igual que `b`. */
function versionOk(a: string | null, b: string): boolean {
  if (!a) return false
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0
  }
  return true
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

/**
 * El texto del resumen de una empresa. Devuelve null si no hay NADIE en ventana: fuera del horario
 * de todos no hay nada que resumir, y un cartel de madrugada no lo arregla nadie.
 *
 * Tres grupos, y la distinción del medio es la que hace útil al resumen:
 *   · SIN REPORTAR — estaba reportando y se cortó. Es lo que de verdad hay que mirar.
 *   · NO ARRANCARON — no mandaron un solo punto desde que abrió su ventana. Puede ser que el
 *     teléfono esté apagado, que la persona no salga hoy, o que nunca haya instalado la app.
 *   · el resto reporta.
 *
 * Los nombres se cortan en 3 porque el cuerpo de una notificación FCM es UNA LÍNEA: `BigTextStyle`
 * no se puede pedir desde el bloque `notification` (con la app abierta sí, y ahí lo hace `push.js`).
 */
function textoResumen(filas: FilaVigilancia[], minSil: number): { titulo: string; cuerpo: string } | null {
  const dentro = filas.filter((f) => f.en_ventana)
  if (!dentro.length) return null
  const mudos = dentro
    .filter((f) => f.ultimo_ts && f.minutos_silencio >= minSil)
    .sort((a, b) => b.minutos_silencio - a.minutos_silencio)
  const noArrancaron = dentro.filter((f) => !f.ultimo_ts)
  const reportando = dentro.length - mudos.length - noArrancaron.length

  if (!mudos.length && !noArrancaron.length) {
    return { titulo: 'Equipo · todo en orden', cuerpo: `${reportando} móviles reportando.` }
  }
  const partes: string[] = []
  if (mudos.length) {
    const nombres = mudos.slice(0, 3).map((f) => `${corto(f.nombre)} ${dur(f.minutos_silencio)}`)
    if (mudos.length > 3) nombres.push(`y ${mudos.length - 3} más`)
    partes.push(nombres.join(' · '))
  }
  if (noArrancaron.length) {
    const nombres = noArrancaron.slice(0, 3).map((f) => corto(f.nombre))
    if (noArrancaron.length > 3) nombres.push(`y ${noArrancaron.length - 3} más`)
    partes.push(`Sin arrancar: ${nombres.join(', ')}`)
  }
  partes.push(`${reportando} reportando`)
  const titulo = mudos.length
    ? `Equipo · ${mudos.length} sin reportar`
    : `Equipo · ${noArrancaron.length} sin arrancar`
  return { titulo, cuerpo: partes.join(' — ') }
}

Deno.serve(async (req) => {
  try {
    const esResumen = new URL(req.url).searchParams.get('resumen') === '1'
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

    // ---- 3) Destinatarios: supervisores con token. Los superadmin reciben de TODAS las empresas —
    // son quienes operan el SaaS, no supervisores de un tenant.
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
      .select('id_usuario, fcm_token, app_version')
      .not('fcm_token', 'is', null)
    const dispDe = new Map((disp || []).map((d: Record<string, any>) => [d.id_usuario, d]))
    const destinos = (sups || [])
      .map((s: Record<string, any>) => {
        const d = dispDe.get(s.id as string)
        return {
          id: s.id as string,
          empresa: s.id_empresa as string,
          global: s.rol === 'superadmin',
          token: (d?.fcm_token as string) || null,
          // Ver VER_CANAL: a un APK viejo NO se le manda channel_id o se queda mudo.
          canal: versionOk(d?.app_version ?? null, VER_CANAL) ? CANAL_AVISOS : null,
        }
      })
      .filter((d) => !!d.token)

    const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') || '{}')
    const hayFcm = !!(sa.client_email && sa.private_key && sa.project_id)
    let accessToken: string | null = null
    let enviados = 0, fallidos = 0, omitidos = 0
    const errores: string[] = []
    const tokensMuertos = new Set<string>()

    /** Manda a los supervisores de `idEmpresa` (más los superadmin), salteando al sujeto del aviso. */
    const mandar = async (idEmpresa: string, sujeto: string | null, titulo: string, cuerpo: string, tag: string, data: Record<string, string>) => {
      if (!accessToken) return
      // El SUJETO del aviso nunca lo recibe: un encargado es a la vez supervisado y supervisor, y
      // avisarle a él que dejó de reportar no le sirve a nadie.
      const para = destinos.filter((d) => (d.global || d.empresa === idEmpresa) && d.id !== sujeto)
      if (!para.length) { omitidos++; return }
      for (const d of para) {
        if (tokensMuertos.has(d.id)) continue // ya sabemos que su token no sirve
        const r = await enviarPush({ accessToken, projectId: sa.project_id, token: d.token!, titulo, cuerpo, tag, canal: d.canal, data })
        if (r.ok) { enviados++; continue }
        fallidos++
        if (r.muerto) tokensMuertos.add(d.id)
        if (r.error && errores.length < 10) errores.push(r.error)
      }
    }

    /** Limpieza de tokens muertos. Al final y en un solo update, para no interferir con el envío. */
    const limpiarMuertos = async () => {
      if (!tokensMuertos.size) return
      await supabase.from('estado_dispositivo').update({ fcm_token: null }).in('id_usuario', [...tokensMuertos])
    }

    // ================================================================= RESUMEN POR HORA
    if (esResumen) {
      if (!hayFcm) return json({ error: 'Falta FCM_SERVICE_ACCOUNT' }, 500)
      accessToken = await getAccessToken(sa)
      const porEmpresa = new Map<string, FilaVigilancia[]>()
      for (const f of vig) {
        const arr = porEmpresa.get(f.id_empresa) || []
        arr.push(f)
        porEmpresa.set(f.id_empresa, arr)
      }
      let empresas = 0
      for (const [idEmpresa, filasEmpresa] of porEmpresa) {
        const txt = textoResumen(filasEmpresa, minSil)
        if (!txt) continue // nadie en ventana: no se manda nada
        empresas++
        // 🩸 `tag` FIJO por empresa: es lo que hace que "se actualice cada hora" sea literal — Android
        // REEMPLAZA el cartel anterior con el mismo tag. Con un tag distinto por hora, el supervisor
        // terminaría el día con doce tarjetas apiladas diciendo casi lo mismo.
        //
        // Límite honesto: FCM no puede CANCELAR una notificación ya entregada, así que el último
        // resumen se queda hasta que alguien lo descarte. Fuera de la ventana simplemente no se
        // manda uno nuevo.
        await mandar(idEmpresa, null, txt.titulo, txt.cuerpo, `lu-resumen-${idEmpresa}`, { clase: 'resumen' })
      }
      await limpiarMuertos()
      return json({
        resumen: true, evaluados: vig.length, empresas, enviados, fallidos, omitidos,
        destinatarios: destinos.length, tokens_muertos: tokensMuertos.size, errores,
      })
    }

    // ================================================================= INCIDENTES (cada 10 min)
    // ---- 4) Qué corresponde AHORA, por persona.
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

    // ---- 5) Qué hay abierto.
    const { data: abiertasRaw, error: errAb } = await supabase
      .from('alertas_equipo')
      .select('id, id_empresa, id_usuario, tipo, desde, avisada_ts, minutos, motivo')
      .is('resuelta_ts', null)
    if (errAb) return json({ error: 'alertas_equipo: ' + errAb.message }, 500)
    const abiertas: Record<string, any>[] = abiertasRaw || []
    const clave = (u: string, t: string) => `${u}|${t}`
    const yaAbierto = new Map(abiertas.map((a) => [clave(a.id_usuario, a.tipo), a]))

    // ---- 6) Abrir lo que falta.
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

    // ---- 7) Cerrar lo que ya no corresponde, y refrescar minutos/motivo de lo que sigue abierto.
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

    // ---- 8) Push. Solo por APERTURAS nuevas y por CIERRES que ya se habían avisado (si nadie supo
    //         del problema, avisar que se resolvió es ruido).
    //
    // 🩸 Y solo por las que son una TRANSICIÓN. Quien nunca mandó un punto hoy (`ultimo_ts` null) no
    // "dejó de reportar": no arrancó. El incidente se abre igual —el panel lo muestra y el histórico
    // lo guarda— pero no interrumpe a nadie: eso lo cuenta el resumen. Es lo que convierte los 6
    // carteles de las 08:00 en una línea de una tarjeta.
    const arranco = (uid: string) => !!porUsuario.get(uid)?.ultimo_ts
    const pushables = nuevas.filter((a) => a.tipo !== 'sin_reportar' || arranco(a.id_usuario))
    const cierresAvisables = aCerrar.filter((a) => a.avisada_ts)
    if (!pushables.length && !cierresAvisables.length) {
      return json({
        evaluados: vig.length, abiertas: nuevas.length, sin_push: nuevas.length - pushables.length,
        cerradas: aCerrar.length, enviados: 0, fallidos: 0, omitidos: 0,
      })
    }
    if (!hayFcm) {
      return json({ error: 'Falta FCM_SERVICE_ACCOUNT', abiertas: nuevas.length, cerradas: aCerrar.length }, 500)
    }
    accessToken = await getAccessToken(sa)

    // 🩸 EL BURST, AGRUPADO. Si en la misma pasada se abren varios incidentes de una empresa, va UN
    // cartel. Seis notificaciones seguidas no informan seis veces más: enseñan a ignorarlas.
    const porEmpresaNuevas = new Map<string, Record<string, any>[]>()
    for (const a of pushables) {
      const arr = porEmpresaNuevas.get(a.id_empresa) || []
      arr.push(a)
      porEmpresaNuevas.set(a.id_empresa, arr)
    }
    for (const [idEmpresa, lista] of porEmpresaNuevas) {
      if (lista.length === 1) {
        const a = lista[0]
        const f = porUsuario.get(a.id_usuario)
        const quien = f?.nombre || 'Un móvil'
        const min = a.minutos ?? 0
        const titulo = a.tipo === 'sin_reportar' ? `Sin reportar · ${quien}` : `Quieto ${dur(min)} · ${quien}`
        let cuerpo = a.tipo === 'sin_reportar'
          ? `Hace ${dur(min)} que no manda ubicación. Última señal ${hhmm(a.desde)}.`
          : `Sigue reportando pero no se movió desde las ${hhmm(a.desde)}.`
        if (a.motivo) cuerpo += ` (${a.motivo})`
        await mandar(idEmpresa, a.id_usuario, titulo, cuerpo, `lu-alerta-${a.id_usuario}-${a.tipo}`,
          { clase: a.tipo, id_usuario: a.id_usuario, alerta_id: a.id })
        continue
      }
      // Agrupado: el `tag` es de la empresa, no de una persona. El sujeto se pasa null porque son
      // varios y no hay uno solo al que saltear; el detalle está en el panel y en el resumen.
      const nombres = lista.slice(0, 3).map((a) => corto(porUsuario.get(a.id_usuario)?.nombre ?? null))
      if (lista.length > 3) nombres.push(`y ${lista.length - 3} más`)
      await mandar(idEmpresa, null, `${lista.length} móviles sin reportar`,
        `${nombres.join(', ')}. Miralos en el panel del equipo.`,
        `lu-alerta-grupo-${idEmpresa}`, { clase: 'grupo' })
    }
    if (pushables.length) {
      await supabase
        .from('alertas_equipo')
        .update({ avisada_ts: new Date().toISOString() })
        .in('id', pushables.map((a) => a.id))
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

    await limpiarMuertos()

    // Los contadores viajan SIEMPRE en la respuesta: un tope o un fallo silencioso hace que esto
    // parezca funcionar durante semanas. Misma regla que `truncados` en snap-recorridos.
    // `sin_push` es el nuevo: cuántos incidentes se abrieron sin interrumpir a nadie (los que nunca
    // arrancaron). Si ese número crece y `abiertas` no, no hay una falla nueva: hay teléfonos que no
    // se encienden.
    return json({
      evaluados: vig.length,
      abiertas: nuevas.length,
      sin_push: nuevas.length - pushables.length,
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
