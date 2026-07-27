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
// (medido 26/07/2026). El marcador sigue "vivo" y se corta el volumen de quieto.
// 27/07/2026: bajado de 60 s a 30 s (pedido del cliente: 1 min se siente demasiado "viejo" el marcador
// parado; 30 s da mejor frescura a costa de ~2× el volumen de quieto, aceptable). En movimiento no cambia
// nada: ahí manda MIN_MOVE_M. Lo comparte el filtro nativo (uploaderNativo.js → K_KEEPALIVE del servicio).
export const STATIONARY_KEEPALIVE_MS = 30000  // 30 s
// Cadencia ADAPTATIVA por velocidad (pedido del cliente 27/07/2026): a 15 s de captura, en auto (~40 km/h
// ≈ 11 m/s) el chip da un fix cada ~165 m → la polilínea une esos dos puntos con una RECTA que cruza la
// manzana (el trazo "no respeta la calle"). El filtro por movimiento no ayuda: a esa velocidad todo fix
// supera MIN_MOVE_M y se guarda; el techo de densidad EN MOVIMIENTO lo pone el intervalo de adquisición.
// Solución: el servicio nativo sube la cadencia SOLO cuando detecta alta velocidad (getSpeed) y vuelve a
// la lenta al frenar — más puntos en las curvas/avenidas sin gastar batería parado. Estos valores viajan
// al nativo por uploaderNativo.configurar (SharedPreferences) → afinables por OTA sin recompilar el APK.
export const NEAR_LIVE_RAPIDO_MS = 5000   // captura EN MOVIMIENTO RÁPIDO (auto): trazo que sigue la calle
export const VEL_UMBRAL_MPS = 4           // ~14 km/h: por encima de esto, activar la cadencia rápida
export const VEL_HIST_MS = 20000          // sostener 20 s bajo el umbral antes de volver a la cadencia lenta (anti-flapping)
export const ACCURACY_MAX_M = 30   // fixes menos precisos que esto se descartan (jitter de interior = causa #1 de "vueltas" falsas)
export const MAX_SPEED_MPS = 45    // ~160 km/h: un desplazamiento más rápido es un salto imposible → glitch
