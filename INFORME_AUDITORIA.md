# Informe de auditoría — DisT-At (PWA + APK Android)

> **Revisión 3 · 04/08/2026 · `APP_VERSION 1.10.0`** ([src/version.js](web/src/version.js) · `versionCode 28`).
> Revisiones anteriores: 18/07/2026 (sobre 1.5.25) y 27/07/2026 (sobre 1.6.3). El historial está en git.
> Repo: `santiagoadet7823-dev/la-union-app`.
> Documento de **referencia**. Las reglas operativas del día a día están en [CLAUDE.md](CLAUDE.md);
> los pendientes accionables y el entorno de trabajo, en [HANDOFF.md](HANDOFF.md); el inventario de
> archivos, en [ESTRUCTURA_PROYECTO.md](ESTRUCTURA_PROYECTO.md).

## Qué cambió respecto de la revisión anterior

La rev. 2 quedó **cuatro versiones menores atrás** y no era solo cuestión de números: cuatro de sus
afirmaciones decían **lo contrario** de lo que pasa hoy. Van primero porque quien haya leído esa
versión tiene esas cuatro cosas mal aprendidas:

| Decía la rev. 2 (27/07) | Realidad al 04/08 |
|---|---|
| §5: `tracker.js` es el pipeline GPS de producción | **Falso y peligroso.** En la calle corre `UploaderGpsService.java` (1.200 L) contra la Edge Function `ingest-posiciones`. `tracker.js` quedó como camino de la **PWA** y como telemetría. Tocar `tracker.js` creyendo que se toca producción no cambia nada en los teléfonos |
| §1/§8: el rol `propietario` NO está en el check constraint, "confirmado en base viva 27/07" | **Falso.** Lo agregó `db/20_propietario_rol.sql`, `UsuariosView` lo ofrece y `crear-usuario` lo acepta |
| §2: la vista del dueño es `propietario/PropietarioView.jsx` | **Ese archivo no existe.** Es `features/propietario/PropietarioMovil.jsx` (672 L) + 5 componentes + `titulares.js` |
| §4: el `<service>` de ubicación llega por merge desde el plugin | **Falso.** Está declarado a mano en `AndroidManifest.xml`, con `foregroundServiceType="location"` |

Y lo que directamente no existía: **14 migraciones** (`db/16`–`db/29`), **5 Edge Functions** (conocía 1
de 6), **11 plugins/servicios nativos** (decía "los tres plugins propios"; hoy son 14 `.java`), el
`TenantContext`, las alertas de equipo, los permisos por perfil, la triangulación por red y el
auto-update del APK.

**Nota de método.** Verificando la rev. 2 encontré que la mayoría de sus referencias `archivo:línea`
se habían corrido, y que dos están mal **también en CLAUDE.md** (`queue.js:66-69` hoy es el bloque de
desborde; `AuthContext.jsx:207` es `:355`). Desde esta revisión se cita por **nombre de símbolo** —
`decidirSupervisionMovil()`, `CODIGOS_PERMANENTES`, `fraccionCiega` — y el número de línea es una
ayuda, no un ancla.

---

## 1. Resumen ejecutivo

**DisT-At** (`com.launion.app`) es un SaaS logístico multi-tenant de seguimiento GPS de equipos en
calle. Un mismo código React se despliega por **tres** caminos independientes:

| Canal | Artefacto | Cómo se actualiza | Base de assets |
|---|---|---|---|
| **PWA** | GitHub Pages | push a `main` → workflow → Pages + Service Worker | `/la-union-app/` |
| **OTA** | bundle Capgo | `scripts/ota-release.sh` → `bundle.zip` en GitHub Releases + fila en `app_config` | `./` (**requiere `CAP_BUILD=1`**) |
| **APK** | Android/Capacitor | `scripts/apk-release.sh` → Release + `app_config.apk_url`; el teléfono se reinstala solo si su versión < `min_version` | `./` |

La rev. 2 solo conocía los dos primeros. El tercero existe desde 1.6.0 y **es el único camino para
cualquier cambio nativo** (los `.java`, el manifest, `web/capacitor.config.ts`).

Backend: **Supabase** (Postgres + RLS + Auth Google + Realtime + **6 Edge Functions** + `pg_cron` +
`pg_net`). Notificaciones: **FCM** (proyecto Firebase propio). Mapas: **Leaflet sobre OSM** con dos
capas opcionales de **Stadia**. Ruteo: **OSRM público** (dos hosts, tres perfiles).

### Estado de la base viva (verificado por MCP el 04/08/2026)

| | |
|---|---|
| `latest_version` / `min_version` / `bundle_version` | **1.10.0 / 1.10.0 / 1.10.0**, con `apk_url` y `bundle_url` cargados |
| Ventana de rastreo | 08:00–18:00, días 1–6 (Lun–Sáb), `track_enabled = true`, alertas activas |
| Empresas | **2** — ya no es mono-empresa. El aislamiento entre tenants pasó de teórico a real |
| Perfiles | 15, de los cuales **3 sin rol o inactivos** (esperando aprobación) |
| Datos | 1.998 clientes · 693 productos · 30.839 posiciones · 3 visitas · **0 pedidos** |
| Tamaño | **30 MB** de 500 MB del plan free |

### Estado general

Sigue siendo un proyecto **excepcionalmente bien comentado**: casi toda guarda defensiva explica el
bug de producción que la originó, con fecha y con números medidos. Esa es la mayor fortaleza del repo.

Lo que cambió de fondo desde julio es **dónde vive la complejidad**. En la rev. 2 el sistema era una
app React con un plugin de GPS. Hoy hay **1.200 líneas de servicio Android propio** que capturan y
suben posiciones sin pasar por el WebView, **6 Edge Functions**, **dos crons** y un canal de
notificaciones nativo. El riesgo se movió del JS al borde entre plataformas: las tres piezas más caras
del último mes (multi-cuenta del uploader, canales de notificación, cadencia que no se entrega) fueron
todas de ese tipo, y **ninguna se puede reproducir en el emulador**.

El otro cambio de fondo: **la ventana de rastreo está implementada tres veces** (JS, Java y SQL) y nada
las sincroniza. Es la deuda estructural más silenciosa del proyecto.

### Top 5 riesgos

| # | Riesgo | Impacto | Prioridad |
|---|---|---|---|
| 1 | **El keystore de firma y sus contraseñas viven en un solo disco.** `web/android/app/launion.keystore` + `android/keystore.properties`, ambos fuera de git. ⚠️ **`.claude/keystore.md` NO es un respaldo**: es el volcado de la sesión de `keytool` con los campos del DN — **las contraseñas no están ahí** | Se pierde → ningún APK nuevo se instala como actualización sobre los teléfonos que ya la tienen. Habría que desinstalar+reinstalar uno por uno, perdiendo cola, cuarentena y sesión | 🔴 Crítica · **agravado por la mudanza de PC** |
| 2 | **La ventana de rastreo está en tres lugares sin sincronizar**: `dentroDeHorario()` (JS), `dentroDeVentana()` (Java) y `en_ventana` (SQL de `vigilancia_equipo`) | Tocar una sin las otras no rompe nada visible: hace que los avisos al supervisor **mientan en silencio** | 🔴 Alta |
| 3 | **Objetos vivos que ningún `.sql` versiona** — y creciendo. Confirmado hoy contra la base: `posiciones.bateria`, `perfiles.numero`, `zonas.numero`, `zonas.id_vendedor`, la tabla `ingesta_tokens`, la RPC `mi_token_ingesta`, `ubicaciones_compartidas`, `ultimas_posiciones_compartidas` | Recrear la base desde `db/` produce una base **incompleta** con la que el uploader nativo no puede autenticarse | 🔴 Alta |
| 4 | `npm run build` sin `CAP_BUILD=1` → APK en pantalla blanca, **sin ninguna protección** | Release roto que se detecta recién en el teléfono | 🟠 Media-alta · **vigente desde la rev. 1** |
| 5 | **Cero red de seguridad automatizada.** `lint` es `eslint . \|\| true` (nunca falla) y **no existe archivo de configuración de ESLint** en el repo, así que ni siquiera podría cargar. Cero tests | Cada release se verifica a mano o en la calle | 🟠 Media-alta |

Salieron del top-5 (resueltos): los `.sql` inseguros en el camino de un `psql -f` (movidos a
`db/historico/` el 29/07), el desfase de versiones (alineadas) y el rol `propietario` fuera del
constraint (cerrado por `db/20`).

