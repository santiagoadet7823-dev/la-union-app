package com.launion.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PdfDelWebView;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import java.io.File;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * PDF del informe de jornada, desde el WebView.
 *
 * 🩸 POR QUÉ ESTO Y NO UNA LIBRERÍA DE PDF. La alternativa era `jsPDF` en el bundle, y se descartó
 * por el mismo motivo por el que el PDF de la PWA sale de `window.print()`: una librería de PDF no
 * sabe nada de la pantalla, dibuja de cero, y obliga a escribir el informe DOS veces —una en React
 * y otra en coordenadas de papel—. Esas dos copias divergen a la primera corrección, y el informe
 * impreso tiene que ser el informe que se verificó en pantalla, no una reconstrucción parecida.
 *
 * `WebView.createPrintDocumentAdapter()` produce el PDF con el MISMO motor de renderizado que ya
 * está dibujando el informe, incluida la hoja `@media print` de index.css. En la práctica: lo que se
 * ve es lo que se imprime, sin una línea de layout duplicada.
 *
 * El WebView es el de Capacitor (`getBridge().getWebView()`), o sea el que tiene el informe cargado.
 * No se crea uno nuevo: uno nuevo tendría que volver a cargar la app entera y no tendría ni la
 * sesión ni el estado de la pantalla.
 *
 * Todo corre en el hilo principal por exigencia de Android (`PrintManager` y `WebView` son de UI).
 *
 * El sistema se encarga del resto: el diálogo de impresión de Android trae "Guardar como PDF" entre
 * los destinos, así que el usuario elige dónde guardarlo o a quién mandárselo sin que la app tenga
 * que tocar el filesystem ni pedir un permiso más.
 */
@CapacitorPlugin(name = "Impresion")
public class ImpresionPlugin extends Plugin {

    @PluginMethod
    public void imprimir(PluginCall call) {
        final String titulo = call.getString("titulo", "Informe");
        final Activity actividad = getActivity();
        if (actividad == null) {
            call.reject("No hay actividad para imprimir.");
            return;
        }

        actividad.runOnUiThread(() -> {
            try {
                WebView wv = getBridge().getWebView();
                if (wv == null) {
                    call.reject("No hay WebView para imprimir.");
                    return;
                }

                PrintManager pm = (PrintManager) actividad.getSystemService(Context.PRINT_SERVICE);
                if (pm == null) {
                    call.reject("Este teléfono no tiene servicio de impresión.");
                    return;
                }

                // El nombre del trabajo es el que Android propone como nombre de archivo cuando el
                // destino es "Guardar como PDF": tiene que ser el título del informe y no el de la
                // app, o el usuario termina con seis archivos llamados "DisT-At".
                PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter(titulo);

                pm.print(
                    titulo,
                    adapter,
                    new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                        // Los márgenes los pone la hoja `@media print` (@page { margin: 14mm }).
                        // Sumar acá los del sistema los DUPLICARÍA y el informe saldría angosto.
                        .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                        .build()
                );
                call.resolve();
            } catch (Exception e) {
                call.reject("No se pudo generar el PDF: " + e.getMessage(), e);
            }
        });
    }

    /**
     * EL MISMO PDF, PERO A LA HOJA DE COMPARTIR.
     *
     * 🩸 POR QUÉ HACE FALTA UN SEGUNDO MÉTODO (03/09/2026, pedido del cliente en la reunión del
     * 02/09: "compartir el ticket en PDF para mandárselo al comerciante"). `imprimir()` abre el
     * diálogo de impresión de Android, que ofrece "Guardar como PDF". Para el informe de jornada
     * alcanza: el encargado lo guarda y lo manda desde la PC. Para el ticket no, y la diferencia es
     * dónde está la persona — el vendedor tiene al comerciante enfrente pidiéndole el comprobante, y
     * por el camino del diálogo son cinco pasos y dos aplicaciones (imprimir, guardar, salir, buscar
     * el archivo, compartir). Acá es un toque.
     *
     * El PDF lo genera el MISMO WebView con la misma hoja `@media print`: lo que se manda es lo que
     * se ve. La única diferencia con `imprimir()` es a dónde va el resultado.
     *
     * ⚠️ Va a `getCacheDir()` y no al almacenamiento del usuario: es un archivo para mandar, no para
     * guardar. Android limpia esa carpeta solo cuando necesita espacio, así que un ticket compartido
     * no se acumula para siempre en un teléfono de 32 GB. El `file_paths.xml` ya expone `cache-path`
     * desde el primer día, así que el FileProvider no necesita entrada nueva.
     */
    @PluginMethod
    public void compartirPdf(PluginCall call) {
        final String titulo = call.getString("titulo", "Comprobante");
        final String nombre = limpiarNombre(call.getString("archivo", titulo)) + ".pdf";
        final Activity actividad = getActivity();
        if (actividad == null) {
            call.reject("No hay actividad para generar el PDF.");
            return;
        }

        actividad.runOnUiThread(() -> {
            try {
                WebView wv = getBridge().getWebView();
                if (wv == null) {
                    call.reject("No hay WebView para generar el PDF.");
                    return;
                }

                File destino = new File(actividad.getCacheDir(), nombre);
                PrintDocumentAdapter adapter = wv.createPrintDocumentAdapter(titulo);
                PrintAttributes atributos = new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                    // Los mismos márgenes que `imprimir()`, por el mismo motivo: los pone la hoja
                    // `@media print`. Sumar los del sistema los duplicaría.
                    .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                    .setResolution(new PrintAttributes.Resolution("pdf", "pdf", 300, 300))
                    .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                    .build();

                PdfDelWebView.generar(adapter, atributos, destino, new PdfDelWebView.Resultado() {
                    @Override
                    public void ok(File archivo) {
                        try {
                            Uri uri = FileProvider.getUriForFile(
                                actividad,
                                actividad.getPackageName() + ".fileprovider",
                                archivo
                            );
                            Intent envio = new Intent(Intent.ACTION_SEND);
                            envio.setType("application/pdf");
                            envio.putExtra(Intent.EXTRA_STREAM, uri);
                            envio.putExtra(Intent.EXTRA_SUBJECT, titulo);
                            // 🔴 Sin este flag, la app que recibe el content:// NO lo puede leer y
                            // WhatsApp muestra "no se pudo adjuntar" sin decir por qué.
                            envio.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            actividad.startActivity(Intent.createChooser(envio, titulo));
                            call.resolve();
                        } catch (Exception e) {
                            call.reject("No se pudo compartir el PDF: " + e.getMessage(), e);
                        }
                    }

                    @Override
                    public void error(String motivo) {
                        call.reject(motivo);
                    }
                });
            } catch (Exception e) {
                call.reject("No se pudo generar el PDF: " + e.getMessage(), e);
            }
        });
    }

    /**
     * El título se convierte en NOMBRE DE ARCHIVO, así que no puede traer nada que rompa una ruta.
     * Un `/` en el nombre haría que el `File` apunte a un subdirectorio que no existe y el open
     * fallara con un mensaje que no habla del nombre.
     */
    private static String limpiarNombre(String bruto) {
        String limpio = (bruto == null ? "" : bruto).replaceAll("[^A-Za-z0-9._-]+", "-");
        limpio = limpio.replaceAll("^-+|-+$", "");
        if (limpio.isEmpty()) limpio = "comprobante";
        return limpio.length() > 60 ? limpio.substring(0, 60) : limpio;
    }
}
