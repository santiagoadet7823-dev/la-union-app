package com.launion.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * 🩸 LA NOTIFICACIÓN DEL RASTREO VUELVE SOLA SI LA DESLIZAN (18/08/2026).
 *
 * **El síntoma**: "deslizo la notificación y veo que se apaga; debería quedar bloqueada y seguir
 * mandando ubicación."
 *
 * **Por qué se puede deslizar.** Hasta Android 13 la notificación de un foreground service era
 * INDESLIZABLE y `setOngoing(true)` alcanzaba. En **Android 14 eso cambió**: el usuario puede
 * descartarla, y `setOngoing` ya no lo impide. Esta app apunta a `targetSdk 34`, así que le aplica.
 * No hay bandera que lo devuelva: la decisión es del sistema y no se pelea.
 *
 * **Por qué se quedaba ida para siempre, que es la mitad que sí era nuestra.** `actualizarNotif()`
 * repinta **solo si el texto cambió** —una optimización correcta, para no llamar a `notify()` en
 * cada fix—. Pero cuando todo funciona bien el texto NO cambia nunca: se queda en "Enviando
 * ubicación en vivo" durante horas. O sea que un deslizamiento la borraba hasta el próximo cambio
 * de estado, que podía no llegar en toda la jornada. Sin cartel, el vendedor no tiene forma de
 * distinguir "sigue rastreando" de "se apagó" — y suponer lo segundo es lo razonable.
 *
 * **Qué hace esto.** El `deleteIntent` de la notificación apunta acá, así que el sistema nos avisa
 * en el momento del deslizamiento. Se vuelve a arrancar el servicio: `onStartCommand` llama a
 * `arrancarForeground()`, que es idempotente y **re-postea la notificación**. Efecto neto: se puede
 * deslizar, y vuelve. Que es lo más parecido a "bloqueada" que Android 14 permite.
 *
 * ⚠️ Esto NO prueba que el servicio siguiera vivo antes: si estaba muerto, el arranque de acá lo
 * levanta (y si el SO lo rechaza, `arrancarForeground` lo cuenta en `fgs_bloqueado`). Por eso el
 * deslizamiento también se CUENTA: hasta hoy era un evento invisible, y un hueco en el recorrido no
 * se podía atribuir ni descartar. Ver la lección de la telemetría de descartes en CLAUDE.md.
 */
public class NotifDeslizadaReceiver extends BroadcastReceiver {

    static final String ACCION = "com.launion.app.NOTIF_RASTREO_DESLIZADA";

    @Override
    public void onReceive(Context ctx, Intent intent) {
        if (intent == null || !ACCION.equals(intent.getAction())) return;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(UploaderGpsService.PREFS, Context.MODE_PRIVATE);
            // `commit()` y no `apply()`: el mismo criterio que `anotarFgsBloqueado`. Estamos en un
            // receiver de vida corta y justo en el momento que queremos medir.
            sp.edit()
                .putInt(UploaderGpsService.K_NOTIF_DESLIZ, sp.getInt(UploaderGpsService.K_NOTIF_DESLIZ, 0) + 1)
                .putLong(UploaderGpsService.K_NOTIF_DESLIZ_TS, System.currentTimeMillis())
                .commit();

            // Solo se repone si había con qué: sin token no hay sesión, y resucitar el servicio
            // ahí sería el bug de la regla 19-bis (puntos a nombre de quien ya no está).
            if (sp.getString(UploaderGpsService.K_TOKEN, null) == null) return;

            Intent svc = new Intent(ctx, UploaderGpsService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(svc);
            } else {
                ctx.startService(svc);
            }
        } catch (Exception e) {
            // Android 12+ puede rechazar el arranque desde background. No hay nada que hacer acá:
            // el watchdog y la alarma siguen siendo la red. Que no se caiga el receiver.
            Log.w("NotifDeslizada", "no se pudo reponer la notificación: " + e.getMessage());
        }
    }
}
