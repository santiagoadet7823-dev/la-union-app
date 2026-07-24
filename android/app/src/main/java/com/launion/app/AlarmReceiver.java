package com.launion.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.PowerManager;

/**
 * Receptor de la alarma del watchdog OFFLINE (ver AlarmWatchdogPlugin).
 *
 * Declarado EN EL MANIFEST (no dinámico) a propósito, por el mismo motivo que MovimientoReceiver:
 * un PendingIntent de AlarmManager contra un componente propio es un broadcast explícito y puede
 * arrancar el proceso en frío. Los dinámicos mueren con el proceso en los OEM agresivos.
 *
 * A diferencia del push (FCM), esta alarma NO necesita internet para dispararse: es el segundo
 * canal para saber quién cierra/congela la app cuando además está sin datos.
 */
public class AlarmReceiver extends BroadcastReceiver {

    /** Acción propia; el intent igual es explícito (apunta a esta clase). */
    public static final String ACCION = "com.launion.app.WATCHDOG_ALARMA";

    @Override
    public void onReceive(Context context, Intent intent) {
        // WakeLock corto: mantener la CPU el tiempo justo para despertar al JS y re-armar la próxima.
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = null;
        try {
            if (pm != null) {
                wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "launion:watchdog");
                wl.acquire(10_000L); // tope de 10 s por si algo se cuelga; se libera en finally igual
            }
            // Si el proceso fue revivido por esta alarma puede no haber WebView todavía: el plugin
            // lo descarta solo (instancia == null). Cuando la app está viva-pero-dormida, esto
            // dispara el mismo camino que el push: refresca el latido y destapa las colas.
            AlarmWatchdogPlugin.despertar();
        } finally {
            // Re-armar SIEMPRE la próxima: la alarma es de un solo disparo en Android moderno.
            AlarmWatchdogPlugin.programarProxima(context);
            if (wl != null && wl.isHeld()) wl.release();
        }
    }
}
