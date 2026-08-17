# Guía de publicación — 1.6.4 (tanda premium)

> Versiones alineadas: `APP_VERSION 1.6.4` (`web/src/version.js`), `versionName "1.6.4"` /
> `versionCode 22` (`web/android/app/build.gradle`). Migraciones DB `16`–`21` **ya aplicadas en producción**.

Hay **tres** canales independientes. La mayoría de las features salen por OTA + PWA; la
**notificación nativa de actualización** y la **ventana de alarma 6–24** necesitan el **APK nuevo**.

| Cambio | OTA (APK) | PWA (push main) | APK nuevo |
|---|:---:|:---:|:---:|
| A, B, C, D (runtime+UI), F, auto-login offline, paradas-nombre, rol propietario | ✅ | ✅ | |
| Notificación nativa de update + alarma 6–24 (`AlarmWatchdogPlugin.java`, `GpsContext`) | | | ✅ |

---

## 1. OTA (contenido web al APK) — entrega casi todo

Requiere Git Bash + `gh` logueado (ya lo está).

```bash
cd "C:/Users/Gaston/Desktop/propuesta LA UNION/la-union-app"
bash scripts/ota-release.sh 1.6.4
```

Esto: `CAP_BUILD=1 npm run build` → `bundle.zip` (con Python) → release `ota-1.6.4` en GitHub.
Al final imprime la URL. Luego, en **Supabase → SQL**:

```sql
update public.app_config
set bundle_version = '1.6.4',
    bundle_url     = 'https://github.com/santiagoadet7823-dev/la-union-app/releases/download/ota-1.6.4/bundle.zip',
    latest_version = '1.6.4',
    updated_at     = now();
```

> `latest_version = '1.6.4'` es lo que dispara el aviso "Actualización disponible" (in-app y, con el
> APK nuevo, la notificación nativa). Tras aplicar la OTA, `APP_VERSION` pasa a 1.6.4 y el aviso se apaga solo.

## 2. PWA (GitHub Pages) — para los que usan la web

```bash
cd "C:/Users/Gaston/Desktop/propuesta LA UNION/la-union-app"
git add -A && git commit -m "1.6.4 — tanda premium (A/B/C/D/F, offline-login, notif update)"
git push origin main
```

El workflow `.github/workflows/deploy.yml` publica solo. **No** toca el APK.

## 3. APK nuevo — activa la notificación nativa + alarma 6–24

```bash
cd "C:/Users/Gaston/Desktop/propuesta LA UNION/la-union-app"
CAP_BUILD=1 npm run build
npx cap sync android
cd android
./gradlew assembleRelease -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr"
# → android/app/build/outputs/apk/release/app-release.apk
```

Subirlo a un release y apuntar `app_config` (para el auto-updater 1-toque):

```bash
gh release create apk-1.6.4 android/app/build/outputs/apk/release/app-release.apk \
  --repo santiagoadet7823-dev/la-union-app --title "APK 1.6.4" --notes "Notificación de actualización + horarios por usuario"
```

```sql
update public.app_config
set apk_url     = 'https://github.com/santiagoadet7823-dev/la-union-app/releases/download/apk-1.6.4/app-release.apk',
    min_version = '1.0.0',   -- subilo solo si querés forzar reinstalación desde una versión mínima
    updated_at  = now();
```

> Firma: `android/keystore.properties` con `storeFile = launion.keystore` (relativo a `app`).
> Si salta `Unsupported class file major version`, el `-Dorg.gradle.java.home` del JBR lo resuelve.

---

## 4. Paso MANUAL en Supabase (mitad server-side del login offline)

Supabase → **Authentication → Settings → Access token (JWT) expiry**: subir de **3600 s (1 h)** a
**86400 s (24 h)** o hasta **604800 s (1 semana)**. Reduce los refresh y hace que reabrir sin
internet dentro de la ventana ni intente la red. El espejo de sesión (client-side) ya está en el código.

## 5. Probar en un teléfono real (lo que no se valida en navegador)

- **Check-in (C):** hacer check-in en un comercio sin ubicación → aparece toast "Ubicación guardada";
  verificar fila en `visitas` y `clientes.lat/lng` poblado.
- **Categorías (D):** crear "Ma/Ju 18–24", asignarla a un vendedor; confirmar que rastrea en esa franja.
- **Login offline:** modo avión tras >1 h → la app abre igual (modo sin conexión); al volver la red, sincroniza sin re-login.
- **Notificación de update:** con el APK 1.6.4 instalado y `latest_version` mayor, en horario, al
  despertar el watchdog debe aparecer la notificación. **Límite honesto:** no vence force-stop ni OEM killers.
