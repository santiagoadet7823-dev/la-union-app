import { registerPlugin } from '@capacitor/core'
import { isNative } from './platform'

/**
 * Watchdog OFFLINE por AlarmManager — el SEGUNDO canal del "¿quién cierra realmente la app?".
 *
 * El push (FCM, ver push.js) despierta la app cada ~30 min pero NECESITA internet. Si el vendedor
 * apagó los datos o está sin señal, el push no llega. Esta alarma es local: dispara igual sin red,
 * despierta al JS y —con la misma palanca que el push— refresca el latido y destapa las colas.
 * Los dos canales juntos cubren "app cerrada/congelada" con y sin datos.
 *
 * Realidad honesta (idéntica al push): despierta a la app viva-pero-dormida (Doze / kill "suave" de
 * OEM, el caso común); NO revive un force-stop manual. Su única ventaja sobre el push es disparar
 * sin conexión. En web / APK viejo sin el plugin degrada suave (no-op).
 *
 * El disparo del nativo se recibe por el callback de `escuchar()`; acá lo traducimos al mismo
 * `onWake` que usa el push (un visibilitychange sintético en GpsContext).
 */

const AlarmWatchdog = registerPlugin('AlarmWatchdog')

let iniciado = false

/**
 * Arranca el watchdog local (solo en la APK). Registra el callback de despertar y programa la
 * alarma repetida dentro de la ventana horaria dada.
 *
 * @param {() => void} onWake  callback en cada disparo (app viva/en 2º plano).
 * @param {{ intervaloMin?: number, horaInicio?: number, horaFin?: number }} [opts]
 *        Ventana horaria (hora local 0..24). Por defecto todo el día cada 30 min.
 */
export async function initAlarm(onWake, opts = {}) {
  if (iniciado || !isNative()) return
  iniciado = true
  try {
    // Stream de despertares: se resuelve una vez por disparo de la alarma.
    AlarmWatchdog.escuchar({}, (ev, err) => {
      if (err || !ev) return
      try { onWake && onWake() } catch (_) { /* best-effort */ }
    })
    await AlarmWatchdog.programar({
      intervaloMin: opts.intervaloMin ?? 30,
      horaInicio: opts.horaInicio ?? 0,
      horaFin: opts.horaFin ?? 24,
    })
  } catch (_) {
    // APK viejo sin el plugin, o AlarmManager no utilizable: el push sigue como canal principal.
    iniciado = false
  }
}

/** Cancela la alarma (por si alguna vez hace falta apagarla explícitamente). No-op en web. */
export async function pararAlarm() {
  if (!isNative()) return
  try { await AlarmWatchdog.cancelar() } catch (_) { /* best-effort */ }
}
