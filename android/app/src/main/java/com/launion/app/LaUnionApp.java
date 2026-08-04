package com.launion.app;

import android.app.Application;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

/**
 * 🩸 LOS CANALES DE NOTIFICACIÓN, CREADOS AL ARRANCAR (04/08/2026).
 *
 * El cliente reportó que "no me están llegando bien las notificaciones y a los usuarios tampoco les
 * llega la de actualizar". El servidor estaba bien: las corridas de `alertas-equipo` devuelven
 * `{"enviados":2,"fallidos":0,"tokens_muertos":0}` y FCM acepta cada envío. El problema estaba en el
 * ÚLTIMO METRO.
 *
 * Hasta 1.9.0 esta app **no declaraba ningún canal de notificación**: el manifest no tenía
 * `com.google.firebase.messaging.default_notification_channel_id` y las tres Edge Functions mandaban
 * el bloque `notification` **sin `channel_id`**. Eso no era un descuido —hay un comentario en
 * `push-actualizacion` que lo explica— sino una defensa razonable contra un bug real: el canal
 * "actualizaciones" lo creaba `AlarmWatchdogPlugin.notificar()` recién CUANDO notificaba, así que
 * podía no existir todavía en un teléfono, y apuntar a un canal inexistente en Android 8+ hace que
 * la notificación **no se muestre**.
 *
 * El razonamiento era correcto y la solución no. Sin `channel_id` y sin canal por defecto, FCM cae
 * en su canal de reserva (`fcm_fallback_notification_channel`, "Miscellaneous"): no es de importancia
 * alta —no se asoma en pantalla— y varios OEM lo silencian u ocultan de fábrica. O sea, exactamente
 * el síntoma: el servidor dice "enviado" y en el teléfono no aparece nada. Y explica las DOS mitades
 * del reporte con una sola causa, porque los avisos del equipo y el de actualización viajan por el
 * mismo camino.
 *
 * El arreglo es invertir el orden: **los canales se crean al arrancar la app, no al notificar.**
 * Desde el primer arranque existen, así que apuntarles ya no es un salto al vacío.
 *
 * ⚠️ UN CANAL ES INMUTABLE UNA VEZ CREADO. Si el teléfono ya tiene "actualizaciones" con importancia
 * DEFAULT, cambiarla por código no hace absolutamente nada — el usuario es el único que puede. Por
 * eso el canal de los avisos del equipo se llama **`avisos`** y es nuevo: reusar "actualizaciones"
 * habría heredado su importancia en todos los teléfonos que ya lo tienen.
 *
 * `createNotificationChannel` es idempotente: llamarlo en cada arranque con los mismos ids no
 * duplica nada ni pisa lo que el usuario haya cambiado a mano.
 */
public class LaUnionApp extends Application {

    /**
     * Avisos del equipo (sin reportar / quieto / resumen). **IMPORTANCE_HIGH**: son el motivo por el
     * que un supervisor tiene la app instalada; tienen que asomarse en pantalla, no caer mudos en la
     * bandeja. Es también el canal por defecto de FCM (ver el meta-data del manifest).
     */
    public static final String CANAL_AVISOS = "avisos";

    /**
     * Aviso de versión nueva. **IMPORTANCE_DEFAULT**: informa, no interrumpe — y además ya existe con
     * esa importancia en los teléfonos que corrieron 1.6.x o posterior, así que no se puede cambiar.
     */
    public static final String CANAL_ACTUALIZACIONES = "actualizaciones";

    @Override
    public void onCreate() {
        super.onCreate();
        crearCanales(this);
    }

    /**
     * Idempotente y barata. Se expone `static` para que la pueda llamar también el plugin antes de
     * notificar: si algún día el proceso arranca por un receiver sin pasar por `Application.onCreate`
     * —no debería, pero los OEM sorprenden— el canal igual está.
     */
    static void crearCanales(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel avisos = new NotificationChannel(
            CANAL_AVISOS, "Avisos del equipo", NotificationManager.IMPORTANCE_HIGH);
        avisos.setDescription("Quién dejó de enviar ubicación y el resumen del equipo.");
        nm.createNotificationChannel(avisos);

        NotificationChannel act = new NotificationChannel(
            CANAL_ACTUALIZACIONES, "Actualizaciones", NotificationManager.IMPORTANCE_DEFAULT);
        act.setDescription("Aviso cuando hay una versión nueva de la app.");
        nm.createNotificationChannel(act);
    }
}
