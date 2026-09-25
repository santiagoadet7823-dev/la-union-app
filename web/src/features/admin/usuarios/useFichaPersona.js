import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../services/supabase'
import { hoyStr } from '../../../lib/format'
import { sumarDias } from '../../../lib/comparar'
import useMetricasActividad from '../../../hooks/useMetricasActividad'
import { getTrackConfig, inicioProgramado } from '../../../services/tracking'
import { historialPosiciones } from '../../../services/sync/realtime'
import { limpiarTrazo, kmDePuntos } from '../../../lib/geo'
import { detectarParadas } from '../../../services/geolocation/dwell'
import { PERIODOS } from './modelo'

/**
 * Los números de la ficha de una persona, con CONTEXTO (brief v1.5 P2: "47 km no es bueno ni
 * malo"): cada métrica viene con el período anterior y con el promedio de su equipo — mismo rol,
 * misma empresa, sólo quienes tuvieron dato en el período.
 *
 * De dónde sale cada cosa (ninguna es nueva):
 *   actividad  → `metricas_actividad` a través de `useMetricasActividad`, que ya cachea por día
 *                (el dashboard la tiene caliente). Sólo cubre `mi_empresa()`: una persona de otra
 *                empresa no tiene actividad acá y la ficha lo dice (`fueraDeAlcance`).
 *   llegada    → `inicioProgramado` de services/tracking.js (regla 36: la ventana no se reescribe).
 *   ventas     → `metricas_venta_equipo` (db/68) del período actual + el anterior.
 *   cartera    → `metricas_venta` (db/56) y `visitas` para "cartera visitada".
 *   meta       → `metas` mensual de monto (decisión del 24/09 con el dueño).
 *   anulados   → `pedidos` en estado `Anulado` (no existe "cancelado": ver brief §4.3).
 */

// 5 minutos: el mismo umbral que `metricas_actividad` para contar una parada (ver SheetPersona).
export const PARADA_MIN_MS = 300000
const TARDE_MIN = 10 // tolerancia antes de decir "llegó tarde"

const minutosDelDia = (ts) => { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes() }

function sumarAct(filas) {
  const s = { km: 0, minutos: 0, paradas: 0, dias: 0 }
  for (const f of filas) {
    s.km += Number(f.km) || 0
    s.minutos += Number(f.minutos_movimiento) || 0
    s.paradas += Number(f.paradas) || 0
    s.dias++
  }
  return s
}

function sumarVen(filas) {
  const s = { monto: 0, pedidos: 0, clientes: 0, visitas: 0, conPedido: 0, anulados: 0 }
  for (const f of filas) {
    s.monto += Number(f.monto) || 0
    s.pedidos += Number(f.pedidos) || 0
    s.clientes += Number(f.clientes) || 0
    s.visitas += Number(f.visitas) || 0
    s.conPedido += Number(f.visitas_con_pedido) || 0
    s.anulados += Number(f.anulados) || 0
  }
  s.efect = s.visitas ? s.conPedido / s.visitas : null
  return s
}

/** Promedio por persona del equipo (sin la persona), sobre quienes tuvieron alguna fila. */
function promedioEquipo(filas, companeros, clave, suma) {
  const por = {}
  for (const f of filas) {
    const id = f[clave]
    if (!companeros.has(id)) continue
    ;(por[id] ||= []).push(f)
  }
  const ids = Object.keys(por)
  if (!ids.length) return null
  const sumas = ids.map((id) => suma(por[id]))
  const out = {}
  for (const k of Object.keys(sumas[0])) {
    const vals = sumas.map((s) => s[k]).filter((v) => typeof v === 'number')
    out[k] = vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null
  }
  out.n = ids.length
  return out
}

