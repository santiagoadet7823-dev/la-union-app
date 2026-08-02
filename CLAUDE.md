# CLAUDE.md — DisT-At

Guía operativa del repo. **Leer completo antes de tocar nada.**

Documentos complementarios:
- [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md) — arquitectura, deuda técnica y riesgos.
- [DOCUMENTACION_FUNCIONAL.md](DOCUMENTACION_FUNCIONAL.md) — qué hace cada función y de qué rol es.
  **Empezar por acá** para saber qué está vivo, qué es demo y qué es código muerto.
- [PLAN_SAAS.md](PLAN_SAAS.md) — migración planificada a `corporaciones → empresas`.

---

## 1. Qué es esto

**DisT-At** (`com.launion.app`) — SaaS logístico multi-tenant de seguimiento GPS de equipos en calle.
React + Vite + Capacitor + Supabase. Todo en **español**: código, comentarios, UI, commits.

### Dos canales de despliegue INDEPENDIENTES

| Canal | Se actualiza con | Base de assets |
|---|---|---|
| **PWA** (GitHub Pages) | push a `main` → workflow → Pages | `/la-union-app/` |
| **APK** (Android) | OTA de Capgo: `bundle.zip` + fila en `app_config` | `./` (**requiere `CAP_BUILD=1`**) |

> ⚠️ **Publicar una OTA NO actualiza la PWA. Pushear a `main` NO actualiza el APK.** Son dos acciones
> distintas. Si el usuario pide "publicar el cambio", preguntar a cuál de los dos canales se refiere.

### Multi-tenancy

**`empresa` es hoy el tenant** (la distribuidora). Está en `id_empresa` de todas las tablas de datos
y lo aplican las políticas RLS. `corporación` es un nivel **planificado, todavía no implementado**
— ver [PLAN_SAAS.md](PLAN_SAAS.md).

⚠️ **`empresas.activo` no gatea nada hoy.** Se escribe y se muestra, pero ninguna policy ni el gate
de `App.jsx` lo consultan. Desactivar una empresa no tiene efecto, aunque la UI diga lo contrario.

### Roles

`superadmin` · `admin` · `encargado` · `vendedor` · `repartidor` · `propietario`

`encargado` es dual: se lo trackea por GPS **y** supervisa. `propietario` tiene su propia pantalla
(`features/propietario/PropietarioMovil.jsx`) y **ya está en el check constraint** (`db/20`,
verificado en base viva 28/07/2026 — el §8 decía lo contrario y estaba desactualizado).

**Los roles son EXCLUYENTES** (`RoleRouter` es un if/else). Para dar una capacidad extra sin cambiar
lo que la persona *es*, va por **`perfiles.permisos text[]`** (`db/23`), no por un rol nuevo: un
vendedor con `'catalogo'` sigue siendo vendedor —conserva GPS, jornada y su lugar en el mapa— y
además edita el catálogo. La tabla de quién ve qué pantalla de gestión vive en
[`src/lib/gestion.js`](src/lib/gestion.js).

---

## 2. 🚨 Reglas que NUNCA se violan

Cada una de estas costó un bug de producción. No hay excepciones "por esta vez".

### Build y release

