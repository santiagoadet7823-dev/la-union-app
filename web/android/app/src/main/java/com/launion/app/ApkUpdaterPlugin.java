package com.launion.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;

import androidx.core.content.FileProvider;

import java.io.FileInputStream;

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
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Updater del APK NATIVO. Descarga un .apk (hosteado en un GitHub Release) y lanza el instalador
 * del sistema. Es el complemento de la OTA de Capgo: la OTA cambia solo el bundle web, esto sirve
 * cuando cambió algo NATIVO (plugin, permiso, código Java) y hay que reinstalar el .apk.
 *
 * Desde el 08/08/2026 instala SIN TOQUES en Android 12+ (PackageInstaller con
 * `USER_ACTION_NOT_REQUIRED`), con la salvedad de la primera vez que explica
 * `instalarConPackageInstaller`. En Android 11 y anteriores sigue el camino de siempre, que muestra
 * el diálogo "¿Instalar?" del sistema.
 *
 * Lo dispara el JS (services/apkUpdate.js) solo cuando la versión instalada quedó por debajo de
 * `app_config.min_version`. Requiere el permiso REQUEST_INSTALL_PACKAGES (manifest) y el FileProvider
 * ya declarado (authority `${applicationId}.fileprovider`).
 *
 * Expone:
 *  - descargarEInstalar({ url, version }): descarga y lanza el instalador.
 *      → resuelve { installed: true }           si arrancó el instalador
 *      → resuelve { needsPermission: true }      si falta el permiso (ya abrió Ajustes; reintentar)
 *      → resuelve { enCurso: true }              si YA hay una descarga andando (ver abajo)
 *      → rechaza                                 si falló la descarga (o se canceló)
 *  - cancelar(): corta la descarga en curso; el `descargarEInstalar` pendiente rechaza.
 *  - evento "progreso" { bytes, total, pct, fin?, error? } mientras baja.
 *
 * 🩸 UNA SOLA DESCARGA A LA VEZ (16/09/2026). Hasta hoy cada llamada arrancaba su propio hilo
 * sobre el MISMO archivo: el cartel al abrir la app y el watchdog cada 6 h podían pisarse, y un
 * teléfono con mala señal reabría la app varias veces mientras la descarga anterior seguía viva
 * — "carga y carga como en un bucle" (Gabriel, 16/09), con 22 MB de datos móviles por cada
 * intento. Ahora la segunda llamada devuelve `{ enCurso: true }` y el JS se cuelga del evento
 * de progreso de la que ya está andando.
 */
@CapacitorPlugin(name = "ApkUpdater")
public class ApkUpdaterPlugin extends Plugin {

    private static final String TAG = "ApkUpdater";

    /** Hay una descarga andando (por proceso: un solo WebView, un solo plugin). */
    private static final AtomicBoolean descargando = new AtomicBoolean(false);
    /** Pedido de cancelación de la descarga en curso; lo mira el bucle de lectura. */
    private static final AtomicBoolean cancelada = new AtomicBoolean(false);

    @PluginMethod
    public void cancelar(PluginCall call) {
        cancelada.set(descargando.get());
        JSObject ret = new JSObject();
        ret.put("cancelada", cancelada.get());
        call.resolve(ret);
    }

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

        // Si ya hay una bajando, no se arranca otra: el JS se engancha al progreso de ésa.
        if (!descargando.compareAndSet(false, true)) {
            JSObject ret = new JSObject();
            ret.put("enCurso", true);
            call.resolve(ret);
            return;
        }
        cancelada.set(false);

