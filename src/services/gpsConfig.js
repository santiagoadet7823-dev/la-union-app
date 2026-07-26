/**
 * Constantes compartidas de filtrado GPS. Antes vivían solo en usePublishPosition
 * y useEstadoDispositivo las duplicaba de forma inconsistente (ignoraba accuracy);
 * un único origen evita que los dos vuelvan a divergir.
 */
export const MIN_MOVE_M = 12       // metros de desplazamiento mínimos para registrar un punto (menos jitter)
export const KEEPALIVE_MS = 90000  // reenvío de cortesía aunque no se mueva (marcador "vivo")
// Cadencia de CAPTURA "casi en vivo" (pedido del cliente 24/07/2026): el chip adquiere a esta cadencia
// para que, EN MOVIMIENTO, el supervisor lo vea moverse en tiempo casi real. Gobierna PRESET_QUIETO.interval
// (estados.js) y el intervaloMs del uploader nativo. OJO: captura ≠ guardado — cuánto se GUARDA lo decide
// el filtro por movimiento (MIN_MOVE_M o STATIONARY_KEEPALIVE_MS), no esta constante.
export const NEAR_LIVE_MS = 10000  // 10 s
// Reenvío estando QUIETO. Antes el gate de "quieto" usaba NEAR_LIVE_MS (10 s): un vendedor parado en un
// cliente emitía 6 puntos/min redundantes → inundaba `posiciones`, saturaba Realtime y trababa el mapa
// (medido 26/07/2026). Con 60 s el marcador sigue "vivo" (hace <1 min) pero se corta el volumen de quieto.
// En movimiento no cambia nada: ahí manda MIN_MOVE_M. Lo comparte el filtro nativo (uploaderNativo.js).
export const STATIONARY_KEEPALIVE_MS = 60000  // 60 s
export const ACCURACY_MAX_M = 30   // fixes menos precisos que esto se descartan (jitter de interior = causa #1 de "vueltas" falsas)
export const MAX_SPEED_MPS = 45    // ~160 km/h: un desplazamiento más rápido es un salto imposible → glitch
