import { useEffect, useRef, useState } from 'react'
import { loadGoogleMaps } from '../services/maps/googleLoader'
import { mapOptions, hasMapsKey, CENTRO_DEFECTO } from '../services/maps'
import { sx } from '../lib/sx'

/**
 * Mapa Google Maps clásico reutilizable.
 *
 * props:
 *  - theme      'light' | 'dark'
 *  - center     {lat,lng}          (fallback si no hay marcadores)
 *  - zoom       number
 *  - markers    [{lat,lng,label?,color,title?,selected?}]
 *  - depot      {lat,lng,title?}   (marcador de depósito)
 *  - live       {lat,lng}          (posición en vivo)
 *  - route      [{lat,lng}, ...]   (≥2 → Directions con optimizeWaypoints, sigue calles)
 *  - routeColor hex
 *  - circle     {lat,lng,radiusM,color}   (geofence)
 *  - height     px
 *  - onMarkerClick (index) => void
 *
 * Si falta la API key, renderiza un fallback claro (no rompe el build).
 */
export default function GoogleMap({
  theme = 'dark',
  center = CENTRO_DEFECTO,
  zoom = 14,
  markers = [],
  depot = null,
  live = null,
  route = null,
  routeColor = '#2DD4CE',
  circle = null,
  height = 460,
  onMarkerClick,
}) {
  const divRef = useRef(null)
  const mapRef = useRef(null)
  const overlaysRef = useRef([])
  const dirRef = useRef(null)
  const clickRef = useRef(onMarkerClick)
  clickRef.current = onMarkerClick

  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(!hasMapsKey())

  // Init único.
  useEffect(() => {
    if (!hasMapsKey()) { setFailed(true); return }
    let cancelled = false
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !divRef.current) return
        mapRef.current = new google.maps.Map(divRef.current, { center, zoom, ...mapOptions(theme) })
        setReady(true)
      })
      .catch(() => setFailed(true))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cambio de tema.
  useEffect(() => {
    if (mapRef.current) mapRef.current.setOptions(mapOptions(theme))
  }, [theme, ready])

  // Redibujar overlays cuando cambian los datos.
  const key = JSON.stringify({ markers, depot, live, route, circle })
  useEffect(() => {
    if (!ready || !mapRef.current || !window.google) return
    const google = window.google
    const map = mapRef.current

    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []
    if (dirRef.current) { dirRef.current.setMap(null); dirRef.current = null }

    const bounds = new google.maps.LatLngBounds()
    let points = 0
    const push = (pos) => { bounds.extend(pos); points++ }

    if (depot) {
      const m = new google.maps.Marker({
        position: { lat: depot.lat, lng: depot.lng }, map, title: depot.title || 'Depósito',
        icon: { path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW, scale: 5, fillColor: theme === 'dark' ? '#ECF5F4' : '#0B2B2A', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 1.5 },
        zIndex: 50,
      })
      overlaysRef.current.push(m)
      push(m.getPosition())
    }

    markers.forEach((mk, i) => {
      const m = new google.maps.Marker({
        position: { lat: mk.lat, lng: mk.lng }, map, title: mk.title || '',
        label: mk.label ? { text: mk.label, color: mk.labelColor || '#fff', fontSize: '10px', fontFamily: 'IBM Plex Mono, monospace', fontWeight: '600' } : undefined,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: mk.selected ? 12 : 10, fillColor: mk.color, fillOpacity: 1, strokeColor: mk.selected ? '#2DD4CE' : '#fff', strokeWeight: mk.selected ? 3 : 2 },
        zIndex: mk.selected ? 40 : 20,
      })
      m.addListener('click', () => clickRef.current?.(i))
      overlaysRef.current.push(m)
      push(m.getPosition())
    })

    if (live) {
      const m = new google.maps.Marker({
        position: { lat: live.lat, lng: live.lng }, map, title: 'Posición en vivo',
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: theme === 'dark' ? '#38BDF8' : '#0EA5E9', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 },
        zIndex: 60,
      })
      overlaysRef.current.push(m)
      push(m.getPosition())
    }

    if (circle) {
      const c = new google.maps.Circle({
        map, center: { lat: circle.lat, lng: circle.lng }, radius: circle.radiusM,
        fillColor: circle.color || '#0ABAB5', fillOpacity: 0.12, strokeColor: circle.color || '#0ABAB5', strokeOpacity: 0.9, strokeWeight: 1.5,
      })
      overlaysRef.current.push(c)
      bounds.union(c.getBounds())
      points += 2
    }

    // Ruteo real por calles (Directions API).
    if (route && route.length >= 2) {
      const ds = new google.maps.DirectionsService()
      ds.route(
        {
          origin: { lat: route[0].lat, lng: route[0].lng },
          destination: { lat: route[route.length - 1].lat, lng: route[route.length - 1].lng },
          waypoints: route.slice(1, -1).map((p) => ({ location: { lat: p.lat, lng: p.lng }, stopover: true })),
          optimizeWaypoints: true,
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (res, status) => {
          if (status === 'OK' && mapRef.current) {
            dirRef.current = new google.maps.DirectionsRenderer({
              map: mapRef.current, directions: res, suppressMarkers: true, preserveViewport: true,
              polylineOptions: { strokeColor: routeColor, strokeWeight: 5, strokeOpacity: 0.9 },
            })
          }
        }
      )
    }

    if (points > 1) map.fitBounds(bounds, 48)
    else if (points === 1) { map.setCenter(bounds.getCenter()); map.setZoom(zoom) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key, theme])

  if (failed) {
    return (
      <div style={{ ...sx('border:1px dashed var(--line2);border-radius:16px;background:var(--map-bg);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;padding:24px'), height }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
        </svg>
        <div style={sx('font-size:13px;font-weight:600;color:var(--muted)')}>Mapa de Google no configurado</div>
        <div style={sx('font-size:11.5px;color:var(--faint);max-width:280px;font-family:var(--font-mono)')}>
          Agregá <b>VITE_GOOGLE_MAPS_API_KEY</b> en <b>.env.local</b> para ver el mapa clásico y el ruteo por calles.
        </div>
      </div>
    )
  }

  return <div ref={divRef} style={{ width: '100%', height, borderRadius: 16, overflow: 'hidden', background: 'var(--map-bg)' }} />
}
