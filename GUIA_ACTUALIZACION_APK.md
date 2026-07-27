# Guía — Publicar una actualización del APK (auto-update, 1 toque)

Cómo sacar una versión nueva de la app **nativa** y que se actualice sola en los teléfonos de tu
equipo, sin pasar el archivo a mano. Disponible desde la versión **1.6.0** (la primera que trae el
updater adentro).

> **Antes que nada — respaldá el keystore.** Todo esto depende de firmar el APK con
> `android/app/launion.keystore` y sus contraseñas (`android/keystore.properties`). Si perdés el
> archivo **o** las contraseñas, no podés volver a publicar ninguna actualización nativa (ver §5).
> Backup en un gestor de contraseñas + 2 lugares privados, hoy.

---

## 1. Primero: ¿necesitás un APK nuevo, o alcanza con una OTA?

Son **dos canales distintos**. Elegí el más liviano que sirva:

| Tu cambio es… | Canal | Cómo |
|---|---|---|
| JS / CSS / React, una pantalla, un texto, un arreglo de lógica | **OTA** (liviano, silencioso, sin reinstalar) | `bash scripts/ota-release.sh <ver>` |
| Un plugin nativo, un permiso del manifest, código en `android/`, `capacitor.config.ts` | **APK nuevo** (esta guía) | pasos de abajo |

La **OTA** actualiza solo el contenido web y se aplica sola sin que el usuario instale nada. El **APK
nuevo** es para lo que la OTA no puede tocar (lo nativo): ahí sí hay que reinstalar, y para eso está
el auto-updater.

> Regla de oro: cuando publiques un APK nuevo, publicá **también** la misma versión como OTA. Así los
> equipos que ya tienen el APK nuevo reciben igual el contenido web actualizado.

---

## 2. Cómo funciona el auto-update (para entender qué vas a tocar)

1. El `.apk` firmado se sube a un **GitHub Release** (hosting gratis).
2. En Supabase, la tabla `app_config` tiene dos campos que mandan:
   - **`apk_url`** → la URL directa del `.apk` en ese release.
   - **`min_version`** → el "piso": si un teléfono tiene una versión **menor** a esto, se le ofrece
     actualizar.
3. Cuando el usuario abre la app, esta compara su versión con `min_version`. Si está por debajo,
   muestra el aviso **"Nueva versión de la app"**, descarga el `.apk` sola y lanza el instalador de
   Android. El usuario toca **"Instalar"** una vez y listo.

> **No es 100% silencioso.** Android siempre exige ese toque de "Instalar" para un APK de fuera de
> Play Store. Lo que se elimina es el trabajo manual de pasar el archivo uno por uno.

---

## 3. Pasos para publicar una versión nueva

Supongamos que vas a sacar la **1.6.1**.

### Paso 1 — Subir los números de versión

Editá **dos** archivos:

- `android/app/build.gradle`:
  - `versionCode` → subilo en **1** (ej. de `20` a `21`). Es un entero, siempre para arriba.
  - `versionName` → la versión legible (ej. `"1.6.1"`).
- `src/version.js`:
  - `APP_VERSION` → la misma (`'1.6.1'`).

### Paso 2 — Compilar el APK firmado

En **Git Bash**, desde `la-union-app/`:

```bash
CAP_BUILD=1 npm run build && npx cap sync android && cd android && ./gradlew assembleRelease -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr"
```

- El `CAP_BUILD=1` es **obligatorio** (sin eso el APK arranca en pantalla blanca).
- El `-Dorg.gradle.java.home=...` evita el error `Unsupported class file major version`.
- El APK queda en: `android/app/build/outputs/apk/release/app-release.apk`

### Paso 3 — Publicar el APK en GitHub Releases

Desde `la-union-app/` (necesitás `gh` logueado):

```bash
bash scripts/apk-release.sh 1.6.1
```

Esto sube el `.apk` y al final te imprime **la URL** y **el SQL** listo para copiar.

### Paso 4 — Prender la actualización en Supabase

Pegá en el **SQL Editor** de Supabase lo que imprimió el script (te sale con la URL ya completada):

```sql
update public.app_config
set min_version = '1.6.1', apk_url = '<la URL que imprimió el script>', updated_at = now();
```

