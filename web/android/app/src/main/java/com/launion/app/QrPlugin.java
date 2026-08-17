package com.launion.app;

import android.graphics.Bitmap;
import android.graphics.Color;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;

import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Genera un QR en NATIVO con ZXing y lo devuelve como data URL (PNG en base64) para pintarlo en un
 * <img> del WebView. Se hace acá y no en JS a propósito: evita sumar una librería de QR al bundle
 * web. Lo usa el modal "Invitar" (InvitarModal.jsx) para mostrar el link de descarga de la app.
 *
 * Expone:
 *  - generar({ text: string, size?: number }): { dataUrl: string }
 */
@CapacitorPlugin(name = "Qr")
public class QrPlugin extends Plugin {

    @PluginMethod
    public void generar(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("Falta el texto a codificar.");
            return;
        }
        int size = call.getInt("size", 640);
        try {
            Map<EncodeHintType, Object> hints = new HashMap<>();
            hints.put(EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M);
            hints.put(EncodeHintType.MARGIN, 1);
            hints.put(EncodeHintType.CHARACTER_SET, "UTF-8");

            BitMatrix matrix = new QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints);
            int w = matrix.getWidth();
            int h = matrix.getHeight();
            int[] pixels = new int[w * h];
            for (int y = 0; y < h; y++) {
                int off = y * w;
                for (int x = 0; x < w; x++) {
                    pixels[off + x] = matrix.get(x, y) ? Color.BLACK : Color.WHITE;
                }
            }
            Bitmap bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            bmp.setPixels(pixels, 0, w, 0, 0, w, h);

            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 100, baos);
            String b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP);

            JSObject ret = new JSObject();
            ret.put("dataUrl", "data:image/png;base64," + b64);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo generar el QR: " + e.getMessage(), e);
        }
    }
}
