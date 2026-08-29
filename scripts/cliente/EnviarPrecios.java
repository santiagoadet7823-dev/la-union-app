/*
 * EnviarPrecios.java — el mismo envío, para llamarlo DESDE ADENTRO del sistema de gestión.
 *
 * Es una alternativa a los scripts (`enviar-precios.ps1` / `.sh`), no un agregado: si el ERP ya
 * tiene un proceso nocturno propio, conviene colgar el envío ahí en vez de agendar una tarea más
 * en el sistema operativo — así el envío corre siempre DESPUÉS de que el export terminó, y no a
 * una hora fija esperando que haya terminado.
 *
 * Sin dependencias: java.net.http, incluido desde Java 11.
 *
 *   javac EnviarPrecios.java
 *   java  EnviarPrecios /ruta/lista-precios.txt
 *
 * O como método, desde el proceso que ya exporta:
 *
 *   EnviarPrecios.Respuesta r = EnviarPrecios.enviar(Path.of(rutaExport), token, false);
 *   log.info("ingesta precios: HTTP {} {}", r.codigo, r.cuerpo);
 *
 * 🔴 EL TOKEN NO SE ESCRIBE EN EL CÓDIGO NI SE COMMITEA. Sale de la variable de entorno
 *    DISTAT_TOKEN, o de donde el sistema guarde el resto de sus credenciales.
 *
 * ⚠️ SIEMPRE LOGUEAR LA RESPUESTA. Es la única forma de saber que la lista entró: el cuerpo trae
 *    cuántas filas se recibieron, cuántas se actualizaron y cuáles se rechazaron con el número de
 *    fila. Un envío que no se loguea es un envío que falla en silencio.
 */

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;

public class EnviarPrecios {

    private static final String URL =
            "https://lqhtxivednffpiicnbog.supabase.co/functions/v1/ingest-precios";

    /** Lo que devolvió el servidor. El cuerpo es el JSON con el resumen: hay que guardarlo. */
    public static class Respuesta {
        public final int codigo;
        public final String cuerpo;
        public Respuesta(int codigo, String cuerpo) { this.codigo = codigo; this.cuerpo = cuerpo; }
        public boolean ok() { return codigo == 200; }
    }

    /**
     * @param archivo        el export tabulado (o con ; o ,) — con la fila de encabezados PRIMERO.
     * @param token          identifica a la distribuidora. No va en el archivo ni en el cuerpo.
     * @param listaCompleta  true da de baja lo que no venga en el archivo.
     *                       🔴 En el envío automático va SIEMPRE en false: las bajas se hacen a mano
     *                       desde la app, leyendo el conteo antes de confirmar. El servidor además
     *                       responde 409 sin escribir nada si el archivo dejaría fuera más del 20 %
     *                       del catálogo.
     */
    public static Respuesta enviar(Path archivo, String token, boolean listaCompleta)
            throws IOException, InterruptedException {

        if (token == null || token.isBlank()) {
            throw new IllegalArgumentException("Falta el token (DISTAT_TOKEN).");
        }
        if (!Files.exists(archivo) || Files.size(archivo) == 0) {
            throw new IOException("El archivo no existe o esta vacio: " + archivo);
        }

        String destino = listaCompleta ? URL + "?lista_completa=1" : URL;

        HttpClient cliente = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(30))
                .build();

        HttpRequest pedido = HttpRequest.newBuilder(URI.create(destino))
                .header("Authorization", "Bearer " + token)
                // El charset importa: sin UTF-8 explícito, las eñes y los acentos de las
                // descripciones llegan rotos y nadie se entera hasta que el vendedor lee la grilla.
                .header("Content-Type", "text/csv; charset=utf-8")
                .timeout(Duration.ofMinutes(5))
                .POST(HttpRequest.BodyPublishers.ofFile(archivo))
                .build();

        HttpResponse<String> r = cliente.send(pedido, HttpResponse.BodyHandlers.ofString());
        return new Respuesta(r.statusCode(), r.body());
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("uso: java EnviarPrecios <archivo> [--lista-completa]");
            System.exit(2);
        }
        boolean completa = args.length > 1 && "--lista-completa".equals(args[1]);
        String token = System.getenv("DISTAT_TOKEN");

        int intentos = 0;
        while (true) {
            try {
                Respuesta r = enviar(Path.of(args[0]), token, completa);
                System.out.println("HTTP " + r.codigo + " " + r.cuerpo);
                // 401 (token), 400 (archivo mal armado) y 409 (freno de bajas) NO se reintentan:
                // el servidor contestó y la respuesta va a ser la misma. Necesitan una persona.
                System.exit(r.ok() ? 0 : 1);
            } catch (IOException | InterruptedException e) {
                // Sólo acá se reintenta: no llegamos al servidor.
                System.err.println("Error de red: " + e.getMessage());
                if (++intentos > 2) {
                    System.err.println("Sin reintentos restantes. No se envio la lista de hoy.");
                    System.exit(3);
                }
                Thread.sleep(Duration.ofMinutes(15).toMillis());
            }
        }
    }
}
