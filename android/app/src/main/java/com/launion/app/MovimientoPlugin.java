package com.launion.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import com.google.android.gms.common.ConnectionResult;
import com.google.android.gms.common.GoogleApiAvailability;
import com.google.android.gms.location.ActivityRecognition;
import com.google.android.gms.location.ActivityTransition;
import com.google.android.gms.location.ActivityTransitionRequest;
import com.google.android.gms.location.DetectedActivity;

import java.util.ArrayList;
import java.util.List;

/**
 * Plugin nativo de Activity Recognition ("¿el vendedor se está moviendo?").
 *
 * Motivo: hoy el GPS corre a 1 Hz máxima precisión toda la jornada porque la app no
 * tiene forma de saber si el vendedor está quieto o andando. El coprocesador de
 * movimiento del teléfono responde esa pregunta a costo ~cero (es lo que usa Life360),
 * y con eso JS puede decidir cuándo hace falta GPS fino de verdad.
 *
 * Este plugin es SÓLO el sensor: emite transiciones crudas. La máquina de estados
 * (cuándo prender/apagar el GPS) vive en JS.
 *
 * Expone:
 *  - escuchar():   callback persistente, emite { actividad, transicion } por transición.
 *  - parar():      corta las updates y libera el callback.
 *  - disponible(): { disponible: boolean } — permiso concedido + Play Services presente.
 *
 * La entrega es por PendingIntent → ver MovimientoReceiver (declarado en el manifest,
 * justificado ahí).
 */
@CapacitorPlugin(
        name = "Movimiento",
        permissions = {
                @Permission(
                        strings = { Manifest.permission.ACTIVITY_RECOGNITION },
                        alias = MovimientoPlugin.ALIAS_ACTIVIDAD
                )
        }
)
public class MovimientoPlugin extends Plugin {

    static final String ALIAS_ACTIVIDAD = "actividad";

    /** Código del PendingIntent. Constante: así requestActivityTransitionUpdates y
     *  removeActivityTransitionUpdates hablan del mismo intent. */
    private static final int CODIGO_PENDING_INTENT = 4177;

    /**
     * Instancia viva del plugin, para que el receiver (que es una clase aparte,
     * instanciada por el sistema) pueda llegar al bridge. Si el proceso fue revivido
     * por el broadcast y todavía no hay plugin, queda null y la transición se descarta
     * sin romper nada.
     */
    private static MovimientoPlugin instancia;

    /** La PluginCall de escuchar(), mantenida viva para resolverla muchas veces. */
    private PluginCall llamadaEscucha;

    private PendingIntent pendingIntent;

    @Override
    public void load() {
        instancia = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (instancia == this) instancia = null;
        super.handleOnDestroy();
    }

    // ---------------------------------------------------------------- métodos JS

    @PluginMethod(returnType = PluginMethod.RETURN_CALLBACK)
    public void escuchar(PluginCall call) {
        // El callback tiene que sobrevivir al return de este método: es un stream de
        // eventos, no una respuesta única.
        call.setKeepAlive(true);

        if (!permisoConcedido()) {
            requestPermissionForAlias(ALIAS_ACTIVIDAD, call, "callbackPermisoActividad");
            return;
        }
        registrarTransiciones(call);
    }

    @PermissionCallback
    private void callbackPermisoActividad(PluginCall call) {
        // El usuario puede decir que no: se rechaza la call (esto la libera) y listo,
        // sin crashear. JS cae al modo GPS de siempre.
        if (!permisoConcedido()) {
            call.reject("El usuario denegó el permiso de reconocimiento de actividad", "NOT_AUTHORIZED");
            return;
        }
        registrarTransiciones(call);
    }

    @PluginMethod
    public void parar(PluginCall call) {
        if (pendingIntent != null) {
            try {
                ActivityRecognition.getClient(getContext())
                        .removeActivityTransitionUpdates(pendingIntent);
            } catch (SecurityException e) {
                // Permiso revocado desde Ajustes mientras corría: nada que remover.
            } catch (Exception e) {
                // Play Services caído/desactualizado: idem, no vale la pena romper.
            }
            pendingIntent.cancel();
            pendingIntent = null;
        }
        liberarEscucha();
        call.resolve();
    }

    @PluginMethod
    public void disponible(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("disponible", permisoConcedido() && playServicesPresente());
        call.resolve(ret);
    }

    // ---------------------------------------------------------------- interno