export default function useFichaPersona({ persona, periodo, companeros, activa, miEmpresa, esTrackeado }) {
  const per = PERIODOS.find((x) => x.k === periodo) || PERIODOS[1]
  const hasta = hoyStr()
  const desde = sumarDias(hasta, -(per.dias - 1))
  const desdePrev = sumarDias(desde, -per.dias)
  const hastaPrev = sumarDias(desde, -1)
  const pid = persona?.id || null
  const fueraDeAlcance = !!persona && !!miEmpresa && persona.id_empresa !== miEmpresa

  // ── Actividad ────────────────────────────────────────────────────────────
  const act = useMetricasActividad(per.horizonte, !!(activa && esTrackeado && !fueraDeAlcance))
  const [cfgRastreo, setCfgRastreo] = useState(null)
  useEffect(() => {
    if (!activa || !pid || !esTrackeado) return
    let vivo = true
    getTrackConfig(pid).then((c) => { if (vivo) setCfgRastreo(c) }, () => {})
    return () => { vivo = false }
  }, [activa, pid, esTrackeado])

  const actividad = useMemo(() => {
    if (!pid) return null
    const filas = act.filas || []
    const mias = filas.filter((f) => f.id_usuario === pid)
    const enPer = mias.filter((f) => f.dia >= desde && f.dia <= hasta)
    const enPrev = mias.filter((f) => f.dia >= desdePrev && f.dia <= hastaPrev)
    const porDia = Object.fromEntries(mias.map((f) => [f.dia, f]))

    // Llegada contra su horario, día por día.
    let tardeDias = 0; let tardeSuma = 0; let horarioDias = 0
    const llegada = {}
    for (const f of enPer) {
      if (!f.primer_ts || !cfgRastreo) continue
      const prog = inicioProgramado(cfgRastreo, new Date(f.dia + 'T12:00:00'))
      if (prog == null) continue
      horarioDias++
      const retraso = minutosDelDia(f.primer_ts) - prog
      llegada[f.dia] = { prog, retraso }
      if (retraso > TARDE_MIN) { tardeDias++; tardeSuma += retraso }
    }

    const filasPer = filas.filter((f) => f.dia >= desde && f.dia <= hasta)
    // Serie de 8 días de km para la mini-tendencia (termina hoy).
    const serie = []
    for (let i = 7; i >= 0; i--) {
      const d = sumarDias(hasta, -i)
      serie.push({ dia: d, km: porDia[d] ? Number(porDia[d].km) || 0 : null })
    }
    return {
      per: { ...sumarAct(enPer), tardeDias, tardeProm: tardeDias ? Math.round(tardeSuma / tardeDias) : null, horarioDias },
      prev: enPrev.length ? sumarAct(enPrev) : null,
      equipo: promedioEquipo(filasPer, companeros, 'id_usuario', sumarAct),
      porDia, llegada, serie,
    }
  }, [pid, act.filas, desde, hasta, desdePrev, hastaPrev, cfgRastreo, companeros])

  // ── Ventas, cartera, meta, anulados ───────────────────────────────────────
  // El efecto guarda las filas CRUDAS; el promedio del equipo se deriva aparte (useMemo abajo), así
  // tocar el borrador —que puede cambiar quiénes son "compañeros"— no vuelve a pedir nada al servidor.
  const [ventasCrudo, setVentas] = useState({ cargando: true })
  useEffect(() => {
    if (!activa || !pid) return
    let vivo = true
    setVentas((v) => ({ ...v, cargando: true }))
    const mesDesde = hasta.slice(0, 8) + '01'
    Promise.all([
      supabase.rpc('metricas_venta_equipo', { p_desde: desdePrev, p_hasta: hasta, p_empresa: persona.id_empresa || null }),
      supabase.rpc('metricas_venta', { p_id_usuario: pid, p_desde: desde, p_hasta: hasta }),
      supabase.rpc('metricas_venta', { p_id_usuario: pid, p_desde: mesDesde, p_hasta: hasta }),
      supabase.from('metas').select('valor').eq('id_usuario', pid).eq('periodo', 'mensual').eq('metrica', 'monto').maybeSingle(),
      supabase.from('visitas').select('id_cliente').eq('id_usuario', pid).gte('check_in_ts', new Date(desde + 'T00:00:00').toISOString()),
      supabase.from('pedidos')
        .select('id, numero, monto_total, motivo_anulacion, anulado_por, anulado_ts, clientes(nombre_comercio)')
        .eq('id_vendedor', pid).eq('estado', 'Anulado')
        .gte('anulado_ts', new Date(desde + 'T00:00:00').toISOString())
        .order('anulado_ts', { ascending: false }).limit(50),
    ]).then(([eq, mv, mes, meta, vis, anul]) => {
      if (!vivo) return
      const filas = eq.data || []
      const resumen = Array.isArray(mv.data) ? mv.data[0] : mv.data
      const resumenMes = Array.isArray(mes.data) ? mes.data[0] : mes.data
      const distintos = new Set((vis.data || []).map((v) => v.id_cliente).filter(Boolean))
      setVentas({
        cargando: false,
        error: eq.error || null,
        filas,
        cartera: resumen?.cartera != null ? Number(resumen.cartera) : null,
        clientesNuevos: resumen?.clientes_nuevos != null ? Number(resumen.clientes_nuevos) : null,
        carteraVisitada: distintos.size,
        meta: meta.data?.valor != null ? { valor: Number(meta.data.valor), montoMes: Number(resumenMes?.monto) || 0 } : null,
        anulados: anul.data || [],
      })
    }).catch((e) => { if (vivo) setVentas({ cargando: false, error: e }) })
    return () => { vivo = false }
  }, [activa, pid, persona?.id_empresa, desde, desdePrev, hasta])

  const ventas = useMemo(() => {
    if (!ventasCrudo.filas) return ventasCrudo
    const filas = ventasCrudo.filas
    const mias = filas.filter((f) => f.id_vendedor === pid)
    const porDia = {}
    for (const f of mias) porDia[f.dia] = f
    return {
      ...ventasCrudo,
      per: sumarVen(mias.filter((f) => f.dia >= desde)),
      prev: sumarVen(mias.filter((f) => f.dia < desde)),
      equipo: promedioEquipo(filas.filter((f) => f.dia >= desde), companeros, 'id_vendedor', sumarVen),
      porDia,
    }
  }, [ventasCrudo, pid, desde, companeros])

  // ── Teléfono: la batería sólo viaja con cada punto (brief §4.4) ───────────
  const [telefono, setTelefono] = useState({ cargando: true })
  useEffect(() => {
    if (!activa || !pid || !esTrackeado) return
    let vivo = true
    setTelefono({ cargando: true })
    Promise.all([
      supabase.from('app_config').select('latest_version').maybeSingle(),
      supabase.from('posiciones').select('ts, bateria').eq('id_usuario', pid).order('ts', { ascending: false }).limit(1),
    ]).then(([cfg, pos]) => {
      if (!vivo) return
      const ult = pos.data?.[0] || null
      setTelefono({ cargando: false, latest: cfg.data?.latest_version || null, ultimoPunto: ult })
    }).catch(() => { if (vivo) setTelefono({ cargando: false }) })
    return () => { vivo = false }
  }, [activa, pid, esTrackeado])

  return {
    periodo: per, desde, hasta, desdePrev, fueraDeAlcance, cfgRastreo,
    actividad, actividadCargando: act.loading, actividadError: act.error,
    ventas, telefono,
  }
}

