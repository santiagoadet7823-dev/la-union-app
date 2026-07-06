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

export const CLIENTES_GEO = [
  {
    n: '01', id: 'CLI-001', name: 'Kiosco EBEN-EZER', loc: 'Las Lajitas',
    lat: -24.72232137457981, lng: -64.19113576412745, st: 'visitado', kg: 84.5, total: 186400,
    items: [
      ['Harina 000 (Caja 10x1kg)', 5, 70000],
      ['Azúcar Común Tipo A (Fardo 10x1kg)', 3, 36000],
      ['Pack Gaseosa Cola 1.5L (x6)', 5, 42500],
      ['Lavandina Concentrada 1L (Caja x12)', 2, 18800],
    ],
  },
  {
    n: '02', id: 'CLI-002', name: 'Kiosco Los 2 Gauchos', loc: 'Las Lajitas',
    lat: -24.71998266936364, lng: -64.19753630437107, st: 'visitado', kg: 121.3, total: 341850,
    items: [
      ['Yerba Mate Con Palo 1kg (Bulto x10)', 3, 102000],
      ['Aceite de Girasol 900ml (Caja x12)', 2, 44000],
      ['Pack Cerveza Rubia Lata 473ml (x24)', 2, 56000],
      ['Pack Galletitas Dulces Rellenas (Caja x36)', 3, 73500],
    ],
  },
  {
    n: '03', id: 'CLI-003', name: 'Kiosco catalina', loc: 'Las Lajitas',
    lat: -24.718314994459114, lng: -64.19544328486015, st: 'sin_pedido', kg: 0, total: 0, items: [],
  },
  {
    n: '04', id: 'CLI-004', name: 'Kiosco tenefe', loc: 'Las Lajitas',
    lat: -24.71972456252089, lng: -64.1984024483027, st: 'pendiente', kg: 0, total: 0, items: [],
  },
]

/** Colores de estado en hex (el canvas del mapa no acepta CSS vars). */
export function statusColor(st, theme) {
  const dark = theme === 'dark'
  if (st === 'visitado') return dark ? '#34D399' : '#10B981'
  if (st === 'sin_pedido') return dark ? '#FBBF24' : '#F59E0B'
  return dark ? '#5C7370' : '#93A9A7' // pendiente
}

export const ROUTE_COLOR = { dark: '#2DD4CE', light: '#0ABAB5' }
