# HANDOFF — DisT-At

> **07/08/2026 · `APP_VERSION 1.11.0`.** Escrito para retomar el proyecto **en otra máquina y en una
> sesión nueva, sin memoria previa.** Si estás leyendo esto en la PC nueva: empezá por §2.
>
> Complementarios: [CLAUDE.md](CLAUDE.md) (reglas operativas — leerlo entero antes de tocar código) ·
> [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md) (arquitectura y deuda técnica) ·
> [ESTRUCTURA_PROYECTO.md](ESTRUCTURA_PROYECTO.md) (qué es cada archivo de la carpeta).

---

## 1. Dónde está parado el proyecto

**DisT-At** (`com.launion.app`) es un SaaS logístico multi-tenant de seguimiento GPS de equipos en
calle: vendedores y repartidores con la app en el bolsillo, encargados y dueños mirando el mapa. Se
cobra por abono P2P — **no hay pasarela de pago en la app**; la palanca es `empresas.activo` (que hoy,
ojo, **no gatea nada**: se escribe y se muestra, pero ninguna policy la consulta).

Todo en español: código, comentarios, UI y commits.

### Publicado — 1.13.0 (10/08/2026)

| | |
|---|---|
| Versión publicada | **1.13.0** en los TRES canales. `app_config`: `latest_version` = `min_version` = `bundle_version` = `1.13.0`, con `apk_url` y `bundle_url` al release `ota-1.13.0`. PWA: commit `3cae911` en `main`, workflow **success** |
| Versión en el código | **1.13.0** — `src/version.js`, `versionName` 1.13.0 / `versionCode 32`. Alineados |
| ⏳ **Único paso sin hacer** | **El push de aviso a los teléfonos.** Es el `net.http_post` a `push-actualizacion` de `CLAUDE.md §3` (con `timeout_milliseconds := 60000`). No se mandó porque el header lleva la `service_role` key y no se transcriben credenciales |
| Rastreo | 08:00–23:55, Lunes a Sábado, alertas de equipo activas |
| Parque | 9 teléfonos. **7 con el APK 1.13.0**; faltan Eduardo ruiz (nunca conectó — parece que no le entregaron el equipo) y Gabriel tevez (sin adb remoto, tiene que venir por cable) |

#### ⏳ La verificación que falta, y es la que dice si esto sirvió

1.13.0 corrige el **ancla del filtro de movimiento** (nativo, `UploaderGpsService.java`). **No se pudo
probar acá**: el emulador no tiene GPS real ni Doze. La medición honesta es post-jornada, contra la
base viva.

> 🩸 **EL CRITERIO DE ACEPTACIÓN ESTABA MAL Y HABRÍA MANDADO A REABRIR EL JAVA AL PEDO**
> (corregido el 10/08 a las 18:00, midiendo la base viva). Este documento pedía que *"los km de ruido
> parado (hops < 9 m) cayeran cerca de cero"*. **No pueden caer.** El arreglo clava el ancla pero
> **el punto de cortesía se sigue encolando igual** — lo dice el comentario del propio
> `procesarFix()`. Esos hops < 9 m son el jitter entre puntos de keepalive obligatorios: existen
> pase lo que pase, y lo que los saca del NÚMERO es el piso de `kmDePuntos` (`lib/geo.js`) + `db/32`,
> que ya están publicados. Medido el 10/08: el ritmo de puntos guardados estando quieto es de
> **110-130 por hora en todos los equipos, 1.13.0 y 1.11.0 por igual** = el keepalive de 30 s y nada
> más. Los metros de jitter por persona (1,0-1,7 km) **no separan una versión de la otra**.

**El número que el ancla sí tiene que mover** es el **trinquete estando quieto**: hops **≥ 9 m** cuyo
desplazamiento neto en ±6 puntos es **< 40 m**. Ésos son los que hoy inflan los km, y son los que
desaparecen si el ancla quedó sujeta. Línea de base medida el **10/08 (jornada PRE-fix, ver abajo)**:

| | km del día | m de trinquete parado | **% de km falso** |
|---|---|---|---|
| Zura | 1,32 | 500 | **37,8 %** |
| Nelson rojas | 6,07 | 1.392 | **22,9 %** |
| Orlando chavez | 6,45 | 1.339 | **20,8 %** |
| Luis Mendoza | 14,45 | 2.022 | 14,0 % |
| Gabriel tevez (**control**, sigue en 1.11.0) | 17,10 | 480 | 2,8 % |
| Agustin Vasquez | 51,86 | 1.300 | 2,5 % |
| Javier | 61,48 | 569 | 0,9 % |

**Criterio:** el % de km falso baja en los cinco que tienen `apk_version = 1.13.0` y **se queda igual
en Gabriel tevez**, que es el control natural porque no recibió el APK. Si baja en todos por igual,
no fue el ancla. Si no baja en ninguno, ahí sí se vuelve al Java.

> 🔴 **La jornada del 10/08 NO sirve para medir: es PRE-fix.** El `app-release.apk` con el ancla
> arreglada se compiló ese mismo día a las **13:08** y llegó a los teléfonos a la tarde
> (`app_config` pasó a 1.13.0 a las 17:32). Es además la misma jornada de la que salió esta línea de
> base. **La primera jornada medible es la del martes 11/08.**

> 🩸 **Para cualquier cosa NATIVA la columna que vale es `estado_dispositivo.apk_version`, no
> `app_version`.** `app_version` es el bundle OTA: un teléfono con el APK 1.13.0 puesto sigue
> diciendo `app_version = 1.12.1` hasta que baje la OTA, y al revés. Medido el 10/08 a las 18:00:
> **con APK 1.13.0** → Orlando chavez, Javier, Nelson rojas, Agustin Vasquez, Luis Mendoza (+ Zura y
> Alejandro mercado, que lo tienen puesto pero no abren la app, así que reportan 1.11.0 viejo);
> **sin el APK** → **Gabriel tevez**, que reportó hoy a las 17:07 en 1.11.0 y es justamente el peor
> trazo del parque.

### La base viva (verificado el 10/08 por MCP)

**2 empresas** · 24 perfiles · 1.998 clientes · 693 productos · **42.804 posiciones** · 5 visitas ·
**0 pedidos**.

⚠️ **Roles: son CINCO.** `superadmin` · `admin` · `encargado` · `vendedor` · `repartidor`.
`propietario` **se eliminó el 10/08** (`db/31`) sin haber tenido nunca un perfil — el dueño usa
`admin`, y su pantalla vive en `features/direccion/PanelDireccion.jsx` (la ven admin/superadmin en
web + celular; resuelve el caso del dueño entrando por PWA desde su iPhone).

### Los tres canales de despliegue, que son independientes

| Canal | Se actualiza con | Alcanza para |
|---|---|---|
| **PWA** (GitHub Pages) | `git push origin main` → workflow | Web de escritorio |
| **OTA** (Capgo self-hosted) | `bash scripts/ota-release.sh <v>` + UPDATE en `app_config` | Cualquier cambio de JS/CSS/React en el APK |
| **APK** (GitHub Releases) | `bash scripts/apk-release.sh <v>` + `apk_url`/`min_version` | **Obligatorio** si tocaste `.java`, el manifest o `capacitor.config.ts` |

> ⚠️ Publicar una OTA **no** actualiza la PWA, y pushear a `main` **no** actualiza el APK. Al publicar
> un APK nuevo, publicar **también** la misma versión como OTA.

---

## 2. 🔴 ANTES de mudar la carpeta

### 2.1 El keystore — hacer esto primero, hoy

Android exige que **toda actualización esté firmada con la MISMA llave** que la app instalada. No están
en Play Store, así que no hay respaldo de Google que valga. Si se pierde el archivo **o** se olvidan las
contraseñas: la OTA sigue viva, pero **ningún APK nuevo se puede instalar como actualización** —
habría que desinstalar+reinstalar en cada teléfono, perdiendo la cola de posiciones, la cuarentena y la
sesión de cada uno.

**Corrección importante, verificada el 04/08:** hasta ahora se dio por sentado que
`../.claude/keystore.md` era el respaldo de las credenciales de firma. **No lo es.** Ese archivo es el
volcado de la sesión de `keytool`: la ayuda de opciones y las respuestas del *distinguished name*
(nombre, unidad, organización, ciudad, provincia, país). **Las contraseñas no están ahí**, porque se
tipearon en un prompt que no las imprime.

Estado real: **`android/keystore.properties` es la única copia de `storePassword`, `keyPassword` y
`keyAlias`**, y está fuera de git, en un solo disco.

Antes de copiar nada:

1. Abrir `android/keystore.properties` y pasar las tres credenciales a un **gestor de contraseñas**.
2. Copiar `android/app/launion.keystore` a **dos** lugares privados distintos (no un repo público).
3. En la máquina nueva, **probar que firma** (`assembleRelease`) antes de dar la mudanza por terminada.

### 2.2 Los archivos que se pierden si solo clonás el repo

La carpeta raíz `propuesta LA UNION/` **no es un repositorio git** — el repo existe solo dentro de
`la-union-app/`. Todo lo de afuera viaja únicamente por copia física.

| Archivo | Consecuencia si se pierde | ¿Se puede recuperar? |
|---|---|---|
| `android/app/launion.keystore` | **Catastrófico** (§2.1) | ❌ Nunca |
| `android/keystore.properties` | Igual de grave: sin las contraseñas el `.keystore` es inútil | ❌ Solo desde un gestor |
| `la-union-app/.env.local` | No arranca `npm run dev` contra el backend real | ✅ Desde `.env.production` + panel de Supabase |
| Toda la raíz `propuesta LA UNION/` | 6 briefs de diseño, 2 mockups, 3 handoffs del diseñador, 2 carpetas de diagramas, `plan.md` | ❌ Solo copia física |
| `la-union-app/trabajo diseñador ui ux/` | Handoff v2 del diseñador (gitignoreado) | ❌ Solo copia física |
| `icon-fuente.png.png` | De él salen los mipmaps del ícono | ⚠️ Hay copia en `trabajo diseñador 27-7/` |
| `android/local.properties` | Gradle no encuentra el SDK | ✅ Se regenera al abrir en Android Studio |

**Sí viajan en el repo** (verificado con `git ls-files`): `.env.production`,
`android/app/google-services.json`, `package-lock.json`, `patches/*.patch`, **`.claude/skills/**`**,
todo `db/`, todo `supabase/functions/`, todo `src/` y los `.md` de documentación.

Comando para chequear antes de copiar:

```bash
ls -la la-union-app/.env.local la-union-app/android/keystore.properties la-union-app/android/app/launion.keystore
```

### 2.3 Lo que NO hace falta copiar (~645 MB)

`node_modules/` (530 MB) · `android/build/` + `android/app/build/` (105 MB) ·
`android/capacitor-cordova-android-plugins/` · `android/app/src/main/assets/public/` · `dist/` ·
`bundle.zip` · `graphify-out/` · `.idea/` · `android/local.properties`. Todo se regenera.

---

## 3. Entorno de trabajo — qué instalar en la PC nueva

### 3.1 Toolchain (versiones medidas en la máquina actual)

| Herramienta | Versión acá | Para qué | ¿Obligatorio? |
|---|---|---|---|
| **Node.js** | v24.15.0 (el CI usa Node 20) | `npm install`, Vite, Capacitor CLI, los scripts `.mjs` de la skill `impeccable` | ✅ |
| **npm** | 11.12.1 | `postinstall` aplica `patch-package` solo | ✅ |
| **Git + Git Bash** | 2.54 | Clonar, y **obligatorio** para `scripts/*.sh` (son bash, no PowerShell) | ✅ |
| **Android Studio** | — | Trae el **JBR** en `C:\Program Files\Android\Android Studio\jbr` | ✅ para el APK |
| **Android SDK** | platform 34, build-tools, cmdline-tools, platform-tools | Gradle, `cap sync`, `adb` | ✅ para el APK |
| **`gh` (GitHub CLI)** | 2.94, logueado como `santiagoadet7823-dev`, scopes `repo, workflow, read:org, gist` | Los dos scripts de release publican con `gh` | ✅ para publicar |
| **Python** | 3.13.14 | Lo usa **una sola cosa**: `ui-ux-pro-max/scripts/search.py`. Sin dependencias externas | ⚪ solo diseño |
| **JDK suelto** | Temurin 25 en el PATH | ⚠️ **Gradle NO va con este**: hay que pasarle el JBR o salta `Unsupported class file major version 69` | — |

### 3.2 Emulador de Android

Instalado el 04/08: `cmdline-tools` + `system-images;android-34;google_apis;x86_64` + AVD **`launion`**.

> ⚠️ **`google_apis` y NO `default`**: sin Play Services no hay FCM, y FCM es lo único que de verdad
> sirve probar acá.

```bash
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd launion -no-snapshot -no-boot-anim
# Con ventana, en una máquina sin GPU utilizable:
#   ... -gpu swiftshader_indirect -feature -Vulkan
# Headless (para adb/dumpsys):
#   ... -no-window -no-audio -gpu swiftshader_indirect
adb devices    # "offline" = todavía booteando; "device" = listo
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell dumpsys notification --noredact | grep -i channel   # en qué canal cayó un push
```

**Dos advertencias honestas:**

1. **En esta máquina nunca llegó a bootear**: Mesa/Vulkan lo cuelga y le quedan 2 cores, así que por
   software se queda en "offline". Si la PC nueva tiene GPU decente, probablemente ande. No gastar
   media hora más sin hardware nuevo.
2. **Techo de lo que sirve probar ahí**: interfaz, botones, overlays, el trazo en el mapa y los canales
   de notificación. **No tiene GPS real, ni Doze, ni los killers de los fabricantes** → **no sirve para
   probar nada de `UploaderGpsService`**. Eso se verifica en la calle, con consultas de huecos contra la
   base, y no hay atajo.

