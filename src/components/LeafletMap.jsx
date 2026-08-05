import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { obtenerRutaMulti, obtenerRutaOptimaTSP } from '../services/routing'
import { CENTRO_DEFECTO } from '../services/maps'
import { usableBasemaps, getBasemap, setBasemap, basemapById, onBasemapChange } from '../services/maps/basemap'
import { crearAnimadorPines } from '../features/supervision/animarPin'

/**
 * Mapa real con Leaflet + tiles CARTO (OSM) y ruteo por calles vía OSRM.
 * NO requiere API key ni facturación. Misma API de props que el componente de
 * Google, para intercambiarse sin tocar las vistas.
 *
 * props: theme, center, zoom, markers[{lat,lng,label,color,labelColor,title,selected}],
 *        depot{lat,lng,title}, live{lat,lng}, route[{lat,lng}], routeColor,
 *        circle{lat,lng,radiusM,color}, dwells[{lat,lng,label,sub,color}], height,
 *        onMarkerClick(index)
 */

// El basemap ya NO depende del tema: lo elige el usuario y es global (services/maps/basemap.js).
// Acá solo se crea la capa Leaflet a partir del id elegido. Los pines/trazos SÍ siguen usando
// `theme` para su color.
function crearTileLayer(id) {
  const b = basemapById(id)
  return L.tileLayer(b.url, b.opts)
}

// Control custom para elegir el basemap. Vive dentro del mapa → aparece en todas las vistas.
// Botón "capas" que despliega la lista; al elegir, setBasemap() persiste y avisa a los demás mapas.
//
// Desde el 28/07/2026 este menú también lleva el CRÉDITO del proveedor de tiles al pie. El cartel
// de atribución que Leaflet dibuja solo (abajo a la derecha, sobre el mapa) está apagado —
// `attributionControl: false`— porque en un mapa a pantalla completa tapa contenido y no se puede
// mover. Pero la atribución NO se elimina: la política de uso de los tiles de OSM la exige. Vive
// acá, a un toque de distancia, que es lo que hacen las apps de mapas full-screen.
function crearControlBasemap(getId, position) {
  const ctrl = L.control({ position: position || 'topright' })
  ctrl.onAdd = () => {
    const wrap = L.DomUtil.create('div', 'leaflet-bar lu-basemap-ctrl')
    wrap.style.cssText = 'background:var(--surface,#fff);border-radius:8px;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.3)'
    const btn = L.DomUtil.create('a', '', wrap)
    btn.href = '#'; btn.title = 'Cambiar mapa'
    btn.style.cssText = 'display:grid;place-items:center;width:34px;height:34px;color:var(--text,#222)'
    btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 8.5 12 15 2 8.5 12 2"/><polyline points="2 15.5 12 22 22 15.5"/></svg>'
    const menu = L.DomUtil.create('div', '', wrap)
    menu.style.cssText = 'display:none;border-top:1px solid var(--line,#e5e5e5)'
    const opciones = usableBasemaps()
    opciones.forEach((b) => {
      const item = L.DomUtil.create('a', '', menu)
      item.href = '#'; item.textContent = b.label
      item.dataset.id = b.id
      item.style.cssText = 'display:block;padding:7px 12px;font:600 12px/1 var(--font-body,sans-serif);color:var(--text,#222);white-space:nowrap;text-decoration:none;border:none;width:auto;height:auto'
      L.DomEvent.on(item, 'click', (e) => {
        L.DomEvent.stop(e)
        setBasemap(b.id)
        menu.style.display = 'none'
        pintarActivo()
      })
    })
    // Crédito del proveedor, al pie del menú. Se actualiza al cambiar de capa porque cada una
    // tiene el suyo (OSM / Stadia + OpenMapTiles / satélite).
    const credito = L.DomUtil.create('div', '', menu)
    credito.style.cssText = 'padding:6px 12px 7px;border-top:1px solid var(--line,#e5e5e5);font:400 9px/1.4 var(--font-mono,monospace);color:var(--faint,#93a9a7);max-width:190px'

    const pintarActivo = () => {
      const cur = getId()
      // `a[data-id]` y no `a` a secas: el crédito del pie puede traer enlaces del proveedor.
      menu.querySelectorAll('a[data-id]').forEach((a) => {
        const on = a.dataset.id === cur
        a.style.background = on ? 'var(--primary-tint,#e6f7f6)' : 'transparent'
        a.style.color = on ? 'var(--deep,#0ABAB5)' : 'var(--text,#222)'
      })
      // innerHTML y no textContent: los `attribution` traen entidades (&copy;) y enlaces.
      credito.innerHTML = basemapById(cur).opts?.attribution || ''
    }
    L.DomEvent.on(btn, 'click', (e) => {
      L.DomEvent.stop(e)
      const abierto = menu.style.display === 'block'
      menu.style.display = abierto ? 'none' : 'block'
      if (!abierto) pintarActivo()
    })
    // No dejar que los clicks/scroll del control muevan el mapa.
    L.DomEvent.disableClickPropagation(wrap)
    L.DomEvent.disableScrollPropagation(wrap)
    pintarActivo()
    return wrap
  }
  return ctrl
}

