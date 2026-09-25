import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  // 60 días (24/09/2026): lo pide la ficha de persona del menú Usuarios (brief v1.5 P3), que
  // compara contra los 60 anteriores y no contra cuatro períodos. 120 días en total, dentro de
  // DIAS_CACHE, así que comparte la caché por día con los otros horizontes.
  bimestre: { dias: 60, barras: 60, atras: 60 },
}

const REFRESH_MS = 60000
const CACHE_KEY = 'lu-metricas-cache'
const TRAMO_DIAS = 7   // ~1-1,6 s por tramo desde db/69, lejos de los 8 s de statement_timeout (ver cargarHistorico)
const DIAS_CACHE = 160 // cubre la ventana de "mes" (150) con margen

/* 🩸 UNA SOLA `metricas_actividad` EN VUELO POR CLIENTE (16/09/2026). La RPC lee ~18.000 filas de
 * `posiciones` por día de empresa. Lanzadas varias a la vez (StrictMode en dev monta los efectos
 * dos veces, y en producción el informe de jornada pide 'mes' mientras el dashboard pide 'semana')
 * se pisan en la base y se acercan al timeout. Por eso todas las llamadas de este hook, de
 * cualquier instancia, pasan por esta cola a nivel de módulo: se ejecutan de a una, en orden. */
let cola = Promise.resolve()
function enCola(fn) {
  const p = cola.then(fn, fn)
  cola = p.catch(() => {})
  return p
}

/* 🩸 EL HISTÓRICO SE PIDE UNA VEZ; LO QUE SE REFRESCA ES SÓLO HOY (13/09/2026).
 *
 * Hasta hoy el refresco de 60 s repetía la RPC sobre la ventana ENTERA: 29 días para 'hoy', 35
 * para 'semana', 150 para 'mes'. `metricas_actividad` recorre `posiciones` con haversine y cuatro
 * window functions, y está medida (HANDOFF §"dashboard"): 0,55 s por día, 4,3 s a 7 días, 7,2 s
 * a 30. O sea que el panel del dueño le pedía a la base recalcular un mes de recorridos cada
 * minuto para mover los números de un solo día — el único que cambia mientras se mira.
 *
 * Ahora son dos consultas: el histórico (`desdeConsulta` → ayer) se pide por tramos y se guarda
 * DÍA POR DÍA en `persistence` (SQLite/localStorage) —ver `cargarHistorico`, 16/09/2026—, y `hoy`
 * es la única que va al `setInterval`. La respuesta y el `derivado` son los mismos:
 * `filas = histórico ∪ hoy`.
 *
 * La caché va por usuario: la RPC filtra por `mi_empresa()` y por `ids_a_mi_cargo()`, así que dos
 * personas de la misma empresa pueden ver filas distintas. */

