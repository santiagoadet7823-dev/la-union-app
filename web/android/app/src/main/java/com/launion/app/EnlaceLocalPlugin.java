package com.launion.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.net.wifi.SoftApConfiguration;
import android.net.wifi.WifiConfiguration;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.util.Base64;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PermissionState;

import java.io.File;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/**
 * LADO CELULAR de la vidriera: levanta un hotspot LOCAL y sirve el catálogo a la tablet del cliente.
 *
 * 🩸 POR QUÉ `LocalOnlyHotspot` Y NO BLUETOOTH NI WIFI DIRECT. El requisito del cliente es que la
 * tablet **no consuma datos**, porque los paga él. Eso no se cumple "usando poco": se cumple con un
 * enlace que no tiene por dónde salir. `startLocalOnlyHotspot()` crea una red WiFi **sin backhaul a
 * internet** — aunque la tablet quisiera gastar datos, no puede. Es la única de las tres opciones
 * donde el cero es demostrable y no una promesa.
 *
 * Los otros dos motivos, medidos y no intuidos:
 *  · **Ancho de banda.** El catálogo son ~13 MB de fotos (626 × 20 KB de promedio). Por WiFi son
 *    segundos; por RFCOMM (~100-300 kbps reales) son minutos, con el cliente esperando.
 *  · **La MAC ya no se puede leer.** Desde Android 6 `BluetoothAdapter.getAddress()` devuelve
 *    `02:00:00:00:00:00`, así que el QR ni siquiera podría llevar la dirección a la que conectarse.
 *
 * ⚠️ **EL RASTREO NO SE TOCA.** La radio WiFi pasa a modo AP; los datos móviles siguen por la radio
 * celular, así que `UploaderGpsService` sigue subiendo posiciones durante toda la visita. Este
 * plugin no comparte una línea con el GPS y no debe empezar a compartirla: es un accesorio, y el
 * rastreo es el producto.
 *
 * ⚠️ Y SE APAGA CON LA VISITA. Un AP encendido toda la jornada es batería que el teléfono no tiene
 * (ya vive al límite con el GPS). `detener()` lo llama el JS al cerrar la visita, y `handleOnDestroy`
 * es la red por si la app muere antes.
 *
 * Expone:
 *  · `iniciar()`                  → { ssid, clave, ip, puerto, token }
 *  · `publicarCatalogo({ json })` → el snapshot que verá la tablet (ya filtrado por el JS)
 *  · `emitir({ json })`           → evento celular → tablet
 *  · `detener()`                  → baja servidor y hotspot
 *  · `estado()`                   → { activo, ... }
 *
 * Eventos al JS: `toque` (la tablet tocó algo) y `enlaceCaido` (el sistema cerró el hotspot solo).
 */
/**
 * 🩸 `NEARBY_WIFI_DEVICES` ES DE RUNTIME Y HAY QUE PEDIRLO (19/08/2026). Estaba declarado en el
 * manifest con un comentario mío que decía que era "normal, se declara y no se pide": **falso**.
 * Desde Android 13 (API 33) `startLocalOnlyHotspot()` lo exige concedido, y sin él tira
 * `SecurityException`. Medido en un motorola con API 34: `granted=false` y el vendedor veía
 * "Android bloqueó la creación de la red", que hacía pensar en el teléfono o en la falta de chip de
 * datos — cuando el problema era esto.
 *
 * Se pide con el alias, no con el string, porque `NEARBY_WIFI_DEVICES` no existe por debajo de API
 * 33: Capacitor resuelve el alias por versión y en un Android viejo no pide nada.
 */
@CapacitorPlugin(
    name = "EnlaceLocal",
    permissions = {
        @Permission(alias = EnlaceLocalPlugin.WIFI_CERCANO, strings = { Manifest.permission.NEARBY_WIFI_DEVICES })
    }
)
public class EnlaceLocalPlugin extends Plugin {

    static final String WIFI_CERCANO = "wifiCercano";

    private static final String TAG = "EnlaceLocal";

    /** Carpeta del espejo de fotos. Es un CONTRATO con `services/data/espejoFotos.js`: misma ruta. */
    private static final String CARPETA_ESPEJO = "espejo";

    /** Reintentos para que la interfaz del AP termine de tomar su IP. */
    private static final int INTENTOS_IP = 20;
    private static final long ESPERA_IP_MS = 150;

    private HandlerThread hiloFondo;
    private WifiManager.LocalOnlyHotspotReservation reserva;
    private ServidorLocal servidor;
    private String ssid, clave, ip, token;
    private int puerto;

    // ------------------------------------------------------------------ API al JS

