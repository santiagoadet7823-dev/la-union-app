package com.launion.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;

/**
 * Bridge JS → UploaderGpsService (Opción B, 24/07/2026). El front, al loguear un rol que se trackea,
 * mintea el token de dispositivo (RPC mi_token_ingesta) y lo pasa acá; después arranca el servicio.
 * Ver services/uploaderNativo.js y UploaderGpsService.java.
 *
 * Métodos:
 *  - configurar({ token, url, intervaloMs, startMin, endMin, dias, minMoveM, keepAliveMs }): guarda
 *    credenciales + ventana horaria + filtro por movimiento del uploader.
 *  - iniciar():   arranca el foreground service (captura nativa + POST).
 *  - detener():   lo para (fuera de horario / logout).
 *  - estado():    { configurado, cola, ultimaOk } para diagnóstico en supervisión.
 */
@CapacitorPlugin(name = "UploaderGps")
public class UploaderGpsPlugin extends Plugin {

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(UploaderGpsService.PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void configurar(PluginCall call) {
        String token = call.getString("token");
        String url = call.getString("url");
        int intervaloMs = call.getInt("intervaloMs", 15000);
        // Ventana horaria (Fase 3): minutos del día + días ISO CSV. -1 = sin ventana (todo el día).
        int startMin = call.getInt("startMin", -1);
        int endMin = call.getInt("endMin", -1);
        String dias = call.getString("dias", "");
        // Filtro por movimiento (26/07/2026): defaults = gpsConfig.MIN_MOVE_M / STATIONARY_KEEPALIVE_MS.
        int minMoveM = call.getInt("minMoveM", 12);
        int keepAliveMs = call.getInt("keepAliveMs", 60000);
        if (token == null || url == null) { call.reject("faltan-token-o-url"); return; }
        prefs().edit()
            .putString(UploaderGpsService.K_TOKEN, token)
            .putString(UploaderGpsService.K_URL, url)
            .putLong(UploaderGpsService.K_INTERVALO, intervaloMs)
            .putInt(UploaderGpsService.K_START, startMin)
            .putInt(UploaderGpsService.K_END, endMin)
            .putString(UploaderGpsService.K_DIAS, dias == null ? "" : dias)
            .putInt(UploaderGpsService.K_MIN_MOVE, minMoveM)
            .putInt(UploaderGpsService.K_KEEPALIVE, keepAliveMs)
            .apply();
        call.resolve();
    }

    @PluginMethod
    public void iniciar(PluginCall call) {
        Intent i = new Intent(getContext(), UploaderGpsService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(i);
        } else {
            getContext().startService(i);
        }
        call.resolve();
    }

    @PluginMethod
    public void detener(PluginCall call) {
        getContext().stopService(new Intent(getContext(), UploaderGpsService.class));
        call.resolve();
    }

    @PluginMethod
    public void estado(PluginCall call) {
        SharedPreferences sp = prefs();
        JSObject ret = new JSObject();
        ret.put("configurado", sp.getString(UploaderGpsService.K_TOKEN, null) != null);
        ret.put("ultimaOk", sp.getLong(UploaderGpsService.K_ULTIMA, 0));
        try {
            ret.put("cola", new JSONArray(sp.getString(UploaderGpsService.K_COLA, "[]")).length());
        } catch (Exception e) {
            ret.put("cola", -1);
        }
        call.resolve(ret);
    }
}
