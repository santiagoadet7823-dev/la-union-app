# 📱 Guía súper detallada — Generar el APK de LA UNIÓN (Android)

Esta guía te lleva **de cero a un APK instalable** que podés enviarles a los empleados por WhatsApp/Drive. Está pensada para hacerse **una sola vez** la configuración, y después cada actualización son 3 comandos.

> App base: **LA UNIÓN** · `appId: com.launion.app` · Capacitor 6 (ya configurado en el proyecto).

---

## 0) Qué vas a lograr
- Un archivo `app-release.apk` **firmado**.
- Login con Google funcionando dentro de la app (no solo en el navegador).
- GPS en **segundo plano** (sigue registrando el recorrido con la pantalla bloqueada).
- Permisos de ubicación pedidos correctamente en Android.

Tiempo estimado la primera vez: **1–2 horas** (la mayor parte es instalar Android Studio).

---

## 1) Requisitos — instalar una vez

1. **Node.js LTS** (v20+). Verificá en una terminal: `node -v`.
2. **Android Studio** (Windows): https://developer.android.com/studio
   - Al instalar, dejá tildado **Android SDK**, **Android SDK Platform** y **Android Virtual Device**.
   - Abrí Android Studio una vez → *More Actions → SDK Manager* → pestaña **SDK Platforms**: instalá **Android 14 (API 34)**.
   - Pestaña **SDK Tools**: que estén tildados **Android SDK Build-Tools**, **Android SDK Command-line Tools** y **Android SDK Platform-Tools**.
3. **JDK 17** — viene incluido con Android Studio (JBR). No necesitás instalarlo aparte.
4. **Variables de entorno** (Windows, para usar `gradlew` desde la terminal):
   - `ANDROID_HOME` = `C:\Users\TU_USUARIO\AppData\Local\Android\Sdk`
   - Agregá al `Path`: `%ANDROID_HOME%\platform-tools`

> 💡 Si preferís no tocar variables de entorno, podés hacer TODO desde la interfaz de Android Studio (te lo indico en cada paso con **[Alternativa Android Studio]**).

---

## 2) Preparar el proyecto web

Abrí una terminal **dentro de la carpeta `la-union-app`** y ejecutá:

```bash
npm install
```

Asegurate de que el archivo `.env.local` tenga las credenciales de Supabase (ya está configurado):

```
VITE_SUPABASE_URL=https://lqhtxivednffpiicnbog.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_...
```

### Compilar la web para el APK (¡importante!)
La PWA se compila con `base: '/la-union-app/'` (para GitHub Pages). Dentro del APK, en cambio, los archivos se sirven desde la raíz, así que hay que compilar con **base relativa**. Eso se activa con la variable `CAP_BUILD=1`:

- **Git Bash / Mac / Linux:**
  ```bash
  CAP_BUILD=1 npm run build
  ```
- **PowerShell (Windows):**
  ```powershell
  $env:CAP_BUILD=1; npm run build
  ```
- **CMD (Windows):**
  ```cmd
  set CAP_BUILD=1&& npm run build
  ```

Esto genera la carpeta `dist/` lista para empaquetar.

---

## 3) Crear el proyecto Android nativo

```bash
npx cap add android
CAP_BUILD=1 npm run build   # (si no lo corriste recién)
npx cap sync android
```

- `cap add android` crea la carpeta `android/` (solo la primera vez).
- `cap sync` copia tu `dist/` adentro y actualiza los plugins nativos.

---

## 4) Permisos de Android (ubicación + segundo plano)

Abrí el archivo:
```
android/app/src/main/AndroidManifest.xml
```

Dentro de `<manifest ...>` y **antes** de `<application>`, pegá estos permisos:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

> El plugin `@capacitor-community/background-geolocation` corre un **servicio en primer plano** con una notificación permanente ("LA UNIÓN registra tu ruta"). Por eso van `FOREGROUND_SERVICE_LOCATION` y `POST_NOTIFICATIONS`.

---

## 5) Login con Google dentro del APK (deep link)

En el navegador, Google vuelve a `http://localhost` / la URL de la PWA. En la app nativa hay que volver **a la app** mediante un *deep link* (`com.launion.app://`).

