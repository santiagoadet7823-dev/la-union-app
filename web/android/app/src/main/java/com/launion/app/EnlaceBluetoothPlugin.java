package com.launion.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothServerSocket;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * EMPAREJAMIENTO POR BLUETOOTH — el camino alternativo al QR.
 *
 * 🩸 QUÉ PASA Y QUÉ NO PASA POR ACÁ. Bluetooth transporta **solo el sobre con los datos de la red**
 * (~120 bytes: SSID, clave, IP, puerto y token). El catálogo y las fotos siguen viajando por WiFi,
 * porque son ~13 MB y RFCOMM tardaría minutos delante de un cliente. O sea: esto reemplaza a la
 * CÁMARA, no al enlace. La decisión de que los datos van por `LocalOnlyHotspot` no se toca (§2 del
 * handoff de la vidriera).
 *
 * **Por qué existe.** En la primera prueba real la cámara de la tablet no enfocaba y el escaneo
 * fallaba. Achicar el QR de 213 a 105 caracteres mejoró mucho eso —confirmado por el cliente—, así
 * que esto dejó de ser necesario y quedó como cómodo: un toque en vez de apuntar. El QR **sigue
 * estando** y sigue siendo el camino por defecto; si Bluetooth falla, no se pierde nada.
 *
 * **El modo práctico**: vincular tablet y celular UNA vez en el depósito. Después
 * `getBondedDevices()` los encuentra al instante y no hace falta descubrir nada. El descubrimiento
 * queda como respaldo, y es el camino lento (hasta 12 s de barrido).
 *
 * ⚠️ **`listenUsingInsecureRfcomm…` — inseguro acá significa SIN PIN**, no "sin cifrar por
 * descuido". Es a propósito: pedirle a un vendedor que compare un número de seis dígitos con el
 * cliente esperando es exactamente la fricción que veníamos a sacar. Lo que viaja es un token que
 * dura lo que dura la visita, en un enlace de pocos metros, y del otro lado hay un servidor que lo
 * compara en tiempo constante. El QR tampoco está firmado y nadie lo discutió: quien puede leer
 * esto podría leer la pantalla.
 *
 * ⚠️ **LOS PERMISOS SE PIDEN, NO SE SUPONEN.** `BLUETOOTH_CONNECT` y `BLUETOOTH_SCAN` son de
 * RUNTIME desde Android 12, igual que `NEARBY_WIFI_DEVICES` desde Android 13 — y ese olvido ya
 * costó dos vueltas en esta misma función, con un comentario en el manifest que afirmaba lo
 * contrario. En la tablet (API 28) alcanzan los normales del manifest más ubicación, que ya tiene,
 * así que Capacitor resuelve los alias por versión y ahí no pide nada.
 */
@CapacitorPlugin(
    name = "EnlaceBluetooth",
    permissions = {
        @Permission(alias = EnlaceBluetoothPlugin.BT_CONECTAR, strings = { Manifest.permission.BLUETOOTH_CONNECT }),
        @Permission(alias = EnlaceBluetoothPlugin.BT_BUSCAR, strings = { Manifest.permission.BLUETOOTH_SCAN })
    }
)
public class EnlaceBluetoothPlugin extends Plugin {

    static final String BT_CONECTAR = "btConectar";
    static final String BT_BUSCAR = "btBuscar";

    private static final String TAG = "EnlaceBT";

    /**
     * UUID propio de la vidriera. No es uno estándar a propósito: así el barrido de la tablet
     * distingue "este teléfono tiene la app con la vidriera abierta" de "este teléfono es un
     * teléfono". Generado una vez y fijo — cambiarlo rompe el pareo entre versiones.
     */
    private static final UUID UUID_VIDRIERA = UUID.fromString("7b1f0a54-2c93-4c2e-9d1a-6f5c4b3a2e10");
    private static final String NOMBRE_SDP = "DisTAt-Vidriera";

    /** Cuánto espera la tablet a que un teléfono conteste antes de pasar al siguiente. */
    private static final int TIMEOUT_LECTURA_MS = 8000;

    private BluetoothServerSocket servidor;
    private volatile boolean publicando = false;
    private String sobre;
    private ExecutorService hilo;

    // ------------------------------------------------------------------ celular (publica)