---

## 2. Arquitectura

### Stack

- **React 19.2** + **Vite 7** + ESM puro. **Tailwind 4 instalado y sin usar** (cero utilidades en
  `web/src/`): el sistema visual real son las CSS custom properties de `web/src/index.css`.
- **`@vitejs/plugin-legacy` + `terser` + `build.target: 'es2015'`** — no es cosmético: es la defensa
  contra las tablets con WebView Chrome 79 que arrancaban en pantalla negra. Ver `.browserslistrc`.
- **Capacitor 6.2**. Plugins: background-geolocation (parcheado), sqlite, filesystem, share, browser,
  app, google-auth, **push-notifications**, **splash-screen**, **status-bar**, capgo/capacitor-updater.
- **Leaflet 1.9** para todos los mapas, **sin React-Leaflet**: la instancia se maneja a mano.
- **@supabase/supabase-js 2.110**. `papaparse` + `xlsx` (lazy) para importación.
- `qrcode` figura en `package.json` y **no tiene un solo import en `web/src/`**: el QR se genera en nativo
  con ZXing (`QrPlugin.java`). Es peso muerto del lockfile.

### Ruteo: no hay router

No existe `react-router`. La navegación es **renderizado condicional por rol + plataforma**.

Orden real de decisión en `AuthedApp` ([src/App.jsx](web/src/App.jsx)):

```
1. rol === 'propietario'          → PropietarioMovil        (APK y PWA: el dueño usa el celular)
2. decidirSupervisionMovil(...)   → SupervisionMovil        (full-screen, APK o ?mobile=1)
3. !nativo && (gestor || encargado-en-panel) → SupervisionDesktop
4. resto                          → AppShell + RoleRouter
```

Y `decidirSupervisionMovil()` hoy es:

```
!nativo                        → false
encargado + vista==='panel'    → true
admin/superadmin               → true      (en la APK no existe más el panel de escritorio)
```

> ⚠️ **El propietario ya NO pasa por `decidirSupervisionMovil()`.** Hasta el 28/07 lo devolvía `true`
> como primera regla, lo que lo mandaba a la pantalla del encargado y dejaba su vista propia
> inalcanzable. El comentario en la función documenta el cambio: no volver a agregarlo ahí.

Pieza nueva: **`rolEfectivo()`** — override de rol por `localStorage['lu-dev-rol']`, envuelto en
`import.meta.env.DEV` para que el tree-shaking lo borre en producción. Es solo de ruteo: las policies
siguen aplicando el rol real.

### 🔴 `AdminView` es inalcanzable

`RoleRouter` termina en `return <AdminView />`, pero **ningún rol llega ahí**: los seis se atienden
antes. El único camino es un `localStorage['lu-encargado-vista']` con un valor corrupto. Con él quedan
muertos `RecorridosView`, `tabs/MapaOperativo` y `components/ReplayJornada`. Además el docstring de
`RoleRouter` todavía dice *"admin / superadmin → panel de escritorio (AdminView)"*, que es exactamente
lo que ya no pasa.

Informe de decisión (revisado 30/07, sin cambios):

| Pantalla | ¿Se puede hacer hoy sin ella? | Veredicto |
|---|---|---|
| `RecorridosView` (140 L) | **Sí, entera.** Subconjunto de `SupervisionDesktop` con los mismos hooks | **Borrar** |
| `MapaOperativo` (145 L) | **Casi.** Lo único sin equivalente es la consola de eventos | **Borrar**, y rehacer la consola donde se use |
| `ReplayJornada` (226 L) | **No.** Reproduce la jornada como película (play/pausa, scrub, 1×–8×, export PNG). No hay nada equivalente vivo | **Rescatar** colgándola de "Menú" (`GestionHost`) |

### Árbol de providers

```
ThemeProvider
└─ DeviceProvider
   └─ AuthProvider
      ├─ ErrorBoundary → Gate
      │                  └─ TenantProvider        ← nuevo (Fase 7 de PLAN_SAAS)
      │                     └─ CatalogProvider
      │                        └─ GpsProvider
      │                           └─ AuthedApp
      ├─ UpdatePrompt
      ├─ DeviceBanner
      └─ SplashIntro (condicional, 1× por día)    ← nuevo
```

`Gate` resuelve: cargando → sin sesión (`LoginView`) → **perfil cargando/errado** (`CargandoPerfil`,
con reintento) → `!aprobado` (`PendienteView`) → app. `aprobado = activo && rol`.

> 🚨 `TenantProvider` va **entre** Auth y Catalog y ese lugar no es casual: tiene que ver el perfil
> (para saber si es superadmin) y quedar por encima de todo lo que lee datos de empresa. Lo que **no**
> puede pasar es que el scope llegue a la escritura de GPS.

### Contextos

| Contexto | Qué posee |
|---|---|
| `AuthContext` | Sesión Supabase + fila de `perfiles`. Google nativo (idToken) y web (OAuth), email+contraseña. Caché de sesión y de perfil offline-first. `signOut` que **primero** cierra el uploader nativo |
| `TenantContext` | **Empresa que se está MIRANDO** (≠ la de identidad). Centinela `TODAS = '*'`, no `null`. Su encabezado es el comentario de seguridad más largo del repo |
| `CatalogContext` | `productos`, `clientes`, `zonas`, `categorias`. Offline-first, mutaciones optimistas por write queue. Arranca **ambas colas** |
| `GpsContext` | Un único watch para roles móviles (`vendedor\|repartidor\|encargado`) + heartbeat + push + alarma + chequeo de update |
| `DeviceContext` | `'mobile' \| 'desktop'` compartido |
| `ThemeContext` | dark/light, clave `launion-theme` (la misma del script anti-FOUC de `web/index.html`) |

### Mapa de features

| Feature | Rol | Nota |
|---|---|---|
| `supervision/SupervisionMovil.jsx` (891 L) | encargado, admin, superadmin en APK | Full-screen, mapa de fondo + chrome flotante glass |
| `supervision/SupervisionDesktop.jsx` (790 L) | gestores en PC | Sidebar + topbar + mapa central. Solo web |
| `propietario/PropietarioMovil.jsx` (672 L) | propietario | Solo lectura. **Los KPIs son reales** (RPC `metricas_actividad`), no placeholders |
| `vendedor/` (8 archivos) | vendedor | 4 tabs; `useJornada.js` concentra todo el estado del día |
| `repartidor/RepartidorView.jsx` (320 L) | repartidor | **Sin datos reales**: espera el módulo de pedidos |
| `admin/` (18 archivos) | admin, superadmin, encargado | Usuarios, Empresas, Zonas, Importar (clientes/productos/fotos), Duplicados, Categorías de rastreo |
| `auth/`, `catalog/`, `perfil/`, `movil/` | — | Login/pendiente, alta de cliente/producto, mi cuenta, permiso "siempre" |

