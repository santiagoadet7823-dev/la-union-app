// _compartido/voz.ts — transcribir audios y generar notas de voz con el contenedor `voz` de esta PC
// (whisper.cpp + Piper, infra/selfhost/voz, sin puertos publicados). Lo usan el asistente y el CRM.
// Salió de `wa-asistente/index.ts` el 09/11/2026 (plan 41) sin cambios de lógica.
const VOZ_URL = () => Deno.env.get('VOZ_URL') || 'http://voz:8080'

/** El servicio rechaza audios demasiado largos (413): se le avisa a la persona en vez de fallar. */
export class AudioRechazado extends Error {}

export async function transcribir(audio: Uint8Array): Promise<string> {
  const r = await fetch(`${VOZ_URL()}/transcribir`, { method: 'POST', body: audio, signal: AbortSignal.timeout(150_000) })
  if (r.status === 413) throw new AudioRechazado('audio-largo')
  if (!r.ok) throw new Error(`voz-transcribir-${r.status}`)
  return ((await r.json()).texto ?? '').trim()
}

export async function hablar(texto: string): Promise<Uint8Array> {
  const r = await fetch(`${VOZ_URL()}/hablar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texto }),
    signal: AbortSignal.timeout(60_000),
  })
  if (!r.ok) throw new Error(`voz-hablar-${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}
