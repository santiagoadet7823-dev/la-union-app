/*
 * BajarPedidos.java — trae los pedidos nuevos y escribe `Pedidos.txt` para que el ERP los importe.
 *
 * 10/09/2026. Es lo que la distribuidora pidió: ejecutar un comando que levante su servidor Java,
 * que le pida los pedidos al backend, y que **los que vayan surgiendo después de esa petición se
 * adjunten a la próxima** — para no bajar toda la base de pedidos cada vez.
 *
 * Es el gemelo de `EnviarPrecios.java`, en el sentido contrario: aquél sube la lista de precios,
 * éste baja los pedidos. Sin dependencias: java.net.http, incluido desde Java 11.
 *
 *   javac BajarPedidos.java
 *   java  BajarPedidos "C:\ruta\donde\el\ERP\lee"
 *
 * O como método, desde el proceso que ya corre en el ERP:
 *
 *   BajarPedidos.Respuesta r = BajarPedidos.bajar(Path.of(carpeta), token, false);
 *   log.info("pedidos: HTTP {} lote {} pedidos {} filas {}", r.codigo, r.lote, r.pedidos, r.filas);
 *
 * 🔑 CÓMO FUNCIONA LO INCREMENTAL. No hay que mandar ninguna fecha ni recordar nada del lado de
 * acá: el servidor lleva la cuenta de qué pedidos ya entregó. Cada llamada trae SÓLO lo que todavía
 * no se llevó, y le pone número de lote. Un pedido que un vendedor tomó sin señal a las 09:00 y que
 * su teléfono recién sube a las 18:00 entra en la llamada siguiente, aunque sea "viejo" — por eso no
 * hay que pedir por rango de fechas: haciéndolo así ese pedido se perdería.
 *
 * 🔴 EL TOKEN NO SE ESCRIBE EN EL CÓDIGO NI SE COMMITEA. Sale de la variable de entorno
 *    DISTAT_TOKEN, o de donde el sistema guarde el resto de sus credenciales.
 *
 * ⚠️ SI ALGO SALE MAL DESPUÉS DE UNA BAJADA EXITOSA (se llenó el disco, se cayó el proceso, el
 *    archivo se escribió en la carpeta equivocada), esos pedidos YA figuran como entregados y no
 *    vuelven solos. Para recuperarlos: `java BajarPedidos <carpeta> --repetir`, que vuelve a traer
 *    el último lote sin consumir nada nuevo.
 */

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class BajarPedidos {

    private static final String URL =
            "https://lqhtxivednffpiicnbog.supabase.co/functions/v1/export-pedidos";

    /** El nombre que el ERP ya conoce. No cambiarlo sin avisar del otro lado. */
    private static final String ARCHIVO = "Pedidos.txt";

    public static class Respuesta {
        public final int codigo;
        public final String lote;
        public final int pedidos;
        public final int filas;
        public final String detalle;
        Respuesta(int codigo, String lote, int pedidos, int filas, String detalle) {
            this.codigo = codigo; this.lote = lote; this.pedidos = pedidos;
            this.filas = filas; this.detalle = detalle;
        }
        /** 200 = vino un archivo. 204 = no había nada nuevo, y eso TAMBIÉN es un final feliz. */
        public boolean ok() { return codigo == 200 || codigo == 204; }
        public boolean hayArchivo() { return codigo == 200; }
    }

    /**
     * @param carpeta  dónde dejar `Pedidos.txt` — la carpeta que el ERP lee.
     * @param token    identifica a la distribuidora. Nunca viaja en el archivo.
     * @param repetir  true vuelve a traer el ÚLTIMO lote sin consumir pedidos nuevos. Es para
     *                 recuperar un archivo que se perdió de este lado, no para el uso normal.
     */
    public static Respuesta bajar(Path carpeta, String token, boolean repetir)
            throws IOException, InterruptedException {

        HttpClient cliente = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .build();

        HttpRequest pedido = HttpRequest.newBuilder()
                .uri(URI.create(repetir ? URL + "?repetir=1" : URL))
                .header("Authorization", "Bearer " + token)
                .timeout(Duration.ofMinutes(2))
                .GET()
                .build();

        // Se recibe como BYTES y no como String: el servidor puede mandar UTF-8 o Latin-1 según
        // cómo se lo pida, y decodificar acá para volver a codificar al escribir corrompería los
        // acentos. Los bytes que llegan son exactamente los bytes que van al archivo.
        HttpResponse<byte[]> r = cliente.send(pedido, HttpResponse.BodyHandlers.ofByteArray());

        String lote = r.headers().firstValue("x-lote").orElse("");
        int pedidos = entero(r.headers().firstValue("x-pedidos").orElse("0"));
        int filas = entero(r.headers().firstValue("x-filas").orElse("0"));

        if (r.statusCode() == 204) {
            /* NO HAY NADA NUEVO, Y NO SE TOCA EL ARCHIVO ANTERIOR.
             *
             * 🩸 Pisarlo con uno vacío sería el peor final posible: si el ERP todavía no importó el
             * lote anterior, lo perdería — y un archivo vacío se importa sin error, así que nadie se
             * enteraría hasta que faltaran los pedidos de un día entero. */
            return new Respuesta(204, lote, 0, 0, "sin novedades");
        }

        if (r.statusCode() != 200) {
            return new Respuesta(r.statusCode(), lote, 0, 0,
                    new String(r.body(), StandardCharsets.UTF_8));
        }

        /* 🔑 ESCRITURA ATÓMICA. Se escribe un `.tmp` y recién entonces se renombra encima del
         * definitivo. Si el ERP vigila la carpeta, un archivo a medio escribir es una importación
         * corrupta — y a diferencia de un error, ésa no avisa: importa los renglones que alcanzó a
         * leer y da el archivo por bueno. El rename dentro del mismo volumen es atómico. */
        Files.createDirectories(carpeta);
        Path tmp = carpeta.resolve(ARCHIVO + ".tmp");
        Path destino = carpeta.resolve(ARCHIVO);
        Files.write(tmp, r.body());
        try {
            Files.move(tmp, destino, StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.ATOMIC_MOVE);
        } catch (java.nio.file.AtomicMoveNotSupportedException e) {
            // Algunas unidades de red no soportan el movimiento atómico. Se hace igual: sigue siendo
            // mucho mejor que escribir el definitivo renglón por renglón.
            Files.move(tmp, destino, StandardCopyOption.REPLACE_EXISTING);
        }

        return new Respuesta(200, lote, pedidos, filas, destino.toString());
    }

    private static int entero(String s) {
        try { return Integer.parseInt(s.trim()); } catch (Exception e) { return 0; }
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("Uso: java BajarPedidos <carpeta-donde-dejar-Pedidos.txt> [--repetir]");
            System.exit(2);
        }
        boolean repetir = args.length > 1 && "--repetir".equals(args[1]);

        String token = System.getenv("DISTAT_TOKEN");
        if (token == null || token.isBlank()) {
            System.err.println("Falta la variable de entorno DISTAT_TOKEN.");
            System.exit(2);
        }

        String ahora = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        Respuesta r = bajar(Path.of(args[0]), token, repetir);

        /* SIEMPRE LOGUEAR. Es la única forma de notar que un día no llegó nada: el proceso termina
         * bien igual, así que sin esta línea "no pasó nada" y "falló todo" se ven idénticos. */
        System.out.println(ahora + "  HTTP " + r.codigo
                + "  lote=" + (r.lote.isEmpty() ? "-" : r.lote)
                + "  pedidos=" + r.pedidos + "  filas=" + r.filas
                + "  " + r.detalle);

        System.exit(r.ok() ? 0 : 1);
    }
}
