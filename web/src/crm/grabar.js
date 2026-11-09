/**
 * Grabación de audio para WhatsApp (plan 41 paso 4).
 *
 * Meta acepta audio en ogg (solo opus), mp4/aac, mpeg y amr; **no acepta webm**, que es lo que
 * graba Chrome por defecto (`crm-enviar` lo rechaza con 415). Por eso se pide el formato en este
 * orden y se usa el primero que el navegador soporte:
 *   1. ogg/opus → Firefox. Es el único que WhatsApp muestra como "nota de voz".
 *   2. mp4/aac  → Chrome 126+, Edge y Safari. Llega como audio adjunto (se escucha igual).
 * Si el navegador no graba ninguno de los dos, el botón del micrófono no aparece.
 */
const CANDIDATOS = [
  'audio/ogg;codecs=opus',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
]

export function formatoGrabacion() {
  if (typeof window === 'undefined' || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return null
  return CANDIDATOS.find((t) => {
    try { return MediaRecorder.isTypeSupported(t) } catch (_) { return false }
  }) || null
}

/** Arranca a grabar. Devuelve `{ detener(): Promise<Blob>, cancelar() }`. */
export async function grabar() {
  const tipo = formatoGrabacion()
  if (!tipo) throw new Error('sin-formato')
  const flujo = await navigator.mediaDevices.getUserMedia({ audio: true })
  const rec = new MediaRecorder(flujo, { mimeType: tipo, audioBitsPerSecond: 32000 })
  const partes = []
  rec.ondataavailable = (e) => { if (e.data?.size) partes.push(e.data) }
  const soltar = () => flujo.getTracks().forEach((t) => t.stop())
  rec.start()
  return {
    tipo,
    detener: () => new Promise((ok) => {
      rec.onstop = () => { soltar(); ok(new Blob(partes, { type: tipo.split(';')[0] })) }
      rec.stop()
    }),
    cancelar: () => { rec.onstop = soltar; try { rec.stop() } catch (_) { soltar() } },
  }
}
