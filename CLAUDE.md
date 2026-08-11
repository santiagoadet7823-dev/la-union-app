# CLAUDE.md — DisT-At

Guía operativa del repo. **Leer completo antes de tocar nada.**

Documentos complementarios:
- [HANDOFF.md](HANDOFF.md) — pendientes y deudas por prioridad, estado del login, términos, y el
  **entorno completo** (toolchain, emulador, skills, MCPs, cuentas). Es el documento para retomar en
  otra máquina o en una sesión nueva. ⚠️ **§7 es urgente y tiene fecha de vencimiento**: el parque se
  unifica a Samsung A07 y hay una decisión (Device Owner) que después de configurar el primer teléfono
  cuesta un factory reset por equipo. Incluye el checklist de la sesión de USB (§7.7), que es lo que
  destraba todo lo que el emulador no puede probar, y **§7.9 — la ruta de MDM elegida (Headwind
  self-hosted) y, sobre todo, el orden**: el servidor va en un VPS con dominio **antes** de que
  lleguen los teléfonos, nunca en una PC. Ponerlo en una PC obliga a re-inscribir, y re-inscribir es
  factory reset.
- [INVENTARIO_TELEFONOS.md](INVENTARIO_TELEFONOS.md) — el mapa **serial ↔ cuenta ↔ IP de Tailscale**
  de los 9 teléfonos del parque, qué se le dejó puesto a cada uno, cómo conectarse en remoto y cómo
  agregar uno nuevo. 🔴 Incluye la trampa que costó la sesión del 08/08: **configurar el teléfono no
  lo pone a rastrear** — sin pasar el gate de GPS no hay token, y sin token no hay puntos por más
  impecable que se vea el `dumpsys`.
- [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md) — arquitectura, deuda técnica y riesgos (rev. 3,
  04/08/2026, sobre 1.10.0).
- [ESTRUCTURA_PROYECTO.md](ESTRUCTURA_PROYECTO.md) — qué es cada archivo de la carpeta, y qué es
  esencial vs. archivable.
- [DOCUMENTACION_FUNCIONAL.md](DOCUMENTACION_FUNCIONAL.md) — qué hace cada función y de qué rol es.
  **Empezar por acá** para saber qué está vivo, qué es demo y qué es código muerto.
- [PLAN_SAAS.md](PLAN_SAAS.md) — migración planificada a `corporaciones → empresas`.
- [legal/](legal/) — borradores de términos y condiciones y de política de privacidad.

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

`superadmin` · `admin` · `encargado` · `vendedor` · `repartidor`

`encargado` es dual: se lo trackea por GPS **y** supervisa.

> 🩸 **`propietario` se eliminó el 10/08/2026 (`db/31`).** Existió del 27/07 al 10/08 y **nunca tuvo
> un solo perfil**: era un rol entero —CHECK, 8 policies RLS, 1 RPC y media docena de listas de UI—
> mantenido para nadie, y cada policy nueva tenía que acordarse de incluirlo o el dueño perdía
> acceso en silencio. **El dueño de la distribuidora usa `admin`**, que ya figuraba en las mismas 8
> policies con los mismos permisos de lectura, así que la migración fue una resta pura.
> Lo que **no** se tiró fue su pantalla: es `features/direccion/PanelDireccion.jsx`, y ahora la ve
> `admin`/`superadmin` **en web/PWA desde un celular** (ver `decidirPanelDireccion` en `App.jsx`).

**Qué pantalla ve cada quien:**

| Rol | APK (nativo) | PWA en celular | PWA en PC |
|---|---|---|---|
| `vendedor` / `repartidor` | `VendedorView`/`RepartidorView` + `GpsGate` | idem | idem |
| `encargado` | `SupervisionMovil` (Panel) · `VendedorView` (Mi jornada) | `SupervisionDesktop` | `SupervisionDesktop` |
| `admin` / `superadmin` | `SupervisionMovil` | **`PanelDireccion`** | `SupervisionDesktop` |