> 🟢 **Esto último cambia con el parque nuevo.** Un Samsung A07 real conectado por USB con depuración
> **sí** permite probar Doze, buckets de App Standby, alarmas y batería — es exactamente lo que
> faltaba. El checklist de esa sesión está en **§7.7**, y conviene leerlo antes de que lleguen los
> teléfonos, porque comparte ventana con la decisión de Device Owner (§7.2).

Si queda un proceso colgado (`Running multiple emulators with the same AVD`):

```bash
powershell -Command "Get-Process qemu-system-x86_64* | Stop-Process -Force"
```

### 3.3 Skills de diseño (8)

Están **duplicadas a propósito**:

- `la-union-app/.claude/skills/` — **versionadas en git** (`.gitignore` ignora `.claude/*` pero
  **exceptúa** `skills/`). **Viajan solas con el repo: no hay que reinstalarlas.**
- `~/.claude/skills/` — para el resto de los proyectos de la máquina. Estas **sí** hay que reinstalarlas
  si las querés fuera de este repo.

| Skill | Origen | Necesita | Cuándo se usa |
|---|---|---|---|
| `impeccable` | github.com/pbakaus/impeccable | **Node** (scripts `.mjs`) | Antes de tocar cualquier UI existente: `/impeccable audit <pantalla>` |
| `ui-ux-pro-max` | github.com/nextlevelbuilder/ui-ux-pro-max-skill | **Python 3.13** | Al diseñar una pantalla o componente **nuevo** |
| `review-animations` | github.com/emilkowalski/skills | — | Antes de tocar cualquier animación. ⚠️ `disable-model-invocation: true`: hay que invocarla a mano |
| `improve-animations` | ídem | — | Para planificar una tanda grande de motion |
| `find-animation-opportunities` | ídem | — | Dónde *falta* animación |
| `emil-design-eng` | ídem | — | Filosofía general de pulido |
| `apple-design` | ídem | — | Gestos, springs, sheets, materiales — el chrome de `SupervisionMovil` |
| `animation-vocabulary` | ídem | — | Glosario inverso ("¿cómo se llama el efecto de…?") |

> ⚠️ **Traducir siempre, nunca copiar el stack.** La app **no usa Tailwind** (está instalado y sin
> consumidores) ni librerías de animación. Las skills van a proponer `framer-motion`, `tailwind` y
> `shadcn/ui` por defecto. Tomar de ellas el **criterio** (curvas, duraciones, jerarquía, espaciado) y
> traducirlo a lo que el repo usa: CSS vars de `src/index.css`, keyframes `lu-*`, `sx()` y estilos
> inline.
>
> Y `/impeccable init` escribe `PRODUCT.md` y `DESIGN.md` en la raíz — **no correrlo sin avisar**.

### 3.4 Conectores / MCPs

**Viajan con la cuenta de Claude, no con la carpeta.** En la máquina nueva hay que **volver a
autorizarlos** (es OAuth por conector).

| MCP | Uso en este proyecto |
|---|---|
| **Supabase** | 🟢 **El único que se usa de verdad, y es obligatorio.** La regla 5 dice que los `db/*.sql` **no** son la fuente de verdad: para saber cómo está la base hay que consultarla viva. Herramientas: `list_tables`, `execute_sql`, `get_advisors`, `apply_migration`, `get_logs` |
| Firebase | Plugin `firebase@claude-plugins-official` (marketplace oficial). Conectado, sin uso todavía — podría servir para FCM |
| Notion · Gmail · Calendar · Canva · Context7 | Conectados, sin uso en el proyecto |

Ajustes de `~/.claude/settings.json` en esta máquina: `enableWorkflows: true`, tema oscuro,
`autoUpdatesChannel: latest`.

### 3.5 Cuentas y dónde vive cada cosa

Ninguna credencial se transcribe acá (regla 25 del repo: referenciar por ubicación).

| Servicio | Identificador | Qué guarda | Dónde está la credencial |
|---|---|---|---|
| **GitHub** | `santiagoadet7823-dev/la-union-app` | Código, PWA en Pages, y los **Releases que hacen de CDN** para el bundle OTA y el `.apk` | `gh auth` (keyring de la máquina) |
| **Supabase** | proyecto `lqhtxivednffpiicnbog`, cuenta `cardixteam@gmail.com` | Postgres, Auth, Storage, Realtime, 6 Edge Functions, 4 crons | `.env.production` (anon, pública) · service role y `FCM_SERVICE_ACCOUNT` como secrets de Edge Functions |
| **Firebase / FCM** | proyecto `gestor-local-celulares` | Push a los teléfonos | `android/app/google-services.json` (commiteado, es config de cliente) + la cuenta de servicio en Supabase |
| **Google Cloud** | Client ID Web de OAuth | Login con Google (nativo y web) | `capacitor.config.ts` y `AuthContext.jsx` — público por diseño |
| **Stadia Maps** | — | Capas de mapa Oscuro y Satélite | ⚠️ **Hardcodeada** en `src/services/maps/basemap.js`. Si vence, la app **no se rompe**: se queda con OSM |
| **OSRM público** | `router.project-osrm.org` + FOSSGIS | Ruteo y snap a calles | **Sin cuenta, sin key, sin SLA** |

### 3.6 Primer arranque, en orden

```bash
# 1. Restaurar a mano: la-union-app/.env.local, android/keystore.properties, android/app/launion.keystore
cd la-union-app
npm install                    # el postinstall aplica patch-package solo
npm run dev                    # verificar la web en :5173
```

Después, para el APK: abrir `android/` una vez en Android Studio (genera `local.properties`), y:

```bash
CAP_BUILD=1 npm run build && npx cap sync android
cd android && ./gradlew assembleRelease -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr"
```

**Las tres trampas que cuestan una tarde:**

1. **`CAP_BUILD=1` es obligatorio** para cualquier build destinado al APK o a una OTA. Sin eso, Vite
   compila con base `/la-union-app/` y el APK arranca en **pantalla blanca**.
2. En `keystore.properties`, **`storeFile` debe ser `launion.keystore`** (relativo al módulo `app`), no
   `app/launion.keystore`. `GUIA_APK_ANDROID.md:230` dice lo contrario y **está mal**; la línea que
   funciona es la `:320`.
3. **`npm run lint` es `eslint . || true` — nunca falla**, y además no hay archivo de config de ESLint
   en el repo. **No sirve como verificación.** Y **no hay tests**.

---

## 4. Pendientes

### 📌 Qué pasó en la sesión del 10/08/2026 (leer antes que nada)

Cuatro cosas cerradas, y **tres hipótesis que se probaron y se revirtieron** — esas son las que más
ahorran tiempo, porque son caminos que ya se recorrieron:

| Qué | Dónde | Estado |
|---|---|---|
| Rol `propietario` eliminado, fusionado en `admin` | `db/31`, `crear-usuario` v4, `features/direccion/PanelDireccion.jsx`, `App.jsx` (`decidirPanelDireccion`) | ✅ aplicado |
| `DespachoGestion` — el despacho de pantallas de gestión estaba copiado en las dos supervisiones | `features/supervision/components/DespachoGestion.jsx` | ✅ |
| Corte del dibujo a 45 s (`HUECO_DUDOSO_MS`) | `lib/geo.js` | ✅ verificado con el código real |
| Piso de ruido en los km (`kmDePuntos`, único lugar del front) | `lib/geo.js` + `db/32` | ✅ aplicado |
| Ancla que no persigue al ruido | `UploaderGpsService.java` | ✅ en 7 de 9 teléfonos — **sin medir** |
| PWA en iPhone (metas `apple-mobile-web-app-*`) | `index.html` | ✅ |
| 🔴 **Piso de distancia en el corte por hueco dudoso** — el corte de 45 s disparaba sobre saltos que no recorrieron nada y dejaba el trazo hecho confeti | `lib/geo.js` (`limpiarTrazo`) | ⏳ **hecho y verificado, SIN PUBLICAR** (sale por OTA, es JS puro) |
| 🔴 **Piso de ruido ADAPTATIVO por incertidumbre, con ancla** — el piso era 9 m fijo para todos; ahora es `max(9, 0,75·√(σ₁²+σ₂²))` medido contra un ancla que acumula | `lib/geo.js` (`pisoDeRuido`, `kmDePuntos`) | ⏳ **hecho y verificado, SIN PUBLICAR** |
| 🔴 **Filtro de PINCHOS** — el fix que se va 40-90 m y vuelve; el filtro de salto no los ve porque mide velocidad | `lib/geo.js` (`marcarPinchos`) | ⏳ **hecho y verificado, SIN PUBLICAR** |

**🩸 Lo que se probó y NO funcionó — no repetirlo sin datos nuevos:**

1. **Bajar `CIEGO_MAX_FRAC` de 0,35 a 0,30**: probado contra 7 días guardados, **cero tramos
   cambiados**. La fracción ciega es bimodal (o ~0, o 57-100 %); no hay nada en esa franja.
2. **Subir `VEL_HIST_MS` de 20 s a 45 s** (hipótesis: el churn de modo causa los huecos):
   **refutada**. Gabriel da 3 % de cruces de umbral en los huecos contra 2,8 % en los tramos
   normales — cero enriquecimiento. Y sus huecos pasan **caminando** (0,5-1,5 m/s), muy por debajo
   del umbral de 3 m/s: la histéresis nunca lo hubiera tocado.
3. **"Salta calles" NO es el snap inventando**: con el `fraccionCiega` real, Gabriel ya iba **72 %
   crudo** y Javier **57 %** — la guarda ya los rechazaba. Eran las rectas del crudo.

**Moraleja, que vale más que los tres:** antes de tocar una constante de GPS, **contrastar la
hipótesis contra los datos**. Tres cambios en la historia del repo, tres teorías plausibles e
incompletas.

**🔴 El corte de 45 s dejaba el trazo hecho confeti, y el 80-100 % de los cortes no decía nada**
(medido el 10/08 a las 18:00, y es lo que el cliente estaba viendo como "el trazo sigue fallando").
`HUECO_DUDOSO_MS` parte el dibujo por TIEMPO, y con la cadencia lenta (30 s) **un solo fix perdido ya
son 60 s** — cualquier hipo del chip estando parado partía el trazo. Cortes de menos de 9 m sobre el
total de cortes dudosos de la jornada: Alejandro mercado 27/27, Orlando chavez 42/43, **Agustin
Vasquez 181/189** (y Agustin es el equipo más sano: **cero** metros dudosos de ≥ 50 m). Los que sí
valen se concentran en tres personas: Gabriel tevez 6.843 m, Javier 2.321 m, Luis Mendoza 1.248 m.
**Arreglado con un piso de `MIN_MOVE_M` en la condición del corte** (regla 49 de `CLAUDE.md`);
verificado con el código real sobre la jornada de Zura: 26 → 9 segmentos, 341,0 → 336,3 m punteados,
km idénticos hasta el sexto decimal.

**Diagnósticos que quedaron abiertos** (medidos, sin arreglar):

- 🆕 **Luis Mendoza dejó de ESCRIBIR posiciones a las 14:43 con el servicio vivo.** El 10/08 su
  último punto es 14:43 y sin embargo `fix_ultimo_ts` marca **17:30**, `gps_silencio_max_ms` solo
  **10 min** y `cola_pendiente` 0. O sea: el servicio nativo **captura fixes y no guarda ninguno**
  durante 2 h 45. No es un silencio de GPS y no es la cola. Es un modo de falla nuevo — el keepalive
  de 30 s tendría que estar encolando un punto de cortesía igual. Mirar `procesarFix`: el único
  camino que explica "fixes sí, filas no" es `!movio && !vivo` sostenido, que con `lastSentAt`
  avanzando no debería poder pasar.
- 🆕 **Los silencios son el defecto dominante del trazo, y 1.13.0 no los tocaba.** Minutos perdidos
  en huecos > 4 min el 10/08: **Luis Mendoza 509** (máximo 201 min), **Javier 180** (máximo 40 min,
  con un salto de **28 km** adentro), **Gabriel tevez 132**, **Zura 95**, **Nelson rojas 91**
  (máximo **62 min**, y arrancó 10:50 en vez de 08:00). Mientras esto siga así, el trazo va a tener
  tramos punteados por más que el dibujo se afine: **no hay dato**.

- **Javier se calla 23 y 29 min manejando a 73 km/h** entre pueblos. El teléfono está sano
  (permisos, servicio, batería, 31 satélites). La cola **sí** guarda sin internet — se leyó el
  código: `encolar()` no consulta la red. Los puntos **nunca se capturaron**, no es que no se
  subieron. Hipótesis sin verificar: sin cobertura no hay A-GPS ni carril de triangulación, y los
  dos colchones cuelgan de lo que falta. Se prueba con modo avión y una vuelta a la manzana.
- **Luis Mendoza: saltos de 115 y 124 km/h en el pueblo**, de 11 s. Invisibles para los dos filtros
  (precisión 20-25 m, bajo el techo de 30; velocidad bajo `MAX_SPEED_MPS` = 162 km/h). El arreglo
  correcto es un umbral **por modo**, como ya lo son `MIN_MOVE_URBANO_M`/`MIN_MOVE_RUTA_M`.
- **La cadena de alarmas se rompe**: 6 de 9 teléfonos tenían `alarma_proxima_ts` clavada dos días
  atrás. La alarma que no dispara **no se re-arma sola**. Eso —y no la ventana horaria— es el
  "no arrancan a las 8".
- 🩸 **`estado_dispositivo` lo escribe el JS**, que solo corre con la app abierta. Hay teléfonos con
  puntos de hoy y latido de hace días. **Para saber si un equipo está vivo, mirar
  `max(posiciones.ts)`, no `estado_dispositivo.updated_at`** — el panel de diagnóstico miente.

