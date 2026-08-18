package com.launion.app;

import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.activity.result.ActivityResult;

/**
 * Abre la pantalla de escaneo y devuelve el texto del QR. Todo el trabajo está en
 * `EscanerQrActivity`; esto es el puente.
 *
 * `escanear()` → `{ texto }`, o rechaza con el motivo (cancelado, sin permiso, cámara ocupada).
 * El permiso de cámara lo pide la Activity, no este plugin: es la única pantalla que lo usa y
 * pedirlo desde acá lo desacoplaría del momento en que se entiende para qué es.
 */
@CapacitorPlugin(name = "EscanerQr")
public class EscanerQrPlugin extends Plugin {

    @PluginMethod
    public void escanear(PluginCall call) {
        Intent i = new Intent(getContext(), EscanerQrActivity.class);
        startActivityForResult(call, i, "alVolver");
    }

    @ActivityCallback
    private void alVolver(PluginCall call, ActivityResult resultado) {
        if (call == null) return;
        Intent datos = resultado.getData();
        String texto = datos != null ? datos.getStringExtra(EscanerQrActivity.EXTRA_TEXTO) : null;
        if (texto != null && !texto.isEmpty()) {
            JSObject r = new JSObject();
            r.put("texto", texto);
            call.resolve(r);
            return;
        }
        String error = datos != null ? datos.getStringExtra(EscanerQrActivity.EXTRA_ERROR) : null;
        // Cancelar con el botón atrás no es un error del sistema, pero para el JS es el mismo
        // camino: no hay texto. Se distingue por el mensaje.
        call.reject(error != null ? error : "Escaneo cancelado");
    }
}
