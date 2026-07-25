/**
 * Constantes compartidas de filtrado GPS. Antes vivían solo en usePublishPosition
 * y useEstadoDispositivo las duplicaba de forma inconsistente (ignoraba accuracy);
 * un único origen evita que los dos vuelvan a divergir.
 */
export const MIN_MOVE_M = 10       // metros de desplazamiento mínimos para registrar un punto (menos jitter)
export const KEEPALIVE_MS = 90000  // reenvío de cortesía aunque no se mueva (marcador "vivo")
// Cadencia "casi en vivo" (pedido del cliente 24/07/2026): aunque el vendedor esté QUIETO, emitir un
// punto al menos cada NEAR_LIVE_MS para que el supervisor lo vea moverse en tiempo casi real. Gobierna
// el gate de tiempo en tracker.js y se alinea con PRESET_QUIETO.interval (estados.js) — si el chip no
// adquiere a esta cadencia en 2º plano, no hay nada que emitir. Costo consciente: más batería (el
// ahorro del estado "quieto" desaparece) y más filas en `posiciones` (requiere retención, db/13).
export const NEAR_LIVE_MS = 10000  // 10 s
export const ACCURACY_MAX_M = 30   // fixes menos precisos que esto se descartan (jitter de interior = causa #1 de "vueltas" falsas)
export const MAX_SPEED_MPS = 45    // ~160 km/h: un desplazamiento más rápido es un salto imposible → glitch