- **`min_version = '1.6.1'`**: todos los que tengan menos que 1.6.1 verán el aviso. Poné acá la
  versión de **este** APK.
- Apenas corras esto, los teléfonos empiezan a ver el aviso al abrir la app.

### Paso 5 — Publicar también la OTA (recomendado)

```bash
bash scripts/ota-release.sh 1.6.1
```

Y corré el `update app_config set bundle_version=..., bundle_url=...` que imprime. Así los que ya
tengan el APK nuevo reciben el contenido web al día.

### Paso 6 — Listo

El equipo, al abrir la app, ve **"Nueva versión de la app"** → toca **Actualizar** → la app descarga
e inicia la instalación → toca **Instalar** → actualizado, conservando datos y sesión.

---

## 4. La primera vez en cada teléfono: "instalar apps desconocidas"

La primera vez, Android puede pedir habilitar **"Instalar apps desconocidas"** para DisT-At. Si pasa:

- La app abre sola la pantalla de Ajustes correspondiente y muestra "Activá 'Instalar apps
  desconocidas' y volvé a tocar Actualizar".
- El usuario activa el permiso, vuelve a la app y toca **Actualizar** de nuevo. Ya no lo vuelve a
  pedir.

Es un permiso por dispositivo, una sola vez.

---

## 5. Errores comunes y qué significan

| Síntoma | Causa | Solución |
|---|---|---|
| "App no instalada" / "package conflicts" | El `.apk` está firmado con **otra** llave que la instalada | Firmar con el **mismo** `launion.keystore` de siempre. Si lo perdiste, no hay arreglo remoto (§6) |
| No aparece el aviso | `min_version` ≤ la versión instalada, o `apk_url` en `null` | Verificá el `update app_config`: `min_version` tiene que ser **mayor** a la instalada y `apk_url` no nulo |
| El aviso aparece pero no descarga | URL mal, sin internet, o release privado | Abrí la `apk_url` en un navegador: tiene que bajar el `.apk` directo |
| "Descarga vacía" o error de red | La URL no apunta al asset correcto | Revisá que la URL sea la de `releases/download/apk-<ver>/app-release.apk` |
| Pide el permiso una y otra vez | El usuario no activó "instalar apps desconocidas" | Activarlo en Ajustes para DisT-At y reintentar |

### Volver atrás (rollback)

Si una versión salió mal y todavía **no** la instaló nadie: bajá `min_version` de vuelta a la
anterior (o dejala en un valor viejo) y el aviso deja de aparecer. Si ya se instaló, la única forma
de "bajar" es publicar una versión **más nueva** con el arreglo (Android no instala versiones con
`versionCode` menor).

---

## 6. 🔴 El keystore es un punto único de falla

Android obliga a que **cada actualización esté firmada con la misma llave** que la app ya instalada.
Como esta app **no** está en Play Store, no hay ningún respaldo de Google.

Si perdés `android/app/launion.keystore` **o** las contraseñas de `keystore.properties`:

- La OTA (contenido web) **sigue funcionando**.
- Pero **ningún APK nuevo** se puede instalar como actualización. La única salida sería hacer que
  **cada usuario desinstale la app e instale una nueva desde cero** — y desinstalar **borra los datos
  locales**: la cola de posiciones offline, la cuarentena y la sesión.

**Backup ahora, no después:**
- Las contraseñas (`storePassword`, `keyPassword`, `keyAlias`) → en un gestor de contraseñas.
- El archivo `launion.keystore` → en 2 lugares privados (Drive privado, pendrive). **Nunca** en un
  repo público.

---

## 7. Resumen de un vistazo

```bash
# 1. Subir versiones en build.gradle (versionCode +1, versionName) y src/version.js (APP_VERSION)

# 2. Compilar el APK firmado
CAP_BUILD=1 npm run build && npx cap sync android && cd android && ./gradlew assembleRelease -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr"

# 3. Publicar el APK (imprime URL + SQL)
bash scripts/apk-release.sh 1.6.1

# 4. En Supabase SQL Editor:
#    update public.app_config set min_version='1.6.1', apk_url='<URL>', updated_at=now();

# 5. Publicar también la OTA
bash scripts/ota-release.sh 1.6.1
#    update public.app_config set bundle_version='1.6.1', bundle_url='<URL>', updated_at=now();
```
