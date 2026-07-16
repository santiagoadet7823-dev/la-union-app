package com.launion.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin nativo mínimo para la exención de optimización de batería (Doze).
 *
 * Motivo (diagnóstico 2026-07-14): sin esta exención, OEMs agresivos (Motorola)
 * matan el proceso + el foreground service a los segundos de bloquear la pantalla,
 * cortando la captura GPS. La exención mantiene vivo el proceso y el GPS sigue
 * registrando bloqueado (confirmado en dispositivo). El permiso
 * REQUEST_IGNORE_BATTERY_OPTIMIZATIONS ya está declarado en el manifest.
 *
 * Expone:
 *  - isIgnoring(): { ignoring: boolean }
 *  - request():    lanza el diálogo del sistema y devuelve el estado ACTUAL
 *                  (el usuario responde en otra pantalla → re-chequear con
 *                  isIgnoring() al volver a foreground).
 */
@CapacitorPlugin(name = "BatteryOptimization")
public class BatteryOptimizationPlugin extends Plugin {

    @PluginMethod
    public void isIgnoring(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoringBatteryOptimizations());
        call.resolve(ret);
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (!isIgnoringBatteryOptimizations() && Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Context ctx = getContext();
            try {
                Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(intent);
            } catch (Exception e) {
                // Algunos OEM no exponen el diálogo directo por-app: caer a la lista
                // general de optimización de batería para que el usuario la quite.
                try {
                    Intent fallback = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                    fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(fallback);
                } catch (Exception ignored) {}
            }
        }
        JSObject ret = new JSObject();
        ret.put("ignoring", isIgnoringBatteryOptimizations());
        call.resolve(ret);
    }

    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