El corte celular/PC lo da `useDevice().isMobile` (ancho + puntero + userAgent, con override manual
en Mi cuenta). ⚠️ **El override vive en `localStorage['lu-device']` y es pegajoso**: si alguien eligió
"Celular" alguna vez, ese navegador entra al `PanelDireccion` aunque esté en una pantalla de 1280 px.
Por eso `PanelDireccion` pasa `showDeviceToggle` a `MiCuenta` — sin eso quedaría encerrado.

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
    conectado y eso bloqueaba **todas** las subidas. El comentario que lo explica está en
    [`sync/queue.js`](src/services/sync/queue.js), dentro de `flushPosiciones` — buscar
    `navigator.onLine`, no ir por número de línea (la referencia vieja, `:66-69`, hoy apunta al bloque
    de desborde).
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
37. **El pin animado se compara contra el ÚLTIMO DESTINO MANDADO, nunca contra `getLatLng()`.**
    (03/08/2026.) `getLatLng()` a mitad de una animación devuelve el fotograma actual, y el efecto
    de pines se dispara con el latido de CUALQUIERA del equipo (`kMarkers` lleva el `ts` de todos y
    el `selected`): cada pin en vuelo se encontraba "fuera de lugar" y reiniciaba su tramo con 6 s
    nuevos desde la mitad, así que no terminaba de llegar nunca. Peor con el tramo pegado a calles:
    OSRM termina en el punto ENCAJADO a la calle, a metros del dato, así que la comparación daba
    verdadero para siempre. El destino vive en `pinesRef` (`lat`/`lng`) y `ts` avanza SOLO cuando el
    destino cambió — si avanzara con los latidos de cortesía, el `dt` del próximo tramo se mediría
    desde algo que no movió el pin. Ver `LeafletMap.jsx`.
39. 🩸 **El snap no rutea evidencia que no tiene: se mide el TIEMPO del salto, no la distancia.**
    (ALGO 9, 03/08/2026.) Con "Calles" prendido, el trazo dibujado medía **×1,63 · ×1,48 · ×1,75**
    el crudo del mismo día en los tres vendedores: entre el 48 % y el 75 % del recorrido lo estaba
    inventando OSRM, y eso era el "zigzag" que reportó el cliente. El motor era el correcto (regla
    38); lo que fallaba era la ENTRADA — el teléfono se callaba de a 1-5 minutos y `/route` entre
    dos puntos así no reconstruye nada, elige el camino más corto y teje por calles por las que
    nadie pasó. **La primera versión de la guarda miraba la separación mediana en METROS y no habría
    atajado ni un caso**: la mediana de ese día es 7,8 m, porque los racimos de cuando está parado la
    hunden. En ruta 130 m entre puntos se hacen en 5 s y OSRM da ×1,003; en el pueblo 200 m tardan
    100 s, y ahí no hay nada que reconstruir. Calibración medida sobre los cuatro teléfonos del día
    (80,6 % · 23,3 % · 9,0 % · 0,4 % del largo a ciegas): el umbral de 35 % deja pasar a los tres
    que andan bien y frena al que está fallando. Y **el anti-detour ×2,5 no rechazaba NADA** — una
    guarda que nunca actúa no es una guarda. Ver `fraccionCiega` en `segmentar.ts`.