    /**
     * Deja el sobre de la red disponible por Bluetooth hasta que se llame a `detener()`.
     *
     * Acepta VARIAS conexiones seguidas (no una y chau): si la tablet se queda a mitad de camino y
     * el vendedor vuelve a tocar, tiene que poder de nuevo sin reabrir la vidriera.
     */
    @PluginMethod
    public void publicar(final PluginCall call) {
        final String json = call.getString("sobre");
        if (json == null) { call.reject("Falta el sobre de la red."); return; }
        this.sobre = json;
        if (!pedirConectar(call, "trasPermisoPublicar")) return;
        abrirServidor(call);
    }

    @PermissionCallback
    private void trasPermisoPublicar(PluginCall call) {
        if (getPermissionState(BT_CONECTAR) != PermissionState.GRANTED) {
            call.reject("Sin el permiso de Bluetooth no se puede pasar la red a la tablet. El código QR sigue funcionando.");
            return;
        }
        abrirServidor(call);
    }

    private void abrirServidor(final PluginCall call) {
        BluetoothAdapter ad = adaptador();
        if (ad == null) { call.reject("Este teléfono no tiene Bluetooth."); return; }
        if (!ad.isEnabled()) { call.reject("El Bluetooth está apagado. Prendelo, o usá el código QR."); return; }
        if (publicando) { call.resolve(); return; }

        try {
            servidor = ad.listenUsingInsecureRfcommWithServiceRecord(NOMBRE_SDP, UUID_VIDRIERA);
        } catch (Exception e) {
            call.reject("No se pudo abrir el Bluetooth: " + e.getMessage(), e);
            return;
        }
        publicando = true;
        call.resolve();

        ejecutor().execute(new Runnable() {
            @Override public void run() {
                while (publicando) {
                    BluetoothSocket s = null;
                    try {
                        s = servidor.accept();          // bloquea hasta que alguien se conecta
                        OutputStream out = s.getOutputStream();
                        out.write(sobre.getBytes("UTF-8"));
                        out.flush();
                        // Un respiro antes de cerrar: sin esto el cierre puede cortar el envío en
                        // algunos stacks de Bluetooth y la tablet lee un JSON a medias.
                        try { Thread.sleep(250); } catch (InterruptedException ignored) {}
                        notifyListeners("pareada", new JSObject());
                    } catch (Exception e) {
                        // `accept()` tira cuando se cierra el servidor desde `detener()`: es la
                        // salida normal del bucle, no un error que haya que gritar.
                        if (publicando) Log.w(TAG, "accept falló: " + e.getMessage());
                    } finally {
                        cerrar(s);
                    }
                }
            }
        });
    }

    /** Cierra el servicio Bluetooth. Se llama SIEMPRE al cerrar la vidriera, como el hotspot. */
    @PluginMethod
    public void detener(PluginCall call) {
        publicando = false;
        try { if (servidor != null) servidor.close(); } catch (Exception ignored) {}
        servidor = null;
        sobre = null;
        call.resolve();
    }

    // ------------------------------------------------------------------ tablet (busca)

    /**
     * Busca el sobre en los teléfonos YA VINCULADOS. Devuelve `{ sobre }` o rechaza con un motivo
     * legible.
     *
     * 🩸 Solo vinculados, y es una decisión de producto, no una limitación. Descubrir dispositivos
     * son hasta 12 segundos de barrido, delante de un cliente, con la pantalla diciendo "buscando"
     * — y el resultado depende de que el celular esté visible, que dura 2 minutos. Vincular una vez
     * en el depósito convierte todo eso en un toque. Si no hay ninguno vinculado, el mensaje lo
     * dice y manda al QR, que no depende de nada de esto.
     */
    @PluginMethod
    public void buscar(final PluginCall call) {
        if (!pedirConectar(call, "trasPermisoBuscar")) return;
        leerDeVinculados(call);
    }

    @PermissionCallback
    private void trasPermisoBuscar(PluginCall call) {
        if (getPermissionState(BT_CONECTAR) != PermissionState.GRANTED) {
            call.reject("Sin el permiso de Bluetooth no puedo buscar el celular del vendedor. Probá con el código QR.");
            return;
        }
        leerDeVinculados(call);
    }

