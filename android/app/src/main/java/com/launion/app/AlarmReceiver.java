package com.launion.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
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

            // 🩸 27/07/2026 — que el rastreo ARRANQUE SOLO al horario aunque la app esté CERRADA.
            // El problema (reportado en cardixteam): la app no retomaba el rastreo hasta que alguien la
            // abría. `despertar()` solo pincha el JS, que con el proceso frío no existe → nunca re-armaba
            // la captura. Acá re-arrancamos el servicio NATIVO directamente (igual que BootReceiver), sin
            // depender del WebView. El servicio se auto-apaga si está fuera de su ventana fina
            // (dentroDeVentana), así que arrancarlo de más es inofensivo. La alarma usa
            // setAndAllowWhileIdle: al dispararse, el SO da una ventana de gracia que permite iniciar el
            // foreground service aun en Doze. Techo honesto: algunos OEM en Android 12+ pueden bloquear el
            // FGS-de-ubicación desde background; ahí se retoma al abrir la app.
            arrancarUploaderSiConfigurado(context);
        } finally {
            // Re-armar SIEMPRE la próxima: la alarma es de un solo disparo en Android moderno.
            AlarmWatchdogPlugin.programarProxima(context);
            if (wl != null && wl.isHeld()) wl.release();
        }
    }

    /**
     * Re-arranca el uploader GPS nativo si ya fue configurado alguna vez (el token/url persisten en
     * SharedPreferences). Mismo patrón que BootReceiver. Si el servicio ya corre, onStartCommand es
     * idempotente (no re-abre el watcher). Best-effort: no romper el disparo del watchdog.
     */
    private static void arrancarUploaderSiConfigurado(Context context) {
        try {
            SharedPreferences sp = context.getSharedPreferences(UploaderGpsService.PREFS, Context.MODE_PRIVATE);
            if (sp.getString(UploaderGpsService.K_TOKEN, null) == null) return; // nunca se logueó acá
            Intent svc = new Intent(context, UploaderGpsService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception ignored) {
            // FGS-desde-background puede estar restringido en algún OEM: se retoma al abrir la app.
        }
    }
}