49. 🩸 **"¿Sabemos qué pasó en el medio?" se contesta con UN número, y hoy son tres.** (10/08/2026.)
    El cliente reportó que el trazo "salta calles" en tres vendedores. **No era el snap inventando**:
    con el `fraccionCiega` real, Gabriel ya iba **72 % crudo** y Javier **57 %** — la guarda ya los
    rechazaba. Lo que cruzaba manzanas eran **las rectas del crudo**, porque el snap declaraba ciego
    un hueco de 45 s (`HUECO_CIEGO_MS`) mientras el dibujo recién cortaba a los 4 min (`HUECO_MS`).
    El snap decía "no sé" y el dibujo decía "fue por acá": ganaba el que miente. Desde hoy
    `HUECO_DUDOSO_MS` (`lib/geo.js`) parte el DIBUJO a los 45 s — el recorrido no se corta y los km
    no cambian (salen de `puntos`), solo se deja de afirmar el camino.
    ⚠️ **Son constantes en dos runtimes** (Deno y el bundle) que no pueden compartir módulo: si se
    toca una, tocar la otra. `HUECO_MS` sigue espejando a `GAP_MS`, que responde otra pregunta
    ("¿esto es otro tramo?") y **no se toca**.
    🩸 **Y el corte del dibujo lleva DOS condiciones, no una: tiempo Y distancia** (misma fecha, esa
    tarde). Con solo el tiempo, el corte disparaba sobre saltos que no habían recorrido nada — con la
    cadencia lenta (30 s) **un solo fix perdido ya son 60 s**, así que cualquier hipo del chip estando
    parado partía el trazo. Medido sobre la jornada del 10/08, cortes de menos de 9 m sobre el total:
    Alejandro mercado 27/27, Orlando chavez 42/43, **Agustin Vasquez 181/189 — y Agustin es el equipo
    más sano del parque, con CERO metros dudosos de 50 m o más.** El vendedor que mejor funciona era
    el que peor se veía. **Una recta de 3 m no cruza una manzana**: no había mentira que prevenir,
    solo confeti. Va el piso de `MIN_MOVE_M` (9 m), la misma constante del piso de `kmDePuntos` y del
    filtro de captura nativo. Verificado con el código real sobre la jornada de Zura: **26 → 9
    segmentos y 341,0 → 336,3 m punteados** (se dejan de declarar 4,7 m), con los km idénticos hasta
    el sexto decimal.
    ⚠️ **El que espeja a `segmentar.ts` es el umbral de TIEMPO, y ése no cambió**: la guarda de
    distancia es solo del dibujo y la Edge Function no se toca. Del lado del snap ya era inmune por
    construcción — un hop ciego de 3 m aporta ~0 a `fraccionCiega`, que mide LARGO ruteado a ciegas.
    🩸 **Y antes de cambiar un umbral, contrastar la hipótesis contra los datos.** En la misma sesión
    se probó bajar `CIEGO_MAX_FRAC` de 0,35 a 0,30 (cero tramos cambiados en 7 días: la fracción
    ciega es bimodal) y subir `VEL_HIST_MS` a 45 s (refutado: Gabriel da 3 % de cruces de umbral en
    los huecos contra 2,8 % en los tramos normales, y además sus huecos pasan **caminando**, lejos
    del umbral). Las dos se revirtieron sin publicar. Tres cambios de constante de GPS en la
    historia del repo, tres teorías plausibles e incompletas.
40. **Un punto TRIANGULADO no se dibuja ni se cuenta como GPS.** (1.9.0.) Desde el APK 1.9.0, con el
    GPS callado más de 90 s el teléfono pide ubicación por antenas y WiFi. Esos puntos entran a
    `posiciones` con `accuracy` de 20 a 150 m, y **la precisión ES la marca** (hasta 1.8.1 no existía
    un solo punto con accuracy > `ACCURACY_MAX_M`, así que no hizo falta columna nueva). Valen para
    "por acá anduvo" y para nada más: van punteados, **fuera de los km, fuera del snap y fuera de la
    burbuja en vivo** (`ultimas_posiciones` los filtra, `db/28`). Cambiar un hueco honesto por una
    línea llena inventada es el mismo error que cometía el snap.
48. 🩸 **Avisar no es actualizar: la OTA se descarga SOLA.** (08/08/2026.) Hasta 1.12.0 el aparato de
    despliegue estaba completo —tres canales, `app_config`, push— y aun así el parque no se movía:
    1.12.0 salió, se enviaron **17 notificaciones sin una sola falla**, y tres horas después los
    **9 teléfonos seguían en 1.11.0**, incluido el único que estaba online y había recibido el aviso.
    El cartel pedía un toque que nadie da — un vendedor en la calle no abre la app para actualizarla,
    y con razón: no es su trabajo. Desde 1.12.1 el despertar del watchdog (`updateNotify.js`) y el
    arranque (`UpdatePrompt`) **descargan el bundle solos** y recién entonces avisan "ya está lista,
    tocá para abrir".
    **No se fuerza `reload()`**: `otaDownload` encola con `next()` y se aplica en el próximo arranque.
    Recargar el WebView mientras alguien está a mitad de un check-in le borra la pantalla, y ninguna
    actualización vale eso. El cartel sobrevive **solo para lo que sí necesita una persona**: el
    diálogo del instalador de Android, el permiso de "instalar apps desconocidas" y los errores de
    descarga.
    ⚠️ **`autoUpdate` de Capgo sigue en `false` y así debe quedar** (`capacitor.config.ts`): ese flag
    descarga desde el backend de Capgo, y este proyecto es self-hosted contra `app_config`.
    ⚠️ **La red de contención es `notifyAppReady()`** (regla 2): si un bundle no llega a llamarlo,
    Capgo revierte. Eso cubre un bundle que revienta al arrancar — **no** uno que arranca bien y
    rompe algo adentro. Con la aplicación automática, ese caso llega a los 9 teléfonos sin que nadie
    lo toque: verificar en el emulador antes de publicar dejó de ser opcional.
    🩸 **Y todo lo que se descargue solo necesita un freno, medido en datos móviles del empleado.**
    `apkCheck()` sigue devolviendo el mismo APK mientras la instalada esté bajo `min_version`, y esa
    condición NO se levanta cuando termina la DESCARGA sino cuando termina la INSTALACIÓN — que en
    los equipos que no son su propio instalador de registro espera al diálogo de Android, o sea que
    puede tardar la jornada entera. Sin freno, cada despertar del watchdog volvía a bajar los
    **21,7 MB** del `.apk`: ~20 despertares son **~430 MB por día y por teléfono**, en silencio.
    `updateNotify.js` recuerda el último intento por versión (`APK_REINTENTO_MS`, 6 h) y distingue
    los dos fracasos: si la descarga **tira**, no gastó datos y se reintenta enseguida; si **resuelve**
    y la instalación queda pendiente, los datos ya se gastaron y reintentar no acelera nada.
    **Antes de automatizar una descarga, calcular MB × despertares × teléfonos.**
