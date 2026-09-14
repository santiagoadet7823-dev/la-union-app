import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../services/supabase'
import { persistence } from '../services/persistence'
import { useAuth } from '../context/AuthContext'
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
const CACHE_KEY = 'lu-metricas-cache'

/* 🩸 EL HISTÓRICO SE PIDE UNA VEZ; LO QUE SE REFRESCA ES SÓLO HOY (13/09/2026).
 *
 * Hasta hoy el refresco de 60 s repetía la RPC sobre la ventana ENTERA: 29 días para 'hoy', 35
 * para 'semana', 150 para 'mes'. `metricas_actividad` recorre `posiciones` con haversine y cuatro
 * window functions, y está medida (HANDOFF §"dashboard"): 0,55 s por día, 4,3 s a 7 días, 7,2 s
 * a 30. O sea que el panel del dueño le pedía a la base recalcular un mes de recorridos cada
 * minuto para mover los números de un solo día — el único que cambia mientras se mira.
 *
 * Ahora son dos consultas: el histórico (`desdeConsulta` → ayer) se pide una vez por día y
 * horizonte y se guarda en `persistence` (SQLite/localStorage), y `hoy` es la única que va al
 * `setInterval`. La respuesta y el `derivado` son los mismos: `filas = histórico ∪ hoy`.
 *
 * La caché va por usuario además de por día y horizonte: la RPC filtra por `mi_empresa()` y por
 * `ids_a_mi_cargo()`, así que dos personas de la misma empresa pueden ver filas distintas. */

export default function useMetricasActividad(horizonte = 'hoy', activo = true) {
  const { user } = useAuth()
  const uid = user?.id || null
  const [historico, setHistorico] = useState([]) // filas con dia < hasta (no cambian intradía)
  const [hoyFilas, setHoyFilas] = useState([])   // filas de `hasta` (hoy): las únicas que se refrescan
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

  const rpc = useCallback(async (p_desde, p_hasta) => {
    const { data, error: e } = await supabase.rpc('metricas_actividad', { p_desde, p_hasta })
    if (e) {
      // El error se MIRA y se PROPAGA. El mismo criterio que `useRecorridosDelDia`: una consulta
      // que falla en silencio deja la pantalla en cero, que es indistinguible de "no trabajó
      // nadie" — el peor error posible en una pantalla que juzga el trabajo de gente real.
      console.error('[metricas] la RPC falló', { p_desde, p_hasta, horizonte, msg: e.message }, e)
      setError(e)
      return null
    }
    setError(null)
    return data || []
  }, [horizonte])

  /** Sólo el día de hoy: es lo que corre en el intervalo. */
  const cargarHoy = useCallback(async () => {
    if (!activo) return
    const data = await rpc(hasta, hasta)
    if (!data) return
    setHoyFilas(data)
    setUpdatedAt(Date.now())
  }, [activo, hasta, rpc])

  /**
   * Histórico (desdeConsulta → ayer). `forzar` saltea la caché (botón "reintentar"). Con la caché
   * vigente no toca la red; si no, pide y guarda.
   */
  const cargarHistorico = useCallback(async (forzar) => {
    if (!activo) return
    const ayer = sumarDias(hasta, -1)
    const clave = `${uid}|${horizonte}|${hasta}`
    if (!forzar) {
      const cache = await persistence.get(CACHE_KEY)
      if (cache && cache.clave === clave && Array.isArray(cache.filas)) {
        setHistorico(cache.filas)
        return
      }
    }
    const data = await rpc(desdeConsulta, ayer)
    if (!data) return
    setHistorico(data)
    // Una sola entrada (la clave viaja adentro): cambiar de horizonte o de día la pisa, y el
    // storage no crece una entrada por cada combinación visitada.
    persistence.set(CACHE_KEY, { clave, filas: data })
  }, [activo, hasta, horizonte, uid, desdeConsulta, rpc])

  const cargar = useCallback(async (silencioso, forzar = false) => {
    if (!activo) return
    if (!silencioso) setLoading(true)
    await Promise.all([cargarHistorico(forzar), cargarHoy()])
    if (!silencioso) setLoading(false)
  }, [activo, cargarHistorico, cargarHoy])

  useEffect(() => { cargar(false) }, [cargar])

  // Refresco en vivo solo cuando la ventana termina hoy (el pasado no cambia) — y sólo de hoy.
  useEffect(() => {
    if (!activo || hasta !== hoyStr()) return
    const iv = setInterval(cargarHoy, REFRESH_MS)
    return () => clearInterval(iv)
  }, [activo, hasta, cargarHoy])

  // Lo que consume `derivado`: el histórico más hoy. Si por una carrera el histórico trajera una
  // fila de `hasta` (no debería: se pide hasta ayer), la de hoy manda.
  const filas = useMemo(() => [...historico.filter((f) => f.dia !== hasta), ...hoyFilas], [historico, hoyFilas, hasta])

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
    reload: () => cargar(false, true),
  }
}
