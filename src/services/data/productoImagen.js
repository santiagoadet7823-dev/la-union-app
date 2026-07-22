import { supabase } from '../supabase'

/**
 * Subida de imágenes (fotos de producto y avatares de perfil) a Supabase Storage.
 *
 * Por qué Storage y no Postgres: las imágenes NO cuentan contra la base (plan free =
 * 1 GB de Storage aparte), y guardamos solo la URL pública en la fila. La URL absoluta
 * de Storage además es inmune al doble base path del APK (`/la-union-app/` vs `./`).
 *
 * Antes de subir, comprimimos en el cliente (~800 px lado mayor, ~72 %) para que cada
 * imagen pese ~50-100 KB: así el egress del plan free no se dispara y el 1 GB alcanza
 * para miles de productos.
 */

const MAX_LADO = 800   // px del lado mayor tras redimensionar
const CALIDAD = 0.72   // calidad de encode (0..1)

/**
 * Comprime y redimensiona un File de imagen a un Blob liviano.
 * Intenta WebP; si el WebView viejo no sabe encodearlo, cae a JPEG (ambos soportados
 * en los buckets). Devuelve { blob, ext, tipo }.
 */
export function comprimirImagen(file, maxLado = MAX_LADO, calidad = CALIDAD) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * escala))
      const h = Math.max(1, Math.round(img.height * escala))
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)

      const entregar = (blob, tipo, ext) => {
        if (blob) resolve({ blob, tipo, ext })
        else reject(new Error('No se pudo procesar la imagen'))
      }
      // toBlob es asíncrono y no infla memoria como toDataURL. WebP primero; si el
      // motor devuelve null (no sabe encodear webp), reintenta JPEG.
      if (canvas.toBlob) {
        canvas.toBlob((b) => {
          if (b) return entregar(b, 'image/webp', 'webp')
          canvas.toBlob((b2) => entregar(b2, 'image/jpeg', 'jpg'), 'image/jpeg', calidad)
        }, 'image/webp', calidad)
      } else {
        // Fallback extremo (WebView sin toBlob): usar dataURL → Blob.
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', calidad)
          const bin = atob(dataUrl.split(',')[1])
          const arr = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
          entregar(new Blob([arr], { type: 'image/jpeg' }), 'image/jpeg', 'jpg')
        } catch (e) {
          reject(e)
        }
      }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Archivo de imagen inválido')) }
    img.src = url
  })
}

/**
 * Sube un File de imagen a un bucket/carpeta, comprimiéndolo antes. Sobrescribe (upsert)
 * la ruta dada para que reemplazar la foto sea idempotente.
 *
 * @returns {{ url: string|null, error: Error|null }} url pública lista para guardar en la fila.
 */
async function subir(bucket, carpeta, file) {
  if (!supabase) return { url: null, error: new Error('Sin conexión a Supabase') }
  try {
    const { blob, tipo, ext } = await comprimirImagen(file)
    const path = `${carpeta}.${ext}`
    const { error } = await supabase.storage.from(bucket).upload(path, blob, {
      contentType: tipo,
      upsert: true,
      cacheControl: '3600',
    })
    if (error) return { url: null, error }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path)
    // Cache-busting: la ruta es estable (se pisa), así que sin el ?v la CDN seguiría
    // sirviendo la imagen anterior tras un reemplazo.
    const url = `${data.publicUrl}?v=${Date.now()}`
    return { url, error: null }
  } catch (error) {
    return { url: null, error }
  }
}

/** Foto de producto → bucket 'productos', carpeta por empresa. */
export function subirImagenProducto(idEmpresa, productoId, file) {
  return subir('productos', `${idEmpresa}/${productoId}`, file)
}

/** Avatar de perfil → bucket 'avatares', un objeto por usuario. */
export function subirAvatar(userId, file) {
  return subir('avatares', `${userId}`, file)
}
