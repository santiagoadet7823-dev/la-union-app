# AUDITORÍA DE CÓDIGO — DisT-At, 19/09/2026 (sobre 1.41.0)

Inventario de lo que quedó **inútil** (nadie lo alcanza) y de lo que está **tipeado pero no hace nada**
(se ejecuta y no produce efecto, o promete algo que no cumple). Cubre `web/src`, el nativo Android,
las 8 Edge Functions, la base viva (`lqhtxivednffpiicnbog`) y las dependencias.

**Sólo documenta. No se borró nada.** Cada ítem lleva un veredicto y la evidencia para que la baja se
haga en una tanda publicable y con criterio de producto, no de limpieza.

Reemplaza a la sección "Código muerto verificado" de [DOCUMENTACION_FUNCIONAL.md](DOCUMENTACION_FUNCIONAL.md)
§10 (08/09) y actualiza la parte de deuda de [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md) (rev. 3, 04/08).
El problema de saturación de los teléfonos **no está acá**: va en
[ESTUDIO_AWS_DESCARGA_DATOS.md](ESTUDIO_AWS_DESCARGA_DATOS.md).

Veredictos:

| | Significa |
|---|---|
| 🔴 **Borrar** | Nadie lo alcanza (ni import, ni trigger, ni policy, ni cron, ni llamada nativa). Borrarlo no cambia el comportamiento. |
| 🟡 **Rescatar o borrar** | Funcionalidad completa sin ruta de acceso. Decisión de producto. |
| 🟠 **Inerte** | Se ejecuta, pero no tiene efecto — o la UI/doc dice que hace algo que no hace. Es lo más peligroso: parece vivo. |
| 🟢 **Vivo aunque parezca muerto** | Para que nadie lo borre por error. |

---

## 1. Resumen ejecutivo

| Capa | Tamaño | Muerto (🔴+🟡) | Inerte (🟠) | Estado |
|---|---|---|---|---|
| `web/src` (React) | 247 archivos · 45.615 LOC | **8 archivos · 938 LOC** + 20 exports sin importador + 21 variables sin uso | **9 palancas** | Limpio en un 98 %; lo que sobra está concentrado en `features/admin/` |
| Android nativo | 25 `.java` · 5.858 LOC | **0** | 0 | Los 12 plugins están registrados, invocados desde JS y con todos sus `@PluginMethod` llamados. Sin métodos privados ni constantes sin uso. |
| Edge Functions | 8 en repo = 8 desplegadas | **0** | 1 (campo que viaja y se descarta) | Todas tienen llamador. `crear-usuario` y `export-pedidos` son a demanda (0 invocaciones en 24 h es normal). |
| Base viva | 46 funciones · 31 tablas · 71 policies · 7 crons | **1 RPC huérfana · 1 cron roto · 5 columnas · 1 bucket · 5 índices + 2 duplicados** | 21 policies + 2 tablas "trampa" | Sin restos del rol `propietario`. Storage sin fotos huérfanas. |
| Dependencias | 21 deps + 17 dev | **2 sin un solo import** (`papaparse`, `qrcode`) | — | `xlsx` y `xlsx-js-style` conviven a propósito (ver §2.4) |
| Docs | 30 `.md` en raíz | 1 obsoleta entera + 17 referencias a archivos que no existen | — | Ver §6 |

**Los cinco que más pesan**, por lo que cuestan hoy o lo que pueden costar:

1. 🟠 **El cron `purge_consultas_120d` falla todas las noches desde que se borró `consultas_rutas`** —
   7 de 7 corridas en la semana con `relation "public.consultas_rutas" does not exist`. No rompe nada,
   pero es un job que grita "error" a diario y entrena a ignorar la tabla de crons. (§5.3)
2. 🟠 **El puntito verde de "en vivo" de las dos supervisiones es decorativo**: `estadoConexion()`
   devuelve `true` siempre, con Realtime caído o sin red. (§3.1)
3. 🟠 **21 policies re-evalúan los helpers de tenant fila por fila** (`clientes_sel`, `productos_sel`,
   `perfiles_upd`, todas las `*_ins`…). Medido: el `select *` de `clientes` que baja cada teléfono
   cuesta **79 ms / 4.164 buffers** con la policy y **4,9 ms / 68 buffers** sin ella (×16). Es la
   razón de los 144 millones de seq scans sobre `perfiles`. No es código muerto, pero salió del
   barrido y es lo que más latencia le mete al teléfono. (§5.2 y el estudio)
4. 🟡 **`ReplayJornada` (227 LOC) — reproducir la jornada como película** — sigue sin ruta de acceso
   desde el 04/08 y no hay equivalente vivo. Es la única de las 8 muertas que vale la pena rescatar.
5. 🟠 **`data/demoGeo.js` fija el centro de los mapas del vendedor y del selector de ubicación al
   depósito de La Unión**, ignorando `empresas.base_lat/base_lng` que sí existe y que las
   supervisiones ya usan. Para una segunda empresa el mapa del vendedor abre en Las Lajitas. (§3.2)

---

## 2. `web/src` — cliente React

### 2.1 Método

- Grafo de imports propio desde `main.jsx` (estáticos, dinámicos, `export … from`), con el corte
  runtime de `AdminView` (§2.2). Script: `grafo-imports.mjs` (scratchpad, no va al repo).
