package com.launion.app;

import android.util.Log;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Servidor HTTP mínimo, escrito a mano, que le sirve el catálogo a la tablet del cliente por el
 * hotspot local del vendedor.
 *
 * POR QUÉ A MANO Y NO NanoHTTPD. Es el mismo criterio de `QrPlugin`: son cuatro rutas y ninguna
 * necesita cookies, keep-alive, chunked ni TLS. Una dependencia nueva en el APK cuesta más que
 * estas líneas, y este servidor tiene que ser auditable de una sentada — es lo único del proyecto
 * que ACEPTA conexiones entrantes.
 *
 * 🔒 LAS TRES DEFENSAS, y ninguna es opcional:
 *
 *  1. **Se ata a la IP del hotspot, no a 0.0.0.0.** Si escuchara en todas las interfaces, en el
 *     depósito quedaría publicado en el WiFi de la empresa. Si no se puede averiguar la IP del AP,
 *     el servidor NO arranca: mejor que la vidriera no funcione a que escuche donde no debe.
 *  2. **Token en cada request.** Sale del QR, son 32 bytes al azar por sesión y muere con la visita.
 *     Se compara en tiempo constante — con `equals()`, medir el tiempo de respuesta filtra el token
 *     carácter por carácter, y acá el atacante está sentado en la misma red.
 *  3. **`/foto/<id>` valida el id contra una lista blanca de caracteres.** Es la única ruta que
 *     toca el disco, y `..%2f..%2fdatabases%2f` es el primer intento de cualquiera.
 *
 * PROTOCOLO (todo con `Connection: close`, sin keep-alive):
 *
 *  · `GET  /catalogo?t=<token>`            → el snapshot que publicó el JS
 *  · `GET  /foto/<idProducto>?t=<token>`   → los bytes de la foto del espejo local
 *  · `GET  /eventos?t=<token>&desde=<seq>` → cuelga hasta 25 s esperando novedades (long-poll)
 *  · `POST /toque?t=<token>`               → el cliente tocó algo; el cuerpo va tal cual al JS
 *
 * El long-poll es a propósito y no una limitación: un WebSocket serían ~300 líneas de handshake y
 * enmascarado a mano para el mismo resultado sobre una red de un solo salto.
 */
public class ServidorLocal {

    private static final String TAG = "ServidorLocal";

    /** Cuánto cuelga `/eventos` antes de contestar vacío. Por debajo del timeout típico de un cliente. */
    private static final long ESPERA_EVENTOS_MS = 25000;

    /**
     * Hilos que atienden. Cada `/eventos` colgado ocupa uno hasta 25 s, así que el piso real es
     * "una tablet = un hilo permanente + picos". Con 8 entran varias tablets y sobra.
     */
    private static final int HILOS = 8;

    /** Techo del historial de eventos. Acotado a propósito: es memoria en un teléfono de gama baja. */
    private static final int MAX_EVENTOS = 200;

    /** Techo del cuerpo de un POST. Un toque son ~100 bytes; esto es la red contra un cuerpo infinito. */
    private static final int MAX_CUERPO = 64 * 1024;

    public interface Escucha {
        /** Llega un toque de la tablet. `json` es el cuerpo crudo del POST. */
        void alRecibirToque(String json);
    }

    private final File carpetaFotos;
    private final Escucha escucha;

    private ServerSocket socket;
    private ExecutorService pool;
    private volatile boolean vivo = false;
    private volatile String token = null;
    private volatile String catalogo = "{}";

    /** Historial de eventos celular→tablet. El índice + 1 de cada uno es su `seq`. */
    private final List<String> eventos = new ArrayList<>();
    /** Cuántos se descartaron ya por el techo: sin esto, `seq` se reiniciaría al podar. */
    private int descartados = 0;
    private final Object candado = new Object();

    public ServidorLocal(File carpetaFotos, Escucha escucha) {
        this.carpetaFotos = carpetaFotos;
        this.escucha = escucha;
    }