1. **`CAP_BUILD=1` es obligatorio en cualquier build destinado al APK o a una OTA.** Sin eso, Vite
   compila con base `/la-union-app/` y el APK arranca en **pantalla blanca**
   ([vite.config.js:14](vite.config.js#L14)). `npm run build` a secas es el build de la PWA.
2. **No tocar `notifyAppReady()` en [main.jsx:9-13](src/main.jsx#L9).** Si no se llama, Capgo revierte
   el bundle OTA.
3. **No regenerar `android/` con `npx cap add android`.** Pisa los tres plugins nativos escritos a
   mano y los permisos del manifest.
4. **No activar `android.useLegacyBridge`** ([capacitor.config.ts:7-9](capacitor.config.ts#L7)). Rompe
   el pipeline de publicación de posiciones.

### Base de datos

5. **Los archivos `db/*.sql` NO son la fuente de verdad y son peligrosos.** `historico/02_saas.sql` y
   `historico/05_schema_real.sql` contienen políticas históricas **inseguras** que reabren agujeros entre
   empresas si se re-ejecutan. Para saber cómo está la base: **consultar la base viva** (MCP de
   Supabase), nunca leer los `.sql` y asumir. Ver [db/00_LEER_PRIMERO.md](db/00_LEER_PRIMERO.md).
6. **El índice de `posiciones.client_uid` JAMÁS puede ser parcial (con `WHERE`).** Un índice parcial
   rompe `upsert(onConflict:'client_uid')` con error **42P10** y **se cae todo el GPS en silencio**
   ([db/04_posiciones_idempotencia.sql:17-20](db/04_posiciones_idempotencia.sql#L17)). Costó dos
   rebuilds del APK persiguiendo un bug que estaba en la base.
7. **`revoke execute ... from public`, nunca *solo* `from anon, authenticated`.** Postgres concede
   EXECUTE a PUBLIC por defecto; anon y authenticated lo heredan. Revocar **solo** de
   anon/authenticated es un **NO-OP**
   ([db/06_seguridad_fixes.sql:46-59](db/06_seguridad_fixes.sql#L46)).
7-bis. 🩸 **Pero en una función NUEVA hay que revocar de los TRES.** Supabase tiene un
   `ALTER DEFAULT PRIVILEGES` que le da EXECUTE **explícito** a `anon` y `authenticated` sobre cada
   función creada en `public`, y un grant explícito **no** se va con un revoke a PUBLIC. Medido el
   30/07/2026: después del `revoke ... from public`, `vigilancia_equipo` (SECURITY DEFINER, cruza
   empresas) seguía con `anon=X | authenticated=X` — **cualquier vendedor logueado podía leer el
   plantel completo de todos los tenants**, con nombres, roles y coordenadas. Receta:
   `revoke from public` + `revoke from anon` + `revoke from authenticated` + `grant to service_role`,
   y después **verificar el ACL real** con `select proacl from pg_proc`. Ver
   [db/26_alertas_equipo.sql](db/26_alertas_equipo.sql) §7.
8. **NUNCA revocar EXECUTE de `mi_empresa` / `mi_rol` / `es_admin` / `es_superadmin`.** Las políticas
   RLS los invocan como el rol que consulta: revocarlos rompe **todas** las lecturas protegidas. El
   linter de Supabase los marca igual — ignorarlo, la exposición es nula.
9. `06_seguridad_fixes.sql` va **siempre último** si alguna vez se recrea una base desde cero.
10. **En RLS, el alcance de tenant va siempre como `id_empresa in (select …)`, nunca como un
    predicado escalar por fila.** Un predicado escalar se ejecuta una vez por fila y hace inusable la
    paginación de `posiciones` (1.000 filas × N páginas). Ver
    [PLAN_SAAS.md §2.3](PLAN_SAAS.md).

### Multi-tenancy (aplica al implementar PLAN_SAAS.md)

11. **`AuthContext.idEmpresa` NUNCA cambia.** Es la empresa de *identidad* del usuario. Si se agrega
    un selector de empresa activa, el scope va en un contexto aparte y **solo lo consumen las rutas
    de LECTURA**. `GpsContext.jsx` y `GpsGate.jsx` siguen leyendo `useAuth()` — si el scope activo
    llegara a la ruta de escritura de GPS, un superadmin mirando otro tenant escribiría sus propias
    posiciones dentro de los datos de ese cliente, y eso no se puede deshacer.

### GPS y sincronización

12. **No gatear las colas con `navigator.onLine`.** El WebView de la APK reporta offline estando
    conectado y eso bloqueaba **todas** las subidas
    ([queue.js:66-69](src/services/sync/queue.js#L66)).
13. **`updateWatcher` NO mergea opciones.** Pasar siempre el spread completo de
    `OPCIONES_GPS_MOVIMIENTO` ([geolocation/index.js:87-91](src/services/geolocation/index.js#L87)).
14. **No convertir `tracker.js` en hook/componente React.** Es un módulo con estado a nivel de módulo
    a propósito: el callback nativo dispara con React congelado en Doze.
15. **No mover la persistencia de posiciones a un `useEffect`.** Ese fue exactamente el bug de "el GPS
    muere con la pantalla bloqueada".
16. **`FLAG_MUTABLE` en el PendingIntent de `MovimientoPlugin.java:170-177`.** Con `FLAG_IMMUTABLE`
    registra sin error y **nunca entrega nada**.
17. **`MovimientoReceiver` va declarado en el manifest, no dinámico.** Los dinámicos mueren con el
    proceso en OEMs agresivos.
18. **No subir `priority` a 102 ni bajar `ACCURACY_MAX_M`.** Los fixes con precisión > 30 m se
    descartan: vaciaría los recorridos.
19. **Un error de la cola de posiciones puede ser PERMANENTE, no solo "no hay red".** La clave
    `lu-pos-queue` es del **dispositivo**, no del usuario: si se cambia de cuenta en el mismo
    teléfono, los puntos de la cuenta anterior fallan `posiciones_ins` (`id_usuario = auth.uid()`)
    para siempre y **taponan la cola: nada vuelve a subir nunca** (18/07/2026: 264 puntos
    atascados, 42501 cada 30 s durante 8 horas). Por eso `flushPosiciones` distingue
    `CODIGOS_PERMANENTES`. **Si tocás el manejo de errores de la cola, no vuelvas a tratar todos
    los errores como transitorios.**
20. **🩸 NUNCA BORRAR puntos de la cola: van a CUARENTENA (`lu-pos-cuarentena`).** El bundle
    **1.5.26 borró 264 puntos reales en producción** por hacer exactamente eso. Un punto trabado es
    recuperable; uno borrado no. La cuarentena destapa la cola igual, y `separarPorDueño()` **los
    devuelve solos** si esa cuenta vuelve a entrar en el teléfono. Vale para cualquier código que
    saque filas de una cola: si no podés inspeccionar el dato, no lo destruyas.
21. **Al escribir tests de una cola, la invariante es "no se pierde ni un punto", no "el descarte
    funciona".** Los tests de 1.5.26 pasaron 9/9 y aun así el cambio destruía datos: probaban que
    el borrado ocurriera, no si *correspondía*. Contá siempre `subidos + aislados == total`.
22. **Síntoma diagnóstico**: si `estado_dispositivo` sube pero `posiciones` no, **no es la red ni la
    sesión** — las dos usan la misma. Mirá `cola_pendiente` y los logs de Postgres.
22-bis. **🩸 EL RECORRIDO CRUDO MIENTE: pasarlo SIEMPRE por `limpiarTrazo` (`lib/geo.js`) antes de
    dibujarlo o de medirlo.** El uploader nativo no filtra saltos imposibles (`tracker.js` sí, pero
    ese camino ya no es el que está en la calle), así que en la base hay teleports. Medido el
    29/07/2026: un vendedor con cuatro fixes que alternan entre dos lugares a **127 km**, con
    precisiones de 21 y 29 m — el filtro de precisión no los puede cazar. Su día figuraba con
    **524,8 km**; el real fueron **17,9**. En las supervisiones eso ya está resuelto en un solo
    lugar (`features/supervision/trazos.js`); **cualquier pantalla nueva que dibuje o mida un
    recorrido tiene que usar ese módulo, no `byUser` crudo.**
19-bis. 🩸 **La cola NATIVA también tiene dueño, y el token ES la identidad.** `ingest-posiciones`
    saca `id_usuario` **e `id_empresa`** del token de dispositivo, no del punto: si el servicio
    nativo queda corriendo con el token de la cuenta anterior, los puntos se escriben a nombre de
    alguien que no estaba ahí, en una tabla sin policy de UPDATE ni de DELETE. **Incorregible.**
    Tres piezas lo sostienen y ninguna es opcional: `signOut()` llama a `cerrarSesionUploader()`
    (que **borra `K_TOKEN`** — sin eso `BootReceiver` y `AlarmReceiver` resucitan el servicio cada
    30 min con solo ver un token), `detenerUploaderNativo()` **no** puede tener un guard por
    variable de módulo (vale `false` en cada arranque en frío del WebView, justo cuando el servicio
    sobrevivió), y cada punto se estampa con su dueño **al capturar**, no al subir. Los ajenos van a
    **cuarentena nativa**, nunca se borran (regla 20).
22-ter. **`services/gpsConfig.js` es la ÚNICA fuente de los umbrales de GPS. No hardcodear
    intervalos.** `uploaderNativo.js` tenía el intervalo escrito a mano en `15000` mientras
    `gpsConfig` declaraba 10 s: la constante existía, se documentaba, y el uploader —el que corre
    en la calle— la ignoraba, así que bajarla no hacía absolutamente nada. Los cinco umbrales
    (`MIN_MOVE_M`, `NEAR_LIVE_MS`, `NEAR_LIVE_RAPIDO_MS`, `VEL_UMBRAL_MPS`, `VEL_HIST_MS`) viajan al
    servicio nativo por SharedPreferences → **se afinan por OTA, sin APK nuevo.**

### Mapas y apilamiento

28. **`LeafletMap` lleva `isolation: isolate` y NO se saca.** Leaflet asigna z-index de hasta
    **1000** a sus propias capas, y las esquinas de controles (`.leaflet-top`/`.leaflet-bottom`,
    z-index 1000) **no** viven dentro de `.leaflet-map-pane`, así que el `transform` que Leaflet
    le pone a ese pane no las contiene: se escapan al contexto padre. Sin el `isolate`, todo el
    chrome de la app por debajo de 1000 queda tapado por el mapa. Toda la escala `--z-*` depende
    de esto. Costó el bug del 20/07/2026: el desplegable de "Mi cuenta" en Monitoreo en vivo se
    veía sobre el header y desaparecía sobre el mapa.
29. **Antes de cambiar un z-index, leer el comentario que lo acompaña.** Ese mismo bug ya estaba
    resuelto en `SupervisionDesktop.jsx` con un `zIndex: 1200` y un comentario que explicaba
    exactamente por qué. Se lo bajó a `--z-chrome` sin leerlo y el bug volvió. Es el caso
    concreto de la regla 24.
30. **Un overlay flotante sobre el mapa va con `pointerEvents:'none'` en su contenedor y `'auto'`
    solo en las piezas que se tocan.** Un contenedor `position:absolute` con `left`/`right` fijos
    ocupa TODO el ancho aunque su contenido mida 40 px, y se traga los toques del mapa en esa
    franja: eso era el "abajo del mapa no se puede hacer click" de la PWA (30/07/2026,
    `BurbujasEquipo`). Verificado con `document.elementFromPoint`, que es la única forma honesta de
    probarlo.
31. **Lo que las DOS supervisiones muestran igual va en un módulo compartido**, nunca copiado:
    `features/supervision/dwells.js` (carteles de parada), `trazos.js` (limpieza + geometría) y
    `components/` (burbujas, tarjeta del pin, estado del equipo). `SupervisionMovil` y
    `SupervisionDesktop` no comparten una línea de código y **ya divergieron dos veces**: los
    carteles existieron solo en Movil de 1.5.7 en adelante, y el arreglo de performance del 26/07
    (`simplificarTrazo`) tardó dos días en llegar a Desktop porque era una copia.

32. 🩸 **El scope de empresa (`useTenant().idEmpresaActiva`) lo consumen SOLO las rutas de
    LECTURA.** `AuthContext.idEmpresa` es la identidad y no cambia nunca. Siguen con `useAuth()`, y
    están marcados NO TOCAR: `GpsContext.jsx`, `GpsGate.jsx`, `usePublishPosition.js`,
    `geolocation/tracker.js`, `useEstadoDispositivo.js`, `vendedor/useJornada.js`, los inserts de
    `CatalogContext.jsx`, `admin/UsuariosView.jsx` y las rutas de Storage `${idEmpresa}/…`. Si el
    scope llegara a la escritura de GPS, un superadmin mirando otra empresa escribiría **sus
    propias posiciones dentro de los datos de ese cliente** — y `posiciones` no tiene policy de
    UPDATE ni de DELETE (verificado en base viva), así que esa fila no se puede corregir ni borrar.
    Es irreversible. El centinela de "todas las empresas" es el string `'*'`, no `null`: media
    docena de hooks hacen `if (!idEmpresa) return` para decir "todavía no cargó".
33. **Los avisos del equipo se dedupean con el ÍNDICE, no con lógica en la función.**
    `alertas_equipo_abierta_uidx (id_usuario, tipo) where resuelta_ts is null` es lo que permite
    que el cron corra cada 10 min sin mandar 6 push por hora. No agregar un "ya avisé" dentro de
    `alertas-equipo/index.ts`: sería el mismo criterio en dos lugares, y el que se olvide de
    actualizar gana. La DETECCIÓN vive en SQL (`vigilancia_equipo`) a propósito — así se verifica
    con un `select` contra la base viva, sin desplegar nada ni esperar un cron.
35. **`requestAnimationFrame` NO dispara con el documento oculto.** Medido el 02/08/2026: cero
    frames en 500 ms con `visibilityState: 'hidden'` (`setInterval` sí corre, así que el síntoma es
    "todo funciona menos la animación"). Toda animación por rAF que deje algo a medio camino
    necesita una red de contención en `visibilitychange`: cambiar de pestaña a mitad de un tramo
    dejaba el pin del mapa **congelado en una posición por la que la persona ya pasó**, y eso es
    peor que no animar, porque el error es indistinguible de un dato real. Ver `animarPin.js`.
36. **La ventana de rastreo está implementada TRES veces y nada las sincroniza**: `dentroDeHorario()`
    (`services/tracking.js`), `dentroDeVentana()` (`UploaderGpsService.java`) y `en_ventana`
    (`vigilancia_equipo`, SQL). Tocar una sin las otras no rompe nada visible: hace que los avisos
    al supervisor **mientan en silencio**. Desde 1.8.0 la semántica es de **unión** — varias
    categorías por persona, se rastrea si cualquiera aplica (jornada partida).
34. **Un token FCM muerto se BORRA.** Cuando FCM responde 404/`NotRegistered` o `INVALID_ARGUMENT`,
    hay que poner `estado_dispositivo.fcm_token = null`. Un token muerto no se cura solo:
    desperdicia un envío por aviso y —lo peor— deja `fallidos` clavado en un número > 0, que es
    justo lo que hace que nadie note una falla real. Un fallo de RED **no** cuenta como token
    muerto. Ver `supabase/functions/alertas-equipo/fcm.ts`.

### Navegación nativa

26. **El botón ATRÁS de Android se maneja con la pila de [`services/atras.js`](src/services/atras.js),
    nunca con un listener suelto.** Cada overlay apila su cierre al abrirse y lo desapila al
    cerrarse; el atrás ejecuta el de más arriba. Sin el listener registrado, Capacitor aplica su
    default — y como **esta app no tiene router, nunca hay historial**, así que el atrás cerraba la
    app estando en cualquier pantalla.
27. **Con la pila vacía va `minimizeApp()`, JAMÁS `exitApp()`.** `exitApp()` mata el proceso y con él
    el foreground service de ubicación: el móvil deja de emitir sin que nadie se entere. Minimizar
    lo manda a segundo plano con el servicio vivo, que es el modo normal de trabajo de esta app.

### Fechas

23. **NUNCA `new Date().toISOString().slice(0, 10)`.** Devuelve UTC; Salta es UTC−3, así que de 21:00
    a 24:00 daba **mañana** y Supervisión mostraba el mapa vacío todas las noches. Usar **`hoyStr()`**
    de [src/lib/format.js:45](src/lib/format.js#L45).

### General

24. **No borrar los comentarios largos con fechas y números de bug.** No son ruido: son la memoria del
    proyecto. Si se refactoriza el código que explican, migrar el comentario.
25. **No transcribir valores de credenciales** en docs, commits, issues ni respuestas. Referenciar por
    ubicación (`archivo:línea`).

---

## 3. Comandos

```bash
# Desarrollo
npm install                    # postinstall aplica patch-package automáticamente
npm run dev                    # Vite en :5173

# Build PWA (canal GitHub Pages) — base /la-union-app/
npm run build

# Build APK (canal Android) — base ./  ⚠️ el CAP_BUILD=1 es obligatorio
CAP_BUILD=1 npm run build                    # Git Bash
$env:CAP_BUILD=1; npm run build              # PowerShell
set CAP_BUILD=1&& npm run build              # CMD

# APK completo
CAP_BUILD=1 npm run build && npx cap sync android
cd android && ./gradlew assembleRelease -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr"
# → android/app/build/outputs/apk/release/app-release.apk

# Release OTA (solo APK; requiere gh CLI logueado y Git Bash)
bash scripts/ota-release.sh 1.5.26
# luego, en Supabase:
# update public.app_config set bundle_version='1.5.26', bundle_url='<url>', latest_version='1.5.26', updated_at=now();

# ÚLTIMO paso del release: avisarle a los teléfonos que hay versión nueva.
# Va DESPUÉS de que el bundle y latest_version estén arriba — si no, tocan el cartel y no hay
# nada que bajar. La versión la lee de app_config, no se pasa por parámetro.
#   select net.http_post(
#     url := 'https://<proyecto>.supabase.co/functions/v1/push-actualizacion',
#     headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer <service_role>'),
#     timeout_milliseconds := 60000   -- ⚠️ obligatorio: el default de pg_net (5 s) no alcanza
#   );
# La respuesta llega a net._http_response: {"enviados":N,"fallidos":0,"omitidos":M}.

# Deploy PWA (solo web)
git push origin main           # dispara .github/workflows/deploy.yml
```

**Notas:**
- El `-Dorg.gradle.java.home` del JBR es necesario si salta `Unsupported class file major version 69`.
- Si falla `Keystore file not found`: en `keystore.properties`, `storeFile` debe ser
  **`launion.keystore`** (relativo al módulo `app`), **no** `app/launion.keystore`.
  `GUIA_APK_ANDROID.md:230` dice lo contrario y **está mal**; la que funciona es `:320`.
- `npm run lint` es `eslint . || true` — **nunca falla**. No sirve como verificación.
- **No hay tests en el repo.** No inventar un framework de testing sin que el usuario lo pida.

---

## 4. Mapa del código

| Ruta | Qué hay |
|---|---|
| `src/App.jsx` | Ruteo por rol+plataforma. **`decidirSupervisionMovil()` (:102) es el único lugar que sabe esta regla** |
| `src/context/` | Auth, Catalog (+ arranca las colas), Gps, Device, Theme |
| `src/features/supervision/` | `SupervisionMovil` (APK, full-screen) y `SupervisionDesktop` (PWA/PC) |
| `src/features/{vendedor,repartidor,propietario,admin,auth,catalog,perfil,movil}/` | Vistas por rol |
| `src/services/geolocation/` | 🔴 **Zona peligrosa.** `tracker.js`, `estados.js`, `index.js`, `dwell.js` |
| `src/services/sync/` | 🔴 **Zona peligrosa.** `queue.js` (posiciones), `writeQueue.js` (catálogo), `realtime.js` |
| `src/services/persistence/` | Puerto localStorage (web) / SQLite (nativo), con timeouts y fallback |
| `src/services/{supabase,ota,tracking,battery,download,recorridos}.js` | Servicios sueltos |
| `src/services/{maps,routing,report}/` | Basemaps (Stadia/OSM), OSRM, export PNG |
| `src/lib/` | `format.js` (**`hoyStr`**), `sx.js`, `glass.js`, `colors.js`, `uid.js` |
| `src/hooks/` | `usePublishPosition`, `useRecorridosDelDia`, `useEquipoEnVivo`, `useEstadoDispositivo`… |
| `db/` | ⚠️ Histórico, **no** fuente de verdad. Leer `00_LEER_PRIMERO.md` |
| `supabase/functions/snap-recorridos/` | Edge Function: recorridos pegados a calles (OSRM **foot**) |
| `android/app/src/main/java/com/launion/app/` | 3 plugins nativos escritos a mano |
| `patches/` | Patch de background-geolocation (4 cambios, todos necesarios) |

### Dónde tocar para…

| Quiero… | Ir a |
|---|---|
| Agregar una vista o cambiar quién ve qué | `src/App.jsx` (`decidirSupervisionMovil`) + **`src/lib/gestion.js`** (`GESTION_ITEMS`, un solo lugar desde el 28/07/2026: antes estaba duplicado en las dos supervisiones) + el despacho `{gestion === 'x' && …}` en `SupervisionMovil.jsx` **y** `SupervisionDesktop.jsx` |
| Dar una capacidad extra a alguien sin cambiarle el rol | `perfiles.permisos` + el campo `permiso` de la fila en `src/lib/gestion.js` + la policy correspondiente (ver `db/23_perfiles_permisos.sql`) |
| Agregar un campo a cliente/producto | Migración en la base viva + `mapCliente`/`mapProducto` en `CatalogContext.jsx:18-48` + el form correspondiente |
| Agregar un tipo de mutación offline | `src/services/sync/writeQueue.js` — la op debe ser **idempotente** en reintento |
| Cambiar la frecuencia/precisión del GPS | `src/services/gpsConfig.js` (constantes) y `geolocation/estados.js` (presets). Leer antes las reglas 11 y 16 |
| Cambiar el proveedor de ruteo | `src/services/routing/index.js` — es el único punto de swap, por diseño |
| Agregar una capa de mapa | `src/services/maps/basemap.js` |
| Hacer un modal, sheet o cualquier overlay | **`src/components/Overlay.jsx`** — nunca escribir uno a mano (ver §7) |
| Un radio, tamaño de fuente, espaciado o z-index | Tokens de `src/index.css` (`--r-*`, `--fs-*`, `--sp-*`, `--z-*`). **Nunca un literal** |
| Cambiar cuándo aparece el aviso de actualización | `src/components/UpdatePrompt.jsx` (web y nativo se bifurcan ahí) |

---

## 5. Zonas peligrosas

**`src/services/geolocation/`** — Cada guarda existe por un bug de campo. Antes de cambiar algo acá,
leer los comentarios del archivo completo. El GPS **no se apaga nunca en reposo** (`estados.js:15-29`
explica por qué); el plugin tiene un piso de adquisición que no se toca desde JS.

**`src/services/sync/`** — Idempotencia y reintentos. Las dos colas cortan al primer lote fallido y no
pierden nada. El trigger de `visibilitychange` es el despertar crítico: los WebViews en background
congelan timers y eventos `online`.

**`db/`** — Ver reglas 5 a 9. Toda migración nueva va contra la base viva y se versiona como archivo
**nuevo** con número siguiente; **no** editar los existentes.

**`android/`** — Los tres `.java` propios, el manifest y el patch son artesanales. `cap sync` es
seguro; `cap add` no.

**`src/services/supabase.js`** — Tiene un `lock` custom que reemplaza `navigator.locks` porque el
WebView de Android colgaba `getSession()` para siempre ("Cargando…" eterno). No revertir.

---

## 6. Versionado y release

Hay varios números que conviven. Alineados en **1.8.0** (agosto 2026).

| Número | Dónde | Valor actual | Para qué |
|---|---|---|---|
| `APP_VERSION` | [src/version.js:6](src/version.js#L6) | `1.8.0` | Se compara con `app_config.latest_version`; se reporta en `estado_dispositivo.app_version` |
| `versionName` | [android/app/build.gradle:17](android/app/build.gradle#L17) | `1.8.0` | Versión visible del APK |
| `versionCode` | [android/app/build.gradle:16](android/app/build.gradle#L16) | `26` | Entero incremental de Android |
| `app_config.bundle_version` | Supabase | — | Qué bundle OTA deben bajar los teléfonos |
| `app_config.min_version` + `apk_url` | Supabase | `1.0.0` / `null` | Piso de reinstalación del APK + URL del `.apk`. Si un equipo tiene versión < `min_version`, la app baja el APK y lanza el instalador. **Inerte** hasta setear `apk_url`. Ver [GUIA_ACTUALIZACION_APK.md](GUIA_ACTUALIZACION_APK.md) |

**¿OTA o APK nuevo?**

| Cambio | Alcanza con OTA | Requiere APK nuevo |
|---|---|---|
| JS/CSS/React, lógica, vistas | ✅ | |
| Plugin nativo nuevo o actualizado | | ✅ |
| Cambio de permisos del manifest | | ✅ |
| Cambio en `capacitor.config.ts` | | ✅ |
| Código en `android/app/src/main/java/` | | ✅ |

> Al publicar un APK nuevo, publicar **también** la misma versión como OTA, para los que ya lo tienen
> instalado. Con el auto-updater (1.6.0+), la reinstalación del APK ya no es manual: ver
> [GUIA_ACTUALIZACION_APK.md](GUIA_ACTUALIZACION_APK.md).

---

## 7. Convenciones

- **Español** en todo: nombres, comentarios, UI, commits.
- **Los comentarios explican el *porqué*, no el qué.** Si se agrega una guarda defensiva, documentar
  qué bug la motivó y cuándo. Es el estándar del repo y hay que sostenerlo.
- **Sin router.** Renderizado condicional, ver §4.
- **Estilos**: `sx()` de `src/lib/sx.js` (convierte CSS string a objeto de estilo, para portar
  mockups del diseñador 1:1) + `glassSurface()` / `glassBlur` de `src/lib/glass.js` para los
  controles flotantes. **Tailwind 4 está instalado pero NO se usa** (cero utilidades en `src/`): el
  sistema visual real son las CSS custom properties de `src/index.css`. No empezar a mezclar clases
  de Tailwind sin decidirlo explícitamente.
- **Tokens, siempre.** Radios `--r-sm|md|lg|xl|pill`, tipografía `--fs-2xs…--fs-xl`, espaciado
  `--sp-1…--sp-6`, apilamiento `--z-map|chrome|popover|sheet|screen|modal|toast`. Antes de esto
  había 11 radios sueltos, 15 tamaños de fuente en decimales arbitrarios y 9 escalas de z-index que
  colisionaban entre sí. **Un z-index literal es un bug esperando pasar.**
- **Overlays**: todos salen de [`src/components/Overlay.jsx`](src/components/Overlay.jsx)
  (`variant="modal" | "sheet"`, más `contained` / `glass` / `dismissible`). Trae animación de entrada
  **y de salida**, Escape, scroll-lock con contador, ARIA, foco inicial y header/footer fijos con
  scroll solo en el cuerpo. **No escribir un overlay a mano.** Formularios: `Field` + `inputStyle` de
  `src/components/form.jsx` y los estilos de `src/lib/botones.js`.

  Dos gotchas del patrón, ambos costaron un bug real (19/07/2026):

  1. **El overlay tiene que seguir montado para animar su salida.** Si el padre lo envuelve en
     `{cond && <Overlay/>}`, el estado de "abierto" va **adentro** del hijo (`const [abierto,
     setAbierto] = useState(true)`), se cierra con `setAbierto(false)` y el padre limpia su estado
     recién en `onClose`. Un `return null` temprano en el hijo produce el mismo bug — ver
     `PermisoSiemprePrompt.jsx`, que separa "nunca mostrar" de "se cerró".
  2. **El contenido debe sobrevivir a la animación de salida.** Si el cuerpo deriva del estado que
     abre el overlay (`deliveries.find(d => d.id === modal)`), ese valor se vuelve `undefined` en el
     mismo frame en que se cierra y el cuerpo revienta. Retener el último valor en un ref — ver
     `mdView` en `RepartidorView.jsx`.
- **Animación**: keyframes `lu-*` de `src/index.css`, sin librerías. Entradas con
  `cubic-bezier(.23,1,.32,1)` (o la curva de drawer `cubic-bezier(.32,.72,0,1)` para sheets),
  siempre <300 ms y **solo sobre `transform` y `opacity`**. Las salidas usan la **misma** curva con
  menos duración — nunca `ease-in`. El estándar sale de la skill `/review-animations` (§9).
- **Leaflet a mano**, sin React-Leaflet.
- **Mutaciones de catálogo siempre por la write queue**, nunca `supabase.from().insert()` directo
  desde un componente.
- **Fechas locales con `hoyStr()`.**
- **Sin tests.** No agregar infraestructura de testing sin pedido explícito.

---

## 8. Pendientes conocidos

Checklist completo en [INFORME_AUDITORIA.md §9](INFORME_AUDITORIA.md). Los urgentes:

- 🔴 **Backup del keystore** (`android/app/launion.keystore` + las contraseñas de `keystore.properties`)
  fuera de la máquina. **Punto único de falla.** Android exige que toda actualización esté firmada con
  la MISMA llave que la app instalada; no estamos en Play Store, así que no hay respaldo de Google que
  valga. Si se pierde el archivo **o** se olvidan las contraseñas (`storePassword`/`keyPassword`/`keyAlias`):
  la OTA sigue viva, pero **ningún APK nuevo se puede instalar como actualización** — habría que hacer
  desinstalar+reinstalar en cada teléfono (se pierden datos locales: cola de posiciones, cuarentena,
  sesión). Respaldar YA: contraseñas en un gestor, el `.keystore` en 2 lugares privados (no repo público).
  Esto ahora también sostiene el auto-update del APK — ver [GUIA_ACTUALIZACION_APK.md](GUIA_ACTUALIZACION_APK.md).
- ✅ **`02_saas.sql` y `05_schema_real.sql`**: movidos a `db/historico/` el 29/07/2026, con un
  `LEER_ANTES_DE_TOCAR.md` al lado. Ya no están en el camino de un `psql -f` distraído.
- ✅ **Versiones desfasadas** (§6): alineadas en 1.6.0 (versionName 1.6.0 / versionCode 20 / APP_VERSION 1.6.0).
- ✅ **Rol `propietario` de punta a punta**: el CHECK lo acepta (`db/20`), `UsuariosView` lo ofrece y
  desde el 29/07/2026 `crear-usuario` también (v3 desplegada). Ya se puede dar de alta un
  propietario desde el modal.
- ✅ **Storage con alcance por empresa** (`db/25`, 29/07/2026): las policies de escritura eran
  `to authenticated` mirando solo el `bucket_id`, así que cualquier usuario de cualquier empresa
  podía borrar las fotos de otra. Ahora exigen ser dueño de la ruta. El **SELECT sigue abierto a
  propósito**: los buckets son públicos y el upsert lo necesita.
- 🔴 **`AdminView` es inalcanzable**: `AuthedApp` intercepta a los 6 roles antes de que
  `RoleRouter` llegue a su `return <AdminView/>`. Con él quedan muertos `RecorridosView`,
  `MapaOperativo` y `ReplayJornada` — y la pestaña "Catálogo" de `AdminView`, que además no tiene
  gate de rol. **Informe para decidir, revisado el 30/07/2026:**

  | Pantalla | Qué hace | ¿Se puede hacer hoy sin ella? | Veredicto |
  |---|---|---|---|
  | `RecorridosView` (140 líneas) | Recorridos del día de todos los móviles, con color por persona y refresco incremental. Usa `useRecorridosDelDia` + `fetchSnapRecorridos`. | **Sí, entera.** Es un subconjunto de lo que ya muestra `SupervisionDesktop`, con los mismos hooks. | **Borrar** |
  | `MapaOperativo` (145 líneas) | Cartera en el mapa + móviles en vivo + ficha de cliente + consola de eventos. Importa `DEPOSITO` de `data/demoGeo` (dato de demo). | **Casi.** La capa de clientes y los móviles ya están en las dos supervisiones. Lo único que no existe en ningún otro lado es la **consola de eventos**. | **Borrar**, y si la consola hace falta, rehacerla donde se use |
  | `ReplayJornada` (226 líneas) | Reproduce la jornada de una persona como una película: play/pausa, scrub, 1×–8×, y exporta PNG (`services/report/rutaPng`). | **No.** No hay nada equivalente vivo. | **Rescatar**: es la única con valor propio |

  Los datos de las tres están vivos (leen `posiciones` y la cartera), así que ninguna depende de
  algo que ya no se llene: es una decisión de producto, no de datos. Rescatar `ReplayJornada`
  significa colgarla del menú "Menú" (`GestionHost`), que es el único camino vivo.
- 🟠 **`clientes_codigo_key` es `UNIQUE (codigo)` GLOBAL**, no por empresa: dos distribuidoras no
  pueden usar el mismo código de cliente.
- 🟠 **`firmas_ins`** sigue siendo `to authenticated` sin alcance (el bucket de firmas de entrega).
  Hoy no muerde —la tabla `pedidos` está vacía y nadie firma nada— pero cuando arranque el módulo
  de entregas hay que darle el mismo tratamiento que `db/25`.
- 🟠 **9 columnas/objetos vivos sin versionar** en ningún `.sql` (`posiciones.bateria`,
  `perfiles.numero`, `zonas.numero`, `zonas.id_vendedor`, y las 5 ya listadas en `00_LEER_PRIMERO.md`).
- 🟠 **Key de Stadia** hardcodeada en `src/services/maps/basemap.js:13` — mover a `VITE_STADIA_KEY` y
  rotar. **No es Google Maps**: Google Maps es código muerto y `GUIA_API_KEY_GOOGLE_MAPS.md` está
  obsoleta. Si la key de Stadia vence, la app **no se rompe**: se queda con OSM y se ocultan las capas
  Oscuro y Satélite. Ver [INFORME_AUDITORIA.md §7.1](INFORME_AUDITORIA.md).

### Docs obsoletas — no confiar

- `README.md` — menciona un componente `GoogleMap` que no existe; omite `CAP_BUILD=1`.
- `GUIA_APK_ANDROID.md` — describe OAuth por browser (ya es nativo), tiene TODOs ya hechos, y se
  contradice sobre `storeFile` (`:230` mal, `:320` bien).
- `GUIA_API_KEY_GOOGLE_MAPS.md` — obsoleta, nada del código lee esa variable.

---

## 9. 🔧 Herramientas / skills externas

Repos que el usuario vaya pasando para pulir el SaaS. **Sección viva: agregar acá cada uno.**

Formato:

```markdown
### <nombre>
- **Repo:** <url>
- **Para qué:** <en una línea>
- **Cómo se usa:** <comando / skill / MCP>
- **Aplica a:** <PWA | APK | DB | diseño | CI>
- **Notas:** <gotchas, versión, config requerida>
```

<!-- ── Agregar herramientas debajo de esta línea ── -->

### 🎨 Skills de diseño — cuándo usar cada una

Están instaladas en **`.claude/skills/`** (versionadas: `.gitignore:34-36` ignora `.claude/*` pero
**exceptúa** `skills/`) y también en `~/.claude/skills/` para el resto de los proyectos.

**Reglas operativas — no son opcionales:**

| Vas a… | Corré primero |
|---|---|
| Tocar cualquier UI existente | `/impeccable audit <pantalla>` |
| Tocar cualquier animación o transición | `/review-animations` |
| Diseñar una pantalla o componente **nuevo** | `/ui-ux-pro-max` |
| Planificar una tanda grande de arreglos de motion | `/improve-animations` |

> ⚠️ La app **no usa Tailwind** (está instalado y sin consumidores) ni librerías de animación. Las
> skills van a proponer `framer-motion`, `tailwind` y `shadcn/ui` por defecto: **traducir siempre a
> lo que el repo usa de verdad** — CSS vars en `src/index.css`, keyframes `lu-*`, `sx()` y estilos
> inline (§7). Tomar de las skills el *criterio* (curvas, duraciones, jerarquía, espaciado), no el
> stack.

#### ui-ux-pro-max
- **Repo:** https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
- **Para qué:** base de datos consultable de diseño — 84 estilos, 192 paletas, 74 pairings
  tipográficos, 98 guías UX, presets de motion.
- **Cómo se usa:** `/ui-ux-pro-max`, o directo el CLI:
  `python .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain product|style|color|ux|typography`
  y `--design-system` para generar un sistema completo.
- **Aplica a:** diseño (PWA + APK).
- **Notas:** verificado con **Python 3.13 en Windows** (18/07/2026), sin dependencias externas. Es la
  única de las tres que necesita Python.

#### impeccable
- **Repo:** https://github.com/pbakaus/impeccable
- **Para qué:** matar el "AI slop" — jerarquía visual, densidad, espaciado, decisiones intencionales.
- **Cómo se usa:** un solo skill con subcomandos. Los útiles acá: `/impeccable audit`,
  `/impeccable polish`, `/impeccable critique`, `/impeccable distill`, `/impeccable animate`.
- **Aplica a:** diseño (PWA + APK).
- **Notas:** los scripts son `.mjs` y necesitan **Node** (v24 en la máquina, ya está por el proyecto).
  `/impeccable init` escribe `PRODUCT.md` y `DESIGN.md` en la raíz — **no correrlo sin avisar**, mete
  archivos nuevos en el repo.

#### emilkowalski (6 skills)
- **Repo:** https://github.com/emilkowalski/skills — el oficial de Emil Kowalski.
- **Para qué:** la autoridad de motion del repo. `src/index.css:164-166` ya lo cita por nombre: el
  estándar de animación del proyecto sale de acá.
- **Cómo se usa:**
  - `/review-animations` — revisa motion contra el estándar. **`disable-model-invocation: true`**:
    hay que invocarla a mano, no se auto-activa.
  - `/improve-animations` — auditoría + plan priorizado. Read-only, no aplica cambios.
  - `/find-animation-opportunities` — dónde *falta* animación. Read-only.
  - `/emil-design-eng` — filosofía general de pulido de UI.
  - `/apple-design` — gestos, springs, sheets, materiales translúcidos. Relevante para el
    bottom-sheet de `SupervisionMovil` y el chrome glass.
  - `/animation-vocabulary` — glosario inverso ("¿cómo se llama el efecto de…?").
- **Aplica a:** diseño (sobre todo APK — el chrome de `SupervisionMovil` es todo motion).
- **Notas:** son las más chicas (128 KB las 6) y las más alineadas con el repo. Cero dependencias.

---

## 10. MCPs disponibles en este proyecto

- **Supabase** — usarlo para consultar la base viva en vez de asumir desde los `.sql` (regla 5).
  `list_tables`, `execute_sql`, `get_advisors`, `apply_migration`, `get_logs`.
- **Notion, Gmail, Calendar, Canva, Netlify, Firebase** — conectados, sin uso actual en el proyecto.

> Antes de responder cualquier pregunta sobre el estado del esquema, RLS, políticas o datos:
> **consultar la base viva vía MCP**, no los archivos `db/`.
