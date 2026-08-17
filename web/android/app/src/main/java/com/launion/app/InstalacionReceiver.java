package com.launion.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.util.Log;

/**
 * Recibe el resultado de la instalación lanzada por {@link ApkUpdaterPlugin}.
 *
 * 🩸 VA DECLARADO EN EL MANIFEST, NO REGISTRADO A MANO. Es la regla 17 en su caso más extremo: este
 * receiver espera el resultado de una operación que MATA al proceso que lo registraría — la app se
 * está reinstalando a sí misma. Un receiver dinámico muere con ese proceso y el resultado se pierde
 * en silencio, incluido el caso que más importa (STATUS_PENDING_USER_ACTION).
 *
 * Dos resultados y nada más:
 *
 *  · STATUS_PENDING_USER_ACTION — el sistema NO concedió la instalación silenciosa y quiere
 *    preguntarle al usuario. Pasa siempre en la primera actualización de un equipo instalado por
 *    `adb` (ver ApkUpdaterPlugin) y en cualquier Android anterior al 12. Se lanza el diálogo que
 *    manda el propio sistema, que es exactamente la experiencia que había antes: nada empeora.
 *
 *  · el resto — se registra en el log y se termina. No hay nada que avisarle al usuario: si la
 *    instalación salió bien, la app ya se está reiniciando con la versión nueva; si salió mal, el
 *    JS va a volver a intentar en el próximo chequeo de versión.
 */
public class InstalacionReceiver extends BroadcastReceiver {

    private static final String TAG = "ApkUpdater";

    @Override
    public void onReceive(Context context, Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);

        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirmar = intent.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirmar != null) {
                // FLAG_ACTIVITY_NEW_TASK es obligatorio: un BroadcastReceiver no tiene tarea propia
                // desde la que abrir una Activity.
                confirmar.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirmar);
                } catch (Exception e) {
                    Log.e(TAG, "no se pudo abrir el diálogo de instalación", e);
                }
            }
            return;
        }

        if (status == PackageInstaller.STATUS_SUCCESS) {
            Log.i(TAG, "APK instalado sin intervención del usuario");
        } else {
            Log.w(TAG, "instalación fallida: status=" + status
                + " msg=" + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
        }
    }
}
