/**
 * Los clientes geolocalizados como marcadores de contexto para `LeafletMap` (`clients`).
 *
 * Era el mismo `.filter().map()` copiado en SupervisionDesktop, SupervisionMovil y PanelDireccion
 * (regla 31: las copias entre Desktop y Movil ya divergieron dos veces). Acá se resuelve una sola
 * vez y se le suma la zona: color y abreviatura para que el mapa pinte cada comercio según su zona.
 *
 * Devuelve sólo los que tienen lat/lng. `color`/`abrev`/`zona` quedan en null si el cliente no
 * tiene zona (o la zona no tiene ese dato): el mapa los dibuja con el gris neutro de siempre.
 */
export function marcadoresCartera(clientes, zonas) {
  const porId = new Map((zonas || []).map((z) => [z.id, z]))
  const out = []
  for (const c of clientes || []) {
    if (c.lat == null || c.lng == null) continue
    const z = c.idZona ? porId.get(c.idZona) : null
    out.push({
      lat: c.lat, lng: c.lng,
      nombre: c.name || c.nombre_comercio,
      color: z?.color || null,
      abrev: z?.abrev || null,
      zona: z?.nombre || null,
    })
  }
  return out
}
