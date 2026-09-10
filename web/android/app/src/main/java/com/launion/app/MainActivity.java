package com.launion.app;

import android.os.Bundle;
import android.view.ActionMode;

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
        // Plugin local: VIDRIERA, lado celular. Levanta un hotspot local (sin salida a internet) y
        // sirve el catálogo a la tablet del cliente, para que ella no consuma un solo byte de datos.
        // Ver EnlaceLocalPlugin y ServidorLocal. Mismo requisito: antes de super.onCreate().
        registerPlugin(EnlaceLocalPlugin.class);
        // Plugin local: VIDRIERA, lado TABLET. Se une al hotspot del vendedor (dos caminos según la
        // version de Android, ver EnlaceTabletPlugin) y le habla al servidor local por HTTP nativo,
        // porque el WebView bloquea el contenido mixto. Antes de super.onCreate().
        registerPlugin(EnlaceTabletPlugin.class);
        // Plugin local: escaner de QR (CameraX + el decodificador de ZXing que ya estaba).
        registerPlugin(EscanerQrPlugin.class);
        // Plugin local: VIDRIERA por BLUETOOTH — el camino alternativo al QR. Pasa SOLO el sobre de
        // la red (~120 bytes); el catalogo y las fotos siguen por WiFi. Ver EnlaceBluetoothPlugin.
        registerPlugin(EnlaceBluetoothPlugin.class);
        super.onCreate(savedInstanceState);

    }

    /**
     * El menu flotante "Traducir / Copiar / Cortar" del WebView (09/09/2026).
     *
     * El vendedor tocaba el campo de cantidad para escribir y le aparecia esa barra tapandole la
     * grilla, con el comerciante enfrente. La causa de raiz estaba del lado web y ya se corrigio
     * ahi (CantidadInput ya no hace select() al enfocar, asi que no queda texto seleccionado);
     * esto es el cinturon para el camino que queda: el toque largo sobre cualquier texto.
     *
     * ⚠️ NO se puede hacer con setCustomSelectionActionModeCallback: ese metodo es de TextView, no
     * de WebView (el WebView dibuja su propia seleccion). El punto de intercepcion que si existe
     * para toda la Activity es este: el ActionMode arranca y lo cerramos antes de que se pinte.
     * Ojo con "arreglarlo" volviendo a la version del WebView — no compila.
     *
     * ⚠️ Esto apaga el menu de seleccion en TODA la app, o sea que tampoco se puede copiar texto
     * desde ninguna pantalla. Se acepto porque no hay ninguna que dependa de eso (el codigo de
     * invitacion se comparte con el boton Compartir, no copiandolo a mano). Si manana alguna lo
     * necesita, esto tiene que pasar a acotarse por vista en vez de quedar global.
     */
    @Override
    public void onActionModeStarted(ActionMode mode) {
        if (mode != null) mode.finish();
        // No se llama a super: super es justamente el que lo deja instalado.
    }
}