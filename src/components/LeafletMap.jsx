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
 *        circle{lat,lng,radiusM,color}, height, onMarkerClick(index)
 */

// CARTO Voyager: basemap con nombres de calles, POIs y color (mucho más fiel a
// Google Maps que los estilos minimalistas *_all). Para dark usamos la variante
// "voyager" igual con etiquetas (más legible que dark_nolabels). crossOrigin
// habilita exportar el mapa a PNG (informe de recorridos) sin "tainted canvas".
const TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
}
const TILE_OPTS = { subdomains: 'abcd', maxZoom: 20, crossOrigin: 'anonymous', attribution: '&copy; OpenStreetMap &copy; CARTO' }

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
  height = 460,
  followLive = false,
  fit = true, // si es false, no reencuadra (preserva el zoom/pan del usuario)
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
    tileRef.current = L.tileLayer(TILES[theme] || TILES.dark, TILE_OPTS).addTo(map)
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
    tileRef.current = L.tileLayer(TILES[theme] || TILES.dark, TILE_OPTS).addTo(mapRef.current)
  }, [theme])

  // Redibujar overlays.
  const key = JSON.stringify({ markers, depot, live, route, circle, movers, trail, trails })
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
      const single = !circle && markers.length + (depot ? 1 : 0) <= 1
      if (single) map.setView(bounds.getCenter(), zoom)
      else map.fitBounds(bounds, { padding: [40, 40] })
    }

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, theme])

  return <div ref={divRef} style={{ width: '100%', height, borderRadius: 16, overflow: 'hidden', background: 'var(--map-bg)' }} />
}