47. 🩸 **Una capa de Leaflet que NO está agregada al mapa no puede responder `getBounds()`.**
    (08/08/2026.) El encuadre hacía `L.circle([lat,lng],{radius}).getBounds()` sobre un círculo
    suelto para meter el geocerco del cliente en el `fitBounds`. Un `Circle` guarda su radio en
    METROS y solo sabe pasarlo a grados con un mapa: `getBounds()` llama a
    `this._map.layerPointToLatLng(...)` y ahí `_map` es `undefined`. Reventaba con *"Cannot read
    properties of undefined (reading 'layerPointToLatLng')"*, el `ErrorBoundary` tapaba el mapa con
    **"No se pudo cargar el mini-mapa"**, y el único lugar donde se veía era la ficha de un cliente
    YA ubicado — o sea la pantalla desde la que se corrige una ubicación, con la cartera casi entera
    sin geolocalizar. Lo que hay que usar es `L.latLng(lat,lng).toBounds(radio*2)`, que no necesita
    mapa (ojo: toma el LADO, no el radio). Vale para cualquier capa: `Circle`, `Marker` y
    `Polyline` solo saben proyectar cuando están montadas.
    **Y todo `setTimeout`/`rAF` que toque el mapa se cancela al desmontar**: el
    `setTimeout(invalidateSize, 60)` del init no se limpiaba, y sobre un mapa ya destruido tiraba
    `_leaflet_pos` — una excepción ASINCRÓNICA, que ningún ErrorBoundary puede atajar, y que
    convertía un fallo acotado en una pantalla en blanco.
41. **El enganche de la cámara es un EVENTO, no una coordenada.** (03/08/2026.) "Hago zoom, toco
    centrar y el seguimiento ya no funciona": el efecto de `seguir` en `LeafletMap` dependía solo de
    `[lat, lng]`, y apretar el botón no cambia la posición de nadie — así que **no corría nunca**. Y
    si corría, delegaba la cámara a la animación del pin, que solo existe cuando el pin se mueve: con
    la persona parada el botón no hacía absolutamente nada. Va un `nonce` sellado al apretar (mismo
    patrón que `focus.nonce`) y en el enganche SIEMPRE encuadra con `flyTo`.
42. 🩸 **Un foreground service de ubicación TOMA UN WAKELOCK PARCIAL, y no re-pide updates a cada
    rato.** (1.9.0.) `WAKE_LOCK` estaba declarado en el manifest desde el primer día y **no se usaba
    en ninguna parte**: el tipo `location` exime de los límites de background pero NO impide que el
    SO suspenda la CPU en Doze, y ahí la callback de FusedLocation no corre. Medido: silencios de
    **7 minutos estando parado**, con precisión de 2,8 m y los contadores de descarte en cero. Y cada
    `requestLocationUpdates` **reemplaza el request y reinicia la agenda de entrega**: hasta 1.8.1 se
    re-pedía aunque el intervalo fuera el mismo, y con AR confundiendo "a pie" con "bicicleta" eso
    pasaba cada 20-30 s. Pedir más seguido no es recibir más seguido — el teléfono que corrió el
    5 s / 2 s pasó de 0,9 % a **24 %** de huecos de más de un minuto.
