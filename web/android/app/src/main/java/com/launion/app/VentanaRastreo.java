package com.launion.app;

import android.content.SharedPreferences;

import java.util.ArrayList;
import java.util.Calendar;

/**
 * LA VENTANA DE RASTREO, en un solo lugar del lado nativo.
 *
 * Este archivo NO introduce reglas nuevas: es el parser que vivía dentro de
 * `UploaderGpsService.dentroDeVentana()`, extraído tal cual. Misma semántica de UNIÓN, mismos días
 * ISO (1=Lun..7=Dom), mismos extremos INCLUSIVOS, mismo cruce de medianoche, mismo fallback de
 * `ventanas` vacía a K_START/K_END/K_DIAS. Los comentarios que lo explicaban se migraron acá
 * (regla 24: no son ruido, son la memoria del proyecto).
 *
 * 🩸 POR QUÉ SE EXTRAJO (05/08/2026) — el bug del arranque tardío.
 *
 * Reportado desde la calle: "le asigno las 8 y a veces el rastreo no inicia". Medido contra la base
 * viva sobre 29 días hábiles: el primer punto del día llegaba con una mediana de 51 minutos de
 * retraso, y el 79 % de los días con más de 15. La causa no era esta función —que decide bien si
 * AHORA estamos dentro— sino que NADIE sabía calcular CUÁNDO EMPIEZA la próxima ventana. El
 * watchdog programaba "ahora + 30 min" a ciegas, sin mirar el horario de la persona.
 *
 * El contraste que lo prueba: el último punto del día era 18:00 clavado casi siempre. El borde de
 * CIERRE lo ejecuta un servicio que ya está vivo mirando el reloj; el de APERTURA no tenía quién.
 *
 * ⚠️ REGLA 36 — la ventana está implementada TRES veces: `dentroDeHorario()` (JS,
 * services/tracking.js), esto (Java) y `en_ventana` (SQL, `vigilancia_equipo`). Tocar una sin las
 * otras hace que los avisos al supervisor mientan en silencio. Por eso `proximoInicio` NO es una
 * fórmula cerrada: es un BARRIDO sobre la misma `dentro()`. Ver el comentario de ese método.
 */
final class VentanaRastreo {

    private VentanaRastreo() {}

    /** Una franja: [start, end] en minutos del día, con sus días ISO (vacío = todos). */
    static final class Ventana {
        final int start;
        final int end;
        final int[] dias; // ISO 1=Lun..7=Dom. Longitud 0 = todos los días.

        Ventana(int start, int end, String diasCsv) {
            this.start = start;
            this.end = end;
            ArrayList<Integer> ds = new ArrayList<>();
            if (diasCsv != null && !diasCsv.isEmpty()) {
                for (String d : diasCsv.split(",")) {
                    try { ds.add(Integer.parseInt(d.trim())); } catch (Exception ignored) {}
                }
            }
            this.dias = new int[ds.size()];
            for (int i = 0; i < ds.size(); i++) this.dias[i] = ds.get(i);
        }
    }

    /**
     * Lee las ventanas de las prefs.
     *
     * @return `null` si NO hay ventana configurada (→ se rastrea siempre). Un array VACÍO si la
     *         clave `ventanas` vino pero no se pudo parsear nada de ella (→ no se rastrea nunca).
     *
     * 🩸 Esa distinción entre `null` y vacío no es un detalle de estilo: reproduce exactamente el
     * comportamiento del código original. Ahí, si `ventanas` no estaba vacía, el bucle terminaba en
     * `return false` y NUNCA caía al fallback de K_START/K_END. Colapsar los dos casos en "sin
     * ventana" haría que una cadena corrupta pasara de "no rastrear" a "rastrear las 24 h", que es
     * el error más caro de los dos.
     */
    static Ventana[] leer(SharedPreferences sp) {
        // Jornada partida (1.8.0): varias ventanas con semántica de UNIÓN. Si el JS no la mandó
        // (APK nuevo + bundle viejo), se cae a la ventana única de siempre.
        String ventanas = sp.getString(UploaderGpsService.K_VENTANAS, "");
        if (ventanas != null && !ventanas.isEmpty()) {
            ArrayList<Ventana> out = new ArrayList<>();
            for (String v : ventanas.split(";")) {
                // "inicio-fin-dias" — los días pueden venir vacíos (= todos) y llevan comas adentro,
                // así que se parte en 3 como máximo.
                String[] p = v.split("-", 3);
                if (p.length < 2) continue;
                try {
                    int s = Integer.parseInt(p[0].trim());
                    int e = Integer.parseInt(p[1].trim());
                    if (s < 0 || e < 0) continue;
                    out.add(new Ventana(s, e, p.length > 2 ? p[2] : ""));
                } catch (Exception ignored) {}
            }
            return out.toArray(new Ventana[0]);
        }

        int start = sp.getInt(UploaderGpsService.K_START, -1);
        int end = sp.getInt(UploaderGpsService.K_END, -1);
        if (start < 0 || end < 0) return null; // sin ventana configurada → siempre
        return new Ventana[]{ new Ventana(start, end, sp.getString(UploaderGpsService.K_DIAS, "")) };
    }

    /** ¿El minuto `cur` del día ISO `iso` cae en la ventana? */
    static boolean aplica(Ventana v, int cur, int iso) {
        if (v.dias.length > 0) {
            boolean hoy = false;
            for (int d : v.dias) { if (d == iso) { hoy = true; break; } }
            if (!hoy) return false;
        }
        // start > end = ventana que cruza la medianoche ('22:00'–'06:00').
        return v.start <= v.end ? (cur >= v.start && cur <= v.end) : (cur >= v.start || cur <= v.end);
    }