    private void registrarTransiciones(PluginCall call) {
        if (!playServicesPresente()) {
            call.reject("Google Play Services no está disponible en este dispositivo", "UNAVAILABLE");
            return;
        }

        try {
            pendingIntent = crearPendingIntent();
            ActivityRecognition.getClient(getContext())
                    .requestActivityTransitionUpdates(
                            new ActivityTransitionRequest(transicionesDeInteres()),
                            pendingIntent
                    )
                    .addOnSuccessListener(v -> llamadaEscucha = call)
                    .addOnFailureListener(e ->
                            call.reject("No se pudieron registrar las transiciones: " + e.getMessage())
                    );
        } catch (SecurityException e) {
            // Carrera: el permiso se revocó entre el chequeo y el registro.
            call.reject("Sin permiso de reconocimiento de actividad", "NOT_AUTHORIZED");
        } catch (Exception e) {
            call.reject("Error registrando Activity Recognition: " + e.getMessage());
        }
    }

    private PendingIntent crearPendingIntent() {
        // Intent EXPLÍCITO contra nuestro receiver del manifest.
        Intent intent = new Intent(getContext(), MovimientoReceiver.class);
        intent.setAction(MovimientoReceiver.ACCION);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // OJO: API 31+ exige declarar mutabilidad, y acá tiene que ser MUTABLE.
            // El SO ESCRIBE el resultado de la transición dentro del intent antes de
            // dispararlo; con FLAG_IMMUTABLE compila, registra sin error... y no llega
            // nunca nada. Es el error clásico de Activity Recognition.
            flags |= PendingIntent.FLAG_MUTABLE;
        }

        return PendingIntent.getBroadcast(getContext(), CODIGO_PENDING_INTENT, intent, flags);
    }

    /** ENTER y EXIT para cada actividad que nos importa para decidir el GPS. */
    private List<ActivityTransition> transicionesDeInteres() {
        int[] actividades = {
                DetectedActivity.STILL,
                DetectedActivity.WALKING,
                DetectedActivity.ON_FOOT,
                DetectedActivity.IN_VEHICLE,
                DetectedActivity.ON_BICYCLE
        };
        int[] tipos = {
                ActivityTransition.ACTIVITY_TRANSITION_ENTER,
                ActivityTransition.ACTIVITY_TRANSITION_EXIT
        };

        List<ActivityTransition> lista = new ArrayList<>();
        for (int actividad : actividades) {
            for (int tipo : tipos) {
                lista.add(new ActivityTransition.Builder()
                        .setActivityType(actividad)
                        .setActivityTransition(tipo)
                        .build());
            }
        }
        return lista;
    }

    private boolean permisoConcedido() {
        // API 23-28: ACTIVITY_RECOGNITION no existe como permiso de plataforma; va la
        // rama legacy de gms declarada en el manifest, que se auto-concede en la
        // instalación. No hay nada que pedir en runtime.
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return getPermissionState(ALIAS_ACTIVIDAD) == PermissionState.GRANTED;
    }

    private boolean playServicesPresente() {
        try {
            return GoogleApiAvailability.getInstance()
                    .isGooglePlayServicesAvailable(getContext()) == ConnectionResult.SUCCESS;
        } catch (Exception e) {
            return false;
        }
    }

    private void liberarEscucha() {
        if (llamadaEscucha != null) {
            llamadaEscucha.release(getBridge());
            llamadaEscucha = null;
        }
    }

    // ---------------------------------------------------------------- puente al receiver

    /** Llamado por MovimientoReceiver por cada transición extraída del intent. */
    static void entregarTransicion(String actividad, String transicion) {
        MovimientoPlugin plugin = instancia;
        if (plugin == null) return;                 // proceso revivido sin WebView todavía
        if (actividad == null) return;              // actividad que no nos interesa

        PluginCall call = plugin.llamadaEscucha;
        if (call == null) return;                   // nadie escuchando

        JSObject evento = new JSObject();
        evento.put("actividad", actividad);
        evento.put("transicion", transicion);
        call.resolve(evento);                       // keepAlive → se puede resolver de nuevo
    }

    /** DetectedActivity → string legible para JS. null si no nos interesa. */
    static String nombreActividad(int tipo) {
        switch (tipo) {
            case DetectedActivity.STILL:      return "quieto";
            case DetectedActivity.WALKING:
            case DetectedActivity.ON_FOOT:    return "caminando";
            case DetectedActivity.IN_VEHICLE: return "vehiculo";
            case DetectedActivity.ON_BICYCLE: return "bicicleta";
            default:                          return null;
        }
    }

    /** Tipo de transición → string legible para JS. */
    static String nombreTransicion(int tipo) {
        return tipo == ActivityTransition.ACTIVITY_TRANSITION_ENTER ? "entra" : "sale";
    }
}