    @PluginMethod
    public void iniciar(final PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("Este teléfono es muy viejo para la vidriera (necesita Android 8 o más).");
            return;
        }
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            // No se pide acá a propósito: el permiso de ubicación de esta app lo gobierna el GpsGate,
            // que ya explica para qué es. Pedirlo desde otra pantalla, con otro motivo, es la forma
            // más rápida de que alguien lo rechace para siempre.
            call.reject("Falta el permiso de ubicación, que es el que Android exige para crear la red.");
            return;
        }
        if (reserva != null) { call.resolve(datos()); return; }

        // Android 13+ exige NEARBY_WIFI_DEVICES para crear la red. Si falta, se pide y se sigue en
        // `trasPermiso` con la MISMA llamada: el JS no se entera de que hubo un desvío.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState(WIFI_CERCANO) != PermissionState.GRANTED) {
            requestPermissionForAlias(WIFI_CERCANO, call, "trasPermiso");
            return;
        }

        levantar(call);
    }

    @PermissionCallback
    private void trasPermiso(PluginCall call) {
        if (getPermissionState(WIFI_CERCANO) != PermissionState.GRANTED) {
            call.reject("Sin el permiso de \"dispositivos WiFi cercanos\" Android no deja crear la red para la tablet.");
            return;
        }
        levantar(call);
    }

    /** Levanta el hotspot y el servidor. Ya con permisos verificados. */
    private void levantar(final PluginCall call) {
        WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wifi == null) { call.reject("Este teléfono no expone el WiFi."); return; }

        try {
            wifi.startLocalOnlyHotspot(new WifiManager.LocalOnlyHotspotCallback() {
                @Override
                public void onStarted(WifiManager.LocalOnlyHotspotReservation res) {
                    reserva = res;
                    try {
                        leerCredenciales(res);
                        InetAddress dir = esperarIpDelHotspot();
                        if (dir == null) {
                            detenerTodo();
                            call.reject("La red se creó pero no tomó dirección. Probá de nuevo.");
                            return;
                        }
                        ip = dir.getHostAddress();
                        token = nuevoToken();
                        File carpeta = new File(getContext().getFilesDir(), CARPETA_ESPEJO);
                        servidor = new ServidorLocal(carpeta, new ServidorLocal.Escucha() {
                            @Override public void alRecibirToque(String json) {
                                JSObject ev = new JSObject();
                                ev.put("json", json);
                                notifyListeners("toque", ev);
                            }
                        });
                        puerto = servidor.arrancar(dir, token);
                        Log.i(TAG, "Vidriera arriba en " + ip + ":" + puerto);
                        call.resolve(datos());
                    } catch (Exception e) {
                        detenerTodo();
                        call.reject("No se pudo levantar la vidriera: " + e.getMessage(), e);
                    }
                }

                @Override
                public void onStopped() {
                    // El sistema la cerró solo (el usuario prendió el WiFi, entró una llamada, etc.).
                    Log.w(TAG, "El sistema cerró el hotspot.");
                    detenerTodo();
                    notifyListeners("enlaceCaido", new JSObject());
                }

                @Override
                public void onFailed(int motivo) {
                    reserva = null;
                    call.reject(explicar(motivo));
                }
            }, handlerDeFondo());
        } catch (IllegalStateException e) {
            // Android tira esto si ya hay una reserva viva de esta app (típico tras un reinicio del
            // WebView que dejó el nativo en pie).
            call.reject("Ya hay una vidriera abierta en este teléfono. Cerrala y volvé a intentar.", e);
        } catch (SecurityException e) {
            call.reject("Android bloqueó la creación de la red. Revisá que la ubicación esté encendida.", e);
        }
    }

    @PluginMethod
    public void publicarCatalogo(PluginCall call) {
        if (servidor == null) { call.reject("La vidriera no está abierta."); return; }
        servidor.publicarCatalogo(call.getString("json"));
        call.resolve();
    }

    @PluginMethod
    public void emitir(PluginCall call) {
        if (servidor == null) { call.reject("La vidriera no está abierta."); return; }
        servidor.emitir(call.getString("json"));
        call.resolve();
    }

    @PluginMethod
    public void detener(PluginCall call) {
        detenerTodo();
        call.resolve();
    }

    @PluginMethod
    public void estado(PluginCall call) {
        JSObject r = new JSObject();
        r.put("activo", servidor != null && servidor.estaVivo());
        r.put("soportado", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O);
        if (servidor != null && servidor.estaVivo()) {
            r.put("ip", ip);
            r.put("puerto", puerto);
        }
        call.resolve(r);
    }

    /**
     * Red de contención: si el WebView muere con la vidriera abierta, el hotspot se apagaría solo
     * al morir el proceso — pero la app tiene un foreground service que lo mantiene vivo, así que
     * podría quedar encendido gastando batería sin nadie mirando.
     */
    @Override
    protected void handleOnDestroy() {
        detenerTodo();
        super.handleOnDestroy();
    }

    // ------------------------------------------------------------------ interna

    private JSObject datos() {
        JSObject r = new JSObject();
        r.put("ssid", ssid);
        r.put("clave", clave);
        r.put("ip", ip);
        r.put("puerto", puerto);
        r.put("token", token);
        return r;
    }

    /**
     * 🩸 El callback de `startLocalOnlyHotspot` corre en el hilo del Handler que se le pase, y acá
     * adentro se espera a que la interfaz del AP tome su IP: hasta 3 segundos de `Thread.sleep`.
     * Con el Looper principal eso es la pantalla congelada justo cuando el vendedor le está pasando
     * la tablet al cliente. Va en un hilo propio, que además se reusa entre sesiones.
     */
    private synchronized Handler handlerDeFondo() {
        if (hiloFondo == null) {
            hiloFondo = new HandlerThread("vidriera-hotspot");
            hiloFondo.start();
        }
        return new Handler(hiloFondo.getLooper());
    }

    private synchronized void detenerTodo() {
        if (servidor != null) { servidor.parar(); servidor = null; }
        if (reserva != null) {
            try { reserva.close(); } catch (Exception ignored) { }
            reserva = null;
        }
        ssid = clave = ip = token = null;
        puerto = 0;
    }

    /** El SSID y la clave los genera Android, no nosotros: cambian en cada sesión y no se repiten. */
    private void leerCredenciales(WifiManager.LocalOnlyHotspotReservation res) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            SoftApConfiguration cfg = res.getSoftApConfiguration();
            ssid = cfg.getSsid();
            clave = cfg.getPassphrase();
        } else {
            // API 26-29: la clase vieja. Está deprecada pero es la única que existe acá, y el SSID
            // viene entre comillas.
            WifiConfiguration cfg = res.getWifiConfiguration();
            if (cfg != null) {
                ssid = cfg.SSID != null ? cfg.SSID.replaceAll("^\"|\"$", "") : null;
                clave = cfg.preSharedKey != null ? cfg.preSharedKey.replaceAll("^\"|\"$", "") : null;
            }
        }
    }

    /**
     * La IP de la interfaz del AP. No está disponible en el mismo instante en que `onStarted`
     * dispara —la interfaz todavía está levantándose—, así que se reintenta unos milisegundos.
     *
     * Se prefieren los nombres típicos del AP (`ap0`, `swlan0`, `wlan1`) y recién después cualquier
     * IPv4 privada. El orden importa: si el teléfono quedara además en una red WiFi, tomar la
     * primera IPv4 que aparezca podría atar el servidor a la red equivocada.
     */
    private InetAddress esperarIpDelHotspot() {
        for (int i = 0; i < INTENTOS_IP; i++) {
            InetAddress preferida = buscarIp(true);
            if (preferida != null) return preferida;
            InetAddress cualquiera = buscarIp(false);
            if (cualquiera != null) return cualquiera;
            try { Thread.sleep(ESPERA_IP_MS); } catch (InterruptedException e) { Thread.currentThread().interrupt(); return null; }
        }
        return null;
    }

    private InetAddress buscarIp(boolean soloNombresDeAp) {
        try {
            List<NetworkInterface> ifaces = Collections.list(NetworkInterface.getNetworkInterfaces());
            for (NetworkInterface ni : ifaces) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                String n = ni.getName() == null ? "" : ni.getName().toLowerCase();
                boolean pintaDeAp = n.startsWith("ap") || n.startsWith("swlan") || n.equals("wlan1");
                if (soloNombresDeAp && !pintaDeAp) continue;
                Enumeration<InetAddress> dirs = ni.getInetAddresses();
                while (dirs.hasMoreElements()) {
                    InetAddress a = dirs.nextElement();
                    if (a instanceof Inet4Address && !a.isLoopbackAddress() && a.isSiteLocalAddress()) return a;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "No se pudieron listar las interfaces: " + e.getMessage());
        }
        return null;
    }

    /**
     * Token de sesión: 16 bytes de `SecureRandom` en base64url, o sea **22 caracteres**.
     *
     * 🩸 Eran 32 bytes en hexadecimal (64 caracteres) hasta el 19/08/2026, y se achicó por una razón
     * de campo: el token es más de la mitad del QR, y un QR largo necesita módulos más chicos — que
     * es justo lo que la cámara sin autofoco de la tablet no resuelve. El cliente reportó fallas de
     * escaneo y ésta era nuestra mitad del problema.
     *
     * 128 bits siguen siendo de sobra: la sesión vive lo que dura una visita, sobre una red local
     * sin salida a internet, y el servidor compara en tiempo constante. Adivinarlo no es una
     * amenaza realista; que no se pueda escanear, sí lo era.
     *
     * Sin relleno ni caracteres raros: `+` y `/` tendrían que ir escapados en la URL de cada pedido.
     */
    private static String nuevoToken() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    /**
     * Los motivos de `onFailed` traducidos. No es cosmético: son los cuatro finales posibles de la
     * prueba de campo, y "no se pudo" a secas obligaría a repetirla con un cable puesto.
     */
    private static String explicar(int motivo) {
        switch (motivo) {
            case WifiManager.LocalOnlyHotspotCallback.ERROR_NO_CHANNEL:
                return "No hay canal de WiFi libre. Apagá la conexión a WiFi del teléfono y probá de nuevo.";
            case WifiManager.LocalOnlyHotspotCallback.ERROR_TETHERING_DISALLOWED:
                return "El teléfono tiene bloqueado compartir red. Suele ser una restricción de la línea o del perfil de trabajo.";
            case WifiManager.LocalOnlyHotspotCallback.ERROR_INCOMPATIBLE_MODE:
                return "El WiFi está en un modo que no permite crear la red ahora.";
            default:
                return "Android no pudo crear la red (error " + motivo + ").";
        }
    }
}
