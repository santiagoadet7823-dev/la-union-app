package com.launion.app;

import androidx.annotation.NonNull;
import com.google.firebase.messaging.RemoteMessage;
import com.capacitorjs.plugins.pushnotifications.MessagingService;

/**
 * Servicio FCM propio (Tarea A, 24/07/2026). REEMPLAZA al del plugin en el manifest merge (el del
 * `app` gana sobre el de la librería) PERO **extiende de él y llama a super**, así el push en primer
 * plano (`PushNotificationsPlugin.sendRemoteMessage`) y la captura de token (`onNewToken`) siguen
 * funcionando EXACTAMENTE igual. Lo que suma es trabajo NATIVO al recibir el ping del watchdog, que
 * corre aunque el WebView esté congelado (Doze) — que es justo cuando el reenvío al JS no alcanza.
 *
 * DECISIÓN DE DISEÑO (A.3 de GUIA_PUSH_NATIVO_Y_VERSIONES.md): NO se intenta re-armar el GPS desde
 * nativo (Opción 1) — el plugin de background-geolocation no expone un re-arranque verificado sin
 * abrir la Activity, y Android 12+ bloquea abrir Activity desde background: hacerlo a ciegas podía
 * romper el pipeline. En su lugar se engancha el push a la MISMA cadena de AlarmManager que ya está
 * probada (AlarmWatchdogPlugin): re-armar la próxima alarma + despertar al JS si hay WebView. Así los
 * dos canales (push online / alarma offline) quedan convergentes y el wake chain es más robusto,
 * SIN tocar el GPS. Techo honesto (igual que el resto): no revive un force-stop ni vence OEM killers;
 * mejora el caso "kill suave / Doze".
 *
 * VERIFICAR EN DISPOSITIVO (teléfono de pruebas): (1) el push sigue llegando en primer plano;
 * (2) el token FCM se sigue capturando (estado_dispositivo.fcm_token); (3) con la app minimizada,
 * disparar la función y ver en logcat que entra onMessageReceived; (4) que NO haya doble entrega
 * (si la hubiera, ver nota de tools:node="remove" en el manifest).
 */
public class LaUnionMessagingService extends MessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        // Preserva TODO lo del plugin: reenvío al JS en foreground + notificación. NO quitar.
        super.onMessageReceived(msg);

        // Trabajo nativo del watchdog: corre aunque el WebView esté congelado. Reusa la cadena probada.
        String tipo = msg.getData() != null ? msg.getData().get("tipo") : null;
        if ("watchdog".equals(tipo)) {
            try {
                // Re-armar la alarma offline: si el proceso fue revivido por FCM, mantiene vivo el
                // canal sin internet para el próximo ciclo. Usa la ventana/intervalo ya configurados.
                AlarmWatchdogPlugin.programarProxima(getApplicationContext());
            } catch (Exception ignored) { /* best-effort: nunca tumbar el push */ }
            try {
                // Despierta al JS si hay WebView vivo (refresca latido / destapa colas). No-op si no.
                AlarmWatchdogPlugin.despertar();
            } catch (Exception ignored) {}
        }
    }
}