    // ------------------------------------------------------------------ ciclo de vida

    /**
     * Levanta el servidor atado a `ip`, en un puerto que elige el sistema.
     *
     * El puerto es efímero (`0`) y no uno fijo: dos sesiones seguidas no chocan con el socket
     * anterior en TIME_WAIT, y el número viaja en el QR igual que la IP.
     *
     * @return el puerto en el que quedó escuchando
     */
    public synchronized int arrancar(InetAddress ip, String token) throws IOException {
        if (vivo) throw new IOException("El servidor ya está corriendo.");
        if (ip == null) throw new IOException("Sin IP de hotspot: no se arranca (ver defensa 1).");
        if (token == null || token.length() < 16) throw new IOException("Token de sesión inválido.");
        this.token = token;
        socket = new ServerSocket(0, 16, ip);
        pool = Executors.newFixedThreadPool(HILOS);
        vivo = true;
        final int puerto = socket.getLocalPort();
        new Thread(new Runnable() {
            @Override public void run() { aceptar(); }
        }, "vidriera-accept").start();
        Log.i(TAG, "Escuchando en " + ip.getHostAddress() + ":" + puerto);
        return puerto;
    }

    /** Baja todo. Idempotente: parar lo que ya está parado no es un error. */
    public synchronized void parar() {
        vivo = false;
        token = null;
        try { if (socket != null) socket.close(); } catch (IOException ignored) { }
        socket = null;
        if (pool != null) pool.shutdownNow();
        pool = null;
        synchronized (candado) {
            eventos.clear();
            descartados = 0;
            catalogo = "{}";
            // Despertar a los que estén colgados en /eventos para que no queden 25 s en el aire.
            candado.notifyAll();
        }
    }

    public boolean estaVivo() { return vivo; }

    // ------------------------------------------------------------------ estado que publica el JS

    /** El snapshot del catálogo, ya armado y filtrado por el JS (sin rentabilidad). */
    public void publicarCatalogo(String json) {
        this.catalogo = json == null ? "{}" : json;
    }

    /** Encola un evento celular→tablet y despierta a los que estén esperando. */
    public void emitir(String json) {
        if (json == null) return;
        synchronized (candado) {
            eventos.add(json);
            while (eventos.size() > MAX_EVENTOS) {
                eventos.remove(0);
                descartados++;
            }
            candado.notifyAll();
        }
    }

    // ------------------------------------------------------------------ el bucle

    private void aceptar() {
        while (vivo) {
            final Socket cliente;
            try {
                cliente = socket.accept();
            } catch (IOException e) {
                if (vivo) Log.w(TAG, "accept falló: " + e.getMessage());
                return; // socket cerrado (parar()) o error irrecuperable
            }
            try {
                pool.execute(new Runnable() {
                    @Override public void run() { atender(cliente); }
                });
            } catch (RuntimeException e) {
                // Pool saturado o ya apagado: cerrar y seguir. Una conexión perdida se reintenta sola
                // del lado de la tablet; dejar el hilo de accept muerto sería un servidor zombi.
                cerrar(cliente);
            }
        }
    }

