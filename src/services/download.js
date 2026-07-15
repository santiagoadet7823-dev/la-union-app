import { isNative } from './platform'

/**
 * Descarga un archivo (blob) de forma robusta en WEB y en la APK (Android WebView).
 *
 * En web usamos el patrón clásico de <a download> (idéntico al de report/rutaPng.js).
 * En nativo ese patrón NO dispara la descarga dentro del WebView de Android, así que
 * escribimos el blob en el filesystem (Cache) y abrimos la hoja de compartir del SO
 * para que el usuario elija dónde guardarlo/enviarlo. Los plugins de Capacitor se
 * importan de forma dinámica para no romper el bundle web (donde no están disponibles).
 *
 * @param {{ filename:string, blob:Blob, mime?:string }} opts
 */
export async function descargarArchivo({ filename, blob, mime }) {
  if (!isNative()) {
    // --- WEB: anchor descarga directa ---
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = filename
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 4000)
    return
  }

  // --- NATIVO (Android WebView): escribir a Cache + compartir ---
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')

  // Blob → base64 (sin el prefijo "data:...;base64,").
  const base64 = await new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onerror = () => rej(reader.error || new Error('No se pudo leer el archivo'))
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      res(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })

  await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache })
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
  await Share.share({ title: filename, url: uri })
}
