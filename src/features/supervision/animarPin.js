import { obtenerRuta } from '../../services/routing'

/**
 * Animación del pin en vivo: mover a una persona del punto A al punto B como se mueve de verdad,
 * en vez de teletransportarla.
 *
 * Hasta 1.7.0 la capa de móviles hacía `clearLayers()` y recreaba TODOS los marcadores con cada
 * posición que llegaba por Realtime, así que ni siquiera existía un marcador que pudiera animarse:
 * el de antes moría y el de después nacía ya en el destino. El salto no era un problema de duración,
 * era que no había nada moviéndose.
 *
 * Las tres piezas que hacen que se lea como "en vivo" (es lo que hace Google Maps, y ninguna es un
 * efecto de CSS):
 *
 *  1. **Interpolar**, no saltar: recorrer el tramo repartido en frames.
 *  2. **Interpolar sobre la CALLE, no sobre la recta.** Es la que más cambia la sensación: sin esto
 *     el pin atraviesa la manzana en diagonal, que es exactamente lo que delata que el dato es
 *     puntual y el resto es relleno. La ruta la da OSRM, que ya está en el repo (services/routing).
 *  3. **Velocidad CONSTANTE**, sin easing. Un ease-in-out se lee como "animación de interfaz"; la
 *     velocidad pareja se lee como un vehículo andando. Es al revés que en el resto de la app,
 *     donde todo entra con `cubic-bezier(.23,1,.32,1)`.
 *
 * Vive en `features/supervision/` y no en el componente del mapa porque lo consumen las dos
 * supervisiones y el propietario (regla 31: lo compartido va en un módulo, nunca copiado).
 */

const R_TIERRA = 6371000

/** Metros entre dos puntos [lat, lng]. */
export function distanciaM(a, b) {
  if (!a || !b) return 0
  const rad = Math.PI / 180
  const dLat = (b[0] - a[0]) * rad
  const dLng = (b[1] - a[1]) * rad
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * R_TIERRA * Math.asin(Math.min(1, Math.sqrt(s)))
}

// Por debajo de esto la recta y la calle son la misma cosa: rutear sería gastar una consulta para
// mover el pin los mismos 20 metros. La mayoría de los tramos en vivo caen acá.
const MIN_SNAP_M = 40
// Por encima de esto no es un tramo, es un HUECO (el teléfono estuvo sin reportar). Rutearlo
// dibujaría un viaje inventado por calles que quizás no hizo: se cruza en recta, que al menos se
// nota que es un salto. Mismo criterio que el conector punteado de trazos.js.
const MAX_SNAP_M = 2500

const DUR_MIN_MS = 400
// Tope de duración: si entre dos posiciones pasaron 3 minutos, animar 3 minutos dejaría el pin
// arrastrándose eternamente y la cámara persiguiéndolo. Se recorre rápido y se espera ahí.
const DUR_MAX_MS = 6000

// Cache de tramos ya pegados a calles. La clave redondea a ~1 m: dos posiciones GPS nunca son
// idénticas, pero un vendedor que hace el mismo recorrido reusa los tramos.
const cacheRuta = new Map()
const CACHE_MAX = 300

function claveTramo(a, b) {
  const r = (n) => n.toFixed(5)
  return `${r(a[0])},${r(a[1])}>${r(b[0])},${r(b[1])}`
}

function guardarEnCache(clave, coords) {
  if (cacheRuta.size >= CACHE_MAX) {
    // FIFO simple: el Map de JS conserva el orden de inserción.
    const primera = cacheRuta.keys().next().value
    cacheRuta.delete(primera)
  }
  cacheRuta.set(clave, coords)
}

function prefiereMenosMovimiento() {
  try {
    return typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch (_) { return false }
}

/**
 * Pide el camino por calles entre dos puntos. Devuelve `null` (no lanza) cuando no corresponde o
 * no se pudo: el llamador anima en recta. **Nunca se espera a la ruta para empezar a moverse** —
 * un pin congelado esperando una consulta de red es peor que un pin que va derecho.
 */
async function caminoPorCalles(a, b) {
  const d = distanciaM(a, b)
  if (d < MIN_SNAP_M || d > MAX_SNAP_M) return null
  const clave = claveTramo(a, b)
  if (cacheRuta.has(clave)) return cacheRuta.get(clave)
  try {
    const { coords } = await obtenerRuta({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] })
    if (!coords || coords.length < 2) return null
    guardarEnCache(clave, coords)
    return coords
  } catch (_) {
    // OSRM público: puede fallar, tardar o rechazar por cuota. No es un error de esta pantalla.
    return null
  }
}

/** Longitudes acumuladas de una polilínea, para poder repartir la duración por distancia real. */
function acumuladas(puntos) {
  const acum = [0]
  for (let i = 1; i < puntos.length; i++) acum.push(acum[i - 1] + distanciaM(puntos[i - 1], puntos[i]))
  return acum
}

