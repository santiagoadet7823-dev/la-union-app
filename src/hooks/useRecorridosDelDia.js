import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { persistence } from '../services/persistence'
import { hoyStr } from '../lib/format'

const REFRESH_MS = 60000
const CACHE_KEY = 'lu-recorridos-cache'

/**
 * Carga las posiciones del día (todas las de la empresa, agrupadas por
 * id_usuario) y se refresca sola cada 60s de forma INCREMENTAL si `fecha` es hoy
 * (solo trae los puntos nuevos, para no gastar egress). Antes esta lógica estaba
 * duplicada entre RecorridosView y SupervisionMovil, y ya habían divergido (solo
 * RecorridosView tenía la carga incremental).
 *
 * La carga incremental ya existía, pero el cursor (`lastTsRef`) vivía SOLO en RAM: al
 * cerrar la app se perdía y la siguiente apertura volvía a bajar la jornada entera
 * (~2.500 filas ≈ 200 KB de JSON por datos móviles). Por eso el mapa "se reiniciaba" y
 * tardaba en volver a aparecer. Ahora el cursor y los puntos se persisten con
 * `services/persistence` (SQLite en el APK, localStorage en la PWA, con fallback), así
 * la reapertura pinta al instante y la red solo trae lo nuevo.
 *
 * @param {string} fecha 'YYYY-MM-DD'
 * @param {string} idEmpresa
 * @param {boolean} [conRol] si true, selecciona también `rol` por punto (lo usa
 *   SupervisionMovil para filtrar los chips Vend./Rep.); si no, el llamador debe
 *   resolver el rol por su cuenta (p.ej. con usePerfilesEquipo).
 */