**Fuera del código:** el **documento de servicios/contrato** (.docx + .pdf) quedó **sin empezar**.
Decisiones ya tomadas con el cliente: abono **mensual por módulo** ($300.000 rastreo con tope de 20
usuarios + $300.000 catálogo/pedidos), los **$200.000 ya cobrados** se imputan como **puesta en
marcha abonada**, y la tienda virtual B2B queda como plus a cotizar. El plan completo con las 13
secciones está en `~/.claude/plans/1-el-rol-de-smooth-trinket.md`.

### 🔴 Hacer ya

| # | Pendiente | Por qué duele | Qué lo cierra |
|---|---|---|---|
| **0** | ⏳ **MEDIR 1.13.0 — lo primero de la sesión del martes 11/08** | El arreglo del **ancla** es nativo y **no se pudo probar**: el emulador no tiene GPS real ni Doze. Un arreglo sin medir no está confirmado. ⚠️ **La jornada del 10/08 no sirve: el APK se compiló ese día 13:08 y llegó a la tarde, así que es PRE-fix** | El **% de km falso** (trinquete parado: hops ≥ 9 m con neto < 40 m en ±6 puntos) tiene que bajar en los 5 con `apk_version=1.13.0` y quedarse igual en **Gabriel tevez**, que es el control porque no lo recibió. Tabla de línea de base y la advertencia sobre el criterio viejo, en §1. **Si no baja en ninguno, volver sobre `UploaderGpsService.java`** |
| **0-bis** | ⏳ **Mandar el push de aviso de 1.13.0** | Los tres canales están publicados pero **nadie avisó a los teléfonos**. Sin el push, los que no se actualizan solos no se enteran | El `net.http_post` a `push-actualizacion` de `CLAUDE.md §3`, con `timeout_milliseconds := 60000`. Lo tiene que correr una persona: lleva la `service_role` key |
| **0-ter** | 🔴 **Terminar de actualizar 2 teléfonos** | **Eduardo ruiz** nunca se conectó (parece que no le entregaron el equipo) y **Gabriel tevez** no tiene adb remoto | Eduardo: `adb install -r -i com.launion.app` por Tailscale cuando aparezca. Gabriel: por cable cuando venga — y aprovechar para dejarle `adb tcpip 5555`, así deja de depender de una visita. ⚠️ **El `-i` no es opcional**: sin él el equipo no queda como su propio instalador y la próxima tampoco es silenciosa |
| **0-cuatro** | 🟠 **Alejandro mercado y Zura: APK puesto, app sin abrir** | Tienen 1.13.0 instalado pero el latido sigue viejo. **`estado_dispositivo` lo escribe el JS**, que solo corre con la app abierta — el dashboard los muestra en 1.11.0 aunque el nativo esté actualizado | Abrirles la app por Tailscale (`adb shell monkey -p com.launion.app -c android.intent.category.LAUNCHER 1`) o esperar a que la abran ellos |
| 1 | **Respaldar el keystore** (§2.1) | Punto único de falla, y se está por mudar de disco | Contraseñas a un gestor + `.keystore` en 2 lugares |
| 2 | **Cerrar el circuito de recuperación de contraseña** | Está **roto en producción**: el botón manda el mail y no hay pantalla donde poner la nueva. Ver §5 | Vista nueva + handler de `PASSWORD_RECOVERY` |
| 3 | **Versionar `ingesta_tokens` y `mi_token_ingesta`** | Recrear la base desde `db/` deja al uploader nativo sin poder autenticarse. Y la Edge Function referencia un `db/16_ingesta_tokens.sql` **que no existe** | Migración nueva contra la base viva |
| 4 | **Unificar la ventana de rastreo**, hoy implementada 3 veces | `dentroDeHorario()` (JS), `VentanaRastreo.dentro()` (Java) y `en_ventana` (SQL). Tocar una sin las otras hace que **los avisos al supervisor mientan en silencio** | Una sola fuente — el SQL es el candidato: se verifica con un `select` |
| 4-bis | ⚠️ **1.11.0 publicada** (arranque del rastreo al horario) — **SUPERADA por 1.13.0, y la medición NUNCA se hizo.** Sigue vigente como deuda | Se publicó en los tres canales el 05/08 (verificado por MCP el 07/08). Pero **un arreglo sin medir no está confirmado**: la línea de base era 51 min de mediana de retraso sobre 29 días hábiles (`db/30`) | Consulta contra `posiciones`: primer punto del día por usuario vs. las 08:00, sobre los días hábiles desde el 05/08. Si sigue arriba de ~15 min, el arreglo no alcanzó |
| 4-ter | **Que un cambio de horario llegue al teléfono con la app cerrada** | Las prefs con la ventana solo las escribe `configurar()` con la app viva. Si el admin cambia el horario y la persona no abre la app en días, el teléfono sigue con la ventana vieja — y ahora también con la alarma calculada sobre ella | `LaUnionMessagingService` escribiendo la ventana en prefs desde un data-message de FCM (corre en nativo, con el WebView muerto) |
| 4-cinco | 🟢 **Pasar los 9 teléfonos por `diagnostico-usb.sh --configurar`** | **Medido el 07/08 en un A07 real: un cable resuelve el onboarding entero en ~30 s** — exención de batería (que **sobrevive al reboot**), los 5 permisos incluido "Permitir siempre", y los 2 appops. Hoy **3 de 5** equipos con diagnóstico están **sin exención de batería**, que es la palanca del arranque al horario. **No hace falta esperar a Headwind, ni al recambio de personal, ni resetear nada** | [`scripts/diagnostico-usb.sh`](scripts/diagnostico-usb.sh). Ir anotando marca/modelo/API de cada equipo en el `.txt` que genera — es el dato que el pendiente #7 todavía no recolecta |
| 4-quater | 🔴🔴 **ANTES de reasignar un teléfono a un usuario nuevo: actualizarlo a ≥1.8.0** | Se va a hacer un recambio total de usuarios (07/08: *"los usuarios que ya están se descartan, cada teléfono va a tener un usuario nuevo"*). **Tres equipos están por debajo del fix de la regla 19-bis** — Nelson Rojas y Luis Mendoza en **1.6.0**, julii Adet en **1.6.6** — y en esas versiones el uploader nativo sigue subiendo con el token de la cuenta anterior: los puntos se escriben **a nombre de quien no estaba**, en una tabla **sin policy de UPDATE ni de DELETE**. 🩸 **Incorregible: no se puede borrar ni reasignar después.** Que el escenario es real ya está probado — Emanuel Arias tiene **42 puntos en `cuarentena_nativa`**, o sea que la cuarentena ya atrapó un cambio de cuenta | Orden obligatorio **por equipo**: (1) verificar `app_version ≥ 1.8.0` en `estado_dispositivo`; (2) si no, actualizar y confirmar que subió; (3) recién ahí cerrar sesión **desde la app** (el `signOut` es el que llama `cerrarSesionUploader()` y borra el token — apagar el teléfono NO alcanza); (4) entrar con el usuario nuevo |
| 5 | **Términos y condiciones + política de privacidad** | La app pide `ACCESS_BACKGROUND_LOCATION` y rastrea empleados; hoy no hay ni una línea legal. Ver §6 | Borradores ya escritos en [`legal/`](legal/) — falta revisión, publicación y link |
| 6 | 🔴 **Device Owner ANTES de desprecintar los Samsung A07** | Device Owner exige un teléfono sin ninguna cuenta configurada. Si se configuran primero, cuesta un **factory reset por equipo** (~media jornada, más el FRP). **Decidido el 07/08: sí, vía Headwind MDM** (§7.9) | Leer §7.2-7.3 y §7.9. La sesión de USB (§7.7) va **primero**, antes de la cuenta de Google |
| 6-bis | 🔴 **Laboratorio de Headwind ANTES de gastar un peso** | Se eligió Headwind sin haber visto el panel funcionando. Tres cosas están **sin verificar** y una de ellas (¿bloquea el force-stop?) es la única capacidad que justifica todo el aparato de Device Owner | WSL2 + Ubuntu 22.04 contra un teléfono viejo. **Nunca contra un A07.** Ver §7.9, Fase 0 |
| 7 | **Registrar marca/modelo/API level en `estado_dispositivo`** | Es la precondición de toda decisión por dispositivo. Hoy se mide el **síntoma** del OEM agresivo (`fgs_bloqueado`, `bateria_exenta`, `gps_silencio_max_ms`) y **nunca la identidad**: no se puede contestar con un `select` qué teléfonos hay, ni cruzar los síntomas contra un modelo | Parseo del user-agent en `useEstadoDispositivo.js` + una migración nueva (⚠️ `db/31` y `db/32` YA están usadas — la próxima es `db/33`). **Sale por OTA, sin APK.** Ver §7.10 #1 |
| 8 | **Actualización silenciosa: `PackageInstaller` + `UPDATE_PACKAGES_WITHOUT_USER_ACTION`** | Hoy actualizar cuesta 3-4 toques del vendedor (6-7 la primera vez). **Decidido**, va en el próximo APK — pero ⚠️ **si Headwind pasa la Fase 0, esto queda redundante para los A07**: decidir #6-bis primero para no escribirlo al pedo | Reemplazar `lanzarInstalador` en `ApkUpdaterPlugin.java:121-130`. Ver §7.4 |

### 🟠 Próximo sprint

| # | Pendiente | Nota |
|---|---|---|
| 9 | **Corregir el copy de `PermisoSiemprePrompt.jsx`** | Hoy le dice a TODOS *"En Xiaomi, Huawei y similares, activá Inicio automático"*, y **va a ser falso para el 100 % del parque nuevo**: Samsung no tiene lista de autostart. Sale por OTA y depende del pendiente #7 (saber la marca). Ver §7.8 |
| 10 | Script `build:apk` con `CAP_BUILD=1` incorporado | `cross-env` por Windows. Cierra el riesgo #4 de la auditoría, vigente desde julio |
| 11 | `UNIQUE (id_empresa, codigo)` en `clientes` | Hoy es UNIQUE global: **dos distribuidoras no pueden usar el mismo código**. Con 2 empresas vivas ya muerde |
| 12 | Decidir `AdminView` | Está **inalcanzable** y con él 3 vistas muertas (511 L). Borrar `RecorridosView` y `MapaOperativo`; **rescatar `ReplayJornada`** (reproduce la jornada como película, no hay nada equivalente) colgándola de "Menú" |
| 13 | Versionar las 4 columnas restantes | `posiciones.bateria`, `perfiles.numero`, `zonas.numero`, `zonas.id_vendedor` + `ubicaciones_compartidas` y su RPC |
| 14 | Rotar la key de Stadia y moverla a `VITE_STADIA_KEY` | Está commiteada: considerarla quemada. Agregarla como secret del workflow o la PWA pierde esas capas |
| 15 | Config de ESLint + quitar el `\|\| true` | Hoy no hay ninguna red de seguridad |
| 16 | Prender la **protección de contraseñas filtradas** en Supabase Auth | Una casilla del panel. Relevante porque las contraseñas iniciales las elige un admin |
| 17 | Sanear las docs obsoletas | `README.md` (menciona un componente `GoogleMap` inexistente), `GUIA_APK_ANDROID.md` (se contradice sobre `storeFile`), `GUIA_API_KEY_GOOGLE_MAPS.md` (obsoleta entera) |
| 18 | `supabase/functions/_shared/fcm.ts` | `getAccessToken` está copiado **3 veces**; la cuarta va a divergir |

### 🟡 Cuando haya aire

- Tests de las funciones puras. **Empezar por `segmentar.ts`**, que está separada justamente para poder
  probarse sin Deno ni Supabase. Después `dwell.js`, `estados.js`, `format.js`, `geofence.js`, `geo.js`.
- Seguir extrayendo lo común de `SupervisionMovil` (891 L) y `SupervisionDesktop` (790 L): **no comparten
  una sola línea** y ya divergieron dos veces.
- Decidir el futuro de `pedidos` / `pedido_items` / bucket `firmas`.
- Borrar `VITE_GOOGLE_MAPS_API_KEY`, el port muerto de Google Maps y la dep `qrcode` (declarada y sin un
  solo import: el QR se hace en nativo con ZXing).
- Evaluar alternativa a OSRM demo público — habilitaría `/match`, mejor algoritmo que `/route` para
  pegar un rastro a las calles.
- Unificar `.env.local` / `.env.production` / `.env.example`, que tienen sets distintos de variables.

> ⚠️ **Al escribir tests de una cola, la invariante es "no se pierde ni un punto", no "el descarte
> funciona".** Los tests de 1.5.26 pasaron 9/9 y aun así el cambio **borró 264 puntos reales en
> producción**: probaban que el borrado ocurriera, no si correspondía. Contar siempre
> `subidos + aislados == total`.

---

## 5. Login y alta de cuentas

Esta es una de las dos cosas que quedaron a medias a propósito, y conviene tener el mapa completo antes
de tocarla.

### 5.1 Lo que hay hoy

`src/features/auth/LoginView.jsx` (357 L), diseño v1.4:

- **Google, en dos formas**: la tarjeta "Continuar como X" (última cuenta usada en el teléfono) y el
  botón blanco estándar. **Es el camino real**: 13 de 14 usuarios de producción entran por acá, y por
  eso el diseño v1.4 dio vuelta la jerarquía y plegó el formulario.
- **Email + contraseña**, detrás de un renglón que lo despliega.
- Tres errores distintos y bien escritos (sin conexión / contraseña incorrecta / otro), clasificados por
  el mensaje y **no** por `navigator.onLine` — decisión deliberada, el WebView miente.
- "Recordar mi usuario" (guarda **solo el email**), ojito de contraseña, toggle de tema antes de entrar,
  detalle técnico plegable con `authError`/`authStatus`/versión.

`AuthContext.jsx` sostiene: login nativo por `idToken` (`GoogleAuth.initialize()` es obligatorio antes
de `signIn()`, si no crashea), OAuth web con la página puente `public/oauth.html` (un 302 del servidor a
un esquema custom el navegador no lo respeta, así que el salto lo hace el cliente), caché de sesión y de
perfil offline-first, y un `signOut` que **primero** llama a `cerrarSesionUploader()` (§ regla del token
nativo) y recién al final a `supabase.auth.signOut()`.