Compartido entre las dos supervisiones (regla 31, y existe porque **ya divergieron dos veces**):
`dwells.js`, `trazos.js`, `animarPin.js` y `components/{BurbujasEquipo,EstadoEquipo,RailMapa,TarjetaPin}`.
La tabla de quién ve qué pantalla de gestión vive en **`web/src/lib/gestion.js`** — un solo lugar desde el
28/07 (cierra el hallazgo #8 de la rev. 2).

---

## 3. Capa PWA

- **vite-plugin-pwa** con `registerType: 'prompt'` — no hay recarga automática; el banner lo maneja
  `UpdatePrompt.jsx`.
- Manifest: nombre `DisT-At`, `standalone`, `portrait`, tema `#0C0C0C`, íconos 192/512 + maskable.
- Workbox: `globPatterns` sobre js/css/html/svg/png/ico/csv/woff2. **Sin `runtimeCaching`** — los tiles
  y las llamadas a Supabase no pasan por el SW; el offline lo resuelven las colas.
- `web/index.html` tiene un **script anti-FOUC inline** que lee el tema de localStorage y setea
  `data-theme` antes del primer render, más un gate de "actualizá el WebView".
- **Deploy**: `.github/workflows/deploy.yml` — push a `main` o manual → Node 20 → `npm ci` →
  `npm run build` (**sin** `CAP_BUILD`, base `/la-union-app/`) → Pages. **Es el único CI del proyecto.**

> ⚠️ **Los canales son independientes.** Publicar una OTA **no** actualiza la PWA, y pushear a `main`
> **no** actualiza el APK.

---

## 4. Capa APK Android

### Configuración Capacitor

`web/capacitor.config.ts`: `appId com.launion.app`, `appName DisT-At`, `webDir dist`. **Sin bloque
`server`**. Comentario explícito: **no** activar `android.useLegacyBridge` — rompe el pipeline de
publicación de posiciones. Plugins configurados: `CapacitorUpdater { autoUpdate: false }` (OTA manual),
`GoogleAuth` (client ID web), `BackgroundGeolocation` (vacío, se configura en los call sites),
`CapacitorSQLite` (sin encriptación) y **`SplashScreen { launchAutoHide: false }`** (lo esconde
`initNativeUI()` cuando React ya tiene contenido).

### Los 14 archivos nativos propios

En `web/android/app/src/main/java/com/launion/app/`. **Escritos a mano, no se regeneran.** `MainActivity`
registra **7** plugins antes de `super.onCreate()`.

| Archivo | L | Qué hace |
|---|---|---|
| `UploaderGpsService.java` | **1.200** | 🔴 **El corazón del GPS hoy.** Foreground service propio: FusedLocation + filtros + POST directo a `ingest-posiciones`, sin pasar por el WebView. WakeLock parcial, anti-churn, triangulación por red, cuarentena nativa y ventana horaria propia |
| `MovimientoPlugin.java` | 265 | Activity Recognition. **`FLAG_MUTABLE` obligatorio en API 31+**: con `FLAG_IMMUTABLE` registra sin error y nunca entrega nada |
| `AlarmWatchdogPlugin.java` | 220 | Watchdog **offline** por `AlarmManager` (~30 min). Complementa al push: funciona sin internet |
| `UploaderGpsPlugin.java` | 204 | Bridge JS→servicio: `configurar({token, url, intervaloMs, startMin, endMin, dias, minMoveM, keepAliveMs, intervaloRapidoMs, velUmbralMps, velHistMs})`, `iniciar`, `detener`, `estado` |
| `ApkUpdaterPlugin.java` | 131 | Descarga el `.apk` de un GitHub Release y lanza el instalador del sistema |
| `BatteryOptimizationPlugin.java` | 120 | Exención de Doze, con fallback a la lista global en OEMs que ocultan el diálogo por app |
| `LaUnionApp.java` | 84 | 🩸 `Application` propia. **Crea los canales de notificación al arrancar**: `avisos` (HIGH) y `actualizaciones` (DEFAULT) |
| `AlarmReceiver.java` | 76 | Receptor de la alarma del watchdog, con WakeLock corto |
| `QrPlugin.java` | 71 | Genera QR con ZXing en nativo (para `InvitarModal`), sin sumar librería al bundle |
| `BootReceiver.java` | 64 | Re-arma el watchdog tras reboot / `MY_PACKAGE_REPLACED`. **Techo honesto documentado: no reinicia el GPS** |
| `MovimientoReceiver.java` | 55 | Receptor de transiciones de AR, **declarado en el manifest** (los dinámicos mueren con el proceso en OEMs agresivos) |
| `LaUnionMessagingService.java` | 49 | Servicio FCM propio que **extiende** al del plugin y llama a `super` |
| `InfoAppPlugin.java` | 41 | Solo lectura: `PackageManager.firstInstallTime` |
| `MainActivity.java` | 37 | `BridgeActivity` + registro de los plugins propios |

### Manifest

Permisos: `INTERNET`, `ACCESS_COARSE/FINE/BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK`,
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `ACTIVITY_RECOGNITION` (+ la variante legacy GMS
`maxSdkVersion=28`), **`RECEIVE_BOOT_COMPLETED`** y **`REQUEST_INSTALL_PACKAGES`** (auto-update).

Declaraciones artesanales: `android:name=".LaUnionApp"`, meta-data
`default_notification_channel_id = "avisos"`, **`UploaderGpsService` con
`foregroundServiceType="location"`**, `AlarmReceiver`, `BootReceiver`, `LaUnionMessagingService` (con
`tools:node="remove"` sobre el del plugin, para ganar el merge) y un `FileProvider` para el instalador.

`MainActivity` es `singleTask` con intent-filter LAUNCHER **y** deep link `com.launion.app://auth`.

### 🩸 Canales de notificación — el bug de 1.10.0

Hasta 1.9.0 la app **no declaraba ningún canal** y las tres funciones mandaban el bloque `notification`
**sin `channel_id`** — a propósito, porque el canal lo creaba `AlarmWatchdogPlugin.notificar()` recién
al notificar, y apuntar a un canal inexistente en Android 8+ hace que la notificación **no se muestre**.
El razonamiento era correcto y la solución no: sin canal por defecto, FCM cae en su canal de reserva
("Miscellaneous"), que no es de importancia alta y que varios OEM silencian de fábrica. Eso explica las
**dos mitades** del "no me llegan las notificaciones y a los usuarios tampoco la de actualizar": los
dos avisos viajan por el mismo camino.

Desde 1.10.0 los canales se crean en `LaUnionApp.onCreate()`. **Pero el parque es mixto**: mandarle
`channel_id` a un teléfono en 1.9.0 lo dejaría mudo, así que se decide por teléfono mirando
`estado_dispositivo.app_version`. Y ojo: **un canal es inmutable una vez creado** — por eso el de los
avisos es nuevo y no se reusó "actualizaciones".

### El patch de background-geolocation

`web/patches/@capacitor-community+background-geolocation+1.2.26.patch` (14 KB), aplicado por
`patch-package` en `postinstall`. Cuatro cosas, todas necesarias:

1. **Expone `interval` / `maxWaitTime` / `priority` a JS.** Upstream hardcodeaba 1 Hz y
   `PRIORITY_HIGH_ACCURACY` para toda la jornada.
2. **Arregla la pérdida de fixes al batchear**: usaba `getLastLocation()` y tiraba los intermedios.
3. **Agrega `updateWatcher(id, …)`** — reconfigura un watcher vivo sin tocar el estado foreground.
   `removeWatcher` + `addWatcher` es *break-before-make*, y en targetSdk 34 rearrancar el FGS desde
   background lanza `ForegroundServiceStartNotAllowedException`, que el plugin **se traga** → tracking
   muerto en silencio.
4. Actualiza los tipos, con la advertencia de que `distanceFilter` mapea a `setSmallestDisplacement`
   (filtra la **entrega**, no la adquisición) y de que `priority: 102` vaciaría los recorridos.

> ⚠️ **`updateWatcher` no mergea opciones.** Pasar siempre el spread completo de
> `OPCIONES_GPS_MOVIMIENTO`.

Relevancia hoy: el patch gobierna la **PWA** y el camino JS. El APK captura por el servicio nativo.

### Build y firma

`web/android/app/build.gradle`: `versionCode 28`, `versionName "1.10.0"`. `minSdk 23 / compile 34 /
target 34` (desde `variables.gradle`). Firma release desde `android/keystore.properties` (gitignored),
keystore `launion.keystore`. Lint desactivado en release porque AGP lint crashea con JDKs nuevos.

Cuatro pins deliberados, todos con el mismo motivo (una dep transitiva que no llega al classpath de
`:app`, o que exigiría subir compileSdk):

- `androidx.work:work-runtime:2.9.1` — Capgo arrastra 2.10, que pediría compileSdk 35.
- `play-services-location` explícito — símbolo `ActivityRecognition`.
- `firebase-messaging` explícito — mismo motivo.
- `com.google.zxing:core:3.5.3` — el QR nativo.

### Los dos scripts de release

```
scripts/ota-release.sh <versión>          scripts/apk-release.sh <versión>
  CAP_BUILD=1 npm run build                 (asume el .apk ya compilado)
  zip de dist/ con Python zipfile           gh release create apk-<v> app-release.apk
  gh release create ota-<v> bundle.zip      imprime el SQL de app_config.apk_url + min_version
  imprime el SQL de bundle_version/url
```

> El zip va con **Python**, no con `Compress-Archive` de PowerShell: PowerShell escribe separadores
> `\` y el unzip de Android no lo acepta.

En el teléfono, `web/src/services/ota.js`: `otaCheck()` compara `app_config` contra
`CapacitorUpdater.current()`; `otaDownload()` descarga y hace `next()`; `otaReload()` aplica y
reinicia. **`otaReady()` → `notifyAppReady()` se llama en `main.jsx`**: si eso falla, Capgo revierte.

---

## 5. Pipeline GPS — la zona más delicada, y la que más cambió

### 5.0 El pipeline REAL de hoy

```
APK (isNative):
  UploaderGpsService.java ──POST──► Edge Function ingest-posiciones ──► tabla posiciones
   (captura + filtros + WakeLock)    (identidad desde el TOKEN DE DISPOSITIVO)
  tracker.js  ─────────────────────► solo telemetría y `last`. NO encola, NO sube.

PWA / web:
  background-geolocation → tracker.procesarFix() → sync/queue.js → upsert → posiciones
```

**El interruptor** es `uploaderNativoActivo` / `setUploaderNativo()` en `tracker.js`: mientras el
servicio nativo corre, `procesarFix()` **no encola**. Lo enciende `services/uploaderNativo.js` al
arrancar el servicio, y en web es no-op.

> 🩸 **Esta es la corrección más importante de esta revisión.** La rev. 2 describía `tracker.js` como
> producción. Alguien podría ajustar sus filtros y no cambiar absolutamente nada en la calle.

**`ingest-posiciones` autentica con token de dispositivo** (tabla `ingesta_tokens`, RPC
`mi_token_ingesta`), no con el JWT: el JWT vence en 1 h y no es accesible desde el servicio nativo.
Saca `id_usuario`, `id_empresa` y `rol` **del token, nunca del punto** — el cliente no puede falsear a
quién pertenece. Idempotente por `client_uid`, `MAX_PUNTOS = 500` por request.

### 5.1 `tracker.js` — módulo NO-React a propósito

El callback nativo dispara con la app en Doze, cuando React está congelado. Por eso el estado es **a
nivel de módulo**, no en hooks. `procesarFix()` filtra por precisión (>30 m fuera), velocidad imposible
(>45 m/s, con tope de `MAX_SALTOS_SEGUIDOS` para no descartar la jornada entera cuando el malo es el
punto de referencia), movimiento mínimo y keep-alive. Actualiza `last` **antes** de encolar.

> Este diseño es el fix documentado de "el GPS moría con la pantalla bloqueada": la persistencia colgaba
> de un `useEffect([pos])` que no corría en background. Sigue siendo la ruta viva de la **PWA**.

### 5.2 `gpsConfig.js` — la única fuente de los umbrales

Los cinco umbrales viajan al servicio nativo por SharedPreferences → **se afinan por OTA, sin APK
nuevo**. Valores al 04/08:

| Constante | Valor | Para qué |
|---|---|---|
| `MIN_MOVE_M` | **9 m** | Gobierna la densidad caminando. No bajar de 9: abajo está el ruido del propio GPS |
| `MIN_MOVE_URBANO_M` / `MIN_MOVE_RUTA_M` | 15 m / 100 m | Guardado por distancia según el modo (1.9.0) |
| `NEAR_LIVE_MS` | **10 s** | Cadencia de captura. Fue a 5 s el 03/08 y **volvió el mismo día** |
| `NEAR_LIVE_RAPIDO_MS` | 5 s | Cadencia en movimiento rápido (auto) |
| `NEAR_LIVE_QUIETO_MS` | 30 s | Con "quieto" confirmado por el acelerómetro |
| `STATIONARY_KEEPALIVE_MS` | **30 s** | Latido de cortesía estando parado |
| `KEEPALIVE_MS` | 90 s | Marcador "vivo" |
| `VEL_UMBRAL_MPS` / `VEL_HIST_MS` | 3 m/s (~11 km/h) / 20 s | Activación e histéresis de la cadencia rápida |
| `VEL_RUTA_MPS` | 11 m/s (~40 km/h) | Desde acá se considera "ruta" |
| `ACCURACY_MAX_M` / `MAX_SPEED_MPS` | 30 m / 45 m/s | Descarte de jitter y de saltos imposibles |
| `ACCURACY_RED_MAX_M` / `SILENCIO_MS` | 150 m / 90 s | Triangulación por antenas cuando el GPS se calla |
| `REPEDIDO_MIN_MS` | 60 s | Piso entre cambios de cadencia (anti-churn) |

> 🩸 **Pedir más seguido ≠ recibir más seguido.** Medido sobre el único teléfono que corrió 1.8.1 con
> 5 s / 2 s: pasó de 0,9 % a **24 %** de huecos de más de un minuto, mientras los otros dos con 1.8.0
> estaban en 0,2 % y 3,8 % el mismo día. La causa: cada `requestLocationUpdates` **reemplaza** el
> request y reinicia la agenda de entrega del proveedor. De ahí salen `REPEDIDO_MIN_MS` y el WakeLock.

### 5.3 `estados.js` — máquina de estados pura

Traduce transiciones de Activity Recognition a reconfiguración del watcher, con histéresis asimétrica.
**El GPS nunca se apaga en reposo**: el plugin tiene un piso de adquisición que no se toca desde JS.
`PRESET_QUIETO` mantiene `priority: 100` y usa `NEAR_LIVE_MS` (10 s) — **no** los 90 s que decía la
rev. 2, que quedaron viejos con el pedido de "casi en vivo" del 24/07.

### 5.4 Las dos colas, la cuarentena y el dueño

| | `sync/queue.js` (posiciones) | `sync/writeQueue.js` (catálogo) |
|---|---|---|
| Clave | `lu-pos-queue` (+ `lu-pos-cuarentena`) | `lu-write-queue` |
| Máx / lote | 8000 / 200 (cuarentena 4000) | 2000 / FIFO |
| Idempotencia | `upsert onConflict:'client_uid' ignoreDuplicates` | `upsert onConflict:'id'`, UUID de cliente |
| Arranque | `startPosQueue()` — inmediato + `online` + `visibilitychange` + 30 s | `startWriteQueue()` — inicio + `online` + 30 s |

Tres piezas que la rev. 2 no tenía y que son las cicatrices más caras del repo:

1. **`CODIGOS_PERMANENTES`.** Un error de la cola puede ser **permanente**, no solo "no hay red". La
   clave es del **dispositivo**, no del usuario: al cambiar de cuenta, los puntos de la anterior fallan
   `posiciones_ins` para siempre y **taponan la cola** (18/07: 264 puntos atascados, 42501 cada 30 s
   durante 8 horas).
2. **🩸 Cuarentena, nunca borrado.** El bundle **1.5.26 borró 264 puntos reales en producción** por
   tratar el descarte como solución. Un punto trabado es recuperable; uno borrado no. Y
   `separarPorDueño()` **los devuelve solos** si esa cuenta vuelve a entrar en el teléfono.
3. **La cola NATIVA también tiene dueño, y el token ES la identidad.** Si el servicio nativo queda
   corriendo con el token de la cuenta anterior, los puntos se escriben a nombre de alguien que no
   estaba ahí, en una tabla **sin policy de UPDATE ni de DELETE**. Incorregible. Tres piezas lo
   sostienen y ninguna es opcional: `signOut()` llama a `cerrarSesionUploader()` (que **borra el
   token** — sin eso `BootReceiver`/`AlarmReceiver` resucitan el servicio cada 30 min con solo verlo),
   `detenerUploaderNativo()` **no** puede tener guard por variable de módulo (vale `false` en cada
   arranque en frío del WebView, justo cuando el servicio sobrevivió), y cada punto se estampa con su
   dueño **al capturar**, no al subir.

> ⚠️ **Ninguna de las dos colas debe gatearse con `navigator.onLine`.** El WebView reporta offline
> estando conectado y eso bloqueaba **todas** las subidas. El trigger de `visibilitychange` es el
> despertar crítico: en background los WebViews congelan timers y eventos `online`.

### 5.5 🩸 El recorrido crudo miente

El uploader nativo **no filtra teleports** (`tracker.js` sí, pero ese camino ya no es el que está en la
calle), así que en la base hay saltos imposibles. Medido el 29/07: un vendedor con cuatro fixes que
alternan entre dos lugares a **127 km**, con precisiones de 21 y 29 m — el filtro de precisión no los
puede cazar. Su día figuraba con **524,8 km**; el real fueron **17,9**.

**Todo lo que dibuje o mida un recorrido tiene que pasar por `limpiarTrazo` (`lib/geo.js`) vía
`features/supervision/trazos.js`.** Nunca por `byUser` crudo. Ahí también vive `simplificarTrazo` (RDP
ε = 7 m) para las jornadas de ~11k puntos.

### 5.6 Triangulación por red (1.9.0)

Con el GPS callado más de 90 s, el teléfono pide ubicación por antenas y WiFi. Esos puntos entran a
`posiciones` con `accuracy` de 20 a 150 m, y **la precisión ES la marca** (hasta 1.8.1 no existía un
solo punto con accuracy > `ACCURACY_MAX_M`, así que no hizo falta columna nueva). Valen para "por acá
anduvo" y para nada más: van punteados, **fuera de los km, fuera del snap y fuera de la burbuja en
vivo** (`ultimas_posiciones()` los filtra, `db/28`). Cambiar un hueco honesto por una línea inventada
es el mismo error que cometía el snap.

### 5.7 Puerto de persistencia

`services/persistence/index.js`: localStorage en web, SQLite (tabla `kv`) en nativo. **Timeout de 5 s
en cada operación** y fallback a localStorage tanto en init como por operación — un `await` colgado de
SQLite congelaba la cola de GPS de forma permanente.

### 5.8 Dependencia de la DB

Toda la cadena depende de que `posiciones_client_uid_uidx` sea un índice **único completo**. Un índice
**parcial** rompe `upsert(onConflict:'client_uid')` con error **42P10** y se cae todo el GPS en
silencio. Costó dos rebuilds del APK persiguiendo un bug que estaba en la base.

> **Síntoma diagnóstico**: si `estado_dispositivo` sube pero `posiciones` no, **no es la red ni la
> sesión** — las dos usan la misma. Mirar `cola_pendiente` y los logs de Postgres.

---

## 6. Backend Supabase

### Modelo de datos (20 tablas, verificado en la base viva)

| Tabla | Notas |
|---|---|
| `empresas` | Tenant. `activo` es la palanca de suscripción — ⚠️ **no gatea nada hoy** |
| `perfiles` | id (=auth.users.id), rol, activo, id_empresa, `color_trazo`, `foto_url`, **`permisos text[]`**, `numero`* |
| `clientes` | `codigo` UNIQUE **global** (⚠️ ver §8), lat/lng, dias_visita, geofence_radio, id_zona, id_vendedor, `archivado_ts` |
| `productos` | codigo UNIQUE, precio, peso, categoria, `imagen_url`, `unidades`, `nivel_rentabilidad`, `oferta` |
| `zonas` | nombre, color, `numero`*, `id_vendedor`* |
| `categorias` | Categorías de catálogo por empresa |
| `posiciones` | **`client_uid` UNIQUE**, accuracy, `bateria`*. **Sin policy de UPDATE ni de DELETE** — una fila mal escrita es incorregible |
| `visitas` | Check-in/check-out por comercio. RLS espejo de `posiciones` |
| `rutas` | fecha, objetivo, orden_paradas jsonb |
| `estado_dispositivo` | 35 columnas: salud del teléfono + telemetría de captura (`fix_*`, `gps_*`), `fcm_token`, `aviso_version`, `cuarentena_nativa` |
| `categorias_rastreo` + `perfiles_categorias_rastreo` | Horarios de rastreo particulares, **varias por persona** (semántica de unión, jornada partida) |
| `alertas_equipo` | Incidentes abiertos/cerrados. Índice único parcial como antirrebote |
| `ingesta_tokens` | 🔴 **Token de dispositivo del uploader nativo. Sin `.sql` que la versione** |
| `ubicaciones_compartidas` | 🔴 Compartir ubicación con otra empresa. **Sin `.sql`** |
| `app_config` | Singleton: versiones, `apk_url`, `bundle_url`, ventana de rastreo (`track_*`), alertas, teléfono de soporte |
| `app_config_historial` | Auditoría de cambios de `app_config` |
| `recorridos_snap` | Caché de la Edge Function, unique (id_usuario, fecha) |
| `pedidos` / `pedido_items` | 🟢 **Sin consumidor en `web/src/` y 0 filas.** Superficie muerta |

`*` = vivo pero **sin versionar en ningún `.sql`**.

### Migraciones `db/07` → `db/29`

| Archivo | Qué hace |
|---|---|
| `07_diagnostico_auditoria` | `estado_dispositivo.cuarentena_pendiente` + `gps_error`; tabla `app_config_historial` |
| `08_catalogo_visual` | Catálogo visual de `productos` + `perfiles.foto_url` + buckets |
| `09_categorias` | Tabla `categorias` por empresa |
| `10_storage_select` | 🩸 La policy de **SELECT** que faltaba: sin ella el `upsert` fallaba y **ninguna subida a Storage funcionó jamás** |
| `11_apk_version` | `estado_dispositivo.apk_version` (nativa, distinta del bundle OTA) |
| `12_color_trazo` | `perfiles.color_trazo` (NULL = color por hash) |
| `13_track_days` | `app_config.track_days int[]` (1=Lun…7=Dom) |
| `14_instalado_ts` | Fecha real de instalación del APK |
| `15_retencion_posiciones` | Índice `posiciones_ts_idx` + cron de poda a 60 días |
| `16_visitas` | Tabla `visitas` (check-in/out), id de cliente, RLS espejo de `posiciones` |
| `17_reclamar_ubicar_cliente` | RPC `reclamar_y_ubicar_cliente` — el vendedor reclama y geolocaliza un comercio sin dueño |
| `18_categorias_rastreo` | Tabla `categorias_rastreo` + `perfiles.id_categoria_rastreo` |
| `19_estado_plan` | RPC `estado_plan()`, solo superadmin: tamaño de base, volumen, conteos |
| `20_propietario_rol` | **Agrega `propietario` al `perfiles_rol_check`** |
| `21_metricas_actividad` | RPC `metricas_actividad(desde, hasta)`: agregado km/paradas por (día, usuario) |
| `22_clientes_archivado` | `clientes.archivado_ts` — archivar sin liberar el `codigo` |
| `23_perfiles_permisos` | **`perfiles.permisos text[]`** + RPC `mis_permisos()` + policy `productos_wr` |
| `24_telefono_soporte` | Teléfono de soporte por empresa y global |
| `25_storage_scope_empresa` | 🔴 Cierra el agujero: las policies de escritura de Storage eran `to authenticated` mirando solo el `bucket_id` → cualquier empresa podía borrar las fotos de otra |
| `26_alertas_equipo` | Función `vigilancia_equipo()` + tabla `alertas_equipo` + el índice antirrebote + config de alertas |
| `27_horarios_multiples_y_telemetria` | Tabla puente de horarios + telemetría `fix_*` + `fix_dueno` / `cuarentena_nativa` |
| `28_ultimas_posiciones_solo_gps` | Redefine `ultimas_posiciones()` para excluir los puntos triangulados de la burbuja en vivo |
| `29_telemetria_190_y_notif` | `gps_intervalo_ms`, `gps_repedidos`, `gps_silencio_max_ms`, `gps_fixes_red`, `notif_permiso`, `aviso_version` |

### Las 6 Edge Functions

| Función | Qué hace |
|---|---|
| `snap-recorridos/` | Recorridos pegados a calles. **Un motor por modo**: `routed-foot` a pie, `routed-car` en vehículo (`splitModo`). Ver §6.1 |
| `ingest-posiciones/` | Ingesta del uploader nativo con token de dispositivo (§5.0) |
| `crear-usuario/` | Alta de usuarios con `service_role` server-side, validando el JWT del que llama y sin permitir escalada de rol ni cruce de empresa |
| `push-heartbeat/` | Watchdog por FCM cada ~30 min (data-only silencioso), ventana 6–22 hora Salta. **Borra tokens muertos** ante 404/`NotRegistered` |
| `push-actualizacion/` | Aviso de versión nueva con la app cerrada. Desde 1.10.0 lo llama un cron horario y se sella con `estado_dispositivo.aviso_version` → un aviso por teléfono y por versión |
| `alertas-equipo/` | Cron cada 10 min: abre/cierra incidentes (`sin_reportar`, `quieto`) y manda push. **No detecta nada**: la detección vive en SQL |

### 6.1 `snap-recorridos` — cuatro lecciones caras

1. **No usa `/match`.** El host público lo rechaza por tamaño: `TooBig` medido con 20 puntos.
   Habilitarlo requiere OSRM propio.
2. **El motor se elige por MODO** (ALGO 8). Medido sobre el mismo rastro real: en un tramo de ruta el
   perfil auto da ×1,003 del crudo y el peatón ×57; en un tramo a pie el peatón da ×1,48 y el auto
   ×4,5. La guarda anti-detour es la red por si el modo se equivocó, no el mecanismo.
3. **El modo se decide por TRAMO, no hop por hop** (ALGO 8-bis): decidirlo punto a punto daba 15 tramos
   para un viaje de 10 minutos, y a 16 km/h elegía el motor de auto.
4. 🩸 **No se rutea evidencia que no se tiene** (ALGO 9). Con "Calles" prendido, el trazo medía
   **×1,63 · ×1,48 · ×1,75** el crudo en tres vendedores: entre el 48 % y el 75 % lo estaba inventando
   OSRM, y eso era el "zigzag" que reportó el cliente. **La guarda mide TIEMPO, no distancia**: la
   primera versión miraba la separación mediana en metros y no habría atajado ni un caso (la mediana
   del día es 7,8 m, porque los racimos de cuando está parado la hunden). Calibración sobre los cuatro
   teléfonos del día (80,6 % · 23,3 % · 9,0 % · 0,4 % del largo a ciegas): el umbral de 35 % deja pasar
   a los tres que andan bien y frena al que falla. Ver `fraccionCiega` en `segmentar.ts`.

Pipeline: auth del usuario → verifica `perfiles.activo` → cliente service-role lee `posiciones` y el
caché → `splitGaps` → `isStationary` (mediana < 40 m) → `promediarRacimos` → `thin` → `cap` →
`routeSeg` (timeout 5 s, User-Agent obligatorio por política de FOSSGIS). **No cachea si algún segmento
falló.** Aparta los puntos triangulados y devuelve `km.{crudo, pegado}` por persona.

> ⚠️ Y la lección transversal: **una guarda que nunca actúa no es una guarda.** El anti-detour ×2,5 de
> la rev. 2 no rechazaba nada.

### Roles y permisos

Constraint en la DB: `superadmin | admin | encargado | vendedor | repartidor | propietario` — los seis,
`propietario` incluido desde `db/20`.

**Los roles son EXCLUYENTES** (`RoleRouter` es un if/else). Para dar una capacidad extra sin cambiar lo
que la persona *es*, va por **`perfiles.permisos text[]`**, no por un rol nuevo: un vendedor con
`'catalogo'` sigue siendo vendedor —conserva GPS, jornada y su lugar en el mapa— y además edita el
catálogo. `encargado` sigue siendo dual: se lo trackea **y** supervisa.

Gating en cuatro capas: DB (RLS, autoritativa) → `decidirSupervisionMovil()` → **`web/src/lib/gestion.js`**
(un solo lugar) → reglas de negocio (un cliente creado por rol móvil nace `activo = false`).

### Seguridad SQL — tres reglas y un incidente

1. **El índice de `client_uid` jamás parcial** (§5.8).
2. **`revoke execute … from public`, nunca *solo* `from anon, authenticated`.** Postgres concede EXECUTE
   a PUBLIC por defecto; anon y authenticated lo heredan de ahí, así que revocar solo de ellos es un
   **NO-OP**.
3. 🩸 **Pero en una función NUEVA hay que revocar de los TRES.** Supabase tiene un
   `ALTER DEFAULT PRIVILEGES` que da EXECUTE **explícito** a `anon` y `authenticated` sobre cada función
   creada en `public`, y un grant explícito **no** se va con un revoke a PUBLIC. Medido el 30/07:
   después del `revoke … from public`, `vigilancia_equipo` (SECURITY DEFINER, cruza empresas) seguía con
   `anon=X | authenticated=X` — **cualquier vendedor logueado podía leer el plantel completo de todos
   los tenants**, con nombres, roles y coordenadas. Receta: revocar de los tres + `grant to
   service_role` + **verificar el ACL real** con `select proacl from pg_proc`.

Y el contrapunto: **nunca** revocar EXECUTE de `mi_empresa` / `mi_rol` / `es_admin` / `es_superadmin` —
las políticas RLS los invocan como el rol que consulta; revocarlos rompe **todas** las lecturas
protegidas.

**Verificación del 04/08 (`pg_proc.proacl`):** `vigilancia_equipo` y `limpiar_posiciones_viejas` están
correctamente limitadas a `service_role`. `estado_plan()` es ejecutable por `authenticated` **pero
levanta excepción 42501 si no es superadmin**; `mi_token_ingesta()` es ejecutable por `anon` **pero
falla sin `auth.uid()` con perfil y empresa**. O sea: los 24 WARN de advisors sobre SECURITY DEFINER
son **falsos positivos verificados uno por uno**.

**El único advisor real:** `auth_leaked_password_protection` está **desactivado** — Supabase puede
rechazar contraseñas comprometidas contra HaveIBeenPwned y hoy no lo hace. Es una casilla del panel y
es especialmente relevante porque las contraseñas iniciales las elige un admin.

### RLS y multi-tenant

`clientes`, `posiciones`, `zonas`, `visitas` correctamente aisladas por `id_empresa` (+
`es_superadmin()`). **RLS no filtra para el superadmin**: toda lectura necesita su `.eq('id_empresa')`
explícito. Con **2 empresas** en la base, esto dejó de ser hipotético.

`perfiles` (verificado hoy):

- `perfiles_sel` — `id = auth.uid()` OR superadmin OR (admin/encargado/propietario de la misma empresa).
- `perfiles_upd` — **solo** superadmin o admin de la empresa. **No hay policy de INSERT y no hay
  self-update.**
- El trigger `handle_new_user` inserta `rol = null, activo = false`.

> **Consecuencia útil para el pendiente del login:** un usuario **no puede** autoasignarse rol, empresa
> ni `activo`. Abrir el alta de cuentas no crea una vía de escalada. Esto era la duda que bloqueaba la
> decisión de producto; queda contestada.

### Realtime

- `suscribirPosiciones` — canal `rt-posiciones`, INSERT en `public.posiciones`. **El aislamiento lo hace
  RLS, no un filtro.**
- `publicarAlerta` / `suscribirAlertas` — canales **broadcast** por empresa, efímeros, sin tabla.
- `sync/index.js` es un `BroadcastChannel` **local** entre pestañas — nada que ver con Supabase.

### Automatización en la base

`pg_cron` + `pg_net` sostienen: poda de `posiciones` a 60 días, `push-heartbeat` (~30 min),
`alertas-equipo` (10 min) y `push-actualizacion` (horario). Al invocar por `net.http_post` hay que pasar
`timeout_milliseconds` explícito: **el default de 5 s de pg_net no alcanza**.

---

## 7. Credenciales y vencimientos

| Credencial | Dónde vive | ¿Pública por diseño? | Riesgo real | Rotación |
|---|---|---|---|---|
| **Keystore de firma** | `web/android/app/launion.keystore` + `android/keystore.properties` (ambos gitignored) | **NO — secreto crítico** | **Máximo. Si se pierde el archivo *o* las contraseñas, no se puede volver a actualizar el APK. Nunca** | **Imposible.** Ver §7.1 |
| **`FCM_SERVICE_ACCOUNT`** | Secret de Supabase Edge Functions | **NO — clave privada de cuenta de servicio de Google** | **Alto.** Permite mandar push a todo el parque en nombre de la app | Consola de Google Cloud |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Secret de Edge Functions (`Deno.env`) | **NO** | **Alto**: saltea RLS por completo | Panel de Supabase |
| **Supabase anon** | `.env.local`, `.env.production` | Sí — publishable, la protección es RLS | Bajo (mientras RLS esté sana) | Panel de Supabase |
| **Google OAuth Web Client ID** | `web/capacitor.config.ts`, `AuthContext.jsx` | Sí, público por diseño | Nulo | GCP |
| **`google-services.json`** | `web/android/app/`, **commiteado a propósito** | Sí — config de cliente Android, viaja dentro del APK | Bajo: está restringida por package + SHA de firma | Consola de Firebase |
| **Stadia Maps** | `web/src/services/maps/basemap.js` — **hardcodeada y commiteada** | Clave de navegador (va al bundle igual), protegida por dominios | **Bajo-medio.** Si vence, solo dejan de cargar Oscuro y Satélite; OSM sigue | Ver §7.2 |
| `VITE_GOOGLE_MAPS_API_KEY` | `.env.local` | — | **Ninguno: nadie la lee.** Google Maps es código muerto | Se puede borrar |

> ⚠️ **Dos credenciales están hardcodeadas en el código, no en `.env`.** No asumir que todos los
> secretos viven en variables de entorno.

**Higiene verificada (04/08):** grep de `service_role`, `SERVICE_ROLE` y prefijos de JWT sobre `web/src/`,
`scripts/` y `.github/` da **un solo hit, y es un comentario**. Las funciones leen el service role de
`Deno.env`.

### 7.1 🔴 El keystore — corrección importante

`CLAUDE.md §8` y los documentos anteriores dan por sentado que `.claude/keystore.md` es el respaldo de
las credenciales de firma. **Lo verifiqué: no lo es.** Ese archivo es el volcado de la sesión de
`keytool` — la ayuda de opciones y las respuestas del DN (nombre, unidad, organización, ciudad,
provincia, país) — y **las contraseñas no aparecen**, porque se tipearon en un prompt que no las
imprime.

Estado real hoy: **`android/keystore.properties` es la única copia existente de `storePassword`,
`keyPassword` y `keyAlias`**, y está fuera de git, en un solo disco, en la máquina que se está por
migrar.

Antes de mover nada: contraseñas a un gestor, `.keystore` a dos lugares privados distintos, y probar
en la máquina nueva que `assembleRelease` firma antes de dar la mudanza por terminada.

### 7.2 La key de mapas

**No hay ninguna key de Google Maps en uso.** `web/src/services/maps/index.js` declara que el port quedó
fuera de uso; del módulo solo sobrevive `CENTRO_DEFECTO` (Las Lajitas, Anta, Salta).
`GUIA_API_KEY_GOOGLE_MAPS.md` está obsoleta y `README.md` menciona un componente `GoogleMap` que **no
existe**.

La única key real es la de **Stadia**, y degrada bien: `stadiaUsable()` oculta esas capas cuando no hay
key (salvo en localhost, donde Stadia funciona keyless). **Sin key la app no se rompe: se queda con
OSM.**

Fix propuesto (listo, no aplicado): mover a `VITE_STADIA_KEY`, agregarla a los tres `.env` y como secret
del workflow (si no, la PWA de Pages pierde esas capas), registrar los orígenes en el panel — el de
Pages **y** el del WebView de Capacitor, que es `https://localhost` (**verificar**: es lo que puede
hacer que anden en la PWA y no en el APK) — y **rotar la actual**, que está en el historial de git y hay
que considerar quemada.

