package com.launion.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugin local: la exención de batería (Doze) que mantiene vivo el GPS con la
        // pantalla bloqueada. Debe registrarse antes de super.onCreate().
        registerPlugin(BatteryOptimizationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
