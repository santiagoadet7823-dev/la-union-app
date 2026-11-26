// Edge Function: monitoreo de teléfonos designados por el superadmin (plan 54, db/116).
//
// La invoca pg_cron cada 5 min (`monitoreo-dispositivos-5min`). Como en alertas-equipo, la detección
// vive en SQL (`vigilancia_monitoreo()`, solo service_role) y acá se abre/cierra el registro en
// `dispositivo_alertas` y se mandan los push:
//   · al TELÉFONO (R1): batería crítica o ahorro prendido, solo dentro de su ventana de rastreo y
//     con un recordatorio cada 30 min mientras siga abierta. Llega con la app cerrada.
//   · al SUPERADMIN (R2): se apagó por batería, sin señal en horario o entró en batería crítica.
//     Una vez por incidente (`aviso_admin_ts`).
// Solo cuentan teléfonos con APK piloto (>= 1.46.1): `vigilancia_monitoreo` ya los filtra.
//
// El antirrebote es el índice único parcial `dispositivo_alertas_abierta_uidx (id_usuario, tipo)
// where cerrada_ts is null`: una sola abierta por persona y tipo.
//
// `?probar=1` devuelve lo que haría sin escribir ni mandar nada.
//
// SECRETO requerido: FCM_SERVICE_ACCOUNT. `fcm.ts` es copia del de alertas-equipo (no hay imports
// entre carpetas de functions).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enviarPush, getAccessToken } from './fcm.ts'

const CANAL_AVISOS = 'avisos'
const VER_CANAL = '1.10.0'
const RECORDATORIO_MIN = 30
const TIPOS_SERVIDOR = ['bateria_critica', 'ahorro', 'apagado_bateria', 'sin_senal']
const AL_TELEFONO = new Set(['bateria_critica', 'ahorro'])
const AL_SUPERADMIN = new Set(['bateria_critica', 'apagado_bateria', 'sin_senal'])

interface Fila {
  id_usuario: string
  id_empresa: string
  nombre: string | null
  bateria_min: number
  push: boolean
  alerta_superadmin: boolean
  aviso_ahorro: boolean
  fcm_token: string | null
  apk_version: string | null
  bateria: number | null
  cargando: boolean | null
  ahorro: boolean
  en_ventana: boolean
  ultima_senal: string | null
  minutos_silencio: number | null
  bateria_critica: boolean
  apagado_bateria: boolean
  sin_senal: boolean
}

interface Alerta {
  id: number
  id_usuario: string
  tipo: string
  origen: string
  abierta_ts: string
  push_ts: string | null
  push_n: number
  aviso_admin_ts: string | null
}

const COLS = 'id, id_usuario, tipo, origen, abierta_ts, push_ts, push_n, aviso_admin_ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

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
 * Qué dice el servidor de cada tipo: true = abrir, false = cerrar, null = no decide (sin dato fresco).
 * La batería crítica se cierra solo con nivel >= umbral (cargar sin llegar no alcanza, como en el
 * teléfono), y solo con un dato de los últimos 20 min.
 */
function decide(f: Fila, tipo: string): boolean | null {
  switch (tipo) {
    case 'bateria_critica':
      if (f.bateria == null || f.minutos_silencio == null || f.minutos_silencio > 20) return null
      return f.bateria < f.bateria_min
    case 'ahorro':
      if (!f.aviso_ahorro) return false
      if (f.minutos_silencio == null || f.minutos_silencio > 20) return null
      return !!f.ahorro
    case 'apagado_bateria': return !!f.apagado_bateria
    case 'sin_senal': return !!f.sin_senal
    default: return null
  }
}

function textoTelefono(tipo: string, f: Fila): { titulo: string; cuerpo: string } {
  if (tipo === 'ahorro') {
    return { titulo: 'Ahorro de energía prendido', cuerpo: 'Con la pantalla apagada el GPS no funciona. Desactivalo.' }
  }
  return {
    titulo: `Batería crítica${f.bateria != null ? `: ${f.bateria} %` : ''}`,
    cuerpo: `Poné el teléfono a cargar. El aviso se quita al llegar a ${f.bateria_min} %.`,
  }
}

