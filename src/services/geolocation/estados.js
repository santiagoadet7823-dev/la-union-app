/**
 * Máquina de estados del GPS según movimiento (módulo puro, NO-React).
 *
 * Traduce las transiciones crudas de Activity Recognition (`movimiento.js`) en cambios
 * de configuración del watcher nativo (`actualizarWatcher`): quieto = intervalo largo,
 * movimiento = intervalo corto. El ahorro es real (18× menos adquisiciones del chip
 * estando quieto) y no depende de que React renderice.
 *
 * NO-React igual que `tracker.js` y por el mismo motivo: los eventos de Activity
 * Recognition llegan por un PendingIntent del SO y pueden dispararse con el WebView
 * congelado (Doze, pantalla bloqueada). Si la máquina viviera en un effect, justo la
 * jornada que más importa (teléfono en el bolsillo, pantalla apagada) sería la que no
 * ajustaría nada. Estado y timers son de módulo → sobreviven al congelamiento.
 *
 * --- Por qué NO se apaga el GPS estando quieto ---
 * La tentación es `priority: 105` (NO_POWER) = GPS apagado. No se hace, por dos razones:
 *
 *  1. Con 105 no llega NINGÚN fix. `KEEPALIVE_MS` (90 s) y el `STALE_MS` (120 s) de
 *     `useEstadoDispositivo` esperan fixes periódicos: sin ellos el vendedor aparece como
 *     "sin señal" en Supervisión. Ahorraríamos batería rompiendo la supervisión.
 *  2. Con 102 (BALANCED_POWER) la precisión cae a ~30-100 m y `procesarFix` descarta todo
 *     lo que supere `ACCURACY_MAX_M` = 30 (`gpsConfig.js`): los fixes se adquirirían y se
 *     tirarían. Peor que inútil, porque es silencioso.
 *
 * Por eso `PRESET_QUIETO` mantiene la prioridad 100 y solo estira el intervalo: misma
 * precisión, 18× menos adquisiciones, y los 90 s coinciden con `KEEPALIVE_MS` para que el
 * marcador siga vivo. La variante agresiva (102 + subir ACCURACY_MAX_M) es un experimento
 * posterior que se prueba EN DISPOSITIVO: los presets son constantes exportadas justamente
 * para que ese experimento sea tocar un objeto y nada más.
 *
 * --- Por qué la histéresis es asimétrica ---
 * Un vendedor en un semáforo o esperando en la puerta de un cliente alterna quieto/
 * movimiento varias veces por minuto, y cada cambio sería un `updateWatcher`. Entonces:
 *  - pasar a QUIETO exige confirmación sostenida (`CONFIRMAR_QUIETO_MS`, ~2 min),
 *  - volver a MOVIMIENTO es INMEDIATO.
 * La asimetría es deliberada: perder precisión en el arranque de un recorrido es un daño
 * permanente en los datos (puntos que no se capturan no se recuperan), mientras que gastar
 * batería de más un rato es reversible. Ante la duda, MOVIMIENTO (= el comportamiento
 * actual, el que ya funciona).
 *
 * Sin Activity Recognition (web, APK viejo, permiso denegado, sin Play Services) la
 * máquina no arranca y devuelve un no-op: el watcher queda tal como lo dejó
 * `watchPosition` y el comportamiento es idéntico al de hoy.
 */
import { movimientoDisponible, escucharMovimiento } from './movimiento'
import { actualizarWatcher, OPCIONES_GPS_MOVIMIENTO } from './index'

/**
 * Quieto: MISMA prioridad (100) y mismo distanceFilter, solo el intervalo estirado.
 * 90 s en vez de 5 s → 18× menos adquisiciones del chip, precisión intacta.
 * Los 90 s están alineados con KEEPALIVE_MS (gpsConfig): el marcador nunca se cae.
 * OJO: updateWatcher NO hace merge, por eso se parte de OPCIONES_GPS_MOVIMIENTO entero.
 */
export const PRESET_QUIETO = Object.freeze({
  ...OPCIONES_GPS_MOVIMIENTO,
  interval: 90000,
  maxWaitTime: 120000,
})

/** Movimiento: la jornada normal, exactamente como arranca el watcher hoy. */
export const PRESET_MOVIMIENTO = Object.freeze({ ...OPCIONES_GPS_MOVIMIENTO })

/** Cuánto tiene que sostenerse "quieto" antes de creerle (anti-flapping). */
const CONFIRMAR_QUIETO_MS = 120000

