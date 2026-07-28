import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../services/supabase'
import { hoyStr } from '../lib/format'
import { sumarDias } from '../lib/comparar'

/**
 * Actividad agregada del equipo para el dashboard del dueño.
 *
 * POR QUÉ NO REUSA `useRecorridosDelDia`: ese hook baja los PUNTOS de un día (paginando de a 1.000)
 * porque los necesita para dibujar el recorrido. Acá no hace falta ni un punto: hacen falta totales.
 * Con horizonte de mes el rango de consulta llega a 150 días — al 28/07 son ~37.500 filas en 8 días,
 * o sea del orden de 700.000 en ese rango. Bajarlas a un teléfono para sumarlas no es una opción.
 * La agregación la hace la RPC `metricas_actividad` (db/21) y acá llega una fila por día y persona.
 *
 * Los dos hooks conviven: este manda los NÚMEROS, `useRecorridosDelDia` manda los TRAZOS del mapa.
 *
 * @param {'hoy'|'semana'|'mes'} horizonte
 * @param {boolean} activo  si es false no consulta (p.ej. mientras no hay sesión/empresa)
 */

/** Días que muestra cada horizonte, y cuántos días hacia atrás hay que traer para poder comparar. */
const VENTANAS = {
  // 'hoy' compara contra los 4 mismos días de semana anteriores → 28 días atrás.
  hoy:    { dias: 1,  barras: 8,  atras: 28 },
  // 'semana' son 7 días y compara contra las 4 semanas previas → 28 días más.
  semana: { dias: 7,  barras: 7,  atras: 28 },
  // 'mes' son 30 días y compara contra los 4 períodos previos → 120 días más.
  mes:    { dias: 30, barras: 30, atras: 120 },
}

const REFRESH_MS = 60000

export default function useMetricasActividad(horizonte = 'hoy', activo = true) {
  const [filas, setFilas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)

  const cfg = VENTANAS[horizonte] || VENTANAS.hoy
  // `hoyStr()` se llama en cada render a propósito, sin congelarlo en un ref: devuelve un STRING,
  // así que su identidad es por valor y las dependencias de `useCallback` no cambian por llamarlo
  // de nuevo. Congelarlo en un ref haría que el dashboard quedara clavado en el día anterior si la
  // app pasa la medianoche abierta — que es exactamente lo que hace un teléfono en un bolsillo.
  const hasta = hoyStr()
  const desde = sumarDias(hasta, -(cfg.dias - 1))
  const desdeConsulta = sumarDias(desde, -cfg.atras)

  const cargar = useCallback(async (silencioso) => {
    if (!activo) return
    if (!silencioso) setLoading(true)

    const { data, error: e } = await supabase.rpc('metricas_actividad', {
      p_desde: desdeConsulta,
      p_hasta: hasta,
    })

    if (!silencioso) setLoading(false)
    if (e) {
      // El error se MIRA y se PROPAGA. El mismo criterio que `useRecorridosDelDia`: una consulta
      // que falla en silencio deja la pantalla en cero, que es indistinguible de "no trabajó
      // nadie" — el peor error posible en una pantalla que juzga el trabajo de gente real.
      console.error('[metricas] la RPC falló', { desdeConsulta, hasta, horizonte, msg: e.message }, e)
      setError(e)
      return
    }
    setError(null)
    setFilas(data || [])
    setUpdatedAt(Date.now())
  }, [activo, desdeConsulta, hasta, horizonte])

  useEffect(() => { cargar(false) }, [cargar])

  // Refresco en vivo solo cuando la ventana termina hoy (el pasado no cambia).
  useEffect(() => {
    if (!activo || hasta !== hoyStr()) return
    const iv = setInterval(() => cargar(true), REFRESH_MS)
    return () => clearInterval(iv)
  }, [activo, hasta, cargar])

  const derivado = useMemo(() => {
    // Serie del EQUIPO por día: la que alimenta las comparaciones y las sparklines.
    const porDia = {}
    // Acumulado por persona DENTRO del período mostrado: la lista de equipo.
    const porUsuario = {}
    // Serie diaria POR PERSONA sobre TODA la ventana consultada (no solo el período mostrado):
    // es la que dibuja las 8 barras de "sus últimos días" en el detalle de quien no reportó hoy.
    // Ese historial es lo que convierte "hoy no hay dato" en "hoy es la excepción, no el patrón".
    const serieKmPorUsuario = {}

    for (const f of filas) {
      const dia = f.dia
      const km = Number(f.km) || 0
      const paradas = Number(f.paradas) || 0
      const minutos = Number(f.minutos_movimiento) || 0

      const d = porDia[dia] || (porDia[dia] = { km: 0, paradas: 0, minutos: 0, puntos: 0, personas: 0 })
      d.km += km
      d.paradas += paradas
      d.minutos += minutos
      d.puntos += Number(f.puntos) || 0
      d.personas++

      const s = serieKmPorUsuario[f.id_usuario] || (serieKmPorUsuario[f.id_usuario] = {})
      s[dia] = (s[dia] || 0) + km

      if (dia >= desde && dia <= hasta) {
        const u = porUsuario[f.id_usuario] || (porUsuario[f.id_usuario] = {
          id: f.id_usuario, km: 0, paradas: 0, minutos: 0, puntos: 0,
          primerTs: null, ultimoTs: null, dias: 0,
        })
        u.km += km
        u.paradas += paradas
        u.minutos += minutos
        u.puntos += Number(f.puntos) || 0
        u.dias++
        if (f.primer_ts && (!u.primerTs || f.primer_ts < u.primerTs)) u.primerTs = f.primer_ts
        if (f.ultimo_ts && (!u.ultimoTs || f.ultimo_ts > u.ultimoTs)) u.ultimoTs = f.ultimo_ts
      }
    }

    // Series planas por métrica, que es lo que consumen `compararDia` / `compararRango`.
    const serieKm = {}
    const serieParadas = {}
    const serieMinutos = {}
    for (const [dia, v] of Object.entries(porDia)) {
      serieKm[dia] = v.km
      serieParadas[dia] = v.paradas
      serieMinutos[dia] = v.minutos
    }

    const total = Object.values(porUsuario).reduce(
      (a, u) => ({ km: a.km + u.km, paradas: a.paradas + u.paradas, minutos: a.minutos + u.minutos }),
      { km: 0, paradas: 0, minutos: 0 }
    )

    // El último punto recibido de toda la empresa: es el "el último cerró a las…" del titular
    // cuando no hay nadie en la calle.
    let ultimoCierreTs = null
    for (const u of Object.values(porUsuario)) {
      if (u.ultimoTs && (!ultimoCierreTs || u.ultimoTs > ultimoCierreTs)) ultimoCierreTs = u.ultimoTs
    }

    return {
      porDia, porUsuario, serieKm, serieParadas, serieMinutos, serieKmPorUsuario, total,
      ultimoCierreTs: ultimoCierreTs ? new Date(ultimoCierreTs).getTime() : null,
    }
  }, [filas, desde, hasta])

  return {
    ...derivado,
    desde, hasta, barras: cfg.barras,
    loading, error, updatedAt,
    reload: () => cargar(false),
  }
}
