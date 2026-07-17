package com.launion.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.google.android.gms.location.ActivityTransitionEvent;
import com.google.android.gms.location.ActivityTransitionResult;

/**
 * Receptor de las transiciones de actividad que entrega Activity Recognition.
 *
 * Está DECLARADO EN EL MANIFEST (no registrado dinámicamente) a propósito. El motivo
 * es el punto entero del ejercicio: las transiciones tienen que llegar con la app en
 * background.
 *
 *  - Play Services entrega el resultado a través del PendingIntent que armamos nosotros,
 *    o sea un broadcast EXPLÍCITO contra nuestro propio componente. Los broadcasts
 *    explícitos están exentos de la prohibición de broadcasts implícitos de Android 8+
 *    y además pueden ARRANCAR EL PROCESO EN FRÍO si estaba muerto.
 *  - Un receiver dinámico sólo vive mientras vive el proceso. En los OEM agresivos
 *    (Motorola, el caso ya diagnosticado en este proyecto) el proceso se muere al ratito
 *    de bloquear la pantalla: el receiver dinámico se evapora con él y las transiciones
 *    se pierden para siempre, justo en el escenario que queremos cubrir.
 *
 * exported="false" alcanza: el PendingIntent se dispara con la identidad de nuestra
 * propia app, así que no hace falta exponer el receiver a terceros.
 */
public class MovimientoReceiver extends BroadcastReceiver {

    /** Acción propia; el intent igual es explícito (apunta a esta clase). */
    public static final String ACCION = "com.launion.app.TRANSICION_ACTIVIDAD";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ActivityTransitionResult.hasResult(intent)) return;

        ActivityTransitionResult resultado = ActivityTransitionResult.extractResult(intent);
        if (resultado == null) return;

        for (ActivityTransitionEvent evento : resultado.getTransitionEvents()) {
            // Si el proceso fue revivido por este broadcast puede no haber instancia del
            // plugin todavía (WebView sin arrancar): MovimientoPlugin lo descarta solo.
            MovimientoPlugin.entregarTransicion(
                    MovimientoPlugin.nombreActividad(evento.getActivityType()),
                    MovimientoPlugin.nombreTransicion(evento.getTransitionType())
            );
        }
    }
}
