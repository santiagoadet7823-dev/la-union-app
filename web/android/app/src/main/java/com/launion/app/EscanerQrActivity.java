package com.launion.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageAnalysis;
import androidx.camera.core.ImageProxy;
import androidx.camera.view.CameraController;
import androidx.camera.view.LifecycleCameraController;
import androidx.camera.view.PreviewView;
import androidx.core.app.ActivityCompat;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.Result;
import com.google.zxing.common.HybridBinarizer;

import java.nio.ByteBuffer;
import java.util.Arrays;
import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Pantalla de ESCANEO del QR de la vidriera. La abre `EscanerQrPlugin` y devuelve el texto leído.
 *
 * POR QUÉ UNA ACTIVITY Y NO UNA CÁMARA DETRÁS DEL WEBVIEW. Para previsualizar dentro de la app
 * habría que hacer transparente el WebView y meter una `SurfaceView` por debajo — que es frágil, se
 * pelea con el scroll y deja la cámara viva si alguien navega. Una Activity propia se abre, hace UNA
 * cosa y se cierra; el ciclo de vida lo maneja Android y la cámara se libera sola.
 *
 * POR QUÉ ZXing A MANO Y NO `zxing-android-embedded`. El decodificador ya está en el proyecto
 * (`com.google.zxing:core`, lo usa `QrPlugin` para GENERAR). La librería embebida traería una UI que
 * no queremos y una cámara vieja (Camera1) que en Android 9 de gama baja anda peor que CameraX.
 *
 * 🩸 SOLO EL PLANO Y. Un frame de la cámara viene en YUV_420_888 y la luminancia está entera en el
 * primer plano: el QR es blanco y negro, así que el color no aporta nada y convertir a RGB sería
 * copiar tres veces más bytes por frame en una tablet de 2 GB. `PlanarYUVLuminanceSource` está hecho
 * exactamente para esto.
 *
 * ⚠️ `rowStride` NO siempre es igual al ancho: la cámara alinea las filas, y suponer que coinciden
 * es el error clásico que hace que el QR se lea en un teléfono y en otro no. Cuando hay relleno se
 * compacta fila por fila antes de decodificar.
 */
public class EscanerQrActivity extends AppCompatActivity {

    private static final String TAG = "EscanerQr";
    public static final String EXTRA_TEXTO = "texto";
    public static final String EXTRA_ERROR = "error";
    private static final int PIDO_CAMARA = 7311;

