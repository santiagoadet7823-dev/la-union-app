package com.launion.app;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Plugin nativo mínimo de SOLO LECTURA: la fecha real de instalación del APK.
 *
 * Motivo (pedido del cliente 24/07/2026): que el supervisor vea hace cuánto se instaló la app en el
 * dispositivo de cada vendedor. `@capacitor/app` NO expone esto; la única fuente confiable es
 * PackageManager.firstInstallTime (epoch ms), que es RETROACTIVO (sirve para los equipos que ya la
 * tienen) y sobrevive a limpiezas de datos. No pide ningún permiso.
 *
 * Expone:
 *  - instalacion(): { firstInstall: number|null, lastUpdate: number|null }  (epoch ms, hora del SO)
 */
@CapacitorPlugin(name = "InfoApp")
public class InfoAppPlugin extends Plugin {

    @PluginMethod
    public void instalacion(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            PackageManager pm = getContext().getPackageManager();
            PackageInfo pi = pm.getPackageInfo(getContext().getPackageName(), 0);
            ret.put("firstInstall", pi.firstInstallTime);
            ret.put("lastUpdate", pi.lastUpdateTime);
        } catch (Exception e) {
            // Si por lo que sea no se puede leer, se devuelve null y el latido sube instalado_ts = null.
            ret.put("firstInstall", (Long) null);
            ret.put("lastUpdate", (Long) null);
        }
        call.resolve(ret);
    }
}