38. **El snap elige el MOTOR por modo, y el modo lo decide `splitModo`.** (ALGO 8, 03/08/2026.)
    Peatón → `routed-foot`; vehículo → `routed-car`. Medido con el mismo rastro real: en un tramo de
    ruta el perfil auto da ×1,003 del crudo y el peatón ×57; en un tramo a pie el peatón da ×1,48 y
    el auto ×4,5. La guarda anti-detour (×2,5) es la red por si el modo se equivocó, no el
    mecanismo. `/match` sería mejor algoritmo pero el host público lo rechaza por tamaño (medido:
    `TooBig` con 20 puntos) — habilitarlo requiere OSRM propio.
36. **La ventana de rastreo está implementada TRES veces y nada las sincroniza**: `dentroDeHorario()`
    (`services/tracking.js`), `VentanaRastreo.dentro()` (Java) y `en_ventana`
    (`vigilancia_equipo`, SQL). Tocar una sin las otras no rompe nada visible: hace que los avisos
    al supervisor **mientan en silencio**. Desde 1.8.0 la semántica es de **unión** — varias
    categorías por persona, se rastrea si cualquiera aplica (jornada partida).
    En 1.11.0 el parser de Java salió de `UploaderGpsService` a **`VentanaRastreo.java`** sin cambiar
    una sola regla, porque hacía falta calcular el **próximo inicio** de ventana (para la alarma del
    arranque). **`proximoInicio()` es un BARRIDO minuto a minuto sobre la misma `dentro()`, no una
    fórmula** — a propósito: una derivación analítica sería una CUARTA implementación con licencia
    para divergir, y hay un caso que casi seguro traduciría mal (una ventana `22:00–06:00` con
    `dias=[1]` está activa el lunes 22:00–23:59 **y** el lunes 00:00–06:00, porque el día se evalúa
    en el instante mirado, no en el de apertura). Si alguna vez parece lento, la respuesta NO es
    hacerlo analítico.
46. 🩸 **Fuera de horario el servicio de GPS se PAUSA, no se apaga** (1.11.0). Hasta 1.10.0 hacía
    `stopSelf()`, y eso era la causa del "le asigno las 8 y a veces no inicia": el watchdog despertaba
    a las 07:52, arrancaba el servicio, el servicio se suicidaba a los 30 s y **el turno se quemaba**
    — la próxima alarma quedaba a las 08:22. Medido sobre 29 días hábiles: **mediana de 51 min** de
    retraso en el primer punto, 79 % de los días con más de 15. Y en el caso peor no arrancaba en
    todo el día, porque Android 12+ prohíbe iniciar un foreground service desde background salvo
    exenciones y la excepción se tragaba en un `catch` vacío. Pausar elimina la clase entera de fallo
    (no hay que arrancar lo que nunca se apagó) y devuelve a `START_STICKY` su sentido: hasta ahora
    era decorativo, porque el SO no reinicia un servicio que se detuvo **solo**.
    ⚠️ **El cierre de sesión sigue siendo un apagado de verdad** (`stopService()` desde el plugin).
    Si alguien lo convierte en pausa, vuelve el bug incorregible de la regla 19-bis: el token es la
    identidad y `posiciones` no tiene policy de UPDATE ni de DELETE.
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

43. **Si hace falta probar la app, se prueba — no se le pide al usuario que lo haga.** El emulador de
    Android está instalado (§3); si no está corriendo, se levanta. Sirve para lo que se ve y se
    toca: interfaz, botones, overlays, el trazo en el mapa, y **los canales de notificación**. Y si
    la sesión de la **PWA** está cerrada, se abre el navegador y **se le pide al usuario que loguee
    la cuenta de superadmin**: Claude no puede escribir credenciales en ningún campo, así que el
    login lo hace la persona y desde ahí sigue la verificación.

    **Techo honesto del emulador**: no tiene GPS real, ni Doze, ni los killers de los fabricantes.
    **No sirve para probar nada de `UploaderGpsService`** — eso se verifica en la calle, con la
    consulta de huecos contra la base, y no hay atajo. La imagen es `google_apis` y no `default`
    justo porque sin Play Services no hay FCM, que es lo único que de verdad se puede probar acá.