### 5.1 — Intent filter en el Manifest
Dentro de `<activity ... android:name=".MainActivity">`, agregá:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="com.launion.app" android:host="auth" />
</intent-filter>
```

### 5.2 — Supabase Dashboard (cuenta `cardixteam@gmail.com`)
*Authentication → URL Configuration → Redirect URLs*, agregá:
```
com.launion.app://auth
```
(Dejá también las URLs de la web que ya tenías.)

### 5.3 — Código: redirect por deep link + captura del retorno
Estos cambios hay que hacerlos **una vez** en el código (avisame y te los aplico yo). Resumen:

**a) `src/context/AuthContext.jsx`** — que el `redirectTo` use el deep link cuando corre en nativo:

```js
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'

const signInWithGoogle = () =>
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: Capacitor.isNativePlatform()
        ? 'com.launion.app://auth'
        : window.location.origin + (import.meta.env.BASE_URL || '/'),
      skipBrowserRedirect: Capacitor.isNativePlatform(),
    },
  })
```

**b)** Cuando Google devuelve el control a la app, capturar la URL y crear la sesión:

```js
useEffect(() => {
  if (!Capacitor.isNativePlatform()) return
  const sub = CapApp.addListener('appUrlOpen', async ({ url }) => {
    if (url.includes('auth')) {
      const code = new URL(url).searchParams.get('code')
      if (code) await supabase.auth.exchangeCodeForSession(code)
    }
  })
  return () => { sub.then((s) => s.remove()) }
}, [])
```

> Nota: en nativo, `signInWithOAuth` con `skipBrowserRedirect` te da una `data.url` que hay que abrir con el navegador del sistema (`@capacitor/browser`). Te lo dejo listo cuando hagamos este paso.

---

## 6) GPS en segundo plano (recorrido con pantalla bloqueada)

El puerto ya está preparado en `src/services/geolocation/index.js` (función `watchNative`). Para activarlo de verdad, se reemplaza el fallback por el plugin:

```js
import { registerPlugin } from '@capacitor/core'
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation')

async function watchNative(onUpdate, onError) {
  const id = await BackgroundGeolocation.addWatcher(
    {
      backgroundMessage: 'LA UNIÓN registra tu ruta',
      backgroundTitle: 'Tracking activo',
      requestPermissions: true,
      stale: false,
      distanceFilter: 12, // metros → coincide con el "por movimiento" del panel
    },
    (location, error) => {
      if (error) return onError(error)
      onUpdate({ lat: location.latitude, lng: location.longitude, ts: Date.now() })
    }
  )
  return () => BackgroundGeolocation.removeWatcher({ id })
}
```

Con esto, el registro por **movimiento** (12 m) y el rastro de la jornada siguen funcionando aunque el teléfono esté bloqueado. (También te lo aplico yo cuando quieras.)

Después de cualquier cambio de código: `CAP_BUILD=1 npm run build && npx cap sync android`.

---

## 7) Ícono y nombre de la app
- Nombre: ya es **LA UNIÓN** (definido en `capacitor.config.ts`).
- Ícono: en Android Studio → click derecho en `app` → *New → Image Asset* → elegí el logo → *Next → Finish*. Genera todos los tamaños.

---

## 8) Crear la llave de firma (keystore) — una sola vez

El APK debe ir **firmado**. Generá tu keystore (guardalo bien, sin él no podés publicar actualizaciones):

```bash
keytool -genkey -v -keystore launion.keystore -alias launion -keyalg RSA -keysize 2048 -validity 10000
```

- Te va a pedir una **contraseña** (anotala) y algunos datos (nombre, organización, etc.).
- Se genera el archivo `launion.keystore`. Movelo a `android/app/`.

> `keytool` viene con el JDK. Si no lo encuentra, usá el que trae Android Studio:
> `"C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkey ...`

---

## 9) Configurar la firma en Gradle

1. Creá el archivo `android/keystore.properties` con tus datos:
   ```properties
   storeFile=app/launion.keystore
   storePassword=TU_CONTRASEÑA
   keyAlias=launion
   keyPassword=TU_CONTRASEÑA
   ```
   > ⚠️ No subas este archivo ni el `.keystore` a GitHub. Agregalos a `.gitignore`.

2. Editá `android/app/build.gradle`. Arriba de `android {`, agregá:
   ```gradle
   def keystoreProperties = new Properties()
   def keystorePropertiesFile = rootProject.file("keystore.properties")
   if (keystorePropertiesFile.exists()) {
       keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
   }
   ```

