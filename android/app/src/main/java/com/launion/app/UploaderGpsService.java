package com.launion.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Uploader GPS NATIVO (Opción B, 24/07/2026) — foreground service propio que captura con FusedLocation
 * y hace el POST directo a la Edge Function `ingest-posiciones`, SIN pasar por el WebView. Ese es el
 * punto: cuando el OEM congela el WebView en Doze (pantalla bloqueada), el JS deja de subir; esto NO,
 * porque captura y postea en código nativo. Autentica con un token de dispositivo (SharedPreferences,
 * lo setea UploaderGpsPlugin.configurar desde el JS al loguear). Cola en SharedPreferences → sobrevive
 * al kill del proceso; reintenta cuando vuelve la red.
 *
 * VERSIÓN "AL LADO" (Fase 2 de validación): corre en paralelo a la captura JS existente para PROBAR
 * en el device real que sobrevive el Doze del OEM y sube bloqueado. Si funciona, se consolida (nativo
 * como fuente única). Ver [[uploader-gps-nativo-opcion-b]].
 */
public class UploaderGpsService extends Service {
    static final String PREFS = "uploader_gps";
    static final String K_TOKEN = "token";
    static final String K_URL = "url";
    static final String K_INTERVALO = "intervaloMs";
    static final String K_COLA = "cola";       // JSON array de puntos pendientes de subir
    static final String K_ULTIMA = "ultimaOk";  // epoch ms de la última subida OK (diagnóstico)
    // Ventana horaria (Fase 3): mismos valores que app_config (los pasa el JS en configurar()).
    static final String K_START = "startMin";  // minuto del día de inicio (7:30 = 450). -1 = sin ventana
    static final String K_END = "endMin";      // minuto del día de fin (18:00 = 1080)
    static final String K_DIAS = "dias";        // CSV ISO "1,2,3,4,5,6" (Lun-Sáb). vacío = todos
    // Filtro por movimiento (26/07/2026): mismos valores que el pipeline JS (gpsConfig.MIN_MOVE_M /
    // STATIONARY_KEEPALIVE_MS), los pasa el JS en configurar() → ajustables por OTA sin recompilar.
    static final String K_MIN_MOVE = "minMoveM";     // metros mínimos de desplazamiento para GUARDAR un punto
    static final String K_KEEPALIVE = "keepAliveMs"; // estando quieto, guardar igual cada tanto (marcador "vivo")
    // Cadencia ADAPTATIVA por velocidad (27/07/2026): a 15 s de captura, en auto un fix cada ~165 m → el
    // trazo une esos puntos con una recta que cruza la manzana. Sobre K_VEL_UMBRAL m/s la captura sube a
    // K_INTERVALO_RAPIDO ms (más puntos en curvas/avenidas) y vuelve a K_INTERVALO al frenar. Los pasa el
    // JS en configurar() → afinables por OTA sin recompilar (gpsConfig.NEAR_LIVE_RAPIDO_MS/VEL_UMBRAL_MPS/VEL_HIST_MS).
    static final String K_INTERVALO_RAPIDO = "intervaloRapidoMs"; // cadencia de captura en movimiento rápido
    static final String K_VEL_UMBRAL = "velUmbralMps";            // m/s por encima del cual se activa la cadencia rápida
    static final String K_VEL_HIST = "velHistMs";                 // ms sostenidos bajo el umbral antes de volver a lento

    private static final String CH_ID = "uploader_gps";
    private static final int NOTIF_ID = 5190;
    private static final int MAX_COLA = 5000;   // tope de seguridad si nunca hay red (no crecer infinito)
    private static final int LOTE = 200;        // igual al BATCH de la cola JS
    // Precisión: descartar fixes peores que esto (mismo criterio que gpsConfig.ACCURACY_MAX_M=30 en JS,
    // regla 18): un fix impreciso mete "vueltas" falsas en el recorrido. Sin esto el uploader nativo
    // subiría ruido que el pipeline JS sí filtraba.
    private static final float ACCURACY_MAX_M = 30f;

    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private final ExecutorService pool = Executors.newSingleThreadExecutor();
    private final AtomicBoolean subiendo = new AtomicBoolean(false);

