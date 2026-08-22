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

// Quién recibe avisos. El `superadmin` los recibe de TODAS las empresas: es quien opera el SaaS,
// no un supervisor de un tenant.
//
// 🩸 `'propietario'` estaba acá y era un rol MUERTO: se eliminó en `db/31` el 10/08/2026. No hacía
// daño (ningún perfil lo tiene) pero es exactamente el tipo de lista que hace creer que un rol
// sigue vivo.
const ROLES_SUPERVISOR = ['admin', 'encargado']

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

    // ---- 3) Destinatarios: supervisores con token, y la JERARQUÍA.
    //
    // 🩸 EL PUSH IGNORABA LA JERARQUÍA Y LA CAMPANITA NO (22/08/2026, reporte del cliente: "las
    // notificaciones llegan a todos por igual"). Esto seleccionaba por `rol` + `activo` y filtraba
    // solo por `id_empresa`: cualquier encargado recibía el aviso de CUALQUIER persona de su
    // empresa. Y lo peor no es que llegaran de más — es que `alertas_sel` (la campanita) SÍ obedece
    // `ids_a_mi_cargo()` desde `db/40`. Así que el encargado recibía "Sin reportar · Fulano", tocaba
    // el cartel, abría la campanita… y el aviso NO estaba, porque RLS se lo filtraba.
    // **El push estaba filtrando información que la policy protege.**
    //
    // La regla vive en `ids_a_mi_cargo()` (`db/40`) y acá se aplica INVERTIDA: en vez de "a quiénes
    // veo", "quiénes me ven". No se puede llamar a esa función desde acá — corre como `service_role`,
    // que no tiene sesión — así que la regla se replica, y por eso queda escrita al lado de `aCargo`
    // con la referencia al SQL que manda. Si `db/40` cambia, esto cambia.
    //
    // Una sola consulta a `perfiles` en vez de dos: hace falta el `nivel` de TODOS (el de los
    // supervisores para saber hasta dónde llegan, y el de los sujetos para saber a quién alcanzan).
    // La tabla tiene ~15 filas; si alguna vez pasa las 1.000 de PostgREST, esto hay que paginarlo.
    const { data: perfiles } = await supabase
      .from('perfiles')
      .select('id, id_empresa, rol, nivel, activo')
    const nivelDe = new Map<string, number>(
      (perfiles || []).map((f: Record<string, any>) => [f.id as string, Number(f.nivel ?? 0)]),
    )
    // Dos consultas y el join en JS, a propósito: el embed `estado_dispositivo(fcm_token)` de
    // PostgREST depende de que exista la FK declarada entre las dos tablas, y si algún día alguien
    // la borra esto fallaría en silencio justo cuando más se necesita.
    const { data: disp } = await supabase
      .from('estado_dispositivo')
      .select('id_usuario, fcm_token, app_version')
      .not('fcm_token', 'is', null)
    const dispDe = new Map((disp || []).map((d: Record<string, any>) => [d.id_usuario, d]))
    const destinos = (perfiles || [])
      .filter((f: Record<string, any>) => f.activo && [...ROLES_SUPERVISOR, 'superadmin'].includes(f.rol))
      .map((f: Record<string, any>) => {
        const d = dispDe.get(f.id as string)
        return {
          id: f.id as string,
          empresa: f.id_empresa as string,
          rol: f.rol as string,
          nivel: Number(f.nivel ?? 0),
          global: f.rol === 'superadmin',
          token: (d?.fcm_token as string) || null,
          // Ver VER_CANAL: a un APK viejo NO se le manda channel_id o se queda mudo.
          canal: versionOk(d?.app_version ?? null, VER_CANAL) ? CANAL_AVISOS : null,
        }
      })
      .filter((d) => !!d.token)
    type Destino = typeof destinos[number]

    /**
     * ¿El destino `d` tiene a `sujeto` a su cargo? Es `ids_a_mi_cargo()` (`db/40`) dado vuelta,
     * regla por regla:
     *   · superadmin → todos, de todas las empresas
     *   · admin      → toda su empresa
     *   · encargado  → su empresa Y `nivel(sujeto) < greatest(nivel(encargado), 1)`
     *
     * El `greatest(…, 1)` no es un detalle: un encargado al que nadie le puso nivel queda en 0, y sin
     * ese piso no supervisaría ni a un vendedor. Hoy en la base hay exactamente ese caso.
     *
     * Y el SUJETO nunca recibe su propio aviso: un encargado es a la vez supervisado y supervisor, y
     * avisarle a él que dejó de reportar no le sirve a nadie.
     */
    const aCargo = (d: Destino, sujeto: string, empresaSujeto: string) => {
      if (d.id === sujeto) return false
      if (d.global) return true
      if (d.empresa !== empresaSujeto) return false
      if (d.rol === 'admin') return true
      if (d.rol !== 'encargado') return false
      return (nivelDe.get(sujeto) ?? 0) < Math.max(d.nivel, 1)
    }

    /** A quiénes les corresponde el aviso sobre `sujeto`. */
    const destinatariosDe = (sujeto: string, empresaSujeto: string) =>
      destinos.filter((d) => aCargo(d, sujeto, empresaSujeto))

    const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') || '{}')
    const hayFcm = !!(sa.client_email && sa.private_key && sa.project_id)
    let accessToken: string | null = null
    let enviados = 0, fallidos = 0, omitidos = 0
    const errores: string[] = []
    const tokensMuertos = new Set<string>()

    /**
     * Manda a una lista YA RESUELTA de destinatarios.
     *
     * 🩸 Antes esto recibía `idEmpresa` y armaba la lista solo. Ahora la arma quien llama, con
     * `destinatariosDe()`, porque con jerarquía **el mensaje depende de quién lo recibe**: el
     * agrupado ("3 móviles sin reportar") tiene que contar a la gente de ESE supervisor y no a la de
     * la empresa. Decirle "3" a quien tiene 1 a cargo es tan incorrecto como mandarle el aviso ajeno.
     *
     * `omitidos` cuenta los avisos que no le tocan a nadie — con jerarquía eso deja de ser
     * imposible: alguien de nivel alto puede no tener a nadie por encima.
     */
    const enviarA = async (para: Destino[], titulo: string, cuerpo: string, tag: string, data: Record<string, string>) => {
      if (!accessToken) return
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
      // 🩸 EL RESUMEN TAMBIÉN ES POR DESTINATARIO (22/08/2026). Antes se agrupaba por empresa y
      // salía un solo texto para todos sus supervisores. Con jerarquía eso miente dos veces: le
      // nombra al encargado gente que no supervisa, y le cuenta un total que no es el suyo.
      let mandados = 0
      for (const d of destinos) {
        const suyas = vig.filter((f) => aCargo(d, f.id_usuario, f.id_empresa))
        const txt = textoResumen(suyas, minSil)
        if (!txt) continue // nadie a cargo en ventana: no se manda nada
        mandados++
        // 🩸 `tag` FIJO: es lo que hace que "se actualice cada hora" sea literal — Android REEMPLAZA
        // el cartel anterior con el mismo tag. Con un tag distinto por hora, el supervisor terminaría
        // el día con doce tarjetas apiladas diciendo casi lo mismo. Ya no lleva el id de empresa
        // porque ahora se manda de a un destinatario, y un teléfono es de una sola persona.
        //
        // Límite honesto: FCM no puede CANCELAR una notificación ya entregada, así que el último
        // resumen se queda hasta que alguien lo descarte. Fuera de la ventana simplemente no se
        // manda uno nuevo.
        await enviarA([d], txt.titulo, txt.cuerpo, 'lu-resumen', { clase: 'resumen' })
      }
      await limpiarMuertos()
      return json({
        resumen: true, evaluados: vig.length, con_resumen: mandados, enviados, fallidos, omitidos,
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

    // 🩸 EL BURST, AGRUPADO — Y AGRUPADO POR DESTINATARIO (22/08/2026). Si en la misma pasada se
    // abren varios incidentes, a cada supervisor le va UN cartel. Seis notificaciones seguidas no
    // informan seis veces más: enseñan a ignorarlas.
    //
    // El agrupamiento era por EMPRESA y ahora es por PERSONA, porque con jerarquía el conteo cambia
    // según quién mira: si se abren 3 incidentes y un encargado supervisa a 1 de esos 3, tiene que
    // recibir el aviso individual de ese, no un "3 móviles sin reportar" que incluye a dos personas
    // que ni siquiera puede ver en la campanita.
    const porDestino = new Map<string, { d: Destino; lista: Record<string, any>[] }>()
    for (const a of pushables) {
      for (const d of destinatariosDe(a.id_usuario, a.id_empresa)) {
        const e = porDestino.get(d.id) || { d, lista: [] }
        e.lista.push(a)
        porDestino.set(d.id, e)
      }
    }
    // Un incidente que no le toca a NADIE igual queda abierto y sellado como avisado: el panel lo
    // muestra y el resumen lo cuenta. Lo que no hace es interrumpir a alguien que no corresponde.
    for (const { d, lista } of porDestino.values()) {
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
        await enviarA([d], titulo, cuerpo, `lu-alerta-${a.id_usuario}-${a.tipo}`,
          { clase: a.tipo, id_usuario: a.id_usuario, alerta_id: a.id })
        continue
      }
      // Agrupado: el `tag` es fijo porque va a UN teléfono, y un teléfono es de una sola persona.
      // El detalle está en el panel y en el resumen.
      const nombres = lista.slice(0, 3).map((a) => corto(porUsuario.get(a.id_usuario)?.nombre ?? null))
      if (lista.length > 3) nombres.push(`y ${lista.length - 3} más`)
      await enviarA([d], `${lista.length} móviles sin reportar`,
        `${nombres.join(', ')}. Miralos en el panel del equipo.`,
        'lu-alerta-grupo', { clase: 'grupo' })
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
      await enviarA(destinatariosDe(a.id_usuario, a.id_empresa), titulo, cuerpo, `lu-alerta-${a.id_usuario}-${a.tipo}`,
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