44. 🩸 **Un `channel_id` de notificación se manda SOLO a los teléfonos que ya tienen ese canal.**
    (04/08/2026.) Hasta 1.9.0 la app **no declaraba ningún canal** y las tres funciones mandaban el
    bloque `notification` **sin `channel_id`** — a propósito, porque el canal lo creaba
    `AlarmWatchdogPlugin.notificar()` recién al notificar y apuntar a un canal inexistente en
    Android 8+ hace que la notificación **no se muestre**. El razonamiento era correcto y la
    solución no: sin canal por defecto, FCM cae en su canal de reserva ("Miscellaneous"), que no es
    de importancia alta y que varios OEM silencian de fábrica. Eso explica **las dos mitades** del
    "no me llegan las notificaciones y a los usuarios tampoco la de actualizar": los dos avisos
    viajan por el mismo camino. Desde 1.10.0 los canales (`avisos` HIGH, `actualizaciones` DEFAULT)
    se crean en `LaUnionApp.onCreate()` y el manifest declara `default_notification_channel_id`.
    **Pero el parque es mixto**: mandarle `channel_id` a un teléfono en 1.9.0 lo dejaría MUDO, así
    que se decide por teléfono mirando `estado_dispositivo.app_version`. Y ojo: **un canal es
    inmutable una vez creado** — por eso el de los avisos es nuevo y no se reusó "actualizaciones".
45. **Con la app ABIERTA, el cartel lo tiene que dibujar la app.** El plugin de Capacitor no postea
    nada al recibir un push: reenvía el mensaje al JS y espera. Hasta 1.9.0 `push.js` solo miraba
    `tipo === 'actualizacion'`, así que **mientras el supervisor tenía la app abierta mirando el
    mapa —el caso más común— los avisos del equipo se perdían en silencio**, contados como
    "enviados" en el servidor. Android entrega el push al sistema solo con la app en background.

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

# ── Emulador de Android (regla 43) ────────────────────────────────────────────
# Instalado el 04/08/2026: cmdline-tools + system-images;android-34;google_apis;x86_64 + AVD "launion".
# ⚠️ google_apis y NO default: sin Play Services no hay FCM, que es lo único que sirve probar acá.
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd launion -no-snapshot -no-boot-anim
# Esta máquina no tiene GPU utilizable por el emulador (Mesa/Vulkan lo cuelga) y le quedan 2 cores,
# así que hay que forzar render por software — y el arranque tarda MUCHO (10+ min):
#   ... -gpu swiftshader_indirect -feature -Vulkan          # con ventana
#   ... -no-window -no-audio -gpu swiftshader_indirect      # headless, para adb/dumpsys
# Si dice "Running multiple emulators with the same AVD", quedó un proceso colgado:
#   powershell -Command "Get-Process qemu-system-x86_64* | Stop-Process -Force"
adb devices                    # "offline" = todavía booteando; "device" = listo
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell dumpsys notification --noredact | grep -i channel   # en qué canal cayó un push
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
| `src/App.jsx` | Ruteo por rol+plataforma. **`decidirSupervisionMovil()` y `decidirPanelDireccion()` son el único lugar que sabe esta regla** |
| `src/context/` | Auth, Catalog (+ arranca las colas), Gps, Device, Theme |
| `src/features/supervision/` | `SupervisionMovil` (APK, full-screen) y `SupervisionDesktop` (PWA/PC) |
| `src/features/direccion/` | `PanelDireccion` — admin/superadmin en web+celular (el dueño desde su iPhone) |
| `src/features/{vendedor,repartidor,admin,auth,catalog,perfil,movil}/` | Vistas por rol |
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
| Agregar una vista o cambiar quién ve qué | `src/App.jsx` (`decidirSupervisionMovil` / `decidirPanelDireccion`) + **`src/lib/gestion.js`** (`GESTION_ITEMS`) + **`features/supervision/components/DespachoGestion.jsx`** — el despacho estaba copiado en las dos supervisiones y se unificó el 10/08/2026, antes de que `PanelDireccion` lo volviera una tercera copia (regla 31) |
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

Hay varios números que conviven. **1.13.1** es OTA-solo (JS): `APP_VERSION` y el bundle van en 1.13.1; el APK sigue en 1.13.0 (agosto 2026). ⚠️ 1.13.0 es un cambio NATIVO (el ancla del uploader): sale por APK, y hay que publicar la misma versión como OTA para los que ya lo tienen.

> 🩸 **Esta tabla se desincronizó en 3 de 3 releases** (decía 1.6.0 cuando era 1.6.3; decía 1.8.0
> cuando era 1.10.0). Es el documento que más se lee y mentía sobre la versión. **Actualizarla es un
> paso del release, no un "después lo arreglo":** va junto con el `UPDATE` de `app_config`.

