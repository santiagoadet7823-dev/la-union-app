package com.launion.app;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiManager;
import android.net.wifi.WifiNetworkSpecifier;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * LADO TABLET de la vidriera: une la tablet al hotspot del vendedor y le habla al servidor local.
 *
 * 🩸 POR QUÉ EL HTTP LO HACE EL NATIVO Y NO EL JS. La app se sirve desde `https://localhost` dentro
 * del WebView de Capacitor, así que un `fetch('http://192.168.x.x')` es **contenido mixto y el
 * WebView lo bloquea**, pase lo que pase en el manifest. La alternativa sería bajar
 * `MixedContentMode`, o sea debilitar la app entera para siempre por una pantalla. Acá el nativo
 * hace el pedido y le devuelve al JS el texto ya listo.
 *
 * 🩸 Y POR QUÉ HAY DOS CAMINOS PARA UNIRSE A LA RED — medido contra una tablet real el 18/08/2026:
 *
 *   · **API ≤ 28**: `addNetwork` + `enableNetwork`. Funciona **y sin diálogo del sistema**. Desde
 *     Android 6 una app solo puede tocar las redes que ella misma creó, que es exactamente este caso.
 *   · **API ≥ 29**: Android **quitó** eso. Va `WifiNetworkSpecifier`, que muestra una confirmación
 *     del sistema la primera vez.
 *
 * O sea que **el equipo viejo tiene la mejor experiencia de las dos**, al revés de lo que parece.
 * La tablet de prueba (`Cidea CM915`) dice ser Android 13 y es API 28: no alcanza con leer la
 * versión, hay que ramificar por `Build.VERSION.SDK_INT`, que es lo que el framework realmente usa.
 *
 * ⚠️ `bindProcessToNetwork` NO es opcional. La red del hotspot **no tiene internet**, y Android
 * manda el tráfico de la app por la red "que sí funciona" (los datos móviles, si los hubiera) o
 * directamente lo descarta. Sin el bind, el servidor del vendedor es inalcanzable aunque la tablet
 * figure conectada — y el síntoma es "conecta pero no carga", que se persigue durante horas.
 */
@CapacitorPlugin(name = "EnlaceTablet")
public class EnlaceTabletPlugin extends Plugin {

    private static final String TAG = "EnlaceTablet";
    private static final int ESPERA_RED_MS = 25000;
    private static final int TIMEOUT_MS = 30000;
    /** El long-poll del servidor cuelga 25 s; se le da margen para que no corte justo antes. */
    private static final int TIMEOUT_EVENTOS_MS = 40000;

    private ConnectivityManager cm;
    private ConnectivityManager.NetworkCallback callback;
    private Network red;
    private volatile boolean escuchando = false;
    private ExecutorService hilo;

    // ------------------------------------------------------------------ unión a la red

    @PluginMethod
    public void unirse(final PluginCall call) {
        final String ssid = call.getString("ssid");
        final String clave = call.getString("clave");
        if (ssid == null || clave == null) { call.reject("Faltan los datos de la red."); return; }
        cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) { call.reject("Este equipo no expone la red."); return; }

