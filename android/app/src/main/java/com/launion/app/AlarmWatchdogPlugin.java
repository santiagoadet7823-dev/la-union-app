package com.launion.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.Calendar;

/**
 * Watchdog OFFLINE por AlarmManager: el segundo canal del "¿quién cierra realmente la app?".
 *
 * Motivo: el push (FCM) despierta la app cada ~30 min, pero NECESITA internet para llegar. Si el
 * vendedor apagó los datos (o está en zona sin señal), el push nunca aterriza y no nos enteramos.
 * Una alarma local NO depende de la red: dispara igual, despierta al JS, refresca el latido y
 * destapa las colas en cuanto vuelva la conexión. Los dos canales juntos cubren "app cerrada" con
 * y sin datos.
 *
 * Este plugin es SÓLO el disparador local. La reacción (refrescar latido / flush de colas) vive en
 * JS: al disparar, se resuelve el callback de `escuchar()` y el puente (services/alarm.js) hace lo
 * mismo que el push (un visibilitychange sintético).
 *
 * Realidad honesta (idéntica al push): despierta a la app viva-pero-dormida (Doze / kill "suave" de
 * OEM, el caso común); NO revive un force-stop manual ni un proceso frío sin WebView. Su única
 * ventaja sobre el push es que dispara SIN conexión.
 *
 * Se usa `setAndAllowWhileIdle`: dispara en Doze y —a diferencia de las alarmas EXACTAS— NO exige
 * el permiso SCHEDULE_EXACT_ALARM (que en Android 13+ hay que pedir a mano). El costo es que el
 * intervalo no es al segundo (Doze lo rate-limita a ~1 cada 9-15 min); para un watchdog de 30 min
 * es de sobra. La alarma es de UN SOLO disparo en Android moderno: se re-arma en cada `onReceive`.
 */
@CapacitorPlugin(name = "AlarmWatchdog")
public class AlarmWatchdogPlugin extends Plugin {

    /** Código del PendingIntent. Constante: programar y cancelar tienen que hablar del mismo. */
    private static final int CODIGO = 4188;

    /**
     * Instancia viva, para que el receiver (clase aparte que instancia el sistema) llegue al bridge.
     * Si el proceso fue revivido por la alarma y todavía no hay WebView, queda null y el "despertar"
     * se descarta sin romper nada (igual que MovimientoReceiver).
     */
    private static AlarmWatchdogPlugin instancia;

    /** El callback de escuchar(), mantenido vivo para resolverlo en cada disparo. */
    private PluginCall llamadaEscucha;

    // Config de la ventana, a nivel proceso: el receiver la re-lee para re-armar la próxima.
    static int intervaloMin = 30;
    static int horaInicio = 0;   // 0..23 (inclusivo)
    static int horaFin = 24;     // 1..24 (exclusivo). 0..24 = sin ventana (todo el día).

    @Override
    public void load() {
        instancia = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instancia == this) instancia = null;
        super.handleOnDestroy();
    }

    // ---------------------------------------------------------------- métodos JS

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void escuchar(PluginCall call) {
        // Stream de despertares: el callback sobrevive al return para resolverse muchas veces.
        call.setKeepAlive(true);
        llamadaEscucha = call;
    }

    @PluginMethod
    public void programar(PluginCall call) {
        intervaloMin = call.getInt("intervaloMin", 30);
        horaInicio = call.getInt("horaInicio", 0);
        horaFin = call.getInt("horaFin", 24);
        // Piso realista: por debajo de 15 min Doze igual no lo respeta (rate-limit de allow-while-idle).
        if (intervaloMin < 15) intervaloMin = 15;
        programarProxima(getContext());
        call.resolve();
    }

    @PluginMethod
    public void cancelar(PluginCall call) {
        AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pendingIntent(getContext()));
        call.resolve();
    }

    // ---------------------------------------------------------------- interno

    private static PendingIntent pendingIntent(Context ctx) {
        // Intent EXPLÍCITO contra nuestro receiver del manifest (puede arrancar el proceso en frío).
        Intent intent = new Intent(ctx, AlarmReceiver.class);
        intent.setAction(AlarmReceiver.ACCION);
        // A diferencia de Activity Recognition, acá el SO NO escribe nada dentro del intent, así que
        // IMMUTABLE es lo correcto (y lo que exige API 31+).
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(ctx, CODIGO, intent, flags);
    }

    /**
     * Programa el próximo disparo: dentro de la ventana → ahora + intervalo; si ese instante cae
     * fuera de la ventana horaria, lo corre al próximo inicio de ventana (así no despierta de
     * madrugada). Se re-llama en cada disparo (la alarma es de un solo tiro en Android moderno).
     */
    static void programarProxima(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        long ahora = System.currentTimeMillis();
        long disparo = ahora + intervaloMin * 60_000L;

        boolean sinVentana = horaInicio <= 0 && horaFin >= 24;
        if (!sinVentana) {
            Calendar c = Calendar.getInstance();
            c.setTimeInMillis(disparo);
            int hora = c.get(Calendar.HOUR_OF_DAY);
            if (hora < horaInicio || hora >= horaFin) {
                // Correr al inicio de la ventana (hoy si todavía no pasó, si no mañana).
                Calendar inicio = Calendar.getInstance();
                inicio.setTimeInMillis(ahora);
                inicio.set(Calendar.HOUR_OF_DAY, horaInicio);
                inicio.set(Calendar.MINUTE, 0);
                inicio.set(Calendar.SECOND, 0);
                inicio.set(Calendar.MILLISECOND, 0);
                if (inicio.getTimeInMillis() <= ahora) inicio.add(Calendar.DAY_OF_MONTH, 1);
                disparo = inicio.getTimeInMillis();
            }
        }

        try {
            // RTC_WAKEUP + allow-while-idle: dispara en Doze sin permiso de alarma exacta.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, disparo, pendingIntent(ctx));
        } catch (Exception e) {
            // Sin AlarmManager utilizable: el push sigue siendo el canal principal, no rompemos nada.
        }
    }

    /** Llamado por AlarmReceiver al disparar: despierta al JS si la app está viva. */
    static void despertar() {
        AlarmWatchdogPlugin p = instancia;
        if (p == null) return;                 // proceso revivido sin WebView: nada que despertar
        PluginCall call = p.llamadaEscucha;
        if (call == null) return;              // nadie escuchando
        JSObject ev = new JSObject();
        ev.put("tipo", "watchdog");
        call.resolve(ev);                      // keepAlive → se puede resolver de nuevo
    }
}
