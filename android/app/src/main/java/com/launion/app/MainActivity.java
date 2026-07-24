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
        super.onCreate(savedInstanceState);
    }
}
