import { supabase, hasSupabase } from './supabase'

/**
 * Recorridos del día "pegados a calles" (snap-to-road). Pide a la Edge Function
 * `snap-recorridos` la geometría ya corregida por OSRM y cacheada por empresa/día,
 * para no dibujar la polilínea cruda (que cruza manzanas).
 *
 * Devuelve { [id_usuario]: [ [{lat,lng}], ... ] } — un array de SEGMENTOS por
 * usuario (el trazo se corta en saltos grandes de GPS, para no dibujar rectas que
 * cruzan manzanas). Solo para los usuarios que se pudieron snappear; si la función
 * falla (red / OSRM caído), devuelve {} y la vista cae al rastro crudo.
 *
 * @param {{ fecha:string, desde:string, hasta:string }} rango
 * @returns {Promise<Record<string, {lat:number,lng:number}[][]>>}
 */
export async function fetchSnapRecorridos({ fecha, desde, hasta }) {
  if (!hasSupabase) return {}
  try {
    const { data, error } = await supabase.functions.invoke('snap-recorridos', {
      body: { fecha, desde, hasta },
    })
    if (error || !data?.recorridos) return {}
    const out = {}
    for (const r of data.recorridos) {
      if (!r.id_usuario || !Array.isArray(r.geometrias)) continue
      out[r.id_usuario] = r.geometrias
        .filter((seg) => Array.isArray(seg) && seg.length >= 2)
        .map((seg) => seg.map(([lat, lng]) => ({ lat, lng })))
    }
    return out
  } catch (_) {
    return {}
  }
}