    /** ¿El minuto `cur` del día ISO `iso` cae dentro de ALGUNA ventana? Semántica de UNIÓN. */
    private static boolean dentroEn(Ventana[] vs, int cur, int iso) {
        if (vs == null) return true;
        for (Ventana v : vs) { if (aplica(v, cur, iso)) return true; }
        return false;
    }

    /** Minuto del día de un Calendar. */
    private static int minutoDe(Calendar c) {
        return c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE);
    }

    /** Día ISO de un Calendar: DAY_OF_WEEK es 1=Dom..7=Sáb → 1=Lun..7=Dom. */
    private static int isoDe(Calendar c) {
        int dow = c.get(Calendar.DAY_OF_WEEK);
        return dow == Calendar.SUNDAY ? 7 : dow - 1;
    }

    /**
     * ¿`instante` cae dentro de la ventana de rastreo? Hora y día en LOCAL (no UTC), zona horaria
     * del dispositivo.
     *
     * Es la función que antes se llamaba `dentroDeVentana()`, con el instante EXPLÍCITO en vez de
     * `Calendar.getInstance()` implícito — ese es el único cambio, y es lo que permite barrer el
     * futuro con la misma definición en vez de escribir una segunda.
     */
    static boolean dentro(SharedPreferences sp, long instante) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(instante);
        return dentroEn(leer(sp), minutoDe(c), isoDe(c));
    }

    /** Minutos a barrer hacia adelante: 7 días + 1 de margen, para listas de días con huecos. */
    private static final int LIMITE_MIN = 8 * 24 * 60;

    /**
     * Próximo instante (epoch ms) en que el rastreo PASA a estar dentro de la ventana.
     *
     * @return -1 si no hay borde: sin ventana configurada (siempre dentro) o ventana imposible
     *         (nunca dentro). Los dos casos son "no programes nada por horario".
     *
     * 🩸 POR QUÉ BARRIDO Y NO FÓRMULA (regla 36). Una derivación analítica del próximo inicio sería
     * una CUARTA implementación de la ventana, con licencia para divergir de las otras tres. Y hay
     * al menos un caso que casi seguro traduciría mal: una ventana `22:00–06:00` con `dias=[1]` está
     * activa el LUNES de 22:00 a 23:59 **y el LUNES de 00:00 a 06:00**, porque el chequeo de día se
     * aplica al día del instante EVALUADO, no al de apertura. Un barrido sobre `dentro()` no puede
     * divergir: es la definición misma.
     *
     * Costo: 11.520 evaluaciones sobre un array ya parseado (~10 ms), unas pocas veces por día. Se
     * paga con gusto a cambio de no poder equivocarse.
     */
    static long proximoInicio(SharedPreferences sp, long desde) {
        return buscarBorde(sp, desde, true);
    }

    /**
     * Próximo instante (epoch ms) en que el rastreo PASA a estar fuera de la ventana. Alimenta el
     * texto "En pausa hasta las …" y el apagado ordenado. -1 si no hay borde.
     */
    static long proximoFin(SharedPreferences sp, long desde) {
        return buscarBorde(sp, desde, false);
    }

    /**
     * El barrido, compartido por los dos bordes. `abriendo` = buscar la transición false→true
     * (inicio); si no, true→false (fin).
     *
     * ⚡ EL BUCLE NO TOCA `Calendar`, y eso NO es micro-optimización. La primera versión hacía
     * `Calendar.add(MINUTE, 1)` en cada paso, y cada `add()` invalida los campos → el `get()`
     * siguiente dispara un `computeFields()` completo. Son 11.520 recálculos de fecha **en el hilo
     * principal**, llamados desde `onStartCommand` (que tiene un presupuesto de 5 s antes de que
     * Android mate el servicio) y desde `textoEstado()`. En una PC no se nota; en los teléfonos de
     * gama baja que usa el equipo puede irse a cientos de milisegundos.
     *
     * Avanzar un minuto es aritmética trivial (`cur+1`, y al pasar de 1439 arranca otro día ISO), y
     * NO es semántica de ventana: la decisión sigue siendo `aplica()`, la única definición que hay
     * (regla 36). El `Calendar` se usa dos veces y nada más: para leer el punto de partida y para
     * convertir el índice del minuto encontrado en un epoch. Esa segunda conversión va con
     * `Calendar.add` justamente para que un eventual cambio de huso no desfase el resultado — Salta
     * es UTC−3 fijo, pero el teléfono se puede llevar de viaje.
     */
    private static long buscarBorde(SharedPreferences sp, long desde, boolean abriendo) {
        Ventana[] vs = leer(sp);
        if (vs == null) return -1; // sin ventana: no hay borde que esperar
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(desde);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        long base = c.getTimeInMillis();
        int cur = minutoDe(c);
        int iso = isoDe(c);
        boolean prev = dentroEn(vs, cur, iso);
        for (int i = 1; i <= LIMITE_MIN; i++) {
            cur++;
            if (cur >= 1440) { cur = 0; iso = iso % 7 + 1; } // 7 (Dom) → 1 (Lun)
            boolean ahora = dentroEn(vs, cur, iso);
            if (abriendo ? (!prev && ahora) : (prev && !ahora)) {
                Calendar r = Calendar.getInstance();
                r.setTimeInMillis(base);
                r.add(Calendar.MINUTE, i);
                return r.getTimeInMillis();
            }
            prev = ahora;
        }
        return -1;
    }

    /** 'HH:MM' local de un epoch ms, para la notificación. '' si no hay instante. */
    static String hhmm(long ms) {
        if (ms <= 0) return "";
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(ms);
        return String.format(java.util.Locale.US, "%02d:%02d",
                c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE));
    }
}
