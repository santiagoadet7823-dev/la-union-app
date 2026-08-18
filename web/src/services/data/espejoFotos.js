import { isNative } from '../platform'

/**
 * ESPEJO LOCAL DE LAS FOTOS DEL CATÁLOGO (18/08/2026).
 *
 * 🩸 POR QUÉ EXISTE. `productos.imagen_url` apunta a Supabase Storage y las fotos las baja el
 * WebView solo, al pintar cada `<img>`. Eso alcanza para mostrarlas en el celular y **no alcanza
 * para nada más**: los bytes quedan en el caché HTTP del WebView, que el código no puede leer. Para
 * servirle el catálogo a una tablet por el enlace local —sin internet del otro lado— el celular
 * necesita copia propia de cada archivo.
 *
 * Volumen medido sobre las 626 fotos que se cargaron desde el PDF: **20 KB de promedio, 88 KB la
 * más pesada** (`productoImagen.js:12-13`), o sea ~13 MB para el catálogo entero.
 *
 * 🩸 Y POR ESO NUNCA CORRE SOLO. Esos 13 MB los paga el empleado con sus datos móviles si sale a
 * la calle sin haberlo preparado. La lección ya está escrita en la regla 48 —el reintento del APK
 * iba a quemar ~430 MB por día y por teléfono en silencio—, así que acá la descarga es **siempre**
 * una acción explícita de una persona, con el peso a la vista antes de apretar.
 *
 * ⚠️ NO se gatea con `navigator.onLine` ni con el tipo de conexión (regla 12: el WebView de Android
 * reporta offline estando conectado). `pistaDeConexion()` existe para AVISAR, no para prohibir: si
 * el dato miente, lo peor que hace es mostrar un cartel de más.
 *
 * CÓMO SABE QUE UNA FOTO CAMBIÓ: no hace falta hashear nada. `subirImagenProducto` devuelve la URL
 * con un `?v=<timestamp>` de cache-busting, así que **la URL cambia cada vez que se reemplaza la
 * foto**. El índice guarda la URL con la que se bajó cada archivo y compara strings.
 */

// Carpeta dentro de `Directory.Data`, que en Android es `context.getFilesDir()` — privada de la app
// y persistente (el sistema no la limpia como a `Cache`). Es la misma que va a leer el servidor
// local del lado nativo, así que la ruta es parte del contrato: no moverla sin tocar Java.
const CARPETA = 'espejo'
const INDICE = `${CARPETA}/indice.json`

// De a 3 en paralelo. Uno por vez son ~626 viajes en serie; más de 3 no acelera (el cuello es la
// CDN, no el teléfono) y multiplica la memoria, porque cada foto pasa por base64 antes de escribirse.
const EN_PARALELO = 3

/** Extensión real de la foto, sacada de la ruta (la URL trae `?v=` pegado atrás). */
function extDeUrl(url) {
  const sinQuery = String(url || '').split('?')[0]
  const punto = sinQuery.lastIndexOf('.')
  const ext = punto >= 0 ? sinQuery.slice(punto + 1).toLowerCase() : ''
  return /^(webp|jpg|jpeg|png)$/.test(ext) ? ext : 'webp'
}

/** Ruta del archivo local de un producto. La usa el servidor nativo con el mismo criterio. */
export function rutaLocal(productoId, ext) {
  return `${CARPETA}/${productoId}.${ext}`
}

async function fs() {
  const mod = await import('@capacitor/filesystem')
  return { Filesystem: mod.Filesystem, Directory: mod.Directory }
}

/** Lee el índice. Un índice ilegible se trata como vacío: se rebaja a volver a bajar, nunca a romper. */
async function leerIndice() {
  try {
    const { Filesystem, Directory } = await fs()
    const { data } = await Filesystem.readFile({ path: INDICE, directory: Directory.Data, encoding: 'utf8' })
    const obj = JSON.parse(data)
    return obj && typeof obj === 'object' ? obj : {}
  } catch (_) {
    return {}
  }
}

async function escribirIndice(indice) {
  const { Filesystem, Directory } = await fs()
  await Filesystem.writeFile({
    path: INDICE, directory: Directory.Data, encoding: 'utf8',
    data: JSON.stringify(indice), recursive: true,
  })
}

/**
 * Qué falta bajar. `productos` son los de `useCatalog()` (ya mapeados: `id` e `imagen`).
 *
 * Devuelve también los HUÉRFANOS: archivos de productos que ya no están en el catálogo o que
 * perdieron la foto. Se limpian en la sincronización — si no, el espejo solo crece, y el que paga
 * el espacio es un teléfono de gama baja.
 */
export async function estadoEspejo(productos) {
  if (!isNative()) return { soportado: false, total: 0, presentes: 0, faltantes: [], huerfanos: [], bytes: 0 }
  return { soportado: true, ...diffEspejo(productos, await leerIndice()) }
}

/**
 * La decisión, separada del disco a propósito: es la única parte con reglas y así se puede probar
 * sin un teléfono. Recibe el catálogo y el índice ya leído.
 *
 * Tres reglas, y la del medio es la que importa:
 *  · un producto sin foto no cuenta para nada (ni falta ni sobra);
 *  · falta el que **no tiene la URL vigente** — no el que no está. Reemplazar una foto cambia el
 *    `?v=` de la URL, así que comparar strings detecta el cambio sin hashear nada;
 *  · sobra (huérfano) todo lo del índice que ya no esté en el catálogo con foto.
 */
