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
            // depender del WebView.
            //
            // 🩸 05/08/2026 — LA PREMISA DE ESE COMENTARIO ERA FALSA. Decía: "el servicio se auto-apaga
            // si está fuera de su ventana fina, así que arrancarlo de más es inofensivo". No lo era.
            // Arrancarlo a las 07:52 lo hacía suicidarse a los 30 s Y CONSUMÍA EL TURNO: la próxima
            // alarma quedaba a las 08:22, así que el rastreo empezaba media hora tarde. Medido sobre
            // 29 días hábiles: mediana de 51 min de retraso en el primer punto del día.
            //
            // Ahora hay dos cambios: el servicio PAUSA en vez de apagarse (ver UploaderGpsService), y
            // `programarProxima` apunta al borde REAL de la ventana en vez de a "+30 min" ciego.
            anotarDisparo(context);
            arrancarUploaderSiConfigurado(context);
        } finally {
            // Re-armar SIEMPRE la próxima: la alarma es de un solo disparo en Android moderno.
            AlarmWatchdogPlugin.programarProxima(context);
            if (wl != null && wl.isHeld()) wl.release();
        }
    }

    /**
     * Deja constancia de que la alarma corrió. Sin esto, "la alarma no dispara" y "la alarma dispara
     * pero Android bloquea el arranque" son indistinguibles desde la base — y el arreglo de cada una
     * es completamente distinto (la primera es un OEM que mata el receiver; la segunda, la exención
     * de batería). Viaja en el latido a `estado_dispositivo.alarma_ultima_ts` (db/30).
     */
    private static void anotarDisparo(Context context) {
        try {
            context.getSharedPreferences(UploaderGpsService.PREFS, Context.MODE_PRIVATE)
                .edit().putLong(UploaderGpsService.K_ALARMA_TS, System.currentTimeMillis()).apply();
        } catch (Exception ignored) {}
    }

    /**
     * Re-arranca el uploader GPS nativo si ya fue configurado alguna vez (el token/url persisten en
     * SharedPreferences). Mismo patrón que BootReceiver. Si el servicio ya corre, onStartCommand es
     * idempotente (no re-abre el watcher). Best-effort: no romper el disparo del watchdog.
     */
    private static void arrancarUploaderSiConfigurado(Context context) {
        SharedPreferences sp;
        try {
            sp = context.getSharedPreferences(UploaderGpsService.PREFS, Context.MODE_PRIVATE);
        } catch (Exception e) { return; }
        if (sp.getString(UploaderGpsService.K_TOKEN, null) == null) return; // nunca se logueó acá

        // 🩸 No arrancar si falta MUCHO para la ventana (05/08/2026). El servicio ahora pausa en vez
        // de apagarse, así que un arranque fuera de hora no se suicida — pero sigue costando un
        // `startForegroundService` contra el límite del SO y un proceso levantado para nada. Se
        // permite dentro de la GRACIA para cubrir el despertar de pre-arranque (el que llega unos
        // minutos antes del borde a propósito, para tener fix a las 08:00:00).
        long ahora = System.currentTimeMillis();
        if (!VentanaRastreo.dentro(sp, ahora)) {
            long ini = VentanaRastreo.proximoInicio(sp, ahora);
            if (ini > 0 && ini - ahora > GRACIA_MS) return;
        }

        try {
            Intent svc = new Intent(context, UploaderGpsService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception e) {
            // 🩸 EL FALLO QUE ERA INVISIBLE (05/08/2026). Esto era `catch (Exception ignored)`.
            //
            // En Android 12+ arrancar un foreground service desde background tira
            // ForegroundServiceStartNotAllowedException salvo exenciones — y una alarma INEXACTA no
            // es exención (una exacta sí, y estar exento de la optimización de batería también). O
            // sea que el caso peor del bug ("no arrancó en TODO el día hasta que abrieron la app")
            // era exactamente el que no dejaba ni una línea de rastro.
            //
            // Se cuenta aparte del resto de las excepciones: un fallo de arranque por política del SO
            // y un error cualquiera piden arreglos distintos. Ver estado_dispositivo.fgs_bloqueado.
            // Se compara el NOMBRE de la clase y no con `instanceof`: minSdk es 23 y
            // ForegroundServiceStartNotAllowedException no existe hasta API 31. Un `instanceof`
            // contra una clase ausente deja el método con fallo de verificación en ART — funciona
            // casi siempre, pero "casi siempre" dentro del `catch` que existe para diagnosticar una
            // falla rara es exactamente donde no se quiere apostar.
            if ("ForegroundServiceStartNotAllowedException".equals(e.getClass().getSimpleName())) {
                UploaderGpsService.anotarFgsBloqueado(context);
            }
        }
    }

    /** Cuánto antes del borde se acepta arrancar el servicio (cubre el despertar de pre-arranque). */
    private static final long GRACIA_MS = 10 * 60_000L;
}