    private PreviewView vista;
    private ExecutorService hilo;
    private LifecycleCameraController camara;
    /** Una vez que se leyó, se ignora todo lo demás: sin esto llegan 3-4 resultados del mismo QR. */
    private final AtomicBoolean listo = new AtomicBoolean(false);
    private final MultiFormatReader lector = new MultiFormatReader();

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);

        // Solo QR: acotar los formatos hace el decodificador MUCHO más rápido, y en una tablet lenta
        // eso es la diferencia entre "lee al instante" y "hay que quedarse quieto tres segundos".
        Map<DecodeHintType, Object> pistas = new EnumMap<>(DecodeHintType.class);
        pistas.put(DecodeHintType.POSSIBLE_FORMATS, Arrays.asList(BarcodeFormat.QR_CODE));
        // 🩸 TRY_HARDER (19/08/2026). El cliente reportó que la cámara de la tablet no enfoca bien y
        // el escaneo falla. Esta bandera hace que ZXing pruebe más rotaciones y binarizaciones por
        // frame: cuesta CPU, y es exactamente el gasto que corresponde acá — el equipo está QUIETO
        // sobre un mostrador apuntando a una pantalla, no siguiendo un código en movimiento, así que
        // sobra tiempo entre frames y lo que falta es tolerancia al desenfoque.
        // La otra mitad del arreglo no está acá: el QR pasó de 213 a 105 caracteres (ver `textoQr`),
        // que baja varias versiones de QR y agranda los módulos.
        pistas.put(DecodeHintType.TRY_HARDER, Boolean.TRUE);
        lector.setHints(pistas);

        FrameLayout raiz = new FrameLayout(this);
        raiz.setBackgroundColor(Color.BLACK);
        vista = new PreviewView(this);
        raiz.addView(vista, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        TextView ayuda = new TextView(this);
        ayuda.setText("Apuntá al código del celular del vendedor");
        ayuda.setTextColor(Color.WHITE);
        ayuda.setTextSize(16);
        ayuda.setPadding(40, 40, 40, 80);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL;
        raiz.addView(ayuda, lp);

        setContentView(raiz);
        hilo = Executors.newSingleThreadExecutor();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this, new String[]{ Manifest.permission.CAMERA }, PIDO_CAMARA);
        } else {
            abrirCamara();
        }
    }

    @Override
    public void onRequestPermissionsResult(int codigo, @NonNull String[] permisos, @NonNull int[] r) {
        super.onRequestPermissionsResult(codigo, permisos, r);
        if (codigo != PIDO_CAMARA) return;
        if (r.length > 0 && r[0] == PackageManager.PERMISSION_GRANTED) abrirCamara();
        else terminarConError("Sin permiso de cámara no se puede escanear el código.");
    }

    /**
     * 🩸 SE USA `LifecycleCameraController` Y NO `ProcessCameraProvider` (18/08/2026). El camino de
     * abajo nivel devuelve un `ListenableFuture`, y CameraX declara Guava como `implementation`, así
     * que ese tipo NO llega al classpath de compilación de quien lo consume — el mismo caso que ya
     * se pagó con play-services-location y firebase-messaging. La salida obvia era sumar
     * `com.google.guava:listenablefuture`, pero Google publica también una versión **9999.0 vacía**
     * que Gradle elige por ser el número mayor, así que el import sigue sin resolver; y traer Guava
     * entera son ~2,7 MB en una tablet de 32 bits y 2 GB de RAM.
     *
     * El controlador de alto nivel no expone futuros, hace el binding solo y encima deja este método
     * en cinco líneas. Menos dependencias y menos código para el mismo resultado.
     */
    private void abrirCamara() {
        try {
            camara = new LifecycleCameraController(this);
            camara.setCameraSelector(CameraSelector.DEFAULT_BACK_CAMERA);
            // Solo análisis: sin esto CameraX también prepara captura de foto y grabación de video,
            // que acá no se usan y en un equipo lento cuestan memoria y tiempo de arranque.
            camara.setEnabledUseCases(CameraController.IMAGE_ANALYSIS);
            camara.setImageAnalysisBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST);
            camara.setImageAnalysisAnalyzer(hilo, new ImageAnalysis.Analyzer() {
                @Override public void analyze(@NonNull ImageProxy imagen) {
                    try { mirar(imagen); } finally { imagen.close(); }
                }
            });
            camara.bindToLifecycle(this);
            vista.setController(camara);
        } catch (Exception e) {
            Log.e(TAG, "No se pudo abrir la cámara", e);
            terminarConError("No se pudo abrir la cámara: " + e.getMessage());
        }
    }

    private void mirar(ImageProxy imagen) {
        if (listo.get()) return;
        ImageProxy.PlaneProxy plano = imagen.getPlanes()[0];
        ByteBuffer buf = plano.getBuffer();
        int ancho = imagen.getWidth(), alto = imagen.getHeight();
        int stride = plano.getRowStride();

        byte[] y;
        if (stride == ancho) {
            y = new byte[buf.remaining()];
            buf.get(y);
        } else {
            // Hay relleno al final de cada fila: se compacta, si no el QR sale "cortado en diagonal".
            y = new byte[ancho * alto];
            byte[] fila = new byte[stride];
            for (int i = 0; i < alto && buf.remaining() >= stride; i++) {
                buf.get(fila, 0, stride);
                System.arraycopy(fila, 0, y, i * ancho, ancho);
            }
        }

        try {
            PlanarYUVLuminanceSource fuente =
                    new PlanarYUVLuminanceSource(y, ancho, alto, 0, 0, ancho, alto, false);
            Result r = lector.decodeWithState(new BinaryBitmap(new HybridBinarizer(fuente)));
            if (r != null && r.getText() != null && listo.compareAndSet(false, true)) {
                final String texto = r.getText();
                runOnUiThread(new Runnable() {
                    @Override public void run() { terminarConTexto(texto); }
                });
            }
        } catch (Exception ignored) {
            // No hay QR en este frame. Es el caso NORMAL, decenas de veces por segundo: ZXing avisa
            // con una excepción y no con null, así que esto no se loguea ni se cuenta.
        } finally {
            lector.reset();
        }
    }

    private void terminarConTexto(String texto) {
        Intent i = new Intent();
        i.putExtra(EXTRA_TEXTO, texto);
        setResult(RESULT_OK, i);
        finish();
    }

    private void terminarConError(String motivo) {
        Intent i = new Intent();
        i.putExtra(EXTRA_ERROR, motivo);
        setResult(RESULT_CANCELED, i);
        finish();
    }

    @Override
    protected void onDestroy() {
        try { if (camara != null) camara.unbind(); } catch (Exception ignored) { }
        if (hilo != null) hilo.shutdown();
        super.onDestroy();
    }
}
