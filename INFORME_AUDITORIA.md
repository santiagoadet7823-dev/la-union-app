# Informe de auditoría — DisT-At (PWA + APK Android)

> Fecha: 18/07/2026 · Versión auditada: `APP_VERSION 1.5.25` · Repo: `santiagoadet7823-dev/la-union-app`
> Documento de **referencia**. Las reglas operativas del día a día están en [CLAUDE.md](CLAUDE.md).

---

## 1. Resumen ejecutivo

**DisT-At** (`com.launion.app`) es un SaaS logístico multi-tenant de seguimiento GPS de equipos en
calle. Un mismo código React se despliega por **dos canales completamente independientes**:

| Canal | Artefacto | Cómo se actualiza | Base de assets |
|---|---|---|---|
| **PWA** | GitHub Pages | push a `main` → workflow → Pages + Service Worker | `/la-union-app/` |
| **APK** | Android/Capacitor | OTA de Capgo (`bundle.zip` en GitHub Releases + fila en `app_config`) | `./` (requiere `CAP_BUILD=1`) |

Backend: **Supabase** (Postgres + RLS + Auth Google + Realtime + 1 Edge Function). Mapas: **Leaflet
sobre OSM** (sin key) con dos capas opcionales de **Stadia**. Ruteo: **OSRM público** (sin key).

### Estado general

El proyecto está **notablemente bien documentado a nivel de comentarios**. Prácticamente cada guarda
defensiva en el código explica el bug de producción que la originó, con fecha. Esa es la mayor
fortaleza del repo y la razón por la que este informe existe: ese conocimiento estaba disperso en
comentarios y no había ningún `CLAUDE.md` que lo consolidara.

La arquitectura del pipeline GPS es sólida y muestra cicatrices de batalla bien curadas (módulo
no-React para sobrevivir a Doze, colas idempotentes, puerto de persistencia con timeouts y fallback).

Los problemas reales no están en la lógica, sino en **la coherencia entre las capas**: versiones
desfasadas, un rol que existe en el código pero no en la base, columnas vivas sin versionar,
documentación obsoleta que contradice el código, y cero red de seguridad automatizada (sin tests,
lint que nunca falla).

### Top 5 riesgos

| # | Riesgo | Impacto | Prioridad |
|---|---|---|---|
| 1 | `db/02_saas.sql` y `05_schema_real.sql` **reabren agujeros de seguridad** si se re-aplican | Fuga de datos entre empresas | 🔴 Crítica |
| 2 | Desfase de versiones APK (1.5.8) vs bundle OTA (1.5.25) | Nadie sabe qué corre en cada teléfono | 🔴 Alta |
| 3 | Rol `propietario` usado en código pero **ausente del check constraint** de la DB | No se puede dar de alta un propietario desde la UI | 🔴 Alta |
| 4 | `npm run build` sin `CAP_BUILD=1` → APK en pantalla blanca, sin ninguna protección | Release roto, se detecta recién en el teléfono | 🟠 Media-alta |
| 5 | Columnas en producción que **ningún `.sql` versiona** | Recrear la base desde `db/` produce una base incompleta | 🟠 Media |

---

## 2. Arquitectura

### Stack

- **React 19.2** + **Vite 7** + **Tailwind 4** (vía `@tailwindcss/vite`), ESM puro.
- **Capacitor 6.2** para el APK. Plugins: background-geolocation (parcheado), sqlite, filesystem,
  share, browser, app, google-auth, **capgo/capacitor-updater** (OTA).
- **Leaflet 1.9** para todos los mapas. **Sin React-Leaflet**: se maneja la instancia a mano.
- **@supabase/supabase-js 2.110**.
- `papaparse` + `xlsx` (lazy) para importación de clientes.

### Ruteo: no hay router