**Cómo nace una cuenta hoy — dos caminos, ninguno de autoservicio:**

1. **Un admin la crea** (`UsuariosView` → Edge Function `crear-usuario`): email + **contraseña inicial**
   + nombre + rol + empresa. Se crea con `email_confirm: true`, sin mail de confirmación ni de
   invitación — la decisión está escrita en la función: *el gate real de esta app no es el mail, es la
   aprobación (rol + activo)*. **Consecuencia operativa: el admin elige la contraseña y se la pasa por
   fuera de la app** (WhatsApp, en persona).
2. **La persona entra con Google** y el trigger `handle_new_user` le crea el perfil con `rol = null,
   activo = false` → cae en `PendienteView`. **3 de 15 perfiles están así ahora mismo.**

### 5.2 Lo que está roto

| | |
|---|---|
| 🔴 **Recuperar contraseña no cierra** | El botón existe, la hoja pide el email y `resetPasswordForEmail` manda el mail. Pero **no hay ninguna pantalla donde poner la contraseña nueva**: cero `updateUser` y cero manejo del evento `PASSWORD_RECOVERY` en todo `src/` (verificado por grep). La persona hace clic en el mail, la PWA le crea sesión y entra a la app — con la contraseña vieja intacta y sin lugar donde cambiarla |
| 🟠 **El `redirectTo` no vuelve al APK** | Usa `window.location.origin + BASE_URL`, que en el APK es el origin del WebView. El OAuth sí lo resolvió (con `oauth.html`); la recuperación no |
| 🟠 **El copy promete algo que no pasa** | La hoja "Solicitar acceso" dice *"tu pedido le llega al administrador"*. **No le llega nada**: no hay notificación de cuenta pendiente. El admin se entera solo si mira la lista de usuarios |

### 5.3 Lo que falta

**No existe `signUp` en ninguna parte** (verificado). Y "Solicitar acceso" es hoy una **hoja
explicativa que redirige a Google**, no el formulario que pedía el brief v1.4 §4.4 (nombre, email,
teléfono, distribuidora → crea una solicitud). El comentario en el código explica por qué se dejó así:
*sería un endpoint anónimo abierto a internet, necesita tabla nueva, aviso al admin y límite de spam*.
Tampoco existe el tercer estado de `PendienteView` ("solicitud enviada") que el diseñador entregó.

### 5.4 La decisión, ahora desbloqueada

Estaba frenada por una duda de seguridad razonable: *si abrimos el alta, ¿alguien puede autoasignarse un
rol?* **Verificado en la base viva el 04/08: no.**

- `handle_new_user` inserta `rol = null, activo = false`.
- `perfiles` **no tiene policy de INSERT** y **no tiene self-update**: `perfiles_upd` exige superadmin o
  admin de la misma empresa.
- `perfiles_sel` sí deja al usuario leer su propia fila, que es lo que necesita `PendienteView`.

**Recomendación: formulario de "Solicitud de acceso" + invitación por mail. NO `signUp` abierto.** En un
multi-tenant siempre va a hacer falta que un admin asigne rol y empresa, así que el registro
autoservicio no ahorra el paso de aprobación — solo agrega un endpoint anónimo que hay que defender del
spam, plantillas de confirmación en español y un SMTP propio (el de cortesía de Supabase tiene rate
limit bajo).

### 5.5 Orden de trabajo sugerido

| # | Tarea | Esfuerzo | Toca |
|---|---|---|---|
| 1 | **Pantalla "poner contraseña nueva"** (`PASSWORD_RECOVERY` + `updateUser`) | S | `AuthContext.jsx` + vista nueva en `features/auth/` |
| 2 | **Arreglar el `redirectTo`** para el APK + cargar las Redirect URLs en el panel | S | `AuthContext.jsx`, patrón de `public/oauth.html` |
| 3 | **Links a T&C y privacidad** en el pie del login y en `PendienteView` | XS | `LoginView.jsx` (bloque "¿Todavía no tenés acceso?"), `PendienteView.jsx` |
| 4 | **Modo "invitar por mail"** en `crear-usuario` (`inviteUserByEmail`) | M | Edge Function + `UsuariosView` — deja de dictar contraseñas por WhatsApp |
| 5 | **Formulario "Solicitar acceso"** completo: tabla + RLS + endpoint anónimo con rate limit + aviso al admin + estado "solicitud enviada" | M-L | `LoginView`, `PendienteView`, migración nueva, Edge Function nueva |
| 6 | Prender la protección de contraseñas filtradas | XS | Panel de Supabase |

Fuera de alcance por decisión (documentada en el brief y en el código): registro autoservicio abierto y
biometría/huella.

---

## 6. Términos y condiciones

**No existía ni una línea de texto legal en todo el proyecto** — ni archivo, ni link, ni casilla de
aceptación, ni registro de consentimiento en la base. Tampoco lo preveían los briefs ni los mockups del
diseñador: es un **hueco de alcance**, no un bug. Nadie lo pidió nunca.

**Ya están redactados los dos borradores** en [`legal/`](legal/):

- [`legal/TERMINOS_Y_CONDICIONES.md`](legal/TERMINOS_Y_CONDICIONES.md)
- [`legal/POLITICA_DE_PRIVACIDAD.md`](legal/POLITICA_DE_PRIVACIDAD.md)

**Falta:** revisión legal (están marcados como borrador), publicarlos en una URL accesible —lo más
barato es junto a la PWA en GitHub Pages— y linkearlos desde `LoginView` y `PendienteView`.

**Por qué importa más de lo que parece:**

1. **Google Play**, el día que se publique. Para `ACCESS_BACKGROUND_LOCATION` exige política de
   privacidad en URL accesible, declaración de seguridad de datos, justificación escrita del uso en
   segundo plano y **video demostrativo**. Hoy la app se distribuye por APK directo (el QR de
   `InvitarModal` apunta a GitHub Releases), así que todavía no aplica.
2. **La pantalla de consentimiento de Google OAuth**: pasar el proyecto de GCP a "producción" pide
   privacy policy URL.
3. **Ley 25.326** (Argentina). La app rastrea la ubicación continua de trabajadores en relación de
   dependencia. Hoy lo único que se le dice al usuario es `PermisoSiemprePrompt`, que explica **para
   qué** hace falta "Permitir siempre" en términos operativos ("para que tu recorrido no se corte"),
   pero no dice qué se guarda, por cuánto tiempo ni quién lo ve.

---

## 7. El parque nuevo (Samsung A07) — la ventana que se cierra al desprecintar

> ⚠️ **Leer ANTES de configurar el primer teléfono.** Hay una decisión que, tomada después de poner
> la cuenta de Google, cuesta un factory reset por equipo.