| Número | Dónde | Valor actual | Para qué |
|---|---|---|---|
| `APP_VERSION` | [src/version.js](src/version.js) | `1.13.2` | Se compara con `app_config.latest_version`; se reporta en `estado_dispositivo.app_version` |
| `versionName` | [android/app/build.gradle](android/app/build.gradle) | `1.13.0` | Versión visible del APK |
| `versionCode` | [android/app/build.gradle](android/app/build.gradle) | `32` | Entero incremental de Android |
| `app_config.bundle_version` + `latest_version` | Supabase | `1.13.2` ✅ publicado | Qué bundle OTA deben bajar los teléfonos |
| `app_config.min_version` + `apk_url` | Supabase | `1.13.0` ✅ publicado (1.13.1 es OTA, no toca `min_version`) | Piso de reinstalación del APK + URL del `.apk`. Si un equipo tiene versión < `min_version`, la app baja el APK y lanza el instalador. **Ya está activo** (se prendió el 02/08). Ver [GUIA_ACTUALIZACION_APK.md](GUIA_ACTUALIZACION_APK.md) |

> 🩸 **1.12.1 es puro JS, y aun así se publicó como APK. La razón es la trampa que hay que recordar:**
> el código que actualiza solo tiene que llegar primero. Los teléfonos en 1.11.0 no podían bajar la
> OTA 1.12.1 sin un toque, porque lo que descarga solo viaja **dentro** de esa OTA. Un APK con el
> bundle adentro es la única forma de romper ese círculo sin depender de que alguien abra la app.
> **Corolario para el próximo cambio del updater: sale por APK, no por OTA.**
>
> 🩸 **Para que la actualización sea silenciosa hay que instalar con `-i`, no solo con `-r`.**
> 1.12.0 trae `PackageInstaller` con `USER_ACTION_NOT_REQUIRED` (`ApkUpdaterPlugin`), pero Android
> solo lo concede si la app es su **propio instalador de registro**. Verificado en un A07 real el
> 08/08/2026: después de `adb install -r`, `pm dump` seguía diciendo `installerPackageName=null` —
> o sea que la actualización siguiente **tampoco** habría sido silenciosa. La bandera `-i` lo fija:
>
> ```
> adb install -r -i com.launion.app app-release.apk    # → installerPackageName=com.launion.app
> ```
>
> Con eso el equipo queda habilitado y **la próxima versión se instala sola, sin un solo toque**.
> Un `adb install -r` a secas deja el privilegio sin ganar y hay que volver a pasar por el cable.
> `-r` conserva datos, sesión, cola y permisos (verificado: `ACCESS_BACKGROUND_LOCATION` y la
> exención de batería sobrevivieron).

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

Lista accionable y priorizada en **[HANDOFF.md §4](HANDOFF.md)**; el detalle técnico, en
[INFORME_AUDITORIA.md §8-9](INFORME_AUDITORIA.md). Los urgentes:

- 🔴 **Backup del keystore** (`android/app/launion.keystore` + las contraseñas de `keystore.properties`)
  fuera de la máquina. **Punto único de falla.** Android exige que toda actualización esté firmada con
  la MISMA llave que la app instalada; no estamos en Play Store, así que no hay respaldo de Google que
  valga. Si se pierde el archivo **o** se olvidan las contraseñas (`storePassword`/`keyPassword`/`keyAlias`):
  la OTA sigue viva, pero **ningún APK nuevo se puede instalar como actualización** — habría que hacer
  desinstalar+reinstalar en cada teléfono (se pierden datos locales: cola de posiciones, cuarentena,
  sesión). Respaldar YA: contraseñas en un gestor, el `.keystore` en 2 lugares privados (no repo público).
  Esto ahora también sostiene el auto-update del APK — ver [GUIA_ACTUALIZACION_APK.md](GUIA_ACTUALIZACION_APK.md).

  🩸 **Y ojo con una creencia falsa que circuló hasta el 04/08/2026:** `../.claude/keystore.md` **NO es
  un respaldo de las credenciales**. Verificado: es el volcado de la sesión de `keytool` — la ayuda de
  opciones y los campos del *distinguished name*—, y **las contraseñas no están ahí**, porque se
  tipearon en un prompt que no las imprime. Hoy `android/keystore.properties` es la **única** copia de
  `storePassword`, `keyPassword` y `keyAlias`, y está fuera de git, en un solo disco.
- ✅ **`02_saas.sql` y `05_schema_real.sql`**: movidos a `db/historico/` el 29/07/2026, con un
  `LEER_ANTES_DE_TOCAR.md` al lado. Ya no están en el camino de un `psql -f` distraído.