    private void leerDeVinculados(final PluginCall call) {
        final BluetoothAdapter ad = adaptador();
        if (ad == null) { call.reject("Esta tablet no tiene Bluetooth."); return; }
        if (!ad.isEnabled()) { call.reject("El Bluetooth de la tablet está apagado."); return; }

        ejecutor().execute(new Runnable() {
            @Override public void run() {
                Set<BluetoothDevice> vinculados;
                try {
                    vinculados = ad.getBondedDevices();
                } catch (SecurityException e) {
                    call.reject("Android no dejó leer los dispositivos vinculados.");
                    return;
                }
                if (vinculados == null || vinculados.isEmpty()) {
                    call.reject("Esta tablet no está vinculada con ningún celular. Vinculalos una vez desde los ajustes de Bluetooth, o usá el código QR.");
                    return;
                }
                // Se prueban TODOS: no se puede saber cuál es el del vendedor sin intentar, y el que
                // no tenga la vidriera abierta rechaza la conexión enseguida.
                for (BluetoothDevice d : vinculados) {
                    String texto = intentar(ad, d);
                    if (texto != null) {
                        JSObject r = new JSObject();
                        r.put("sobre", texto);
                        r.put("via", "vinculado");
                        call.resolve(r);
                        return;
                    }
                }
                call.reject("Ninguno de los celulares vinculados tiene la vidriera abierta. Abrila en el celular del vendedor y probá de nuevo.");
            }
        });
    }

    /** Un intento contra un teléfono. Devuelve el sobre o null si ése no era. */
    private String intentar(BluetoothAdapter ad, BluetoothDevice d) {
        BluetoothSocket s = null;
        try {
            // El descubrimiento y una conexión RFCOMM se pelean por la radio: si quedó corriendo,
            // la conexión falla o tarda muchísimo.
            try { ad.cancelDiscovery(); } catch (SecurityException ignored) {}
            s = d.createInsecureRfcommSocketToServiceRecord(UUID_VIDRIERA);
            s.connect();
            InputStream in = s.getInputStream();
            byte[] buf = new byte[512];
            StringBuilder sb = new StringBuilder();
            long limite = System.currentTimeMillis() + TIMEOUT_LECTURA_MS;
            while (System.currentTimeMillis() < limite) {
                int n = in.read(buf);
                if (n <= 0) break;
                sb.append(new String(buf, 0, n, "UTF-8"));
                // El sobre es un JSON de una línea; en cuanto cierra la llave, está completo.
                if (sb.indexOf("}") >= 0) break;
            }
            String txt = sb.toString().trim();
            return txt.isEmpty() ? null : txt;
        } catch (Exception e) {
            return null;   // ése no tenía la vidriera abierta
        } finally {
            cerrar(s);
        }
    }

    // ------------------------------------------------------------------ plomería

    /** ¿Está disponible el camino Bluetooth en este aparato? Lo usa el JS para dibujar o no el botón. */
    @PluginMethod
    public void disponible(PluginCall call) {
        BluetoothAdapter ad = adaptador();
        JSObject r = new JSObject();
        r.put("hay", ad != null);
        r.put("prendido", ad != null && ad.isEnabled());
        call.resolve(r);
    }

    private BluetoothAdapter adaptador() {
        try { return BluetoothAdapter.getDefaultAdapter(); } catch (Exception e) { return null; }
    }

    /**
     * Pide `BLUETOOTH_CONNECT` si hace falta. Devuelve false cuando se desvió a pedir el permiso —
     * el que llama tiene que cortar y esperar al callback, igual que en `EnlaceLocalPlugin`.
     */
    private boolean pedirConectar(PluginCall call, String callback) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;   // < Android 12: normal
        if (getPermissionState(BT_CONECTAR) == PermissionState.GRANTED) return true;
        requestPermissionForAlias(BT_CONECTAR, call, callback);
        return false;
    }

    private static void cerrar(BluetoothSocket s) {
        try { if (s != null) s.close(); } catch (Exception ignored) {}
    }

    private synchronized ExecutorService ejecutor() {
        if (hilo == null || hilo.isShutdown()) hilo = Executors.newCachedThreadPool();
        return hilo;
    }

    @Override
    protected void handleOnDestroy() {
        publicando = false;
        try { if (servidor != null) servidor.close(); } catch (Exception ignored) {}
        if (hilo != null) hilo.shutdownNow();
        super.handleOnDestroy();
    }

}
