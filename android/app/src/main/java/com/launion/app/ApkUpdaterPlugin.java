package com.launion.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Updater del APK NATIVO. Descarga un .apk (hosteado en un GitHub Release) y lanza el instalador
 * del sistema. Es el complemento de la OTA de Capgo: la OTA cambia solo el bundle web, esto sirve
 * cuando cambió algo NATIVO (plugin, permiso, código Java) y hay que reinstalar el .apk.
 *
 * NO es una instalación silenciosa: Android SIEMPRE muestra su diálogo "¿Instalar?" para un APK
 * de fuera de Play Store. Esto elimina el paso manual de pasar el archivo, no el toque de confirmar.
 *
 * Lo dispara el JS (services/apkUpdate.js) solo cuando la versión instalada quedó por debajo de
 * `app_config.min_version`. Requiere el permiso REQUEST_INSTALL_PACKAGES (manifest) y el FileProvider
 * ya declarado (authority `${applicationId}.fileprovider`).
 *
 * Expone:
 *  - descargarEInstalar({ url, version }): descarga y lanza el instalador.
 *      → resuelve { installed: true }           si arrancó el instalador
 *      → resuelve { needsPermission: true }      si falta el permiso (ya abrió Ajustes; reintentar)
 *      → rechaza                                 si falló la descarga
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    @PluginMethod
    public void descargarEInstalar(PluginCall call) {
        final String url = call.getString("url");
        final String version = call.getString("version", "nueva");
        if (url == null || url.isEmpty()) {
            call.reject("Falta la URL del APK.");
            return;
        }

        // Gate de permiso (API 26+): sin "instalar apps desconocidas" el instalador ni siquiera abre.
        // Se chequea ANTES de bajar decenas de MB al pedo. Abrimos Ajustes y avisamos al JS para que
        // el usuario lo active y reintente. En API < 26 era un toggle global; el instalador ya lo pedía.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            boolean puede = getContext().getPackageManager().canRequestPackageInstalls();
            if (!puede) {
                try {
                    Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(i);
                } catch (Exception ignored) {}
                JSObject ret = new JSObject();
                ret.put("needsPermission", true);
                call.resolve(ret);
                return;
            }
        }

        // La descarga es de red: fuera del hilo principal (NetworkOnMainThreadException). Resolver el
        // PluginCall desde el hilo de fondo es válido en Capacitor.
        new Thread(() -> {
            try {
                File apk = descargar(url, version);
                lanzarInstalador(apk);
                JSObject ret = new JSObject();
                ret.put("installed", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("No se pudo actualizar: " + e.getMessage(), e);
            }
        }).start();
    }

    /** Baja el .apk a getExternalFilesDir/updates/. Sigue redirects (GitHub Releases redirige el
     *  asset a objects.githubusercontent.com; https→https se sigue solo). Limpia .apk viejos. */
    private File descargar(String url, String version) throws Exception {
        File dir = new File(getContext().getExternalFilesDir(null), "updates");
        if (!dir.exists()) dir.mkdirs();
        // No acumular instaladores viejos ocupando almacenamiento.
        File[] previos = dir.listFiles();
        if (previos != null) for (File f : previos) { if (f.getName().endsWith(".apk")) f.delete(); }

        File destino = new File(dir, "app-" + version + ".apk");
        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        try {
            con.setInstanceFollowRedirects(true);
            con.setConnectTimeout(20000);
            con.setReadTimeout(60000);
            con.connect();
            int code = con.getResponseCode();
            if (code < 200 || code >= 300) throw new Exception("HTTP " + code);
            try (InputStream in = con.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                out.flush();
            }
        } finally {
            con.disconnect();
        }
        if (destino.length() <= 0) throw new Exception("descarga vacía");
        return destino;
    }

    /** Lanza el instalador del sistema con el .apk vía FileProvider (content:// URI + permiso de lectura). */
    private void lanzarInstalador(File apk) {
        Context ctx = getContext();
        Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        Activity act = getActivity();
        if (act != null) act.startActivity(intent);
        else ctx.startActivity(intent);
    }
}