/**
 * El recorrido de UN día, limpio (regla 22-bis: nunca dibujar el crudo) y con sus paradas.
 * Los días de más de 45 días atrás ya no tienen puntos (db/42): se devuelve `purgado`.
 */
export function useRecorridoDia({ persona, dia, activa }) {
  const [r, setR] = useState({ cargando: false })
  const pid = persona?.id || null
  const idEmpresa = persona?.id_empresa || null
  useEffect(() => {
    if (!activa || !pid || !dia || !idEmpresa) { setR({ cargando: false }); return }
    const antiguedad = Math.round((new Date(hoyStr() + 'T12:00:00') - new Date(dia + 'T12:00:00')) / 86400000)
    if (antiguedad > 45) { setR({ cargando: false, purgado: true }); return }
    let vivo = true
    setR({ cargando: true })
    historialPosiciones(pid, new Date(dia + 'T00:00:00').toISOString(), new Date(dia + 'T23:59:59').toISOString(), idEmpresa)
      .then((crudos) => {
        if (!vivo) return
        const limpio = limpiarTrazo(crudos || [])
        const paradas = limpio.puntos.length >= 2
          ? detectarParadas(limpio.puntos).filter((d) => d.duracionMs >= PARADA_MIN_MS)
          : []
        setR({ cargando: false, puntos: limpio.puntos, segmentos: limpio.segmentos, aproximados: limpio.aproximados, km: kmDePuntos(limpio.puntos), paradas })
      })
      .catch(() => { if (vivo) setR({ cargando: false, error: true }) })
    return () => { vivo = false }
  }, [activa, pid, idEmpresa, dia])
  return r
}