    // Filtro por movimiento (espejo de procesarFix en tracker.js): último punto GUARDADO + cuándo. Se
    // encola solo si se movió >= minMove, o si pasó keepAlive estando quieto (marcador "vivo"). Vive en
    // memoria: si el SO mata el servicio, al re-arrancar se pierde y a lo sumo se guarda un punto extra.
    private double lastLat, lastLng;
    private long lastSentAt = 0L;
    private boolean tieneLast = false;

    // Cadencia adaptativa: último FIX crudo (todos, no solo los guardados) para estimar velocidad si el fix
    // no trae getSpeed(), + estado del modo rápido con su histéresis. En memoria: si el SO mata el servicio,
    // al re-arrancar vuelve a modo lento y se re-evalúa con los primeros fixes (a lo sumo un tramo corto ralo).
    private double lastFixLat, lastFixLng;
    private long lastFixTime = 0L;
    private boolean tieneFix = false;
    private boolean modoRapido = false;
    private long ultimoRapidoAt = 0L;

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        fused = LocationServices.getFusedLocationProviderClient(this);
        crearCanal();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        arrancarForeground();
        arrancarUpdates();
        // START_STICKY: si el SO mata el servicio, que lo reintente cuando pueda.
        return START_STICKY;
    }

    private void arrancarForeground() {
        Notification n = construirNotificacion("Enviando ubicación…");
        // API 34+ exige declarar el tipo de foreground service en el arranque además del manifest.
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIF_ID, n);
        }
    }

    private void arrancarUpdates() {
        if (callback != null) return;
        callback = new LocationCallback() {
            @Override public void onLocationResult(@Nullable LocationResult result) {
                if (result == null) return;
                // Fuera de la ventana (7-18 Lun-Sáb): el servicio se APAGA solo. Si no, con el teléfono
                // bloqueado a las 18:00 el JS no puede llamar detener() y el GPS drenaría toda la noche.
                // Vuelve a arrancar cuando el vendedor abre la app a la mañana (o por boot). La ventana
                // la pasa el JS en configurar().
                if (!dentroDeVentana()) { detenerServicio(); return; }
                SharedPreferences sp = prefs();
                float minMove = sp.getInt(K_MIN_MOVE, 12);        // metros; default = gpsConfig.MIN_MOVE_M
                long keepAlive = sp.getInt(K_KEEPALIVE, 30000);   // ms; default = STATIONARY_KEEPALIVE_MS (30 s)
                for (Location loc : result.getLocations()) {
                    // Filtro de precisión: descartar fixes imprecisos (regla 18) para no meter ruido.
                    if (loc.hasAccuracy() && loc.getAccuracy() > ACCURACY_MAX_M) continue;
                    long now = System.currentTimeMillis();
                    // Cadencia adaptativa por velocidad: se mide sobre TODOS los fixes crudos (antes del
                    // filtro por movimiento, que decide qué se GUARDA). Si va rápido, sube la cadencia de
                    // captura para que el trazo no cruce manzanas; al frenar, vuelve a la lenta.
                    evaluarCadencia(velocidadMps(loc), now, sp);
                    lastFixLat = loc.getLatitude();
                    lastFixLng = loc.getLongitude();
                    lastFixTime = loc.getTime();
                    tieneFix = true;
                    // Filtro por movimiento (espejo de tracker.js): guardar solo si se movió, o cada
                    // keepAlive estando quieto. Recorta el volumen de un vendedor parado sin perder el
                    // trazo en movimiento. La CAPTURA sigue a intervaloMs (marcador fluido moviéndose).
                    boolean movio = !tieneLast || haversine(lastLat, lastLng, loc.getLatitude(), loc.getLongitude()) >= minMove;
                    boolean vivo = tieneLast && (now - lastSentAt) >= keepAlive;
                    if (!movio && !vivo) continue;
                    lastLat = loc.getLatitude();
                    lastLng = loc.getLongitude();
                    lastSentAt = now;
                    tieneLast = true;
                    encolar(loc);
                }
                subir();
            }
        };
        modoRapido = false; // cada arranque parte en cadencia lenta; los primeros fixes la re-evalúan
        pedirUpdates(prefs().getLong(K_INTERVALO, 10000L));
    }

    /**
     * (Re)pide fixes al FusedLocation con el intervalo dado, reutilizando el MISMO callback. Cambiar la
     * cadencia en caliente es seguro con el foreground service ya vivo: NO hay el hueco break-before-make
     * que mata el FGS (ese riesgo es levantar el servicio desde background, no re-pedir updates). Volver a
     * llamar requestLocationUpdates con el mismo callback reemplaza el LocationRequest anterior.
     */
    private void pedirUpdates(long intervalo) {
        if (callback == null) return;
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalo)
            .setMinUpdateIntervalMillis(intervalo)
            .build();
        try {
            fused.requestLocationUpdates(req, callback, Looper.getMainLooper());
        } catch (SecurityException e) {
            // Sin permiso de ubicación no hay nada que capturar; el servicio queda vivo por si se concede.
        }
    }

    /**
     * Velocidad en m/s del fix: getSpeed() del chip si viene (lo normal con HIGH_ACCURACY), si no la
     * estima por haversine contra el último fix crudo. 0 en el primer fix (sin referencia).
     */
    private double velocidadMps(Location loc) {
        if (loc.hasSpeed() && loc.getSpeed() > 0f) return loc.getSpeed();
        if (tieneFix) {
            long dt = loc.getTime() - lastFixTime;
            if (dt > 0) return haversine(lastFixLat, lastFixLng, loc.getLatitude(), loc.getLongitude()) / (dt / 1000.0);
        }
        return 0.0;
    }

    /**
     * Ajusta la cadencia de captura según la velocidad, con histéresis ASIMÉTRICA (misma filosofía que
     * estados.js: ante la duda, MÁS densidad). Pasa a rápido apenas supera el umbral; vuelve a lento solo
     * tras `velHistMs` sostenidos por debajo. Solo re-pide updates cuando el modo REALMENTE cambia (no en
     * cada fix). Los valores (rápido/umbral/histéresis) los pasa el JS por prefs → afinables por OTA.
     */
    private void evaluarCadencia(double v, long now, SharedPreferences sp) {
        double umbral = sp.getFloat(K_VEL_UMBRAL, 4.0f);
        long histMs = sp.getInt(K_VEL_HIST, 20000);
        if (v >= umbral) {
            ultimoRapidoAt = now;
            if (!modoRapido) {
                modoRapido = true;
                pedirUpdates(sp.getInt(K_INTERVALO_RAPIDO, 5000));
            }
        } else if (modoRapido && (now - ultimoRapidoAt) >= histMs) {
            modoRapido = false;
            pedirUpdates(sp.getLong(K_INTERVALO, 10000L));
        }
    }

    private synchronized void encolar(Location loc) {
        try {
            SharedPreferences sp = prefs();
            JSONArray cola = new JSONArray(sp.getString(K_COLA, "[]"));
            JSONObject p = new JSONObject();
            p.put("lat", loc.getLatitude());
            p.put("lng", loc.getLongitude());
            p.put("ts", loc.getTime());                 // epoch ms del fix (la función acepta ms o ISO)
            if (loc.hasAccuracy()) p.put("accuracy", loc.getAccuracy());
            int bat = nivelBateria();                   // % de batería (nativo, no depende del WebView)
            if (bat >= 0) p.put("bateria", bat);
            p.put("client_uid", UUID.randomUUID().toString()); // client_uid es uuid en `posiciones`
            cola.put(p);
            while (cola.length() > MAX_COLA) cola.remove(0); // descartar los más viejos si desbordó
            sp.edit().putString(K_COLA, cola.toString()).apply();
        } catch (Exception ignored) {}
    }

    private void subir() {
        if (subiendo.getAndSet(true)) return;   // una sola subida a la vez
        pool.execute(() -> {
            try { subirLote(); } catch (Exception ignored) {} finally { subiendo.set(false); }
        });
    }

    private synchronized JSONArray leerCola() throws Exception {
        return new JSONArray(prefs().getString(K_COLA, "[]"));
    }

    private synchronized void quitarPrimeros(int n) {
        try {
            JSONArray cola = new JSONArray(prefs().getString(K_COLA, "[]"));
            JSONArray resto = new JSONArray();
            for (int i = n; i < cola.length(); i++) resto.put(cola.get(i));
            prefs().edit().putString(K_COLA, resto.toString()).apply();
        } catch (Exception ignored) {}
    }

    private void subirLote() throws Exception {
        SharedPreferences sp = prefs();
        String token = sp.getString(K_TOKEN, null);
        String url = sp.getString(K_URL, null);
        if (token == null || url == null) return;
        JSONArray cola = leerCola();
        if (cola.length() == 0) return;
        int lote = Math.min(cola.length(), LOTE);
        JSONArray puntos = new JSONArray();
        for (int i = 0; i < lote; i++) puntos.put(cola.get(i));
        JSONObject body = new JSONObject();
        body.put("token", token);
        body.put("puntos", puntos);

        HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
        try {
            con.setRequestMethod("POST");
            con.setRequestProperty("Content-Type", "application/json");
            con.setConnectTimeout(15000);
            con.setReadTimeout(20000);
            con.setDoOutput(true);
            try (OutputStream os = con.getOutputStream()) {
                os.write(body.toString().getBytes("UTF-8"));
            }
            int code = con.getResponseCode();
            if (code >= 200 && code < 300) {
                quitarPrimeros(lote);
                sp.edit().putLong(K_ULTIMA, System.currentTimeMillis()).apply();
                actualizarNotif();
                // Si quedaban más que el lote (venía de estar offline), seguir vaciando.
                if (leerCola().length() > 0) subirLote();
            }
            // Si falló (sin red / 5xx), NO se borra la cola: se reintenta en la próxima captura.
        } finally {
            con.disconnect();
        }
    }

    // ---- notificación ----

    private void crearCanal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CH_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CH_ID, "Rastreo de ubicación", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private Notification construirNotificacion(String texto) {
        return new NotificationCompat.Builder(this, CH_ID)
            .setContentTitle("LA UNIÓN · rastreo activo")
            .setContentText(texto)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }

    private void actualizarNotif() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, construirNotificacion("Enviando ubicación en vivo"));
    }

    /**
     * ¿Ahora cae dentro de la ventana de rastreo? Misma lógica que dentroDeHorario() del JS pero en
     * nativo, para que el servicio no dependa del WebView. Hora y día en LOCAL (no UTC). start=-1 = sin
     * ventana (todo el día/semana).
     */
    private boolean dentroDeVentana() {
        SharedPreferences sp = prefs();
        int start = sp.getInt(K_START, -1);
        int end = sp.getInt(K_END, -1);
        if (start < 0 || end < 0) return true; // sin ventana configurada → siempre
        java.util.Calendar c = java.util.Calendar.getInstance(); // zona horaria local del dispositivo
        int cur = c.get(java.util.Calendar.HOUR_OF_DAY) * 60 + c.get(java.util.Calendar.MINUTE);
        // Día ISO: Calendar.DAY_OF_WEEK es 1=Dom..7=Sáb → convertir a 1=Lun..7=Dom.
        int dow = c.get(java.util.Calendar.DAY_OF_WEEK); // 1=Dom
        int iso = dow == java.util.Calendar.SUNDAY ? 7 : dow - 1;
        String dias = sp.getString(K_DIAS, "");
        if (dias != null && !dias.isEmpty()) {
            boolean hoy = false;
            for (String d : dias.split(",")) {
                try { if (Integer.parseInt(d.trim()) == iso) { hoy = true; break; } } catch (Exception ignored) {}
            }
            if (!hoy) return false;
        }
        return start <= end ? (cur >= start && cur <= end) : (cur >= start || cur <= end);
    }

    /** % de batería 0-100, o -1 si no se puede leer. Nativo (BatteryManager): no depende del WebView,
     *  a diferencia de navigator.getBattery() del pipeline JS, que muere congelado en Doze. */
    private int nivelBateria() {
        try {
            BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
            if (bm != null) {
                int lvl = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
                if (lvl >= 0 && lvl <= 100) return lvl;
            }
        } catch (Exception ignored) {}
        return -1;
    }

    /** Distancia en metros entre dos coordenadas (haversine). Espejo de geofence.distanciaMetros del JS,
     *  para que el filtro por movimiento nativo use el mismo criterio que procesarFix. */
    private static double haversine(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
            * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(a)));
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Apaga el servicio por completo (fuera de ventana): corta el GPS y se saca de foreground. */
    private void detenerServicio() {
        try { if (callback != null) fused.removeLocationUpdates(callback); } catch (Exception ignored) {}
        callback = null;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) stopForeground(Service.STOP_FOREGROUND_REMOVE);
            else stopForeground(true);
        } catch (Exception ignored) {}
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (callback != null) {
            try { fused.removeLocationUpdates(callback); } catch (Exception ignored) {}
            callback = null;
        }
        super.onDestroy();
    }
}