function textoAdmin(tipo: string, f: Fila): { titulo: string; cuerpo: string } {
  const quien = f.nombre || 'Teléfono monitoreado'
  if (tipo === 'apagado_bateria') {
    return { titulo: `Se apagó por batería · ${quien}`, cuerpo: `Último dato con ${f.bateria ?? '—'} %, hace ${f.minutos_silencio ?? '—'} min.` }
  }
  if (tipo === 'sin_senal') {
    return { titulo: `Sin señal · ${quien}`, cuerpo: `Hace ${f.minutos_silencio ?? '—'} min que no reporta, en horario de trabajo.` }
  }
  return { titulo: `Batería crítica · ${quien}`, cuerpo: `Entró en crítico con ${f.bateria ?? '—'} % (umbral ${f.bateria_min} %).` }
}

Deno.serve(async (req) => {
  try {
    const probar = new URL(req.url).searchParams.get('probar') === '1'
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const { data: filas, error: errVig } = await supabase.rpc('vigilancia_monitoreo')
    if (errVig) return json({ error: 'vigilancia_monitoreo: ' + errVig.message }, 500)
    const vig = (filas || []) as Fila[]
    if (!vig.length) return json({ monitoreados: 0, abiertas: 0, cerradas: 0, push_telefono: 0, push_admin: 0 })

    const { data: abData, error: errAb } = await supabase
      .from('dispositivo_alertas')
      .select(COLS)
      .in('id_usuario', vig.map((f) => f.id_usuario))
      .is('cerrada_ts', null)
    if (errAb) return json({ error: 'dispositivo_alertas: ' + errAb.message }, 500)
    const abiertas = new Map<string, Alerta>()
    for (const a of (abData || []) as Alerta[]) abiertas.set(`${a.id_usuario}|${a.tipo}`, a)

    const aAbrir: Record<string, unknown>[] = []
    const aCerrar: { id: number; clave: string; bateria: number | null }[] = []
    for (const f of vig) {
      for (const tipo of TIPOS_SERVIDOR) {
        const on = decide(f, tipo)
        if (on == null) continue
        const clave = `${f.id_usuario}|${tipo}`
        const ab = abiertas.get(clave)
        if (on && !ab) {
          aAbrir.push({ id_usuario: f.id_usuario, id_empresa: f.id_empresa, tipo, origen: 'servidor', bateria_pct: f.bateria })
        } else if (!on && ab) {
          aCerrar.push({ id: ab.id, clave, bateria: f.bateria })
        }
      }
    }

    if (probar) return json({ probar: true, monitoreados: vig.length, abrir: aAbrir, cerrar: aCerrar, vig })

    let nuevas = 0
    for (const fila of aAbrir) {
      const { data, error } = await supabase.from('dispositivo_alertas').insert(fila).select(COLS).maybeSingle()
      if (error) {
        if (error.code === '23505') continue
        return json({ error: 'insert: ' + error.message }, 500)
      }
      if (data) { nuevas++; abiertas.set(`${data.id_usuario}|${data.tipo}`, data as Alerta) }
    }
    for (const c of aCerrar) {
      await supabase.from('dispositivo_alertas')
        .update({ cerrada_ts: new Date().toISOString(), bateria_cierre: c.bateria })
        .eq('id', c.id).is('cerrada_ts', null)
      abiertas.delete(c.clave)
    }

    const porId = new Map(vig.map((f) => [f.id_usuario, f]))
    const paraTel = [...abiertas.values()].filter((a) => {
      const f = porId.get(a.id_usuario)
      if (!AL_TELEFONO.has(a.tipo) || !f || !f.push || !f.en_ventana || !f.fcm_token) return false
      return !a.push_ts || Date.now() - new Date(a.push_ts).getTime() >= RECORDATORIO_MIN * 60000
    })
    const paraAdmin = [...abiertas.values()].filter((a) => {
      const f = porId.get(a.id_usuario)
      if (!AL_SUPERADMIN.has(a.tipo) || a.aviso_admin_ts || !f || !f.alerta_superadmin) return false
      return a.tipo === 'bateria_critica' || f.en_ventana
    })
    if (!paraTel.length && !paraAdmin.length) {
      return json({ monitoreados: vig.length, abiertas: nuevas, cerradas: aCerrar.length, push_telefono: 0, push_admin: 0 })
    }

    const sa = JSON.parse(Deno.env.get('FCM_SERVICE_ACCOUNT') || '{}')
    if (!sa.client_email) {
      return json({ error: 'Falta FCM_SERVICE_ACCOUNT', abiertas: nuevas, cerradas: aCerrar.length }, 500)
    }
    const accessToken = await getAccessToken(sa)
    const tokensMuertos = new Set<string>()
    const errores: string[] = []

    let pushTel = 0
    for (const a of paraTel) {
      const f = porId.get(a.id_usuario)!
      const t = textoTelefono(a.tipo, f)
      const r = await enviarPush({
        accessToken, projectId: sa.project_id, token: f.fcm_token!,
        titulo: t.titulo, cuerpo: t.cuerpo, tag: `monitoreo-${a.tipo}`, canal: CANAL_AVISOS,
        data: { tipo: 'monitoreo', alerta: a.tipo },
      })
      if (r.ok) {
        pushTel++
        await supabase.from('dispositivo_alertas')
          .update({ push_ts: new Date().toISOString(), push_n: (a.push_n || 0) + 1 }).eq('id', a.id)
      } else {
        if (r.muerto) tokensMuertos.add(f.id_usuario)
        errores.push(`tel ${f.nombre}: ${r.error}`)
      }
    }

    let pushAdmin = 0
    if (paraAdmin.length) {
      const { data: supers } = await supabase.from('perfiles').select('id').eq('rol', 'superadmin').eq('activo', true)
      const idsSuper = (supers || []).map((s: Record<string, unknown>) => s.id as string)
      const { data: dispSuper } = idsSuper.length
        ? await supabase.from('estado_dispositivo').select('id_usuario, fcm_token, app_version')
          .in('id_usuario', idsSuper).not('fcm_token', 'is', null)
        : { data: [] as Record<string, string>[] }
      const destinos = (dispSuper || []) as Record<string, string>[]
      for (const a of paraAdmin) {
        const f = porId.get(a.id_usuario)!
        const t = textoAdmin(a.tipo, f)
        let alguno = false
        for (const d of destinos) {
          const r = await enviarPush({
            accessToken, projectId: sa.project_id, token: d.fcm_token,
            titulo: t.titulo, cuerpo: t.cuerpo, tag: `monitoreo-${a.id_usuario}-${a.tipo}`,
            canal: versionOk(d.app_version ?? null, VER_CANAL) ? CANAL_AVISOS : null,
            data: { tipo: 'alerta', id_usuario: a.id_usuario, alerta: a.tipo },
          })
          if (r.ok) { alguno = true; pushAdmin++ } else {
            if (r.muerto) tokensMuertos.add(d.id_usuario)
            errores.push(`admin: ${r.error}`)
          }
        }
        if (alguno || !destinos.length) {
          await supabase.from('dispositivo_alertas').update({ aviso_admin_ts: new Date().toISOString() }).eq('id', a.id)
        }
      }
    }

    if (tokensMuertos.size) {
      await supabase.from('estado_dispositivo').update({ fcm_token: null }).in('id_usuario', [...tokensMuertos])
    }

    return json({
      monitoreados: vig.length, abiertas: nuevas, cerradas: aCerrar.length,
      push_telefono: pushTel, push_admin: pushAdmin, tokens_muertos: tokensMuertos.size, errores,
    })
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500)
  }
})
