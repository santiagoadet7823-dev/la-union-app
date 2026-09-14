import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../services/supabase'
import { persistence } from '../services/persistence'
import { useAuth } from '../context/AuthContext'
import { hoyStr } from '../lib/format'

const REFRESH_MS = 60000
const CACHE_KEY = 'lu-recorridos-cache'
// La caché se escribe como mucho cada tanto (ver el efecto de persistencia, abajo).
const PERSISTIR_CADA_MS = 5 * 60000

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
 * @param {string} idEmpresa uuid de la empresa, o `'*'` para TODAS (selector de scope del
 *   superadmin, ver context/TenantContext.jsx). Falsy = todavía no se sabe → no consulta.
 * @param {boolean} [conRol] si true, selecciona también `rol` por punto (lo usa
 *   SupervisionMovil para filtrar los chips Vend./Rep.); si no, el llamador debe
 *   resolver el rol por su cuenta (p.ej. con usePerfilesEquipo).
 */
export default function useRecorridosDelDia(fecha, idEmpresa, conRol = false) {
  const [byUser, setByUser] = useState({}) // { id_usuario: { rol?, points:[{lat,lng,ts,bateria}] } }
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  /* 🩸 EL CURSOR INCREMENTAL ES EL `id`, NO EL `ts` (13/09/2026).
   *
   * Hasta hoy el refresco pedía `ts > último ts visto`. Eso no ve nunca un punto que entra a la
   * base con `ts` VIEJO — y eso pasa todos los días: un vendedor sin señal acumula la cola en el
   * teléfono y, cuando vuelve la red, sube puntos tomados hace 20 minutos con su hora real de
   * captura (21/07/2026: una cola de ~2.400 puntos de la mañana que el crudo no mostraba). El
   * remedio era un `count` extra por tick y, ante cualquier diferencia, una RECARGA COMPLETA del
   * día: 21 páginas de 1.000 filas, ~3 MB por datos móviles, disparada por un solo punto rezagado.
   *
   * `posiciones.id` es un bigint secuencial (verificado en la base viva): se asigna al INSERTAR,
   * así que un punto rezagado tiene `ts` viejo pero `id` más alto que todo lo que ya tenemos. Con
   * `id > último id visto` el incremental lo trae solo, sin count y sin recarga. El día sigue
   * acotado por `ts` (`gte desde / lte hasta`); lo que cambia es sólo el cursor.
   *
   * Lo que sí hay que cuidar es el ORDEN: `limpiarTrazo` y `detectarParadas` asumen puntos en
   * orden temporal, y un rezagado llega al final del array. Antes eso lo garantizaba la recarga
   * completa; ahora se reordena por `ts` SÓLO el array de la persona que recibió un punto fuera
   * de orden (ver el merge). */
  const lastIdRef = useRef(null)
  const lastTsRef = useRef(null) // sólo informativo (caché y "act. hace")
  // Persistencia diferida de la caché (ver el efecto al final). Van acá arriba porque el efecto de
  // carga inicial, más arriba que el de persistencia, también los toca (regla 51).
  const ultimaPersistRef = useRef(0)
  const pendienteRef = useRef(null) // el último snapshot que todavía no se escribió
  const esHoy = fecha === hoyStr()
  // Sube cuando la app arrancó con el token vencido y después consiguió uno bueno: hay que volver
  // a pedir lo que se cayó con 401 (ver AuthContext). Sin esto el mapa quedaba vacío hasta cerrar
  // sesión y volver a entrar.
  const { authEpoch } = useAuth()

  const load = useCallback(async (incremental) => {
    if (!idEmpresa) return
    // `accuracy` desde 1.9.0: es lo que distingue un fix de GPS de uno TRIANGULADO por antenas/WiFi
    // (los de más de ACCURACY_MAX_M), y `limpiarTrazo` los necesita para dibujarlos punteados y
    // dejarlos fuera de los km. Sin esta columna el trazo aproximado se dibujaría como si fuera GPS.
    const cols = conRol
      ? 'id, id_usuario, rol, lat, lng, ts, bateria, accuracy'
      : 'id, id_usuario, lat, lng, ts, bateria, accuracy'
    const desde = new Date(fecha + 'T00:00:00').toISOString()
    const hasta = new Date(fecha + 'T23:59:59').toISOString()
    if (!incremental) setLoading(true)

    // Se PAGINA hasta agotar. PostgREST corta la respuesta en `max-rows` (1000) y devuelve
    // 200 igual, sin ninguna señal de que faltan filas: una jornada de 2.982 puntos llegaba
    // recortada a un tercio y se dibujaba como si fuera el recorrido completo. El síntoma que
    // lo destapó: había que tocar "refrescar" 3 veces para ver el día entero — 2.982/1.000 ≈ 3,
    // porque el refresco incremental (`gt(último ts)`) iba trayendo los mil siguientes.
    //
    // El desempate por `id` no es decorativo: sin un orden TOTAL, dos filas con el mismo `ts`
    // pueden repartirse entre dos páginas y perderse o duplicarse.
    // Se avanza por la cantidad REALMENTE recibida y se corta con una página vacía, en vez de
    // cortar con "vinieron menos de PAGE". Ese atajo daría por terminada la carga si el
    // `max-rows` del servidor fuese menor que PAGE: la primera página vendría corta y
    // perderíamos el resto en silencio — el mismo bug que estamos arreglando. Así funciona sea
    // cual sea el límite, a costa de una request final que vuelve vacía.
    const PAGE = 1000
    const MAX_VUELTAS = 50 // ~50k puntos: techo de seguridad, nunca un bucle infinito
    const filas = []
    let err = null
    let offset = 0
    let total = null // cuántas filas dice el servidor que hay (solo se pide en la 1ª vuelta)
    const inc = incremental && lastIdRef.current != null
    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      let q = supabase.from('posiciones')
        // El `count` sólo en la carga COMPLETA: es la guarda contra una paginación rota (abajo) y
        // la completa ahora es rara. En el incremental no hay nada que contar.
        .select(cols, !inc && vuelta === 0 ? { count: 'exact' } : undefined)
        .gte('ts', desde).lte('ts', hasta)
        .range(offset, offset + PAGE - 1)
      // Orden TOTAL en los dos casos (sin él, dos filas iguales pueden repartirse entre páginas):
      // la completa por `ts` (y `id` de desempate) porque así los puntos ya llegan en orden
      // temporal; la incremental por `id`, que es su cursor.
      q = inc ? q.order('id', { ascending: true }) : q.order('ts', { ascending: true }).order('id', { ascending: true })
      // '*' = TODAS las empresas (selector de scope del superadmin). Sin el `.eq()`, RLS decide:
      // para un superadmin `posiciones_sel` no filtra por tenant, para cualquier otro sí. O sea
      // que el peor caso de un '*' mal puesto es ver lo mismo de siempre, no una fuga.
      if (idEmpresa !== '*') q = q.eq('id_empresa', idEmpresa)
      if (inc) q = q.gt('id', lastIdRef.current)
      // El error se MIRA. Antes esto era `const { data } = await q` y descartaba `error`:
      // cualquier falla (timeout, RLS, red) dejaba `data` en null, el hook hacía `return` y el
      // mapa quedaba vacío SIN UN SOLO MENSAJE. Los fallos tienen que ser ruidosos.
      const { data: pagina, error: e, count } = await q
      if (e) { err = e; break }
      if (vuelta === 0 && typeof count === 'number') total = count
      if (!pagina || !pagina.length) break
      filas.push(...pagina)
      offset += pagina.length
    }
    if (!incremental) setLoading(false)
    if (err) {
      // Diagnóstico completo: fecha/rango/empresa + el error. Antes de esto un fallo dejaba el
      // mapa vacío SIN pista de por qué (¿fecha corrida? ¿empresa nula? ¿RLS/token/red?). El
      // `error` además ahora se PROPAGA a la vista (banner "Reintentar"), no solo a consola.
      console.error('[recorridos] la consulta falló', { fecha, desde, hasta, idEmpresa, incremental, msg: err.message }, err)
      setError(err)
      return
    }
    setError(null)
    const data = filas
    // Autocontrol: el servidor dice cuántas filas hay (`count: 'exact'`) y comparamos contra
    // lo que realmente juntamos. Si FALTAN, el recorrido que se está por dibujar está
    // incompleto — y un recorrido incompleto se ve igual de convincente que uno entero. Este
    // chequeo es la única defensa contra que vuelva a pasar en silencio (viene del bug de
    // paginación que documenta el comentario de arriba, y del mismo de `snap-recorridos`).
    //
    // 🩸 Pero la comparación es `<`, NO `!==` (10/08/2026). El `count` se pide en la PRIMERA
    // vuelta y la paginación termina segundos después: con la jornada EN CURSO entran puntos
    // nuevos en el medio, y como el orden es `ts` ascendente caen al final del rango
    // `lte(hasta)` — no corren los offsets ya leídos, así que no se pierde ni se duplica nada,
    // pero se juntan MÁS filas de las que el server contó al empezar. Con `!==` la guarda
    // gritaba INCOMPLETO todos los días: medido en la PWA con la sesión de superadmin, cuatro
    // cargas seguidas en un minuto y las cuatro con el mismo signo (7209/7210, 7218/7219,
    // 7236/7238, 7253/7255), siempre de MÁS — y el texto encima decía "solo se juntaron".
    // Una alarma que suena todos los días por algo benigno es una alarma que nadie va a mirar
    // el día que suene de verdad: es el mismo patrón de la regla 34, donde un token FCM muerto
    // dejaba `fallidos` clavado en > 0 y tapaba las fallas reales.
    // El caso `<` sí es siempre un defecto: `posiciones` no tiene policy de DELETE (regla 32),
    // así que las filas que el servidor contó no se van a ningún lado.
    if (!incremental) {
      if (total != null && data.length < total) {
        console.error(`[recorridos] ${fecha}: INCOMPLETO — el servidor tiene ${total} puntos y se juntaron ${data.length}: faltan ${total - data.length}`)
      } else if (total != null && data.length > total) {
        console.info(`[recorridos] ${fecha}: ${data.length} puntos (completo; ${data.length - total} entraron durante la carga)`)
      } else if (!data.length) {
        // Carga completa que vuelve VACÍA: casi siempre es fecha corrida (reloj/zona del device)
        // o empresa nula, no una jornada realmente sin puntos. Se deja el rango a la vista.
        console.warn('[recorridos] carga completa VACÍA', { fecha, desde, hasta, idEmpresa })
      } else {
        console.info(`[recorridos] ${fecha}: ${data.length} puntos${total != null ? ' (completo)' : ''}`)
      }
    }
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
          //
          // 🩸 `accuracy` (08/08/2026) — se PEDÍA en el select desde 1.9.0 y se tiraba acá, así que
          // nunca llegó a `limpiarTrazo` y la rama de puntos TRIANGULADOS no se activó jamás: la
          // condición es `Number(p.accuracy) > ACCURACY_MAX_M`, y con el campo ausente eso es
          // `NaN > 30` → false, siempre. O sea que la regla 40 ("un punto triangulado no se dibuja
          // ni se cuenta como GPS") era falsa en toda la app: esos puntos se dibujaban como línea
          // llena, entraban al snap y sumaban kilómetros. Medido sobre la semana del 01 al 08/08:
          // entre 0 y 0,6 % de los puntos por día, así que el arreglo mueve los km muy poco — pero
          // el que los movía era un dato que la app misma declara que no sirve para medir.
          e.points.push({ lat: p.lat, lng: p.lng, ts: p.ts, bateria: p.bateria, accuracy: p.accuracy })
        })
        porUsuario.forEach((e, id) => {
          const rolVal = conRol ? e.rol : next[id]?.rol
          const prevPoints = next[id]?.points || []
          // El incremental viene ordenado por `id`, no por `ts`. Si algún punto nuevo es anterior
          // al que lo precede (cola que drenó tarde), se reordena por `ts` sólo esta persona. Es
          // la única situación en que hace falta, y es barata: un sort por día y persona rezagada,
          // no uno por tick. Vale también para una persona que aparece por primera vez en un tick
          // (sin `prevPoints`): su lote puede mezclar rezagados con frescos.
          const points = prevPoints.length ? prevPoints.concat(e.points) : e.points
          let desordenado = false
          for (let i = Math.max(1, prevPoints.length); i < points.length; i++) {
            if (points[i].ts < points[i - 1].ts) { desordenado = true; break }
          }
          if (desordenado) points.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
          next[id] = { rol: rolVal, points }
        })
        return next
      })
      // El cursor es el `id` MÁXIMO recibido. En la completa las filas vienen por `ts`, así que el
      // último de la lista no es necesariamente el de `id` más alto; se barre.
      let maxId = lastIdRef.current ?? -1
      let maxTs = lastTsRef.current || ''
      for (const p of data) { if (p.id > maxId) maxId = p.id; if (p.ts > maxTs) maxTs = p.ts }
      lastIdRef.current = maxId
      lastTsRef.current = maxTs
    } else if (!incremental) {
      setByUser({})
    }
    setUpdatedAt(Date.now())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idEmpresa, fecha, conRol])

  // Carga inicial y al cambiar de fecha/empresa: primero se intenta hidratar desde la caché
  // (pintado instantáneo, sin spinner) y se sigue con una incremental que trae solo lo nuevo.
  // Si la caché no corresponde a esta fecha/empresa/forma, se cae a la carga completa.
  useEffect(() => {
    let vigente = true
    lastIdRef.current = null
    lastTsRef.current = null
    ultimaPersistRef.current = 0 // el día nuevo se persiste apenas llega, sin esperar la ventana
    // Limpiar SINCRÓNICAMENTE al cambiar de fecha/empresa/forma. Si no, durante los ~800 ms que
    // tarda la lectura de caché, `byUser` sigue teniendo los datos del día ANTERIOR, y las vistas
    // (que reencuadran "la primera vez que hay datos") marcan el encuadre como hecho con esos
    // datos viejos → cuando llega el día nuevo, se dibuja pero la cámara nunca se mueve hacia él y
    // el recorrido queda fuera de pantalla ("mapa vacío" aunque los puntos cargaron). Vaciar acá
    // cierra esa ventana: la vista ve vacío hasta que llega el día correcto y ahí sí reencuadra.
    // No afecta el auto-refresh (ese llama a load() directo, no re-dispara este efecto).
    setByUser({})
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
      // `lastId` es obligatorio: una caché escrita antes del cursor por `id` (13/09/2026) no
      // sirve para seguir incremental y cae a la carga completa, una sola vez.
      const sirve = cache && cache.fecha === fecha && cache.idEmpresa === idEmpresa &&
        cache.conRol === conRol && cache.lastId != null && cache.byUser
      if (sirve) {
        setByUser(cache.byUser)
        lastIdRef.current = cache.lastId
        lastTsRef.current = cache.lastTs || null
        load(true)
      } else {
        setByUser({})
        load(false)
      }
    })()
    return () => { vigente = false }
  }, [load, fecha, idEmpresa, conRol, authEpoch])

  // Persistir lo cargado. Se guarda UNA sola fecha (la clave es fija y el registro lleva
  // adentro fecha/empresa/forma): así cambiar de día pisa la entrada anterior y el storage
  // queda acotado a ~200 KB en vez de crecer un día por cada fecha visitada.
  //
  // 20/07/2026 — PLAN_SAAS.md §3.4 pedía namespacear esta clave por empresa. Se decidió
  // NO hacerlo: la lectura ya valida `cache.idEmpresa === idEmpresa` (más arriba), así
  // que una entrada de otro tenant se descarta y no hay fuga — a lo sumo un cache-miss
  // al alternar empresas. Namespacear sí tendría costo: `services/persistence` no expone
  // keys() ni clear(), así que las entradas de tenants viejos quedarían huérfanas y sin
  // forma de purgarlas, que es justo lo que el párrafo de arriba evita. Revisar solo si
  // llega el selector de scope del TenantContext.
  //
  // 13/09/2026 — se escribe DIFERIDO. Antes iba en cada cambio de `byUser`, o sea cada tick de
  // 60 s: la jornada entera (20-26k puntos ≈ 2-3 MB de JSON) serializada y escrita en SQLite o
  // localStorage sesenta veces por hora, para una caché cuyo único fin es que la PRÓXIMA apertura
  // pinte al instante. Ahora se guarda como mucho cada `PERSISTIR_CADA_MS`, y además al ocultarse
  // el documento (que es cuando de verdad puede venir el cierre) y al desmontar.
  useEffect(() => {
    if (!idEmpresa || lastIdRef.current == null) return
    if (!Object.keys(byUser).length) return
    const snap = { fecha, idEmpresa, conRol, byUser, lastId: lastIdRef.current, lastTs: lastTsRef.current }
    const ahora = Date.now()
    if (ahora - ultimaPersistRef.current >= PERSISTIR_CADA_MS) {
      ultimaPersistRef.current = ahora
      pendienteRef.current = null
      persistence.set(CACHE_KEY, snap)
    } else {
      pendienteRef.current = snap
    }
  }, [byUser, fecha, idEmpresa, conRol])
  useEffect(() => {
    const volcar = () => {
      if (!pendienteRef.current) return
      persistence.set(CACHE_KEY, pendienteRef.current)
      pendienteRef.current = null
      ultimaPersistRef.current = Date.now()
    }
    const onVis = () => { if (document.visibilityState === 'hidden') volcar() }
    document.addEventListener('visibilitychange', onVis)
    return () => { document.removeEventListener('visibilitychange', onVis); volcar() }
  }, [])

  // Auto-refresh incremental cada 60s (solo si la fecha es HOY; el pasado no cambia).
  useEffect(() => {
    if (!esHoy) return
    const iv = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(iv)
  }, [esHoy, load])

  // El botón "refrescar" va INCREMENTAL si ya hay cursor: traer de nuevo la jornada entera
  // no aporta nada (intradía nadie borra puntos) y era justo lo que hacía que refrescar
  // tardara. Sin cursor todavía no hay nada que completar, así que va la carga completa.
  return { byUser, updatedAt, loading, esHoy, error, reload: () => load(lastIdRef.current != null) }
}