        ejecutor().execute(new Runnable() {
            @Override public void run() {
                try {
                    boolean ok = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                            ? unirseModerno(ssid, clave)
                            : unirseLegacy(ssid, clave);
                    if (!ok) { call.reject("No se pudo conectar a la red del vendedor."); return; }
                    JSObject r = new JSObject();
                    r.put("conectado", true);
                    r.put("via", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? "specifier" : "legacy");
                    call.resolve(r);
                } catch (Exception e) {
                    Log.e(TAG, "unirse falló", e);
                    call.reject("No se pudo conectar: " + e.getMessage(), e);
                }
            }
        });
    }

    /** API 29+. Muestra una confirmación del sistema la primera vez. */
    private boolean unirseModerno(String ssid, String clave) throws InterruptedException {
        WifiNetworkSpecifier spec = new WifiNetworkSpecifier.Builder()
                .setSsid(ssid).setWpa2Passphrase(clave).build();
        NetworkRequest req = new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                // Se pide EXPLÍCITAMENTE una red SIN internet: el hotspot local no tiene salida, y
                // sin esta línea Android la descarta por "no válida" a los pocos segundos.
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(spec)
                .build();
        final CountDownLatch listo = new CountDownLatch(1);
        soltarCallback();
        callback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) { red = n; listo.countDown(); }
            @Override public void onUnavailable() { listo.countDown(); }
        };
        cm.requestNetwork(req, callback);
        listo.await(ESPERA_RED_MS, TimeUnit.MILLISECONDS);
        return atar();
    }

    /** API ≤ 28. La API vieja: sigue existiendo y no pide confirmación. */
    @SuppressWarnings("deprecation")
    private boolean unirseLegacy(String ssid, String clave) throws InterruptedException {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) return false;
        if (!wifi.isWifiEnabled()) wifi.setWifiEnabled(true);

        WifiConfiguration cfg = new WifiConfiguration();
        // Las comillas son parte del formato, no un descuido: sin ellas el SSID no matchea nunca.
        cfg.SSID = "\"" + ssid + "\"";
        cfg.preSharedKey = "\"" + clave + "\"";
        cfg.allowedKeyManagement.set(WifiConfiguration.KeyMgmt.WPA_PSK);

        int id = wifi.addNetwork(cfg);
        if (id == -1) {
            // Ya existía de una sesión anterior: se reusa en vez de fallar. El SSID del
            // LocalOnlyHotspot cambia en cada sesión, así que esto es raro pero pasa al reintentar.
            for (WifiConfiguration c : wifi.getConfiguredNetworks()) {
                if (cfg.SSID.equals(c.SSID)) { id = c.networkId; break; }
            }
        }
        if (id == -1) return false;

        // Registrar el callback ANTES de conectar: si se registra después, el evento de "ya está
        // conectada" puede haber pasado y quedaríamos esperando una red que ya llegó.
        final CountDownLatch listo = new CountDownLatch(1);
        soltarCallback();
        callback = new ConnectivityManager.NetworkCallback() {
            @Override public void onAvailable(Network n) { red = n; listo.countDown(); }
        };
        cm.registerNetworkCallback(new NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build(), callback);

        wifi.disconnect();
        wifi.enableNetwork(id, true);
        wifi.reconnect();
        listo.await(ESPERA_RED_MS, TimeUnit.MILLISECONDS);
        return atar();
    }

    /** Clava el tráfico de ESTE proceso en la red del hotspot. Ver el ⚠️ del encabezado. */
    private boolean atar() {
        if (red == null) return false;
        boolean ok = cm.bindProcessToNetwork(red);
        Log.i(TAG, "bindProcessToNetwork = " + ok);
        return ok;
    }

    @PluginMethod
    public void desconectar(PluginCall call) {
        escuchando = false;
        try { if (cm != null) cm.bindProcessToNetwork(null); } catch (Exception ignored) { }
        soltarCallback();
        red = null;
        call.resolve();
    }

    private void soltarCallback() {
        if (cm != null && callback != null) {
            try { cm.unregisterNetworkCallback(callback); } catch (Exception ignored) { }
        }
        callback = null;
    }

    // ------------------------------------------------------------------ hablarle al servidor

    /** GET de texto (`/catalogo`). Devuelve `{ cuerpo }`. */
    @PluginMethod
    public void pedir(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("Falta la url."); return; }
        ejecutor().execute(new Runnable() {
            @Override public void run() {
                try {
                    JSObject r = new JSObject();
                    r.put("cuerpo", texto(url, TIMEOUT_MS));
                    call.resolve(r);
                } catch (Exception e) { call.reject("No se pudo leer del vendedor: " + e.getMessage(), e); }
            }
        });
    }

    /**
     * Baja una foto y la deja en el caché. Devuelve la RUTA, no los bytes: el JS la muestra con
     * `Capacitor.convertFileSrc`. Mandarla en base64 sería inflar cada imagen un 33 % y meter
     * cientos de strings enormes en el DOM de una tablet de 2 GB.
     */
    @PluginMethod
    public void bajarFoto(final PluginCall call) {
        final String url = call.getString("url");
        final String id = call.getString("id");
        if (url == null || id == null) { call.reject("Faltan url o id."); return; }
        ejecutor().execute(new Runnable() {
            @Override public void run() {
                try {
                    File dir = new File(getContext().getCacheDir(), "vidriera");
                    if (!dir.exists() && !dir.mkdirs()) throw new Exception("no se pudo crear el caché");
                    // El id ya viene validado del lado del servidor, pero acá también se acota: es
                    // una ruta de archivo y no se construye con texto de la red sin mirarlo.
                    if (!id.matches("[A-Za-z0-9_-]{1,64}")) throw new Exception("id inválido");
                    File f = new File(dir, id);
                    byte[] datos = bytes(url);
                    OutputStream os = new FileOutputStream(f);
                    try { os.write(datos); } finally { os.close(); }
                    JSObject r = new JSObject();
                    r.put("ruta", f.getAbsolutePath());
                    call.resolve(r);
                } catch (Exception e) { call.reject("No se pudo bajar la foto: " + e.getMessage(), e); }
            }
        });
    }

    /** POST de JSON (`/toque`). */
    @PluginMethod
    public void enviar(final PluginCall call) {
        final String url = call.getString("url");
        final String cuerpo = call.getString("cuerpo", "{}");
        if (url == null) { call.reject("Falta la url."); return; }
        ejecutor().execute(new Runnable() {
            @Override public void run() {
                try {
                    crudo("POST", url, cuerpo.getBytes("UTF-8"), TIMEOUT_MS);
                    call.resolve();
                } catch (Exception e) {
                    call.reject("No se pudo avisarle al vendedor: " + e.getMessage(), e);
                }
            }
        });
    }

    /**
     * Long-poll de `/eventos`. Se llama UNA vez y queda pidiendo en bucle; cada respuesta se emite
     * al JS como evento `eventos`. Al cortarse el enlace no se grita: se reintenta con una espera,
     * porque una tablet que se alejó unos metros vuelve sola.
     */
    @PluginMethod
    public void escuchar(final PluginCall call) {
        final String base = call.getString("url");
        if (base == null) { call.reject("Falta la url."); return; }
        if (escuchando) { call.resolve(); return; }
        escuchando = true;
        call.resolve();
        ejecutor().execute(new Runnable() {
            @Override public void run() {
                long desde = 0;
                while (escuchando) {
                    try {
                        String cuerpo = texto(base + "&desde=" + desde, TIMEOUT_EVENTOS_MS);
                        JSObject ev = new JSObject();
                        ev.put("json", cuerpo);
                        notifyListeners("eventos", ev);
                        // El `seq` lo lee el JS y nos lo devuelve en la próxima vuelta a través de
                        // `avanzar`; acá alcanza con un parseo mínimo para no depender de él.
                        int i = cuerpo.indexOf("\"seq\":");
                        if (i >= 0) {
                            int j = i + 6, k = j;
                            while (k < cuerpo.length() && Character.isDigit(cuerpo.charAt(k))) k++;
                            if (k > j) desde = Long.parseLong(cuerpo.substring(j, k));
                        }
                    } catch (Exception e) {
                        if (!escuchando) return;
                        try { Thread.sleep(3000); } catch (InterruptedException ie) { return; }
                    }
                }
            }
        });
    }

    // ------------------------------------------------------------------ plomería HTTP

    /**
     * 🩸 EL HTTP VA SOBRE UN SOCKET CRUDO, NO SOBRE `HttpURLConnection` (19/08/2026).
     *
     * Primera prueba con la tablet real: el QR se leía bien y al pedir el catálogo saltaba
     * **"cleartext HTTP traffic to 10.41.149.222 not permitted"**. Desde Android 9 el tráfico sin
     * cifrar está prohibido por defecto para apps que apuntan a API 28+, y esa política la aplican
     * las pilas HTTP del sistema — `HttpURLConnection` incluida. O sea: moví el HTTP del WebView al
     * nativo para escapar del contenido mixto y me olvidé de que acá había otra puerta cerrada.
     *
     * **Por qué no se prende `usesCleartextTraffic` en el manifest**, que es lo que hace casi todo el
     * mundo: esa bandera habilita HTTP sin cifrar en TODA la app y para siempre. Este proyecto manda
     * datos de GPS y de clientes a Supabase; dejar la puerta abierta a nivel de aplicación por una
     * sola pantalla es un precio desproporcionado, y encima invisible.
     *
     * Un `Socket` no pasa por esa política, así que la excepción queda **en esta función**, a la
     * vista, y el resto de la app sigue con el cleartext prohibido. Y no es código exótico: el
     * SERVIDOR del otro lado también está escrito a mano (`ServidorLocal`), con `Content-Length` y
     * `Connection: close` — que es justo lo que hace que el cliente sea simple: se escribe el pedido
     * y se lee hasta el cierre.
     *
     * ⚠️ Esto SOLO vale para el enlace local. Cualquier pedido a internet sigue por donde debe.
     */
    private byte[] crudo(String metodo, String url, byte[] cuerpo, int timeout) throws Exception {
        URL u = new URL(url);
        String host = u.getHost();
        int puerto = u.getPort() > 0 ? u.getPort() : 80;
        String recurso = u.getFile();
        if (recurso == null || recurso.isEmpty()) recurso = "/";

        Socket s = new Socket();
        try {
            s.connect(new InetSocketAddress(host, puerto), 10000);
            s.setSoTimeout(timeout);

            // Los CRLF van por una constante: es lo que separa las cabeceras y equivocarlo deja el
            // pedido colgado esperando el resto para siempre.
            final String FIN = "\r\n";
            StringBuilder cab = new StringBuilder();
            cab.append(metodo).append(' ').append(recurso).append(" HTTP/1.1").append(FIN);
            cab.append("Host: ").append(host).append(':').append(puerto).append(FIN);
            if (cuerpo != null) {
                cab.append("Content-Type: application/json").append(FIN);
                cab.append("Content-Length: ").append(cuerpo.length).append(FIN);
            }
            // Sin keep-alive: el fin de la respuesta ES el cierre de la conexión, así no hay que
            // interpretar Content-Length ni chunked del lado del cliente.
            cab.append("Connection: close").append(FIN).append(FIN);

            OutputStream out = s.getOutputStream();
            out.write(cab.toString().getBytes("UTF-8"));
            if (cuerpo != null) out.write(cuerpo);
            out.flush();

            byte[] todo = leer(s.getInputStream());
            int corte = separador(todo);
            if (corte < 0) throw new Exception("respuesta sin cabeceras");
            String cabecera = new String(todo, 0, corte, "UTF-8");
            int codigo = codigoDe(cabecera);
            if (codigo >= 400) {
                // El 401 es el token: se distingue porque es el único que no se arregla reintentando.
                throw new Exception(codigo == 401
                        ? "el código ya no vale (el vendedor cerró la vidriera)"
                        : ("HTTP " + codigo));
            }
            byte[] body = new byte[todo.length - (corte + 4)];
            System.arraycopy(todo, corte + 4, body, 0, body.length);
            return body;
        } finally {
            try { s.close(); } catch (Exception ignored) { }
        }
    }

    /** Posición de la línea vacía (CRLF CRLF) que separa cabeceras de cuerpo. -1 si no está. */
    private static int separador(byte[] b) {
        for (int i = 0; i + 3 < b.length; i++) {
            if (b[i] == 13 && b[i + 1] == 10 && b[i + 2] == 13 && b[i + 3] == 10) return i;
        }
        return -1;
    }

    /** `HTTP/1.1 200 OK` → 200. Devuelve 0 si la línea no se entiende. */
    private static int codigoDe(String cabecera) {
        try {
            String primera = cabecera.split("\r\n")[0];
            String[] p = primera.split(" ");
            return p.length >= 2 ? Integer.parseInt(p[1].trim()) : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    private String texto(String url, int timeout) throws Exception {
        return new String(crudo("GET", url, null, timeout), "UTF-8");
    }

    private byte[] bytes(String url) throws Exception {
        return crudo("GET", url, null, TIMEOUT_MS);
    }

    private static byte[] leer(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private synchronized ExecutorService ejecutor() {
        if (hilo == null || hilo.isShutdown()) hilo = Executors.newFixedThreadPool(3);
        return hilo;
    }

    @Override
    protected void handleOnDestroy() {
        escuchando = false;
        try { if (cm != null) cm.bindProcessToNetwork(null); } catch (Exception ignored) { }
        soltarCallback();
        if (hilo != null) hilo.shutdownNow();
        super.handleOnDestroy();
    }
}
