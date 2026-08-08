package com.launion.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin local: la exención de batería (Doze) que mantiene vivo el GPS con la
        // pantalla bloqueada. Debe registrarse antes de super.onCreate().
        registerPlugin(BatteryOptimizationPlugin.class);
        // Plugin local: Activity Recognition, para saber si el vendedor se mueve y no
        // tener que dejar el GPS a máxima precisión toda la jornada. Mismo requisito:
        // antes de super.onCreate().
        registerPlugin(MovimientoPlugin.class);
        // Plugin local: watchdog OFFLINE por AlarmManager. Segundo canal (además del push
        // FCM) para despertar la app cada ~30 min SIN depender de internet. Ver
        // AlarmWatchdogPlugin. Mismo requisito de registro antes de super.onCreate().
        registerPlugin(AlarmWatchdogPlugin.class);
        // Plugin local SOLO LECTURA: fecha real de instalación del APK (PackageManager.firstInstallTime),
        // para mostrar en supervisión hace cuánto se instaló. Mismo requisito: antes de super.onCreate().
        registerPlugin(InfoAppPlugin.class);
        // Plugin local: uploader GPS NATIVO (Opción B). Captura + POST a la Edge Function sin pasar por
        // el WebView, para enviar ubicaciones con la pantalla bloqueada (Doze congela el JS). Ver
        // UploaderGpsService. Mismo requisito de registro antes de super.onCreate().
        registerPlugin(UploaderGpsPlugin.class);
        // Plugin local: updater del APK nativo. Descarga el .apk (GitHub Releases) y lanza el
        // instalador del sistema cuando un cambio nativo no lo puede cubrir la OTA. Ver
        // ApkUpdaterPlugin. Mismo requisito de registro antes de super.onCreate().
        registerPlugin(ApkUpdaterPlugin.class);
        // Plugin local: generación de QR en nativo (ZXing) para el modal "Invitar", sin sumar
        // una librería de QR al bundle web. Ver QrPlugin. Antes de super.onCreate().
        registerPlugin(QrPlugin.class);
        // Plugin local: PDF del informe de jornada imprimiendo el WebView (PrintManager), en vez de
        // sumar una librería de PDF que obligaría a dibujar el informe una segunda vez. Ver
        // ImpresionPlugin. Mismo requisito: antes de super.onCreate().
        registerPlugin(ImpresionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