export default function useRecorridosDelDia(fecha, idEmpresa, conRol = false) {
  const [byUser, setByUser] = useState({}) // { id_usuario: { rol?, points:[{lat,lng,ts,bateria}] } }
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const lastTsRef = useRef(null)
  const esHoy = fecha === hoyStr()

  const load = useCallback(async (incremental) => {
    if (!idEmpresa) return
    const cols = conRol ? 'id_usuario, rol, lat, lng, ts, bateria' : 'id_usuario, lat, lng, ts, bateria'
    const desde = new Date(fecha + 'T00:00:00').toISOString()
    const hasta = new Date(fecha + 'T23:59:59').toISOString()
    if (!incremental) setLoading(true)
    let q = supabase.from('posiciones').select(cols)
      .eq('id_empresa', idEmpresa).lte('ts', hasta).order('ts', { ascending: true })
    q = incremental && lastTsRef.current ? q.gt('ts', lastTsRef.current) : q.gte('ts', desde)
    // El error se MIRA. Antes esto era `const { data } = await q` y descartaba `error`:
    // cualquier falla (timeout, RLS, red, límite de filas) dejaba `data` en null, el hook
    // hacía `return` y el mapa quedaba vacío SIN UN SOLO MENSAJE. Un día entero de
    // recorridos "desaparecido" y ni la consola ni la pantalla decían nada. Los fallos
    // tienen que ser ruidosos.
    const { data, error: err } = await q
    if (!incremental) setLoading(false)
    if (err) {
      console.error('[recorridos] la consulta falló:', err.message, err)
      setError(err)
      return
    }
    setError(null)
    if (!data) return
    // Cuántas filas llegaron DE VERDAD. PostgREST puede recortar la respuesta por
    // `max-rows` y devolver 200 igual: sin esto, una carga a medias es indistinguible de
    // una completa.
    if (!incremental) console.info(`[recorridos] ${fecha}: ${data.length} puntos`)
    if (data.length) {
      setByUser((prev) => {
        const next = incremental ? { ...prev } : {}
        // Se agrupa primero y se concatena UNA vez por persona. Antes el append era
        // `points: [...prevPoints, punto]` DENTRO del forEach, o sea que copiaba el array
        // entero por cada punto: con ~850 puntos por persona eran ~360k copias por carga.
        const porUsuario = new Map()
        data.forEach((p) => {
          if (!p.id_usuario) return
          let e = porUsuario.get(p.id_usuario)
          if (!e) { e = { rol: undefined, points: [] }; porUsuario.set(p.id_usuario, e) }
          if (conRol) e.rol = p.rol
          // `ts` va en el punto: lo necesita detectarParadas (dwell.js). `bateria` es
          // smallint nullable (0-100) y la muestra la vista.
          e.points.push({ lat: p.lat, lng: p.lng, ts: p.ts, bateria: p.bateria })
        })
        porUsuario.forEach((e, id) => {
          const rolVal = conRol ? e.rol : next[id]?.rol
          const prevPoints = next[id]?.points
          next[id] = { rol: rolVal, points: prevPoints?.length ? prevPoints.concat(e.points) : e.points }
        })
        return next
      })
      lastTsRef.current = data[data.length - 1].ts
    } else if (!incremental) {
      setByUser({})
    }
    setUpdatedAt(Date.now())
  }, [idEmpresa, fecha, conRol])

  // Carga inicial y al cambiar de fecha/empresa: primero se intenta hidratar desde la caché
  // (pintado instantáneo, sin spinner) y se sigue con una incremental que trae solo lo nuevo.
  // Si la caché no corresponde a esta fecha/empresa/forma, se cae a la carga completa.
  useEffect(() => {
    let vigente = true
    lastTsRef.current = null
    ;(async () => {
      // La caché NUNCA puede ser una barrera para la carga: es un adelanto, nada más.
      // En el APK `persistence` es SQLite con timeout de 5 s, y la cola de GPS lo escribe
      // todo el día; si el store está lento, `await` acá dejaba la consulta sin arrancar y
      // el mapa vacío. Con la carrera contra 800 ms, una caché lenta degrada a carga
      // completa (lo de siempre) en vez de dejar la vista colgada.
      const cache = await Promise.race([
        persistence.get(CACHE_KEY),
        new Promise((r) => setTimeout(() => r(null), 800)),
      ])
      // `vigente` corta la carrera: si la fecha cambió mientras leíamos la caché, este
      // resultado ya es viejo y pisaría datos más frescos.
      if (!vigente) return
      const sirve = cache && cache.fecha === fecha && cache.idEmpresa === idEmpresa &&
        cache.conRol === conRol && cache.lastTs && cache.byUser
      if (sirve) {
        setByUser(cache.byUser)
        lastTsRef.current = cache.lastTs
        load(true)
      } else {
        setByUser({})
        load(false)
      }
    })()
    return () => { vigente = false }
  }, [load, fecha, idEmpresa, conRol])

  // Persistir lo cargado. Se guarda UNA sola fecha (la clave es fija y el registro lleva
  // adentro fecha/empresa/forma): así cambiar de día pisa la entrada anterior y el storage
  // queda acotado a ~200 KB en vez de crecer un día por cada fecha visitada.
  useEffect(() => {
    if (!idEmpresa || !lastTsRef.current) return
    if (!Object.keys(byUser).length) return
    persistence.set(CACHE_KEY, { fecha, idEmpresa, conRol, byUser, lastTs: lastTsRef.current })
  }, [byUser, fecha, idEmpresa, conRol])

  // Auto-refresh incremental cada 60s (solo si la fecha es HOY; el pasado no cambia).
  useEffect(() => {
    if (!esHoy) return
    const iv = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(iv)
  }, [esHoy, load])

  // El botón "refrescar" va INCREMENTAL si ya hay cursor: traer de nuevo la jornada entera
  // no aporta nada (intradía nadie borra puntos) y era justo lo que hacía que refrescar
  // tardara. Sin cursor todavía no hay nada que completar, así que va la carga completa.
  return { byUser, updatedAt, loading, esHoy, error, reload: () => load(!!lastTsRef.current) }
}