// Estado de módulo (fuera de React) → sobrevive al congelamiento del WebView.
let estado = null          // 'quieto' | 'movimiento' | null (máquina parada)
let timerQuieto = null     // timer de confirmación sostenida
let pararEscucha = null    // desuscripción de escucharMovimiento
let generacion = 0         // invalida callbacks async de una máquina ya parada

/** Estado confirmado actual (telemetría/debug). null = máquina no corriendo. */
export function estadoActual() {
  return estado
}

function cancelarTimerQuieto() {
  if (timerQuieto) {
    clearTimeout(timerQuieto)
    timerQuieto = null
  }
}

/**
 * Aplica el preset del estado destino al watcher vivo. Solo "confirma" el estado si el
 * updateWatcher realmente se aplicó: si todavía no hay watcherId (el watch arranca async)
 * dejamos el estado como estaba y el próximo evento reintenta.
 */
async function aplicar(destino, getWatcherId) {
  const mia = generacion
  try {
    const id = getWatcherId()
    if (!id) return // el watch todavía no arrancó → no tocar nada, ya reintentará

    const ok = await actualizarWatcher(id, destino === 'quieto' ? PRESET_QUIETO : PRESET_MOVIMIENTO)

    // La máquina pudo haberse parado/reiniciado mientras esperábamos.
    if (mia !== generacion) return
    if (ok) estado = destino
  } catch (_) {
    // Activity Recognition o el updateWatcher fallaron: el watcher sigue con la config
    // que tenía y la captura no se interrumpe. Ante la duda, el comportamiento de hoy.
  }
}

/**
 * Arranca la máquina de estados.
 *
 * @param {{ getWatcherId: () => string|null|undefined }} opts `getWatcherId` se lee en el
 *        MOMENTO de cada cambio (no al inicio): el watch arranca async y el id llega después.
 * @returns {Promise<() => void>} función para parar (idempotente). No-op si no hay
 *          Activity Recognition disponible.
 */
export async function iniciarMaquina({ getWatcherId }) {
  const noop = () => {}

  try {
    // Sin Activity Recognition no hay máquina: web, APK viejo, permiso denegado o
    // dispositivo sin Play Services. Es el caso más importante de NO romper.
    if (!(await movimientoDisponible())) return noop
  } catch (_) {
    return noop
  }

  generacion += 1
  const mia = generacion

  // El watcher ya arranca con OPCIONES_GPS_MOVIMIENTO: el estado inicial es ese, sin
  // necesidad de un updateWatcher redundante.
  estado = 'movimiento'
  cancelarTimerQuieto()

  const irA = (destino) => {
    if (mia !== generacion) return
    if (destino === 'movimiento') {
      // Inmediato y siempre: aunque `estado` ya diga movimiento, puede que el aplicar
      // anterior no se haya confirmado por falta de watcherId.
      cancelarTimerQuieto()
      if (estado !== 'movimiento') aplicar('movimiento', getWatcherId)
      return
    }
    // Quieto: solo tras confirmación sostenida. Si ya hay un timer corriendo, se respeta
    // el original (no se reinicia la cuenta con cada re-aviso de "quieto").
    if (estado === 'quieto' || timerQuieto) return
    timerQuieto = setTimeout(() => {
      timerQuieto = null
      if (mia !== generacion) return
      aplicar('quieto', getWatcherId)
    }, CONFIRMAR_QUIETO_MS)
  }

  try {
    pararEscucha = escucharMovimiento((ev) => {
      try {
        if (!ev || !ev.actividad) return
        const quieto = ev.actividad === 'quieto'
        // Solo dos señales se usan, ambas inequívocas:
        //   - "entra quieto"  → candidato a QUIETO (a confirmar).
        //   - "sale quieto"   → arrancó a moverse → MOVIMIENTO ya.
        // El "sale" de una actividad de movimiento se IGNORA a propósito: salir de
        // 'caminando' no significa quedarse quieto (puede ser subirse al auto), y
        // tratarlo como quieto sería justo el flapping que queremos evitar.
        if (quieto) {
          irA(ev.transicion === 'entra' ? 'quieto' : 'movimiento')
          return
        }
        if (ev.transicion === 'entra') irA('movimiento')
      } catch (_) {
        // Un evento raro no puede tumbar la captura de GPS.
      }
    })
  } catch (_) {
    estado = null
    return noop
  }

  return () => {
    if (mia !== generacion) return // ya se paró o se reinició
    generacion += 1
    cancelarTimerQuieto()
    estado = null
    if (pararEscucha) {
      try { pararEscucha() } catch (_) { /* idempotente igual */ }
      pararEscucha = null
    }
  }
}
