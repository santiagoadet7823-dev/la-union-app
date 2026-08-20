/**
 * Genera un PNG del recorrido de un vendedor (informe diario / reuniones). Compone
 * en un <canvas>: basemap de calles (tiles OpenStreetMap, con crossOrigin para no
 * "ensuciar" el canvas), la polilínea del recorrido (idealmente ya pegada a calles),
 * marcadores de inicio/fin y un encabezado corporativo con los datos de la jornada.
 *
 * No depende de Leaflet: proyecta las coordenadas con matemática de slippy-map, así
 * el informe sale prolijo y con tamaño fijo sin capturar el DOM.
 */
import { descargarArchivo } from '../download'

const TILE = 256
const lon2x = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z)
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * Math.pow(2, z)
}

export function pickZoom(b, w, h, pad) {
  for (let z = 18; z >= 3; z--) {
    const dx = (lon2x(b.maxLng, z) - lon2x(b.minLng, z)) * TILE
    const dy = (lat2y(b.minLat, z) - lat2y(b.maxLat, z)) * TILE
    if (dx <= w - pad * 2 && dy <= h - pad * 2) return z
  }
  return 3
}

/** Caja que contiene a todos los puntos. Exportada porque la pantalla la necesita para el encuadre. */
export function limitesDe(coords) {
  return coords.reduce(
    (a, p) => ({
      minLat: Math.min(a.minLat, p.lat), maxLat: Math.max(a.maxLat, p.lat),
      minLng: Math.min(a.minLng, p.lng), maxLng: Math.max(a.maxLng, p.lng),
    }),
    { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 }
  )
}

/**
 * Caché de tiles de la sesión. Componer un recorrido baja entre 6 y 20 tiles del servidor DONADO de
 * OSM, y desde que se puede reencuadrar a mano eso se repite en cada ajuste. Sin caché, mover el
 * mapa cinco veces son cinco tandas completas contra un servidor que nos regala el servicio.
 * Es un Map de sesión: se va con la pestaña, no persiste nada.
 */
const cacheTiles = new Map()

function loadImg(url) {
  if (cacheTiles.has(url)) return cacheTiles.get(url)
  const p = new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = url
  })
  // Un tile que falla NO se cachea: la próxima vez se vuelve a intentar.
  p.catch(() => cacheTiles.delete(url))
  cacheTiles.set(url, p)
  return p
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * @param {{ coords:Array<{lat,lng}>, titulo?:string, subtitulo?:string,
 *           stats?:Array<{label,value}>, color?:string, filename?:string,
 *           paradas?:Array<{lat,lng,orden}>, devolver?:'archivo'|'dataUrl' }} opts
 *
 * `paradas` (08/08/2026) dibuja los carteles NUMERADOS, con la misma numeración que el mapa de la
 * app y que la tabla del informe. Sin ellos la imagen muestra por dónde anduvo pero no qué hizo, que
 * es justamente lo que alguien busca cuando pide "mandame el recorrido".
 *
 * `devolver:'dataUrl'` no descarga nada: devuelve la imagen lista para incrustar en el informe que
 * se va a imprimir a PDF. Es lo que hace que el PDF salga CON el mapa adentro en vez de mandar dos
 * archivos sueltos que el que los recibe tiene que volver a juntar.
 *
 * 🩸 ENCUADRE Y RESOLUCIÓN (19/08/2026). El cliente reportó que un recorrido de ciudad a ciudad
 * sale ilegible. Eran tres cosas sumadas, y las tres se arreglan acá:
 *
 *  1. **`escala`** (1 por defecto, 2 en el informe). Multiplica el lienzo entero. Y no es solo
 *     "más píxeles": como `pickZoom` decide sobre el lienzo YA escalado, al doble de tamaño elige
 *     un nivel de zoom MÁS PROFUNDO, así que los tiles entran a resolución nativa en vez de
 *     agrandados. Es la forma de tener detalle real sin tiles `@2x`, que el servidor público de
 *     OSM no sirve. A 960×600 el PDF salía a ~96 dpi, visiblemente pixelado.
 *  2. **`zoom`**, para pisar el automático. El automático es un ENTERO: un recorrido que se pasa
 *     apenas del ancho baja un nivel completo y queda a la mitad de escala sin necesidad.
 *  3. **`centro`**, para pisar el centro de la caja. Un solo tramo interurbano estira la caja y
 *     hunde el detalle urbano —donde están las paradas— aunque sea lo único que se quiere mirar.
 *
 * Los tres son OPCIONALES y sin ellos la función se comporta exactamente como antes, así que
 * `ReplayJornada` y la descarga suelta no cambian.
 */