- ✅ **Versiones desfasadas** (§6): alineadas en 1.6.0 (versionName 1.6.0 / versionCode 20 / APP_VERSION 1.6.0).
- ✅ **Rol `propietario` ELIMINADO** (10/08/2026, `db/31` + `crear-usuario` v4). Ver §1. El dueño usa
  `admin`; su pantalla sobrevive como `features/direccion/PanelDireccion.jsx`.
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
- 🔴 **La cartera está bloqueada para el vendedor, y no por permisos.** Medido el 08/08/2026:
  **1998 clientes, 3 con `id_vendedor` y 18 con ubicación.** El lápiz que abre
  `EditarClienteVendedor` —el ÚNICO camino por el que un vendedor ubica un comercio— solo se dibuja
  si `c.idVendedor === user?.id` (`vendedor/tabs/InicioTab.jsx`), así que para el 99,8 % de la
  cartera ningún vendedor lo ve nunca. No es un bug de código: la importación masiva no cargó
  `id_vendedor`, y `addCliente` solo lo setea cuando el cliente lo crea el propio móvil. Mientras
  siga así, la geolocalización de la cartera no puede avanzar sola. Los 3 autoasignados se
  desasignaron el 08/08 (quedaron sus ubicaciones); decidir si el gate correcto es la ZONA
  (`clientes.id_zona` → `zonas.id_vendedor`) en vez de la asignación directa.
- 🟠 **Cuentas de perfil DUPLICADAS**: al 08/08/2026 hay 5 pares con el mismo nombre y distinta
  mayúscula (`Orlando Chavez`/`Orlando chavez`, `Gabriel tevez`/`Gabriel Tevez`, `Luis Mendoza`×2,
  `Nelson rojas`/`Nelson Ismael Rojas`, `Agustin Vazquez`/`Agustin Vasquez`). La gemela que no
  rastrea figura "no reportó" para siempre en el informe de jornada. Se limpia en `Usuarios`.
- 🟠 **`clientes_codigo_key` es `UNIQUE (codigo)` GLOBAL**, no por empresa: dos distribuidoras no
  pueden usar el mismo código de cliente. **Con 2 empresas vivas en la base (04/08/2026) ya dejó de ser
  hipotético.**
- 🟠 **`firmas_ins`** sigue siendo `to authenticated` sin alcance (el bucket de firmas de entrega).
  Hoy no muerde —la tabla `pedidos` está vacía y nadie firma nada— pero cuando arranque el módulo
  de entregas hay que darle el mismo tratamiento que `db/25`.
- 🔴 **Objetos vivos sin versionar en ningún `.sql`, y creciendo.** Confirmado contra la base viva el
  04/08/2026: `posiciones.bateria`, `perfiles.numero`, `zonas.numero`, `zonas.id_vendedor`, las 5 ya
  listadas en `00_LEER_PRIMERO.md`, **y cuatro nuevas**: la tabla **`ingesta_tokens`**, la RPC
  **`mi_token_ingesta`**, la tabla `ubicaciones_compartidas` y la RPC `ultimas_posiciones_compartidas`.
  Las dos primeras son las que autentican al uploader nativo: **sin ellas una base recreada desde `db/`
  no puede recibir una sola posición.** Peor: el encabezado de `ingest-posiciones` cita un
  `db/16_ingesta_tokens.sql` **que no existe** (`db/16` es `visitas`).
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

- **Supabase** — proyecto `lqhtxivednffpiicnbog` (`la-union-pwa`, región `sa-east-1`). Usarlo para
  consultar la base viva en vez de asumir desde los `.sql` (regla 5). `list_tables`, `execute_sql`,
  `get_advisors`, `apply_migration`, `get_logs`.
- **Notion, Gmail, Calendar, Canva, Context7, Firebase** — conectados, sin uso actual en el proyecto.

> Antes de responder cualquier pregunta sobre el estado del esquema, RLS, políticas o datos:
> **consultar la base viva vía MCP**, no los archivos `db/`.

> ⚠️ **Los conectores viajan con la cuenta de Claude, no con esta carpeta.** En una máquina nueva hay
> que volver a autorizarlos. Las **skills** sí viajan solas: están versionadas en `.claude/skills/`
> (§9). El inventario completo del entorno —toolchain, emulador, cuentas— está en
> [HANDOFF.md §3](HANDOFF.md).
