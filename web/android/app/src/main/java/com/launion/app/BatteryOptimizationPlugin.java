package com.launion.app;

import android.content.ComponentName;
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

    /**
     * Abre la pantalla de "inicio automático / autostart" del OEM. En Xiaomi/Huawei/Oppo/Vivo/etc.
     * el autostart es una lista APARTE de la exención de batería: sin él, el SO mata el proceso en
     * segundo plano y el foreground service del GPS deja de capturar (síntoma: captura solo a
     * ráfagas al abrir la app; diagnóstico 21/07/2026 con un Moto/Xiaomi). Cada marca tiene su
     * propia Activity y cambian por versión, así que se prueban en orden con startActivity directo
     * (no resolveActivity: en Android 11+ la visibilidad de paquetes puede ocultarla aunque exista)
     * y la primera que no tire ActivityNotFoundException gana. Si ninguna, cae al detalle de la app.
     */
    @PluginMethod
    public void abrirAutostart(PluginCall call) {
        Context ctx = getContext();
        String[][] comps = new String[][] {
            {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},              // Xiaomi/Redmi/POCO (MIUI)
            {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},   // Huawei/Honor (EMUI)
            {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
            {"com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity"},                // Oppo/Realme (ColorOS)
            {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
            {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
            {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},        // Vivo
            {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
            {"com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"},                     // Letv
        };
        boolean lanzado = false;
        for (String[] c : comps) {
            try {
                Intent i = new Intent();
                i.setComponent(new ComponentName(c[0], c[1]));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(i);
                lanzado = true;
                break;
            } catch (Exception ignored) { /* esa marca/versión no la tiene → probar la siguiente */ }
        }
        if (!lanzado) {
            // Fallback universal: detalle de la app (desde ahí el usuario llega a batería/arranque).
            try {
                Intent fb = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                fb.setData(Uri.parse("package:" + ctx.getPackageName()));
                fb.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(fb);
                lanzado = true;
            } catch (Exception ignored) {}
        }
        JSObject ret = new JSObject();
        ret.put("abierto", lanzado);
        call.resolve(ret);
    }

    private boolean isIgnoringBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }
}
