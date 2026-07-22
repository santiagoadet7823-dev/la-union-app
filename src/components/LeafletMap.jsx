import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { obtenerRutaMulti, obtenerRutaOptimaTSP } from '../services/routing'
import { CENTRO_DEFECTO } from '../services/maps'
import { usableBasemaps, getBasemap, setBasemap, basemapById, onBasemapChange } from '../services/maps/basemap'

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
    const pintarActivo = () => {
      const cur = getId()
      menu.querySelectorAll('a').forEach((a) => {
        const on = a.dataset.id === cur
        a.style.background = on ? 'var(--primary-tint,#e6f7f6)' : 'transparent'
        a.style.color = on ? 'var(--deep,#0ABAB5)' : 'var(--text,#222)'
      })
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
 */
function dwellIcon(label, sub, color) {
  const c = color || '#2DD4CE'
  // `sub` (el horario) va en un segundo renglón, más chico y translúcido. En una sola línea
  // la píldora se iba a ~180 px: como el ancho lo fija el texto (nowrap + iconSize [0,0]),
  // apilar es lo que la mantiene angosta. El radio baja de 99 a 9 cuando hay dos líneas —
  // una píldora de dos renglones con borde 99 parece un huevo.
  const dosLineas = !!sub
  const linea2 = dosLineas
    ? `<div style="font-size:8.5px;font-weight:500;opacity:.82;letter-spacing:.02em">${sub}</div>`
    : ''
  return L.divIcon({
    className: 'lu-dwell',
    html: `<div style="position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;pointer-events:none;text-align:center;background:${c};color:#fff;border:1.5px solid rgba(255,255,255,.9);border-radius:${dosLineas ? 9 : 99}px;padding:${dosLineas ? '3px 7px' : '2px 7px'};box-shadow:0 1px 5px rgba(0,0,0,.35);font-family:'IBM Plex Mono',monospace;font-size:10px;font-weight:600;line-height:1.35">${label || ''}${linea2}</div>`,
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
  liveColor = null,
  onMarkerClick,
  onMapClick,
  basemapControl = true, // muestra el selector de capas (se puede apagar en algún mapa puntual)
  basemapPosition = 'topright', // esquina del selector de capas (para no chocar con otros controles)
}) {
  const routeInfoRef = useRef(onRouteInfo)
  routeInfoRef.current = onRouteInfo
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const tileRef = useRef(null)
  const basemapRef = useRef(getBasemap()) // id del basemap activo (para el control y el redibujo)
  const layerRef = useRef(null)
  const clientsLayerRef = useRef(null)
  const clickRef = useRef(onMarkerClick)
  clickRef.current = onMarkerClick
  const mapClickRef = useRef(onMapClick)
  mapClickRef.current = onMapClick

  // Init único.
  useEffect(() => {
    if (!divRef.current || mapRef.current) return
    const map = L.map(divRef.current, { center: [center.lat, center.lng], zoom, zoomControl: true })
    mapRef.current = map
    // Pane propio para los carteles de permanencia, con z-index EXPLÍCITO entre el de los
    // trazos (overlayPane, 400) y el de los pines en vivo (markerPane, 600).
    //
    // Antes los carteles iban en 'overlayPane' junto con las polilíneas: dentro de un mismo
    // pane conviven el <svg> de los trazos y los <div> de los marcadores, y quién tapa a
    // quién depende de internals de Leaflet — el trazo terminaba encima y el cartel no se
    // leía. Un pane propio hace el apilado determinista en vez de accidental.
    map.createPane('luDwells')
    map.getPane('luDwells').style.zIndex = 450
    map.getPane('luDwells').style.pointerEvents = 'none'
    tileRef.current = crearTileLayer(basemapRef.current).addTo(map)
    // Selector de capas (arriba a la derecha, no choca con el zoom que va arriba a la izquierda).
    // Solo si hay 2+ capas usables (en producción sin key Stadia queda solo OSM → sin selector).
    if (basemapControl && usableBasemaps().length >= 2) crearControlBasemap(() => basemapRef.current, basemapPosition).addTo(map)
    // Capa de clientes DEBAJO de la de overlays (se agrega primero) → los recorridos y pines en
    // vivo quedan por encima de los puntitos de comercios.
    clientsLayerRef.current = L.layerGroup().addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    map.on('click', (e) => mapClickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    setTimeout(() => map.invalidateSize(), 60)
    // Reajustar el mapa al rotar / cambiar tamaño (alturas en vh).
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); map.remove(); mapRef.current = null }
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

  // Redibujar overlays.
  const key = JSON.stringify({ markers, depot, live, route, circle, movers, trail, trails, dwells })
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    let cancelled = false
    layer.clearLayers()

    let bounds = null
    const extend = (latlng) => { bounds = bounds ? bounds.extend(latlng) : L.latLngBounds(latlng, latlng) }

    if (depot) {
      L.marker([depot.lat, depot.lng], { icon: depotIcon(theme), title: depot.title || 'Depósito' }).addTo(layer)
      extend([depot.lat, depot.lng])
    }
    markers.forEach((mk, i) => {
      // Los marcadores de PERSONA (móviles en vivo) van como burbuja de perfil (opt-in con
      // `bubble`); el resto (pines de cliente/paradas) sigue con el pin de gota de siempre.
      const icon = mk.bubble
        ? bubbleIcon({ foto: mk.foto, iniciales: mk.label, color: mk.color, nombre: mk.title, ts: mk.ts, selected: mk.selected })
        : pinIcon(mk.color, mk.label, mk.labelColor, mk.selected)
      const m = L.marker([mk.lat, mk.lng], { icon, title: mk.title || '' })
      m.on('click', () => clickRef.current?.(i))
      m.addTo(layer)
      extend([mk.lat, mk.lng])
    })
    if (live) {
      // Posición GPS en vivo. No se incluye en el fitBounds para no descuadrar el
      // encuadre del recorrido si el dispositivo está lejos del área de trabajo.
      const lc = liveColor || (theme === 'dark' ? '#38BDF8' : '#0EA5E9')
      L.circleMarker([live.lat, live.lng], { radius: 7, color: '#fff', weight: 3, fillColor: lc, fillOpacity: 1 }).addTo(layer)
    }
    // Movers = personas en vivo (vendedor/repartidor) que el Admin sigue. Cada uno
    // con su color propio (mv.color) para diferenciarlos; si no viene, por rol.
    movers.forEach((mv) => {
      const color = mv.color || (mv.rol === 'repartidor'
        ? (theme === 'dark' ? '#FBBF24' : '#F59E0B')
        : (theme === 'dark' ? '#38BDF8' : '#0EA5E9'))
      // Burbuja de perfil (Life360): foto o iniciales, ancla al punto, frescura por ts.
      const icon = bubbleIcon({ foto: mv.foto, iniciales: mv.iniciales, color, nombre: mv.nombre, ts: mv.ts, selected: mv.selected })
      const m = L.marker([mv.lat, mv.lng], { icon })
      m.addTo(layer)
      extend([mv.lat, mv.lng])
    })
    if (circle) {
      const c = L.circle([circle.lat, circle.lng], { radius: circle.radiusM, color: circle.color, weight: 1.5, fillColor: circle.color, fillOpacity: 0.12 }).addTo(layer)
      bounds = bounds ? bounds.extend(c.getBounds()) : c.getBounds()
    }

    // Rastro crudo (recorrido GPS grabado): polilínea literal, sin ruteo por calles.
    if (trail && trail.length >= 2) {
      const pts = trail.map((p) => [p.lat, p.lng])
      L.polyline(pts, { color: trailColor, weight: 4, opacity: 0.85, lineJoin: 'round' }).addTo(layer)
      pts.forEach((ll) => extend(ll))
    }

    // Varios recorridos a la vez (vista estática del encargado), color por persona.
    if (trails && trails.length) {
      trails.forEach((t) => {
        if (!t.points || t.points.length < 2) return
        const pts = t.points.map((p) => [p.lat, p.lng])
        L.polyline(pts, { color: t.color || trailColor, weight: 4, opacity: 0.85, lineJoin: 'round' }).addTo(layer)
        pts.forEach((ll) => extend(ll))
      })
    }

    // Carteles de permanencia ("permaneció 5 min acá"), sobre el trazo.
    //  - pane 'luDwells' (z 450, creado al montar) → ENCIMA del trazo (overlayPane, 400) y
    //    debajo de los pines en vivo (markerPane, 600). Estuvieron en 'overlayPane', el mismo
    //    pane que las polilíneas, y el trazo los tapaba: el cartel no se podía leer. Con
    //    zIndexOffset tampoco alcanza — el z de un marker depende de su latitud, así que un
    //    cartel al norte treparía por encima de los pines.
    //  - interactive:false → no roban el click al pin que tengan debajo.
    //  - NO entran al fitBounds (a diferencia de `circle`): un cartel lejano descuadraría
    //    el encuadre del recorrido.
    ;(dwells || []).forEach((d) => {
      L.marker([d.lat, d.lng], {
        icon: dwellIcon(d.label, d.sub, d.color),
        pane: 'luDwells',
        interactive: false,
        keyboard: false,
      }).addTo(layer)
    })

    // Ruteo por calles (OSRM). optimize=true → orden óptimo (TSP). Si falla la red,
    // cae a línea punteada directa para no dejar el mapa sin recorrido.
    if (route && route.length >= 2) {
      const pedido = optimize ? obtenerRutaOptimaTSP(route, { roundtrip }) : obtenerRutaMulti(route)
      pedido
        .then((r) => {
          if (cancelled || !layerRef.current) return
          if (r.coords?.length) L.polyline(r.coords, { color: routeColor, weight: 5, opacity: 0.9 }).addTo(layerRef.current)
          routeInfoRef.current?.({ distancia: r.distancia, duracion: r.duracion, orden: r.orden })
        })
        .catch(() => {
          if (cancelled || !layerRef.current) return
          // Sin red / OSRM caído: línea directa punteada y aviso a la vista.
          L.polyline(route.map((p) => [p.lat, p.lng]), { color: routeColor, weight: 3, opacity: 0.5, dashArray: '6 6' }).addTo(layerRef.current)
          routeInfoRef.current?.({ error: true })
        })
    }

    if (followLive && live) {
      // Modo seguimiento: la cámara sigue al vendedor en vivo (Admin observando el teléfono).
      map.setView([live.lat, live.lng], Math.max(map.getZoom() || zoom, 16))
    } else if (fit && bounds && bounds.isValid()) {
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
    }

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, theme])

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
  return <div ref={divRef} style={{ width: '100%', height, borderRadius: 16, overflow: 'hidden', background: 'var(--map-bg)', isolation: 'isolate' }} />
}
