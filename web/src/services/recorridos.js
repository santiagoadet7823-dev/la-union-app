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
    const conectores = {}
    const aLatLng = (segs) => (segs || [])
      .filter((seg) => Array.isArray(seg) && seg.length >= 2)
      .map((seg) => seg.map(([lat, lng]) => ({ lat, lng })))
    for (const r of data.recorridos) {
      if (!r.id_usuario || !Array.isArray(r.geometrias)) continue
      out[r.id_usuario] = aLatLng(r.geometrias)
      // 🩸 LOS CONECTORES VIAJAN APARTE Y NO SE MEZCLAN CON LOS SEGMENTOS (17/08/2026). Son el hueco
      // largo entre dos segmentos, ruteado por calle en vez de dibujado como recta a campo traviesa.
      // Van separados porque `cubreElRecorrido` (trazos.js) compara el largo pegado contra el crudo
      // para descartar un snap que borró recorrido, y un conector agrega largo que NO tiene
      // contraparte cruda: mezclarlo inflaría ese lado de la comparación y apagaría la guarda.
      if (Array.isArray(r.conectores) && r.conectores.length) conectores[r.id_usuario] = aLatLng(r.conectores)
    }
    Object.defineProperty(out, '_conectores', { enumerable: false, value: conectores })
    // 🩸 El desglose viaja por una propiedad NO enumerable (03/08/2026). La función informa cuántos
    // tramos pegó por matcheo, cuántos por ruteo y por qué quedaron crudos los demás — sin eso, un
    // tope alcanzado se ve igual que "salió todo bien" y afinar un umbral es adivinar. Va acá y no
    // en una segunda propiedad del objeto porque TODOS los consumidores recorren este mapa con
    // `Object.entries` esperando id_usuario → segmentos, y una clave extra les entraría como una
    // persona más.
    Object.defineProperty(out, '_meta', {
      enumerable: false,
      // `km` (ALGO 9) es el par crudo/pegado en METROS por id_usuario, y es LA medida de si el snap
      // está reconstruyendo o inventando: el 03/08/2026 el trazo dibujado medía ×1,63 el crudo y en
      // el mapa se veía "más pegado a la calle". Un día 100 % crudo da ~×0,86 (se dibuja el rastro
      // adelgazado), así que lo que hay que mirar es que no se despegue HACIA ARRIBA de ~×1,2.
      value: {
        ruteos: data.ruteos, truncados: data.truncados, autos: data.autos, pies: data.pies,
        conectados: data.conectados, crudos: data.crudos, triangulados: data.triangulados, km: data.km,
      },
    })
    return out
  } catch (_) {
    return {}
  }
}
