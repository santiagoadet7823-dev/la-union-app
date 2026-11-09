// lib/whatsapp.ts — el asistente le habla a Meta con su número de consultas de siempre.
// Desde el 09/11/2026 (plan 41) el código vive en `_compartido/meta.ts`, que también usa `wa-entrada`;
// acá solo queda el número fijo, para no tocar el resto del asistente.
import { clienteMeta, numeroDeConsultas } from '../../_compartido/meta.ts'

// El token y el id se leen en cada llamada, como antes: así una prueba puede cambiar las variables.
const meta = () => clienteMeta(numeroDeConsultas())

export const avisarEscribiendo = (wamid: string) => meta().avisarEscribiendo(wamid)
export const enviarTexto = (a: string, texto: string) => meta().enviarTexto(a, texto)
export const bajarAudio = async (idMedia: string) => (await meta().bajarMedia(idMedia)).datos
export const enviarNotaDeVoz = (a: string, ogg: Uint8Array) => meta().enviarNotaDeVoz(a, ogg)
