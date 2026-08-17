package com.launion.app;

import android.app.Activity;
import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;

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
}
