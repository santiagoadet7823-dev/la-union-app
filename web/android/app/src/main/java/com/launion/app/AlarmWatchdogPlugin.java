package com.launion.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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

    /** Id por defecto de la notificación de "actualización disponible". */
    private static final int NOTIF_ACT_ID = 4189;

    /**
     * Instancia viva, para que el receiver (clase aparte que instancia el sistema) llegue al bridge.
     * Si el proceso fue revivido por la alarma y todavía no hay WebView, queda null y el "despertar"
     * se descarta sin romper nada (igual que MovimientoReceiver).
     */
    private static AlarmWatchdogPlugin instancia;

    /** El callback de escuchar(), mantenido vivo para resolverlo en cada disparo. */
    private PluginCall llamadaEscucha;

    /* Defaults de la config del watchdog. Los VALORES vigentes viven en SharedPreferences, no acá:
     * ver el 🩸 de UploaderGpsService.K_WD_INTERVALO. Estos son solo el fallback de un teléfono que
     * todavía no corrió `programar()` ni una vez. */
    private static final int INTERVALO_DEF = 30;
    private static final int HORA_INI_DEF = 0;   // 0..23 (inclusivo)
    private static final int HORA_FIN_DEF = 24;  // 1..24 (exclusivo). 0..24 = sin ventana (todo el día).
    private static final long MARGEN_DEF = 180000L; // 3 min antes del borde (gpsConfig.ARRANQUE_MARGEN_MS)

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
        int intervaloMin = call.getInt("intervaloMin", INTERVALO_DEF);
        // Piso realista: por debajo de 15 min Doze igual no lo respeta (rate-limit de allow-while-idle).
        if (intervaloMin < 15) intervaloMin = 15;
        // PERSISTIR, no guardar en un static: el receiver puede correr en un proceso frío donde este
        // plugin nunca se instanció. Ver el 🩸 de UploaderGpsService.K_WD_INTERVALO.
        prefs(getContext()).edit()
            .putInt(UploaderGpsService.K_WD_INTERVALO, intervaloMin)
            .putInt(UploaderGpsService.K_WD_HORA_INI, call.getInt("horaInicio", HORA_INI_DEF))
            .putInt(UploaderGpsService.K_WD_HORA_FIN, call.getInt("horaFin", HORA_FIN_DEF))
            .putLong(UploaderGpsService.K_WD_MARGEN, call.getInt("margenMs", (int) MARGEN_DEF))
            .apply();
        programarProxima(getContext());
        call.resolve();
    }

    @PluginMethod
    public void cancelar(PluginCall call) {
        AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
        if (am != null) am.cancel(pendingIntent(getContext()));
        call.resolve();
    }

    /**
     * Postea una notificación de sistema que, al tocarla, abre la app.
     *
     * Dos usos, y por eso está parametrizada desde 1.10.0:
     *  · aviso de ACTUALIZACIÓN con la app cerrada — lo dispara `services/updateNotify.js` al
     *    despertar por el watchdog, solo si hay versión nueva y estamos en horario de monitoreo;
     *  · 🩸 aviso del EQUIPO con la app ABIERTA — el plugin de Capacitor, al recibir un push, NO
     *    postea nada: reenvía el mensaje al JS y espera que la app haga algo. Y hasta 1.9.0 la app no
     *    hacía nada con `tipo === 'alerta'`. O sea que mientras el supervisor tenía la app abierta
     *    mirando el mapa —el caso MÁS común— los avisos del equipo se perdían en silencio. Ahora
     *    `services/push.js` los postea por acá. Ver el 🩸 de LaUnionApp.java.
     *
     * El canal ya NO se crea acá: lo crea `LaUnionApp.onCreate()` al arrancar la app, que es lo que
     * permite que las Edge Functions manden `channel_id` sin riesgo. Igual se llama a `crearCanales`
     * por las dudas: es idempotente y cuesta nada.
     *
     * El permiso POST_NOTIFICATIONS ya se pide en el flujo de push (Android 13+); sin él, notify()
     * es no-op — y eso ahora se ve desde el servidor en `estado_dispositivo.notif_permiso` (db/29).
     */
    @PluginMethod
    public void notificar(PluginCall call) {
        String titulo = call.getString("titulo", "Actualización disponible");
        String cuerpo = call.getString("cuerpo", "Tocá para actualizar DisT-At.");
        String canal = call.getString("canal", LaUnionApp.CANAL_ACTUALIZACIONES);
        // Ids distintos = carteles distintos. Un `id` propio por tipo de aviso evita que el del
        // equipo pise al de actualización (y al revés), que es lo que pasaría con uno solo.
        int notifId = call.getInt("id", NOTIF_ACT_ID);
        Context ctx = getContext();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) { call.resolve(); return; }
        LaUnionApp.crearCanales(ctx);

        // Tocar la notificación abre la app (singleTask): el UpdatePrompt/updater se encarga del resto.
        Intent abrir = new Intent(ctx, MainActivity.class);
        abrir.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(ctx, 4190, abrir, flags);

        Notification.Builder b = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            ? new Notification.Builder(ctx, canal)
            : new Notification.Builder(ctx);
        b.setContentTitle(titulo)
         .setContentText(cuerpo)
         // El cuerpo de un aviso del equipo enumera nombres y no entra en una línea. BigTextStyle es
         // lo que hace que se pueda desplegar; en el bloque `notification` de FCM no se puede pedir,
         // y es una de las razones por las que el aviso en primer plano lo postea la app.
         .setStyle(new Notification.BigTextStyle().bigText(cuerpo))
         .setSmallIcon(ctx.getApplicationInfo().icon)
         .setAutoCancel(true)
         .setContentIntent(pi);

        try { nm.notify(notifId, b.build()); } catch (Exception e) { /* sin permiso: no-op */ }
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

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(UploaderGpsService.PREFS, Context.MODE_PRIVATE);
    }

    /**
     * ¿Se pueden programar alarmas EXACTAS? En API 31+ depende de un permiso que el usuario puede
     * no haber dado — pero que se concede SOLO por estar exento de la optimización de batería, que
     * es lo que esta app ya pide en `PermisoSiemprePrompt`. Por eso la palanca de campo es esa y no
     * mandar a la gente a "Alarmas y recordatorios".
     */
    private static boolean puedeExacta(AlarmManager am) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        try { return am.canScheduleExactAlarms(); } catch (Exception e) { return false; }
    }

    /**
     * Programa el próximo disparo.
     *
     * 🩸 REESCRITO EL 05/08/2026 — ACÁ ESTABA EL BUG DEL ARRANQUE TARDÍO.
     *
     * La versión anterior programaba SIEMPRE `ahora + intervalo` (30 min) y solo corría el disparo
     * "al inicio de ventana" si caía fuera de una ventana GENÉRICA de granularidad HORA, que el JS
     * hardcodeaba en 6–24. Esa ventana no tenía ninguna relación con el horario real de la persona
     * (categorías de rastreo, con minutos, días y jornada partida). O sea: **nadie programaba nunca
     * una alarma para las 08:00**.
     *
     * El efecto medido, sobre 29 días hábiles: el primer punto del día llegaba con una mediana de
     * 51 minutos de retraso, y el 79 % de los días con más de 15. Peor todavía, el disparo anterior
     * al borde QUEMABA el turno: a las 07:52 el receiver arrancaba el servicio, el servicio se
     * suicidaba a los 30 s por estar fuera de ventana, y la próxima alarma quedaba a las 08:22.
     *
     * Ahora el objetivo sale de la ventana REAL (`VentanaRastreo`, las mismas prefs que usa el
     * servicio para decidir si captura — regla 36: una sola definición, no una copia):
     *
     *     tick     = ahora + intervalo                 // el latido de siempre
     *     borde    = proximoInicio − margen            // ANTES del inicio: con el modo pausa el
     *                                                  // servicio despierta, calienta el chip y a
     *                                                  // las 08:00:00 ya tiene fix
     *     objetivo = fuera de ventana ? borde : min(tick, borde)
     *
     * ⚠️ El margen va ANTES del borde solo porque el servicio ahora PAUSA en vez de apagarse. Con el
     * comportamiento viejo, despertar a las 07:57 habría sido contraproducente (el servicio se
     * habría suicidado a los 30 s, gastando el turno igual que antes).
     *
     * Y se programa EXACTA cuando se puede: además de la puntualidad, una alarma exacta es una de
     * las exenciones que permiten iniciar un foreground service desde background en Android 12+ —
     * que es la otra mitad del bug (el caso "no arrancó en todo el día"). Si no se puede, cae a
     * `setAndAllowWhileIdle`, que es exactamente lo que hacía antes: nunca queda peor que hoy.
     */
    static void programarProxima(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        SharedPreferences sp = prefs(ctx);

        int intervaloMin = sp.getInt(UploaderGpsService.K_WD_INTERVALO, INTERVALO_DEF);
        if (intervaloMin < 15) intervaloMin = 15;
        int horaInicio = sp.getInt(UploaderGpsService.K_WD_HORA_INI, HORA_INI_DEF);
        int horaFin = sp.getInt(UploaderGpsService.K_WD_HORA_FIN, HORA_FIN_DEF);
        long margen = sp.getLong(UploaderGpsService.K_WD_MARGEN, MARGEN_DEF);

        long ahora = System.currentTimeMillis();
        long disparo = ahora + intervaloMin * 60_000L;

        // 1) La ventana GRUESA del watchdog (6–24), que sigue existiendo como red para el teléfono
        //    que todavía no tiene ventana fina en prefs (primer login, antes del primer configurar).
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

        // 2) La ventana FINA de la persona: es la que manda cuando existe.
        long ini = VentanaRastreo.proximoInicio(sp, ahora);
        if (ini > 0) {
            long borde = ini - margen;
            if (borde <= ahora) borde = ini; // el borde ya pasó recién: no programar en el pasado
            disparo = VentanaRastreo.dentro(sp, disparo) ? Math.min(disparo, borde) : borde;
        }

        boolean exacta = puedeExacta(am);
        try {
            if (exacta) {
                // Exacta + allow-while-idle: puntual en Doze Y exención de FGS-desde-background.
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, disparo, pendingIntent(ctx));
            } else {
                // RTC_WAKEUP + allow-while-idle: dispara en Doze sin permiso de alarma exacta.
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, disparo, pendingIntent(ctx));
            }
        } catch (Exception e) {
            // Sin AlarmManager utilizable: el push sigue siendo el canal principal, no rompemos nada.
            return;
        }
        // Dejar constancia de QUÉ quedó armado. Es lo que permite verificar de NOCHE que el teléfono
        // tiene el arranque de mañana listo, en vez de esperar 12 horas para descubrir que no.
        try {
            sp.edit()
                .putLong(UploaderGpsService.K_ALARMA_PROX, disparo)
                .putBoolean(UploaderGpsService.K_ALARMA_EXACTA, exacta)
                .apply();
        } catch (Exception ignored) {}
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