function pinIcon(color, label, labelColor, selected) {
  const size = selected ? 26 : 22
  const ring = selected ? '#2DD4CE' : '#ffffff'
  return L.divIcon({
    className: 'lu-pin',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50% 50% 50% 3px;background:${color};border:2px solid ${ring};box-shadow:0 1px 5px rgba(0,0,0,.35);display:grid;place-items:center;font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;color:${labelColor || '#fff'}">${label || ''}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

/**
 * Cartel de PARADA ("permaneció 5 min acá"): píldora con texto libre. Es una VARIANTE de
 * pinIcon, no un reemplazo: pinIcon es un círculo fijo de 22/26px con font-size 10 donde
 * un "5 min" no entra, y además lo usa SupervisionDesktop tal cual está.
 *
 * Se dibuja con iconSize [0,0] + hijo centrado por transform: la píldora mide lo que mida
 * el texto (no hay que adivinar el ancho) y queda centrada sobre la coordenada.
 *
 * 🩸 `k` es el factor de escala, 1 o 1.5 (30/07/2026). A 10 px, leer un cartel de parada a un
 * brazo de distancia con sol de frente no se puede — el mismo pedido que ya había agrandado la
 * tarjeta del pin, que resultó ser otra cosa. TODAS las medidas se derivan de `k`, así que no hay
 * dos versiones del cartel que se puedan desincronizar, y con k = 1 el HTML es idéntico al de
 * antes (10 · 1 = 10; los decimales que aparecen en 1.5 no molestan a nadie).
 *
 * `extra` es el tercer renglón, que SOLO existe ampliado: hoy `sub` tiene que elegir entre el
 * horario y el nombre del comercio (dwells.js) y descarta el otro. Ampliar sirve para mostrar más,
 * no para mostrar lo mismo más grande — mismo criterio que la tarjeta del pin.
 */
function dwellIcon({ label, sub, extra, color, k = 1 }) {
  const c = color || '#2DD4CE'
  const px = (n) => n * k
  // `sub` va en un segundo renglón, más chico y translúcido. En una sola línea la píldora se iba a
  // ~180 px: como el ancho lo fija el texto (nowrap + iconSize [0,0]), apilar es lo que la mantiene
  // angosta. El radio baja de 99 a 9 cuando hay más de una línea — una píldora de dos renglones con
  // borde 99 parece un huevo.
  const renglones = [
    sub && `<div style="font-size:${px(8.5)}px;font-weight:500;opacity:.82;letter-spacing:.02em">${sub}</div>`,
    extra && `<div style="font-size:${px(8.5)}px;font-weight:500;opacity:.7;letter-spacing:.02em">${extra}</div>`,
  ].filter(Boolean).join('')
  const apilado = !!renglones
  return L.divIcon({
    className: 'lu-dwell',
    // `pointer-events:auto` (antes `none`): el cartel es el objetivo del toque. Le gana el click a
    // la polilínea que tenga debajo —que no es clickeable— y NO a los pines en vivo, que viven en
    // markerPane (z 600) por encima de este pane (450).
    html: `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;pointer-events:auto;cursor:pointer;text-align:center;background:${c};color:#fff;border:${px(1.5)}px solid rgba(255,255,255,.9);border-radius:${apilado ? px(9) : 99}px;padding:${apilado ? `${px(3)}px ${px(7)}px` : `${px(2)}px ${px(7)}px`};box-shadow:0 1px 5px rgba(0,0,0,.35);font-family:'IBM Plex Mono',monospace;font-size:${px(10)}px;font-weight:600;line-height:1.35">${label || ''}${renglones}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

// Escapa texto para meterlo en el html del divIcon (el nombre es dato de usuario).
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

// Frescura de la última posición según su antigüedad. El vendedor con la app cerrada
// deja de emitir: en vez de desaparecer del mapa, su burbuja queda con el punto en gris
// ("hace rato / app cerrada"), así se ve de un vistazo quién está desactualizado sin
// abrir cada cartel. Umbrales: <2 min fresco, <15 min reciente, resto viejo.
function frescura(ts) {
  const edad = Date.now() - (ts || 0)
  if (!ts) return { color: '#94a3b8', dim: true }
  if (edad < 2 * 60000) return { color: '#22c55e', dim: false }
  if (edad < 15 * 60000) return { color: '#f59e0b', dim: false }
  return { color: '#94a3b8', dim: true }
}

/**
 * Burbuja de perfil estilo Life360 para los móviles en vivo: avatar circular (FOTO si el
 * perfil tiene `foto`, si no las INICIALES sobre el color de la persona), borde blanco,
 * sombra y una PUNTA inferior que ancla la burbuja al punto exacto. Un punto de frescura
 * (esquina) indica qué tan vieja es la última posición. El nombre va en una píldora arriba.
 *
 * opts: { foto, iniciales, color, nombre, ts, selected }
 */
function bubbleIcon(opts) {
  const { foto, iniciales, color, nombre, ts, selected } = opts
  const D = selected ? 48 : 42            // diámetro del avatar
  const fr = frescura(ts)
  const contenido = foto
    ? `<img src="${esc(foto)}" style="width:100%;height:100%;object-fit:cover;display:block" />`
    : `<div style="width:100%;height:100%;display:grid;place-items:center;background:${color || '#0EA5E9'};color:#fff;font-family:'IBM Plex Mono',monospace;font-size:${selected ? 15 : 13}px;font-weight:700">${esc(iniciales || '')}</div>`
  const label = nombre
    ? `<div style="margin-bottom:3px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:rgba(11,43,42,.82);color:#fff;font-family:Inter,sans-serif;font-size:9.5px;font-weight:600;padding:1px 7px;border-radius:99px">${esc(nombre)}</div>`
    : ''
  // Alto de referencia para el ancla: avatar + punta (la píldora del nombre queda por
  // encima y no debe correr el ancla). iconAnchor = tip de la punta sobre la coordenada.
  const punta = 8
  const html = `
    <div style="display:flex;flex-direction:column;align-items:center;pointer-events:auto;opacity:${fr.dim ? 0.72 : 1}">
      ${label}
      <div style="position:relative;width:${D}px;height:${D}px">
        <div style="width:100%;height:100%;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);overflow:hidden;box-sizing:border-box">
          ${contenido}
        </div>
        <div style="position:absolute;bottom:0;right:0;width:12px;height:12px;border-radius:50%;background:${fr.color};border:2px solid #fff;box-sizing:border-box"></div>
      </div>
      <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:${punta}px solid #fff;margin-top:-2px;filter:drop-shadow(0 2px 1px rgba(0,0,0,.3))"></div>
    </div>`
  const W = 130
  const H = (nombre ? 17 : 0) + D + punta
  return L.divIcon({
    className: 'lu-bubble',
    html,
    iconSize: [W, H],
    iconAnchor: [W / 2, H],
  })
}

/* ============================================================================================
   FIRMAS DE REDIBUJO — 🩸 NINGUNA de estas funciones puede recorrer las coordenadas de un
   recorrido (28/07/2026).

   Antes había UNA sola clave para todo el mapa:
       JSON.stringify({ markers, depot, live, route, circle, movers, trail, trails, dwells })
   Eso serializaba los recorridos completos —miles de puntos por persona— y corría en CADA
   render, y el padre re-renderiza con cada posición que llega por Realtime. Era el costo más
   alto del componente y se pagaba entero aunque no hubiera cambiado nada.

   Estas firmas son O(cantidad de trazos), no O(cantidad de puntos): de cada lista de puntos
   miran el largo y los dos extremos. Con eso alcanza — un recorrido crece agregando puntos al
   final (cambia el largo y el último punto) y al pegarlo a las calles se reemplaza entero
   (cambian los extremos). Si alguna vez apareciera una transformación que conserve largo Y
   extremos y mueva solo el medio, hay que sumarle un contador de versión, NO volver al
   stringify.

   MEDIDO sobre un día real de la empresa (5 personas, 5.203 puntos, 7 móviles, 85 carteles),
   en una PC: la clave vieja costaba 2,08 ms por render y las firmas cuestan 0,045 ms — 46 veces
   menos. En un Android de gama baja hay que multiplicar las dos cifras por 5-10.
   ============================================================================================ */
const firmaPunto = (p) => (p ? p.lat + ',' + p.lng : '')

function firmaPuntos(pts) {
  if (!pts || !pts.length) return '0'
  return pts.length + '@' + firmaPunto(pts[0]) + '>' + firmaPunto(pts[pts.length - 1])
}

function firmaTrails(trails) {
  if (!trails || !trails.length) return ''
  let s = ''
  for (const t of trails) s += (t.id || '') + ':' + (t.color || '') + ':' + (t.opacity ?? '') + ':' + (t.weight ?? '') + ':' + (t.dashArray || '') + ':' + firmaPuntos(t.points) + '|'
  return s
}

function firmaMarkers(ms) {
  if (!ms || !ms.length) return ''
  let s = ''
  for (const m of ms) {
    s += firmaPunto(m) + ':' + (m.label || '') + ':' + (m.color || '') + ':' + (m.labelColor || '') +
         ':' + (m.title || '') + ':' + (m.selected ? 1 : 0) + ':' + (m.bubble ? 1 : 0) +
         // `id`: sin él, dos personas que intercambian posición en la lista dan la misma firma y el
         // mapa no redibuja — con marcadores persistentes eso dejaría la burbuja en la persona
         // equivocada, no solo un pin desactualizado.
         ':' + (m.id || '') + ':' + (m.foto || '') + ':' + (m.ts || '') + '|'
  }
  return s
}

function firmaMovers(ms) {
  if (!ms || !ms.length) return ''
  let s = ''
  for (const m of ms) {
    s += firmaPunto(m) + ':' + (m.rol || '') + ':' + (m.color || '') + ':' + (m.iniciales || '') +
         ':' + (m.id || '') + ':' + (m.nombre || '') + ':' + (m.foto || '') + ':' + (m.ts || '') + ':' + (m.selected ? 1 : 0) + '|'
  }
  return s
}

function firmaDwells(ds) {
  if (!ds || !ds.length) return ''
  let s = ''
  for (const d of ds) s += firmaPunto(d) + ':' + (d.label || '') + ':' + (d.sub || '') + ':' + (d.extra || '') + ':' + (d.color || '') + '|'
  return s
}

function firmaInicios(is) {
  if (!is || !is.length) return ''
  let s = ''
  for (const i of is) s += firmaPunto(i) + ':' + (i.hora || '') + ':' + (i.color || '') + '|'
  return s
}

function depotIcon(theme) {
  const bg = theme === 'dark' ? '#ECF5F4' : '#0B2B2A'
  const fg = theme === 'dark' ? '#0B2B2A' : '#ECF5F4'
  return L.divIcon({
    className: 'lu-depot',
    html: `<div style="width:26px;height:26px;border-radius:8px;background:${bg};display:grid;place-items:center;box-shadow:0 1px 5px rgba(0,0,0,.35)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${fg}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21V9l9-6 9 6v12"/><path d="M9 21v-8h6v8"/></svg></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

/**
 * Marcador de INICIO de jornada: "▶ 08:47" en el primer punto del día de la persona.
 *
 * 🩸 05/08/2026 — es la contracara visual del arranque tardío del rastreo (ver `construirInicios`
 * en features/supervision/trazos.js). El dato ya estaba en el mapa —el trazo empieza donde empieza—
 * pero sin hora y sin nada que lo distinga del resto de la línea.
 *
 * Es una VARIANTE de `dwellIcon`, no un uso de él: comparte la técnica (iconSize [0,0] + hijo
 * centrado por transform, así el ancho lo fija el texto y no hay que adivinarlo) pero no la
 * semántica. Un cartel de parada se toca para ampliarse; este es una ETIQUETA — `interactive:false`
 * en el marcador — y no debe robarle el toque a nada.
 *
 * El triángulo va en un círculo blanco sobre el color de la persona: a diferencia del cartel de
 * parada, este marcador tiene que leerse como "acá empieza" incluso cuando el trazo del mismo color
 * le pasa por debajo.
 */
function inicioIcon({ hora, color }) {
  const c = color || '#2DD4CE'
  return L.divIcon({
    className: 'lu-inicio',
    html: `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;gap:4px;white-space:nowrap;pointer-events:none;background:${c};color:#fff;border:1.5px solid rgba(255,255,255,.9);border-radius:99px;padding:2px 7px 2px 3px;box-shadow:0 1px 5px rgba(0,0,0,.35);font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;line-height:1.35"><span style="display:grid;place-items:center;width:13px;height:13px;border-radius:50%;background:#fff;color:${c};font-size:7px;line-height:1;padding-left:1px">▶</span>${esc(hora || '')}</div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

export default function LeafletMap({
  theme = 'dark',
  center = CENTRO_DEFECTO,
  zoom = 14,
  markers = [],
  depot = null,
  live = null,
  route = null,
  routeColor = '#2DD4CE',
  optimize = false,
  roundtrip = true,
  onRouteInfo,
  circle = null,
  // Carteles de permanencia ("5 min"): [{lat,lng,label,color}]. Opcional; con [] o undefined
  // el mapa se comporta exactamente igual que antes (SupervisionDesktop no la pasa).
  dwells = [],
  // Índice del cartel de parada AMPLIADO (o null). Va como prop suelta y NO adentro de cada
  // `dwells[i]` a propósito: `dwells` sale de `calcularDwells`, que cuesta ~410 ms por persona-día,
  // y meter la selección adentro obligaría a recalcular el detector de paradas entero cada vez que
  // se toca un cartel. Así la selección solo re-dibuja la capa.
  dwellSel = null,
  onDwellClick,
  // Marcadores de ARRANQUE de jornada: [{lat,lng,hora,color}] — el primer punto del día de cada
  // persona (features/supervision/trazos.js → construirInicios). Opcional: con [] o undefined el
  // mapa se comporta exactamente igual que antes.
  inicios = [],
  height = 460,
  followLive = false,
  fit = true, // si es false, no reencuadra (preserva el zoom/pan del usuario)
  // Padding del encuadre (fitBounds/setView). Permite reservar el espacio que tapan
  // el header y la bottom-nav cuando el mapa va a pantalla completa. Default 40 en las
  // cuatro (simétrico) para NO alterar el comportamiento previo de MapaOperativo.
  edgePadding = { top: 40, right: 40, bottom: 40, left: 40 },
  movers = [],
  // Clientes geolocalizados de la cartera: [{lat,lng,nombre}]. Capa de CONTEXTO opcional (se
  // prende/apaga con un toggle en Supervisión). NO entran al fitBounds (el encuadre lo mandan
  // los recorridos/móviles, no los 2.000 comercios) y viven en su propio layerGroup con efecto
  // propio, para no re-dibujarlos en cada tick de "hace Xs".
  clients = [],
  trail = null,
  trailColor = '#2DD4CE',
  trails = null, // varios recorridos a la vez: [{ points:[{lat,lng}], color }]
  // Enfoque imperativo puntual: al clickear una persona en la lista, encuadrar SU recorrido.
  // { points:[{lat,lng}], nonce }. El nonce (timestamp por click) permite re-enfocar al
  // mismo usuario dos veces. Es independiente del encuadre automático (fit/fitDone): no lo
  // pisa ni lo desactiva. Ver el efecto de más abajo.
  focus = null,
  // SEGUIMIENTO de la persona monitoreada: { lat, lng, ts } o null. Mientras esté, la cámara se
  // reengancha con CADA posición nueva — la sensación de "en vivo" tipo Google Maps.
  //
  // No se puede usar `followLive` para esto: aquel sigue a `live`, que es la posición PROPIA del
  // que mira (Admin observando su propio teléfono), no la de un monitoreado.
  //
  // 🔑 `dragstart` es el ÚNICO evento que sirve para desengancharlo, y por eso está solo ese:
  // `flyTo`/`panTo` disparan `movestart` y `zoomstart` por su cuenta, así que escuchar cualquiera
  // de esos dos haría que el seguimiento se apagara solo en el primer vuelo. Arrastrar, en cambio,
  // siempre lo hace un dedo.
  // `{ id, lat, lng, ts, nonce }`. El `id` no es decorativo: con él, la cámara la lleva la animación
  // del pin frame a frame en vez de panear por su cuenta (si no, cámara y pin llegan en momentos
  // distintos y se ve un tironeo). Sin `id` sigue funcionando el paneo de siempre.
  // El `nonce` se sella cada vez que el usuario APRIETA el botón de seguir, y es lo que distingue
  // "me pidieron enganchar" de "llegó otra posición del mismo". Sin él, volver a apretar el botón
  // no hace nada cuando la persona está quieta — ver el 🩸 del efecto de seguimiento.
  seguir = null,
  onSeguirCancelado,
  liveColor = null,
  onMarkerClick,
  onMapClick,
  basemapControl = true, // muestra el selector de capas (se puede apagar en algún mapa puntual)
  basemapPosition = 'topright', // esquina del selector de capas (para no chocar con otros controles)
  // Mapa de SOLO LECTURA: sin arrastre, sin zoom, sin controles. Lo usa el dashboard del dueño
  // (28/07/2026), donde el mapa del inicio es "una imagen que se lee" y el único target táctil es
  // la tarjeta entera, que lo abre a pantalla completa. Sin esto, un dedo que quiere scrollear la
  // página arrastra el mapa y la pantalla se traba.
  interactive = true,
  // Radio de las esquinas. 16 (= --r-lg) es el de siempre, para no cambiar ninguna vista existente;
  // el modo inmersivo lo pone en 0, porque un mapa a pantalla completa con esquinas redondeadas
  // deja cuatro muescas del fondo contra el borde del teléfono.
  radius = 16,
}) {
  const routeInfoRef = useRef(onRouteInfo)
  routeInfoRef.current = onRouteInfo
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const tileRef = useRef(null)
  const basemapRef = useRef(getBasemap()) // id del basemap activo (para el control y el redibujo)
  // 🩸 UNA CAPA POR FRECUENCIA DE ACTUALIZACIÓN (28/07/2026) — no volver a juntarlas.
  //
  // Hasta hoy TODO vivía en un solo layerGroup que se vaciaba con clearLayers() cada vez que
  // cambiaba cualquier cosa. Como los móviles en vivo publican posición cada 5-15 segundos, la
  // llegada de UN punto borraba y volvía a dibujar los recorridos enteros del día y todos los
  // carteles de permanencia. El mapa se estaba reconstruyendo solo, permanentemente; a pantalla
  // completa —más viewport, más elementos visibles— se notaba como que "la app se pone lenta".
  //
  // Ahora cada capa se redibuja únicamente cuando cambia LO SUYO:
  //   estáticos → depósito, punto en vivo, ruta, círculo, rastro suelto (casi nunca)
  //   trazos    → recorridos del día (al recargar o cambiar filtro/fecha)
  //   carteles  → paradas (derivadas de los trazos, ya diferidas)
  //   móviles   → burbujas en vivo (ALTA frecuencia: es la única que se redibuja seguido)
  //   clientes  → cartera geolocalizada (ya estaba separada, y es el patrón que se copió)
  //
  // El orden de addTo() define el apilado dentro del mismo pane: primero lo de más abajo.
  const staticLayerRef = useRef(null)
  const trailsLayerRef = useRef(null)
  const dwellsLayerRef = useRef(null)
  const iniciosLayerRef = useRef(null)
  const moversLayerRef = useRef(null)
  const clientsLayerRef = useRef(null)
  const clickRef = useRef(onMarkerClick)
  clickRef.current = onMarkerClick
  const dwellClickRef = useRef(onDwellClick)
  dwellClickRef.current = onDwellClick
  const mapClickRef = useRef(onMapClick)
  mapClickRef.current = onMapClick
  const seguirFinRef = useRef(onSeguirCancelado)
  seguirFinRef.current = onSeguirCancelado
  // Pines en vivo que PERSISTEN entre refrescos: id → { marker, firma, indice, lat, lng, ts }.
  // Es la condición para poder animarlos; ver el efecto de pines y features/supervision/animarPin.js.
  // `lat`/`lng` son el ÚLTIMO DESTINO MANDADO al animador, no dónde está dibujado el marcador: esa
  // distinción es todo el arreglo del 03/08/2026, ver el 🩸 del efecto.
  const pinesLayerRef = useRef(null)
  const pinesRef = useRef(new Map())
  const animadorRef = useRef(null)
  if (!animadorRef.current) animadorRef.current = crearAnimadorPines()
  // A quién está siguiendo la cámara, por ref: el efecto de pines lo lee dentro del callback de
  // animación y no puede depender de él (re-suscribiría en cada posición).
  const seguirIdRef = useRef(null)
  seguirIdRef.current = seguir?.id || null

  // Init único.
  useEffect(() => {
    if (!divRef.current || mapRef.current) return
    const map = L.map(divRef.current, {
      center: [center.lat, center.lng],
      zoom,
      // Sin el cartel "Leaflet | © OpenStreetMap" flotando abajo a la derecha. En un mapa a
      // pantalla completa tapa contenido y Leaflet no deja moverlo de esquina sin pelearse con
      // los demás controles. El crédito NO se pierde: va al pie del menú de capas
      // (crearControlBasemap), que es de donde sale la capa que se está mirando.
      attributionControl: false,
      zoomControl: interactive,
      dragging: interactive,
      scrollWheelZoom: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
      boxZoom: interactive,
      keyboard: interactive,
      tap: interactive,
    })
    mapRef.current = map
    // El contenedor deja pasar el scroll vertical de la página cuando el mapa no se opera.
    if (!interactive) divRef.current.style.touchAction = 'pan-y'
    // Pane propio para los carteles de permanencia, con z-index EXPLÍCITO entre el de los
    // trazos (overlayPane, 400) y el de los pines en vivo (markerPane, 600).
    //
    // Antes los carteles iban en 'overlayPane' junto con las polilíneas: dentro de un mismo
    // pane conviven el <svg> de los trazos y los <div> de los marcadores, y quién tapa a
    // quién depende de internals de Leaflet — el trazo terminaba encima y el cartel no se
    // leía. Un pane propio hace el apilado determinista en vez de accidental.
    map.createPane('luDwells')
    map.getPane('luDwells').style.zIndex = 450
    // El pane NO lleva `pointerEvents:'none'` desde el 30/07/2026: los carteles se tocan para
    // ampliarlos. No genera un bloqueador de pantalla — un pane de Leaflet es un contenedor de 0×0
    // y lo único que ocupa lugar son los divs de cada cartel.
    tileRef.current = crearTileLayer(basemapRef.current).addTo(map)
    // Selector de capas (arriba a la derecha, no choca con el zoom que va arriba a la izquierda).
    // Solo si hay 2+ capas usables (en producción sin key Stadia queda solo OSM → sin selector).
    if (basemapControl && usableBasemaps().length >= 2) crearControlBasemap(() => basemapRef.current, basemapPosition).addTo(map)
    // Capa de clientes DEBAJO de todo (se agrega primero) → los recorridos y pines en vivo
    // quedan por encima de los puntitos de comercios.
    clientsLayerRef.current = L.layerGroup().addTo(map)
    staticLayerRef.current = L.layerGroup().addTo(map)
    trailsLayerRef.current = L.layerGroup().addTo(map)
    moversLayerRef.current = L.layerGroup().addTo(map)
    // Capa de PINES EN VIVO, separada de la de móviles porque sus marcadores NO se recrean: son
    // los únicos que sobreviven entre refrescos para poder animarse (ver el efecto más abajo).
    pinesLayerRef.current = L.layerGroup().addTo(map)
    // Los carteles de permanencia van a su propio pane ('luDwells', z 450), así que su lugar en
    // este orden no cambia nada: el grupo existe solo para poder vaciarlos por separado.
    dwellsLayerRef.current = L.layerGroup().addTo(map)
    // Los marcadores de arranque comparten el pane 'luDwells' (z 450) con los carteles de parada:
    // el mismo lugar en el apilado es el correcto para los dos (sobre los trazos, bajo los pines en
    // vivo) y no hace falta un pane nuevo. El layerGroup propio sí, para vaciarlos por separado —
    // los inicios cambian con la fecha y los carteles con el toggle de paradas.
    iniciosLayerRef.current = L.layerGroup().addTo(map)
    map.on('click', (e) => mapClickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    // Arrastrar el mapa desengancha el seguimiento. Va acá (una sola vez, en el init) y no en el
    // efecto de `seguir`: el handler es estable porque lee el callback de un ref, y re-suscribirlo
    // en cada posición nueva sería registrar y quitar un listener cada 5 segundos.
    map.on('dragstart', () => seguirFinRef.current?.())
    setTimeout(() => map.invalidateSize(), 60)
    // Reajustar el mapa al rotar / cambiar tamaño (alturas en vh).
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)

    // 🩸 28/07/2026 — El `resize` de window NO alcanza: Leaflet cachea el tamaño del contenedor y
    // solo lo recalcula cuando se le avisa. Si el DIV cambia de alto sin que cambie la ventana
    // —modo inmersivo, un panel que se colapsa, un sheet que se abre— el mapa sigue dibujando con
    // el tamaño viejo: aparecen franjas de tiles GRISES y los clicks caen desplazados respecto de
    // lo que se ve. Con `position:fixed` y alturas en vh eso pasa sin un solo evento de window.
    //
    // El rAF no es decorativo: `invalidateSize` fuerza layout, y llamarlo sincrónicamente dentro
    // del callback del observer puede volver a disparar el observer ("ResizeObserver loop
    // completed with undelivered notifications").
    let pendiente = 0
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => {
          if (pendiente) return
          pendiente = requestAnimationFrame(() => { pendiente = 0; map.invalidateSize() })
        })
      : null
    if (ro && divRef.current) ro.observe(divRef.current)

    return () => {
      window.removeEventListener('resize', onResize)
      if (pendiente) cancelAnimationFrame(pendiente)
      if (ro) ro.disconnect()
      // Cortar los rAF de los pines ANTES de destruir el mapa: si no, el siguiente frame llamaría
      // setLatLng sobre marcadores de un mapa que ya no existe.
      animadorRef.current?.cancelarTodo()
      pinesRef.current.clear()
      map.remove()
      mapRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cambio de basemap (elegido por el usuario en CUALQUIER mapa/vista): se recrea la capa de
  // tiles en este mapa también. El id es global (localStorage) y llega por CustomEvent.
  useEffect(() => {
    return onBasemapChange((id) => {
      basemapRef.current = id
      const map = mapRef.current
      if (!map) return
      if (tileRef.current) tileRef.current.remove()
      tileRef.current = crearTileLayer(id).addTo(map)
    })
  }, [])

  // Recentrar en la base declarada (center) mientras no haya overlays que encuadrar.
  // El mapa se inicializa una sola vez, pero center (la base de la empresa) llega async;
  // sin esto se queda en el centro inicial y nunca "abre en la base". Cuando llegan
  // markers/movers/trails/etc. el fitBounds toma el control, y con fit=false nada mueve
  // la cámara. Depende solo de lat/lng/fit/hasOverlays → no salta en refrescos periódicos.
  const hasOverlays = !!(markers.length || (trails && trails.length) || movers.length || depot || circle || (route && route.length) || (trail && trail.length))
  useEffect(() => {
    const map = mapRef.current
    if (!map || !center || !fit || hasOverlays) return
    map.setView([center.lat, center.lng], map.getZoom() || zoom, { animate: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center && center.lat, center && center.lng, fit, hasOverlays])

  // ---- Firmas de cada capa (ver el bloque de refs para el porqué del corte) ----------------
  // Las vistas arman estos arrays nuevos en cada render, así que comparar por referencia no
  // sirve. Se comparan por firma, y la firma NUNCA recorre las coordenadas de un recorrido.
  const kStatic = useMemo(
    () => [firmaPunto(depot), firmaPunto(live), firmaPunto(circle), circle?.radiusM ?? '', circle?.color ?? '', firmaPuntos(trail), trailColor, firmaPuntos(route), routeColor, optimize ? 1 : 0, roundtrip ? 1 : 0].join('~'),
    [depot, live, circle, trail, trailColor, route, routeColor, optimize, roundtrip]
  )
  const kTrails = useMemo(() => firmaTrails(trails), [trails])
  const kMarkers = useMemo(() => firmaMarkers(markers), [markers])
  const kMovers = useMemo(() => firmaMovers(movers), [movers])
  const kDwells = useMemo(() => firmaDwells(dwells), [dwells])
  const kInicios = useMemo(() => firmaInicios(inicios), [inicios])

  // ---- Capa ESTÁTICA: depósito, punto en vivo, círculo, rastro suelto y ruta por calles ----
  useEffect(() => {
    const map = mapRef.current
    const layer = staticLayerRef.current
    if (!map || !layer) return
    let cancelado = false
    layer.clearLayers()

    if (depot) L.marker([depot.lat, depot.lng], { icon: depotIcon(theme), title: depot.title || 'Depósito' }).addTo(layer)

    if (live) {
      // Posición GPS en vivo. No se incluye en el fitBounds para no descuadrar el
      // encuadre del recorrido si el dispositivo está lejos del área de trabajo.
      const lc = liveColor || (theme === 'dark' ? '#38BDF8' : '#0EA5E9')
      L.circleMarker([live.lat, live.lng], { radius: 7, color: '#fff', weight: 3, fillColor: lc, fillOpacity: 1 }).addTo(layer)
    }

    if (circle) {
      L.circle([circle.lat, circle.lng], { radius: circle.radiusM, color: circle.color, weight: 1.5, fillColor: circle.color, fillOpacity: 0.12 }).addTo(layer)
    }

    // Rastro crudo (recorrido GPS grabado): polilínea literal, sin ruteo por calles.
    if (trail && trail.length >= 2) {
      L.polyline(trail.map((p) => [p.lat, p.lng]), { color: trailColor, weight: 4, opacity: 0.85, lineJoin: 'round' }).addTo(layer)
    }

    // Ruteo por calles (OSRM). optimize=true → orden óptimo (TSP). Si falla la red,
    // cae a línea punteada directa para no dejar el mapa sin recorrido.
    if (route && route.length >= 2) {
      const pedido = optimize ? obtenerRutaOptimaTSP(route, { roundtrip }) : obtenerRutaMulti(route)
      pedido
        .then((r) => {
          if (cancelado || !staticLayerRef.current) return
          if (r.coords?.length) L.polyline(r.coords, { color: routeColor, weight: 5, opacity: 0.9 }).addTo(staticLayerRef.current)
          routeInfoRef.current?.({ distancia: r.distancia, duracion: r.duracion, orden: r.orden })
        })
        .catch(() => {
          if (cancelado || !staticLayerRef.current) return
          // Sin red / OSRM caído: línea directa punteada y aviso a la vista.
          L.polyline(route.map((p) => [p.lat, p.lng]), { color: routeColor, weight: 3, opacity: 0.5, dashArray: '6 6' }).addTo(staticLayerRef.current)
          routeInfoRef.current?.({ error: true })
        })
    }

    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kStatic, theme])

  // ---- Capa de TRAZOS: los recorridos del día, uno por persona ------------------------------
  // Es la capa CARA (miles de puntos) y la que menos cambia: se recarga cada 60 s o al tocar un
  // filtro. Separarla de los móviles en vivo es el grueso del arreglo de performance.
  useEffect(() => {
    const layer = trailsLayerRef.current
    if (!layer) return
    layer.clearLayers()
    // `opacity`/`weight` por trail: al enfocar a una persona, su trazo va nítido y el resto
    // muy tenue. Si el trail no los trae, se usa el valor de siempre (0.85 / 4).
    ;(trails || []).forEach((t) => {
      if (!t.points || t.points.length < 2) return
      L.polyline(t.points.map((p) => [p.lat, p.lng]), {
        color: t.color || trailColor, weight: t.weight ?? 4, opacity: t.opacity ?? 0.85, lineJoin: 'round',
        // `dashArray`: lo usan los CONECTORES DE HUECO (features/supervision/trazos.js). Un trazo
        // se parte en segmentos donde el GPS dejó de reportar, y entre dos segmentos va una línea
        // punteada: dice "siguió siendo la misma persona" sin afirmar que fue por esa recta.
        // Undefined = línea llena, que es el trazo normal.
        dashArray: t.dashArray,
      }).addTo(layer)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kTrails, trailColor])

  // ---- Capa de MÓVILES: pines de cliente + burbujas en vivo ---------------------------------
  // La de ALTA frecuencia: se redibuja con cada posición que llega por Realtime. Es barata
  // (una docena de marcadores) y ahora es la única que se toca en ese evento.
  useEffect(() => {
    const layer = moversLayerRef.current
    if (!layer) return
    layer.clearLayers()

    markers.forEach((mk, i) => {
      // Las burbujas CON `id` las maneja el efecto de pines vivos (persisten y se animan). Acá
      // quedan los pines de cliente/parada y cualquier burbuja sin identidad, que son estáticos y
      // no ganan nada con sobrevivir al refresco.
      if (mk.bubble && mk.id) return
      const icon = mk.bubble
        ? bubbleIcon({ foto: mk.foto, iniciales: mk.label, color: mk.color, nombre: mk.title, ts: mk.ts, selected: mk.selected })
        : pinIcon(mk.color, mk.label, mk.labelColor, mk.selected)
      const m = L.marker([mk.lat, mk.lng], { icon, title: mk.title || '' })
      m.on('click', () => clickRef.current?.(i))
      m.addTo(layer)
    })

    // Movers = personas en vivo (vendedor/repartidor) que el Admin sigue. Cada uno
    // con su color propio (mv.color) para diferenciarlos; si no viene, por rol.
    movers.forEach((mv) => {
      if (mv.id) return // idem: los que tienen identidad viven en la capa de pines
      const color = mv.color || (mv.rol === 'repartidor'
        ? (theme === 'dark' ? '#FBBF24' : '#F59E0B')
        : (theme === 'dark' ? '#38BDF8' : '#0EA5E9'))
      // Burbuja de perfil (Life360): foto o iniciales, ancla al punto, frescura por ts.
      const icon = bubbleIcon({ foto: mv.foto, iniciales: mv.iniciales, color, nombre: mv.nombre, ts: mv.ts, selected: mv.selected })
      L.marker([mv.lat, mv.lng], { icon }).addTo(layer)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kMarkers, kMovers, theme])

  /* ---- Capa de PINES EN VIVO: los únicos marcadores que NO se recrean --------------------------
   *
   * 🩸 02/08/2026. La capa de arriba hace `clearLayers()` y vuelve a construir todos los marcadores
   * con cada posición que llega por Realtime. Eso hacía imposible animar el seguimiento: el pin de
   * antes se destruía y el nuevo nacía ya en el destino, así que la persona "saltaba" de A a B. No
   * era un problema de duración de la animación — era que no había ningún objeto moviéndose.
   *
   * Acá cada persona tiene UN marcador que vive mientras esté en pantalla. Al llegar una posición
   * nueva se le pide al animador que lo lleve hasta ahí, pegado a las calles (ver animarPin.js).
   *
   * El ícono se rehace SOLO si cambió algo que se ve. En particular NO depende del `ts` exacto —
   * cambia con cada latido— sino del bucket de frescura que ya calcula `frescura()`: si dependiera
   * del ts, el ícono se reconstruiría en cada posición y estaríamos otra vez recreando el DOM que
   * este efecto existe para conservar.
   */
  useEffect(() => {
    const layer = pinesLayerRef.current
    const map = mapRef.current
    if (!layer || !map) return

    const vivos = []
    ;(markers || []).forEach((mk, i) => {
      if (mk.bubble && mk.id) vivos.push({ ...mk, iniciales: mk.label, nombre: mk.title, indice: i })
    })
    ;(movers || []).forEach((mv) => {
      if (!mv.id) return
      const color = mv.color || (mv.rol === 'repartidor'
        ? (theme === 'dark' ? '#FBBF24' : '#F59E0B')
        : (theme === 'dark' ? '#38BDF8' : '#0EA5E9'))
      vivos.push({ ...mv, color, indice: null })
    })

    const pines = pinesRef.current
    const presentes = new Set()

    vivos.forEach((v) => {
      presentes.add(v.id)
      const fr = frescura(v.ts)
      const firma = [v.foto || '', v.iniciales || '', v.color || '', v.nombre || '', v.selected ? 1 : 0, fr.color, fr.dim ? 1 : 0].join('|')
      let pin = pines.get(v.id)

      if (!pin) {
        const icon = bubbleIcon({ foto: v.foto, iniciales: v.iniciales, color: v.color, nombre: v.nombre, ts: v.ts, selected: v.selected })
        const m = L.marker([v.lat, v.lng], { icon, title: v.nombre || '' })
        m.addTo(layer)
        pin = { marker: m, firma, indice: v.indice, lat: v.lat, lng: v.lng, ts: v.ts }
        pines.set(v.id, pin)
      } else {
        if (pin.firma !== firma) {
          pin.marker.setIcon(bubbleIcon({ foto: v.foto, iniciales: v.iniciales, color: v.color, nombre: v.nombre, ts: v.ts, selected: v.selected }))
          pin.firma = firma
        }
        /* 🩸 SE COMPARA CONTRA EL ÚLTIMO DESTINO MANDADO, NUNCA CONTRA `getLatLng()` (03/08/2026).
         *
         * Hasta hoy la condición era `pin.marker.getLatLng() !== v`, o sea la posición DIBUJADA. A
         * mitad de una animación eso es el fotograma actual, no el destino — y este efecto no corre
         * solo cuando esta persona se movió: `kMarkers` lleva el `ts` de TODOS y el `selected`, así
         * que el latido de cualquiera del equipo (y tocar a alguien, que conmuta `selected` en dos
         * marcadores) lo vuelve a disparar. Cada pin en vuelo se encontraba "fuera de lugar" y
         * reiniciaba su tramo, además con `dt = 0` (porque `pin.ts` ya se había pisado abajo) → 6 s
         * nuevos desde la mitad. Con el equipo entero reportando, el pin nunca terminaba de llegar.
         *
         * Y con el tramo pegado a calles no convergía nunca: la polilínea de OSRM termina en el
         * punto ENCAJADO a la calle, a metros de la coordenada GPS, así que la comparación daba
         * verdadero para siempre y el pin quedaba temblando entre la calle y el dato.
         *
         * `duracionMs` sale del tiempo real entre esta posición y la anterior: así el pin tarda en
         * cruzar el tramo más o menos lo que tardó la persona, en vez de correr a una velocidad
         * inventada.
         */
        if (pin.lat !== v.lat || pin.lng !== v.lng) {
          const dt = pin.ts && v.ts ? v.ts - pin.ts : 0
          animadorRef.current.mover(v.id, pin.marker, [v.lat, v.lng], {
            duracionMs: dt > 0 ? dt : undefined,
            // La cámara se mueve EN EL MISMO FRAME que el pin. Con `panTo` de Leaflet por fuera
            // habría dos animaciones compitiendo (la suya y la nuestra) y se ve como un tironeo;
            // acá la cámara no anima, simplemente está donde está el pin.
            alFrame: seguirIdRef.current === v.id
              ? (p) => { try { map.panTo(p, { animate: false }) } catch (_) {} }
              : undefined,
          })
          pin.lat = v.lat
          pin.lng = v.lng
          // 🩸 `ts` avanza SOLO cuando el destino cambió. Estando quieto el teléfono manda un punto
          // de cortesía cada 30 s: si el reloj se adelantara con esos, el `dt` del próximo tramo
          // real se mediría desde un latido que no movió nada y la duración saldría corta (el pin
          // cruzaría la cuadra a las corridas). Medido desde el último MOVIMIENTO, es el tiempo que
          // la persona tardó de verdad.
          pin.ts = v.ts
        }
      }
      pin.indice = v.indice
      // El click se re-cablea porque el índice dentro de `markers` puede cambiar entre refrescos
      // aunque el marcador sea el mismo objeto.
      pin.marker.off('click')
      if (pin.indice != null) pin.marker.on('click', () => clickRef.current?.(pin.indice))
    })

    // Los que ya no están (cambió el filtro, el día o la empresa): sacar el marcador y cortar su
    // animación, si no el rAF seguiría corriendo sobre un marcador huérfano.
    Array.from(pines.keys()).forEach((id) => {
      if (presentes.has(id)) return
      animadorRef.current.cancelar(id)
      try { layer.removeLayer(pines.get(id).marker) } catch (_) {}
      pines.delete(id)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kMarkers, kMovers, theme])

  // ---- Capa de CARTELES de permanencia ("permaneció 5 min acá") ------------------------------
  //  - pane 'luDwells' (z 450, creado al montar) → ENCIMA del trazo (overlayPane, 400) y
  //    debajo de los pines en vivo (markerPane, 600). Estuvieron en 'overlayPane', el mismo
  //    pane que las polilíneas, y el trazo los tapaba: el cartel no se podía leer. Con
  //    zIndexOffset tampoco alcanza — el z de un marker depende de su latitud, así que un
  //    cartel al norte treparía por encima de los pines.
  //  - interactive:TRUE desde el 30/07/2026 (antes false, "para no robarle el click al pin que
  //    tengan debajo"). Ahora el cartel ES un objetivo: se toca para ampliarlo al 150 % y ver el
  //    horario junto con el comercio. Lo único que queda debajo de este pane son las polilíneas
  //    de los recorridos, que no son clickeables; los pines en vivo viven en markerPane (z 600),
  //    por encima, así que siguen ganando el toque.
  //  - NO entran al fitBounds (a diferencia de `circle`): un cartel lejano descuadraría
  //    el encuadre del recorrido.
  useEffect(() => {
    const layer = dwellsLayerRef.current
    if (!layer) return
    layer.clearLayers()
    ;(dwells || []).forEach((d, i) => {
      const abierto = dwellSel === i
      const m = L.marker([d.lat, d.lng], {
        icon: dwellIcon({ label: d.label, sub: d.sub, extra: abierto ? d.extra : null, color: d.color, k: abierto ? 1.5 : 1 }),
        pane: 'luDwells',
        keyboard: false,
        // El ampliado se dibuja por encima de sus vecinos: si no, un cartel chico de al lado le
        // puede tapar justo el renglón que se acaba de destapar.
        zIndexOffset: abierto ? 100 : 0,
        title: abierto ? 'Tocar para achicar' : 'Tocar para ampliar',
      })
      m.on('click', () => dwellClickRef.current?.(i))
      m.addTo(layer)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kDwells, dwellSel])

  // ---- Capa de MARCADORES DE ARRANQUE ("▶ 08:47") ---------------------------------------------
  // Efecto propio y no un agregado al de los carteles de parada: cambian por motivos distintos
  // (estos con la fecha o el filtro; aquellos con el toggle de paradas y con la selección), y
  // juntarlos haría que tocar un cartel redibujara también los inicios. Es exactamente el error
  // que costó el 🩸 del 28/07/2026 con la capa única, en chico.
  //
  //  - `interactive:false`: es una etiqueta, no un objetivo. No le roba el toque ni al cartel de
  //    parada que pueda quedar cerca ni a los pines en vivo (que además viven en markerPane, 600).
  //  - NO entran al fitBounds, igual que los dwells: el arranque puede estar lejos del resto de la
  //    jornada (justamente cuando alguien arrancó en su casa) y descuadraría el encuadre.
  useEffect(() => {
    const layer = iniciosLayerRef.current
    if (!layer) return
    layer.clearLayers()
    ;(inicios || []).forEach((i) => {
      L.marker([i.lat, i.lng], {
        icon: inicioIcon({ hora: i.hora, color: i.color }),
        pane: 'luDwells',
        interactive: false,
        keyboard: false,
        title: i.hora ? 'Inicio de jornada ' + i.hora : 'Inicio de jornada',
      }).addTo(layer)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kInicios])

  // ---- ENCUADRE ------------------------------------------------------------------------------
  // El encuadre necesita ver TODAS las geometrías juntas, así que no puede vivir dentro de
  // ninguna capa: es su propio efecto. El recorrido de puntos se hace solo si `fit` está
  // encendido — en las supervisiones eso es `!fitDone`, o sea la primera vez y nada más.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (followLive && live) {
      // Modo seguimiento: la cámara sigue al vendedor en vivo (Admin observando el teléfono).
      map.setView([live.lat, live.lng], Math.max(map.getZoom() || zoom, 16))
      return
    }
    // Con seguimiento activo la cámara la manda el efecto de `seguir`. Sin esta guarda, cada
    // posición nueva cambiaría `kMovers` y el encuadre automático pelearía contra el seguimiento
    // en el mismo frame: se vería como un tironeo entre el zoom cerrado y el general.
    if (seguir) return
    if (!fit) return

    let bounds = null
    const extend = (latlng) => { bounds = bounds ? bounds.extend(latlng) : L.latLngBounds(latlng, latlng) }

    if (depot) extend([depot.lat, depot.lng])
    markers.forEach((mk) => extend([mk.lat, mk.lng]))
    movers.forEach((mv) => extend([mv.lat, mv.lng]))
    if (trail && trail.length >= 2) trail.forEach((p) => extend([p.lat, p.lng]))
    ;(trails || []).forEach((t) => {
      if (!t.points || t.points.length < 2) return
      // Los trazos atenuados (enfoque de otra persona) NO entran al encuadre: el fit lo
      // manda el recorrido enfocado, no los tenues de fondo.
      if ((t.opacity ?? 0.85) < 0.5) return
      t.points.forEach((p) => extend([p.lat, p.lng]))
    })
    if (circle) {
      const b = L.circle([circle.lat, circle.lng], { radius: circle.radiusM }).getBounds()
      bounds = bounds ? bounds.extend(b) : b
    }
    if (!bounds || !bounds.isValid()) return

    // "Un solo punto" = todos los puntos extendidos coinciden (NE == SW). Se decide por
    // la extensión REAL del bounds, no por el conteo de markers: en la Supervisión Móvil
    // el contenido son recorridos (trails) y móviles en vivo, así que contar solo markers
    // mandaba un trazo entero a setView(zoom fijo) y lo recortaba. Con 2+ coords distintas
    // → fitBounds. No cambia MapaOperativo (depot + cartera + ruta → siempre multi).
    const single = !circle && bounds.getNorthEast().equals(bounds.getSouthWest())
    if (single) {
      map.setView(bounds.getCenter(), zoom)
      // Un solo punto: setView lo centra en el viewport, pero header/nav lo taparían.
      // Desplazamos el centro para compensar el chrome asimétrico (más abajo → el punto
      // sube; más a la derecha → el punto va a la izquierda) y así queda visible.
      map.panBy([(edgePadding.right - edgePadding.left) / 2, (edgePadding.bottom - edgePadding.top) / 2], { animate: false })
    } else {
      // Padding asimétrico: reserva arriba/abajo/izq/der según el chrome que flota encima.
      map.fitBounds(bounds, { paddingTopLeft: [edgePadding.left, edgePadding.top], paddingBottomRight: [edgePadding.right, edgePadding.bottom] })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kStatic, kTrails, kMarkers, kMovers, fit, followLive, !!seguir])

  // Enfoque puntual al recorrido de una persona (click en la lista de equipo). Efecto
  // aparte del redibujo/encuadre: se dispara SOLO cuando cambia `focus.nonce` (un timestamp
  // por click), así re-enfocar al mismo usuario vuelve a funcionar y no interfiere con el
  // `fit` automático. `flyToBounds`/`flyTo` dan la animación suave de cámara.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !focus || !focus.points || !focus.points.length) return
    let bounds = null
    focus.points.forEach((p) => {
      if (p.lat == null || p.lng == null) return
      const ll = [p.lat, p.lng]
      bounds = bounds ? bounds.extend(ll) : L.latLngBounds(ll, ll)
    })
    if (!bounds || !bounds.isValid()) return
    // Un solo punto (o todos iguales): fitBounds no puede elegir zoom → flyTo con zoom fijo.
    if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.flyTo(bounds.getCenter(), Math.max(map.getZoom() || zoom, 16), { duration: 0.6 })
    } else {
      map.flyToBounds(bounds, {
        paddingTopLeft: [edgePadding.left, edgePadding.top],
        paddingBottomRight: [edgePadding.right, edgePadding.bottom],
        duration: 0.6,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus && focus.nonce])

  // SEGUIMIENTO en vivo de la persona monitoreada. Efecto propio y con dependencia en las
  // COORDENADAS (no en el objeto): así se reengancha exactamente una vez por posición nueva.
  //
  // La diferencia entre `flyTo` y `panTo` es lo que separa "seguir" de "saltar": la primera vez
  // hay que acercar la cámara (flyTo con zoom), pero de ahí en adelante el zoom ya es el bueno y
  // solo hay que desplazarse. Volver a hacer flyTo en cada fix daría un rebote de zoom cada pocos
  // segundos, que es exactamente lo que NO hace Google Maps.
  //
  // 🩸 EL ENGANCHE ES UN EVENTO, NO UNA COORDENADA (03/08/2026). Reportado así: "al hacer zoom con
  // el mapa abierto y volver a darle al botón de centrar, el seguimiento ya no funciona". Y no
  // funcionaba nunca, no "a veces": apretar el botón pone `seguirId`, pero **no cambia la posición
  // de la persona**, así que con las coordenadas como única dependencia este efecto NI SIQUIERA
  // CORRÍA. Y si corría —porque justo llegó un punto— se iba por la guarda de abajo, que le delega
  // la cámara a la animación del pin: una animación que solo existe cuando el pin se MUEVE. Con la
  // persona parada en un cliente, el botón no hacía absolutamente nada.
  //
  // Por eso ahora depende también del `nonce` que sella el botón al apretarlo (mismo patrón que
  // `focus.nonce`, que ya resuelve esto mismo para poder enfocar dos veces a la misma persona) y
  // del `id`. Y en el enganche SIEMPRE encuadra, con `flyTo` y acercando: es la única acción que el
  // usuario pidió explícitamente, así que es la única que no puede quedar supeditada a que llegue
  // un dato.
  const engancheRef = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !seguir || seguir.lat == null || seguir.lng == null) return
    const destino = [seguir.lat, seguir.lng]
    // ¿Es un enganche nuevo (botón) o una posición más de alguien a quien ya seguíamos?
    const enganche = `${seguir.id || ''}|${seguir.nonce || ''}`
    const recienEnganchado = engancheRef.current !== enganche
    engancheRef.current = enganche
    const z = map.getZoom() || zoom
    if (recienEnganchado || z < 16) { map.flyTo(destino, Math.max(z, 16), { duration: 0.6 }); return }
    // 🩸 Ya acercada, la cámara la lleva la ANIMACIÓN del pin, frame a frame (`alFrame` en el efecto
    // de pines vivos). Si además paneáramos acá, habría dos animaciones hacia el mismo destino con
    // curvas y duraciones distintas: la cámara llegaría antes que el pin y se vería el tironeo que
    // este rediseño vino a sacar. Solo se panea cuando NO hay un pin animando a esa persona —
    // ubicaciones compartidas de otra empresa, o un `seguir` sin id.
    if (seguir.id && pinesRef.current.has(seguir.id)) return
    map.panTo(destino, { animate: true, duration: 0.6 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seguir && seguir.lat, seguir && seguir.lng, seguir && seguir.id, seguir && seguir.nonce])

  // Capa de clientes (contexto). Efecto SEPARADO del redibujo de overlays: `clients` llega
  // memoizado desde la vista, así que su referencia es estable entre ticks y este efecto no se
  // dispara cada segundo aunque haya 2.000 puntos. Puntito chico y neutro, distinto de los
  // móviles en vivo (círculos grandes de color). No modifica el encuadre.
  useEffect(() => {
    const map = mapRef.current
    const layer = clientsLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const fill = theme === 'dark' ? '#94A3B8' : '#475569'
    const stroke = theme === 'dark' ? '#0B2B2A' : '#ffffff'
    ;(clients || []).forEach((cl) => {
      if (cl.lat == null || cl.lng == null) return
      const m = L.circleMarker([cl.lat, cl.lng], { radius: 4, color: stroke, weight: 1, fillColor: fill, fillOpacity: 0.95 })
      if (cl.nombre) m.bindTooltip(cl.nombre, { direction: 'top', offset: [0, -4] })
      m.addTo(layer)
    })
  }, [clients, theme])

  // 🩸 `isolation: isolate` (20/07/2026) — NO SACAR.
  //
  // Leaflet asigna z-index internos altísimos a sus propias capas: los panes van de
  // 400 a 700, el contenedor de controles 800, y hay reglas que llegan a 1000
  // (leaflet.css). Sin un stacking context propio, esos números compiten de igual a
  // igual contra el chrome de la app: el desplegable de "Mi cuenta" quedaba DEBAJO
  // del mapa de monitoreo, porque los popovers están en --z-popover (200).
  //
  // Con `isolate` el mapa crea su propio contexto y todo lo de Leaflet queda
  // confinado adentro: alcanza cualquier z-index >= 1 para taparlo. Eso es lo que
  // permite que la escala de tokens siga siendo chica y legible en vez de tener que
  // perseguir los números de la librería.
  //
  // SupervisionMovil.jsx:268 ya hacía esto a mano en su capa de mapa; acá pasa a
  // valer para TODOS los mapas (SupervisionDesktop, MapaOperativo, RecorridosView,
  // los mini-mapas de las fichas, etc.), que era donde faltaba.
  return <div ref={divRef} style={{ width: '100%', height, borderRadius: radius, overflow: 'hidden', background: 'var(--map-bg)', isolation: 'isolate' }} />
}
