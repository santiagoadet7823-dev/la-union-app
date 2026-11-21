import java.io.IOException;
import java.net.InetAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class EnviarPedidosConfirmados {

    public static final String VERSION = "1.0.0";
    public static final String ARCHIVO = "PedidosConfirmados.txt";
    private static final String TOKEN = "__TOKEN_PEDIDOS__";

    public static class Respuesta {
        public final int codigo;
        public final String cuerpo;
        public final Path enviado;

        Respuesta(int codigo, String cuerpo, Path enviado) {
            this.codigo = codigo;
            this.cuerpo = cuerpo;
            this.enviado = enviado;
        }

        public boolean ok() {
            return codigo == 200;
        }
    }

    private static String servidor() {
        String s = System.getenv("DISTAT_URL");
        return (s == null || s.isBlank() ? "https://api.dist-at.com" : s.strip()).replaceAll("/+$", "");
    }

    public static String token() {
        String t = System.getenv("DISTAT_TOKEN_PEDIDOS");
        if (t != null && !t.isBlank()) return t.strip();
        return TOKEN;
    }

    private static String sha256(byte[] datos) throws Exception {
        byte[] h = MessageDigest.getInstance("SHA-256").digest(datos);
        StringBuilder sb = new StringBuilder();
        for (byte b : h) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static String equipo() {
        try {
            return InetAddress.getLocalHost().getHostName();
        } catch (Exception e) {
            return "desconocido";
        }
    }

    public static Respuesta enviar(Path archivo, String token, boolean probar) throws Exception {
        if (token == null || token.isBlank() || token.startsWith("__")) {
            throw new IllegalStateException("falta-token");
        }
        if (!Files.exists(archivo) || Files.size(archivo) == 0) {
            return new Respuesta(204, "sin-archivo", null);
        }
        byte[] cuerpo = Files.readAllBytes(archivo);
        String url = servidor() + "/functions/v1/ingest-pedidos-erp" + (probar ? "?probar=1" : "");
        HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                .timeout(Duration.ofSeconds(120))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "text/plain; charset=windows-1252")
                .header("X-Archivo-Sha256", sha256(cuerpo))
                .header("X-Archivo-Origen", URLEncoder.encode(archivo.toAbsolutePath().toString(), StandardCharsets.UTF_8))
                .header("X-Equipo", URLEncoder.encode(equipo(), StandardCharsets.UTF_8))
                .header("X-Agente-Version", "java-" + VERSION)
                .POST(HttpRequest.BodyPublishers.ofByteArray(cuerpo))
                .build();
        HttpClient cli = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(30)).build();
        HttpResponse<String> r = cli.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        Path enviado = null;
        if (r.statusCode() == 200 && !probar) {
            String sello = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));
            Path carpeta = archivo.toAbsolutePath().getParent().resolve("enviados");
            Files.createDirectories(carpeta);
            enviado = carpeta.resolve("PedidosConfirmados-" + sello + ".enviado");
            Files.move(archivo, enviado, StandardCopyOption.REPLACE_EXISTING);
        }
        return new Respuesta(r.statusCode(), r.body(), enviado);
    }

    private static void registrar(Path carpeta, String linea) {
        try {
            String fecha = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd"));
            Path log = carpeta.resolve("registro").resolve("confirmados-" + fecha + ".log");
            Files.createDirectories(log.getParent());
            String hora = LocalDateTime.now().format(DateTimeFormatter.ofPattern("HH:mm:ss"));
            Files.writeString(log, hora + "  " + linea + System.lineSeparator(), StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException ignored) {
        }
    }

    public static void main(String[] args) {
        boolean probar = false;
        Path destino = Path.of(".");
        for (String a : args) {
            if (a.equalsIgnoreCase("--probar")) probar = true;
            else destino = Path.of(a.replaceAll("[\\\\/]+$", ""));
        }
        Path archivo = Files.isDirectory(destino) ? destino.resolve(ARCHIVO) : destino;
        Path carpeta = archivo.toAbsolutePath().getParent();
        try {
            Respuesta r = enviar(archivo, token(), probar);
            String linea = (probar ? "PRUEBA " : "") + "HTTP " + r.codigo + "  " + r.cuerpo
                    + (r.enviado != null ? "  -> " + r.enviado.getFileName() : "");
            System.out.println(linea);
            registrar(carpeta, linea);
            System.exit(r.codigo == 200 ? 0 : (r.codigo == 204 ? 2 : 1));
        } catch (Exception e) {
            String linea = "ERROR  " + e.getClass().getSimpleName() + ": " + e.getMessage() + "  (" + servidor() + ")";
            System.out.println(linea);
            registrar(carpeta, linea);
            System.exit(1);
        }
    }
}
