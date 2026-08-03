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
 *  - configurar({ token, url, intervaloMs, startMin, endMin, dias, minMoveM, keepAliveMs,
 *    intervaloRapidoMs, velUmbralMps, velHistMs }): guarda credenciales + ventana horaria + filtro por
 *    movimiento + cadencia adaptativa por velocidad del uploader.
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
        // Cadencia adaptativa por velocidad (27/07/2026): el servicio sube la cadencia de captura sobre el
        // umbral de velocidad (auto) para que el trazo siga la calle, y vuelve a intervaloMs al frenar.
        // Defaults = gpsConfig.NEAR_LIVE_RAPIDO_MS / VEL_UMBRAL_MPS / VEL_HIST_MS. Afinables por OTA.
        int intervaloRapidoMs = call.getInt("intervaloRapidoMs", 5000);
        // velUmbralMps llega como float (m/s) desde el JS; getInt lo truncaría a 0 con 4.0 → usar getDouble.
        double velUmbralMps = call.getDouble("velUmbralMps", 4.0);
        int velHistMs = call.getInt("velHistMs", 20000);
        // Umbrales de descarte (1.8.0): afinables por OTA. Los defaults son los valores hardcodeados
        // de siempre. ⚠️ accuracyMaxM se puede SUBIR en un modelo con GPS malo; bajarlo vacía los
        // recorridos (regla 18).
        double accuracyMaxM = call.getDouble("accuracyMaxM", 30.0);
        double maxSpeedMps = call.getDouble("maxSpeedMps", 45.0);
        double minJumpM = call.getDouble("minJumpM", 9.0);
        int maxSaltosSeguidos = call.getInt("maxSaltosSeguidos", 3);
        // 1.9.0 — guardado por distancia según el modo, carril de triangulación y anti-churn. Los
        // defaults son los que valían antes de que existieran, así que un APK nuevo con un bundle
        // viejo se comporta igual que hoy. Ver los comentarios de UploaderGpsService.
        int minMoveUrbanoM = call.getInt("minMoveUrbanoM", 15);
        int minMoveRutaM = call.getInt("minMoveRutaM", 100);
        double velRutaMps = call.getDouble("velRutaMps", 11.0);
        int intervaloQuietoMs = call.getInt("intervaloQuietoMs", 30000);
        double accuracyRedMaxM = call.getDouble("accuracyRedMaxM", 150.0);
        int silencioMs = call.getInt("silencioMs", 90000);
        int repedidoMinMs = call.getInt("repedidoMinMs", 60000);
        // Dueño de los puntos que capture esta sesión (id_usuario). Es lo que impide que la cola de
        // una cuenta se suba con el token de otra: ver K_DUENO en UploaderGpsService.
        String dueno = call.getString("dueno");
        if (token == null || url == null) { call.reject("faltan-token-o-url"); return; }
        // La cola pendiente puede ser de la cuenta anterior: se separa ANTES de tocar el token, para
        // que ni un punto llegue a subirse con la identidad equivocada. Idempotente: si es el mismo
        // dueño de siempre no mueve nada, y de paso le devuelve lo que tuviera en cuarentena.
        UploaderGpsService.cambiarDueno(getContext(), dueno);
        prefs().edit()
            .putString(UploaderGpsService.K_DUENO, dueno) // null borra la clave (sin dueño conocido)
            .putString(UploaderGpsService.K_TOKEN, token)
            .putString(UploaderGpsService.K_URL, url)
            .putLong(UploaderGpsService.K_INTERVALO, intervaloMs)
            .putInt(UploaderGpsService.K_START, startMin)
            .putInt(UploaderGpsService.K_END, endMin)
            .putString(UploaderGpsService.K_DIAS, dias == null ? "" : dias)
            .putString(UploaderGpsService.K_VENTANAS, call.getString("ventanas", ""))
            .putInt(UploaderGpsService.K_MIN_MOVE, minMoveM)
            .putInt(UploaderGpsService.K_KEEPALIVE, keepAliveMs)
            .putInt(UploaderGpsService.K_INTERVALO_RAPIDO, intervaloRapidoMs)
            .putFloat(UploaderGpsService.K_VEL_UMBRAL, (float) velUmbralMps)
            .putInt(UploaderGpsService.K_VEL_HIST, velHistMs)
            .putFloat(UploaderGpsService.K_ACCURACY_MAX, (float) accuracyMaxM)
            .putFloat(UploaderGpsService.K_MAX_SPEED, (float) maxSpeedMps)
            .putFloat(UploaderGpsService.K_MIN_JUMP, (float) minJumpM)
            .putInt(UploaderGpsService.K_MAX_SALTOS, maxSaltosSeguidos)
            .putInt(UploaderGpsService.K_MIN_MOVE_URBANO, minMoveUrbanoM)
            .putInt(UploaderGpsService.K_MIN_MOVE_RUTA, minMoveRutaM)
            .putFloat(UploaderGpsService.K_VEL_RUTA, (float) velRutaMps)
            .putInt(UploaderGpsService.K_INTERVALO_QUIETO, intervaloQuietoMs)
            .putFloat(UploaderGpsService.K_ACCURACY_RED_MAX, (float) accuracyRedMaxM)
            .putInt(UploaderGpsService.K_SILENCIO_MS, silencioMs)
            .putInt(UploaderGpsService.K_REPEDIDO_MIN_MS, repedidoMinMs)
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

    /**
     * 🩸 CIERRE DE SESIÓN (02/08/2026) — el arreglo del bug de multi-cuenta.
     *
     * `detener()` no alcanzaba: para el uploader el token ES la identidad, y quedaba en las prefs
     * después de cerrar sesión. Con eso, BootReceiver y AlarmReceiver (cada 30 min) volvían a
     * levantar el servicio —los dos arrancan con solo ver un token, sin saber quién está logueado ni
     * si hay alguien— y el teléfono seguía subiendo posiciones a nombre de la cuenta anterior. Eso es
     * lo que hacía aparecer "enviando ubicación" estando en superadmin, y puntos de LA UNIÓN estando
     * en otra empresa.
     *
     * Borrar el token es lo que apaga esa resurrección de raíz, sin agregar otra bandera que después
     * haya que mantener sincronizada.
     *
     * La COLA NO SE TOCA (regla 20): los puntos sin subir siguen siendo de su dueño y esperan en la
     * cola. Si vuelve a entrar esa cuenta, se suben; si entra otra, `cambiarDueno` los manda a
     * cuarentena y vuelven cuando corresponda.
     */
    @PluginMethod
    public void cerrarSesion(PluginCall call) {
        getContext().stopService(new Intent(getContext(), UploaderGpsService.class));
        prefs().edit()
            .remove(UploaderGpsService.K_TOKEN)
            .remove(UploaderGpsService.K_DUENO)
            .apply();
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
        // Quién es el dueño de lo que se está capturando, y cuántos puntos quedaron apartados por ser
        // de otra cuenta. Se exponen para que el desfase se pueda VER en el diagnóstico en vez de
        // descubrirse por un recorrido raro en el mapa de otra persona.
        ret.put("dueno", sp.getString(UploaderGpsService.K_DUENO, null));
        try {
            ret.put("cuarentena", new JSONArray(sp.getString(UploaderGpsService.K_CUARENTENA, "[]")).length());
        } catch (Exception e) {
            ret.put("cuarentena", -1);
        }
        // Diagnóstico de red (1.7.0+): POR QUÉ el teléfono se quedó callado. Lo sube el latido
        // (useEstadoDispositivo) y termina en el `motivo` del aviso al supervisor.
        //
        // Se lee, no se calcula: el estado lo escribe el servicio en el momento en que falla el
        // POST. Calcularlo acá diría cómo está la red AHORA —cuando la app está abierta y por lo
        // tanto casi seguro con red— y no cómo estuvo durante el hueco, que es lo que interesa.
        ret.put("red", sp.getString(UploaderGpsService.K_RED, null));
        ret.put("redDesde", sp.getLong(UploaderGpsService.K_RED_DESDE, 0));
        ret.put("arranqueTs", sp.getLong(UploaderGpsService.K_ARRANQUE, 0));
        ret.put("apagadoTs", sp.getLong(UploaderGpsService.K_APAGADO, 0));
        // Telemetría de captura (1.8.0). La base solo guarda los puntos que SOBREVIVIERON, así que sin
        // esto no hay forma de distinguir "el filtro de movimiento descartó" de "el sistema operativo
        // no entregó fixes" — y son arreglos opuestos. `fixes` vs `guardados` da la tasa real de
        // aprovechamiento; `ultimoFixAt` dice si el chip sigue entregando aunque no se guarde nada.
        ret.put("fixes", sp.getInt(UploaderGpsService.K_TEL_FIXES, 0));
        ret.put("descPrecision", sp.getInt(UploaderGpsService.K_TEL_PRECISION, 0));
        ret.put("descSalto", sp.getInt(UploaderGpsService.K_TEL_SALTO, 0));
        ret.put("descMovimiento", sp.getInt(UploaderGpsService.K_TEL_MOVIMIENTO, 0));
        ret.put("guardados", sp.getInt(UploaderGpsService.K_TEL_GUARDADOS, 0));
        ret.put("ultimoFixAt", sp.getLong(UploaderGpsService.K_TEL_ULTIMO_FIX, 0));
        // 1.9.0 — los cuatro que faltaban para poder distinguir "el SO no entrega" de "nos peleamos
        // con la cadencia". `intervalo` es lo que se le está PIDIENDO al proveedor: contra la
        // cadencia real (que sale de la base) dice si el pedido se está respetando. `repedidos`
        // delata el churn de requests. `silencioMax` es el hueco más largo del día — el número que
        // dice si el WakeLock sirvió. `fixesRed` cuenta lo que aportó la triangulación.
        ret.put("intervalo", sp.getLong(UploaderGpsService.K_TEL_INTERVALO, 0));
        ret.put("repedidos", sp.getInt(UploaderGpsService.K_TEL_REPEDIDOS, 0));
        ret.put("silencioMax", sp.getLong(UploaderGpsService.K_TEL_SILENCIO_MAX, 0));
        ret.put("fixesRed", sp.getInt(UploaderGpsService.K_TEL_RED, 0));
        call.resolve(ret);
    }
}
