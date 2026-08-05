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

    /* 🩸 GUARDAR POR DISTANCIA, SEGÚN EL MODO (1.9.0, 03/08/2026) — el pedido del cliente:
     * "pasar de temporizador a distancia, cada 10 metros una ubicación, y si detecta que va por ruta
     * cada 50 o 100 metros para minimizar carga en base de datos".
     *
     * Va acá, en el filtro de GUARDADO, y no en el LocationRequest: `setMinUpdateDistanceMeters`
     * hace que el SO ENTREGUE menos fixes, o sea justo lo contrario de lo que hace falta — el
     * problema medido es que llegan pocos, no que sobren.
     *
     * ⚠️ Los tres números NO son 10/50/100 y la diferencia importa. En la banda urbana (11-40 km/h)
     * está el problema que motivó toda esta tanda: son calles con paralelas a media cuadra, y ahí
     * un punto cada 50 m dibuja una diagonal que cruza la manzana. Medido el 03/08/2026: a 5 s de
     * captura en esa banda ya quedaban 27,8 m entre puntos y NO alcanzaba. Así que urbano queda
     * DENSO (15 m). Los 100 m van donde el cliente los pidió y donde no cuestan nada: en ruta, a
     * más de 40 km/h, donde no hay calle paralela con la que confundirse — ahí la fidelidad la
     * arregla el snap, no más puntos.
     *
     * Volumen real hoy, para dimensionar: `posiciones` tiene 25.368 filas y 14 MB en total, con
     * 3.171 filas/día. La carga de base NO es un problema; esto entra porque es lo correcto para el
     * trazo en ruta, no porque la base esté sufriendo. */
    static final String K_MIN_MOVE_URBANO = "minMoveUrbanoM"; // 11-40 km/h: denso, es donde se confunden las calles
    static final String K_MIN_MOVE_RUTA = "minMoveRutaM";     // > 40 km/h: no hay paralelas, se puede ralear
    static final String K_VEL_RUTA = "velRutaMps";            // m/s desde el cual se considera "ruta"

    /* 🩸 TRIANGULACIÓN POR RED, SOLO DURANTE UN SILENCIO (1.9.0, 03/08/2026).
     *
     * Cuando el GPS deja de entregar, el teléfono igual sigue viendo antenas y WiFi. Esos fixes
     * valen para decir "por acá anduvo" y para NADA más: en el pueblo dan 20-80 m y en el campo
     * pueden dar cientos. Por eso van por un carril aparte, con su propio techo, y el front los
     * dibuja PUNTEADOS, fuera de los km y fuera del snap (la precisión misma es la marca: hasta hoy
     * no existía en `posiciones` un solo punto con accuracy > 30).
     *
     * Se piden recién tras `silencioMs` sin un fix de GPS y se cortan apenas vuelve uno: nunca
     * compiten con el GPS, lo reemplazan mientras no hay. */
    static final String K_ACCURACY_RED_MAX = "accuracyRedMaxM"; // techo propio del carril de red
    static final String K_SILENCIO_MS = "silencioMs";           // sin fix de GPS por más de esto → red + GPS crudo
    static final String K_REPEDIDO_MIN_MS = "repedidoMinMs";    // piso entre dos cambios de cadencia (anti-churn)
    static final String K_INTERVALO_QUIETO = "intervaloQuietoMs"; // cadencia con "quieto" CONFIRMADO por el acelerómetro
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
    /* Los contadores de 1.8.0 dicen qué pasó con los fixes que LLEGARON. No dicen cuántos tendrían
     * que haber llegado, y esa era justo la pregunta del 03/08/2026: el teléfono de un vendedor pasó
     * de 0,9 % a 24 % de huecos de más de un minuto, con la precisión perfecta y los filtros sin
     * descartar nada. Sin estos cuatro no se puede distinguir "el SO no entrega" de "nos peleamos
     * nosotros mismos con la cadencia". */
    static final String K_TEL_INTERVALO = "telIntervaloVigente"; // qué cadencia se le está pidiendo AL PROVEEDOR
    static final String K_TEL_REPEDIDOS = "telRepedidos";        // cuántas veces se reemplazó el LocationRequest
    static final String K_TEL_SILENCIO_MAX = "telSilencioMaxMs"; // el hueco más largo sin un fix, del día
    static final String K_TEL_RED = "telFixesRed";               // fixes aceptados por el carril de triangulación
    static final String K_TEL_DIA = "telDia";                    // yyyymmdd de los contadores (se reinician por DÍA)

    /* 🩸 DIAGNÓSTICO DEL ARRANQUE (05/08/2026) — para que el fallo silencioso deje de serlo.
     *
     * El bug reportado ("le asigno las 8 y a veces no inicia") tenía tres causas candidatas y
     * NINGUNA dejaba rastro, así que desde la base eran indistinguibles entre sí: la alarma no
     * dispara, la alarma dispara pero Android bloquea el arranque del foreground service, o el
     * receiver directamente no corre. Peor: el rechazo del FGS se tragaba en un `catch (Exception
     * ignored)`, o sea que el caso más grave era el único completamente invisible.
     *
     * Estos cuatro contadores viajan en el latido a `estado_dispositivo` (db/30) y responden la
     * pregunta con un select, sin esperar a mañana ni tener el teléfono en la mano. */
    static final String K_ALARMA_TS = "alarmaTs";          // epoch ms del último disparo de AlarmReceiver
    static final String K_ALARMA_PROX = "alarmaProx";      // epoch ms del próximo disparo programado
    static final String K_ALARMA_EXACTA = "alarmaExacta";  // la próxima se programó como EXACTA
    static final String K_FGS_BLOQ = "fgsBloqueado";       // veces que Android rechazó arrancar el FGS
    static final String K_FGS_BLOQ_TS = "fgsBloqueadoTs";  // epoch ms del último rechazo

    /* 🩸 CONFIG DEL WATCHDOG, PERSISTIDA (05/08/2026). Vivía en tres `static` de
     * AlarmWatchdogPlugin, o sea SOLO EN MEMORIA. Cuando la alarma revivía el proceso en frío —que
     * es justo el caso que importa, la mañana con la app cerrada— la clase se cargaba con los
     * defaults (30 / 0 / 24 = "sin ventana") y `programarProxima` reprogramaba con ESOS valores,
     * ignorando lo que el JS había configurado. Resultado: pings toda la madrugada (batería, y peor
     * bucket de App Standby, que difiere todavía más la alarma de la mañana).
     *
     * El margen sale de `gpsConfig.js` como los otros umbrales (regla 22-ter): se afina por OTA. */
    static final String K_WD_INTERVALO = "wdIntervaloMin"; // cada cuánto pinguea el watchdog
    static final String K_WD_HORA_INI = "wdHoraInicio";    // ventana GRUESA del watchdog (hora 0..23)
    static final String K_WD_HORA_FIN = "wdHoraFin";       // ventana GRUESA del watchdog (hora 1..24)
    static final String K_WD_MARGEN = "wdMargenMs";        // cuánto ANTES del borde despertar

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

    /* 🩸 ANTI-CHURN DE LA CADENCIA (1.9.0, 03/08/2026).
     *
     * `pedirUpdates` llama a `requestLocationUpdates` de nuevo, y CADA llamada reemplaza el request
     * y reinicia la agenda de entrega del proveedor. Hasta 1.8.1 se llamaba desde dos lados que
     * pueden alternar solos —`evaluarCadencia` (por velocidad) y `avisarActividad` (Activity
     * Recognition)— y encima se re-pedía aunque el intervalo resultante fuera EL MISMO. Caminando,
     * AR confunde "a pie" con "bicicleta" seguido: el request se reemplazaba cada 20-30 s y el
     * proveedor no llegaba nunca a entregar a la cadencia pedida.
     *
     * Ahora hay una cadencia DESEADA y una VIGENTE. Se aplica solo si cambian de verdad y si pasó
     * el piso de permanencia; si no, queda pendiente y se reintenta en el próximo fix. Y se cuenta
     * cuántas veces se re-pidió: sin ese número, este bug es invisible desde acá.
     */
    private long intervaloDeseado = 0L;
    private long intervaloVigente = 0L;
    private long ultimoRepedidoAt = 0L;

    /* Modo de movimiento, que gobierna el minMove (ver K_MIN_MOVE_URBANO). Sale de la velocidad
     * medida y de Activity Recognition, con la misma asimetría de siempre: subir densidad es
     * inmediato, bajarla exige confirmación. */
    private static final int MODO_PIE = 0, MODO_URBANO = 1, MODO_RUTA = 2;
    private int modoMovimiento = MODO_PIE;

    /* Carril de triangulación por red: activo SOLO durante un silencio del GPS. */
    private boolean pidiendoRed = false;
    private android.location.LocationListener redListener = null;

    /** WakeLock parcial: ver `tomarWakeLock`. */
    private android.os.PowerManager.WakeLock wakeLock = null;

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
    // 1.9.0: ver K_TEL_REPEDIDOS. `cRepedidos` es el que delata la pelea con la cadencia;
    // `silencioMax` es el hueco más largo del día, que es la forma de saber si el WakeLock sirvió.
    private int cRepedidos = 0, cFixesRed = 0;
    private long silencioMax = 0L;
    private int diaContadores = 0; // yyyymmdd: los contadores se reinician por DÍA, no por arranque

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
    /* Fuera de ventana pero VIVO: sin GPS, sin WakeLock y con la notificación cambiada. Es el estado
     * que reemplazó al `stopSelf()` de siempre — ver el bloque de `pausar()`. */
    private boolean enPausa = false;

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
     * 1.9.0: ahora también BAJA, pero solo en el caso inequívoco y solo desde el acelerómetro —
     * "quieto" confirmado. Es de donde sale la batería que cuesta la captura densa, y el riesgo es
     * acotado: parado, perder densidad no pierde trazo (el marcador lo mantiene vivo el keepalive).
     * Todo lo demás sigue bajando por velocidad medida con su histéresis: si AR se equivoca diciendo
     * "quieto" mientras la persona anda, perder densidad sería un daño real, y de esos errores AR
     * tiene. Por eso el "quieto" se deshace con el PRIMER fix que se mueva, sin esperar a AR.
     */
    static void avisarActividad(String actividad) {
        UploaderGpsService s = instancia;
        if (s == null || actividad == null) return;
        try {
            SharedPreferences sp = s.prefs();
            if ("vehiculo".equals(actividad) || "bicicleta".equals(actividad)) {
                s.ultimoRapidoAt = System.currentTimeMillis();
                if (s.modoMovimiento < MODO_URBANO) s.modoMovimiento = MODO_URBANO;
                if (!s.modoRapido) {
                    s.modoRapido = true;
                    s.quiereCadencia(sp.getInt(K_INTERVALO_RAPIDO, 5000));
                }
                return;
            }
            if ("caminando".equals(actividad)) {
                // Fija el perfil peatón sin esperar a que la velocidad medida lo deduzca (que llega
                // un ciclo tarde, que es medio cuadra dibujada como recta).
                s.modoMovimiento = MODO_PIE;
                if (s.modoRapido) { s.modoRapido = false; s.quiereCadencia(sp.getLong(K_INTERVALO, 10000L)); }
                return;
            }
            if ("quieto".equals(actividad)) {
                s.modoMovimiento = MODO_PIE;
                s.modoRapido = false;
                s.quiereCadencia(sp.getInt(K_INTERVALO_QUIETO, 30000));
            }
        } catch (Exception ignored) {}
    }

    /**
     * 🩸 EL WAKELOCK QUE NUNCA SE TOMÓ (1.9.0, 03/08/2026).
     *
     * `android.permission.WAKE_LOCK` está declarado en el manifest desde el primer día y NO SE USABA
     * EN NINGUNA PARTE. Un foreground service de tipo `location` está exento de los límites de
     * ubicación en background, pero eso NO impide que el sistema suspenda la CPU en Doze: cuando el
     * teléfono se duerme, la callback de FusedLocation simplemente no corre.
     *
     * Es la explicación más directa de lo que se midió el 03/08/2026 en el teléfono de un vendedor:
     * silencios de hasta 7 minutos ESTANDO PARADO, con precisión de 2,8 m y los contadores de
     * descarte en cero. El chip andaba perfecto; no llegaba ni el latido de cortesía de 30 s.
     *
     * ⚠️ Es un CANDIDATO, no una certeza — por eso en la misma versión entra la telemetría de
     * `silencioMax`: si con el WakeLock tomado siguen apareciendo silencios de minutos, la causa es
     * otra (OEM) y el arreglo pasa a ser el carril de red y el fallback de proveedor.
     *
     * Sin timeout a propósito: el ciclo de vida lo da el servicio, que ya se apaga solo fuera de la
     * ventana horaria (`detenerServicio`). Un WakeLock con timeout se soltaría en medio de la
     * jornada, que es justo cuando hace falta.
     */
    private void tomarWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        try {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "launion:uploader-gps");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        } catch (Exception ignored) { /* sin WakeLock el servicio sigue funcionando, solo peor en Doze */ }
    }

    private void soltarWakeLock() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); } catch (Exception ignored) {}
        wakeLock = null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instancia = this;
        fused = LocationServices.getFusedLocationProviderClient(this);
        tomarWakeLock();
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
        // Si Android rechaza el foreground, no seguir: pedir GPS sin estar en foreground es
        // exactamente lo que el SO acaba de prohibir, y el WakeLock quedaría tomado para nada.
        if (!arrancarForeground()) return START_NOT_STICKY;
        // 🩸 ARRANCA EN PAUSA SI ESTÁ FUERA DE HORARIO (05/08/2026). Antes se prendía el GPS y el
        // WakeLock igual, y recién a los 30 s el latido descubría que eran las 07:52 y apagaba todo.
        // Ese medio minuto de GPS a ciegas se pagaba en cada despertar del watchdog, toda la noche.
        if (!dentroDeVentana()) {
            // `pausar()` y no `enPausa = true` a mano: onStartCommand puede re-entrar con el servicio
            // YA capturando (AlarmReceiver, boot), y ahí hay updates y WakeLock que soltar de verdad.
            if (enPausa) actualizarNotif(); else pausar();
            latidoH.removeCallbacks(latido);
            latidoH.postDelayed(latido, LATIDO_PAUSA_MS);
            return START_STICKY;
        }
        reanudar(); // no-op si no venía en pausa
        tomarWakeLock();   // idempotente: onStartCommand puede volver a entrar (AlarmReceiver, boot)
        arrancarUpdates();
        reiniciarContadoresSiCambioElDia();
        latidoH.removeCallbacks(latido);
        latidoH.postDelayed(latido, LATIDO_MS);
        // START_STICKY: si el SO mata el servicio, que lo reintente cuando pueda.
        return START_STICKY;
    }

    /**
     * 🩸 EL LATIDO DEL SERVICIO (1.9.0). Sin esto NO SE PUEDE DETECTAR UN SILENCIO: el callback de
     * ubicación solo corre cuando llega un fix, o sea que la ausencia de fixes es justo el evento
     * que el servicio no podía observar. Cada `LATIDO_MS` mira si el GPS se calló y, si se calló,
     * enciende el carril de red; de paso reintenta un cambio de cadencia pendiente y empuja la cola.
     *
     * Corre en el Handler del main looper y apoyado en el WakeLock parcial: sin el WakeLock, en Doze
     * este latido tampoco correría, que es exactamente el problema que vino a medir.
     */
    private static final long LATIDO_MS = 30000;
    /* En pausa el latido se espacia: no hay nada que medir y la única razón de seguir latiendo es
     * cruzar el borde de la ventana. Es el CAMINO FELIZ del arranque —cuando el teléfono está
     * despierto, reanuda en menos de 5 min— pero no es garantía: un Handler no corre en Doze sin
     * WakeLock, y justamente en pausa lo soltamos. El respaldo a prueba de Doze es la alarma exacta
     * que deja armada `pausar()`. Los dos caminos son necesarios: el Handler es preciso y frágil, la
     * alarma es robusta y gruesa. */
    private static final long LATIDO_PAUSA_MS = 300000;
    private final android.os.Handler latidoH = new android.os.Handler(Looper.getMainLooper());
    private final Runnable latido = new Runnable() {
        @Override public void run() {
            long proxima = LATIDO_MS;
            try {
                // 🩸 Fuera de ventana se PAUSA, no se apaga (05/08/2026). Ver el bloque de `pausar()`.
                if (!dentroDeVentana()) {
                    pausar();
                    // Repintar por si el horario cambió mientras dormía: el cartel dice "hasta las
                    // 08:00" y esa hora sale de las prefs, que el JS puede haber reescrito.
                    actualizarNotif();
                    proxima = LATIDO_PAUSA_MS;
                    return;
                }
                reanudar(); // no-op si ya estaba corriendo
                reiniciarContadoresSiCambioElDia();
                long now = System.currentTimeMillis();
                long silencioMs = prefs().getInt(K_SILENCIO_MS, 90000);
                if (ultimoFixAt > 0 && now - ultimoFixAt > silencioMs) {
                    if (now - ultimoFixAt > silencioMax) silencioMax = now - ultimoFixAt;
                    encenderCarrilRed();
                }
                aplicarCadencia();
                subir();
                actualizarNotif();
            } catch (Exception ignored) {
            } finally {
                latidoH.postDelayed(this, proxima);
            }
        }
    };

    /**
     * Los contadores se reinician por DÍA y no por arranque del servicio. Hasta 1.8.1 vivían solo en
     * memoria, así que el SO matando el servicio —que es JUSTO el evento que hay que contar— los
     * ponía en cero y borraba la evidencia.
     */
    private void reiniciarContadoresSiCambioElDia() {
        java.util.Calendar c = java.util.Calendar.getInstance();
        int hoy = c.get(java.util.Calendar.YEAR) * 10000 + (c.get(java.util.Calendar.MONTH) + 1) * 100 + c.get(java.util.Calendar.DAY_OF_MONTH);
        SharedPreferences sp = prefs();
        if (diaContadores == 0) diaContadores = sp.getInt(K_TEL_DIA, 0);
        if (diaContadores == hoy) return;
        // Día nuevo: arrancar de cero y dejarlo escrito, para que un reinicio del servicio a media
        // jornada retome estos contadores en vez de empezar de nuevo.
        diaContadores = hoy;
        cFixes = 0; cDescPrecision = 0; cDescSalto = 0; cDescMovimiento = 0; cGuardados = 0;
        cRepedidos = 0; cFixesRed = 0; silencioMax = 0;
        volcarTelemetria(sp.edit()).putInt(K_TEL_DIA, hoy).apply();
    }

    /** Los contadores, en una sola escritura. Se comparte entre el volcado periódico y onDestroy. */
    private SharedPreferences.Editor volcarTelemetria(SharedPreferences.Editor e) {
        return e.putInt(K_TEL_FIXES, cFixes)
            .putInt(K_TEL_PRECISION, cDescPrecision)
            .putInt(K_TEL_SALTO, cDescSalto)
            .putInt(K_TEL_MOVIMIENTO, cDescMovimiento)
            .putInt(K_TEL_GUARDADOS, cGuardados)
            .putLong(K_TEL_ULTIMO_FIX, ultimoFixAt)
            .putLong(K_TEL_INTERVALO, intervaloVigente)
            .putInt(K_TEL_REPEDIDOS, cRepedidos)
            .putLong(K_TEL_SILENCIO_MAX, silencioMax)
            .putInt(K_TEL_RED, cFixesRed);
    }

    /**
     * 🩸 ENVUELTO EN try/catch DESDE 1.11.0 (05/08/2026), y no es defensa de más.
     *
     * En Android 12+ `startForeground` puede tirar `ForegroundServiceStartNotAllowedException` si el
     * servicio se está iniciando desde background sin exención. Acá NO lo cazaba nadie: una excepción
     * no capturada dentro de `onStartCommand` **tira abajo el proceso**, en background y sin dejar un
     * log que alguien vaya a mirar. O sea que había DOS lugares distintos donde el arranque de la
     * mañana podía morir en silencio (el otro es `AlarmReceiver.arrancarUploaderSiConfigurado`), y
     * este era el peor de los dos porque se llevaba puesta la app entera.
     *
     * Ahora el rechazo se CUENTA (viaja en el latido, db/30) y el servicio se retira ordenado.
     *
     * @return true si quedó en foreground. false = Android lo rechazó y no hay nada que hacer hasta
     *         el próximo intento; el que llama tiene que abortar.
     */
    private boolean arrancarForeground() {
        Notification n = construirNotificacion(enPausa ? textoEstado() : "Enviando ubicación…");
        try {
            // API 34+ exige declarar el tipo de foreground service en el arranque además del manifest.
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIF_ID, n);
            }
            return true;
        } catch (Exception e) {
            anotarFgsBloqueado(this);
            try { stopSelf(); } catch (Exception ignored) {}
            return false;
        }
    }

    /**
     * Deja constancia de que Android rechazó arrancar el foreground service.
     *
     * `commit()` y no `apply()` a propósito: se llama justo cuando el proceso puede estar por morir
     * (es el caso que estamos midiendo), y `apply()` es asíncrono — se perdería justo el dato que
     * explica la falla. Es el mismo criterio del volcado de telemetría en `onDestroy`.
     */
    static void anotarFgsBloqueado(Context ctx) {
        try {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            sp.edit()
                .putInt(K_FGS_BLOQ, sp.getInt(K_FGS_BLOQ, 0) + 1)
                .putLong(K_FGS_BLOQ_TS, System.currentTimeMillis())
                .commit();
        } catch (Exception ignored) {}
    }

    /**
     * TODO fix que entra a la app pasa por acá, venga de FusedLocation o del carril de red. Estaba
     * escrito adentro del callback de Fused hasta 1.8.1; se extrajo al agregar el segundo carril,
     * porque tener dos copias del filtrado sería garantizar que diverjan (es literalmente lo que ya
     * pasó entre el camino JS y el nativo: el filtro de salto imposible existía solo en uno).
     *
     * @param deRed true si viene de NETWORK/GPS_PROVIDER durante un silencio: se le aplica el techo
     *              de precisión propio y NO toca el modo de movimiento (un fix de ±80 m daría una
     *              velocidad inventada).
     */
    private synchronized void procesarFix(Location loc, boolean deRed) {
        if (loc == null) return;
        if (!dentroDeVentana()) { pausar(); return; }
        SharedPreferences sp = prefs();
        long keepAlive = sp.getInt(K_KEEPALIVE, 30000);   // ms; default = STATIONARY_KEEPALIVE_MS (30 s)
        // Umbrales de descarte: por prefs (afinables por OTA, regla 22-ter) con los valores de
        // siempre como default. ⚠️ `accuracyMaxM` se expone para poder SUBIRLO si un modelo da fixes
        // malos. BAJARLO vacía los recorridos (regla 18).
        float accMax = deRed
            ? sp.getFloat(K_ACCURACY_RED_MAX, 150f)   // el carril de red tiene su propio techo
            : sp.getFloat(K_ACCURACY_MAX, ACCURACY_MAX_M);
        double velMax = sp.getFloat(K_MAX_SPEED, (float) MAX_SPEED_MPS);
        float saltoMin = sp.getFloat(K_MIN_JUMP, MIN_JUMP_M);
        int maxSaltos = sp.getInt(K_MAX_SALTOS, MAX_SALTOS_SEGUIDOS);

        long now = System.currentTimeMillis();
        cFixes++;
        // El silencio más largo del día: es lo que dice si el WakeLock sirvió (ver `tomarWakeLock`).
        if (ultimoFixAt > 0 && now - ultimoFixAt > silencioMax) silencioMax = now - ultimoFixAt;
        // 🩸 `ultimoFixAt` solo lo mueve el GPS. Si lo moviera el carril de red, el silencio se
        // "curaría" solo con puntos triangulados y no volveríamos a mirar el problema de fondo.
        if (!deRed) { ultimoFixAt = now; apagarCarrilRed(); }
        if (deRed) cFixesRed++;

        // Filtro de precisión: descartar fixes imprecisos (regla 18) para no meter ruido.
        if (loc.hasAccuracy() && loc.getAccuracy() > accMax) { cDescPrecision++; return; }
        // Salto imposible → glitch del chip. Se compara contra el último fix CRUDO bueno (no contra
        // el último guardado): el filtro por movimiento descarta puntos a propósito y usar su
        // referencia daría dt enormes que hacen pasar cualquier salto. Se descarta el fix ENTERO: no
        // actualiza la referencia ni la cadencia, así que un punto malo no arrastra al que le sigue.
        if (tieneFix && saltosSeguidos < maxSaltos) {
            long dtMs = loc.getTime() - lastFixTime;
            if (dtMs > 0) {
                double d = haversine(lastFixLat, lastFixLng, loc.getLatitude(), loc.getLongitude());
                if (d > saltoMin && d / (dtMs / 1000.0) > velMax) { saltosSeguidos++; cDescSalto++; return; }
            }
        }
        // Si se descartaron MAX_SALTOS_SEGUIDOS seguidos, el sospechoso es la REFERENCIA, no los
        // fixes nuevos (pasa cuando el primer fix tras arrancar el servicio es el malo). Se acepta el
        // siguiente y se vuelve a empezar: mejor un tramo raro que perder la jornada entera.
        saltosSeguidos = 0;
        // Cadencia adaptativa por velocidad: se mide sobre TODOS los fixes crudos (antes del filtro
        // por movimiento, que decide qué se GUARDA). Si va rápido, sube la cadencia de captura para
        // que el trazo no cruce manzanas; al frenar, vuelve a la lenta. Los de red no votan: su
        // error de ±80 m daría velocidades inventadas.
        if (!deRed) evaluarCadencia(velocidadMps(loc), now, sp);
        lastFixLat = loc.getLatitude();
        lastFixLng = loc.getLongitude();
        lastFixTime = loc.getTime();
        tieneFix = true;
        // Filtro por movimiento (espejo de tracker.js): guardar solo si se movió, o cada keepAlive
        // estando quieto. Recorta el volumen de un vendedor parado sin perder el trazo en
        // movimiento. Cuánto hay que moverse depende del MODO desde 1.9.0(ver K_MIN_MOVE_URBANO);
        // los fixes de red usan el umbral de a pie, que es el más permisivo: están para tapar un
        // hueco, no para ahorrar filas.
        float minMove = deRed ? sp.getInt(K_MIN_MOVE, 9) : minMoveDelModo(sp);
        boolean movio = !tieneLast || haversine(lastLat, lastLng, loc.getLatitude(), loc.getLongitude()) >= minMove;
        boolean vivo = tieneLast && (now - lastSentAt) >= keepAlive;
        if (!movio && !vivo) {
            // No se guarda, pero SE RETIENE: si el próximo fix sí se mueve, este es el último lugar
            // donde de verdad estuvo antes de arrancar. Ver `fixRetenido`.
            cDescMovimiento++;
            fixRetenido = loc;
            return;
        }
        // 🩸 Cerrar la línea ciega: si veníamos de descartar por quietud, encolar primero el último
        // fix retenido. Sin esto, la recta va del punto de cortesía (de hasta 30 s antes) hasta acá,
        // y en ese tramo la persona ya arrancó y dobló — por eso el trazo cruzaba la manzana.
        //
        // Solo cuando MOVIÓ: en un keepAlive estando quieto el retenido está en el mismo lugar y
        // sería un punto duplicado por nada.
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

    private void arrancarUpdates() {
        if (callback != null) return;
        callback = new LocationCallback() {
            @Override public void onLocationResult(@Nullable LocationResult result) {
                if (result == null) return;
                // Fuera de la ventana: el servicio se PAUSA solo (corta GPS y WakeLock). Si no, con el
                // teléfono bloqueado a las 18:00 el JS no puede llamar detener() y el GPS drenaría toda
                // la noche. La ventana la pasa el JS en configurar().
                //
                // Hasta 1.10.0 acá se apagaba (`stopSelf`) y "volvía a arrancar cuando el vendedor abre
                // la app a la mañana" — que es literalmente el bug que reportó el cliente: dependía de
                // que alguien abriera la app. Ahora se reanuda solo. Ver el bloque de `pausar()`.
                if (!dentroDeVentana()) { pausar(); return; }
                reiniciarContadoresSiCambioElDia();
                for (Location loc : result.getLocations()) procesarFix(loc, false);
                // Un cambio de cadencia que quedó pendiente por el piso de permanencia se reintenta
                // acá: si no, quedaría anotado como "deseado" para siempre sin aplicarse nunca.
                aplicarCadencia();
                subir();
                // El contador de "puntos en espera" tiene que moverse aunque no haya red para
                // subirlos — es justo entonces cuando importa. `actualizarNotif` sale solo si el
                // texto cambió, así que llamarlo en cada fix es barato.
                actualizarNotif();
            }
        };
        modoRapido = false; // cada arranque parte en cadencia lenta; los primeros fixes la re-evalúan
        modoMovimiento = MODO_PIE;
        intervaloVigente = 0L;
        quiereCadencia(prefs().getLong(K_INTERVALO, 10000L));
    }

    /**
     * Deja anotada la cadencia que se QUIERE y trata de aplicarla. Todo el que quiera cambiar la
     * cadencia pasa por acá, nunca por `pedirUpdates` directo: es lo que hace posible el anti-churn.
     */
    private void quiereCadencia(long ms) {
        intervaloDeseado = ms;
        aplicarCadencia();
    }

    /**
     * 🩸 Aplica la cadencia deseada SOLO si de verdad cambia y si pasó el piso de permanencia. Si no,
     * queda pendiente y se reintenta en el próximo fix (por eso se llama una vez por lote en el
     * callback). Ver el comentario de `intervaloDeseado`: re-pedir updates reinicia la agenda de
     * entrega del proveedor, así que hacerlo cada 20-30 s equivale a no recibir nada.
     */
    private void aplicarCadencia() {
        if (callback == null || intervaloDeseado <= 0) return;
        if (intervaloDeseado == intervaloVigente) return;
        long now = System.currentTimeMillis();
        long piso = prefs().getInt(K_REPEDIDO_MIN_MS, 60000);
        // `intervaloVigente == 0` es el primer pedido del arranque: ese no espera a nadie.
        if (intervaloVigente != 0 && now - ultimoRepedidoAt < piso) return;
        pedirUpdates(intervaloDeseado);
    }

    /**
     * (Re)pide fixes al FusedLocation con el intervalo dado, reutilizando el MISMO callback. Cambiar la
     * cadencia en caliente es seguro con el foreground service ya vivo: NO hay el hueco break-before-make
     * que mata el FGS (ese riesgo es levantar el servicio desde background, no re-pedir updates). Volver a
     * llamar requestLocationUpdates con el mismo callback reemplaza el LocationRequest anterior.
     *
     * ⚠️ NO llamar desde afuera: entrar por `quiereCadencia`, que es la que respeta el anti-churn.
     */
    private void pedirUpdates(long intervalo) {
        if (callback == null) return;
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalo)
            .setMinUpdateIntervalMillis(intervalo)
            // Sin lotes: que el proveedor entregue cada fix cuando lo tiene, en vez de juntarlos y
            // soltarlos de a montones (que en el mapa se ve como saltos y silencios alternados).
            .setMaxUpdateDelayMillis(0)
            .build();
        try {
            fused.requestLocationUpdates(req, callback, Looper.getMainLooper());
            intervaloVigente = intervalo;
            ultimoRepedidoAt = System.currentTimeMillis();
            cRepedidos++;
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
                quiereCadencia(sp.getInt(K_INTERVALO_RAPIDO, 5000));
            }
        } else if (modoRapido && (now - ultimoRapidoAt) >= histMs) {
            modoRapido = false;
            quiereCadencia(sp.getLong(K_INTERVALO, 10000L));
        }
        // Modo de MOVIMIENTO, que gobierna cuánto hay que moverse para GUARDAR un punto. Sube al
        // instante y baja con la misma histéresis que la cadencia: ante la duda, más denso.
        double velRuta = sp.getFloat(K_VEL_RUTA, 11.0f);
        int nuevo = v >= velRuta ? MODO_RUTA : (v >= umbral ? MODO_URBANO : MODO_PIE);
        if (nuevo > modoMovimiento) modoMovimiento = nuevo;
        else if (nuevo < modoMovimiento && (now - ultimoRapidoAt) >= histMs) modoMovimiento = nuevo;
    }

    /**
     * 🩸 EL CARRIL DE TRIANGULACIÓN (1.9.0). Se enciende cuando el GPS lleva `silencioMs` sin
     * entregar nada, y se apaga con el primer fix bueno que vuelva. Mientras está encendido pide
     * ubicación a los DOS proveedores del `LocationManager` de plataforma:
     *
     *   · NETWORK_PROVIDER — la triangulación propiamente dicha (antenas + WiFi). Da 20-80 m en el
     *     pueblo y cientos en el campo, así que entra por su propio techo (`accuracyRedMaxM`) y
     *     queda marcado por su `accuracy` para que el front lo dibuje punteado y lo deje fuera de
     *     los km y del snap.
     *   · GPS_PROVIDER — el chip, pero pedido DIRECTO, sin pasar por Play Services. Es la red de
     *     contención para el caso en que lo que está estrangulado sea el proveedor fusionado y no
     *     el GPS: si por acá entran fixes mientras Fused calla, ya sabemos de quién es el problema.
     *
     * Los dos van al MISMO camino de filtrado que los de Fused (`procesarFix`), así que ni el filtro
     * de salto imposible ni el de movimiento se saltean.
     */
    private void encenderCarrilRed() {
        if (pidiendoRed) return;
        try {
            android.location.LocationManager lm =
                (android.location.LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return;
            redListener = new android.location.LocationListener() {
                @Override public void onLocationChanged(Location loc) {
                    // 🩸 El carril pide a DOS proveedores, y no son lo mismo: un fix del GPS_PROVIDER
                    // es un fix de GPS de verdad —tiene que contar como tal, apagar el carril y su
                    // precisión se juzga con el techo normal— y solo el de NETWORK_PROVIDER es
                    // triangulado. Marcarlos a los dos como "de red" dejaría el carril prendido para
                    // siempre y mandaría fixes buenos a dibujarse punteados.
                    boolean deRed = loc != null
                        && !android.location.LocationManager.GPS_PROVIDER.equals(loc.getProvider());
                    procesarFix(loc, deRed);
                }
                @Override public void onProviderEnabled(String p) {}
                @Override public void onProviderDisabled(String p) {}
                @SuppressWarnings("deprecation")
                @Override public void onStatusChanged(String p, int s, android.os.Bundle e) {}
            };
            long cada = Math.max(10000L, intervaloVigente);
            if (lm.isProviderEnabled(android.location.LocationManager.NETWORK_PROVIDER)) {
                lm.requestLocationUpdates(android.location.LocationManager.NETWORK_PROVIDER, cada, 0f, redListener, Looper.getMainLooper());
            }
            if (lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)) {
                lm.requestLocationUpdates(android.location.LocationManager.GPS_PROVIDER, cada, 0f, redListener, Looper.getMainLooper());
            }
            pidiendoRed = true;
        } catch (SecurityException e) {
            // Sin permiso no hay carril de red; el servicio sigue igual que antes.
        } catch (Exception ignored) {}
    }

    private void apagarCarrilRed() {
        if (!pidiendoRed) return;
        try {
            android.location.LocationManager lm =
                (android.location.LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm != null && redListener != null) lm.removeUpdates(redListener);
        } catch (Exception ignored) {}
        redListener = null;
        pidiendoRed = false;
    }

    /** Metros que hay que moverse para GUARDAR un punto, según el modo. Ver K_MIN_MOVE_URBANO. */
    private float minMoveDelModo(SharedPreferences sp) {
        if (modoMovimiento == MODO_RUTA) return sp.getInt(K_MIN_MOVE_RUTA, 100);
        if (modoMovimiento == MODO_URBANO) return sp.getInt(K_MIN_MOVE_URBANO, 15);
        return sp.getInt(K_MIN_MOVE, 9);
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
                volcarTelemetria(sp.edit().putLong(K_ULTIMA, System.currentTimeMillis())).apply();
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
        // 🩸 En PAUSA el cartel dice hasta cuándo (05/08/2026). Es la contraparte visible de que el
        // servicio ya no se apaga fuera de horario: si va a quedar una notificación toda la noche,
        // tiene que explicarse sola. "En pausa hasta las 08:00" también es mejor postura frente a la
        // ley 25.326 que una app que aparece y desaparece sin decir nada (ver legal/).
        if (enPausa) {
            String h = VentanaRastreo.hhmm(VentanaRastreo.proximoInicio(prefs(), System.currentTimeMillis()));
            return h.isEmpty() ? "En pausa · fuera de horario" : "En pausa hasta las " + h;
        }
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
     * nativo, para que el servicio no dependa del WebView. Hora y día en LOCAL (no UTC).
     *
     * El parser se mudó a `VentanaRastreo` (05/08/2026) SIN cambiarle una sola regla: la semántica de
     * unión, los días ISO, los extremos inclusivos y el cruce de medianoche siguen siendo idénticos, y
     * los comentarios que los explicaban viajaron con el código (regla 24). Se extrajo porque hacía
     * falta calcular el PRÓXIMO INICIO de ventana —para programar la alarma del arranque— y eso tenía
     * que salir de esta misma definición y no de una copia (regla 36).
     */
    private boolean dentroDeVentana() {
        return VentanaRastreo.dentro(prefs(), System.currentTimeMillis());
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

    /* ════════════════════════════════════════════════════════════════════════════════════════
     * 🩸 FUERA DE HORARIO SE PAUSA, NO SE APAGA (05/08/2026) — el arreglo del arranque tardío.
     *
     * Hasta 1.10.0 esto era un solo `detenerServicio()` con `stopSelf()`, y ESO era la causa del
     * bug reportado ("le asigno las 8 y a veces no inicia"). La cadena era:
     *
     *   1. el watchdog despierta a las 07:52 (pinguea cada 30 min, a ciegas del horario);
     *   2. AlarmReceiver arranca el servicio sin mirar la ventana;
     *   3. a los 30 s el latido ve que son las 07:52 y llama stopSelf();
     *   4. la próxima alarma queda a las 08:22 → el rastreo arranca media hora tarde.
     *
     * Y en el caso peor ni siquiera arrancaba: Android 12+ prohíbe iniciar un foreground service
     * desde background salvo exenciones, así que el paso 2 podía fallar TODO el día, en silencio,
     * hasta que alguien abría la app. Medido sobre 29 días hábiles: mediana de 51 min de retraso.
     *
     * Pausar en vez de apagar elimina la clase entera de fallo: no hay que arrancar un servicio
     * desde background si el servicio nunca se apagó. Y recupera START_STICKY como red real — hoy
     * era decorativo, porque el SO no reinicia un servicio que se detuvo SOLO.
     *
     * El costo, asumido a conciencia: la notificación queda 24 h en vez de ~10. Por eso el texto
     * dice hasta cuándo (ver textoEstado).
     *
     * ⚠️ ESTO NO TOCA EL CIERRE DE SESIÓN, y no puede llegar a tocarlo nunca. El apagado de verdad
     * lo hace `stopService()` desde UploaderGpsPlugin (`detener()` / `cerrarSesion()`) y termina en
     * `onDestroy`, que es un camino distinto de este. Para el uploader nativo el token ES la
     * identidad: un servicio "pausado" con el token de la cuenta anterior sería exactamente el bug
     * incorregible de la regla 19-bis — `posiciones` no tiene policy de UPDATE ni de DELETE, así que
     * esas filas no se arreglan. Si alguna vez alguien hace que el logout pause en vez de detener,
     * vuelve ese bug.
     * ════════════════════════════════════════════════════════════════════════════════════════ */

    /**
     * Fuera de ventana: corta el GPS y suelta la CPU, PERO sigue en foreground y sigue vivo.
     * Idempotente: el latido la puede llamar de más sin costo.
     */
    private void pausar() {
        if (enPausa) return;
        enPausa = true;
        try { if (callback != null) fused.removeLocationUpdates(callback); } catch (Exception ignored) {}
        callback = null;
        apagarCarrilRed();
        // El WakeLock se suelta acá y no solo en onDestroy: fuera de la ventana horaria, dejar la
        // CPU despierta toda la noche sería exactamente el drenaje que la ventana vino a evitar.
        soltarWakeLock();
        // Dejar armado el próximo arranque ANTES de quedarse quieto. Hasta 1.10.0 el servicio se
        // apagaba a las 18:00 y no le avisaba a nadie: el despertar de la mañana siguiente dependía
        // de lo que el receiver hubiera programado a ciegas.
        try { AlarmWatchdogPlugin.programarProxima(this); } catch (Exception ignored) {}
        actualizarNotif();
    }

    /** Vuelve la ventana: retoma CPU, GPS y cadencia normal. Idempotente. */
    private void reanudar() {
        if (!enPausa) return;
        enPausa = false;
        tomarWakeLock();
        arrancarUpdates();
        actualizarNotif();
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
            volcarTelemetria(prefs().edit()).putInt(K_TEL_DIA, diaContadores).commit();
        } catch (Exception ignored) {}
        latidoH.removeCallbacks(latido);
        apagarCarrilRed();
        soltarWakeLock();
        // Soltar la referencia estática: sin esto queda un Service muerto retenido para siempre.
        if (instancia == this) instancia = null;
        super.onDestroy();
    }
}