    private void atender(Socket cliente) {
        try {
            cliente.setSoTimeout(60000);
            BufferedInputStream in = new BufferedInputStream(cliente.getInputStream());
            OutputStream out = cliente.getOutputStream();

            String linea = leerLinea(in);
            if (linea == null) return;
            String[] partes = linea.split(" ");
            if (partes.length < 2) { responder(out, 400, "text/plain", "peticion invalida".getBytes("UTF-8")); return; }
            String metodo = partes[0];
            String destino = partes[1];

            // Cabeceras: solo interesa Content-Length. El resto se descarta a propósito.
            int largo = 0;
            String h;
            while ((h = leerLinea(in)) != null && h.length() > 0) {
                String bajo = h.toLowerCase();
                if (bajo.startsWith("content-length:")) {
                    try { largo = Integer.parseInt(h.substring(15).trim()); } catch (NumberFormatException ignored) { }
                }
            }

            String ruta = destino;
            String query = "";
            int q = destino.indexOf('?');
            if (q >= 0) { ruta = destino.substring(0, q); query = destino.substring(q + 1); }
            Map<String, String> params = parsear(query);

            // 🔒 Defensa 2: sin token válido no se contesta NADA, ni siquiera qué rutas existen.
            if (!tokenValido(params.get("t"))) {
                responder(out, 401, "application/json", "{\"error\":\"token\"}".getBytes("UTF-8"));
                return;
            }

            if ("GET".equals(metodo) && "/catalogo".equals(ruta)) {
                responder(out, 200, "application/json", catalogo.getBytes("UTF-8"));

            } else if ("GET".equals(metodo) && ruta.startsWith("/foto/")) {
                servirFoto(out, ruta.substring(6));

            } else if ("GET".equals(metodo) && "/eventos".equals(ruta)) {
                long desde = 0;
                try { desde = Long.parseLong(params.get("desde")); } catch (Exception ignored) { }
                responder(out, 200, "application/json", esperarEventos(desde).getBytes("UTF-8"));

            } else if ("POST".equals(metodo) && "/toque".equals(ruta)) {
                if (largo < 0 || largo > MAX_CUERPO) {
                    responder(out, 413, "application/json", "{\"error\":\"cuerpo\"}".getBytes("UTF-8"));
                    return;
                }
                String cuerpo = leerCuerpo(in, largo);
                if (escucha != null) escucha.alRecibirToque(cuerpo);
                responder(out, 200, "application/json", "{\"ok\":true}".getBytes("UTF-8"));

            } else {
                responder(out, 404, "application/json", "{\"error\":\"no existe\"}".getBytes("UTF-8"));
            }
        } catch (IOException e) {
            // La tablet se fue de rango o cortó a mitad de camino. Es lo normal, no un error.
        } finally {
            cerrar(cliente);
        }
    }

    // ------------------------------------------------------------------ rutas

    /**
     * 🔒 Defensa 3. El id se acepta solo si es letras, números, guion o guion bajo: nada de `/`,
     * de `.` ni de `%`. Con eso `/foto/../../databases/x` no llega ni a tocar el `File`.
     */
    private void servirFoto(OutputStream out, String id) throws IOException {
        if (!idSeguro(id)) {
            responder(out, 400, "application/json", "{\"error\":\"id\"}".getBytes("UTF-8"));
            return;
        }
        String[] exts = { "webp", "jpg", "jpeg", "png" };
        for (String ext : exts) {
            File f = new File(carpetaFotos, id + "." + ext);
            // El doble chequeo: aunque `idSeguro` ya lo garantiza, se confirma que el archivo
            // resuelto siga colgando de la carpeta del espejo. Barato, y cubre un `idSeguro` que
            // alguien afloje en el futuro.
            if (!f.isFile() || !f.getCanonicalPath().startsWith(carpetaFotos.getCanonicalPath())) continue;
            byte[] datos = leerArchivo(f);
            responder(out, 200, mime(ext), datos);
            return;
        }
        responder(out, 404, "application/json", "{\"error\":\"sin foto\"}".getBytes("UTF-8"));
    }

