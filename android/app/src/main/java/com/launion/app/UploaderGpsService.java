package com.launion.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;

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
    // JORNADA PARTIDA (1.8.0): varias ventanas, "inicio-fin-dias;inicio-fin-dias" con los minutos del
    // día y los días ISO por coma. Ej: "480-720-1,2,3,4,5;960-1200-1,2,3,4,5" = 8-12 y 16-20 Lun-Vie.
    // Semántica de UNIÓN: se rastrea si CUALQUIERA aplica, así el hueco del mediodía no se rastrea.
    // Si está vacía se usan K_START/K_END/K_DIAS (una sola ventana, como siempre).
    static final String K_VENTANAS = "ventanas";
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
    // 🩸 DIAGNÓSTICO DE RED (30/07/2026). Por qué el teléfono se quedó callado: sin internet, en
    // modo avión, o se reinició. Lo tiene que saber el NATIVO — el WebView congelado en Doze no
    // puede observar nada, y `navigator.onLine` miente en este WebView (regla 12).
    //
    // El límite honesto, que hay que tener presente antes de confiar en esto: el teléfono solo
    // puede CONTAR que estuvo sin red cuando VUELVE a tener red. Sirve para explicar un silencio
    // después, nunca para detectarlo mientras pasa. De eso se ocupa `vigilancia_equipo` en el
    // servidor, que ve la ausencia de datos en tiempo real. Las dos mitades son necesarias.
    static final String K_RED = "red";              // 'ok' | 'sin-red' | 'avion'
    static final String K_RED_DESDE = "redDesde";   // epoch ms desde que está en ese estado
    static final String K_APAGADO = "apagadoTs";    // epoch ms del último ACTION_SHUTDOWN (best-effort)
    static final String K_ARRANQUE = "arranqueTs";  // epoch ms del último BOOT_COMPLETED

    // 🩸 DUEÑO DE LA COLA (02/08/2026) — el bug de multi-cuenta.
    //
    // `ingest-posiciones` saca id_usuario Y id_empresa del TOKEN, no del punto: el cliente no puede
    // falsear a quién, pero tampoco puede corregirlo. Y la cola no guardaba de quién era cada punto,
    // así que puntos capturados por A que se subían con el token de B quedaban atribuidos a B —
    // en `posiciones`, que no tiene policy de UPDATE ni de DELETE. Esas filas no se arreglan.
    //
    // Es la regla 19/20 de CLAUDE.md, ya resuelta en la cola JS (queue.js), aplicada a un lugar que
    // nunca la recibió. Mismo criterio: el punto que no es de la sesión actual NO SE BORRA, va a
    // cuarentena, y vuelve solo si esa cuenta reingresa en este teléfono.
    static final String K_DUENO = "dueno";           // id_usuario del token vigente (quién captura hoy)
    static final String K_CUARENTENA = "cuarentena";  // JSON array de puntos de OTRA cuenta (recuperables)

    // Umbrales de descarte, ahora por prefs → afinables por OTA sin recompilar (regla 22-ter). Los
    // defaults son EXACTAMENTE los valores hardcodeados de antes, así que desplegar esto no cambia
    // nada por sí solo. ⚠️ `accuracyMaxM` está acá para poder SUBIRLO en un modelo con GPS malo;
    // bajarlo vacía los recorridos (regla 18).
    static final String K_ACCURACY_MAX = "accuracyMaxM";
    static final String K_MAX_SPEED = "maxSpeedMps";
    static final String K_MIN_JUMP = "minJumpM";
    static final String K_MAX_SALTOS = "maxSaltosSeguidos";

    // Telemetría de descartes: sin esto no se puede saber si los huecos del trazo los hace el filtro
    // de movimiento o el sistema operativo estrangulando los fixes. Ver los contadores en memoria.
    static final String K_TEL_FIXES = "telFixes";
    static final String K_TEL_PRECISION = "telDescPrecision";
    static final String K_TEL_SALTO = "telDescSalto";
    static final String K_TEL_MOVIMIENTO = "telDescMovimiento";
    static final String K_TEL_GUARDADOS = "telGuardados";
    static final String K_TEL_ULTIMO_FIX = "telUltimoFixAt";

    private static final String CH_ID = "uploader_gps";
    private static final int NOTIF_ID = 5190;
    private static final int MAX_COLA = 5000;   // tope de seguridad si nunca hay red (no crecer infinito)
    private static final int LOTE = 200;        // igual al BATCH de la cola JS
    // Precisión: descartar fixes peores que esto (mismo criterio que gpsConfig.ACCURACY_MAX_M=30 en JS,
    // regla 18): un fix impreciso mete "vueltas" falsas en el recorrido. Sin esto el uploader nativo
    // subiría ruido que el pipeline JS sí filtraba.
    private static final float ACCURACY_MAX_M = 30f;
    // 🩸 SALTO IMPOSIBLE (30/07/2026). `tracker.js:143` descarta un fix cuya velocidad implícita contra
    // el último punto bueno supera esto (gpsConfig.MAX_SPEED_MPS = 45 m/s ≈ 160 km/h), pero ESE FILTRO
    // SOLO EXISTÍA EN EL CAMINO JS. El uploader nativo —el que está en la calle desde 1.6.x— miraba
    // únicamente la precisión, así que la basura entraba igual a la base.
    //
    // Lo que encontró el 29/07/2026: un vendedor con cuatro fixes que ALTERNAN entre dos lugares a
    // 127 km uno del otro, entre las 12:47 y las 12:49. Sus precisiones eran 21 y 29 m, o sea que el
    // filtro de ACCURACY_MAX_M no los podía cazar ni en teoría. El mapa le marcó 524,8 km ese día; su
    // recorrido real fueron 17,9 km.
    //
    // El dibujo ya se defiende solo (lib/geo.limpiarTrazo filtra al pintar, y así arregla también los
    // días ya guardados), pero eso tapa el síntoma: esto es lo que evita que la basura ENTRE.
    private static final double MAX_SPEED_MPS = 45.0;
    private static final float MIN_JUMP_M = 9f; // = gpsConfig.MIN_MOVE_M: por debajo, la velocidad no es fiable
    private static final int MAX_SALTOS_SEGUIDOS = 3; // ver el comentario del descarte, en el callback

    /**
     * Instancia viva del servicio, para que `MovimientoReceiver` pueda avisarle una transición de
     * Activity Recognition sin pasar por un Intent. Mismo patrón que `MovimientoPlugin.entregarTransicion`
     * y `AlarmWatchdogPlugin.despertar()`: un `startService()` desde un receiver en background puede
     * tirar IllegalStateException en Android 8+, y acá el servicio o ya está vivo o no hay nada que
     * ajustar. Se limpia en onDestroy para no dejar el Service colgado.
     */
    private static volatile UploaderGpsService instancia = null;

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
    private int saltosSeguidos = 0; // descartes consecutivos por salto imposible (ver MAX_SALTOS_SEGUIDOS)
    private boolean modoRapido = false;
    private long ultimoRapidoAt = 0L;

    /**
     * 🩸 EL FIX RETENIDO (02/08/2026) — la "línea ciega" al retomar marcha.
     *
     * Estando quieto solo se guarda un punto de cortesía cada keepAlive (30 s). Cuando la persona
     * arranca, el primer punto que se guarda es el primero que superó minMove — hasta un ciclo de
     * captura después. La recta entre el punto de cortesía y ese punto CORTA LA ESQUINA: es el trazo
     * que cruza la manzana que se ve en el mapa.
     *
     * Se retiene en memoria el último fix descartado por el filtro de movimiento y se encola JUSTO
     * ANTES del primero que sí pasa. Cuesta un Location y agrega UN punto por reanudación, exactamente
     * en el vértice donde hoy se pierde el giro.
     */
    private Location fixRetenido = null;

    /**
     * Telemetría de DESCARTES. La base solo guarda los puntos que sobrevivieron, así que desde SQL no
     * se puede distinguir "el filtro de movimiento descartó" de "el SO no entregó fixes" — y son
     * arreglos opuestos. Medido el 02/08/2026: solo el 26,6 % de los puntos consecutivos respeta la
     * cadencia nominal, y el 44 % cae en la franja de 13-35 s. Sin estos contadores, afinar cualquier
     * umbral es adivinar. Los sube el latido (useEstadoDispositivo).
     */
    private int cFixes = 0, cDescPrecision = 0, cDescSalto = 0, cDescMovimiento = 0, cGuardados = 0;
    private long ultimoFixAt = 0L;

    // Último texto pintado en la notificación. Sin esto, `nm.notify` correría en cada fix (cada 5-15 s)
    // para redibujar exactamente el mismo cartel.
    private String ultimoTextoNotif = null;

    /**
     * Apagado del teléfono. Va DINÁMICO, no en el manifest: `ACTION_SHUTDOWN` no está en la lista de
     * excepciones de broadcast implícito de Android 8+, así que un receiver declarado no lo recibiría.
     * Registrado desde el servicio sí llega, porque el proceso está vivo.
     *
     * Es BEST-EFFORT y hay que decirlo: caza el apagado por menú, NO la batería agotada ni un corte
     * de energía. Cuando no lo caza, el hueco igual se explica por el `arranque_ts` del BootReceiver.
     */
    private final BroadcastReceiver apagadoRx = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            // `commit()` y no `apply()`: el sistema se está apagando y apply() es asíncrono — puede
            // no llegar a escribir nunca, que es justo el caso que estamos tratando de registrar.
            try { prefs().edit().putLong(K_APAGADO, System.currentTimeMillis()).commit(); } catch (Exception ignored) {}
        }
    };
    private boolean apagadoRxRegistrado = false;

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }

    /**
     * 🩸 CADENCIA POR MOVIMIENTO, NO POR VELOCIDAD MEDIDA (02/08/2026).
     *
     * `evaluarCadencia` sube a cadencia rápida recién cuando YA MIDIÓ un fix a ≥ velUmbral — y ese fix
     * llega un ciclo entero después de arrancar. En auto eso es más de media cuadra dibujada como una
     * recta, justo en el arranque, que es donde están las esquinas.
     *
     * El teléfono sabe que arrancó ANTES de poder medirlo: Activity Recognition lo resuelve en el
     * coprocesador de movimiento y el permiso ya está declarado en el manifest desde siempre. Hasta
     * ahora esas transiciones alimentaban solo al watcher JS; el uploader nativo —el que está en la
     * calle— no las veía.
     *
     * Solo SUBE la cadencia. Bajarla la sigue decidiendo la velocidad real con su histéresis: si
     * Activity Recognition se equivoca diciendo "quieto" mientras la persona anda, perder densidad
     * sería un daño real, y de esos errores AR tiene.
     */
    static void avisarActividad(String actividad) {
        UploaderGpsService s = instancia;
        if (s == null || actividad == null) return;
        if (!"vehiculo".equals(actividad) && !"bicicleta".equals(actividad)) return;
        try {
            SharedPreferences sp = s.prefs();
            s.ultimoRapidoAt = System.currentTimeMillis();
            if (!s.modoRapido) {
                s.modoRapido = true;
                s.pedirUpdates(sp.getInt(K_INTERVALO_RAPIDO, 5000));
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instancia = this;
        fused = LocationServices.getFusedLocationProviderClient(this);
        crearCanal();
        try {
            IntentFilter f = new IntentFilter(Intent.ACTION_SHUTDOWN);
            f.addAction("android.intent.action.QUICKBOOT_POWEROFF"); // variante de algunos OEM
            if (Build.VERSION.SDK_INT >= 34) {
                registerReceiver(apagadoRx, f, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(apagadoRx, f);
            }
            apagadoRxRegistrado = true;
        } catch (Exception ignored) { /* sin esto el servicio funciona igual, solo pierde el motivo */ }
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
                float minMove = sp.getInt(K_MIN_MOVE, 9);         // metros; default = gpsConfig.MIN_MOVE_M (bajado de 12 el 30/07/2026)
                long keepAlive = sp.getInt(K_KEEPALIVE, 30000);   // ms; default = STATIONARY_KEEPALIVE_MS (30 s)
                // Umbrales de descarte: ahora por prefs (afinables por OTA, regla 22-ter) con los
                // valores de siempre como default, así desplegar esto no cambia comportamiento.
                // ⚠️ `accuracyMaxM` se expone para poder SUBIRLO si un modelo da fixes malos.
                // BAJARLO vacía los recorridos (regla 18).
                float accMax = sp.getFloat(K_ACCURACY_MAX, ACCURACY_MAX_M);
                double velMax = sp.getFloat(K_MAX_SPEED, (float) MAX_SPEED_MPS);
                float saltoMin = sp.getFloat(K_MIN_JUMP, MIN_JUMP_M);
                int maxSaltos = sp.getInt(K_MAX_SALTOS, MAX_SALTOS_SEGUIDOS);
                for (Location loc : result.getLocations()) {
                    cFixes++;
                    ultimoFixAt = System.currentTimeMillis();
                    // Filtro de precisión: descartar fixes imprecisos (regla 18) para no meter ruido.
                    if (loc.hasAccuracy() && loc.getAccuracy() > accMax) { cDescPrecision++; continue; }
                    long now = System.currentTimeMillis();
                    // Salto imposible → glitch del chip. Se compara contra el último fix CRUDO bueno
                    // (no contra el último guardado): el filtro por movimiento descarta puntos a
                    // propósito y usar su referencia daría dt enormes que hacen pasar cualquier salto.
                    // Se descarta el fix ENTERO: no actualiza la referencia ni la cadencia, así que un
                    // punto malo no puede arrastrar al que le sigue.
                    if (tieneFix && saltosSeguidos < maxSaltos) {
                        long dtMs = loc.getTime() - lastFixTime;
                        if (dtMs > 0) {
                            double d = haversine(lastFixLat, lastFixLng, loc.getLatitude(), loc.getLongitude());
                            if (d > saltoMin && d / (dtMs / 1000.0) > velMax) { saltosSeguidos++; cDescSalto++; continue; }
                        }
                    }
                    // Si se descartaron MAX_SALTOS_SEGUIDOS seguidos, el sospechoso es la REFERENCIA, no
                    // los fixes nuevos (pasa cuando el primer fix tras arrancar el servicio es el malo).
                    // Se acepta el siguiente y se vuelve a empezar: mejor un tramo raro que perder la
                    // jornada entera creyéndole a un solo punto.
                    saltosSeguidos = 0;
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
                    if (!movio && !vivo) {
                        // No se guarda, pero SE RETIENE: si el próximo fix sí se mueve, este es el
                        // último lugar donde de verdad estuvo antes de arrancar. Ver `fixRetenido`.
                        cDescMovimiento++;
                        fixRetenido = loc;
                        continue;
                    }
                    // 🩸 Cerrar la línea ciega: si veníamos de descartar por quietud, encolar primero
                    // el último fix retenido. Sin esto, la recta va del punto de cortesía (de hasta 30 s
                    // antes) hasta acá, y en ese tramo la persona ya arrancó y dobló — por eso el trazo
                    // cruzaba la manzana en vez de seguir la calle.
                    //
                    // Solo cuando MOVIÓ: en un keepAlive estando quieto el retenido está en el mismo
                    // lugar y sería un punto duplicado por nada.
                    if (movio && fixRetenido != null) {
                        encolar(fixRetenido);
                        cGuardados++;
                    }
                    fixRetenido = null;
                    lastLat = loc.getLatitude();
                    lastLng = loc.getLongitude();
                    lastSentAt = now;
                    tieneLast = true;
                    encolar(loc);
                    cGuardados++;
                }
                subir();
                // El contador de "puntos en espera" tiene que moverse aunque no haya red para
                // subirlos — es justo entonces cuando importa. `actualizarNotif` sale solo si el
                // texto cambió, así que llamarlo en cada fix es barato.
                actualizarNotif();
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
            // De quién es este punto. Se estampa al CAPTURAR, no al subir: al subir ya es tarde, el
            // token puede ser de otra cuenta. Sin esto, cambiar de sesión con la cola llena manda los
            // puntos de una persona a nombre de otra (ver el comentario de K_DUENO).
            String dueno = sp.getString(K_DUENO, null);
            if (dueno != null) p.put("dueno", dueno);
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

    /**
     * 🩸 Saca de la cola todo punto que NO sea de la sesión actual y lo manda a CUARENTENA.
     * Corre antes de cada subida, que es el único momento en que importa: es ahí donde un punto
     * ajeno se convertiría en una fila falsa e incorregible en `posiciones`.
     *
     * NO BORRA NADA (regla 20: el bundle 1.5.26 borró 264 puntos reales por hacer exactamente eso).
     * Los apartados vuelven solos con `reclamarCuarentena()` si esa cuenta reingresa en el teléfono.
     *
     * Los puntos SIN `dueno` son los que quedaron encolados por un APK anterior a 1.8.0, que no
     * estampaba dueño. No se pueden atribuir a nadie con certeza, así que también van a cuarentena:
     * son a lo sumo los que estaban sin subir en el instante de la actualización, quedan contados en
     * `estado()` y son recuperables. Adivinar acá es exactamente el error que estamos arreglando.
     *
     * @return cuántos puntos se apartaron.
     */
    static synchronized int apartarAjenos(Context ctx, String dueno) {
        // Sin dueño conocido NO se mueve nada. Si esto apartara con `dueno == null` mandaría la cola
        // ENTERA a cuarentena de un usuario que está trabajando bien — el remedio sería peor que la
        // enfermedad. Ante la duda sobre a quién pertenece un punto, no tocarlo.
        if (dueno == null) return 0;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray cola = new JSONArray(sp.getString(K_COLA, "[]"));
            if (cola.length() == 0) return 0;
            JSONArray mios = new JSONArray();
            JSONArray ajenos = new JSONArray();
            for (int i = 0; i < cola.length(); i++) {
                JSONObject p = cola.optJSONObject(i);
                if (p == null) continue;
                // `isNull` cubre ausente Y null de JSON: optString(name, null) sola devuelve "null"
                // (el string) cuando el valor es un null de JSON, y ahí la comparación fallaría.
                String d = p.isNull("dueno") ? null : p.optString("dueno", null);
                if (dueno.equals(d)) mios.put(p); else ajenos.put(p);
            }
            if (ajenos.length() == 0) return 0;
            JSONArray cuar = new JSONArray(sp.getString(K_CUARENTENA, "[]"));
            for (int i = 0; i < ajenos.length(); i++) cuar.put(ajenos.get(i));
            sp.edit()
                .putString(K_COLA, mios.toString())
                .putString(K_CUARENTENA, cuar.toString())
                .apply();
            return ajenos.length();
        } catch (Exception ignored) { return 0; }
    }

    /**
     * Cambio de cuenta en el mismo teléfono, en una sola operación idempotente: aparta lo que no es
     * del dueño nuevo y le devuelve lo que sí es suyo de cuarentena. Se llama al configurar (login) y
     * es seguro llamarla de más.
     */
    static void cambiarDueno(Context ctx, String nuevoDueno) {
        apartarAjenos(ctx, nuevoDueno);
        reclamarCuarentena(ctx, nuevoDueno);
    }

    /**
     * Devuelve a la cola los puntos en cuarentena que SÍ son de este dueño. Es lo que hace que
     * cambiar de cuenta y volver no pierda nada: los puntos esperan y se suben cuando vuelve su
     * dueño. Espejo de `separarPorDueño()` en la cola JS.
     */
    static synchronized int reclamarCuarentena(Context ctx, String dueno) {
        if (dueno == null) return 0;
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray cuar = new JSONArray(sp.getString(K_CUARENTENA, "[]"));
            if (cuar.length() == 0) return 0;
            JSONArray vuelven = new JSONArray();
            JSONArray quedan = new JSONArray();
            for (int i = 0; i < cuar.length(); i++) {
                JSONObject p = cuar.optJSONObject(i);
                if (p == null) continue;
                String d = p.isNull("dueno") ? null : p.optString("dueno", null);
                if (dueno.equals(d)) vuelven.put(p); else quedan.put(p);
            }
            if (vuelven.length() == 0) return 0;
            JSONArray cola = new JSONArray(sp.getString(K_COLA, "[]"));
            for (int i = 0; i < vuelven.length(); i++) cola.put(vuelven.get(i));
            sp.edit()
                .putString(K_COLA, cola.toString())
                .putString(K_CUARENTENA, quedan.toString())
                .apply();
            return vuelven.length();
        } catch (Exception ignored) { return 0; }
    }

    private void subirLote() throws Exception {
        SharedPreferences sp = prefs();
        String token = sp.getString(K_TOKEN, null);
        String url = sp.getString(K_URL, null);
        if (token == null || url == null) return;
        // Antes de mandar nada: apartar lo que no sea de esta sesión. El token manda la identidad en
        // el servidor, así que un punto ajeno acá se vuelve una fila falsa que después no se puede
        // corregir ni borrar.
        apartarAjenos(this, sp.getString(K_DUENO, null));
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
                // Los contadores viajan con esta misma escritura: cero writes extra. Entre subidas
                // quedan levemente atrasados, y no importa — el latido los lee cada 2 min y las
                // subidas pasan cada 5-10 s cuando hay red.
                sp.edit()
                    .putLong(K_ULTIMA, System.currentTimeMillis())
                    .putInt(K_TEL_FIXES, cFixes)
                    .putInt(K_TEL_PRECISION, cDescPrecision)
                    .putInt(K_TEL_SALTO, cDescSalto)
                    .putInt(K_TEL_MOVIMIENTO, cDescMovimiento)
                    .putInt(K_TEL_GUARDADOS, cGuardados)
                    .putLong(K_TEL_ULTIMO_FIX, ultimoFixAt)
                    .apply();
                // Subió: la red está bien. Si veníamos de 'sin-red'/'avion', esto es lo que cierra
                // el período y deja el `red_desde` listo para que el latido lo suba.
                anotarRed("ok");
                actualizarNotif();
                // Si quedaban más que el lote (venía de estar offline), seguir vaciando.
                if (leerCola().length() > 0) subirLote();
            } else {
                // Respondió pero mal (5xx, 401…): hay red, el problema es del otro lado. No se
                // marca 'sin-red' — sería mentirle al supervisor sobre la causa.
                anotarRed("ok");
                actualizarNotif();
            }
            // Si falló, NO se borra la cola: se reintenta en la próxima captura.
        } catch (Exception e) {
            // Acá es donde de verdad se entera el teléfono de que no tiene red: la conexión ni
            // siquiera se pudo abrir. Hasta 1.6.x esta rama era completamente muda — el servicio
            // seguía diciendo "Enviando ubicación en vivo" con la cola creciendo.
            anotarRed(estadoRed());
            actualizarNotif();
            throw e;
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
            // Hasta 1.6.x tocar esta notificación no hacía absolutamente nada. Es la pieza de la app
            // que el vendedor tiene delante todo el día: tiene que abrirla.
            .setContentIntent(intentApp())
            .build();
    }

    /**
     * ⚠️ `FLAG_IMMUTABLE` acá es lo CORRECTO y no hay que "arreglarlo" a MUTABLE. La regla 16 de
     * CLAUDE.md exige `FLAG_MUTABLE` en el PendingIntent de `MovimientoPlugin`, pero ese es otro
     * caso: aquel necesita que el sistema le escriba los extras del reconocimiento de actividad.
     * Este solo abre una Activity, y en Android 12+ un PendingIntent sin flag de mutabilidad
     * explícito directamente revienta.
     */
    private PendingIntent intentApp() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(this, 5191, i, flags);
    }

    /**
     * Estado de la red AHORA: 'avion' | 'sin-red' | 'ok'.
     *
     * Ante la duda devuelve 'ok'. Es deliberado: un falso "sin internet" en la notificación del
     * vendedor y en el motivo del aviso al supervisor es peor que no decir nada, porque manda a
     * revisar un problema que no existe.
     */
    private String estadoRed() {
        try {
            // Modo avión: la única de las tres causas que el sistema expone directamente.
            if (Settings.Global.getInt(getContentResolver(), Settings.Global.AIRPLANE_MODE_ON, 0) != 0) {
                return "avion";
            }
        } catch (Exception ignored) {}
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return "ok";
            if (Build.VERSION.SDK_INT >= 23) {
                Network n = cm.getActiveNetwork();
                if (n == null) return "sin-red";
                NetworkCapabilities caps = cm.getNetworkCapabilities(n);
                if (caps == null) return "sin-red";
                return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ? "ok" : "sin-red";
            }
        } catch (Exception ignored) {}
        return "ok";
    }

    /** Guarda el estado de red y, si CAMBIÓ, desde cuándo. */
    private void anotarRed(String estado) {
        SharedPreferences sp = prefs();
        if (estado.equals(sp.getString(K_RED, null))) return;
        sp.edit().putString(K_RED, estado).putLong(K_RED_DESDE, System.currentTimeMillis()).apply();
    }

    private int largoCola() {
        try { return new JSONArray(prefs().getString(K_COLA, "[]")).length(); } catch (Exception e) { return 0; }
    }

    /**
     * El texto de la notificación persistente. Hasta 1.6.x decía "Enviando ubicación en vivo" para
     * SIEMPRE, incluso con 300 puntos atascados y el teléfono sin datos desde hacía dos horas.
     *
     * El canal `uploader_gps` es IMPORTANCE_LOW: no suena ni vibra. Es la notificación silenciosa
     * que hace que el vendedor se entere solo de que se quedó sin señal, sin que nadie lo llame.
     */
    private String textoEstado() {
        String red = prefs().getString(K_RED, "ok");
        int cola = largoCola();
        if ("avion".equals(red)) return cola > 0 ? "Modo avión · " + cola + " puntos guardados" : "Modo avión · sin enviar";
        if ("sin-red".equals(red)) return cola > 0 ? "Sin internet · " + cola + " puntos guardados" : "Sin internet";
        if (cola > 0) return cola + " puntos en espera";
        return "Enviando ubicación en vivo";
    }

    /** Repinta la notificación SOLO si el texto cambió (si no, correría en cada fix). */
    private void actualizarNotif() {
        String t = textoEstado();
        if (t.equals(ultimoTextoNotif)) return;
        ultimoTextoNotif = t;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            try { nm.notify(NOTIF_ID, construirNotificacion(t)); } catch (Exception ignored) {}
        }
    }

    /**
     * ¿Ahora cae dentro de la ventana de rastreo? Misma lógica que dentroDeHorario() del JS pero en
     * nativo, para que el servicio no dependa del WebView. Hora y día en LOCAL (no UTC). start=-1 = sin
     * ventana (todo el día/semana).
     */
    private boolean dentroDeVentana() {
        SharedPreferences sp = prefs();
        java.util.Calendar c = java.util.Calendar.getInstance(); // zona horaria local del dispositivo
        int cur = c.get(java.util.Calendar.HOUR_OF_DAY) * 60 + c.get(java.util.Calendar.MINUTE);
        // Día ISO: Calendar.DAY_OF_WEEK es 1=Dom..7=Sáb → convertir a 1=Lun..7=Dom.
        int dow = c.get(java.util.Calendar.DAY_OF_WEEK); // 1=Dom
        int iso = dow == java.util.Calendar.SUNDAY ? 7 : dow - 1;

        // Jornada partida (1.8.0): varias ventanas con semántica de UNIÓN. Si el JS no la mandó
        // (APK nuevo + bundle viejo), se cae a la ventana única de siempre.
        String ventanas = sp.getString(K_VENTANAS, "");
        if (ventanas != null && !ventanas.isEmpty()) {
            for (String v : ventanas.split(";")) {
                // "inicio-fin-dias" — los días pueden venir vacíos (= todos) y llevan comas adentro,
                // así que se parte en 3 como máximo.
                String[] p = v.split("-", 3);
                if (p.length < 2) continue;
                try {
                    int s = Integer.parseInt(p[0].trim());
                    int e = Integer.parseInt(p[1].trim());
                    if (s < 0 || e < 0) continue;
                    if (aplicaVentana(s, e, p.length > 2 ? p[2] : "", cur, iso)) return true;
                } catch (Exception ignored) {}
            }
            return false;
        }

        int start = sp.getInt(K_START, -1);
        int end = sp.getInt(K_END, -1);
        if (start < 0 || end < 0) return true; // sin ventana configurada → siempre
        return aplicaVentana(start, end, sp.getString(K_DIAS, ""), cur, iso);
    }

    /** ¿El minuto `cur` del día ISO `iso` cae en la ventana [start, end] con esos días? */
    private static boolean aplicaVentana(int start, int end, String dias, int cur, int iso) {
        if (dias != null && !dias.isEmpty()) {
            boolean hoy = false;
            for (String d : dias.split(",")) {
                try { if (Integer.parseInt(d.trim()) == iso) { hoy = true; break; } } catch (Exception ignored) {}
            }
            if (!hoy) return false;
        }
        // start > end = ventana que cruza la medianoche ('22:00'–'06:00').
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
        if (apagadoRxRegistrado) {
            try { unregisterReceiver(apagadoRx); } catch (Exception ignored) {}
            apagadoRxRegistrado = false;
        }
        // Volcar los contadores antes de morir: si el SO mata el servicio, esta es la única foto que
        // queda de cuántos fixes llegaron y cuántos se descartaron, y es justo el caso que interesa
        // diagnosticar. `commit()` y no `apply()`: apply() es asíncrono y acá se está terminando.
        try {
            prefs().edit()
                .putInt(K_TEL_FIXES, cFixes)
                .putInt(K_TEL_PRECISION, cDescPrecision)
                .putInt(K_TEL_SALTO, cDescSalto)
                .putInt(K_TEL_MOVIMIENTO, cDescMovimiento)
                .putInt(K_TEL_GUARDADOS, cGuardados)
                .putLong(K_TEL_ULTIMO_FIX, ultimoFixAt)
                .commit();
        } catch (Exception ignored) {}
        // Soltar la referencia estática: sin esto queda un Service muerto retenido para siempre.
        if (instancia == this) instancia = null;
        super.onDestroy();
    }
}
