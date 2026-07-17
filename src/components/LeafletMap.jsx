import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { obtenerRutaMulti, obtenerRutaOptimaTSP } from '../services/routing'
import { CENTRO_DEFECTO } from '../services/maps'

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

// Basemaps por tema. crossOrigin habilita exportar el mapa a PNG (informe de
// recorridos) sin "tainted canvas" — ambos proveedores mandan CORS.
//  - Claro: OpenStreetMap estándar → el más DEFINIDO y menos pálido (medido: contraste
//    27 vs 10 de Positron). Con el filtro CSS se desatura hacia gris tipo Google clásico.
//    OJO: OSM usa subdominios 'abc', llega a z19 y NO tiene retina {r}.
//  - Oscuro: CARTO Voyager oscuro (se mantiene, se ve bien de noche/en el vehículo).
// Los dos temas usan CARTO. Antes el claro era OpenStreetMap crudo: dos basemaps que no se
// parecen en nada (colores, tipografía, densidad de etiquetas), así que la misma jornada se
// veía distinta en la PWA y en el .apk según el tema de cada uno, y parecía un bug. Positron
// es el par claro de Voyager: mismo cartógrafo, misma familia visual, y encima deja resaltar
// los trazos de colores porque el fondo es tenue.
const TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png',
}
// Opciones por tema. Objeto simple, sin funciones, para no arriesgar un ReferenceError como
// el de la 1.4.2. Ahora ambos son CARTO → mismos subdominios (abcd), mismo zoom y retina.
const TILE_OPTS = {
  dark: { subdomains: 'abcd', maxZoom: 20, crossOrigin: 'anonymous', attribution: '&copy; OpenStreetMap &copy; CARTO' },
  light: { subdomains: 'abcd', maxZoom: 20, crossOrigin: 'anonymous', attribution: '&copy; OpenStreetMap &copy; CARTO' },
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
  trail = null,
  trailColor = '#2DD4CE',
  trails = null, // varios recorridos a la vez: [{ points:[{lat,lng}], color }]
  liveColor = null,
  onMarkerClick,
  onMapClick,
}) {
  const routeInfoRef = useRef(onRouteInfo)
  routeInfoRef.current = onRouteInfo
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const tileRef = useRef(null)
  const layerRef = useRef(null)
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
    tileRef.current = L.tileLayer(TILES[theme] || TILES.dark, TILE_OPTS[theme] || TILE_OPTS.dark).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    map.on('click', (e) => mapClickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng }))
    setTimeout(() => map.invalidateSize(), 60)
    // Reajustar el mapa al rotar / cambiar tamaño (alturas en vh).
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)
    return () => { window.removeEventListener('resize', onResize); map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cambio de tema → cambia el estilo de tiles.
  useEffect(() => {
    if (!mapRef.current) return
    if (tileRef.current) tileRef.current.remove()
    tileRef.current = L.tileLayer(TILES[theme] || TILES.dark, TILE_OPTS[theme] || TILE_OPTS.dark).addTo(mapRef.current)
  }, [theme])

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
      const m = L.marker([mk.lat, mk.lng], { icon: pinIcon(mk.color, mk.label, mk.labelColor, mk.selected), title: mk.title || '' })
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
      const m = L.circleMarker([mv.lat, mv.lng], { radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 })
      if (mv.nombre) m.bindTooltip(mv.nombre, { direction: 'top', offset: [0, -6] })
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

  return <div ref={divRef} style={{ width: '100%', height, borderRadius: 16, overflow: 'hidden', background: 'var(--map-bg)' }} />
}
