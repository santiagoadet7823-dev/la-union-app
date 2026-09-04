package android.print;

import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;

import java.io.File;

/**
 * ESCRIBE A UN ARCHIVO EL PDF QUE EL WEBVIEW SABE IMPRIMIR.
 *
 * 🩸 POR QUÉ ESTA CLASE ESTÁ EN EL PAQUETE `android.print` Y NO EN `com.launion.app`.
 * No es un capricho ni un error de refactor: **es la única forma de hacerlo.**
 *
 * `PrintDocumentAdapter` entrega el PDF por dos callbacks —`LayoutResultCallback` y
 * `WriteResultCallback`— y las dos son clases abstractas cuyo constructor es **package-private** en
 * AOSP, con el comentario `/* do nothing - hide constructor *​/` al lado. O sea que desde cualquier
 * paquete propio no se pueden extender: no compila. Declarando esta clase dentro de `android.print`
 * el constructor queda accesible, que es el mecanismo que usan todas las librerías que hacen esto.
 *
 * ⚠️ Consecuencia práctica: **esta clase no se puede mover de carpeta.** Si alguien la "ordena"
 * llevándola junto al resto de los plugins, deja de compilar — y el error va a hablar de un
 * constructor, no de la carpeta.
 *
 * QUÉ RESUELVE, del lado del producto. `ImpresionPlugin.imprimir()` abre el diálogo de impresión de
 * Android, que trae "Guardar como PDF" entre los destinos. Eso alcanza para el informe de jornada
 * —el encargado lo guarda y lo manda desde la PC— pero **no para el ticket**: el vendedor está
 * parado frente al comerciante que le pide el comprobante, y el camino "imprimir → guardar como PDF
 * → salir de la app → buscar el archivo → compartir" son cinco pasos y dos aplicaciones. Con esto es
 * un toque y la hoja de compartir.
 *
 * Lo que NO cambia es lo importante: el PDF lo sigue renderizando el MISMO WebView con la misma hoja
 * `@media print`, así que el comprobante que se manda es exactamente el que se ve en pantalla. No
 * hay una segunda maquetación que pueda divergir — que es el motivo por el que en este proyecto se
 * descartó jsPDF.
 */
public final class PdfDelWebView {

    private PdfDelWebView() {}

    /** Qué hacer cuando el archivo está escrito, o cuando no se pudo. */
    public interface Resultado {
        void ok(File archivo);
        void error(String motivo);
    }

    /**
     * Corre el ciclo `onLayout` → `onWrite` del adapter y deja el PDF en `destino`.
     *
     * ⚠️ Tiene que invocarse en el HILO PRINCIPAL: el adapter viene de un `WebView`, y tanto el
     * layout como el write tocan la vista. Los callbacks también vuelven por el hilo principal, así
     * que `Resultado` se ejecuta ahí y puede llamar al `PluginCall` sin saltar de hilo.
     */
    public static void generar(
        final PrintDocumentAdapter adapter,
        final PrintAttributes atributos,
        final File destino,
        final Resultado resultado
    ) {
        // Un archivo viejo con el mismo nombre se pisa: `MODE_TRUNCATE` en el open de abajo. Sin
        // eso, un PDF más corto que el anterior quedaría con la cola del anterior pegada al final —
        // un comprobante con renglones de otro pedido, que es el peor final posible para esto.
        adapter.onLayout(
            null,
            atributos,
            new CancellationSignal(),
            new PrintDocumentAdapter.LayoutResultCallback() {
                @Override
                public void onLayoutFinished(PrintDocumentInfo info, boolean cambio) {
                    ParcelFileDescriptor pfd = null;
                    try {
                        pfd = ParcelFileDescriptor.open(
                            destino,
                            ParcelFileDescriptor.MODE_READ_WRITE
                                | ParcelFileDescriptor.MODE_CREATE
                                | ParcelFileDescriptor.MODE_TRUNCATE
                        );
                    } catch (Exception e) {
                        resultado.error("No se pudo crear el archivo: " + e.getMessage());
                        return;
                    }

                    final ParcelFileDescriptor descriptor = pfd;
                    adapter.onWrite(
                        new PageRange[]{ PageRange.ALL_PAGES },
                        descriptor,
                        new CancellationSignal(),
                        new PrintDocumentAdapter.WriteResultCallback() {
                            @Override
                            public void onWriteFinished(PageRange[] paginas) {
                                cerrar(descriptor);
                                // Un adapter puede "terminar" sin escribir nada (por ejemplo si el
                                // nodo quedó oculto). Un PDF de 0 bytes se comparte igual y el
                                // comerciante recibe un archivo que no abre: se avisa acá.
                                if (destino.length() <= 0) {
                                    resultado.error("El PDF salió vacío.");
                                    return;
                                }
                                resultado.ok(destino);
                            }

                            @Override
                            public void onWriteFailed(CharSequence error) {
                                cerrar(descriptor);
                                resultado.error(error != null ? error.toString() : "No se pudo escribir el PDF.");
                            }

                            @Override
                            public void onWriteCancelled() {
                                cerrar(descriptor);
                                resultado.error("Se canceló la generación del PDF.");
                            }
                        }
                    );
                }

                @Override
                public void onLayoutFailed(CharSequence error) {
                    resultado.error(error != null ? error.toString() : "No se pudo preparar el PDF.");
                }

                @Override
                public void onLayoutCancelled() {
                    resultado.error("Se canceló la preparación del PDF.");
                }
            },
            null
        );
    }

    private static void cerrar(ParcelFileDescriptor pfd) {
        try { if (pfd != null) pfd.close(); } catch (Exception ignorada) { /* ya está cerrado */ }
    }
}