No existe `react-router`. La navegación es **renderizado condicional por rol + plataforma**, y la
regla vive en un único lugar deliberado: `decidirSupervisionMovil()` en
[src/App.jsx:102-113](src/App.jsx#L102).

```
propietario                    → SIEMPRE supervisión móvil (APK y PWA: el dueño usa el celular)
!nativo                        → false (desktop)
encargado + vista==='panel'    → supervisión móvil
admin/superadmin en APK        → supervisión móvil (ya no existe panel de escritorio en el .apk)
```

Luego, en `AuthedApp` ([src/App.jsx:118-180](src/App.jsx#L118)) el orden de decisión es:
`SupervisionMovil` → `SupervisionDesktop` (si `!nativo && (esGestor || encargado-en-panel)`) →
fallback `AppShell` + `RoleRouter`.

### Árbol de providers

```
ThemeProvider
└─ DeviceProvider
   └─ AuthProvider
      ├─ ErrorBoundary → Gate
      │                  └─ CatalogProvider → GpsProvider → AuthedApp
      ├─ UpdatePrompt
      └─ DeviceBanner
```

`Gate` ([src/App.jsx:182-197](src/App.jsx#L182)) resuelve: cargando → sin sesión (`LoginView`) →
perfil pendiente/errado (con reintento) → `!aprobado` (`PendienteView`) → app.

`aprobado = activo && rol` ([AuthContext.jsx:207](src/context/AuthContext.jsx#L207)).

### Contextos

| Contexto | Qué posee |
|---|---|
| `AuthContext` | Sesión Supabase + fila de `perfiles`. Login Google nativo (idToken) y web (OAuth). Perfil offline-first con caché. |
| `CatalogContext` | `productos`, `clientes`, `zonas`. Offline-first, mutaciones optimistas vía write queue. Arranca **ambas colas** ([:107](src/context/CatalogContext.jsx#L107)). |
| `GpsContext` | Un **único** watch de posición para roles móviles (`vendedor\|repartidor\|encargado`) + heartbeat de estado del dispositivo. |
| `DeviceContext` | `'mobile' \| 'desktop'` compartido. |
| `ThemeContext` | dark/light, clave `launion-theme` (la misma que el script anti-FOUC de `index.html`). |

### Mapa de features

| Feature | Rol | Nota |
|---|---|---|
| `supervision/SupervisionMovil.jsx` (686 L) | encargado, propietario, admin en APK | Full-screen, mapa de fondo + chrome flotante glass |
| `supervision/SupervisionDesktop.jsx` (583 L) | gestores en PC | Sidebar + topbar + mapa central. Solo web |
| `propietario/PropietarioView.jsx` | propietario | Solo lectura: equipo en vivo + recorridos + KPIs placeholder |
| `vendedor/` | vendedor | 4 tabs; `useJornada.js` concentra todo el estado del día |
| `repartidor/RepartidorView.jsx` | repartidor | — |
| `admin/` | admin, superadmin, encargado | Usuarios, Empresas, Zonas, Importar, Recorridos, Consultas, Replay |
| `auth/`, `catalog/`, `perfil/`, `movil/` | — | Login/pendiente, alta de cliente/producto, mi cuenta, prompt de permiso "siempre" |

---

## 3. Capa PWA

- **vite-plugin-pwa** con `registerType: 'prompt'` ([vite.config.js:21](vite.config.js#L21)) — **no**
  hay recarga automática; el banner lo maneja [UpdatePrompt.jsx](src/components/UpdatePrompt.jsx).
- Manifest: nombre `DisT-At`, `standalone`, `portrait`, tema `#0C0C0C`, íconos 192/512 + maskable.
- Workbox: `globPatterns` sobre js/css/html/svg/png/ico/csv/woff2. **Sin `runtimeCaching`** — los
  tiles del mapa y las llamadas a Supabase no se cachean vía SW (el offline lo resuelven las colas).
- `index.html` tiene un **script anti-FOUC inline** ([:17-24](index.html#L17)) que lee el tema de
  localStorage y setea `data-theme` antes del primer render.
- **Deploy**: [.github/workflows/deploy.yml](.github/workflows/deploy.yml) — push a `main` o manual →
  `npm ci` → `npm run build` (**sin** `CAP_BUILD`, base `/la-union-app/`) → GitHub Pages.

> ⚠️ **Los dos canales son independientes.** Publicar una OTA **no** actualiza la PWA, y pushear a
> `main` **no** actualiza el APK. Son dos acciones distintas.

---

## 4. Capa APK Android

### Configuración Capacitor

[capacitor.config.ts](capacitor.config.ts): `appId com.launion.app`, `appName DisT-At`, `webDir dist`.
**Sin bloque `server`** (no hay live reload). Comentario explícito en `:7-9`: **no** activar
`android.useLegacyBridge` — rompe el pipeline de publicación de posiciones.

Plugins configurados: `CapacitorUpdater { autoUpdate: false }` (OTA manual), `GoogleAuth` (client ID
web, hardcodeado pese al comentario que dice que viene de env), `BackgroundGeolocation` (vacío, se
configura en los call sites), `CapacitorSQLite` (sin encriptación).

### Los tres plugins nativos propios

En `android/app/src/main/java/com/launion/app/`. **Están escritos a mano y no se regeneran.**

1. **`BatteryOptimizationPlugin.java`** (70 L) — exención de Doze. `isIgnoring()` / `request()`, con
   fallback a la lista global de ajustes en OEMs que ocultan el diálogo por app ([:50-58]). Sin esta
   exención, muchos OEMs matan el foreground service al bloquear la pantalla.

2. **`MovimientoPlugin.java`** (265 L) — Activity Recognition. La máquina de estados vive en JS
   (`estados.js`); esto solo entrega transiciones. **Detalle crítico [:170-177]: el `PendingIntent`
   debe ser `FLAG_MUTABLE` en API 31+.** Con `FLAG_IMMUTABLE` registra sin error y nunca entrega nada.

3. **`MovimientoReceiver.java`** (50 L) — receiver **declarado en el manifest** (no dinámico), para
   que las transiciones lleguen aun con el proceso muerto. Los dinámicos mueren con el proceso en
   OEMs agresivos (caso Motorola documentado en el encabezado).

`MainActivity.java` los registra **antes** de `super.onCreate()` ([:12,:16]).

### Manifest

Permisos: `INTERNET`, `ACCESS_COARSE/FINE/BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`, `WAKE_LOCK`,
`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, `ACTIVITY_RECOGNITION` (+ la variante legacy GMS
`maxSdkVersion=28`).

`MainActivity` es `singleTask` con intent-filter LAUNCHER **y** deep link
`com.launion.app://auth` para el retorno de OAuth. El `<service>` de ubicación llega por merge desde
el plugin, no está declarado acá.

### El patch de background-geolocation

`patches/@capacitor-community+background-geolocation+1.2.26.patch` (14 KB), aplicado por
`patch-package` en `postinstall`. Hace **cuatro** cosas:

1. **Expone `interval` / `maxWaitTime` / `priority` a JS.** Upstream hardcodeaba 1 Hz y
   `PRIORITY_HIGH_ACCURACY` para toda la jornada de ~14 h, sin ninguna perilla desde JS.
2. **Arregla la pérdida de fixes al batchear**: usaba `getLastLocation()` y tiraba los intermedios;
   ahora itera `locationResult.getLocations()`. Esto es lo que hace seguro subir `maxWaitTime`.
3. **Agrega `updateWatcher(id, …)`** — reconfigura un watcher vivo sin tocar el estado foreground.
   `removeWatcher` + `addWatcher` es *break-before-make*: `removeWatcher` llama `stopForeground(true)`
   y en targetSdk 34 rearrancar el FGS desde background lanza
   `ForegroundServiceStartNotAllowedException`, que el plugin **se traga** → tracking muerto en silencio.
4. Actualiza los tipos, con la advertencia de que `distanceFilter` mapea a `setSmallestDisplacement`
   (filtra la **entrega**, no la adquisición) y que `priority: 102` vaciaría los recorridos porque los
   fixes con precisión > 30 m se descartan.

> ⚠️ **`updateWatcher` no mergea opciones.** Hay que pasar siempre el spread completo de
> `OPCIONES_GPS_MOVIMIENTO` ([geolocation/index.js:87-91](src/services/geolocation/index.js#L87)).

### Build y firma

`android/app/build.gradle`: `versionCode 8`, `versionName "1.5.8"` ([:16-17]).
`minSdk 23 / compile 34 / target 34` (desde `variables.gradle`).

Firma release desde `android/keystore.properties` (gitignored, existe en disco), keystore
`launion.keystore`. Dos pins deliberados:
- `resolutionStrategy.force 'androidx.work:work-runtime:2.9.1'` ([:59-63]) — Capgo arrastra 2.10 que
  exigiría compileSdk 35.
- `play-services-location 21.0.1` explícito ([:77]) — la dep transitiva es `implementation` y no
  llega al classpath de `:app` (símbolo `ActivityRecognition`).

Lint desactivado en release ([:43-48]) porque AGP lint crashea con JDKs nuevos.

### OTA (Capgo, self-hosted)

```
scripts/ota-release.sh <versión>
  ├─ CAP_BUILD=1 npm run build
  ├─ zip de dist/ con Python zipfile  ← Compress-Archive de PowerShell escribe "\" y rompe el unzip en Android
  ├─ gh release create ota-<versión> bundle.zip
  └─ imprime el SQL: update app_config set bundle_version=…, bundle_url=…, updated_at=now();
```

En el teléfono, [src/services/ota.js](src/services/ota.js): `otaCheck()` compara `app_config` contra
`CapacitorUpdater.current()`; `otaDownload()` descarga y hace `next()`; `otaReload()` aplica y
reinicia. **`otaReady()` → `notifyAppReady()` se llama en [main.jsx:9-13](src/main.jsx#L9)**: si eso
falla, Capgo revierte el bundle.

---

## 5. Pipeline GPS — la zona más delicada del proyecto

Es el corazón del producto y donde más bugs de producción se pagaron. Cinco piezas:

### 5.1 `tracker.js` — módulo NO-React a propósito

[src/services/geolocation/tracker.js](src/services/geolocation/tracker.js). El callback nativo de
background-geolocation dispara con la app en Doze, cuando React está congelado. Por eso el estado es
**a nivel de módulo**, no en hooks: sobrevive al freeze del WebView.

`procesarFix()` filtra por precisión (>30 m fuera), velocidad imposible (>45 m/s), movimiento mínimo
(10 m) y keep-alive (90 s). Actualiza `last` **antes** de encolar (evita doble envío). **Siempre
encola**, nunca throttlea el encolado; lo que throttlea es el **flush**, a 15 s — antes hacía un
handshake TLS por punto cada ~2,8 s.

> Este diseño es el fix documentado de "el GPS moría con la pantalla bloqueada": la persistencia
> colgaba de un `useEffect([pos])` que no corría en background.

### 5.2 `estados.js` — máquina de estados pura

Traduce transiciones de Activity Recognition a reconfiguración del watcher. `PRESET_QUIETO` mantiene
`priority: 100` y solo estira el intervalo a 90 s. Histéresis asimétrica.

> **El GPS nunca se apaga en reposo** ([:15-29] documenta por qué). El plugin tiene un piso de
> adquisición que no se toca desde JS.

### 5.3 Las dos colas

| | `sync/queue.js` (posiciones) | `sync/writeQueue.js` (catálogo) |
|---|---|---|
| Clave | `lu-pos-queue` | `lu-write-queue` |
| Máx / lote | 8000 / 200 | 2000 / FIFO |
| Idempotencia | `upsert onConflict:'client_uid' ignoreDuplicates` | `upsert onConflict:'id'`, UUID generado en cliente |
| Arranque | `startPosQueue()` — inmediato + `online` + `visibilitychange` + 30 s | `startWriteQueue()` — inicio + `online` + 30 s |

Ambas serializan con un mutex de cadena de promesas y **cortan al primer lote fallido** sin perder
nada. `queue.js` lleva contadores de descarte (`dropsPorDesborde`, `dropsPorCuota`) en lugar de
catches silenciosos.

> ⚠️ **Ninguna de las dos debe gatearse con `navigator.onLine`.** El WebView de la APK reporta
> offline estando conectado y eso bloqueaba **todas** las subidas
> ([queue.js:66-69](src/services/sync/queue.js#L66)).

> El trigger de `visibilitychange` es el crítico: los WebViews en background congelan timers y
> eventos `online`; volver a foreground es el único despertar confiable.

### 5.4 Puerto de persistencia

[src/services/persistence/index.js](src/services/persistence/index.js): localStorage en web, SQLite
(tabla `kv`) en nativo. **Timeout de 5 s en cada operación** y fallback a localStorage tanto en init
como por operación — un `await` colgado de SQLite congelaba la cola de GPS de forma permanente.

### 5.5 Dependencia de la DB

Toda la cadena depende de que `posiciones_client_uid_uidx` sea un índice **único completo**. Ver §6.

---

## 6. Backend Supabase

### Modelo de datos

| Tabla | Columnas clave | Relaciones |
|---|---|---|
| `empresas` | id, nombre, `activo` (palanca de suscripción), base_lat/lng* | raíz del tenant |
| `perfiles` | id (=auth.users.id), nombre, email, telefono*, rol, activo, id_empresa, numero* | → empresas |
| `clientes` | codigo (UNIQUE), nombre_comercio, lat/lng, dias_visita, geofence_radio, id_zona, id_vendedor | → empresas, zonas, perfiles |
| `productos` | codigo (UNIQUE), descripcion, precio_unitario, peso_kg, categoria | → empresas |
| `zonas` | nombre, color, numero*, id_vendedor* | → empresas |
| `pedidos` / `pedido_items` | estado, montos, firma_url | **sin consumidor en `src/`** |
| `posiciones` | id bigint, id_usuario, lat, lng, ts, accuracy, **client_uid UNIQUE**, bateria* | → perfiles, empresas |
| `rutas` | fecha, objetivo, orden_paradas jsonb | → perfiles |
| `estado_dispositivo` | id_usuario (PK), app_version, gps_ok, bg_ok, cola_pendiente* | → perfiles |
| `consultas_rutas` | ledger de cuota (5000/mes) | — |
| `app_config` | singleton: latest/min_version, apk_url, bundle_version/url, track_enabled/start/end | — |
| `recorridos_snap`* | geometria, puntos, algo, unique (id_usuario, fecha) | caché de la Edge Function |

`*` = **existe en producción pero NO está versionada en ningún `.sql`**.
`db/00_LEER_PRIMERO.md:46-50` ya lista 5 (`recorridos_snap`, `actualizar_mi_perfil()`,
`perfiles.telefono`, `empresas.base_lat/lng`, `estado_dispositivo.cola_pendiente`).
**Esta auditoría encontró 4 más, todas en uso por código vivo**: `posiciones.bateria`
(`tracker.js:147`), `perfiles.numero` (`UsuariosView.jsx:85,116`), `zonas.numero` y
`zonas.id_vendedor` (`CatalogContext.jsx:195`).

### Los archivos `db/` NO son la fuente de verdad

`db/00_LEER_PRIMERO.md:14-22` lo dice y esta auditoría lo confirma: la base viva está endurecida;
**`02_saas.sql` y `05_schema_real.sql` contienen políticas históricas inseguras** que reabren agujeros
si se re-ejecutan. Los peores en `02_saas.sql`:

- `clientes_wr` es `FOR ALL` con scope solo de tenant ([:95]) → cualquier vendedor podría borrar toda
  la cartera de clientes de la empresa.
- `pedidos_upd` **sin `WITH CHECK`** ([:119]) → reasignación de tenant.
- `items_wr` con `WITH CHECK` que solo valida tenant ([:137]).

`06_seguridad_fixes.sql` es el que refleja la base viva y **debe ser siempre el último**.

### Dos sutilezas de SQL que hay que respetar

**1. El índice de `client_uid` jamás parcial** ([04_posiciones_idempotencia.sql:17-20](db/04_posiciones_idempotencia.sql#L17)):

> «OJO: el índice DEBE ser completo (sin WHERE). Un índice PARCIAL rompe el
> `upsert(onConflict:'client_uid')` con error **42P10** (costó dos rebuilds el 14/07/2026).»

Este fue el bug de "las posiciones no suben". No era el APK: era la base.

**2. `revoke ... from public`, nunca `from anon`** ([06_seguridad_fixes.sql:46-59](db/06_seguridad_fixes.sql#L46)):

Postgres concede EXECUTE a PUBLIC por defecto al crear una función (acl `=X/postgres`); `anon` y
`authenticated` lo heredan de ahí. Un `revoke ... from anon, authenticated` es un **NO-OP**.

Y el contrapunto: **nunca** revocar EXECUTE de `mi_empresa` / `mi_rol` / `es_admin` /
`es_superadmin` — las políticas RLS los invocan como el rol que consulta; revocarlos rompe **todas**
las lecturas protegidas. El linter de Supabase los marca igual, pero la exposición es nula (operan
sobre `auth.uid()`, que para anon es null).

### Edge Function `snap-recorridos`

Devuelve los recorridos del día pegados a las calles. **No usa `/match`**: el endpoint público tiene
tope de tamaño y devolvía `TooBig` incluso con 20 puntos. Usa **OSRM `/route` con perfil `foot`** en
FOSSGIS. El perfil peatonal importa: `driving` re-ruteaba a los caminantes por calles de auto e
inflaba una caminata real de 941 m a 5632 m; con `foot` da ~1037 m.

Pipeline: auth del usuario → verifica `perfiles.activo` → cliente **service-role** lee `posiciones` y
el caché `recorridos_snap` → por usuario: `splitGaps` (1500 m) → `isStationary` (mediana < 40 m, evita
vueltas falsas por jitter) → `thin` (25 m) → `cap` (90 waypoints) → `routeSeg` (timeout 5 s,
User-Agent obligatorio por política de FOSSGIS). Guarda anti-desvío: si la ruta calculada supera
`2,5 × cruda + 50 m`, usa la traza cruda. **No cachea si algún segmento falló**, para reintentar luego.

### Realtime

- `suscribirPosiciones` — canal `rt-posiciones`, INSERT en `public.posiciones`. **El aislamiento entre
  empresas lo hace RLS, no un filtro.**
- `publicarAlerta` / `suscribirAlertas` — canales **broadcast** por empresa, efímeros, sin tabla.
- `sync/index.js` es un `BroadcastChannel` **local** entre pestañas del mismo dispositivo — no tiene
  nada que ver con Supabase.

### Roles

Constraint en la DB: `superadmin | admin | encargado | vendedor | repartidor`.

**El código usa un sexto rol, `propietario`, que NO está en el constraint** (`App.jsx:66,105`,
`AppShell.jsx:10`, `SupervisionMovil.jsx:93`, `SupervisionDesktop.jsx:84`). Poner
`perfiles.rol = 'propietario'` desde `UsuariosView` violaría `perfiles_rol_check`; de hecho las
listas asignables lo omiten (`UsuariosView.jsx:13-14`). **Es una inconsistencia real, no una decisión
documentada.**

`encargado` es dual: se lo trackea como agente de calle **y** supervisa
(`esMovil = vendedor | repartidor | encargado`, `GpsContext.jsx:19`).

Gating en cuatro capas: DB (RLS, autoritativa) → `decidirSupervisionMovil()` → tablas de menú por rol
→ reglas de negocio (`CatalogContext.jsx:130`: cliente creado por rol móvil nace `activo=false`).

---

## 7. Credenciales y vencimientos

| Credencial | Dónde vive | ¿Pública por diseño? | Riesgo real | Rotación |
|---|---|---|---|---|
| **Stadia Maps** | `src/services/maps/basemap.js:13` — **hardcodeada y commiteada** | Es clave de navegador (va al bundle igual), protegida por dominios permitidos | **Bajo-medio.** Si vence o se abusa, solo dejan de cargar las capas Oscuro y Satélite; OSM (el default) sigue andando | Ver §7.1 |
| **Supabase anon** | `.env.local`, `.env.production:5` | Sí — publishable, la protección es RLS | Bajo (mientras RLS esté sano) | Panel de Supabase |
| **Google OAuth Web Client ID** | `capacitor.config.ts:28-29`, `AuthContext.jsx:18` | Sí, público por diseño | Nulo | GCP |
| **Keystore de firma** | `android/keystore.properties` + `android/app/launion.keystore` (gitignored, en disco) | **NO — secreto crítico** | **Alto: si se pierde, no se puede volver a actualizar el APK. Nunca.** | **Imposible.** Hacer backup ya |
| `VITE_GOOGLE_MAPS_API_KEY` | `.env.local` | — | **Ninguno: nadie la lee.** Google Maps es código muerto | Se puede borrar |

> ⚠️ **Dos credenciales están hardcodeadas en el código, no en `.env`.** No asumir que todos los
> secretos viven en variables de entorno.

> 🔴 **Acción inmediata sin relación con mapas: hacer backup del keystore fuera de la máquina.** Es la
> única credencial del proyecto que, si se pierde, es irrecuperable — Android no permite firmar
> actualizaciones de una app con otro keystore.

### 7.1 La key de mapas — situación real y fix

**Corrección importante respecto a la premisa original:** en el código **no hay ninguna key de Google
Maps en uso**. `src/services/maps/index.js:1-8` declara explícitamente que el port de Google Maps
quedó fuera de uso; del módulo solo sobrevive `CENTRO_DEFECTO` (Las Lajitas, Anta, Salta:
`-24.723078, -64.194329`). `GUIA_API_KEY_GOOGLE_MAPS.md` está obsoleta y ella misma se marca como
opcional. `README.md:63-67` menciona un componente `GoogleMap` que **no existe**.

La única key de mapas real es la de **Stadia**, y su comportamiento ante vencimiento ya está bien
degradado: `stadiaUsable()` ([basemap.js:49-52](src/services/maps/basemap.js#L49)) oculta las capas
Stadia cuando no hay key (salvo en localhost, donde Stadia funciona keyless). **Sin key, la app no se
rompe: se queda con OSM.** Eso baja mucho la urgencia.

**Fix propuesto (listo para aplicar, no aplicado):**

1. Mover a env: `export const STADIA_KEY = import.meta.env.VITE_STADIA_KEY || ''`.
2. Agregar `VITE_STADIA_KEY` a `.env.example`, `.env.local`, `.env.production`.
3. Agregarla como **secret del repo** y exponerla en el paso de build de
   `.github/workflows/deploy.yml` (si no, la PWA de Pages pierde las capas Stadia).
4. Registrar en el panel de Stadia los orígenes: `santiagoadet7823-dev.github.io` **y** el del WebView
   de Capacitor — que es `https://localhost` (**verificar**, es el punto que puede hacer que las capas
   anden en la PWA y no en el APK, o viceversa).
5. Rotar la key actual (está commiteada en el historial de git, así que se debe considerar quemada).

> Nota: mover a env **no la vuelve secreta** — toda variable `VITE_*` termina en el bundle público. El
> beneficio real es poder rotarla sin tocar código y no tenerla en el historial de git. La protección
> efectiva es y seguirá siendo el allowlist de dominios en el panel de Stadia.

### 7.2 Servicios sin key en camino crítico

`src/services/routing/index.js:10-12` usa el **servidor demo público de OSRM**
(`router.project-osrm.org`) para `/route`, `/trip` (TSP de ruta óptima) y `/match`. Sin key, sin SLA,
con política de uso justo. Si OSRM demo cae o rate-limitea, se cae el botón de "ruta óptima" y el
ruteo punto a punto. La Edge Function usa FOSSGIS, que es un host distinto (mitiga parcialmente).

El comentario en el módulo señala que este es **el único punto de swap** si algún día se migra a
Google Directions.

---

## 8. Deuda técnica y riesgos

| # | Hallazgo | Ubicación | Impacto | Fix propuesto |
|---|---|---|---|---|
| 1 | `db/02_saas.sql` y `05_schema_real.sql` reabren agujeros si se re-aplican | `db/00_LEER_PRIMERO.md:14-22` | 🔴 Fuga entre empresas | Renombrar a `.sql.historico` o mover a `db/historico/` para que sea imposible ejecutarlos por accidente |
| 2 | Versiones desfasadas: `APP_VERSION 1.5.25` vs `versionName 1.5.8` / `versionCode 8` | `src/version.js:6`, `android/app/build.gradle:16-17` | 🔴 Nadie sabe qué corre en cada teléfono; `estado_dispositivo.app_version` reporta el bundle, no el APK | Alinear en el próximo APK y documentar la matriz (§ CLAUDE.md) |
| 3 | Rol `propietario` fuera del check constraint | `db/02_saas.sql:22-23` vs `App.jsx:66` | 🔴 No se puede dar de alta un propietario desde la UI | Migración: agregar `propietario` al constraint + a `ROLES_ADMIN`/`ROLES_SUPER` |
| 4 | 9 columnas/objetos vivos sin versionar | `db/` | 🟠 Recrear la base desde `db/` da una base incompleta | Nuevo `db/07_columnas_faltantes.sql` idempotente (`add column if not exists`) |
| 5 | `npm run build` sin `CAP_BUILD=1` → pantalla blanca | `vite.config.js:14` | 🟠 Release roto detectado recién en el teléfono | Agregar script `build:apk` = `cross-env CAP_BUILD=1 vite build` |
| 6 | Docs obsoletas que contradicen el código | `README.md`, `GUIA_APK_ANDROID.md`, `GUIA_API_KEY_GOOGLE_MAPS.md` | 🟠 Inducen a error | Marcar como obsoletas o corregir; `GUIA_APK_ANDROID.md:230` vs `:320` se contradicen sobre `storeFile` (**`:320` es la que funciona**) |
| 7 | `lint` = `eslint . \|\| true`; **cero tests** en todo el repo | `package.json:11` | 🟠 Sin red de seguridad | Quitar el `\|\| true`; considerar tests de las funciones puras primero (`dwell.js`, `estados.js`, `format.js`, `geofence.js`) |
| 8 | Tabla de permisos de menú duplicada | `SupervisionMovil.jsx:78-84`, `SupervisionDesktop.jsx:67-73` | 🟡 Divergencia silenciosa de permisos | Extraer a `src/lib/permisos.js` |
| 9 | OSRM demo público en camino crítico | `src/services/routing/index.js:10-12` | 🟡 Sin SLA | Evaluar OSRM propio o proveedor pago si el uso crece |
| 10 | `pedidos`/`pedido_items`/bucket `firmas` con RLS pero sin consumidor | db vs `src/` | 🟢 Superficie muerta | Decidir: implementar o quitar |
| 11 | Key de Stadia commiteada | `basemap.js:13` | 🟢 Degrada solo | Ver §7.1 |
| 12 | `.env.local` y `.env.production` tienen sets distintos de variables | raíz | 🟢 Confusión | Unificar contra `.env.example` |

---

## 9. Pendientes de corrección — checklist priorizado

### 🔴 Hacer ya

- [ ] **Backup del keystore** (`android/app/launion.keystore` + `keystore.properties`) fuera de la
      máquina. Si se pierde, el APK no se puede volver a actualizar nunca.
- [ ] Mover `db/02_saas.sql` y `db/05_schema_real.sql` a `db/historico/` para volver imposible el
      re-run accidental.
- [ ] Alinear versiones: subir `versionCode`/`versionName` del gradle al publicar el próximo APK.
- [ ] Migración para agregar `propietario` al check constraint de `perfiles.rol`.

### 🟠 Próximo sprint

- [ ] `db/07_columnas_faltantes.sql` idempotente con las 9 columnas/objetos sin versionar.
- [ ] Script `build:apk` con `CAP_BUILD=1` incorporado (usar `cross-env` por Windows).
- [ ] Rotar la key de Stadia y moverla a `VITE_STADIA_KEY` + secret del workflow (§7.1).
- [ ] Verificar qué origin manda el WebView de Capacitor y registrarlo en el panel de Stadia.
- [ ] Sanear `README.md` y `GUIA_APK_ANDROID.md`; marcar `GUIA_API_KEY_GOOGLE_MAPS.md` como obsoleta.
- [ ] Quitar el `|| true` del script de lint y arreglar lo que salte.

### 🟡 Cuando haya aire

- [ ] Extraer la tabla de permisos de menú a `src/lib/permisos.js`.
- [ ] Tests de las funciones puras: `dwell.js`, `estados.js`, `format.js`, `geofence.js`.
- [ ] Decidir el futuro de `pedidos`/`pedido_items`/`firmas`.
- [ ] Borrar `VITE_GOOGLE_MAPS_API_KEY` y el port muerto de Google Maps.
- [ ] Evaluar alternativa a OSRM demo público.

---

## 10. Lo que está bien y no hay que tocar

Vale explicitarlo, porque el instinto de "limpiar" puede romper cosas caras:

- **Los comentarios largos con fechas y números de bug.** No son ruido: son la memoria del proyecto.
- **`tracker.js` siendo no-React.** Parece inconsistente con el resto; es deliberado y necesario.
- **El lock custom de Supabase** (`supabase.js:25-31`) que reemplaza `navigator.locks`.
- **`hoyStr()`** y sus 8 usos: no volver a `toISOString().slice(0,10)`.
- **Los guards con timeout del puerto de persistencia.**
- **Los pins de versión en gradle** (`work-runtime`, `play-services-location`).
- **`Fila` a nivel de módulo en `UsuariosView.jsx:26-31`** — está así porque el padre re-renderiza
  cada segundo dentro de `SupervisionMovil`.
- **El zip con Python en `ota-release.sh`.**
