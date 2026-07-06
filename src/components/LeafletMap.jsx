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

const TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
}
const TILE_OPTS = { subdomains: 'abcd', maxZoom: 20, attribution: '&copy; OpenStreetMap &copy; CARTO' }

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
  onMarkerClick,
}) {
  const routeInfoRef = useRef(onRouteInfo)
  routeInfoRef.current = onRouteInfo
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const tileRef = useRef(null)
  const layerRef = useRef(null)
  const clickRef = useRef(onMarkerClick)
  clickRef.current = onMarkerClick

  // Init único.
  useEffect(() => {
    if (!divRef.current || mapRef.current) return
    const map = L.map(divRef.current, { center: [center.lat, center.lng], zoom, zoomControl: true })
    mapRef.current = map
    tileRef.current = L.tileLayer(TILES[theme] || TILES.dark, TILE_OPTS).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    setTimeout(() => map.invalidateSize(), 60)
    return () => { map.remove(); mapRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cambio de tema → cambia el estilo de tiles.
  useEffect(() => {
    if (!mapRef.current) return
    if (tileRef.current) tileRef.current.remove()
    tileRef.current = L.tileLayer(TILES[theme] || TILES.dark, TILE_OPTS).addTo(mapRef.current)
  }, [theme])

  // Redibujar overlays.
  const key = JSON.stringify({ markers, depot, live, route, circle })
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
      L.circleMarker([live.lat, live.lng], { radius: 7, color: '#fff', weight: 3, fillColor: theme === 'dark' ? '#38BDF8' : '#0EA5E9', fillOpacity: 1 }).addTo(layer)
    }
    if (circle) {
      const c = L.circle([circle.lat, circle.lng], { radius: circle.radiusM, color: circle.color, weight: 1.5, fillColor: circle.color, fillOpacity: 0.12 }).addTo(layer)
      bounds = bounds ? bounds.extend(c.getBounds()) : c.getBounds()
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
          L.polyline(route.map((p) => [p.lat, p.lng]), { color: routeColor, weight: 3, opacity: 0.5, dashArray: '6 6' }).addTo(layerRef.current)
        })
    }

    if (followLive && live) {
      // Modo seguimiento: la cámara sigue al vendedor en vivo (Admin observando el teléfono).
      map.setView([live.lat, live.lng], Math.max(map.getZoom() || zoom, 16))
    } else if (bounds && bounds.isValid()) {
      const single = !circle && markers.length + (depot ? 1 : 0) <= 1
      if (single) map.setView(bounds.getCenter(), zoom)
      else map.fitBounds(bounds, { padding: [40, 40] })
    }

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, theme])

  return <div ref={divRef} style={{ width: '100%', height, borderRadius: 16, overflow: 'hidden', background: 'var(--map-bg)' }} />
}
