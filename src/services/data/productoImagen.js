import { supabase } from '../supabase'

/**
 * Subida de imágenes (fotos de producto y avatares de perfil) a Supabase Storage.
 *
 * Por qué Storage y no Postgres: las imágenes NO cuentan contra la base (plan free =
 * 1 GB de Storage aparte), y guardamos solo la URL pública en la fila. La URL absoluta
 * de Storage además es inmune al doble base path del APK (`/la-union-app/` vs `./`).
 *
 * Antes de subir, comprimimos en el cliente (cuadrado de hasta 800 px, ~72 %) para que
 * cada imagen pese ~50-100 KB: así el egress del plan free no se dispara y el 1 GB alcanza
 * para miles de productos. Medido sobre las 626 fotos cargadas: 20 KB de promedio, 88 KB la
 * más pesada.
 *
 * La salida es SIEMPRE cuadrada y con fondo blanco — las dos cosas por un bug distinto, los dos
 * explicados en `comprimirImagen`. Aplica también a los avatares, que se muestran en círculo.
 */

const MAX_LADO = 800   // px del lado mayor tras redimensionar
const CALIDAD = 0.72   // calidad de encode (0..1)
const FONDO = '#ffffff' // relleno del lienzo cuadrado. Ver los dos comentarios de abajo.

/**
 * Comprime y redimensiona un File de imagen a un Blob liviano **CUADRADO**.
 * Intenta WebP; si el WebView viejo no sabe encodearlo, cae a JPEG (ambos soportados
 * en los buckets). Devuelve { blob, ext, tipo }.
 *
 * 🩸 POR QUÉ CUADRADO (12/08/2026). La tarjeta del vendedor mete la foto en una caja cuadrada con
 * RECORTE (`padding-top:100%` + `object-fit:cover`, `VisitaCatalogo.jsx`), así que una imagen
 * vertical pierde arriba y abajo. Hasta hoy esto conservaba la proporción del original y no lo
 * cuadraba nadie: con las 626 fotos que vinieron del PDF no molestaba —ya venían cuadradas— pero
 * marketing va a generar las que faltan con IA, y **el default de todos los generadores es
 * vertical** (1024×1536). El producto quedaba decapitado y el error solo se ve mirando la grilla
 * foto por foto.
 * Se centra sobre un lienzo cuadrado en vez de recortar porque recortar es exactamente lo que
 * queremos evitar, y en vez de deformar porque una botella estirada se ve peor que con aire al
 * costado. La guía le sigue pidiendo 1:1 a la persona (`GUIA_MARKETING_CATALOGO.md`): esto es la
 * red de contención para cuando alguien no la lea, no el permiso para ignorarla.
 * ⚠️ Una imagen que YA es cuadrada sale idéntica a como salía antes: mismo lado, misma escala,
 * `dx = dy = 0`. Este cambio solo toca a las que hoy se recortan.
 *
 * 🩸 Y POR QUÉ SE PINTA EL FONDO. Un canvas nuevo es TRANSPARENTE, y el camino de respaldo a JPEG
 * (WebViews viejos del parque, más abajo) no tiene canal alfa: lo transparente se encodea NEGRO.
 * Hoy no muerde porque ninguna de las fotos cargadas tiene alfa, pero un PNG con fondo transparente
 * es la salida natural de un generador de imágenes al que le pedís un producto recortado — o sea,
 * exactamente lo que va a subir marketing. Con el letterbox además hace falta igual: sin relleno,
 * las bandas de una imagen vertical serían transparentes (y negras en el fallback).
 */
export function comprimirImagen(file, maxLado = MAX_LADO, calidad = CALIDAD) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      // Lado del cuadrado: el lado mayor del original, con techo en `maxLado`. El `min` evita
      // AGRANDAR una imagen chica — subirla a 800 no le agrega detalle, solo peso.
      const lado = Math.max(1, Math.round(Math.min(maxLado, Math.max(img.width, img.height))))
      const escala = lado / Math.max(img.width, img.height)
      const w = Math.max(1, Math.round(img.width * escala))
      const h = Math.max(1, Math.round(img.height * escala))
      const canvas = document.createElement('canvas')
      canvas.width = lado
      canvas.height = lado
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = FONDO
      ctx.fillRect(0, 0, lado, lado)
      ctx.drawImage(img, Math.round((lado - w) / 2), Math.round((lado - h) / 2), w, h)

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

// Formatos que puede haber dejado esta u otra subida (comprimirImagen usa webp/jpg; imports viejos
// pudieron dejar jpeg/png). Se usa para borrar variantes de OTRO formato tras subir la nueva.
const EXTS_IMG = ['webp', 'jpg', 'jpeg', 'png']

/**
 * Sube un File de imagen a un bucket/carpeta, comprimiéndolo antes. Sobrescribe (upsert)
 * la ruta dada para que reemplazar la foto sea idempotente.
 *
 * Además borra cualquier variante de OTRA extensión de la misma carpeta: como el path incluye la
 * extensión (`carpeta.ext`), un cambio de formato entre subidas (p. ej. webp→jpg en un WebView que
 * no encodea webp) dejaría la foto anterior HUÉRFANA para siempre (el upsert solo pisa la misma
 * ruta). Con esto queda SIEMPRE una sola foto por producto, sin importar el formato.
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
    // Borrar las variantes de otra extensión (best-effort: si falla, no rompe la subida que ya salió
    // bien). Las rutas son exactas por producto, así que no toca fotos de otros productos.
    const huerfanas = EXTS_IMG.filter((e) => e !== ext).map((e) => `${carpeta}.${e}`)
    try { await supabase.storage.from(bucket).remove(huerfanas) } catch (_) {}
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