/** Punto a `t` (0..1) del recorrido, medido por distancia y no por índice. */
function puntoEn(puntos, acum, t) {
  const total = acum[acum.length - 1]
  if (!total) return puntos[puntos.length - 1]
  const objetivo = t * total
  let i = 1
  while (i < acum.length && acum[i] < objetivo) i++
  if (i >= puntos.length) return puntos[puntos.length - 1]
  const tramo = acum[i] - acum[i - 1]
  const f = tramo > 0 ? (objetivo - acum[i - 1]) / tramo : 0
  const a = puntos[i - 1]
  const b = puntos[i]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/**
 * Crea un animador con estado propio (una instancia por mapa). Cada persona se anima por separado
 * y de forma independiente.
 */
export function crearAnimadorPines() {
  // id → { cancelado, raf, marker, destino }
  const activos = new Map()

  /**
   * 🩸 `requestAnimationFrame` NO DISPARA con el documento oculto (02/08/2026, encontrado al
   * verificar esto en el navegador: `visibilityState: 'hidden'` → cero frames en 500 ms). Sin esta
   * red de contención, cambiar de pestaña a mitad de un tramo deja el pin CONGELADO en el medio y
   * ahí se queda hasta la próxima posición: el supervisor vuelve y ve a la persona en un lugar por
   * el que ya pasó. Es peor que no animar, porque el error es indistinguible de un dato real.
   *
   * Al volver a ver la pestaña, toda animación pendiente salta a su destino. Perder la animación es
   * gratis —nadie la estaba mirando—; mostrar una posición vieja no.
   */
  const alVolver = () => {
    if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
    activos.forEach((a, id) => {
      if (a.marker && a.destino) { try { a.marker.setLatLng(a.destino) } catch (_) {} }
      a.cancelado = true
      if (a.raf) cancelAnimationFrame(a.raf)
      activos.delete(id)
    })
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', alVolver)

  function cancelar(id) {
    const a = activos.get(id)
    if (!a) return
    a.cancelado = true
    if (a.raf) cancelAnimationFrame(a.raf)
    activos.delete(id)
  }

  function cancelarTodo() {
    Array.from(activos.keys()).forEach(cancelar)
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', alVolver)
  }

  /**
   * Mueve `marker` hasta `destino`.
   *
   * @param {string} id        identidad de la persona (para poder cancelar su animación anterior)
   * @param {object} marker    L.Marker ya en el mapa
   * @param {[number,number]} destino
   * @param {{duracionMs?:number, alFrame?:(latlng:[number,number])=>void}} opts
   *        `alFrame` corre en CADA frame: es por donde la cámara sigue al pin sin ir un paso atrás.
   */
  function mover(id, marker, destino, { duracionMs, alFrame } = {}) {
    if (!marker || !destino) return
    // Arranca desde donde el pin ESTÁ, no desde la última posición conocida: si llega un dato nuevo
    // a mitad de camino, seguir desde el punto real evita el tirón hacia atrás.
    const actual = marker.getLatLng()
    const desde = [actual.lat, actual.lng]
    cancelar(id)

    const d = distanciaM(desde, destino)
    // Sin movimiento apreciable no se anima: el keepAlive del teléfono manda un punto cada 30 s
    // estando quieto, y animar 2 metros sería un temblor permanente en el mapa.
    if (d < 2 || prefiereMenosMovimiento()) {
      marker.setLatLng(destino)
      alFrame?.(destino)
      return
    }

    const dur = Math.max(DUR_MIN_MS, Math.min(DUR_MAX_MS, duracionMs || DUR_MAX_MS))
    // `marker` y `destino` quedan guardados para que `alVolver()` pueda cerrar la animación si la
    // pestaña estuvo oculta y el rAF nunca corrió.
    const estado = { cancelado: false, raf: null, marker, destino }
    activos.set(id, estado)

    // Se arranca YA en recta y, si llega el camino por calles, se cambia en caliente. El pin nunca
    // espera a la red para empezar a moverse.
    let puntos = [desde, destino]
    let acum = acumuladas(puntos)
    const t0 = performance.now()

    caminoPorCalles(desde, destino).then((coords) => {
      if (estado.cancelado || !coords) return
      // El progreso se conserva porque `t` es una fracción del recorrido, no un índice: cambiar la
      // geometría a mitad de camino reubica el pin sobre la calle sin saltar hacia atrás.
      puntos = coords
      acum = acumuladas(puntos)
    })

    const paso = (ahora) => {
      if (estado.cancelado) return
      const t = Math.min(1, (ahora - t0) / dur)
      const p = puntoEn(puntos, acum, t)
      marker.setLatLng(p)
      alFrame?.(p)
      if (t < 1) estado.raf = requestAnimationFrame(paso)
      else activos.delete(id)
    }
    estado.raf = requestAnimationFrame(paso)
  }

  return { mover, cancelar, cancelarTodo }
}