> Mover a env **no la vuelve secreta**: toda `VITE_*` termina en el bundle público. El beneficio es
> poder rotarla sin tocar código. La protección efectiva es y seguirá siendo el allowlist de dominios.

### 7.3 Servicios sin key en camino crítico

`web/src/services/routing/index.js` usa el **servidor demo público de OSRM** para `/route`, `/trip` (TSP) y
`/match`. Sin key, sin SLA, con política de uso justo. La Edge Function usa FOSSGIS, otro host — pero
ahora con **dos perfiles** (`routed-foot` y `routed-car`), así que la dependencia de hosts públicos
gratuitos **creció**. El comentario del módulo señala que es **el único punto de swap**.

---

## 8. Deuda técnica y riesgos

### Los 12 hallazgos de la rev. 2, re-evaluados

| # | Hallazgo | Estado |
|---|---|---|
| 1 | `db/02_saas.sql` y `05_schema_real.sql` reabren agujeros si se re-aplican | ✅ **Resuelto** (29/07): movidos a `db/historico/` con un `LEER_ANTES_DE_TOCAR.md` |
| 2 | Versiones desfasadas | ✅ Resuelto — pero la tabla de `CLAUDE.md §6` **se volvió a desincronizar dos veces** (decía 1.6.0, después 1.8.0; real 1.10.0). Ver #13 |
| 3 | Rol `propietario` fuera del constraint | ✅ **Resuelto** de punta a punta (`db/20` + `UsuariosView` + `crear-usuario`) |
| 4 | Columnas vivas sin versionar | 🔴 **Vigente y peor**: las 4 originales siguen, y se sumaron `ingesta_tokens`, `mi_token_ingesta`, `ubicaciones_compartidas`, `ultimas_posiciones_compartidas` |
| 5 | `npm run build` sin `CAP_BUILD=1` → pantalla blanca | 🔴 **Vigente**: sigue sin existir `build:apk` |
| 6 | Docs obsoletas | 🔴 **Vigente**: `README.md`, `GUIA_APK_ANDROID.md` y `GUIA_API_KEY_GOOGLE_MAPS.md` sin sanear |
| 7 | `lint` que nunca falla; cero tests | 🔴 **Vigente y peor**: además **no hay archivo de config de ESLint** en el repo |
| 8 | Tabla de permisos de menú duplicada | ✅ **Resuelto**: extraída a `web/src/lib/gestion.js` (28/07) |
| 9 | OSRM demo público en camino crítico | 🔴 **Vigente y con más superficie** (§7.3) |
| 10 | `pedidos`/`pedido_items`/`firmas` con RLS pero sin consumidor | 🔴 **Vigente**: 0 filas, y `firmas_ins` sigue `to authenticated` sin alcance |
| 11 | Key de Stadia commiteada | 🔴 **Vigente**: ni movida ni rotada |
| 12 | `.env.local` y `.env.production` con sets distintos | 🔴 **Vigente** |