3. Dentro de `android { ... }`, agregá el `signingConfigs` y usalo en `release`:
   ```gradle
   signingConfigs {
       release {
           storeFile file(keystoreProperties['storeFile'])
           storePassword keystoreProperties['storePassword']
           keyAlias keystoreProperties['keyAlias']
           keyPassword keystoreProperties['keyPassword']
       }
   }
   buildTypes {
       release {
           signingConfig signingConfigs.release
           minifyEnabled false
           proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
       }
   }
   ```

---

## 10) Compilar el APK firmado

Desde la carpeta `android/`:

- **Windows:**
  ```bash
  cd android
  ./gradlew assembleRelease
  ```
  (o `gradlew.bat assembleRelease` en CMD)

El APK queda en:
```
android/app/build/outputs/apk/release/app-release.apk
```

**[Alternativa Android Studio]** Abrí la carpeta `android` en Android Studio → menú *Build → Generate Signed Bundle / APK → APK* → elegí tu keystore → *release* → *Finish*. Te muestra la ruta del APK al terminar.

---

## 11) Instalar en el celular

1. Pasá el `app-release.apk` al teléfono (WhatsApp, Drive, cable USB).
2. En el celular: al abrirlo, Android pide permitir **"instalar apps de orígenes desconocidos"** → aceptá para esa app.
3. Abrí LA UNIÓN → *Continuar con Google* → cuando el admin te asigne el rol, entrás.
4. La primera vez la app pide permiso de **ubicación**: elegí **"Permitir siempre"** para que funcione en segundo plano.

---

## 12) Actualizar la app (cada vez que cambiamos algo)

```bash
CAP_BUILD=1 npm run build
npx cap sync android
cd android && ./gradlew assembleRelease
```
Y volvés a repartir el nuevo `app-release.apk`.

> Los cambios que son solo de datos (clientes, catálogo, roles) **no necesitan** APK nuevo: se actualizan solos porque viven en Supabase. Solo hace falta recompilar cuando cambia el **código de la app**.

---

## 13) Problemas comunes

| Síntoma | Causa / Solución |
|---|---|
| Pantalla blanca al abrir el APK | Compilaste sin `CAP_BUILD=1` (assets con ruta `/la-union-app/`). Rebuild con la variable y `cap sync`. |
| "SDK location not found" | Falta `ANDROID_HOME` o el archivo `android/local.properties`. Abrí el proyecto una vez en Android Studio y lo crea solo. |
| El login de Google no vuelve a la app | Falta el `intent-filter` (paso 5.1) o la Redirect URL `com.launion.app://auth` en Supabase (paso 5.2). |
| El GPS se corta con la pantalla apagada | Falta el permiso "Permitir siempre" y/o los permisos de foreground service (paso 4), o no activaste `watchNative` (paso 6). |
| `gradlew` no ejecuta | Usá `./gradlew` en Git Bash o `gradlew.bat` en CMD; verificá JDK 17. |
| `lintVitalAnalyzeRelease` FAILED / `Already disposed: MessageBus` | Bug de lint con JDK nuevo (21/25). Ya está desactivado con `lint { checkReleaseBuilds false }` en `android/app/build.gradle`. No es un error de la app. |
| `Unsupported class file major version 69` | Tu `JAVA_HOME` apunta a JDK 25 (incompatible con Gradle 8.2.1). Usá el JBR de Android Studio: compilá con `./gradlew assembleRelease -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr"` (o seteá `JAVA_HOME` a ese JBR). |
| `Keystore file ... not found` | La ruta en `android/keystore.properties` → `storeFile` debe ser **`launion.keystore`** (relativa al módulo `app`, donde está el archivo), no `app/launion.keystore`. |
| Google marca "app no verificada" | Es normal en apps propias sin verificación de marca. Se puede continuar; para quitarlo hay que verificar la app en Google Cloud (opcional). |

---

## Resumen de lo que falta hacer del lado del código (te lo aplico yo cuando arranquemos P6)
- [ ] `signInWithGoogle` con redirect por deep link en nativo + captura `appUrlOpen` (paso 5.3).
- [ ] Activar `watchNative` con `BackgroundGeolocation` (paso 6).
- [ ] `.gitignore` para `keystore.properties` y `*.keystore`.

Lo demás (permisos, keystore, firma, build) es configuración que hacés vos siguiendo esta guía. Cualquier paso que se trabe, mandámelo y lo resolvemos.
