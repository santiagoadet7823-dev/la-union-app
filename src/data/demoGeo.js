/**
 * Dataset geográfico REAL — Distribuidora LA UNIÓN, Las Lajitas (Anta, Salta).
 * Centro/base = ubicación real del depósito. Clientes reales de la cartera.
 * Alimenta el mapa de Google/Leaflet y el ruteo por calles.
 */

// Ubicación real de la Distribuidora (centro/base del mapa).
export const DEPOSITO = {
  lat: -24.723078317901223,
  lng: -64.1943288188819,
  title: 'Autoservicio LA UNIÓN · Las Lajitas',
}

// Centro por defecto del mapa = depósito.
export const CENTRO = { lat: DEPOSITO.lat, lng: DEPOSITO.lng }

export const ROUTE_COLOR = { dark: '#2DD4CE', light: '#0ABAB5' }