        // La descarga es de red: fuera del hilo principal (NetworkOnMainThreadException). Resolver el
        // PluginCall desde el hilo de fondo es válido en Capacitor.
        new Thread(() -> {
            try {
                File apk = descargar(url, version);
                emitirProgreso(apk.length(), apk.length(), true, null);
                lanzarInstalador(apk);
                JSObject ret = new JSObject();
                ret.put("installed", true);
                call.resolve(ret);
            } catch (Exception e) {
                emitirProgreso(0, 0, true, e.getMessage());
                call.reject("No se pudo actualizar: " + e.getMessage(), e);
            } finally {
                descargando.set(false);
            }
        }).start();
    }

    /** Evento "progreso" para el cartel. `fin` marca el último (con `error` si terminó mal). */
    private void emitirProgreso(long bytes, long total, boolean fin, String error) {
        JSObject ev = new JSObject();
        ev.put("bytes", bytes);
        ev.put("total", total);
        ev.put("pct", total > 0 ? (int) (bytes * 100 / total) : -1);
        ev.put("fin", fin);
        if (error != null) ev.put("error", error);
        notifyListeners("progreso", ev);
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
            // Content-Length del asset (GitHub lo manda); -1 si no viene → barra indeterminada.
            long total = con.getContentLengthLong();
            long bytes = 0;
            long ultimoAviso = 0;
            try (InputStream in = con.getInputStream(); OutputStream out = new FileOutputStream(destino)) {
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancelada.get()) throw new Exception("descarga cancelada");
                    out.write(buf, 0, n);
                    bytes += n;
                    // Cada ~250 ms alcanza para una barra; cada 8 KB serían miles de cruces del bridge.
                    long ahora = System.currentTimeMillis();
                    if (ahora - ultimoAviso >= 250) {
                        ultimoAviso = ahora;
                        emitirProgreso(bytes, total, false, null);
                    }
                }
                out.flush();
            } catch (Exception e) {
                // Un .apk a medias no sirve para nada y ocupa 20 MB: se borra acá, no en el próximo
                // intento (que puede no llegar nunca si la persona desiste).
                destino.delete();
                throw e;
            }
        } finally {
            con.disconnect();
        }
        if (destino.length() <= 0) throw new Exception("descarga vacía");
        return destino;
    }

    /**
     * Instala el .apk. Intenta primero el camino SIN TOQUES y cae al instalador clásico si no se
     * puede — nunca deja al equipo sin forma de actualizarse.
     */
    private void lanzarInstalador(File apk) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                instalarConPackageInstaller(apk);
                return;
            } catch (Exception e) {
                // Cualquier cosa que salga mal acá (sesión que no abre, disco lleno, un OEM que lo
                // bloquea) NO puede dejar el teléfono sin actualizar: se cae al camino de siempre.
                Log.w(TAG, "PackageInstaller falló, uso el instalador clásico", e);
            }
        }
        instalarConIntent(apk);
    }

    /**
     * 🩸 ACTUALIZACIÓN SIN TOQUES (08/08/2026). Hasta hoy, cada versión nueva costaba 3-4 toques de
     * cada vendedor —y 6-7 la primera vez, con la vuelta por Ajustes— multiplicado por nueve
     * teléfonos que están en la calle. La consecuencia práctica no era la molestia: era que el parque
     * quedaba partido en dos versiones durante días, que es como se llega a un bug que solo le pasa
     * a tres personas.
     *
     * Android 12+ (API 31) permite que una app se reinstale A SÍ MISMA sin diálogo, con
     * `setRequireUserAction(USER_ACTION_NOT_REQUIRED)`. No es una API privilegiada ni necesita
     * Device Owner: es exactamente el caso de uso para el que se agregó.
     *
     * ⚠️ EL PERMISO NO ALCANZA, Y ESTO HAY QUE SABERLO ANTES DE PROBARLO. El sistema concede el modo
     * silencioso solo si la app es su PROPIO instalador de registro. Los 9 teléfonos del parque se
     * instalaron por `adb`, que deja `getInstallSourceInfo().getInstallingPackageName()` en null, así
     * que la PRIMERA actualización va a mostrar el diálogo igual (el receiver lo abre solo, ver
     * InstalacionReceiver). Esa primera instalación es la que nos convierte en el instalador, y de
     * ahí en adelante ya no pregunta nunca más. Se puede saltear ese paso empujando el APK bootstrap
     * por `adb` sobre Tailscale, sin que nadie toque el teléfono.
     *
     * El PendingIntent va MUTABLE a propósito: el instalador le agrega los extras del resultado
     * (`EXTRA_STATUS`, y el `EXTRA_INTENT` del diálogo cuando hace falta confirmar). Con
     * FLAG_IMMUTABLE el broadcast llega vacío y el diálogo no se puede abrir nunca — el mismo tipo
     * de trampa que documenta la regla 16 para MovimientoPlugin.
     */
    private void instalarConPackageInstaller(File apk) throws Exception {
        Context ctx = getContext();
        PackageInstaller installer = ctx.getPackageManager().getPackageInstaller();

        PackageInstaller.SessionParams params =
            new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(ctx.getPackageName());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
        }

        int sessionId = installer.createSession(params);
        try (PackageInstaller.Session session = installer.openSession(sessionId)) {
            // Se pasa el LARGO real del archivo y no -1: con -1 el instalador no puede reservar
            // espacio por adelantado y un teléfono al límite falla recién a mitad de la copia.
            try (OutputStream out = session.openWrite("app", 0, apk.length());
                 InputStream in = new FileInputStream(apk)) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                session.fsync(out);
            }

            Intent intent = new Intent(ctx, InstalacionReceiver.class);
            PendingIntent pi = PendingIntent.getBroadcast(
                ctx, sessionId, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
            session.commit(pi.getIntentSender());
        }
    }

    /** Instalador del sistema vía FileProvider (content:// URI + permiso de lectura). El camino de
     *  siempre: siempre pide confirmar. Queda como reserva para Android 11 y anteriores. */
    private void instalarConIntent(File apk) {
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