    /**
     * Long-poll. Devuelve `{"seq":N,"eventos":[…]}` con lo que haya después de `desde`, o cuelga
     * hasta que llegue algo o venzan los 25 s.
     *
     * `"resync":true` cuando el cliente pide un `desde` más viejo que lo que queda en memoria: la
     * tablet no puede saber qué se perdió, así que se le dice que vuelva a pedir el catálogo entero
     * en vez de dejarla con un estado incompleto que parece completo.
     */
    private String esperarEventos(long desde) {
        synchronized (candado) {
            long limite = System.currentTimeMillis() + ESPERA_EVENTOS_MS;
            while (vivo && seqActual() <= desde) {
                long resta = limite - System.currentTimeMillis();
                if (resta <= 0) break;
                try { candado.wait(resta); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
            StringBuilder sb = new StringBuilder();
            sb.append("{\"seq\":").append(seqActual());
            if (desde < descartados) sb.append(",\"resync\":true");
            sb.append(",\"eventos\":[");
            int primero = (int) Math.max(0, desde - descartados);
            for (int i = primero; i < eventos.size(); i++) {
                if (i > primero) sb.append(',');
                sb.append(eventos.get(i));
            }
            sb.append("]}");
            return sb.toString();
        }
    }

    /** Debe llamarse con `candado` tomado. */
    private long seqActual() { return descartados + eventos.size(); }

    // ------------------------------------------------------------------ plomería

    /**
     * Comparación en tiempo constante. `String.equals()` corta en el primer carácter distinto, y
     * eso alcanza para adivinar el token midiendo respuestas desde la misma red.
     */
    private boolean tokenValido(String dado) {
        String esperado = token;
        if (esperado == null || dado == null || dado.length() != esperado.length()) return false;
        int dif = 0;
        for (int i = 0; i < esperado.length(); i++) dif |= esperado.charAt(i) ^ dado.charAt(i);
        return dif == 0;
    }

    private static boolean idSeguro(String id) {
        if (id == null || id.length() == 0 || id.length() > 64) return false;
        for (int i = 0; i < id.length(); i++) {
            char c = id.charAt(i);
            boolean ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
            if (!ok) return false;
        }
        return true;
    }

    private static String mime(String ext) {
        if ("png".equals(ext)) return "image/png";
        if ("webp".equals(ext)) return "image/webp";
        return "image/jpeg";
    }

    private static Map<String, String> parsear(String query) {
        Map<String, String> m = new HashMap<>();
        if (query == null || query.length() == 0) return m;
        for (String par : query.split("&")) {
            int i = par.indexOf('=');
            if (i <= 0) continue;
            try {
                m.put(URLDecoder.decode(par.substring(0, i), "UTF-8"), URLDecoder.decode(par.substring(i + 1), "UTF-8"));
            } catch (UnsupportedEncodingException | IllegalArgumentException ignored) { }
        }
        return m;
    }

    /** Una línea terminada en CRLF (o LF). `null` si la conexión se cerró. */
    private static String leerLinea(BufferedInputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') return sb.toString();
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 8192) throw new IOException("línea demasiado larga");
        }
        return sb.length() > 0 ? sb.toString() : null;
    }

    private static String leerCuerpo(BufferedInputStream in, int largo) throws IOException {
        byte[] buf = new byte[largo];
        int leido = 0;
        while (leido < largo) {
            int n = in.read(buf, leido, largo - leido);
            if (n < 0) break;
            leido += n;
        }
        return new String(buf, 0, leido, "UTF-8");
    }

    private static byte[] leerArchivo(File f) throws IOException {
        FileInputStream fis = new FileInputStream(f);
        try {
            byte[] buf = new byte[(int) f.length()];
            int leido = 0;
            while (leido < buf.length) {
                int n = fis.read(buf, leido, buf.length - leido);
                if (n < 0) break;
                leido += n;
            }
            return buf;
        } finally {
            try { fis.close(); } catch (IOException ignored) { }
        }
    }

    private static void responder(OutputStream out, int codigo, String tipo, byte[] cuerpo) throws IOException {
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(codigo).append(' ').append(codigo == 200 ? "OK" : "ERR").append("\r\n");
        h.append("Content-Type: ").append(tipo).append("\r\n");
        h.append("Content-Length: ").append(cuerpo.length).append("\r\n");
        // Sin caché: el catálogo y los eventos cambian dentro de la misma sesión.
        h.append("Cache-Control: no-store\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes("UTF-8"));
        out.write(cuerpo);
        out.flush();
    }

    private static void cerrar(Socket s) {
        try { s.close(); } catch (IOException ignored) { }
    }
}
