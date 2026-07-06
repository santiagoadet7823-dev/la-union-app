/**
 * Dataset geográfico demo (coordenadas reales de GBA — San Martín / Villa Ballester)
 * para el mapa de Google real con ruteo por calles. Coherente con los nombres/IDs
 * que usan las tablas del Admin y la hoja de ruta del Vendedor.
 *
 * En producción, estas coordenadas salen de clientes.csv (ver CatalogContext);
 * acá viven fijas para que el mapa demuestre el ruteo sin depender de datos vivos.
 */

export const DEPOSITO = { lat: -34.5665, lng: -58.5412, title: 'Depósito Central · San Martín' }

export const CLIENTES_GEO = [
  { n: '01', id: 'CLI-0417', name: 'Almacén Don Carlos', loc: 'Villa Ballester', lat: -34.5478, lng: -58.5561, st: 'visitado', kg: 84.5, total: 186400,
    items: [['Harina 000 1 kg ×10', 5, 39000], ['Azúcar 1 kg ×10', 3, 32700], ['Fideos Guiseros 500 g ×20', 2, 25200], ['Lavandina 2 L ×6', 2, 14400], ['Gaseosa Cola 2.25 L ×6', 5, 74000]] },
  { n: '02', id: 'CLI-0233', name: 'Autoservicio La Esquina', loc: 'San Andrés', lat: -34.5602, lng: -58.5389, st: 'visitado', kg: 121.3, total: 341850,
    items: [['Gaseosa Cola 2.25 L ×6', 4, 59200], ['Yerba Mate 1 kg ×10', 3, 115500], ['Aceite Girasol 1.5 L ×12', 2, 64800], ['Papas Fritas 145 g ×15', 3, 58500], ['Cerveza Rubia 1 L ×12', 2, 43200]] },
  { n: '03', id: 'CLI-0521', name: 'Kiosco El Trébol', loc: 'Villa Ballester', lat: -34.5443, lng: -58.5498, st: 'sin_pedido', kg: 0, total: 0, items: [] },
  { n: '04', id: 'CLI-0088', name: 'Almacén El Progreso', loc: 'San Martín', lat: -34.5710, lng: -58.5352, st: 'visitado', kg: 96.2, total: 214600,
    items: [['Arroz Largo Fino 1 kg ×10', 4, 52800], ['Azúcar 1 kg ×10', 3, 32700], ['Yerba Mate 1 kg ×10', 2, 77000], ['Detergente 750 ml ×12', 2, 31600], ['Rollo de Cocina ×12', 2, 20500]] },
  { n: '05', id: 'CLI-0342', name: 'Autoservicio Belgrano', loc: 'San Martín', lat: -34.5745, lng: -58.5290, st: 'pendiente', kg: 0, total: 0, items: [] },
  { n: '06', id: 'CLI-0155', name: 'Despensa Marta', loc: 'Villa Maipú', lat: -34.5820, lng: -58.5225, st: 'pendiente', kg: 0, total: 0, items: [] },
  { n: '07', id: 'CLI-0290', name: 'Maxikiosco Central', loc: 'San Martín', lat: -34.5665, lng: -58.5450, st: 'pendiente', kg: 0, total: 0, items: [] },
  { n: '08', id: 'CLI-0464', name: 'Súper Mi Barrio', loc: 'Villa Lynch', lat: -34.5891, lng: -58.5310, st: 'pendiente', kg: 0, total: 0, items: [] },
]

/** Colores de estado en hex (Google Canvas no acepta CSS vars). */
export function statusColor(st, theme) {
  const dark = theme === 'dark'
  if (st === 'visitado') return dark ? '#34D399' : '#10B981'
  if (st === 'sin_pedido') return dark ? '#FBBF24' : '#F59E0B'
  return dark ? '#5C7370' : '#93A9A7' // pendiente
}

export const ROUTE_COLOR = { dark: '#2DD4CE', light: '#0ABAB5' }