export function diffEspejo(productos, indice) {
  const conFoto = (productos || []).filter((p) => p.imagen)
  const idx = indice || {}
  const faltantes = conFoto.filter((p) => idx[p.id]?.url !== p.imagen)
  const vigentes = new Set(conFoto.map((p) => p.id))
  const huerfanos = Object.keys(idx).filter((id) => !vigentes.has(id))
  const bytes = Object.entries(idx)
    .filter(([id]) => vigentes.has(id))
    .reduce((a, [, v]) => a + (v.bytes || 0), 0)
  return { total: conFoto.length, presentes: conFoto.length - faltantes.length, faltantes, huerfanos, bytes }
}

/** Blob → base64 pelado (sin el prefijo `data:`). Mismo patrón que `services/download.js`. */
function aBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onerror = () => rej(r.error || new Error('No se pudo leer la imagen'))
    r.onload = () => {
      const s = String(r.result || '')
      const c = s.indexOf(',')
      res(c >= 0 ? s.slice(c + 1) : s)
    }
    r.readAsDataURL(blob)
  })
}

/**
 * Baja al disco las fotos que falten. **Reanudable por construcción**: cada foto se escribe y se
 * anota en el índice de a una, así que cerrar la app a la mitad no pierde lo ya bajado ni obliga a
 * empezar de nuevo.
 *
 * Una foto que falla NO corta la tanda —una URL rota entre 626 no puede dejar al vendedor sin
 * espejo—; se cuenta como error y se reintenta la próxima vez, porque su entrada del índice sigue
 * sin coincidir con la URL vigente.
 *
 * @param {Array} productos          los de `useCatalog()`
 * @param {{ onProgreso?: (p:{hechas:number,total:number,errores:number}) => void, cancelado?: () => boolean }} opts
 */
export async function sincronizarEspejo(productos, { onProgreso, cancelado } = {}) {
  if (!isNative()) return { ok: false, motivo: 'solo-nativo', hechas: 0, errores: 0 }

  const { Filesystem, Directory } = await fs()
  const indice = await leerIndice()
  const { faltantes, huerfanos } = await estadoEspejo(productos)
  const total = faltantes.length
  let hechas = 0
  let errores = 0

  // Barrer huérfanos primero: libera espacio ANTES de pedir más, que es lo que importa en el
  // teléfono que está justo al límite.
  for (const id of huerfanos) {
    try {
      await Filesystem.deleteFile({ path: rutaLocal(id, indice[id]?.ext || 'webp'), directory: Directory.Data })
    } catch (_) { /* ya no estaba: es el resultado que queríamos */ }
    delete indice[id]
  }
  if (huerfanos.length) await escribirIndice(indice)

  const cola = [...faltantes]
  const obrero = async () => {
    while (cola.length) {
      if (cancelado?.()) return
      const p = cola.shift()
      try {
        const resp = await fetch(p.imagen)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const blob = await resp.blob()
        const ext = extDeUrl(p.imagen)
        await Filesystem.writeFile({
          path: rutaLocal(p.id, ext), directory: Directory.Data,
          data: await aBase64(blob), recursive: true,
        })
        indice[p.id] = { url: p.imagen, ext, bytes: blob.size, ts: Date.now() }
        // El índice se persiste por foto y no al final: si la app muere acá, lo bajado sigue contando.
        await escribirIndice(indice)
        hechas++
      } catch (_) {
        errores++
      }
      onProgreso?.({ hechas, total, errores })
    }
  }

  await Promise.all(Array.from({ length: Math.min(EN_PARALELO, Math.max(1, total)) }, obrero))
  return { ok: true, hechas, errores, total, cancelado: !!cancelado?.() }
}

/** Borra el espejo entero (para recuperar espacio). No toca el catálogo ni Storage. */
export async function vaciarEspejo() {
  if (!isNative()) return { ok: false }
  try {
    const { Filesystem, Directory } = await fs()
    await Filesystem.rmdir({ path: CARPETA, directory: Directory.Data, recursive: true })
    return { ok: true }
  } catch (_) {
    return { ok: false }
  }
}

/**
 * Pista del tipo de conexión, **solo para avisar**. `navigator.connection` no está en todos los
 * WebViews y miente en algunos; por eso devuelve `null` cuando no sabe, y ningún camino del código
 * puede bloquearse por esto (regla 12).
 */
export function pistaDeConexion() {
  const c = typeof navigator !== 'undefined' && (navigator.connection || navigator.webkitConnection)
  if (!c || !c.type) return null
  if (c.type === 'wifi' || c.type === 'ethernet') return 'wifi'
  if (c.type === 'cellular') return 'datos'
  return null
}

/** Peso legible, para el cartel que se muestra ANTES de bajar nada. */
export function pesoLegible(bytes) {
  if (!bytes) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb < 1) return `${Math.round(bytes / 1024)} KB`
  return `${mb.toFixed(1).replace('.', ',')} MB`
}