**Marcador: 3 resueltos · 1 resuelto con secuela · 8 vigentes, 2 de ellos peores que en julio.**

### Hallazgos nuevos de esta revisión

| # | Hallazgo | Impacto | Fix propuesto |
|---|---|---|---|
| 13 | **La tabla de versiones de `CLAUDE.md §6` se desincroniza en cada release** (3 de 3 veces) | 🟠 El documento que más se lee miente sobre la versión | Sumar el paso a la receta de release, o generar la tabla desde `version.js` |
| 14 | **La ventana de rastreo, implementada 3 veces** sin nada que las sincronice | 🔴 Los avisos al supervisor mienten en silencio | Una sola fuente: el SQL es el candidato natural (se verifica con un `select`) |
| 15 | **`AdminView` inalcanzable** y con él 3 vistas muertas (511 líneas) | 🟠 Código que nadie ejecuta y que confunde a quien lo lee | Borrar `RecorridosView` y `MapaOperativo`; **rescatar `ReplayJornada`** colgándola de "Menú" |
| 16 | **`clientes_codigo_key` es `UNIQUE (codigo)` GLOBAL**, no por empresa | 🟠 Dos distribuidoras no pueden usar el mismo código de cliente. **Con 2 empresas vivas ya es un problema real** | `UNIQUE (id_empresa, codigo)` |
| 17 | **`ingesta_tokens` sin `.sql`**, y la Edge Function referencia un `db/16_ingesta_tokens.sql` **que no existe** (`db/16` es `visitas`) | 🔴 Recrear la base deja el uploader nativo sin poder autenticarse | Versionarla contra la base viva |
| 18 | **`posiciones` no tiene policy de UPDATE ni de DELETE** | 🟠 Por diseño (evita borrar rastro), pero convierte cualquier escritura errónea en permanente | Documentado; que toda vía de escritura lo sepa |
| 19 | **`getAccessToken` de FCM está copiado 3 veces** entre las funciones de push | 🟡 La cuarta copia va a divergir | `supabase/functions/_shared/fcm.ts` |
| 20 | **`SupervisionMovil` y `SupervisionDesktop` no comparten una línea** (1.681 líneas entre las dos) | 🟠 **Ya divergieron dos veces** | Seguir extrayendo a `features/supervision/` como se hizo con `dwells`, `trazos` y `components/` |
| 21 | **Protección de contraseñas filtradas desactivada** en Supabase Auth | 🟡 Contraseñas iniciales elegidas por un admin, sin chequeo contra HaveIBeenPwned | Una casilla del panel |
| 22 | **Comentario obsoleto** en `MetricasEquipo.jsx`: *"Cuando exista la tabla `visitas`…"* — existe desde `db/16` | 🟢 Ruido | Actualizar |
| 23 | **`qrcode` en `package.json` sin un solo import** | 🟢 Peso muerto | Quitar |

