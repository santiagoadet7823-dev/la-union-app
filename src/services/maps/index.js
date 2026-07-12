/**
 * Constante de mapa. La app usa Leaflet (ver components/LeafletMap.jsx); el puerto
 * Google Maps quedó fuera de uso — sobrevive solo el centro por defecto.
 */

// Centro operativo por defecto = ubicación real de la Distribuidora LA UNIÓN
// (Las Lajitas, Anta). El mapa igual hace fitBounds cuando hay varios marcadores.
export const CENTRO_DEFECTO = { lat: -24.723078317901223, lng: -64.1943288188819 }
