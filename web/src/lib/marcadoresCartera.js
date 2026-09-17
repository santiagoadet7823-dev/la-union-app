import { estadoComercio, pintarComercio } from './estadoComercio'

/**
 * Los clientes geolocalizados como marcadores de contexto para `LeafletMap` (`clients`).
 *
 * Era el mismo `.filter().map()` copiado en SupervisionDesktop, SupervisionMovil y PanelDireccion
 * (regla 31: las copias entre Desktop y Movil ya divergieron dos veces). Acá se resuelve una sola
 * vez y se le suma la zona: color y abreviatura para que el mapa pinte cada comercio según su zona.
 *
 * ── DOS MODOS (17/09/2026) ────────────────────────────────────────────────────────────────────
 *
 * `modo: 'zona'` (el de siempre, y el default) — color y abreviatura de la zona. Contesta "de qué
 * zona es cada comercio", que es la pregunta del supervisor cuando reparte cartera.
 *
 * `modo: 'estado'` — el código de colores de `lib/estadoComercio.js`, el mismo que ve el vendedor
 * en su mapa. Contesta "cómo vino el día". Necesita `visitas` (`useVisitasDelDia`), porque para
 * el supervisor "visitado" es *visitado ese día por cualquiera del equipo*, no por él; `dia` es el
 * código `LU…DO` de la fecha que se mira (para "tocaba ese día"); `dormidos` el Set de
 * `useDormidosEmpresa` (opcional: sin él ese estado no existe); `pedidosBot` el Map de
 * `usePedidosBotDelDia` (ídem).
 *
 * Cada marcador lleva `id` (para saber a quién se tocó) y, en modo estado, `estado` y la `visita`
 * entera: la tarjeta y la leyenda cuentan sobre LO DIBUJADO y no vuelven a derivar nada por su
 * cuenta — dos derivaciones del mismo dato es cómo un contador termina diciendo algo distinto
 * de lo que se ve.
 *
 * Devuelve sólo los que tienen lat/lng. En modo zona, `color`/`abrev`/`zona` quedan en null si el
 * cliente no tiene zona (o la zona no tiene ese dato): el mapa los dibuja con el gris neutro de
 * siempre.
 */
export function marcadoresCartera(clientes, zonas, { modo = 'zona', visitas = null, dia = undefined, dormidos = null, pedidosBot = null, isDark = true } = {}) {
  const porId = new Map((zonas || []).map((z) => [z.id, z]))
  const out = []
  for (const c of clientes || []) {
    if (c.lat == null || c.lng == null) continue
    const z = c.idZona ? porId.get(c.idZona) : null
    const base = {
      id: c.id,
      lat: c.lat, lng: c.lng,
      nombre: c.name || c.nombre_comercio,
      zona: z?.nombre || null,
    }
    if (modo !== 'estado') {
      out.push({ ...base, color: z?.color || null, abrev: z?.abrev || null })
      continue
    }
    // `en_curso` no tiene color propio —el comercio sigue siendo una parada abierta del día— pero
    // TAMPOCO puede caer en la rama del día de la semana: hay alguien adentro AHORA, y pintarlo
    // "hoy no toca" (hueco y hundido) contradice un hecho que el mapa está mostrando al lado, con
    // la burbuja del vendedor encima. Se fuerza a "toca hoy", que es lo que es.
    const v = visitas?.get(c.id) || null
    const status = v && (v.estado === 'visitado' || v.estado === 'sin_pedido') ? v.estado : 'pendiente'
    const estado = v?.estado === 'en_curso'
      ? 'hoy'
      : estadoComercio({ id: c.id, status, dias: c.dias }, { dormidos, pedidosBot, hoy: dia })
    const { color, glifo, hueco } = pintarComercio(estado, { isDark })
    // Sin `abrev`: la abreviatura de la zona es del otro modo, y con las dos juntas el mapa
    // dibujaría el chip en vez del pin (LeafletMap elige por lo que recibe).
    out.push({ ...base, color, glifo, hueco, estado, visita: v, pedidoBot: pedidosBot?.get?.(c.id) || null })
  }
  return out
}