### La deuda que no es una tarea

- **Ninguna de las tres fallas más caras del último mes se puede reproducir en el emulador.** Multi-cuenta
  del uploader, canales de notificación y cadencia no entregada se verifican en la calle, con consultas
  contra la base. El emulador sirve para interfaz y para FCM, y nada más (no tiene GPS real, ni Doze, ni
  killers de OEM).
- **El módulo de pedidos está a mitad de camino desde el principio**: `pedidos`, `pedido_items`, el
  bucket `firmas` y `RepartidorView` (320 L) existen y no se usan. Hay que decidir: arrancarlo o
  retirarlo.
- **Cero tests, con dos precedentes que duelen**: los tests de 1.5.26 pasaron 9/9 y aun así el cambio
  **destruyó 264 puntos reales**, porque probaban que el borrado ocurriera y no si correspondía. La
  invariante de una cola es "no se pierde ni un punto", no "el descarte funciona".

---

## 9. Checklist priorizado

### 🔴 Hacer ya

- [ ] **Respaldar el keystore ANTES de migrar de PC** — contraseñas a un gestor, `.keystore` en dos
      lugares privados. Y corregir la creencia de que `.claude/keystore.md` lo respalda (§7.1).
- [ ] **Versionar `ingesta_tokens` + `mi_token_ingesta`** (#17) — hoy la base no se puede recrear.
- [ ] **Unificar la ventana de rastreo** (#14) o, como mínimo, dejar el enlace de las tres
      implementaciones documentado en las tres.
- [ ] Cerrar el **circuito de recuperación de contraseña**, que hoy está roto en producción: el botón
      manda el mail y no existe pantalla donde poner la nueva. Ver [HANDOFF.md](HANDOFF.md).

### 🟠 Próximo sprint

- [ ] Script `build:apk` con `CAP_BUILD=1` incorporado (`cross-env` por Windows).
- [ ] Versionar las 4 columnas restantes + `ubicaciones_compartidas` y su RPC.
- [ ] `UNIQUE (id_empresa, codigo)` en `clientes` (#16) — con 2 empresas ya muerde.
- [ ] Decidir `AdminView` (#15): borrar dos vistas, rescatar `ReplayJornada`.
- [ ] Rotar la key de Stadia y moverla a `VITE_STADIA_KEY` + secret del workflow (§7.2).
- [ ] Sanear `README.md` y `GUIA_APK_ANDROID.md`; marcar `GUIA_API_KEY_GOOGLE_MAPS.md` como obsoleta.
- [ ] Config de ESLint + quitar el `|| true` (#7).
- [ ] Prender la protección de contraseñas filtradas (#21).
- [ ] `_shared/fcm.ts` (#19).

### 🟡 Cuando haya aire

- [ ] Tests de las funciones puras: `dwell.js`, `estados.js`, `format.js`, `geofence.js`, `geo.js`,
      `segmentar.ts`. **Empezar por `segmentar.ts`**: está separada justamente para poder probarse sin
      Deno ni Supabase.
- [ ] Seguir extrayendo lo común de las dos supervisiones (#20).
- [ ] Decidir el futuro de `pedidos`/`pedido_items`/`firmas`.
- [ ] Borrar `VITE_GOOGLE_MAPS_API_KEY`, el port muerto de Google Maps y la dep `qrcode`.
- [ ] Evaluar alternativa a OSRM demo público (habilitaría `/match`, que es mejor algoritmo que
      `/route` para pegar un rastro a las calles).

---

## 10. Lo que está bien y no hay que tocar

El instinto de "limpiar" acá rompe cosas caras.

**De la rev. 2, todo sigue vigente:** los comentarios largos con fechas y números de bug (son la memoria
del proyecto); `tracker.js` siendo no-React; el lock custom de `supabase.js` que reemplaza
`navigator.locks` (el WebView colgaba `getSession()` para siempre); `hoyStr()` y sus usos —nunca volver
a `toISOString().slice(0,10)`, que devuelve UTC y de 21:00 a 24:00 mostraba el mapa vacío—; los guards
con timeout del puerto de persistencia; los pins de gradle; `Fila` a nivel de módulo en `UsuariosView`;
el zip con Python.

**Y lo que se ganó entre 1.6.4 y 1.10.0:**

- **La cuarentena de la cola** y `separarPorDueño()`. Nunca volver a borrar un punto.
- **`cerrarSesionUploader()` sin guard por variable de módulo**, y el dueño estampado al capturar.
- **`isolation: isolate` en `LeafletMap`**: Leaflet asigna z-index de hasta 1000 y las esquinas de
  controles no viven dentro del pane transformado. Sin el `isolate`, todo el chrome por debajo de 1000
  queda tapado. Toda la escala `--z-*` depende de esto.
- **`pointerEvents: 'none'` en los contenedores de overlays sobre el mapa**, con `'auto'` solo en las
  piezas que se tocan. Un contenedor absoluto con `left`/`right` fijos ocupa todo el ancho aunque su
  contenido mida 40 px y se traga los toques en esa franja.
- **El índice único parcial como antirrebote de alertas** — el dedupe vive en el índice, no en la
  función.
- **El pin animado comparado contra el último destino MANDADO**, nunca contra `getLatLng()` (que a mitad
  de animación devuelve el fotograma actual).
- **La red de contención de `visibilitychange`** para las animaciones por rAF: con el documento oculto
  `requestAnimationFrame` **no dispara** (medido: cero frames en 500 ms), y dejar el pin congelado en un
  lugar por el que la persona ya pasó es peor que no animar.
- **El WakeLock parcial y el anti-churn del servicio nativo**, y `REPEDIDO_MIN_MS`.
- **Los canales de notificación decididos por `app_version`** mientras el parque sea mixto.
- **`Overlay.jsx` como primitiva única.** Trae animación de salida, Escape, scroll-lock con contador,
  ARIA y foco. No escribir uno a mano.
- **La pila de `services/atras.js`** para el botón atrás, y `minimizeApp()` en vez de `exitApp()`:
  `exitApp()` mata el proceso y con él el foreground service.

---

## 11. Bitácora 1.6.4 → 1.10.0

Lo que entró después de la revisión anterior. La tanda "premium" 1.6.x que la rev. 2 listaba como *en
curso* se entregó **completa** (`db/16`–`db/21`), y después vinieron nueve releases más.

| Versión | Qué entró |
|---|---|
| **1.6.4** | Tanda premium A/B/C/D/F: enfoque de recorrido, métricas reales por usuario (km y tiempo de parada), check-in con captura de ubicación del cliente, categorías de rastreo, panel de estado del plan. Auto-login offline. Notificación de actualización |
| **1.6.5** | GPS parado a 30 s + **auto-arranque del rastreo al horario con la app cerrada** |
| **1.6.6** | **Cadencia adaptativa por velocidad** |
| **1.6.7** | **Rol propietario con pantalla propia** · modo inmersivo · archivado de clientes · revisar duplicados · **permisos por perfil** |
| **1.6.8** | Login v1.4 · mapa más liviano (`simplificarTrazo`) · **cierre del agujero de Storage entre empresas** (`db/25`) |
| **1.6.9** | 🩸 **"El recorrido deja de mentir"** (`limpiarTrazo`) · carteles de parada tocables |
| **1.7.0** | **Alertas de equipo**: detección en SQL, push por Edge Function, campanita en la app · mapa operable |
| **1.8.0** | 🔴 **Fix del token multi-cuenta** · punto retenido al retomar marcha · Activity Recognition alimentando al nativo · telemetría de descartes · **horarios múltiples por persona** · seguimiento animado |
| **1.8.1** | Animación del pin (destino, no `getLatLng`) · chrome del inmersivo · **snap por modo** (ALGO 8) |
| **1.9.0** | **Guarda de tramo a ciegas** (ALGO 9) · **captura nativa con WakeLock + anti-churn** · **triangulación por red** · guardado por distancia según modo |
| **1.10.0** | 🩸 **Canales de notificación** (los push no llegaban) · resumen horario del equipo · snap sin trocear · aviso de actualización por cron · un token FCM null ya no pisa al bueno |

**Transversal, sin release propio:** multi-tenant de lectura (`TenantContext` + selector de empresa),
QR de invitación nativo, auto-update del APK, compartir ubicación con otra empresa, botón atrás con pila
propia, sistema de `Overlay`, `SplashIntro`, barra de estado nativa, importación masiva de fotos y
productos, gestión de categorías y edición de cliente por el vendedor.