export default function useMetricasActividad(horizonte = 'hoy', activo = true) {
  const { user } = useAuth()
  const uid = user?.id || null
  const [historico, setHistorico] = useState([]) // filas con dia < hasta (no cambian intradía)
  const [hoyFilas, setHoyFilas] = useState([])   // filas de `hasta` (hoy): las únicas que se refrescan
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updatedAt, setUpdatedAt] = useState(null)
  // Generación de la carga de histórico: cada llamada la incrementa y, después de cada `await`,
  // una carga vieja que ve otra generación se retira. Sin esto, cambiar de horizonte (o el doble
  // montaje de StrictMode) dejaba dos bucles de tramos escribiendo el mismo estado.
  const genRef = useRef(0)

  const cfg = VENTANAS[horizonte] || VENTANAS.hoy
  // `hoyStr()` se llama en cada render a propósito, sin congelarlo en un ref: devuelve un STRING,
  // así que su identidad es por valor y las dependencias de `useCallback` no cambian por llamarlo
  // de nuevo. Congelarlo en un ref haría que el dashboard quedara clavado en el día anterior si la
  // app pasa la medianoche abierta — que es exactamente lo que hace un teléfono en un bolsillo.
  const hasta = hoyStr()
  const desde = sumarDias(hasta, -(cfg.dias - 1))
  const desdeConsulta = sumarDias(desde, -cfg.atras)

  const rpc = useCallback(async (p_desde, p_hasta) => {
    const { data, error: e } = await enCola(() => supabase.rpc('metricas_actividad', { p_desde, p_hasta }))
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
   * Histórico (desdeConsulta → ayer). `forzar` saltea la caché (botón "reintentar").
   *
   * 🩸 EN TRAMOS DE 7 DÍAS Y CACHEADO POR DÍA (16/09/2026). El rol `authenticated` tiene
   * `statement_timeout` de 8 s y la RPC, medida desde el navegador, tardaba > 8 s por SEMANA
   * (`mi_empresa()` se evaluaba por fila; arreglado en db/69: hoy 0,65-1,6 s los 7 días). Aun
   * así, la ventana de "mes" son 150 días: 20-35 s en una sola llamada. NO ENTRA. Daba 57014
   * "canceling statement due to statement timeout" y el panel del dueño quedaba en error antes de
   * las 11, que es justo cuando el default es "semana". Y como la caché iba por `hasta`, cada día
   * nuevo repetía la ventana entera.
   *
   * Ahora la caché es un mapa `{ dia: filas }` por usuario que se acumula: al cargar se calculan
   * los días del rango que faltan, se piden en tramos de hasta `TRAMO_DIAS` consecutivos (cada
   * uno bajo el timeout), en serie para no apilar consultas pesadas, y se guardan. Un día pasado
   * no cambia, así que un día cacheado no se vuelve a pedir nunca. Cambiar de horizonte sólo pide
   * los días nuevos, y el segundo arranque del día pide UN día: el de ayer.
   *
   * El primer "mes" de un usuario nuevo sigue costando ~22 tramos × 1-1,6 s: se pinta lo que hay
   * a medida que llega (`setHistorico` por tramo), y el skeleton no tapa la pantalla entera.
   */
  const cargarHistorico = useCallback(async (forzar) => {
    if (!activo) return
    const gen = ++genRef.current
    const ayer = sumarDias(hasta, -1)
    const cache = forzar ? null : await persistence.get(CACHE_KEY)
    if (gen !== genRef.current) return
    // Caché de otro usuario o del formato viejo (`clave`/`filas`): se descarta.
    const porDia = cache && cache.uid === uid && cache.porDia && typeof cache.porDia === 'object' ? { ...cache.porDia } : {}

    const entregar = () => {
      const out = []
      for (let d = desdeConsulta; d <= ayer; d = sumarDias(d, 1)) if (porDia[d]) out.push(...porDia[d])
      setHistorico(out)
    }
    entregar()

    // Días que faltan, agrupados en tramos consecutivos de hasta TRAMO_DIAS.
    const tramos = []
    let abierto = null
    for (let d = desdeConsulta; d <= ayer; d = sumarDias(d, 1)) {
      if (porDia[d]) { abierto = null; continue }
      if (!abierto || abierto.n >= TRAMO_DIAS) { abierto = { desde: d, hasta: d, n: 1 }; tramos.push(abierto) }
      else { abierto.hasta = d; abierto.n++ }
    }
    if (!tramos.length) return

    for (const t of tramos) {
      const data = await rpc(t.desde, t.hasta)
      if (gen !== genRef.current) return // otra carga tomó el relevo
      if (!data) return // el error ya quedó seteado; lo cargado hasta acá se muestra igual
      for (let d = t.desde; d <= t.hasta; d = sumarDias(d, 1)) porDia[d] = []
      for (const f of data) (porDia[f.dia] || (porDia[f.dia] = [])).push(f)
      entregar()
      // Se guarda tramo a tramo: un tramo que costó 3 s de base no se vuelve a pedir aunque la
      // carga se corte a la mitad (cambio de horizonte, pantalla cerrada, error en el siguiente).
      // Recortado a los últimos DIAS_CACHE para que el storage no crezca sin techo.
      const piso = sumarDias(hasta, -DIAS_CACHE)
      for (const d of Object.keys(porDia)) if (d < piso) delete porDia[d]
      persistence.set(CACHE_KEY, { uid, porDia })
    }
  }, [activo, hasta, uid, desdeConsulta, rpc])

  const cargar = useCallback(async (silencioso, forzar = false) => {
    if (!activo) return
    if (!silencioso) setLoading(true)
    // El skeleton se levanta con HOY (una llamada de un día); el histórico sigue llegando por
    // tramos y se va sumando a la pantalla. Esperarlo entero dejaría un "mes" recién abierto
    // detrás del skeleton durante ~30 s (22 tramos × 1-1,6 s).
    const historico = cargarHistorico(forzar)
    await cargarHoy()
    if (!silencioso) setLoading(false)
    await historico
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
    // Las filas crudas (día × persona) de TODA la ventana consultada. La ficha de persona de
    // Usuarios las necesita por día —primer punto, paradas, minutos— y no sólo el km que llega
    // agregado en `serieKmPorUsuario`.
    filas,
    desde, desdeConsulta, hasta, barras: cfg.barras,
    loading, error, updatedAt,
    reload: () => cargar(false, true),
  }
}
