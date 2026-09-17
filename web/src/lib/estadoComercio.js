import { tocaHoy } from './diasVisita'
import { WHATSAPP_PATH } from '../components/icons'

/**
 * EL CÓDIGO DE COLORES DE UN COMERCIO EN EL MAPA. Un solo lugar decide qué estado tiene y cómo se
 * pinta; el mapa del vendedor, el de la supervisión y (mañana) el del repartidor lo preguntan acá.
 *
 * Vive en `lib/` y no dentro de `MapaCartera` porque desde el día uno tiene DOS consumidores
 * (regla 31: lo que dos pantallas muestran igual va en un módulo compartido, no copiado — los
 * carteles de parada y los trazos ya se pagaron dos veces por no hacer esto).
 *
 * ── LAS DOS DECISIONES DE COLOR QUE HAY QUE CONOCER (17/09/2026) ──────────────────────────────
 *
 * 🩸 **EL ROJO NO ES "HOY NO TOCA": ES EL CLIENTE DORMIDO.** La primera versión del pedido asignaba
 * rojo a los comercios que hoy no hay que visitar. Se descartó por tres razones y conviene que
 * queden escritas, porque la idea vuelve sola:
 *   1. En esta app el rojo es error o urgencia (GPS apagado, pedido anulado, batería baja). "Hoy no
 *      toca" es la situación NORMAL de media cartera: serían ~400 pines rojos todos los días, y un
 *      rojo que está siempre deja de querer decir algo justo cuando hace falta.
 *   2. La jerarquía quedaba al revés: lo que NO hay que hacer gritaba y lo accionable era gris. Lo
 *      que no toca tiene que hundirse — por eso va hueco y más chico.
 *   3. Verde + naranja + rojo juntos es el trío que peor se distingue con daltonismo.
 *
 * 🩸 **EL COLOR NUNCA VA SOLO: cada estado lleva GLIFO.** Misma regla que `components/charts/
 * paleta.js` ("la identidad nunca es color solo"). Con deuteranopia —~8 % de los varones, y el
 * parque es de varones— verde y naranja son casi el mismo color; `✓` y `–` no.
 *
 * Verde y naranja NO son elecciones nuevas: son los de las pills de `InicioTab` y los de
 * `colorEstadoPedido`, así que el mapa y las listas dicen lo mismo con el mismo color.
 */

/**
 * Los hex salen de los tokens de `index.css` (`--primary`, `--success`, `--warning`, `--danger`,
 * `--faint`) y están escritos a mano por una razón concreta: los puntos de esta capa se dibujan en
 * CANVAS cuando el zoom es bajo (regla de `LeafletMap`), y un `<canvas>` no resuelve `var(--x)`.
 * ⚠️ Si se tocan esos tokens, se tocan también acá. Es el mismo trato que ya tenían los colores de
 * pin de `RutaTab` y de `SupervisionMovil`.
 */
export const ESTADOS = {
  hoy:        { etiqueta: 'Toca hoy',          glifo: '·', light: '#0ABAB5', dark: '#2DD4CE' },
  visitado:   { etiqueta: 'Con pedido',        glifo: '✓', light: '#10B981', dark: '#34D399' },
  // 🩸 EL BOT DE WHATSAPP (17/09/2026). Un comercio al que le vendió el bot lleva el logo de
  // WhatsApp como glifo y el VERDE DE WHATSAPP (#25D366), no el `--success` de la app — a
  // propósito: es la marca la que engancha, y el dueño de la empresa tiene que VER que el bot
  // está vendiendo. El glifo no es un carácter sino un SVG (`{ svg }`): `pinComercioIcon` y
  // `Muestra` aceptan las dos formas. El trazado sale de `components/icons` (una sola copia).
  pedido_bot: { etiqueta: 'Vendió el bot',     glifo: { svg: `<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="${WHATSAPP_PATH}"/></svg>` }, light: '#25D366', dark: '#25D366' },
  sin_pedido: { etiqueta: 'Sin pedido',        glifo: '–', light: '#F59E0B', dark: '#FBBF24' },
  dormido:    { etiqueta: 'No compra hace +30 d', glifo: '!', light: '#EF4444', dark: '#F87171' },
  no_toca:    { etiqueta: 'Hoy no toca',       glifo: '',  light: '#93A9A7', dark: '#5C7370', hueco: true },
}

/**
 * El orden en que se muestran en la leyenda: primero lo accionable, último lo que se hunde.
 * `pedido_bot` va aparte: la leyenda lo suma SÓLO si ese día hubo al menos un pedido del bot —
 * una leyenda que promete un bot que todavía no vende es peor que ninguna.
 */
export const ORDEN_LEYENDA = ['hoy', 'visitado', 'sin_pedido', 'dormido', 'no_toca']
export const ORDEN_LEYENDA_CON_BOT = ['hoy', 'visitado', 'pedido_bot', 'sin_pedido', 'dormido', 'no_toca']

/**
 * En qué estado está un comercio. El orden de las preguntas ES la regla de precedencia:
 *
 *   1. Lo que ya pasó HOY gana sobre todo lo demás. Un comercio visitado se pinta visitado aunque
 *      hoy no le tocara y aunque esté dormido — el vendedor pasó igual, y esconderlo sería borrar
 *      su trabajo del mapa. Una visita humana CON pedido gana sobre el bot; el bot gana sobre una
 *      visita SIN pedido (el comercio compró igual, y eso es lo que importa).
 *   2. Dormido gana sobre "toca hoy": es una alarma, y una alarma que sólo aparece el día que
 *      corresponde visitarlo no sirve de nada.
 *   3. Recién después, el día de la semana.
 *
 * `c` es un cliente de `useJornada.clients` (trae `status`, `dias`) o cualquier objeto con esa
 * forma. `dormidos` es el Set de `useDormidos`; `pedidosBot` el Map/Set de `usePedidosBotDelDia`;
 * si no vienen, esos estados no existen.
 */
export function estadoComercio(c, { dormidos = null, pedidosBot = null, hoy = undefined } = {}) {
  if (c.status === 'visitado') return 'visitado'
  if (pedidosBot && pedidosBot.has(c.id)) return 'pedido_bot'
  if (c.status === 'sin_pedido') return 'sin_pedido'
  if (dormidos && dormidos.has(c.id)) return 'dormido'
  return tocaHoy(c.dias, hoy) ? 'hoy' : 'no_toca'
}

/**
 * Estado → lo que `LeafletMap` necesita para dibujarlo: `{ color, glifo, hueco }`.
 * `glifoExtra` pisa el glifo del estado — lo usa el número de orden de la ruta óptima.
 */
export function pintarComercio(estado, { isDark = true, glifoExtra = null } = {}) {
  const e = ESTADOS[estado] || ESTADOS.hoy
  return {
    color: isDark ? e.dark : e.light,
    glifo: glifoExtra != null ? String(glifoExtra) : e.glifo,
    hueco: !!e.hueco,
  }
}