- Cross-check con `knip@latest` (config efímera). **Coincidencia total** en archivos; knip agregó 2
  exports (`asignGrid`, `tonoEstado`) que el script propio descarta por uso interno.
- ESLint efímero (`no-unused-vars` en `error`, `no-empty`, `no-unreachable`, `no-constant-condition`,
  `no-useless-return`) — sin tocar `eslint.config.js`.
- Grep dirigido para lo que ninguna herramienta ve: palancas leídas y no aplicadas, no-ops, flags
  declarados y no consultados.

### 2.2 Archivos inalcanzables — 8 archivos, 938 LOC

El grafo "puro" da sólo 4. Los otros 4 cuelgan de `AdminView`, que **sí** está importado en
[App.jsx:27](web/src/App.jsx#L27) pero en una rama que `AuthedApp` nunca deja llegar: ataja los 6
roles antes del `return <AdminView/>` de `RoleRouter` (el propio archivo lo dice en su docstring,
[App.jsx:52-53](web/src/App.jsx#L52-L53)). El `lazy()` además hace que Vite lo compile como chunk
aparte: **viaja en cada bundle OTA y en la PWA sin que nadie lo cargue nunca**.

| Archivo | LOC | Quién lo importa | Veredicto | Riesgo de borrar |
|---|---|---|---|---|
| `features/admin/AdminView.jsx` | 151 | `App.jsx` (rama muerta) | 🔴 Borrar, junto con el `lazy` y el `return` de `RoleRouter` | Ninguno |
| `features/admin/RecorridosView.jsx` | 126 | `AdminView` | 🔴 Borrar — es un subconjunto de `SupervisionDesktop` | Ninguno |
| `features/admin/tabs/MapaOperativo.jsx` | 146 | `AdminView` | 🔴 Borrar — su única pieza distinta (la consola de eventos) no se pidió nunca | Ninguno. Es el único consumidor de `DEPOSITO` en `demoGeo.js` |
| `features/admin/components/ReplayJornada.jsx` | 227 | `AdminView` | 🟡 **Rescatar**: reproduce la jornada de una persona como película con velocidad y km acumulados. Los datos (`historialPosiciones`) están vivos. Colgarlo de `GESTION_ITEMS` (`lib/gestion.js`) | Si se borra, se pierde una función que no existe en otro lado |
| `features/admin/tabs/RuteoTab.jsx` | 113 | **nadie** (ni el padre muerto) | 🔴 Borrar — andamiaje de TSP del prototipo; arrastra `asignGrid` de `admin/ui.jsx` | Ninguno |
| `features/vendedor/tabs/PerfilTab.jsx` | 78 | **nadie** | 🔴 Borrar — la bottom-nav tiene 3 columnas y "Mi cuenta" vive en `MiCuenta` | Ninguno |
| `features/direccion/components/KpiCard.jsx` | 63 | **nadie** | 🔴 Borrar — `PanelDireccion` usa `MiniKpi`/tarjetas inline; quedó de la primera versión | Ninguno |
| `services/sync/index.js` | 34 | **nadie** | 🔴 Borrar — un `BroadcastChannel('launion:sync')` con `publicar`/`suscribir` que nadie invoca. Ojo: `import … from '../services/sync'` NO resuelve a este archivo (los consumidores importan `sync/queue` y `sync/writeQueue` explícitos) | Ninguno |

> Total **938 LOC**. Contra el inventario del 08/09 (850 LOC) aparecen `KpiCard` y `sync/index.js`,
> que no estaban listados.

### 2.3 Exports sin importador — 20 reales (+ 49 "exportados por las dudas")

**Con el símbolo sin ningún uso, ni externo ni interno** (candidatos a borrar la función entera):

| Archivo | Export | Qué es | Veredicto |
|---|---|---|---|
| `services/routing/index.js:22` | `matchTrail` | Map-matching por OSRM. El snap real vive en la Edge Function | 🔴 |
| `services/routing/index.js:119` | `obtenerRutaOptima` | Variante vieja del TSP; la viva es `obtenerRutaOptimaTSP` | 🔴 |
| `services/sync/queue.js:245` | `queueStats` | Contadores de la cola GPS para un panel de debug que no existe | 🔴 (o cablearlo a `useDiagnosticoEquipo`) |
| `services/sync/writeQueue.js:272,285` | `pendingMutaciones`, `limpiarCuarentena` | Ídem para la cola de escrituras. `limpiarCuarentena` es una **operación destructiva sin UI**: se usa desde consola | 🟢 mantener `limpiarCuarentena` (herramienta de soporte, documentarla) · 🔴 `pendingMutaciones` |
| `services/geolocation/estados.js:80` | `estadoActual` | Getter de la máquina de estados "para telemetría/debug" | 🔴 |
| `services/alarm.js:79` | `pararAlarm` | Nadie para la alarma desde JS (la para el nativo) | 🔴 |
| `services/atras.js:51` | `_pilaAtras` | Inspector de la pila del botón ATRÁS | 🔴 |
| `services/data/espejoFotos.js:207` | `vaciarEspejo` | Borrar el espejo local de fotos de la vidriera; sin botón | 🟡 hay caso de uso (tablet llena), falta la UI |
| `services/vidrieraBluetooth.js` | `estado` | Diagnóstico del enlace BT | 🔴 |
| `services/gpsConfig.js:19` | `KEEPALIVE_MS` (90 s) | **Nadie lo lee.** El keepalive real es `STATIONARY_KEEPALIVE_MS` (30 s). Los comentarios de `useLivePosition.js:68` y `estados.js:18` lo citan como si mandara | 🟠 borrar y corregir los dos comentarios |
| `services/gpsPerfil.js:233` | `NO_OVERRIDEABLE` | Lista de claves que el perfil por usuario no puede pisar. **Declarada, no aplicada**: `gpsPerfil` no la consulta al mezclar | 🟠 aplicarla o borrarla |
| `lib/zonaAbrev.js:18` | `ABREV_RE` | Regex de abreviatura; la validación usa otra expresión inline | 🔴 |
| `features/pedidos/exportarPedidos.js:97` | `exportarPedidosTsv` | Alias de `exportarPedidosAscii` | 🔴 |
| `components/icons.jsx:272` | `ChevronDown` | Ícono sin consumidor | 🔴 |
| `lib/conTimeout.js`, `services/persistence/index.js`, `services/supabase.js` | `default` | Doble export (named + default); todos importan el named | 🔴 el default |
| `lib/planillaProductos.js:247` | `parsearTexto` | **Lo usa la Edge Function `ingest-precios` desde su COPIA** (`supabase/functions/ingest-precios/lib/`), que se sincroniza con `scripts/sync-ingest-precios.mjs` | 🟢 mantener |

**Exportados pero usados sólo dentro de su propio archivo** (49 símbolos; no son código muerto, es
`export` de más): `rentColor`, `RADIO_COMERCIO`, `fmtCompacto`, `CATEGORICAS`, `User`, las 8
constantes de `lib/geo.js`, las 7 de `lib/asciiPedidos.js`, `GESTION_ITEMS`, `STADIA_KEY`,
`PRESET_QUIETO/MOVIMIENTO`, `DWELL_*`, etc. Quitar el `export` los vuelve privados y deja que
Rollup los elimine si algún día dejan de usarse. Lista completa en `knip.txt` (scratchpad).

### 2.4 Dependencias (`web/package.json`)

| Paquete | Imports en `src/` | Veredicto |
|---|---|---|
| `papaparse` | **0** | 🔴 Borrar. El CSV se parsea a mano en `lib/planillaProductos.js` (`parsearTexto`) |
| `qrcode` | **0** | 🔴 Borrar. El QR lo genera el plugin nativo `QrPlugin` (`registerPlugin('Qr')`) |
| `@capacitor-community/background-geolocation` | 0 imports directos | 🟢 **Mantener**: se usa por `registerPlugin('BackgroundGeolocation')` y lo parchea `patches/`. knip lo marca como no usado y **se equivoca** |
| `xlsx` + `xlsx-js-style` | 6 + 2 | 🟢 Las dos: `xlsx` lee (importación); `xlsx-js-style` escribe con colores (planilla de clientes, `exportarClientes.js`). Son dos builds de SheetJS; unificar en `xlsx-js-style` ahorraría ~400 KB de `node_modules` pero no de bundle (Rollup sólo mete la que importa cada chunk). Baja prioridad |
| `typescript` (dev) | sólo `capacitor.config.ts` | 🟢 Lo necesita el CLI de Capacitor para leer la config |
| `@vitejs/plugin-legacy` (dev) | `vite.config.js` | 🟢 Genera los chunks `-legacy` que usa el WebView viejo de los A07 |
| `lightweight-charts`, `@capacitor/browser`, `@capacitor/share`, `@capacitor/filesystem` | 1-2 | 🟢 Vivos |

### 2.5 Variables sin uso dentro de archivos vivos (ESLint, 21)

| Archivo:línea | Símbolo | Nota |
|---|---|---|
| `App.jsx:119` | `rol` | Parámetro de `decidirPanelDireccion`/`decidirSupervisionMovil` que no se lee. Inofensivo |
| `components/GpsGate.jsx:10` | `GRACE_MS` | 🟠 La "fase 1" (15 s de loader neutro) **no existe**: el gate pasa directo a `GUIA_MS` (35 s). El comentario describe dos fases; el código tiene una |
| `features/supervision/SupervisionDesktop.jsx:75-83` | `vista`, `idEmpresa`, `puedeCambiarScope`, `empresasDisponibles`, `setEmpresaActiva`, `esOverride`, `nombreActiva` | El selector de empresa del superadmin se movió a `components/SelectorEmpresa.jsx`; el destructuring quedó |
| `features/supervision/SupervisionMovil.jsx:91-95` | `idEmpresa`, `empresasDisponibles`, `setEmpresaActiva` | Ídem |
| `features/supervision/trazos.js:172` | `cubreElRecorrido` | 🟠 **La guarda de "el snap borró recorrido" (umbral 0,75, calibrada el 12/08 con los casos Nelson y Luis) no se llama desde ningún lado.** Quedó definida cuando el snap pasó a devolver sólo conectores (18/08). `recorridos.js:29-33` todavía explica que los conectores viajan aparte "para no engañar a `cubreElRecorrido`" — protege a una función que no corre |
| `features/supervision/MetricasEquipo.jsx:14` | `distanciaMetros` | Import huérfano |
| `features/admin/UsuariosView.jsx:34` | `label10` | Estilo sin uso |
| `features/gestion/RespaldoDatos.jsx:144` | `pedidos` | Parámetro no leído |
| `features/vendedor/tabs/SinPedidoSheet.jsx:19` | `setAbierto` | Setter sin uso: el sheet no puede cerrarse desde adentro (¿a propósito?) |
| `services/download.js:14` | `mime` | Parámetro no leído |
| `services/sync/queue.js:24` | `aCuarentena` | 🟠 Contador de telemetría **que nunca se incrementa**: la cuarentena existe, el contador no |
| `services/uploaderNativo.js:31` | `iniciado` | Flag que se declara y no se consulta |
| `features/admin/components/ReplayJornada.jsx:4` | `supabase` | Está en archivo muerto |

Además: **22 bloques `{}` vacíos** (`no-empty`), casi todos `catch {}` de best-effort deliberado
(regla del repo). Los tres que conviene mirar porque tapan fallos que sí importan:
`context/AuthContext.jsx:311` y `:475` (alrededor del refresco de sesión) y `services/ota.js:44,60,70`
(descarga/aplicación del bundle). Y 3 directivas `eslint-disable` que ya no desactivan nada
(`queue.js:137,174`, `writeQueue.js:185`).

---

## 3. "Tipeado pero no hace nada" — palancas desconectadas

Esto es lo que pediste específicamente. Cada fila: qué dice que hace, qué hace, dónde.

### 3.1 En el cliente

| # | Qué promete | Qué hace en realidad | Dónde | Veredicto |
|---|---|---|---|---|
| 1 | El puntito verde "en vivo" de las supervisiones indica que la telemetría está conectada | `estadoConexion(cb)` hace `cb(true)` y devuelve. **Siempre verde**, con Realtime caído, sin red, o con el socket sin abrir. `useEquipoEnVivo` lo guarda como `mqttOn` (nombre heredado del prototipo MQTT) | [realtime.js:113-117](web/src/services/sync/realtime.js#L113-L117) → `useEquipoEnVivo.js:136` → `SupervisionDesktop.jsx:431`, `SupervisionMovil.jsx:558` | 🟠 Conectarlo al estado real del canal (`channel.subscribe((status) => …)`) o sacar el punto |
| 2 | `empresas.activo` — "Desactivar deja sin acceso a todos sus usuarios" | Se escribe y se muestra en `EmpresasView`. **Ninguna policy ni el gate de `App.jsx` lo consultan.** Desactivar una empresa no hace nada | `EmpresasView.jsx:144,361` · 0 referencias en `pg_policy` | 🟠 Ya documentado en CLAUDE.md §1; sigue igual |
| 3 | `NO_OVERRIDEABLE` protege claves del perfil GPS por usuario | Declarada, nunca consultada al mezclar perfiles | `gpsPerfil.js:233` | 🟠 |
| 4 | `KEEPALIVE_MS` = 90 s "reenvío de cortesía" | Nadie lo lee; el real es `STATIONARY_KEEPALIVE_MS` = 30 s. Dos comentarios lo citan como vigente | `gpsConfig.js:19`, `useLivePosition.js:68`, `estados.js:18` | 🟠 |
| 5 | `GpsGate` tiene fase 1 (15 s silenciosa) y fase 2 (35 s con guía) | Sólo existe la fase 2 | `GpsGate.jsx:10-11,143` | 🟠 |
| 6 | `cubreElRecorrido` descarta un snap que perdió más del 25 % del recorrido | No se invoca desde el 18/08; los conectores se dibujan sin esa guarda | `trazos.js:172`, `recorridos.js:29-33` | 🟠 Reconectar o borrar función + comentario |
| 7 | `aCuarentena` cuenta puntos enviados a cuarentena | Nunca se incrementa | `queue.js:24` | 🟠 |
| 8 | `VITE_APP_ROLE` fija el rol de la APK (`.env.example`) | **Nadie lo lee.** El rol sale del perfil. `.env.example` sigue ofreciéndola | `web/.env.example:15-17` · 0 referencias en `src/` | 🟠 Borrar de `.env.example` |
| 9 | `GUIA_API_KEY_GOOGLE_MAPS.md` explica cómo cargar la key de Google Maps | Ninguna variable `VITE_GOOGLE*`/`GOOGLE_MAPS` existe en el código. Los mapas son Leaflet + Stadia/OSM | 0 referencias | 🔴 Doc obsoleta entera |
| 10 | `hasSupabase === false` deja la app en "modo demo" (44 guardas) | Sin `.env` la app **no** funciona en modo demo: `AuthContext` pone `loading=false` y `LoginView` muestra "falta configuración". Las otras 42 guardas nunca se ejecutan con `false` porque no se pasa del login | `supabase.js:12`, `AuthContext.jsx:160`, `LoginView.jsx:293` | 🟢 Dejar las guardas (son baratas), pero saber que no hay modo demo |
| 11 | `capacitor.config.ts` → `BackgroundGeolocation: {}` | Objeto vacío; no configura nada | `capacitor.config.ts` | 🔴 quitar la clave |

### 3.2 Multi-tenant que no lo es

| # | Qué | Dónde |
|---|---|---|
| 12 | `data/demoGeo.js` (`CENTRO`, `DEPOSITO`, `ROUTE_COLOR`) — el docstring dice "dataset geográfico REAL de La Unión". `MapaComercios` (reparto) y `SelectorUbicacion` (ubicar comercio) abren en **ese** centro cuando no hay GPS, para cualquier empresa. Mientras tanto `useEmpresaBase` + `empresas.base_lat/lng` + `CENTRO_DEFECTO` de `services/maps` ya resuelven esto bien en las supervisiones | `demoGeo.js`, `MapaComercios.jsx:140`, `SelectorUbicacion.jsx:56` | 🟠 Reemplazar `CENTRO` por `useEmpresaBase(idEmpresa)`; mover `ROUTE_COLOR` a `lib/colors.js`; borrar `demoGeo.js` (su otro consumidor es `MapaOperativo`, muerto) |
| 13 | Meta diaria `900000` hardcodeada para todos los vendedores de todas las empresas | `useJornada.js:440` (el cálculo) y `InicioTab.jsx:130` (el texto "de $ 900.000") | 🟠 Ya listado en HANDOFF; `metas` (db/56) existe, tiene 3 filas y la lee `features/metas/useMetas.js` para el tablero, pero la barra de la jornada no |

### 3.3 En la base

| # | Qué promete | Qué hace | Veredicto |
|---|---|---|---|
| 14 | `rutas` (8 columnas, policies `rutas_sel`/`rutas_wr`, FKs, índice) — la ruta planificada del día | **0 filas desde siempre**, 0 escritores en el código (grep `from('rutas')` = 0). Sólo la lee `RuteoTab`, que está muerto | 🔴 Tabla + 2 policies + 2 FKs. Es la única tabla del esquema que nada toca |
| 15 | `categorias` (tabla) — catálogo de rubros con CRUD completo (`CategoriasTab`, `CatalogContext.addCategoria/updateCategoria/deleteCategoria`, `catalogo.js:66` la baja con el catálogo) | **0 filas** (2 insertadas alguna vez y borradas). `productos.categoria` es texto libre y **no la referencia**: cargar rubros acá no cambia ningún filtro. Se baja en cada refresco del catálogo (2.770 idx_scan) para recibir `[]` | 🟠 O `productos.categoria` pasa a apuntar acá (y los 316 sin rubro que hoy deduce `inferCategoria` se resuelven), o se borra la tabla, sus 2 policies y la pestaña |
| 16 | `ubicaciones_compartidas` — compartir un móvil con otra empresa | 0 filas, pero **sí tiene UI** (`CompartirUbicacion.jsx`) y RPC (`ultimas_posiciones_compartidas`, 227 llamadas/día desde el cron/supervisión) | 🟢 Viva sin uso: función lista que nadie contrató |
| 17 | `coberturas_zona` (db/76, 18/09) y `tramos_transporte` (db/72) | 0 y 0 filas: **son de esta semana**, tienen escritores vivos (`useCoberturasZona`, `useTramosTransporte`) | 🟢 |
| 18 | `pedidos.ts_entrada`, `ts_salida`, `firma_url`, `motivo_no_venta` | 0 referencias en código, 0 en funciones SQL, **0 de 52 pedidos con valor**. El diseño de "firma del cliente" (bucket `firmas`, policy `storage.firmas_ins`, `firma_url`) nunca se implementó | 🔴 4 columnas + bucket `firmas` (vacío, privado) + `firmas_ins` |
| 19 | `purgas_pedidos.numeros` | Sólo lo escribe `purgar_pedidos_anulados`; nadie lo lee | 🟢 auditoría, dejar |
| 20 | `pedidos.minutos`, `distancia_m`, `intencion` | Se escriben (52/52 `intencion`, 45/52 `distancia_m`), **`minutos` 0/52**: la columna existe, el código la nombra, nadie la calcula | 🟠 `minutos` |

---

## 4. Android nativo — limpio

Verificado plugin por plugin: los 12 `registerPlugin(...)` de `MainActivity.java:13-52` tienen su
`registerPlugin('Nombre')` en JS y **cada `@PluginMethod` tiene al menos una llamada** (`escuchar`,
`programar`, `descargarEInstalar`, `unirse`, `bajarFoto`, `fijarPantalla`, …: 44 métodos, 0 sin
llamador). Los 5 receivers y 2 servicios están declarados en el manifest y disparados
(`AlarmReceiver` ← `AlarmWatchdogPlugin`, `BootReceiver` ← sistema, `InstalacionReceiver` ←
`ApkUpdaterPlugin`, `MovimientoReceiver` ← `MovimientoPlugin`, `NotifDeslizadaReceiver` ←
`UploaderGpsService`). `android/print/PdfDelWebView.java` (paquete ajeno a propósito, para acceder a
`PrintDocumentAdapter`) lo usa `ImpresionPlugin.java:141`. `ServidorLocal` y `VentanaRastreo` tienen
3 y 4 consumidores. Sin métodos `private` ni `static final` sin referencias.

La vidriera (tablet) es la mitad del código nativo (`EnlaceTablet` 544 + `ServidorLocal` 405 +
`EnlaceLocal` 372 + `EnlaceBluetooth` 299 + `EscanerQr` 220+47 ≈ 1.900 LOC) y **está en producción**
desde 1.18.0 ([HANDOFF_VIDRIERA.md](HANDOFF_VIDRIERA.md)). 🟢

Único ítem: `capacitor.config.ts` lleva `BackgroundGeolocation: {}` vacío (§3.1 #11).

---

## 5. Edge Functions y base viva

### 5.1 Edge Functions — 8 = 8, todas con llamador

| Función | Llamador | Invocaciones 17/09 (día hábil) | Nota |
|---|---|---|---|
| `ingest-posiciones` | `UploaderGpsService` (nativo) vía `uploaderNativo.js:29` | **9.089** | Post-1.36.0 (lote de 15 s). Antes: 18-27k |
| `alertas-equipo` (+`?resumen=1`) | cron `alertas-equipo-10min` + `resumen-equipo-1h` | 168 | |
| `snap-recorridos` | `services/recorridos.js` | 141 | Post-`useSnapConectores`. Antes ~600/pantalla |
| `push-heartbeat` | cron `push-heartbeat-30min` | 32 | |
| `ingest-precios` | `scripts/cliente/enviar-precios.ps1` (ERP del cliente, cada hora) | 23 | |
| `push-actualizacion` | cron `push-actualizacion-1h` | 16 | |
| `crear-usuario` | `UsuariosView.jsx` (`functions.invoke`) | 0 | A demanda: alta de usuario |
| `export-pedidos` | `scripts/cliente/bajar-pedidos.ps1` | 0 | A demanda: el cliente baja pedidos al ERP |

🟠 **Un campo que viaja y se tira**: `snap-recorridos` devuelve `geometrias` (el recorrido pegado
entero) y `conectores`. `recorridos.js:30` sigue leyendo `geometrias` y las convierte a `{lat,lng}`,
pero los cuatro consumidores de `useSnapConectores` sólo usan `_conectores`. La función relee la
jornada del lado del servidor y serializa 86-191 KB por día que el cliente descarta (regla 60 lo
menciona; el código no lo refleja). Detalle y qué hacer con eso en el estudio.

🟢 **Sin drift**: los 8 `ezbr_sha256` desplegados corresponden a las versiones actuales; `ingest-precios`
está en v10 y desplegada desde la ruta local del repo (`entrypoint_path` lo delata).

### 5.2 Funciones SQL — 46; 1 huérfana

Trazado por: `rpc('nombre')` en `web/src` + `supabase/functions`, `pg_trigger`, `pg_policy`
(`USING`/`WITH CHECK`), cuerpo de otras funciones, `cron.job`, constraints e índices.

| Función | Referencias | Veredicto |
|---|---|---|
| `reclamar_y_ubicar_cliente(p_id, p_lat, p_lng)` | **0** (era de `useJornada.registrarCheckIn`; reemplazada el 17/09 por `ubicarComercio` vía `updateCliente`, 1.39.0). Aparece en 3 bundles viejos de `web/android/app/build/` | 🔴 `drop function`. Es SECURITY DEFINER: una función privilegiada que ya nadie usa es superficie de ataque gratis |
| `pedidos_de_lote`, `reponer_pedidos_para_export` | 0 en código; **documentadas como operación manual** en `GUIA_EXPORT_PEDIDOS.md` / `BITACORA_CANAL_PEDIDOS.md` | 🟢 Herramientas de soporte |
| `estado_plan()` | 1 (`EmpresasView`) | 🟢 |
| `_dash_empresa`, `codigo_norm`, `pedido_exportable` | Sólo desde otras funciones | 🟢 |
| `es_admin` (6 policies), `mi_nivel` (1 policy + 1 fn) | Pocas pero reales | 🟢 |
| Las 8 de trigger (`asignar_numero_pedido`, `sellar_anulacion`, `*_congelado`, `cliente_hereda_vendedor_de_zona`, `zona_pasa_vendedor_a_clientes`, `registrar_cambio_app_config`, `handle_new_user`) | 1 trigger cada una | 🟢 |
| `limpiar_posiciones_viejas`, `purgar_pedidos_anulados` | cron | 🟢 |

**Policies (71)**. Sin rastro de `propietario` (ni en policies, ni en funciones, ni en el CHECK de
`perfiles.rol`, que lista exactamente los 6 roles vivos). Lo que sí hay, y no es muerto sino
**inerte al revés** —cuesta y no aporta—:

- **21 policies evalúan `auth.uid()` / `mi_empresa()` / `mi_rol()` / `es_superadmin()` por fila** en
  vez de una vez por consulta (`(select …)`). El advisor de Supabase marca 18 (las que usan
  `auth.uid()` directo); **no marca `clientes_sel`, `productos_sel`, `clientes_upd`, `perfiles_upd`
  ni `productos_wr`** porque el linter sólo mira `auth.<fn>()` y estas usan los helpers propios.
  Son justo las que corren en cada teléfono al bajar catálogo y cartera. Medición reproducible
  (`explain analyze`, rol `authenticated`, JWT de un vendedor de La Unión):

  | Consulta | Con la policy actual | Sin policy (baseline) |
  |---|---|---|
  | `select * from clientes where id_empresa=… order by nombre_comercio limit 1000` | **79 ms · 4.164 buffers** | 4,9 ms · 68 buffers |

  Los 4.096 buffers extra son 2 lecturas de `perfiles` por fila (2.048 filas × `es_superadmin()` +
  `mi_empresa()`). Multiplicado por todas las consultas de todos los teléfonos: **144.230.332 seq
  scans sobre `perfiles`** desde el 30/06 (`pg_stat_user_tables`). En producción `pg_stat_statements`
  da para ese `select *` una media de **277-711 ms** (con json_agg, contención y red).
  `posiciones_sel`, `perfiles_sel` y `estado_disp_sel` ya están escritas con `(select …)`: es el
  patrón correcto y está en la propia base; faltan las otras 21. **Es la deuda con mejor relación
  esfuerzo/impacto de todo este informe**, y el estudio la retoma.
- **31 pares de policies permisivas duplicadas** para `SELECT` (`app_config_sel`+`app_config_wr`,
  `productos_sel`+`productos_wr`, `zonas`, `rutas`, `categorias`, `empresas`, `categorias_rastreo`):
  la `*_wr` es `FOR ALL` y cubre el `SELECT`, así que Postgres evalúa las dos y hace OR. Costo
  chico por consulta; se arregla restringiendo cada `*_wr` a `insert/update/delete`.

**Índices**: 5 sin un solo `idx_scan` (`pedido_ediciones_empresa_fecha_idx`, `ingestas_emisor_empresa_ts_idx`,
`purgas_pedidos_empresa_idx`, `pedidos_vendedor_fecha_idx`, `perfiles_categorias_rastreo_usuario_idx`)
— todos de 16 kB, en tablas chicas: 🟡 dejar hasta que las tablas crezcan, salvo los **2 duplicados
exactos** (`idx_items_pedido` = `pedido_items_pedido_idx`, `idx_pedidos_vendedor_fecha` =
`pedidos_vendedor_fecha_idx`): 🔴 uno de cada par. Y **20 FKs sin índice** (advisor), de las que
importan dos: `posiciones.id_empresa` (725k filas, se filtra por empresa en cada consulta del
supervisor — aunque `idx_posiciones_usuario_ts` cubre el caso por persona) y `clientes.id_vendedor`
/ `clientes.id_zona` (filtro de "solo lo mío" del vendedor desde db/76).

### 5.3 Crons — 7; 1 roto

| Job | Estado |
|---|---|
| `purge_consultas_120d` (`20 3 * * *`) | 🔴 **Falla todas las noches**: `relation "public.consultas_rutas" does not exist`. 7/7 en la última semana. La tabla se fue con `ConsultasView` (la "cuota de consultas" que DOCUMENTACION_FUNCIONAL §9 declara inexistente); el cron se olvidó. `cron.unschedule(2)` |
| `limpiar_posiciones_viejas_diario`, `purgar-pedidos-anulados`, `push-heartbeat-30min`, `push-actualizacion-1h`, `alertas-equipo-10min`, `resumen-equipo-1h` | 🟢 7/7, 240/240, 1008/1008 OK |

### 5.4 Storage — limpio

`productos`: 628 objetos = 628 `productos.imagen_url`; **0 huérfanos** (el inventario de
`../fotos-huerfanas-2026-08-18.txt` ya se limpió). 92 fotos pertenecen a productos descontinuados
(17,3 MB en total; no vale la pena tocarlas). `avatares`: 2. `firmas`: **0 objetos, nunca usado** (→ §3.3 #18).

### 5.5 `db/` vs base viva

`db/schema.sql` es un volcado; la fuente de verdad es la base (regla del repo). No hay objetos en la
base que no tengan su migración numerada, salvo el cron roto (creado a mano, sin archivo).
`db/historico/` está correctamente apartado.

---

## 6. Docs, scripts y config

| Qué | Veredicto |
|---|---|
| `GUIA_API_KEY_GOOGLE_MAPS.md` | 🔴 Obsoleta entera: no hay Google Maps en el código |
| `ESTRUCTURA_PROYECTO.md` (04/08) | 🟠 10 archivos citados que ya no existen (`components/BurbujasEquipo.jsx`, `EstadoEquipo.jsx`, `FilaEquipo.jsx`, `KpiCard.jsx`, `MiniKpi.jsx`, `RailMapa.jsx`, `ReplayJornada.jsx`, `SheetPersona.jsx`, `SinDatoBloque.jsx`, `TarjetaPin.jsx` — se movieron a `features/*/components/`). Ya está marcada como histórica en DOCUMENTACION_FUNCIONAL §11 |
| `INFORME_AUDITORIA.md` | 🟠 Cita `features/propietario/PropietarioMovil.jsx` y `supabase/functions/_shared/fcm.ts` (hoy `alertas-equipo/fcm.ts`). Arquitectura vigente; números y rutas no |
| `README.md` | 🟠 Cita `features/reportes/faltanteStock.js` (no existe) y un componente `GoogleMap`; omite `CAP_BUILD=1` |
| `HANDOFF.md` | 🟢 3 rutas viejas en secciones históricas (`BurbujasParadas.jsx`, `useVisitasDeHoy.js`, `_shared/fcm.ts`); es bitácora, no se corrige hacia atrás |
| `PLAN_BACKEND_DEDICADO.md` | 🟢 `services/backend.js` es un archivo **propuesto**, no existente. Correcto |
| `web/.env.example` → `VITE_APP_ROLE` | 🔴 Variable que nadie lee |
| `web/public/data/*.csv` (clientes/productos de semilla, 3 KB) | 🟡 Nadie los referencia en código; servían de ejemplo de importación. Hoy la plantilla real es `plantilla-lista-precios.xlsx`. Borrar o mover a `scripts/fixtures/` |
| `web/public/oauth.html` | 🟢 Página puente del OAuth web (HANDOFF §OAuth) |
| `scripts/diagnostico-SM-A0*.txt` (11 archivos, 1 en git) | 🟡 Volcados de `dumpsys` del 07/08; referenciados sólo desde HANDOFF. Archivar fuera del repo |
| `scripts/cliente/EnviarPrecios.java`, `BajarPedidos.java` | 🟢 Alternativa documentada para el cliente (no se usó, pero es parte del paquete entregado) |
| `graphify-out/`, `trabajo diseñador ui ux/`, `icon-fuente.png.png`, `web/dist/` | 🟢 No están en git (`.gitignore`); son locales |
| `index.css` tokens | `--hm0..4`, `--map-block`, `--map-road`, `--tclassic`, `--z-map`, `--sp-5`, `--sp-6`: **0 usos** (10 tokens). `--grid` y `--rent-1..4` sí se usan (dinámicos: `useTemaGrafico`, `rentColor`) | 🔴 los 10 |

---

## 7. Lo que NO se pudo verificar

- **`localStorage['lu-dev-rol']`** y otros overrides de desarrollo: se documentan como "no-op fuera
  de DEV" y el `import.meta.env.DEV` lo garantiza, pero no se probó en un bundle de producción.
- **Los 22 `catch {}`**: cada uno se justifica en su comentario como best-effort; no se auditó uno
  por uno si tragan algo que debería avisar. Los 5 señalados en §2.5 son los que rodean sesión y OTA.
- **Uso real de `clientes_dormidos`, `oportunidades_vendedor`, `productos_del_vendedor`**: tienen
  llamador, pero no se midió si alguna pantalla las muestra a alguien (son del panel del vendedor,
  db/57, que HANDOFF dice "vacío por semanas").
- **Realtime `pedidos`**: la publicación `supabase_realtime` incluye `public.pedidos` y ningún
  `postgres_changes` del cliente escucha esa tabla (`grep` = 0). Cada insert/update de pedido
  igual pasa por el WAL de Realtime. Es costo, no funcionalidad; se detalla en el estudio.

---

## 8. Método reproducible

```bash
# 1. Grafo de imports (desde la raíz del repo; el script vive en el scratchpad de la sesión)
node grafo-imports.mjs                                   # 4 inalcanzables
CUT=features/admin/AdminView.jsx node grafo-imports.mjs  # 8, cortando la rama muerta

# 2. knip (sin instalarlo en el repo)
cd web && npx --yes knip@latest --config <knip.json> --reporter compact
#   knip.json: entry [src/main.jsx, vite.config.js, capacitor.config.ts, eslint.config.js], project src/**/*.{js,jsx}

# 3. ESLint efímero (copiar la config a web/, correr, borrar)
npx eslint --no-config-lookup -c eslint.audit.tmp.config.js src -f json

# 4. Nativo: @PluginMethod ↔ llamadas JS
for f in android/app/src/main/java/com/launion/app/*Plugin.java; do grep -A1 @PluginMethod $f | grep -o "public void [a-zA-Z]*"; done
```

```sql
-- 5. Base viva (sólo lectura)
select proname from pg_proc where pronamespace='public'::regnamespace;            -- 46 funciones
-- referencias: pg_trigger.tgfoid · pg_policy (pg_get_expr polqual/polwithcheck) · pg_proc.prosrc · cron.job.command
select jobid,status,return_message from cron.job_run_details where start_time > now()-interval '7 days';
select relname,seq_scan,idx_scan,n_live_tup from pg_stat_user_tables order by seq_scan desc;
select * from pg_stat_user_indexes where idx_scan=0;
-- costo de una policy por fila:
begin; select set_config('request.jwt.claims', '{"sub":"<uuid vendedor>","role":"authenticated"}', true);
set local role authenticated;
explain (analyze,buffers) select * from clientes where id_empresa='…' order by nombre_comercio limit 1000; rollback;
```

---

## 9. Plan sugerido de bajas (sin ejecutar)

Ordenado por canal de publicación, porque eso es lo que determina el costo:

**Tanda 1 — sólo base (sin release; una sesión de SQL, reversible):**
`cron.unschedule('purge_consultas_120d')` · `drop function reclamar_y_ubicar_cliente` · un índice de
cada par duplicado · policies con `(select …)` (§5.2; esto no es baja, es la corrección con más
impacto) · `rutas` y sus 2 policies (sólo después de la tanda 2, que borra `RuteoTab`).

**Tanda 2 — OTA + PWA (JS puro, una versión):**
los 8 archivos de §2.2 (+ `lazy` y `return` en `App.jsx`, `DEPOSITO` en `demoGeo.js`) · los 20
exports de §2.3 · las 21 variables de §2.5 · `papaparse` y `qrcode` de `package.json` · los 10
tokens CSS · `VITE_APP_ROLE` de `.env.example` · decidir `ReplayJornada` (rescatar = colgarlo de
`GESTION_ITEMS`, ~30 LOC más). Con esto `no-unused-vars` puede pasar a `error` en
`eslint.config.js` sin ruido.

**Tanda 3 — las palancas (cada una es una decisión, no una limpieza):**
#1 punto verde real · #3 `NO_OVERRIDEABLE` · #5 `GRACE_MS` · #6 `cubreElRecorrido` · #12 `CENTRO` por
empresa · #15 `categorias` · #18 firma del cliente (borrar el diseño a medias) · #20 `pedidos.minutos`.

**No requiere APK nada de lo anterior.** El único cambio nativo (`capacitor.config.ts`) puede
esperar al próximo APK por otro motivo.
