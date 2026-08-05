# HANDOFF — DisT-At

> **04/08/2026 · `APP_VERSION 1.10.0`.** Escrito para retomar el proyecto **en otra máquina y en una
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

### Publicado hoy

| | |
|---|---|
| Versión publicada | **1.10.0** en `app_config` (`latest_version` = `min_version` = `bundle_version`), con `apk_url` y `bundle_url` cargados. Como `min_version` está en 1.10.0, **los teléfonos con versión menor se reinstalan solos** |
| Versión en el código | ⚠️ **1.11.0 SIN PUBLICAR** — `src/version.js`, `versionName`/`versionCode 29`. Arreglo del arranque del rastreo al horario (ver §4). Toca `.java` + manifest ⇒ **APK nuevo obligatorio**, y hay que subir `min_version` o el auto-updater queda inerte |
| Rastreo | 08:00–18:00, Lunes a Sábado, alertas de equipo activas |
| Parque | ~9 teléfonos en la calle |

### La base viva (verificado el 04/08 por MCP)

**2 empresas** (ya no es mono-empresa) · 15 perfiles, **3 esperando aprobación** · 1.998 clientes ·
693 productos · 30.839 posiciones · 3 visitas · **0 pedidos** · **30 MB** de 500 del plan free.

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

### 🔴 Hacer ya

| # | Pendiente | Por qué duele | Qué lo cierra |
|---|---|---|---|
| 1 | **Respaldar el keystore** (§2.1) | Punto único de falla, y se está por mudar de disco | Contraseñas a un gestor + `.keystore` en 2 lugares |
| 2 | **Cerrar el circuito de recuperación de contraseña** | Está **roto en producción**: el botón manda el mail y no hay pantalla donde poner la nueva. Ver §5 | Vista nueva + handler de `PASSWORD_RECOVERY` |
| 3 | **Versionar `ingesta_tokens` y `mi_token_ingesta`** | Recrear la base desde `db/` deja al uploader nativo sin poder autenticarse. Y la Edge Function referencia un `db/16_ingesta_tokens.sql` **que no existe** | Migración nueva contra la base viva |
| 4 | **Unificar la ventana de rastreo**, hoy implementada 3 veces | `dentroDeHorario()` (JS), `VentanaRastreo.dentro()` (Java) y `en_ventana` (SQL). Tocar una sin las otras hace que **los avisos al supervisor mientan en silencio** | Una sola fuente — el SQL es el candidato: se verifica con un `select` |
| 4-bis | **Publicar 1.11.0** (arranque del rastreo al horario) | El código está listo y compila, pero **sin publicar el arreglo no existe**: los 9 teléfonos siguen arrancando con una mediana de 51 min de retraso | `apk-release.sh 1.11.0` + `ota-release.sh 1.11.0` + `UPDATE app_config` (incluido `min_version`) + `push-actualizacion` |
| 4-ter | **Que un cambio de horario llegue al teléfono con la app cerrada** | Las prefs con la ventana solo las escribe `configurar()` con la app viva. Si el admin cambia el horario y la persona no abre la app en días, el teléfono sigue con la ventana vieja — y ahora también con la alarma calculada sobre ella | `LaUnionMessagingService` escribiendo la ventana en prefs desde un data-message de FCM (corre en nativo, con el WebView muerto) |
| 5 | **Términos y condiciones + política de privacidad** | La app pide `ACCESS_BACKGROUND_LOCATION` y rastrea empleados; hoy no hay ni una línea legal. Ver §6 | Borradores ya escritos en [`legal/`](legal/) — falta revisión, publicación y link |

### 🟠 Próximo sprint

| # | Pendiente | Nota |
|---|---|---|
| 6 | Script `build:apk` con `CAP_BUILD=1` incorporado | `cross-env` por Windows. Cierra el riesgo #4 de la auditoría, vigente desde julio |
| 7 | `UNIQUE (id_empresa, codigo)` en `clientes` | Hoy es UNIQUE global: **dos distribuidoras no pueden usar el mismo código**. Con 2 empresas vivas ya muerde |
| 8 | Decidir `AdminView` | Está **inalcanzable** y con él 3 vistas muertas (511 L). Borrar `RecorridosView` y `MapaOperativo`; **rescatar `ReplayJornada`** (reproduce la jornada como película, no hay nada equivalente) colgándola de "Menú" |
| 9 | Versionar las 4 columnas restantes | `posiciones.bateria`, `perfiles.numero`, `zonas.numero`, `zonas.id_vendedor` + `ubicaciones_compartidas` y su RPC |
| 10 | Rotar la key de Stadia y moverla a `VITE_STADIA_KEY` | Está commiteada: considerarla quemada. Agregarla como secret del workflow o la PWA pierde esas capas |
| 11 | Config de ESLint + quitar el `\|\| true` | Hoy no hay ninguna red de seguridad |
| 12 | Prender la **protección de contraseñas filtradas** en Supabase Auth | Una casilla del panel. Relevante porque las contraseñas iniciales las elige un admin |
| 13 | Sanear las docs obsoletas | `README.md` (menciona un componente `GoogleMap` inexistente), `GUIA_APK_ANDROID.md` (se contradice sobre `storeFile`), `GUIA_API_KEY_GOOGLE_MAPS.md` (obsoleta entera) |
| 14 | `supabase/functions/_shared/fcm.ts` | `getAccessToken` está copiado **3 veces**; la cuarta va a divergir |

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

## 7. Las deudas de fondo

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
- **Cero tests, cero lint efectivo.** Cada release se verifica a mano o en la calle.
- **Las tres fallas más caras del último mes no se pueden reproducir en el emulador** (multi-cuenta del
  uploader, canales de notificación, cadencia no entregada). Se verifican en la calle con consultas
  contra la base. Es una limitación real del proyecto, no algo que se arregle con más herramientas.

---

## 8. Si sos una sesión nueva en la máquina nueva

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
