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

function pickZoom(b, w, h, pad) {
  for (let z = 18; z >= 3; z--) {
    const dx = (lon2x(b.maxLng, z) - lon2x(b.minLng, z)) * TILE
    const dy = (lat2y(b.minLat, z) - lat2y(b.maxLat, z)) * TILE
    if (dx <= w - pad * 2 && dy <= h - pad * 2) return z
  }
  return 3
}

function loadImg(url) {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = url
  })
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
 *           stats?:Array<{label,value}>, color?:string, filename?:string }} opts
 */
export async function exportarRutaPng({ coords, titulo, subtitulo, stats = [], color = '#0ABAB5', filename = 'recorrido.png' }) {
  if (!coords || coords.length < 2) throw new Error('Sin recorrido para exportar')

  const W = 960
  const MAP_H = 600
  const HEADER = 132
  const pad = 60

  const b = coords.reduce(
    (a, p) => ({
      minLat: Math.min(a.minLat, p.lat), maxLat: Math.max(a.maxLat, p.lat),
      minLng: Math.min(a.minLng, p.lng), maxLng: Math.max(a.maxLng, p.lng),
    }),
    { minLat: 90, maxLat: -90, minLng: 180, maxLng: -180 }
  )
  const z = pickZoom(b, W, MAP_H, pad)
  const centerPx = lon2x((b.minLng + b.maxLng) / 2, z) * TILE
  const centerPy = lat2y((b.minLat + b.maxLat) / 2, z) * TILE
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
      const url = `https://a.tile.openstreetmap.org/${z}/${wx}/${ty}.png`
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
  ctx.lineWidth = 8
  trace(); ctx.stroke()
  ctx.strokeStyle = color
  ctx.lineWidth = 5
  trace(); ctx.stroke()

  const mark = (p, fill, label) => {
    const [x, y] = toXY(p)
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2)
    ctx.fillStyle = fill; ctx.fill()
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(label, x, y)
  }
  mark(coords[0], '#10B981', 'A')
  mark(coords[coords.length - 1], '#EF4444', 'B')

  // --- Encabezado (se dibuja al final, tapa cualquier desborde de tiles/línea) ---
  ctx.fillStyle = '#0B2B2A'
  ctx.fillRect(0, 0, W, HEADER)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#2DD4CE'
  ctx.font = 'bold 26px sans-serif'
  ctx.fillText(titulo || 'Recorrido', 28, 46)
  ctx.fillStyle = '#9fb6b4'
  ctx.font = '14px sans-serif'
  ctx.fillText(subtitulo || '', 28, 72)

  let cx = 28
  ctx.font = 'bold 15px monospace'
  stats.forEach((s) => {
    const txt = `${s.label}: ${s.value}`
    const w = ctx.measureText(txt).width + 20
    ctx.fillStyle = 'rgba(45,212,206,.16)'
    roundRect(ctx, cx, 90, w, 28, 8); ctx.fill()
    ctx.fillStyle = '#d7efed'
    ctx.fillText(txt, cx + 10, 109)
    cx += w + 10
  })

  ctx.textAlign = 'right'
  ctx.fillStyle = '#2DD4CE'
  ctx.font = 'bold 18px sans-serif'
  ctx.fillText('DisT-At', W - 28, 42)
  ctx.fillStyle = '#9fb6b4'
  ctx.font = '11px sans-serif'
  ctx.fillText('Informe de recorrido', W - 28, 62)

  // --- Descarga (web: anchor; APK: filesystem + compartir, vía helper) ---
  const blob = await new Promise((res, rej) => {
    canvas.toBlob((b) => {
      if (!b) { rej(new Error('No se pudo generar la imagen')); return }
      res(b)
    }, 'image/png')
  })
  await descargarArchivo({ filename, blob, mime: 'image/png' })
}