> 🩸 **CORRECCIÓN DEL 07/08/2026 — la premisa de esta sección era falsa en parte.** Se escribió
> creyendo que los A07 todavía no habían llegado. **No es así: los 9 teléfonos que están hoy en la
> calle YA son Samsung A07 y A06, y están configurados desde el 27/07.** Consecuencias, y son grandes:
>
> 1. **Para esos 9 la ventana de provisioning YA SE CERRÓ.** Device Owner sobre ellos no cuesta
>    "decidir a tiempo": cuesta **9 factory resets**, con su cola de posiciones, su cuarentena y su
>    sesión (regla 20). Todo lo que 7.2 dice sobre *decidir antes de desprecintar* aplica **solo a
>    teléfonos que todavía no se configuraron**.
> 2. **El parque ya está casi unificado** — y aun así sigue sin registrarse marca ni modelo en ningún
>    lado (pendiente §4 #7). Que sean A07/A06 se sabe porque lo dijo una persona, no por un `select`.
> 3. 🔴 **El problema medido no es el que Device Owner arregla.** Medición del 07/08 sobre los 5 que
>    reportan diagnóstico completo: **3 de 5 NO tienen la exención de batería**, y `alarma_exacta`
>    sigue exactamente a `bateria_exenta` en los 5 casos — **confirmación de campo de la cadena que
>    7.3 predijo**. Device Owner no toca eso. `adb` sí, y sin resetear nada (7.7, Fase 3).
>
> **Traducción operativa: la palanca más grande que queda no es un MDM, es un cable USB — y los
> teléfonos ya están acá.** Ver 7.7.

> 🟢 **SEGUNDA CORRECCIÓN, mismo día — la ventana SE REABRE.** Poco después se definió que **se
> descartan todos los usuarios actuales, cada teléfono pasa a un empleado nuevo, y cada equipo se
> resetea de fábrica.** Eso cambia el cálculo entero:
>
> - **Device Owner vuelve a costar cero.** El factory reset se iba a hacer igual, así que la ventana
>   de provisioning se abre 9 veces sin trabajo extra. Todo 7.2 vuelve a aplicar **en su forma
>   original**, y el punto 1 de la corrección de arriba queda superado.
> - 🔴 **Pero ahora el orden es crítico y hay una sola oportunidad por equipo.** El provisioning de
>   Device Owner va **inmediatamente después del reset y antes de la cuenta de Google**. Si el
>   servidor de MDM no existe todavía, el QR no apunta a ningún lado y la ventana se quema — otra
>   vez, y esta vez sin excusa. **El servidor va PRIMERO (7.9, Fase 1). No se resetea nada hasta
>   que esté arriba y probado.**
> - 🟢 **El riesgo de la regla 19-bis se disuelve solo** para los equipos que se reseteen: el factory
>   reset borra la app y sus prefs, o sea el token viejo. El pendiente §4 #4-quater sigue valiendo
>   **solo** para cualquier teléfono al que se le cambie el usuario **sin** resetear.
> - ⚠️ **Verificar `cola_pendiente = 0` en `estado_dispositivo` justo antes de cada reset.** El reset
>   borra la cola local: lo que no se subió, se pierde. El 07/08 los 9 estaban en 0.

### 7.1 Qué cambió

El cliente unifica el parque a **un solo modelo, Samsung A07, comprado por la empresa**, y los va a
configurar uno por uno antes de entregarlos. ⚠️ **Ver la corrección de arriba: buena parte del parque
ya está unificada y ya configurada.**

Los dos cambios importantes no son técnicos: **un solo modelo** (antes, 9 teléfonos distintos) y
**teléfonos de la empresa** (antes, personales).

🩸 **Y eso tira abajo la premisa de una decisión ya tomada.**
[`GUIA_GPS_EN_VIVO_Y_JORNADA.md:104-113`](GUIA_GPS_EN_VIVO_Y_JORNADA.md) descartó kiosco/MDM con este
argumento textual: *"no es alcanzable como garantía **en los teléfonos personales de los
vendedores**"* y *"exige **teléfonos dedicados** provisionados como dispositivos administrados (MDM).
✔ El usuario eligió NO ir por ahí"*.

**Fue un rechazo a comprar hardware dedicado, no a Android Enterprise como tecnología — y el hardware
dedicado ya está comprado.** La decisión queda formalmente reabierta acá. Ojo: eso **no** la convierte
automáticamente en un sí. Ver 7.3.

### 7.2 🔴 La ventana de provisioning — lo que hay que leer sí o sí

**Device Owner exige un dispositivo sin NINGUNA cuenta configurada.** En la práctica: de fábrica, o
factory reset. No hay forma de convertir en Device Owner un teléfono que ya tiene la cuenta de Google
del vendedor puesta — el sistema rechaza el provisioning si existe cualquier cuenta.

> **El orden obligatorio, si la respuesta es sí:**
>
> desprecintar → wizard **SIN agregar cuenta de Google** → habilitar depuración USB → provisioning →
> **recién ahí** cuenta, WhatsApp y la app.
>
> Si se invierte, se pierde.

**Techo honesto, para no dramatizar:** la ventana **se reabre** con un factory reset. No es
irreversible, es **caro**: ~20-30 min por teléfono entre reset, wizard, cuenta, WhatsApp y re-login,
×9-12 ≈ **media jornada del cliente**, más el bloqueo **FRP** si la cuenta de Google no se saca antes
del reset. La decisión hay que tomarla antes de desprecintar no porque después sea imposible, sino
porque después cuesta una tarde y una conversación incómoda.

#### 🟢 Qué hacer el día que llegan las cajas (decidido: probar en el primero)

La decisión **no** está tomada todavía, y no hace falta tomarla a ciegas. El plan acordado es medir en
uno antes de comprometer los doce:

1. **Abrir UNA sola caja.** Las otras quedan cerradas.
2. Pasar el wizard **sin agregar cuenta de Google** y habilitar depuración USB.
3. Correr las **Fases 1 a 3 de §7.7**. Son 20 minutos y contestan las tres preguntas que deciden todo:
   - ¿`adb shell dpm set-device-owner` funciona en este A07, o Samsung lo bloquea post-wizard?
   - ¿el permiso de **"Permitir siempre"** queda concedido sin que nadie entre a Ajustes?
   - ¿la **exención de batería** puesta por `adb` **sobrevive al reboot**?
4. **Con esas tres respuestas, decidir** (§7.3) y recién ahí abrir las otras cajas.
5. Si la decisión es "no": ese teléfono se termina de configurar normal y no se perdió nada. Si es
   "sí": ya está provisionado y sirve de molde para los otros.

> ⚠️ **Lo único que NO se puede hacer es configurar los doce primero y decidir después.** Ese es el
> camino que cuesta media jornada de resets.

| Método | Cómo | Requisitos | ¿Sirve para 9-12? |
|---|---|---|---|
| **QR desde el setup wizard** | En la pantalla de bienvenida, tocar 6 veces la misma zona → se abre el lector → escanea un JSON con el DPC, el checksum de su firma y la URL de descarga | Android 7+, WiFi | ✅ **El método recomendado.** Un QR generado una vez, ~2 min por equipo |
| **`adb shell dpm set-device-owner`** | Por USB, después del wizard pero **sin ninguna cuenta agregada** | Depuración USB, sin cuentas | 🟡 ⚠️ **VERIFICAR en el A07** — hay reportes de que Samsung lo bloquea post-wizard. **Si funciona, es el camino ideal: colapsa el provisioning y la sesión de USB (7.7) en una sola pasada.** Probarlo con UN teléfono antes de tocar los otros |
| **`afw#setup`** | En el wizard, donde pide el mail, escribir `afw#setup` | Cuenta de Google gestionada + un EMM detrás | Solo si van por AMAPI |
| **NFC bump** | Un teléfono "programador" toca al nuevo | NFC en ambos; se rompe por versión | ⚪ Suplente del QR |
| **Samsung KME / zero-touch** | Se auto-inscriben al primer boot, **sin poder saltearlo ni con reset** | KME es **gratis**, pero el reseller tiene que registrarlos (o el admin a mano con la Knox Deployment App) | ⚠️ **VERIFICAR si el comercio es reseller Knox.** Con 9-12 unidades de retail, lo más probable es que no |

### 7.3 Qué compra Device Owner, y qué NO

> 🟢 **MEDIDO el 07/08/2026 sobre un A07 real — y el resultado desarma media tabla.**
> Equipo: **SM-A075M, Android 16 (API 36), One UI 8.0.5**, con la app 1.11.0 instalada por `adb`.
> Salida completa en [`scripts/diagnostico-SM-A075M-20260807-1605.txt`](scripts/).
>
> | Qué se probó | Resultado |
> |---|---|
> | Exención de batería por `adb shell cmd deviceidle whitelist +com.launion.app` | ✅ **Funciona**, y deja el standby bucket en **5 (EXEMPTED)**, el mejor estado posible |
> | 🔴 **¿Sobrevive al reboot?** | ✅ **SÍ** — verificado con reinicio real. Queda como `user,com.launion.app` en la whitelist |
> | `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`, `ACTIVITY_RECOGNITION` por `adb shell pm grant` | ✅ Concedidos |
> | 🔴 **`ACCESS_BACKGROUND_LOCATION`** ("Permitir siempre") por `pm grant` | ✅ **SÍ, concedido** — el permiso que Android 11+ **no deja pedir por diálogo** |
> | `SCHEDULE_EXACT_ALARM` y `REQUEST_INSTALL_PACKAGES` por `cmd appops set … allow` | ✅ Ambos en `allow` |
>
> 🩸 **Consecuencia: el onboarding entero se resuelve con un cable, en ~30 segundos por equipo, sin
> Device Owner, sin factory reset y sin servidor de MDM.** La fila de abajo que decía *"probablemente,
> solo en fully managed"* sobre `ACCESS_BACKGROUND_LOCATION` quedó **superada**: no hace falta.
> Lo hace [`scripts/diagnostico-usb.sh --configurar`](scripts/diagnostico-usb.sh).
>
> **Lo que Device Owner SIGUE comprando en exclusiva son dos cosas, y las dos son la misma idea —
> que el operador no pueda desarmar el rastreo:** bloquear el force-stop, y el GPS del sistema
> (volver a encenderlo o impedir que lo apaguen). Nada más. Todo el resto ya está resuelto por USB.

⚠️ **El resto de esta tabla sigue sin confirmarse sobre un A07.** Es lo que la documentación de
Android habilita; la Fase 2 del checklist (7.7) es la que lo convierte en hecho.

| Problema | ¿DO lo resuelve? | Mecanismo / honestidad |
|---|---|---|
| **Instalación y actualización silenciosa** (hoy 3-4 toques, 6-7 la primera vez) | ✅ Resuelve | `PackageInstaller` desde el DO. **Pero hay una alternativa más barata sin DO** — ver 7.4 |
| Auto-conceder `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`, `ACTIVITY_RECOGNITION` | ✅ Resuelve | `setPermissionPolicy(PERMISSION_POLICY_AUTO_GRANT)` |
| Auto-conceder **`ACCESS_BACKGROUND_LOCATION`** ("Permitir siempre", que Android 11+ **no** deja pedir por diálogo) | 🟡 Probablemente, solo en *fully managed* | Los permisos de sensor se auto-conceden solo en dispositivo totalmente administrado. ⚠️ **VERIFICAR: es la comprobación más valiosa de toda la sesión.** Si anda, la parte más frágil del onboarding desaparece |
| 🩸 **Exención de optimización de batería / Doze** | ❌ **NO lo toca** | **Acá es donde la propuesta original promete de más.** No existe API de `DevicePolicyManager` para la allowlist de Doze: se toca con el diálogo al usuario (lo que ya hace `BatteryOptimizationPlugin.request()`), por `adb`, o con una API de OEM (Knox). **Device Owner NO ahorra este paso** |
| **`SCHEDULE_EXACT_ALARM`** (de él depende el arranque de 1.11.0) | ❌ No directamente | Es un *special app access*, no un permiso de runtime. Pero **se concede solo al estar exento de batería** — o sea que **la cadena entera del arranque sigue colgando de la exención, con o sin Device Owner** |
| 🟢 **Que el vendedor apague el GPS del sistema** (pedido explícito del 07/08: *"si ellos apagan manual el gps… poder encenderlo desde esta PC"*) | ✅ **Resuelve, y de dos maneras — la segunda es mejor** | **Detectarlo ya se hace hoy**: `estado_dispositivo.permiso` / `gps_ok` (Nelson Rojas figura `denegado` ahora mismo). **Encenderlo** es lo que no se puede: cambiar `location_mode` exige `WRITE_SECURE_SETTINGS`, que solo tienen las apps del sistema y `adb`. Con Device Owner hay dos caminos: `setLocationEnabled()` (API 30+) para **prenderlo a distancia**, y `addUserRestriction(DISALLOW_CONFIG_LOCATION)` para que **no lo puedan apagar** — esta segunda es la buena, porque prevenir no depende de que el teléfono tenga señal en ese momento. ⚠️ VERIFICAR ambas en el A07. **Sin Device Owner no hay ninguna forma**: ni la app, ni un push, ni el panel |
| **Impedir el force-stop del usuario** | ✅ **Resuelve — y es lo ÚNICO que solo DO resuelve** | `setUserControlDisabledPackages()` (API 30+) saca "Forzar detención" y "Borrar datos". Importa mucho: un force-stop **cancela las alarmas y corta los broadcasts hasta que alguien abra la app a mano** — mata el watchdog *y* el arranque al horario. Es justo lo que `GUIA_GPS_EN_VIVO_Y_JORNADA.md:107` declara inalcanzable. **Con DO deja de serlo** |
| **Los OEM killers de Samsung** (Sleeping apps / Deep sleeping apps / Adaptive battery) | 🟡 Solo con Knox encima; DO puro **no** | AOSP no expone esas listas. Se tocan con **Knox Service Plugin**, la app OEMConfig gratuita que un EMM empuja por managed configurations. ⚠️ **VERIFICAR si esa política concreta necesita licencia Knox *Premium* (paga) o le alcanza Standard** |
| **Autostart** | ⚪ No aplica | **Samsung no tiene lista de autostart** al estilo MIUI/EMUI/ColorOS. Sus equivalentes son la fila de arriba. Ver 7.8 |
| **Kiosco / lock-task** | ✅ Resuelve, si lo quisieran | `setLockTaskPackages()`. **Recomendación: NO activarlo** — el vendedor no podría usar WhatsApp ni la cámara. Queda anotado como palanca disponible |

> 🟢 **ACTUALIZACIÓN 07/08/2026 — ahora resuelve 3, y el tercero es el que más se quiere.** Se pidió
> poder **volver a encender el GPS** cuando el vendedor lo apaga a mano. Eso **no tiene ninguna
> solución sin Device Owner** — no es cuestión de escribir más código, la API está cerrada para apps
> normales. Sumado al force-stop, quedan **dos capacidades que solo DO compra**, y ambas son sobre lo
> mismo: **que el operador no pueda desarmar el rastreo.** Como los 9 equipos se van a resetear igual
> (ver la corrección al principio de §7), esas dos salen sin trabajo extra. **Es el argumento más
> fuerte a favor que apareció en todo el análisis.**

> 🩸 **Device Owner resuelve 2 de los 7 problemas, y de esos 2 uno tiene alternativa más barata.**
> **La exención de batería —la palanca de la que cuelga el arranque al horario (`db/30`)— sigue
> exactamente igual con o sin Device Owner.** Lo único que compra en exclusiva es que el vendedor no
> lo pueda romper. Con teléfonos de la empresa eso no es poco, pero es un argumento de *integridad de
> la configuración*, no de *capacidad técnica nueva*. Hay que venderlo así.

**Decidido: probar en el primer A07 y decidir después.** No se compromete la flota entera hasta tener
las tres mediciones de la Fase 2 y 3.

### 7.4 Actualización sin toques — por qué Uptodown no, y qué sí

🔴 **Uptodown no logra el objetivo, y no es culpa de Uptodown: es del sistema operativo.** En Android,
una instalación sin diálogo la puede hacer exactamente uno de estos tres: un instalador
**privilegiado** de la imagen del sistema (Play Store), un **Device Owner** vía `PackageInstaller`, o
alguien con **root**. Uptodown no es ninguno: pide `REQUEST_INSTALL_PACKAGES` para sí mismo y después
lanza el mismo diálogo que ya lanza `ApkUpdaterPlugin`. **Automatiza la descarga, no la instalación.**

Y además suma: latencia de moderación entre `apk-release.sh` y que el teléfono lo vea (hoy es cero y
la controla `min_version`), un tercero en el camino crítico del mecanismo que sostiene el arreglo del
arranque, y un **listado público** de una app que rastrea empleados — con la deuda legal de §6
todavía abierta. Nota justa: el APK **ya es público** (GitHub Releases, y el QR de `InvitarModal`
apunta ahí); el delta no es secreto perdido, es descubribilidad más un tercero. Solo se pagaría si
comprara algo, y no compra nada.

| Camino | Toques | Notas |
|---|---|---|
| **Hoy** — `Intent.ACTION_VIEW` + FileProvider | **3-4**, y **6-7 la primera vez** en cada teléfono (hay que activar "Instalar apps desconocidas" y volver a tocar Actualizar) | `ApkUpdaterPlugin.java:121-130`. El encabezado del archivo ya lo dice: *"NO es una instalación silenciosa"* |
| ✅ **`PackageInstaller` + `UPDATE_PACKAGES_WITHOUT_USER_ACTION`** (Android 12+) | **0 desde la segunda actualización** | **Decidido, va en el próximo APK.** Requiere las cuatro condiciones a la vez: el permiso (nivel `normal`, se concede solo), `targetSdk ≥ 31` (hoy **34** ✅), `setRequireUserAction(USER_ACTION_NOT_REQUIRED)`, y ser **installer of record**. Esa última es el costo: la primera actualización todavía pide confirmar (bootstrap) y deja a `com.launion.app` como installer; de ahí en más, silenciosas. ~80-100 líneas dentro del plugin que ya existe. **Sin servidor, sin tienda, sin cuota, sin factory reset.** ⚠️ VERIFICAR en el A07 (One UI puede endurecerlo; Android 14 agregó *update ownership*) y ⚠️ VERIFICAR el piso de API del parque |
| **Device Owner** | **0 desde la primera** | Sin bootstrap, y permite `setUninstallBlocked()`. Pero cuesta todo lo de 7.2-7.5 |

> ⚠️ **Los tres exigen la MISMA llave de firma.** §2.1 no deja de ser el riesgo #1 del proyecto — al
> contrario, cuanto más automática es la actualización, más caro es perder el keystore.

### 7.5 Rutas de EMM, con costos honestos

| Ruta | Costo | Integración | ¿APK auto-hospedado? | Veredicto |
|---|---|---|---|---|
| **DPC propio** (la app es su propio Device Owner) | **US$0** | ~1-2 días: un `DeviceAdminReceiver`, `device_admin.xml`, el JSON del QR y los llamados a `DevicePolicyManager`. Es el mismo tipo de trabajo que este repo ya hace (7 plugins Java a mano) | ✅ **Sí, sigue con GitHub Releases.** Cero cambios de pipeline | 🟢 **Recomendada** si la respuesta es sí |
| **Android Management API** (Google) | API gratis + Play Console US$25 una vez | 2-4 días | ❌ **No.** Instala **solo** desde managed Google Play → obliga a subir a Play (7.6) | 🔴 Descartar |
| **Intune / Azure AD** (Microsoft) | Licencia por usuario | — | — | 🔴 **Probado y descartado el 07/08/2026** por fricción de la consola. Es lo que reabrió toda esta discusión |
| **Headwind MDM** (open source) | Gratis + VPS ~US$5-10/mes | 2-3 días + **operación permanente** de otro servidor | ✅ Sí | 🟢 **ELEGIDA el 07/08/2026 — ver 7.9.** El costo de operación sigue siendo real: se acepta a cambio de consola propia, código abierto y cero cuota por dispositivo |
| **Samsung KME** | Gratis | Bajo, pero **no es un EMM**: solo fuerza la inscripción en uno | — | 🟡 Complemento, no ruta |
| **Samsung Knox Manage** | ⚠️ ~US$3-4/disp/mes → ~US$400-500/año por 12 (verificar precio vigente) | Bajo | ✅ Sí | 🟠 La única que trae **KSP con licencia Premium**, o sea las listas de sueño de Samsung. La salida si el A07 resulta imposible de domar a mano — pero **medirlo primero** |
| **ManageEngine MDM Plus** | ⚠️ **Free tier hasta 25 dispositivos** (verificar límites vigentes) | Bajo | ✅ Sí | 🟡 **Si quieren consola sin pagar, empezar por acá** |
| **Comerciales** (Scalefusion, Hexnode, Esper, SOTI) | ~US$2-4/disp/mes | Muy bajo | ✅ Sí | 🟠 Cuota perpetua por gestionar 12 teléfonos que están sentados en la misma oficina |

> ⚠️ **Este párrafo cambió de decisión el 07/08/2026.** Lo que sigue explica por qué DPC propio *era*
> la recomendación, y por qué dejó de serlo. **La ruta elegida es Headwind (7.9).**

**El argumento a favor de DPC propio era:** la necesidad real no es *gestionar una flota*, es
*configurar bien una vez* — los 12 equipos están en la misma oficina y los configura la misma persona.
Todas las consolas venden gestión remota continua, que se paga todos los meses. Y es la única ruta que
**no toca el pipeline de release**: `apk-release.sh` + `ota-release.sh` + `app_config` siguen igual.

**Por qué se eligió Headwind igual:** se pidió explícitamente **consola para ver y gestionar los
teléfonos**, y eso es justo lo que el DPC propio no da (riesgo 3 de abajo). Headwind la da gratis, es
Apache 2.0, y **no cobra por dispositivo**. El precio es un servidor propio para siempre.

🩸 **Y hay una consecuencia irreversible que hay que entender antes de inscribir el primer teléfono:
solo puede haber UN Device Owner por dispositivo.** Si Headwind lo ocupa, `com.launion.app` **nunca**
podrá serlo — la ruta "DPC propio" queda cerrada de forma permanente, salvo factory reset. No es una
decisión que se pueda revisar el mes que viene.

**Los tres riesgos, sin maquillar** (siguen valiendo, ahora aplicados a Headwind):

1. 🩸 **Un Device Owner solo se saca con `clearDeviceOwnerApp()` desde el propio DPC, o con factory
   reset.** Si el DPC se rompe o se desinstala mal, el teléfono queda administrado por un fantasma.
   **Con Headwind esto es peor, no mejor**: el DPC es código de un tercero y la salida de emergencia
   depende de que su panel siga vivo y accesible. **Probar el des-enrolamiento en el primer teléfono,
   antes que cualquier otra cosa.**
2. Era **código sin tests en la posición más privilegiada del sistema**. Con Headwind el código no es
   nuestro — cambia el riesgo de "sin tests" a "sin control", que para 12 teléfonos es mejor negocio.
3. **Sin consola no hay política remota**: éste es el riesgo que Headwind cierra, y por eso se eligió.

Si Headwind no rinde en la Fase 0 de 7.9: **ManageEngine free tier** (hasta 25 dispositivos, sin
servidor propio, y ⚠️ es de los pocos que exponen la allowlist de batería vía Knox), y si no alcanza,
Knox Manage.

### 7.6 Managed Google Play: por qué no

| Tema | Realidad |
|---|---|
| **`ACCESS_BACKGROUND_LOCATION` en app privada** | 🟡 La política contempla exención para apps distribuidas solo por managed Google Play. ⚠️ **VERIFICAR en el formulario de declaración de Play Console.** Si no aplica: revisión de permisos, justificación escrita, política de privacidad publicada y **video demostrativo** — lo que §6 ya anticipa. Y hoy los dos documentos de [`legal/`](legal/) están **en borrador y sin publicar** |
| **`SCHEDULE_EXACT_ALARM`** | ✅ No es problema. Play restringe `USE_EXACT_ALARM`, no este. El manifest ya eligió bien |
| 🩸 **`targetSdk`** | ⚠️ **El costo escondido, y probablemente el más caro.** `android/app/build.gradle` tiene un `resolutionStrategy` fijando `androidx.work` en 2.9.1 con este comentario: *"El plugin OTA (capgo) arrastra androidx.work 2.10 que exige compileSdk 35. Fijamos una versión compatible con compileSdk 34 para no tener que subir el SDK"*. Publicar en Play desarma esa decisión y arrastra el plugin OTA |
| **Política de privacidad** | Obligatoria sí o sí. Pero ya hace falta igual por el OAuth de Google y por la Ley 25.326 (§6): **esto se paga con o sin Play** |
| **Firma** | Play App Signing implicaría que Google pase a tener la llave. Mejora el backup pero cambia el modelo de confianza de §2.1 — se decide a propósito, no de refilón |

**Solo se justifica si la ruta es AMAPI. Como no lo es, Play no entra.**

### 7.7 La sesión de USB con el primer A07 — checklist

**Regla de oro: se hace sobre UN teléfono, entero, antes de tocar los otros.**

> 🟢 **Las fases 1 a 5 están automatizadas en
> [`scripts/diagnostico-usb.sh`](scripts/diagnostico-usb.sh)** (07/08/2026). **No es destructivo**: solo
> lee, salvo la exención de batería con `--exentar`, que es lo que se quiere poner y es reversible.
> Guarda la salida en un `.txt` por equipo para poder compararlos. Encuentra `adb` solo en el SDK de
> Android. Uso:
>
> ```bash
> bash scripts/diagnostico-usb.sh              # solo lee
> bash scripts/diagnostico-usb.sh --exentar    # además pone la exención de batería
> adb reboot                                   # y después de que arranque:
> bash scripts/diagnostico-usb.sh --post-reboot
> ```
>
> Trae de arranque el gate de la regla 19-bis: si la app está por debajo de **1.8.0**, avisa en rojo
> que **no se puede cambiar de usuario sin actualizar primero** (§4 #4-quater).
>
> 🟢 **Se puede correr HOY, sin resetear nada y sin haber decidido lo del MDM.** De hecho conviene:
> las fases 1-3 son las que contestan si `adb` puede dejar los 9 teléfonos exentos de batería, que
> es la palanca que ni Device Owner ni Headwind resuelven.
>
> **La receta por equipo, en este orden** (el orden importa: así el vendedor no ve un solo diálogo):
>
> 1. Instalar la app — `adb install -r android/app/build/outputs/apk/release/app-release.apk`
> 2. `bash scripts/diagnostico-usb.sh --configurar` — ~30 s
> 3. 🔴 **Abrir la app e iniciar sesión.** No es opcional: ver abajo
>
> 🩸 **El paso 3 no se puede saltear, y el motivo es sutil.** Una app recién instalada que **nunca se
> abrió** queda en estado `stopped`, y una app en `stopped` **no recibe broadcasts** — incluido
> `BOOT_COMPLETED`. O sea que `BootReceiver` y `AlarmReceiver` quedan **inertes**: el arranque al
> horario de 1.11.0 y el watchdog de la regla 44 **no existen** hasta que alguien la abre una vez.
> Es exactamente el mismo agujero que el force-stop, entrando por otra puerta. Detectado el 07/08 en
> el segundo A07 (`notLaunched=true`); el script ahora lo avisa en rojo.
>
> ⚠️ **El parque tiene Android mixto**, aun siendo todos SM-A075M: el primer equipo vino con
> **Android 16 / One UI 8.0.5** y el segundo con **Android 15 / One UI 7.0** (parche de seguridad un
> año más viejo). Es la prueba concreta de lo que dice 7.8: **el eje útil es el API level, no el
> modelo** — "unificar el parque a un modelo" no unifica el comportamiento.

§3.2 y la regla 43 dicen que el emulador no sirve para nada de `UploaderGpsService` (sin Doze, sin GPS
real, sin killers de OEM) y que "se verifica en la calle y no hay atajo". **Sigue siendo cierto — y
este aparato es lo que faltaba.**

**Fase 0 — decisión previa (bloqueante).** Si la respuesta de 7.2 es "sí", el orden de arranque
cambia y no se puede deshacer sin reset.

**Fase 1 — identidad y línea de base (5 min).**

```bash
adb shell getprop ro.product.manufacturer     # samsung
adb shell getprop ro.product.model            # SM-A07xx  ← el dato que hoy NO se guarda
adb shell getprop ro.build.version.sdk        # API level
adb shell getprop ro.build.version.release
adb shell getprop ro.build.display.id         # build de One UI + parche de seguridad
adb shell settings get global device_provisioned   # 0 = todavía se puede dpm set-device-owner
adb shell dumpsys package com.launion.app | grep -iE "versionName|installerPackageName"
```

> 🩸 **Anotar `ro.product.model` a mano acá.** Es el valor que va a poblar la columna nueva del
> pendiente #7 y el único que permite cruzar los síntomas de `db/29`/`db/30` contra un teléfono.

**Fase 2 — permisos y app-ops (5 min).** Repetir **antes y después** del provisioning.

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell dumpsys package com.launion.app | grep -A40 "runtime permissions"
adb shell cmd appops get com.launion.app
```

⚠️ **La prueba de 7.3 es que `ACCESS_BACKGROUND_LOCATION` figure `granted` sin que nadie haya entrado
a Ajustes.**

**Fase 3 — la palanca de batería, medida en vez de supuesta (10 min).**

```bash
adb shell dumpsys deviceidle whitelist | grep -i launion
adb shell dumpsys deviceidle whitelist +com.launion.app
adb reboot && adb wait-for-device
adb shell dumpsys deviceidle whitelist | grep -i launion   # ⚠️ ¿SOBREVIVIÓ al reboot?
adb shell cmd appops set com.launion.app SCHEDULE_EXACT_ALARM allow
adb shell am get-standby-bucket com.launion.app
```

⚠️ **Si sobrevive, la sesión de USB puede dejar los 12 teléfonos exentos sin depender de que el
vendedor toque un diálogo — y eso, solo, vale más que todo Android Enterprise**, porque es la palanca
del arranque *y* de la alarma exacta.

**Fase 4 — Samsung: encontrar la pantalla real (10 min).**

```bash
adb shell pm list packages | grep -iE "lool|android.sm|spm"
adb shell dumpsys package com.samsung.android.lool | grep -i "Activity"
```

Objetivo: el componente de **Batería → Límites de uso en segundo plano → Apps que nunca entran en
suspensión**. Es el reemplazo correcto de "agregar Samsung al array de autostart" (7.8).

**Fase 5 — 🔴 verificar el arreglo de 1.11.0 sin esperar a mañana.**

> ⚠️ **Mover la VENTANA, nunca el reloj.** Cambiar la hora del teléfono rompe la validación de los JWT
> de Supabase y el TLS: se rompe justo todo lo que hay que observar.

1. En Supabase, poner `categorias_rastreo.hora_inicio` del usuario de prueba en **ahora + 8 min**.
2. **Abrir la app** — obligatorio: las prefs de la ventana solo las escribe `configurar()` con la app
   viva (es el pendiente 4-ter, y acá muerde de entrada).
3. Confirmar el armado **antes de esperar nada**, con dos fuentes independientes:
   ```bash
   adb shell dumpsys alarm | grep -B5 -A20 launion
   ```
   y en la base: `select alarma_proxima_ts, alarma_exacta, bateria_exenta, fgs_bloqueado from
   estado_dispositivo where id_usuario = …`. **`db/30` se escribió exactamente para esto.**
4. Reproducir el caso peor (bucket `rare` + Doze + app cerrada):
   ```bash
   adb shell am set-standby-bucket com.launion.app rare
   adb shell dumpsys battery unplug        # sin esto NUNCA entra en Doze
   adb shell dumpsys deviceidle force-idle
   adb shell dumpsys deviceidle step       # repetir hasta IDLE
   ```
5. Esperar y verificar:
   ```bash
   adb shell dumpsys activity services com.launion.app   # fg=true, type=location
   adb logcat -d | grep -iE "ForegroundServiceStartNotAllowed|AlarmManager"
   adb shell dumpsys battery reset                       # ⚠️ restaurar SIEMPRE
   adb shell dumpsys deviceidle unforce
   ```
   El veredicto real es un `select`: ¿entraron posiciones a la hora del borde? ¿subió `fgs_bloqueado`?

> 🩸 **Correr el test DOS veces: una sin `force-stop` y otra con.** El force-stop cancela las alarmas
> y deja la app en estado *stopped*. Eso no es un defecto del test: es **la medición más informativa
> de toda la sesión.** Si con force-stop no arranca nunca, acabás de medir con precisión **lo único
> que Device Owner arregla**, y esa medición es la que debería decidir 7.3.

**Fase 6 — arranque en frío por reboot**, sin abrir la app: `adb shell dumpsys alarm | grep -A20
launion` y `alarma_proxima_ts` de nuevo poblado en la base.

**Fase 7 — GPS, wakelock y batería.**

```bash
adb shell dumpsys batterystats --reset
# ... jornada simulada / caminata real de 1-2 h ...
adb shell dumpsys location | grep -A30 -i "fused"      # cadencia PEDIDA vs. gpsConfig
adb shell dumpsys power | grep -i -A10 wake            # el PARTIAL_WAKE_LOCK de la regla 42
adb shell dumpsys batterystats --charged com.launion.app
```

`src/services/gpsConfig.js` dice textualmente *"cuánto cuesta en batería hay que medirlo en un
teléfono real"*. **Esta es esa oportunidad y no vuelve.** El número que salga es el que permite
decidir si `NEAR_LIVE_MS` puede volver a bajar de 10 s — decisión que ya se tomó y se revirtió dos
veces a ciegas.

**Fase 8 — el experimento de la actualización silenciosa (7.4).**

```bash
adb shell dumpsys package com.launion.app | grep -i installerPackageName
```

Si dice `com.google.android.packageinstaller`, confirma que hoy el installer of record **no** es la
app. Después de la primera actualización hecha con `PackageInstaller`, tiene que decir
`com.launion.app`.

> ⚠️ **Dos límites de la sesión.**
>
> 1. **No hay una sola línea de `Log.*` en los 15 `.java`.** `logcat` no va a mostrar nada de los
>    plugins: solo tags del sistema (`ActivityManager`, `AlarmManager`, `LocationManagerService`, la
>    excepción de FGS). Si se quiere trazabilidad real, agregar unos `Log.w` **antes** de compilar el
>    APK que se lleva al teléfono. Es barato y cambia por completo lo que se puede ver.
> 2. **Las SharedPreferences no se leen por `adb` en un build release** — `run-as` solo funciona sobre
>    builds debuggables. El build `debug` usa `applicationIdSuffix ".debug"`, así que **se puede
>    instalar al lado** y leer sus prefs, pero es otro paquete: otra sesión de Supabase, otro registro
>    FCM, y **no comparte estado** con el release.
> 3. **`dumpsys deviceidle` prueba el Doze de AOSP, no el power manager de Samsung.** Las "Deep
>    sleeping apps" son de One UI y no se ven ahí. Eso solo se prueba dejando el teléfono quieto
>    varios días. No hay atajo: sigue valiendo el techo de §3.2, ahora sobre hardware real.

#### 🟢 La configuración por cable es permanente (08/08/2026, medido)

Las dos dudas que quedaban sobre la sesión USB están cerradas, sobre hardware real y no por deducción:

| Evento | Qué se midió | Resultado |
|---|---|---|
| **Reinicio** (SM-A075M `R8ML200TWMW`) | exención de batería, bucket, 4 permisos, alarma exacta | ✅ **todo intacto** |
| **Actualización mayor de sistema** — Android 15 / One UI 7 → **Android 16 / One UI 8.0.5** (SM-A075M `R8ML2008BLP`) | lo mismo | ✅ **todo intacto** |
| **Salto de DOS versiones mayores** — Android 14 / One UI 6.1 → **Android 16 / One UI 8.0** (SM-A065M `R8MY402185J`) | lo mismo | ✅ **todo intacto** |

**Consecuencia: el cable se pasa UNA vez por teléfono.** No hay mantenimiento periódico, y una actualización de One UI no obliga a rehacer nada. Esto es lo que vuelve viable configurar los 9 en una sola sesión.

> ⚠️ **Lo único que NO sobrevive es `adb tcpip` (ver más abajo).** No confundir: la configuración de
> la app es permanente; el puerto de depuración por red no.

#### 🩸 Configurar el teléfono NO lo pone a rastrear (08/08/2026, medido)

El error más caro del día, y el más fácil de repetir. Los 9 quedaron con exención de batería, bucket
5, los 4 permisos y alarma exacta — **y 6 de 9 no habían capturado un solo punto en su vida.**

Los tres que sí rastreaban eran los tres donde, además de configurar por cable, se **abrió la app, se
inició sesión y se completó la pantalla de permisos de GPS**. La diferencia se ve en una línea:

```bash
adb -s <ip>:5555 shell dumpsys activity services com.launion.app | grep -c ServiceRecord
# 0 = el uploader NUNCA arrancó → cero puntos, por más configurado que esté el equipo
```

**Por qué:** el uploader nativo necesita el **token de dispositivo**, que la app obtiene recién al
completar el gate de GPS. Sin token, `AlarmReceiver` despierta cada 30 min, no ve token y no arranca
nada (regla 19-bis: sin `K_TOKEN` no se resucita el servicio). El síntoma engaña porque **las alarmas
sí se reprograman puntualmente** — el teléfono se ve sano por todos lados menos el que importa.

> **Verificación real de que un teléfono quedó listo: puntos en `posiciones`, no configuración en
> `dumpsys`.** El `select` de abajo es el único veredicto que vale.

```sql
select p.nombre, count(po.id) as puntos_hoy, max(po.ts) as ultimo
from public.perfiles p
left join public.posiciones po on po.id_usuario = p.id
  and po.ts >= timestamp '<hoy> 00:00' at time zone 'America/Argentina/Buenos_Aires'
where p.id_empresa = '<empresa>' group by p.nombre order by puntos_hoy;
```

🟢 **De paso, el arranque de 1.11.0 quedó validado en la calle:** los tres teléfonos que rastreaban
pusieron su primer punto del día a las **08:00:01, 08:00:01 y 08:00:02**, contra la mediana de
**51 minutos** de retraso medida sobre 29 días hábiles antes del arreglo.

#### 🩸 Dos formas de que `adb` no vea un teléfono que está enchufado

Antes de perder tiempo, mirar **qué interfaces expone** el equipo en Windows:

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like "USB\VID_04E8&PID_6860*" } |
  Select-Object Status, FriendlyName, InstanceId | Format-Table -AutoSize
```

| Síntoma | Causa | Fix |
|---|---|---|
| **Falta `MI_03`** (solo aparecen `MI_00` multimedia y `MI_01` serie) | 🟢 **casi siempre: la pantalla del teléfono está BLOQUEADA.** Samsung no expone el ADB con el equipo bloqueado. Si desbloqueado sigue faltando, ahí sí es Depuración USB apagada — One UI la desactiva sola tras una actualización mayor | desbloquear el teléfono; si no, reactivar Opciones de desarrollador |
| **`MI_03` presente y en estado OK, pero `adb devices` vacío** | el registro de Windows tiene el descriptor cacheado en vacío (ver abajo) | `scripts/fix-adb-interface.ps1` como administrador |

Los dos dan el mismo `adb devices` vacío y se parecen mucho. La consulta de arriba los separa en un segundo.

#### 🩸 El teléfono que Windows ve y `adb` no (07/08/2026, medido)

Ocho de los nueve equipos entraron sin fricción. El noveno (SM-A065M, serial `R8MY5027YQT`) **nunca
mostró el cartel de "¿Permitir depuración USB?"**, y `adb devices` salía vacío — ni siquiera
`unauthorized`. Se perdió cerca de una hora atacando el teléfono. **El teléfono no tenía nada.**

Lo que descarta el síntoma, y no hay que volver a probar:

| Se probó | Resultado |
|---|---|
| Depuración USB on/off, revocar autorizaciones, modo *Transferir archivos* | sin efecto |
| Reiniciar el teléfono, cambiar el cable, cambiar de puerto | sin efecto |
| Bloqueo automático (Auto Blocker) de One UI | ya estaba apagado |
| `adb kill-server` / `start-server`, backend `ADB_LIBUSB=1` | sin efecto |
| Otro `adb` peleando por el puerto 5037 | no había: un solo proceso |
| Driver equivocado | ❌ **falsa pista**: los 9 usan el mismo `winusb.inf` genérico |

**La causa está en el registro de Windows, no en Android.** Windows le pide al dispositivo el
descriptor *MS OS Extended Properties* para saber qué interfaz publicar. Este teléfono lo respondió
vacío —casi seguro porque la primera conexión ocurrió mientras corría su actualización de sistema y
`adbd` todavía no había levantado—, y Windows **cachea el fracaso** con `ExtPropDescSemaphore = 1` y
no vuelve a preguntar nunca. WinUSB carga igual, pero la interfaz `MI_03` no publica ninguna clase, y
`adb` no tiene nada que abrir.

El diagnóstico es de una sola consulta, y es binario. Un equipo sano publica **dos** clases de
interfaz; el trabado no publica ninguna:

```powershell
# {dee824ef-...} = WinUSB genérica · {f72fe0d4-...} = la de ADB
Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceClasses" | ForEach-Object {
  $c = $_.PSChildName
  Get-ChildItem $_.PSPath -EA SilentlyContinue |
    Where-Object { $_.PSChildName -match "VID_04E8&PID_6860&MI_03" } |
    ForEach-Object { "$c  $($_.PSChildName)" }
}
```

**Fix:** `scripts/fix-adb-interface.ps1`, **como administrador**, con el teléfono conectado. Borra la
marca cacheada y desinstala el nodo con `pnputil /remove-device` para forzar la re-enumeración; al
reconectar el cable, Windows vuelve a preguntar y el cartel sale. Es reversible y no toca el teléfono
ni otros dispositivos: sólo apunta a nodos ADB de Samsung **presentes** que no publican interfaz.

> **Regla práctica:** si Windows muestra "ADB Interface" en estado OK y `adb devices` sale vacío,
> dejar de tocar el teléfono y mirar `DeviceClasses`. Todo lo que se hace del lado de Android es
> inútil, porque Windows ya decidió y no está preguntando de nuevo.

### 7.8 "Ir agregando características de ciertos modelos al plugin" — el reencuadre

**La idea es correcta en el diagnóstico y equivocada en el eje.**

**Lo que es correcto:** falta un registro de quirks, y sobre todo falta la **precondición**. Hoy no se
guarda marca, modelo ni versión de Android en ningún lado (cero `Build.MANUFACTURER`/`MODEL`/`BRAND`
en todo `android/`, ninguna columna en `estado_dispositivo`). Se mide el **síntoma** del OEM agresivo
—`fgs_bloqueado`, `bateria_exenta`, `gps_silencio_max_ms`— y **nunca la identidad del OEM**. Por eso
"los OEM agresivos" es folklore del proyecto y no un `select`.

**El contraejemplo está adentro del repo.** `BatteryOptimizationPlugin.abrirAutostart()` es
exactamente esta idea aplicada durante un año: **9 componentes de OEM probados por fuerza bruta**, que
devuelven `{abierto:bool}` sin verificar nada, y **sin un solo dato en la base que diga si alguno
matcheó alguna vez en un teléfono real**. Y ninguno es Samsung.

**La corrección de eje: ramificar por API level sí, por modelo casi nunca.** Aun con parque 100 % A07,
`Build.VERSION.SDK_INT` sigue siendo legítimo — el código ya ramifica por él en cuatro lugares
(`ApkUpdaterPlugin`, `BatteryOptimizationPlugin`, `AlarmWatchdogPlugin.puedeExacta`, `AlarmReceiver`).
Un modelo ≠ un API level: el A07 va a recibir actualizaciones de OS, y en dos años la "flota
unificada" va a tener tres versiones de Android conviviendo. Y la flota **no se unifica de golpe**:
va a haber un período mixto que hoy `estado_dispositivo` ni siquiera puede contar.

**La forma correcta, en tres pasos y en ese orden:**

1. **El dato primero** (pendiente #7): `marca`, `modelo`, `android_release`, `android_sdk`. Eso
   convierte todas las columnas de síntoma que ya existen en algo **agrupable por identidad de OEM**.
2. **El registro de quirks es una TABLA de documentación, no un `if`**: modelo/versión, síntoma
   medido, cómo se midió, qué lo mitigó, y si sigue vigente. Cero código.
3. **Si alguna vez hace falta un umbral distinto por modelo, NO va como rama en Java.** La regla 22-ter
   es explícita: `gpsConfig.js` es la única fuente y los umbrales viajan por SharedPreferences → se
   afinan por OTA. La forma que respeta eso es una tabla de overrides en la base, resuelta en JS y
   empujada por el mismo canal de prefs. Un `if (Build.MODEL.equals(...))` adentro de
   `UploaderGpsService` sería una **segunda** fuente de umbrales — el bug exacto que la regla 22-ter
   existe para prevenir — y encima solo cambiable por APK.

> ⚠️ **No construir el paso 3 ahora.** Es YAGNI hasta que el paso 1 produzca un `group by marca` con
> una diferencia medida. Escribir el mecanismo antes que el dato es la misma idea otra vez, con mejor
> arquitectura.

**Donde la idea sí tiene razón y conviene rescatarlo:** la app hoy es ciega a la marca en la UI, y eso
ya produce copy incorrecto. `PermisoSiemprePrompt.jsx` le dice a **todos** *"En Xiaomi, Huawei y
similares, activá Inicio automático"* — y eso va a ser **falso para el 100 % del parque nuevo**. La
solución no es acumular componentes de OEM: es **saber la marca y decir la verdad**. Que es, otra vez,
el paso 1.

### 7.9 Headwind MDM self-hosted — la decisión y el orden

**Decidido el 07/08/2026: Headwind MDM, self-hosted.** Lo que sigue es *dónde* va el servidor y *en
qué orden* se hacen las cosas — y esa parte importa más que la elección de herramienta, porque una de
las tres opciones que estaban sobre la mesa destruye datos.

#### Lo que se verificó (07/08/2026, documentación oficial)

| Hecho | Fuente |
|---|---|
| Servidor = **Ubuntu 18.04-24.04 (22.04 recomendado) + Tomcat 9 + PostgreSQL**. **Sin soporte Windows** | [advanced-web-panel-installation](https://h-mdm.com/advanced-web-panel-installation/) |
| La imagen Docker es Ubuntu 22.04 + Tomcat 9, exige **PostgreSQL externo** y pide `BASE_DOMAIN` | [hmdm-docker](https://github.com/h-mdm/hmdm-docker) |
| 🩸 **HTTPS NO funciona con certificados autofirmados.** Exige dominio real + certbot | [advanced-web-panel-installation](https://h-mdm.com/advanced-web-panel-installation/) |
| HTTP plano **sí** funciona en red interna contra la IP del server. Pierde el control remoto | [private-network](https://h-mdm.com/private-network/) |
| ✅ **Instalación silenciosa de apps: está en la versión Community** (gratis). Kiosco también. Sin límite de dispositivos declarado | [version-comparison](https://h-mdm.com/headwind-mdm-version-comparison/) |
| Los APK se **suben al panel**. No instala desde una URL externa ni desde Google Play | [quick-start](https://h-mdm.com/quick-start/) |
| El cliente (`com.hmdm.launcher`) **reemplaza la pantalla de inicio** | [quick-start](https://h-mdm.com/quick-start/) · [F-Droid](https://f-droid.org/packages/com.hmdm.launcher/) |
| Licencia Apache 2.0 | [hmdm-server](https://github.com/h-mdm/hmdm-server) |

#### 🩸 Por qué el servidor NO va en una PC

Se evaluó levantarlo en la PC de desarrollo y **rehacerlo en un mes**, cuando se migre a la máquina
nueva (§2), pidiendo los teléfonos de vuelta. **Es la peor de las opciones**, y no por comodidad:

1. **Los A07 todavía no llegaron.** No hay nada que inscribir hoy, y lo único que se puede verificar
   de un MDM es un teléfono inscripto. El mes de "dejarlo listo" no produce nada comprobable.
2. 🩸 **La ventana de provisioning es de un solo uso.** 7.2 ya lo dice: Device Owner exige el equipo
   **sin ninguna cuenta**. Inscribir los 12 contra una IP de LAN temporal y re-inscribirlos en un mes
   significa **factory reset de los 12** — y eso borra la cola de posiciones, la cuarentena y la
   sesión de cada uno (regla 20, §2.1). Media jornada y pérdida de datos para llegar al mismo lugar.
3. **Un servidor en LAN no ve vendedores en la calle.** Se comunican por datos móviles: una
   `192.168.x.x` es inalcanzable. El panel los vería solo cuando pasen por la oficina.
4. **No hace falta migrar de PC para romperlo.** La IP la da el DHCP y cambia sola.

> **La migración de PC no hay que planificarla: hay que hacerla desaparecer.** El problema existe solo
> porque el servidor viviría en una máquina que se mueve. En un VPS, migrar la PC de desarrollo deja
> de tocar a los teléfonos — y de paso el servidor queda accesible desde la calle, que es donde están.

#### Las tres fases, en este orden

> 🔴 **El orden manda, y desde el 07/08 hay fecha:** se van a resetear los 9 equipos para pasarlos a
> empleados nuevos. **Ese reset es la única ventana de provisioning que va a haber**, así que el
> servidor tiene que estar arriba y probado ANTES de que se resetee el primero. Si el recambio de
> personal llega antes que el servidor, se resetea igual y se pierde Device Owner para siempre —
> en ese caso, mejor asumirlo de entrada y quedarse con `PackageInstaller` (7.4) que improvisar.

**Fase 0 — Laboratorio en la PC actual (ahora, descartable).** El instinto de "dejarlo listo" es
correcto; lo que cambia es *qué* se deja listo. Se levanta Headwind acá **para aprender el panel y
medir tres cosas**, no para producción.

🔴 **Regla que no se rompe: en este servidor NO se inscribe ni un A07, ni ninguno de los 9 teléfonos
que están hoy en la calle.** Tiene que ser un equipo **realmente descartable**, porque inscribirlo lo
deja con Headwind de Device Owner y sacárselo es **factory reset** — o sea que en un teléfono de
producción cuesta la cola de posiciones, la cuarentena y la sesión (regla 20). Sin un equipo así
disponible, **la Fase 0 se salta entera**: el emulador no sirve (regla 43 y §3.2), y probar sobre uno
de los 9 sale más caro que no probar.

1. `wsl --install -d Ubuntu-22.04` — **22.04 y no 24.04**: el instalador quiere `tomcat9`, que 24.04
   ya no empaqueta.
2. En `%USERPROFILE%\.wslconfig`, `networkingMode=mirrored`. WSL comparte la IP del host y **evita
   todo el `netsh interface portproxy`**, que además habría que rehacer en cada reinicio porque la IP
   interna de WSL2 cambia sola.
3. `hmdm_install.sh` con `PROTOCOL=http` y la IP LAN de la PC. Sin dominio ni certificado: para un
   laboratorio alcanza, y es lo que la doc de red privada contempla.
4. Regla de firewall de Windows para el puerto del panel, **solo en el perfil de red privada**.
5. Subir el `app-release.apk` ya publicado y medir:
   - ¿se instala **sin que nadie toque nada**?
   - ¿se **actualiza** sola al subir una versión mayor?
   - ⚠️ ¿el panel expone algo para **bloquear el force-stop** de `com.launion.app`? **Es la capacidad
     más valiosa (7.3) y no está documentada en ningún lado.** Hay que verla en el panel, no
     creerle a nadie — ni a este documento.

> **Criterio de salida:** si las dos primeras dan ✅, Headwind sirve y se pasa a la Fase 1. Si no, se
> abandona y queda `PackageInstaller` (7.4), que ya estaba decidido y no necesita servidor.

**Fase 1 — El servidor definitivo, ANTES de que lleguen las cajas.**

- **VPS** ~US$5-10/mes. ⚠️ Evaluar Oracle Cloud Always Free ARM — Java/Tomcat corre en ARM64, pero
  **verificar**, no está confirmado.
- **Dominio propio** apuntando ahí (sirve un subdominio gratis de DuckDNS). Lo que importa es que
  **sea un nombre y no una IP**, para que el servidor se pueda mudar sin tocar un solo teléfono.
- **HTTPS con certbot.** No es opcional: sin él no hay control remoto, y un panel MDM en HTTP plano
  sobre internet no se sostiene.
- Endurecimiento mínimo: firewall, contraseña de admin cambiada, backup de PostgreSQL. 🔴 **Un panel
  MDM expuesto a internet controla 12 teléfonos de empleados: es un objetivo de compromiso total, no
  una web más.** Otra razón para que viva en un VPS con firewall y no detrás del router de una casa.

**Fase 2 — El día de las cajas.** Ya está escrito en 7.2 (orden de desprecintado) y 7.7 (las 8 fases
de la sesión USB). No se reescribe. Solo se agrega que la inscripción va **contra el dominio
definitivo**, y que **la sesión USB con `adb` se hace igual**, porque hay tres cosas que Headwind no
da y solo el cable resuelve: la exención de batería, la medición de `batterystats` (Fase 7) y la
verificación del arranque de 1.11.0 sin esperar al día siguiente (Fase 5).

#### Los cuatro costos, sin maquillar

1. 🩸 **No resuelve la exención de batería.** Igual que cualquier Device Owner: **no existe API
   pública de `DevicePolicyManager` para la allowlist de Doze.** (⚠️ Circula por internet un supuesto
   `setIgnoreBatteryOptimizations()` de `DevicePolicyManager` — **no existe** en el SDK público; la
   fuente es contenido generado, no documentación. No construir nada sobre eso.) Quien sí la expone es
   **Knox vía OEMConfig**, exactamente lo que ya decía 7.3. **La cadena del arranque al horario sigue
   colgando del diálogo manual, con Headwind o sin él.**
2. 🩸 **Un solo DPC por dispositivo** → `com.launion.app` no podrá ser Device Owner nunca. Ver el
   recuadro de 7.5. Y el bloqueo del force-stop —lo único que solo DO compra— queda dependiendo de
   que el panel de Headwind lo exponga. ⚠️ **Sin verificar. Es lo primero que hay que mirar.**
3. **Un cuarto canal de despliegue.** Hoy son tres (PWA · OTA · APK) y §1 ya advierte que se
   desincronizan. El panel de Headwind agrega un cuarto lugar donde la versión puede quedar vieja, en
   paralelo a `min_version`. **Decidir explícitamente quién manda** — propuesta: `apk-release.sh`
   sigue siendo la fuente de verdad y el panel es un espejo, **nunca al revés**.
4. **Reemplaza la pantalla de inicio.** El teléfono deja de verse como un Samsung. Para equipos de la
   empresa puede ser hasta deseable, pero es un cambio visible: **avisarlo antes, no después.**

### 7.10 Qué hacer antes de que lleguen

| # | Cambio | Canal | Esfuerzo | Nota |
|---|---|---|---|---|
| 1 | 🔴 **Registrar marca/modelo/API level en `estado_dispositivo`** | **OTA** | S | La precondición de todo lo demás. Se puede empezar **hoy, sin APK**: el WebView pone modelo y versión en `navigator.userAgent` (`Linux; Android 15; SM-A075F`) y `capacitor.config.ts` **no** pisa el UA (verificado). Se parsea en JS, se agrega al objeto `identidad` de `useEstadoDispositivo.js` (que ya omite todo en web, criterio correcto) + `db/31`. **Empieza a recolectar sobre los 9 teléfonos actuales**, lo que hace legible retroactivamente todo `db/29`/`db/30`. Después, en el próximo APK, sustituir el UA por `Build.*` reales vía `InfoAppPlugin`, sin tocar el esquema. ⚠️ **NO instalar `@capacitor/device` para esto**: sería una dep nueva y un APK obligatorio por un dato que el UA ya da |
| 2 | 🔴 **Corregir el copy de `PermisoSiemprePrompt.jsx`** | **OTA** | XS | Hoy dice "En Xiaomi, Huawei y similares" y va a ser falso para todo el parque nuevo. El cambio más barato del documento y el único que le habla al usuario final |
| 3 | 🟠 **`PackageInstaller` + `UPDATE_PACKAGES_WITHOUT_USER_ACTION`** | APK | M | **Decidido** (7.4). De 3-4 toques a cero. Reemplaza `lanzarInstalador` en `ApkUpdaterPlugin.java:121-130`. ⚠️ Verificar en el A07 con la Fase 8 antes de invertir. 🟢 Device Owner lo vuelve redundante → decidir 7.2 primero |
| 4 | 🟡 **Unos `Log.w` de diagnóstico** en `AlarmReceiver` / `UploaderGpsService` | APK | XS | Habilita la Fase 5. Hoy `logcat` no dice nada de la app. Va en el mismo APK que #3 |
| 5 | 🟡 **Rama Samsung en `abrirAutostart`** | APK | S | **Pero NO como una fila más del array**: Samsung no tiene lista de autostart. Rutear a la pantalla de suspensión de One UI, con el componente **verificado en la Fase 4**. Hacerlo **después** de tener el teléfono, no antes |
| 6 | 🟡 **`isDeviceOwnerApp()` → columna `administrado`** | APK | XS | Solo si 7.2 da "sí". Permite ver con un `select` cuáles quedaron bien provisionados |
| 7 | ⚪ **Overrides de umbrales por modelo** | — | — | ❌ **NO construir.** Ver 7.8, paso 3 |
| 8 | 🔴 **Laboratorio de Headwind (Fase 0)** | — | M | **Va primero de todo, y antes de gastar un peso.** WSL2 + Ubuntu 22.04, contra un teléfono viejo. Mide tres cosas (7.9): instala solo · actualiza solo · ⚠️ ¿bloquea el force-stop? Si las dos primeras fallan, se abandona Headwind y queda #3 |
| 9 | 🟠 **VPS + dominio + certbot** | — | S | Solo **después** de que la Fase 0 dé ✅, y **antes** de que lleguen las cajas. Nunca en una PC: ver el bloque 🩸 de 7.9. El dominio es lo que hace que el servidor se pueda mudar sin tocar los teléfonos |
| 10 | 🟠 **Decidir quién manda: `min_version` o el panel** | — | XS | Headwind sería el **cuarto** canal de despliegue. Propuesta: `apk-release.sh` es la fuente de verdad y el panel un espejo, **nunca al revés**. Escribirlo como regla en `CLAUDE.md` el día que el panel entre en producción |

**Lo que Device Owner volvería innecesario** (solo para los A07; hay que conservarlo mientras el parque
sea mixto): el baile de `canRequestPackageInstalls`, el pedido de "Permitir siempre" y el de
notificaciones. **Lo que NO**: el pedido de exención de batería, la alarma exacta y las listas de
sueño de Samsung. `PermisoSiemprePrompt` no desaparece — **se encoge a un solo botón, el de batería,
que es justamente el que importa.**

---

## 8. Las deudas de fondo

No son tareas: son decisiones pendientes.

- **`AdminView` está muerto** y arrastra 511 líneas de vistas que nadie ejecuta. Decisión de producto,
  no de datos (los datos de las tres están vivos).
- **El módulo de pedidos está a mitad de camino desde el principio.** `pedidos`, `pedido_items`, el
  bucket `firmas` y `RepartidorView` (320 L) existen, tienen RLS y **0 filas**. Hay que arrancarlo o
  retirarlo. Nota: `firmas_ins` sigue siendo `to authenticated` sin alcance de empresa — hoy no muerde
  porque nadie firma nada, pero cuando arranque hay que darle el mismo tratamiento que a `db/25`.
- **Las dos supervisiones están duplicadas** y ya divergieron dos veces (los carteles de parada
  existieron solo en Movil durante versiones; el arreglo de performance del 26/07 tardó dos días en
  llegar a Desktop porque era una copia).
- **OSRM público en camino crítico**, y ahora con dos hosts y tres perfiles: la dependencia de servicios
  gratuitos sin SLA **creció** en vez de bajar.
- ⚠️ **El parque corre Android 16 (API 36) y el proyecto compila contra `targetSdk 34`.** Verificado
  el 07/08 en un SM-A075M. No está roto —Android mantiene compatibilidad hacia atrás— pero la brecha
  es de **dos versiones mayores** y sigue creciendo: cada release nueva de Android aplica los
  *behavior changes* de `targetSdk 35` y `36` como opt-in que este proyecto no tomó. Subirlo está
  bloqueado por una decisión deliberada: `android/app/build.gradle` fija `androidx.work` en 2.9.1
  porque el plugin OTA de Capgo arrastra 2.10, que exige `compileSdk 35`. **Desatar ese nudo es
  trabajo real y conviene planificarlo antes de que lo fuerce un bug en la calle.**
- **Cero tests, cero lint efectivo.** Cada release se verifica a mano o en la calle.
- **Las tres fallas más caras del último mes no se pueden reproducir en el emulador** (multi-cuenta del
  uploader, canales de notificación, cadencia no entregada). Se verifican en la calle con consultas
  contra la base. Es una limitación real del proyecto, no algo que se arregle con más herramientas.

---

## 9. Si sos una sesión nueva en la máquina nueva

1. Leé **[CLAUDE.md](CLAUDE.md) entero** — son 45 reglas y **cada una costó un bug de producción**.
2. Para el estado de la base: **consultá la base viva por el MCP de Supabase**, nunca los `db/*.sql`
   (son el registro de migraciones ya aplicadas, no la fuente de verdad; y `db/historico/` tiene
   políticas **inseguras** que reabren agujeros si se re-ejecutan).
3. Para saber qué es cada archivo: [ESTRUCTURA_PROYECTO.md](ESTRUCTURA_PROYECTO.md).
4. Para arquitectura y deuda: [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md).
5. **Los comentarios largos con fechas y números de bug no son ruido: son la memoria del proyecto.** Si
   refactorizás el código que explican, migrá el comentario.
6. La memoria de Claude de la máquina vieja **no viaja**. Todo lo que hacía falta recordar está en estos
   cuatro documentos; si descubrís algo que no está, escribilo acá.
