/**
 * Puerto de mapas — proveedor: Google Maps (look clásico) + Directions API para
 * ruteo que sigue las calles. La UI usa <GoogleMap> y nunca toca la key directo.
 *
 * La API key se lee de VITE_GOOGLE_MAPS_API_KEY (.env.local). Si falta, <GoogleMap>
 * muestra un fallback claro en vez de romper el build.
 */

export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''
export const hasMapsKey = () => Boolean(GOOGLE_MAPS_API_KEY)

// Centro operativo por defecto = ubicación real de la Distribuidora LA UNIÓN
// (Las Lajitas, Anta). El mapa igual hace fitBounds cuando hay varios marcadores.
export const CENTRO_DEFECTO = { lat: -24.723078317901223, lng: -64.1943288188819 }

// Estilo "Google Maps clásico" en dark, alineado a los tokens (#0C0C0C / teal).
export const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0e1d1c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0c0c0c' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8fa9a6' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a3230' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0d1f1e' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#5c7370' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#25514d' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a1414' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#2dd4ce' }, { visibility: 'off' }] },
]

export function mapOptions(theme) {
  return {
    disableDefaultUI: true,
    zoomControl: true,
    clickableIcons: false,
    styles: theme === 'dark' ? DARK_STYLE : undefined, // undefined = Google Maps clásico (light)
    backgroundColor: theme === 'dark' ? '#0a1414' : '#e7f3f1',
  }
}