export async function exportarRutaPng({ coords, titulo, subtitulo, stats = [], color = '#0ABAB5', filename = 'recorrido.png', paradas = [], devolver = 'archivo', escala = 1, zoom = null, centro = null }) {
  if (!coords || coords.length < 2) throw new Error('Sin recorrido para exportar')

  // `k` multiplica TODO lo que se dibuja: lienzo, grosores, radios y tipografías. Si se escalara
  // solo el lienzo, la línea y los carteles quedarían finitos y el informe se vería peor, no mejor.
  const k = Math.max(1, Math.min(3, escala))
  const W = 960 * k
  const MAP_H = 600 * k
  const HEADER = 132 * k
  const pad = 60 * k

  const b = limitesDe(coords)
  const zAuto = pickZoom(b, W, MAP_H, pad)
  const z = zoom == null ? zAuto : Math.max(3, Math.min(18, Math.round(zoom)))
  const cLat = centro?.lat ?? (b.minLat + b.maxLat) / 2
  const cLng = centro?.lng ?? (b.minLng + b.maxLng) / 2
  const centerPx = lon2x(cLng, z) * TILE
  const centerPy = lat2y(cLat, z) * TILE
  const originX = centerPx - W / 2
  const originY = centerPy - MAP_H / 2

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = HEADER + MAP_H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#e7f0ef'
  ctx.fillRect(0, 0, W, HEADER + MAP_H)

  // --- Basemap (tiles) ---
  const n = Math.pow(2, z)
  const x0 = Math.floor(originX / TILE)
  const x1 = Math.floor((originX + W) / TILE)
  const y0 = Math.floor(originY / TILE)
  const y1 = Math.floor((originY + MAP_H) / TILE)
  const jobs = []
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue
      const wx = ((tx % n) + n) % n
      const sub = 'abc'[Math.abs(wx + ty) % 3]
      const url = `https://${sub}.tile.openstreetmap.org/${z}/${wx}/${ty}.png`
      const dx = tx * TILE - originX
      const dy = ty * TILE - originY + HEADER
      jobs.push(loadImg(url).then((img) => ctx.drawImage(img, dx, dy)).catch(() => {}))
    }
  }
  await Promise.all(jobs)

  // --- Polilínea del recorrido ---
  const toXY = (p) => [lon2x(p.lng, z) * TILE - originX, lat2y(p.lat, z) * TILE - originY + HEADER]
  const trace = () => { ctx.beginPath(); coords.forEach((p, i) => { const [x, y] = toXY(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y) }); }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(255,255,255,.9)'
  ctx.lineWidth = 8 * k
  trace(); ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = 5 * k
  trace(); ctx.stroke()

  // Disco con número/letra. Relleno BLANCO con anillo de color y texto oscuro: el mismo lenguaje
  // que los hitos y los carteles numerados del mapa de la app (LeafletMap.hitoIcon / dwellIcon).
  // Un informe que usa otros símbolos que la pantalla obliga a traducir entre los dos.
  const mark = (p, anillo, label, radioBase = 11) => {
    const r = radioBase * k
    const [x, y] = toXY(p)
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = '#ffffff'; ctx.fill()
    ctx.lineWidth = 3 * k; ctx.strokeStyle = anillo; ctx.stroke()
    ctx.fillStyle = '#0B2B2A'
    ctx.font = `bold ${r - 2 * k}px sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label, x, y)
  }
  // Las paradas van ANTES que inicio y fin: si una parada coincide con el arranque (arrancó en el
  // depósito y estuvo media hora cargando), el que tiene que quedar arriba es el hito.
  paradas.forEach((p) => mark(p, color, String(p.orden), 10))
  mark(coords[0], '#10B981', '▶')
  mark(coords[coords.length - 1], '#EF4444', '■')

  // --- Encabezado (se dibuja al final, tapa cualquier desborde de tiles/línea) ---
  ctx.fillStyle = '#0B2B2A'
  ctx.fillRect(0, 0, W, HEADER)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#2DD4CE'
  ctx.font = `bold ${26 * k}px sans-serif`
  ctx.fillText(titulo || 'Recorrido', 28 * k, 46 * k)
  ctx.fillStyle = '#9fb6b4'
  ctx.font = `${14 * k}px sans-serif`
  ctx.fillText(subtitulo || '', 28 * k, 72 * k)

  let cx = 28 * k
  ctx.font = `bold ${15 * k}px monospace`
  stats.forEach((s) => {
    const txt = `${s.label}: ${s.value}`
    const w = ctx.measureText(txt).width + 20 * k
    ctx.fillStyle = 'rgba(45,212,206,.16)'
    roundRect(ctx, cx, 90 * k, w, 28 * k, 8 * k); ctx.fill()
    ctx.fillStyle = '#d7efed'
    ctx.fillText(txt, cx + 10 * k, 109 * k)
    cx += w + 10 * k
  })

  ctx.textAlign = 'right'
  ctx.fillStyle = '#2DD4CE'
  ctx.font = `bold ${18 * k}px sans-serif`
  ctx.fillText('DisT-At', W - 28 * k, 42 * k)
  ctx.fillStyle = '#9fb6b4'
  ctx.font = `${11 * k}px sans-serif`
  ctx.fillText('Informe de recorrido', W - 28 * k, 62 * k)

  // Para incrustar en el informe impreso: sin descarga, sin hoja de compartir.
  if (devolver === 'dataUrl') return canvas.toDataURL('image/png')

  // --- Descarga (web: anchor; APK: filesystem + compartir, vía helper) ---
  const blob = await new Promise((res, rej) => {
    canvas.toBlob((b) => {
      if (!b) { rej(new Error('No se pudo generar la imagen')); return }
      res(b)
    }, 'image/png')
  })
  await descargarArchivo({ filename, blob, mime: 'image/png' })
}
