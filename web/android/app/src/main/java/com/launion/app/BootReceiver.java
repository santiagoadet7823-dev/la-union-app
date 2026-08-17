package com.launion.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Re-arma el watchdog OFFLINE tras un reinicio del teléfono o una actualización del APK (Tarea A /
 * jornada, 24/07/2026). Sin esto, después de un reboot el AlarmManager queda sin alarma programada
 * hasta que el vendedor abra la app a mano — y justo la mañana que arranca la jornada es cuando más
 * importa que el rastreo se retome solo.
 *
 * Declarado EN EL MANIFEST (no dinámico) por el mismo motivo que AlarmReceiver/MovimientoReceiver:
 * el broadcast de arranque llega con el proceso muerto y debe poder arrancarlo en frío.
 *
 * TECHO HONESTO (no vender de más): esto SOLO re-programa la alarma del watchdog; NO reinicia la
 * captura GPS por su cuenta. Android 12+ prohíbe abrir la Activity o iniciar el foreground service de
 * ubicación desde un broadcast de arranque en background. La captura continua se retoma cuando el
 * vendedor abre la app; el watchdog re-armado solo garantiza que el canal de "despertar" siga vivo.
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)
                || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            try {
                // Usa la ventana/intervalo por defecto del plugin (30 min, sin ventana) hasta que la
                // app corra y llame a programar() con la config real. Reusa la cadena probada.
                AlarmWatchdogPlugin.programarProxima(context.getApplicationContext());
            } catch (Exception ignored) { /* best-effort: no romper el arranque del sistema */ }

            // Reanudar el uploader GPS nativo si ya estaba configurado (token/url persisten en disco):
            // así el rastreo se retoma tras reiniciar sin que el vendedor abra la app. Best-effort:
            // Android 12+ puede bloquear iniciar un foreground service desde el arranque en algunos OEM.
            try {
                SharedPreferences sp = context.getSharedPreferences(UploaderGpsService.PREFS, Context.MODE_PRIVATE);
                // 🩸 Marca de ARRANQUE (30/07/2026). Es lo que permite explicarle después al supervisor
                // un hueco en el recorrido: "el teléfono se reinició a las 14:32". Se anota SIEMPRE,
                // aunque el servicio no se pueda levantar — el dato del arranque vale igual, y de hecho
                // vale más justo cuando el rastreo no se retomó solo.
                //
                // Es la mitad confiable del par: `apagado_ts` (ACTION_SHUTDOWN, en el servicio) es
                // best-effort y no caza la batería agotada; este broadcast sí llega siempre.
                if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                        || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
                    sp.edit().putLong(UploaderGpsService.K_ARRANQUE, System.currentTimeMillis()).apply();
                }
                if (sp.getString(UploaderGpsService.K_TOKEN, null) != null) {
                    Intent svc = new Intent(context, UploaderGpsService.class);
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(svc);
                    } else {
                        context.startService(svc);
                    }
                }
            } catch (Exception ignored) { /* FGS-desde-boot puede estar restringido: se retoma al abrir la app */ }
        }
    }
}
