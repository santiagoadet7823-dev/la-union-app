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
        super.onCreate(savedInstanceState);
    }
}
