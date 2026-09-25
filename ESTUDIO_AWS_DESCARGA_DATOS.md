# ESTUDIO — AWS para la descarga de datos del teléfono (19/09/2026, sobre 1.41.0)

**Pregunta:** los teléfonos se saturan a medida que avanza el día; a veces se llena la caché del
celular y eso cierra la sesión o deja el mapa sin ubicaciones. ¿Poner AWS entre el teléfono y el
backend lo resuelve?

**Respuesta corta:** no como transporte. El teléfono no sufre por *de dónde* baja los datos sino por
*cuántos* baja y retiene: la jornada entera de posiciones crudas de toda la empresa (**3-4,7 MB por
día, 16-26k puntos**) más una copia de cada fila por Realtime (**5-7 MB más por pantalla abierta**),
todo dentro de un WebView que en la PWA tiene **~5 MB de `localStorage`** compartidos con el catálogo
(1,45 MB) y con la sesión. Mover ese mismo JSON a S3 lo baja igual de grande. Lo que lo achica es
**pre-agregar del lado del servidor** —y el servidor ya lo hace a medias: `recorridos_snap` tiene la
geometría del día en **86-191 KB**, y el cliente la descarta.

AWS tiene un lugar posible como **capa de snapshots estáticos** (S3 + CloudFront), y en este
documento está diseñada y costeada. Pero es el paso 2: sin la pre-agregación es una CDN que sirve el
mismo archivo de 4 MB. La recomendación es el **Plan A** (§6, sin AWS, ataca las cuatro causas) y
dejar el **Plan B** (§7, con AWS) para cuando haya más de una empresa mirando el mapa a la vez.

Todo número de este documento sale de la base viva (`lqhtxivednffpiicnbog`, plan **Pro**) o del
código, con la consulta o el `archivo:línea` al lado. Precios de AWS y Supabase consultados el
19/09/2026 (§8).

---

## 1. El síntoma, desarmado en cuatro causas

| # | Causa | Se ve como | Dónde |
|---|---|---|---|
| C1 | **Volumen crudo en el cliente**: el supervisor baja y retiene todas las posiciones del día | Lentitud creciente durante el día, mapa que tarda en redibujar, memoria | `useRecorridosDelDia.js` |
| C2 | **Almacenamiento del WebView lleno** (PWA): catálogo + recorridos + cola + sesión compiten por ~5 MB | **Sesión cerrada**, mutaciones que no se anotan | `persistence/index.js`, `supabase.js:90-114` |
| C3 | **Realtime manda la fila entera** de `posiciones` a cada pantalla | Datos móviles y CPU; el socket pesa más que el polling | `realtime.js:30-47` |
| C4 | **Latencia del servidor por policies fila a fila**: `clientes_sel`, `productos_sel` y otras 19 evalúan `mi_empresa()`/`es_superadmin()` por fila | "Cargando clientes…" largo, timeouts de 10 s (`fetchConTimeout`) con señal mediocre | `pg_policy`, 144 M seq scans en `perfiles` |

Las cuatro son independientes y se miden por separado.

### 1.1 Qué baja cada rol (medido)

| Rol / pantalla | Qué | Tamaño | Cuándo | Consulta |
|---|---|---|---|---|
| **Todos** al arrancar | `productos` (632) + `clientes` (2.048) + `zonas` + `categorias` con `select *` paginado | **420 KB + 1.016 KB + 8 KB** = ~1,45 MB | Al montar y cuando cambia `sello_precios()` (chequeo cada 20 min) | `services/data/catalogo.js:40-66` |
| **Supervisor** (`SupervisionMovil`/`Desktop`, `PanelDireccion`) | `posiciones` del día de toda la empresa: `id,id_usuario,[rol,]lat,lng,ts,bateria,accuracy` | **2,9-4,7 MB/día** (15,9k-25,8k puntos; hasta 4.851 por persona) | Completa al abrir sin caché válida; luego incremental por `id` cada 60 s | `useRecorridosDelDia.js:83-140` |
| Supervisor | Realtime `postgres_changes` INSERT en `posiciones`, fila completa | **289 B × puntos/día ≈ 4,6-7,5 MB/día por pantalla** | Continuo mientras la pantalla está abierta | `realtime.js:30-47`, `useEquipoEnVivo.js` |
| Supervisor | `snap-recorridos` (Edge Function): `geometrias` + `conectores` | 86-191 KB por respuesta; **`geometrias` se descarta** | Cuando cambia la firma de huecos (`useSnapConectores`) | `recorridos.js:30-33` |
| Supervisor | `estado_dispositivo` (16 filas, 23 KB), `alertas_equipo`, `tramos_transporte`, `ultimo_punto_equipo`, `vigilancia_*` | KB | Cada 2-5 min | hooks varios |
| Vendedor | `pedidos` + items (52 hoy, 49 KB), `visitas`, `metricas_venta` | KB | Al montar / cada REFRESH | `usePedidos.js`, `useVisitasDelDia.js` |

> Puntos por día hábil, empresa La Unión, últimos 7 días (`select date(ts at time zone
> 'America/Argentina/Salta'), count(*) …`): 25.805 · 23.924 · 19.221 · 22.297 · 19.129 · 18.588 ·
> 15.898. Sábado 19 y domingo 14: 15.9k y 18.6k — **se rastrea también el fin de semana**.

### 1.2 El presupuesto de almacenamiento del teléfono

| Canal | Dónde persiste | Tope | Qué compite |
|---|---|---|---|
| **APK** | SQLite (`@capacitor-community/sqlite`, tabla `kv`) con fallback a `localStorage` | Sin tope práctico (disco) | Cola GPS (`lu-pos-queue`), cola de escrituras, caché de catálogo, caché de recorridos, perfil |
| **PWA** (PC de la oficina, iPhone del dueño, cualquier navegador) | `localStorage` | **~5 MB por origen** (Chrome/Safari) | Lo mismo **más la sesión de auth-js** (`sb-<ref>-auth-token`, ~2-4 KB pero escrita con `setItem` crudo en cada refresh) |

El 18/09 la PC de la oficina llenó los 5 MB a media mañana: catálogo 1,3 MB + recorridos ~1 MB
creciendo + cola. `persistence.set` tragaba el `QuotaExceededError` y **las asignaciones de zona se
perdieron en silencio**; y como auth-js guarda la sesión sin `try/catch`, un refresh que no puede
escribirse pierde el refresh token **ya rotado en el servidor** → la próxima llamada da 401 → "se
cerró la sesión". Es exactamente el síntoma reportado, y es de la **PWA**, no del APK.

**Lo que ya se hizo (1.41.0, 18/09):** tope de 600 KB a la caché de recorridos
(`CACHE_MAX_CHARS`), desalojo de cachés antes de perder una escritura (`desalojarCaches`), y el
storage de auth pasa por el mismo desalojo (`authStorage` en `supabase.js:100-114`). Eso corta la
pérdida de sesión **mientras la suma de lo indispensable quepa en 5 MB**. No corta el crecimiento
de C1.

### 1.3 Memoria y CPU en el cliente

`byUser` guarda 16-26k objetos `{lat,lng,ts,bateria,accuracy}` y cada tick de 60 s los recorre:
`limpiarPorUsuario` (`trazos.js`: `limpiarTrazo`, `partirPorTramos`, `pisoDeRuido`) +
`detectarParadas` (`dwell.js`) + `construirLeaflet` (multi-polilíneas). En un Samsung A07 con
WebView viejo (los chunks `-legacy` existen por eso) es la carga que "se siente" a la tarde. No se
midió con profiler en este estudio; es la consecuencia directa de C1 y se corrige con C1.

### 1.4 El servidor: dónde se va el tiempo

`pg_stat_statements` (acumulado desde el 05/07):

| Consulta | Llamadas | Media | Origen |
|---|---|---|---|
| Decodificación del WAL de Realtime (`SELECT wal->>…`) | 3,93 M | 5,9 ms | `postgres_changes` sobre `posiciones` (+`pedidos`, que nadie escucha) |
| `posiciones` paginada (id_usuario,lat,lng,ts,accuracy) desde service role | 256k | 10,9 ms | `snap-recorridos` releyendo la jornada (pre-13/09 era cada 60 s por pantalla) |
| `metricas_actividad(p_desde,p_hasta)` | 881 | **2.410 ms** | 29-150 días de recorridos por llamada (pre-13/09) |
| `ultimas_posiciones(p_empresa)` | 1.810 | 997 ms | Pre-`db/67` (hoy 7 ms) |
| **`clientes` `select *` por empresa** | 4.335 + 2.028 + 494 | **277 / 305 / 711 ms** | Cada arranque de cada teléfono |
| `productos` `select *` por empresa | 1.686 | 249 ms | Ídem |
| `ingest-posiciones` (INSERT) | 507k | 3,5 ms | Nativo |

Y la medición que explica los 277-711 ms del catálogo, reproducible con rol `authenticated` y el
JWT de un vendedor:

| `select * from clientes where id_empresa=… order by nombre_comercio limit 1000` | Tiempo | Buffers |
|---|---|---|
| Con `clientes_sel` = `es_superadmin() OR id_empresa = mi_empresa()` (como está) | **78,9 ms** | **4.164** |
| Sin policy (baseline de la consulta) | 4,9 ms | 68 |

Los 4.096 buffers de diferencia son **dos lecturas de `perfiles` por cada una de las 2.048 filas**.
`perfiles` acumula **144.230.332 seq scans** por esto. `posiciones_sel`, `perfiles_sel` y
`estado_disp_sel` ya están escritas con `(select mi_empresa())` — el patrón correcto está en la
misma base; falta aplicarlo a las otras 21 (lista en [AUDITORIA_CODIGO_2026-09.md](AUDITORIA_CODIGO_2026-09.md) §5.2).

---

## 2. Por qué "mover a AWS" no toca ninguna de las cuatro causas por sí solo

| Causa | ¿La resuelve cambiar el origen de descarga? |
|---|---|
| C1 volumen crudo | **No.** 4 MB desde CloudFront son 4 MB. Lo que reduce es simplificar el trazo (Douglas-Peucker) y mandar delta: eso es cómputo, y se hace en Postgres, en una Edge Function o en una Lambda — el lugar es indistinto, el resultado es lo que importa |
| C2 storage lleno | **No.** Es del WebView. Se resuelve con IndexedDB (PWA), no persistiendo crudo, y con lo que ya se hizo el 18/09 |
| C3 Realtime fila entera | **No** con S3. Sí con un pub/sub distinto (IoT Core, AppSync) — pero Supabase Broadcast desde trigger hace lo mismo sin segundo proveedor |
| C4 policies fila a fila | **No.** Es una migración SQL de una tarde |

Egress tampoco es el cuello: la cuenta de hoy es ~20-40 MB/día por supervisor + ~15 MB/día por
vendedor ≈ **3-6 GB/mes** contra 250 GB incluidos en Pro. Invocaciones: ~9k/día de
`ingest-posiciones` ≈ 270k/mes contra 2 M. Realtime: 19k inserts × 3 pantallas × 22 días ≈ 1,3 M
mensajes contra 5 M. **El plan no está saturado; el teléfono sí.**

---

## 3. Las opciones de AWS, una por una

Criterios: qué resuelve / qué no · costo mensual a la escala de hoy (12 teléfonos, 1 empresa activa,
3 pantallas de supervisión) y a ×10 · esfuerzo · riesgo · choque con reglas del repo (regla 36:
una regla en varios runtimes; offline-first con dos colas idempotentes; PKCE en el APK; RLS por
tenant; `fetchConTimeout` de 10 s; un solo desarrollador).

### (a) S3 + CloudFront como capa de snapshots — la que más se parece a la idea original

**Diseño:** EventBridge cada 60 s → Lambda (`sa-east-1`) llama a Supabase con service key una RPC
`recorridos_resumen(empresa, fecha)` → escribe `s3://…/<empresa>/<fecha>.json.gz` (~150-300 KB:
polilínea simplificada por persona + paradas + últimos 30 min crudos) → CloudFront con **URL
firmada** (key group) → el teléfono hace `GET` con `If-None-Match` y recibe 304 si no cambió.

| | |
|---|---|
| Resuelve | C1 (si la RPC simplifica) y saca del Postgres la lectura repetida del supervisor. Escala lineal con empresas sin tocar la base |
| No resuelve | C2, C3, C4. El vendedor no lo usa. Sigue habiendo que escribir la RPC de resumen — **que es el 80 % del trabajo y no necesita AWS** |
| Costo hoy | Lambda: 1.440 inv/día × ~1 s × 256 MB ≈ 11k GB-s/mes → dentro de la capa gratis (1 M req, 400k GB-s). S3: 43k PUT/mes ($0,22) + 0,3 GB. CloudFront: 3 pantallas × 1.440 GET × 200 KB ≈ 26 GB/mes → dentro del TB gratis. **≈ US$ 1-3/mes** |
| Costo ×10 | ≈ US$ 10-25/mes. Sigue siendo barato |
| Esfuerzo | RPC (1-2 días, **igual que en Plan A**) + Lambda + IaC (CDK/Terraform) + key group + Edge Function que firma URLs por tenant + cliente: 3-5 días más |
| Riesgos | (1) **Dos identidades**: el JWT de Supabase no vale en CloudFront; hay que firmar URLs por tenant desde una Edge Function y manejar 403 por vencimiento en el teléfono. (2) **Staleness**: hasta 60 s + el retraso de la Lambda; el "vivo" sigue viniendo por otro canal (C3). (3) **Regla 36**: el aislamiento por tenant pasa a vivir en RLS *y* en el prefijo del bucket *y* en la firma. (4) La Lambda lee Supabase con service key: una credencial más que rotar. (5) `fetchConTimeout` no aplica a un `fetch` a CloudFront: hay que replicar el timeout. (6) Una persona operando dos consolas |
| Veredicto | 🟡 **Válida como paso 2**, cuando la RPC de resumen ya exista y haya varias empresas mirando el mapa. Antes es una CDN delante de un archivo que todavía no existe |

### (b) Lambda / API Gateway reemplazando Edge Functions

| | |
|---|---|
| Resuelve | Techo de invocaciones y cold starts de Deno **si fueran problema** (no lo son: 270k/mes de 2 M) |
| No resuelve | Ninguna de las cuatro causas |
| Costo | Hoy ~gratis; API Gateway HTTP $1/M req |
| Riesgos | Reescribir validación de `ingesta_tokens`, CORS, logs en CloudWatch, y el `UploaderGpsService.java` apuntando a otra URL (APK) |
| Veredicto | 🔴 No hay un problema que resuelva |

### (c) DynamoDB / Timestream para `posiciones`

| | |
|---|---|
| Resuelve | Escritura masiva a escala de millones de dispositivos |
| No resuelve | C1-C4. Y **pierde RLS, `posiciones_sel` por jerarquía (`ids_a_mi_cargo`), `ultimas_posiciones`, `metricas_actividad`, `vigilancia_equipo`, `limpiar_posiciones_viejas`** — 6 funciones SQL sobre esa tabla que habría que reescribir |
| Costo | On-demand: 19k escrituras/día ≈ $0,3/mes + lecturas; irrelevante |
| Riesgos | Reescritura del pipeline GPS entero (zona peligrosa 🔴 del CLAUDE.md), dos fuentes de verdad, consultas por rango de tiempo que en Dynamo exigen diseñar la partition key a mano |
| Veredicto | 🔴 Desproporcionado para 725k filas / 211 MB |

### (d) IoT Core / AppSync para el "vivo"

| | |
|---|---|
| Resuelve | C3: mensajes chicos por MQTT/WebSocket en vez de la fila entera |
| No resuelve | C1, C2, C4 |
| Costo | IoT Core: $1/M mensajes + conexión; hoy ~$0,1/mes |
| Riesgos | El nativo publicaría en IoT **además** de insertar en Postgres (dos escrituras, dos credenciales en el teléfono: certificado X.509 o Cognito Identity). Realtime de Supabase ya tiene **Broadcast desde trigger** (`realtime.send()`) que hace exactamente esto con payload propio y canal privado con RLS |
| Veredicto | 🔴 Hay equivalente sin segundo proveedor (Plan A, paso 4) |

### (e) Amplify DataStore / AppSync con sincronización offline

| | |
|---|---|
| Resuelve | Reemplazaría `queue.js` y `writeQueue.js` por un motor de sync con resolución de conflictos |
| No resuelve | C1-C4 directamente |
| Riesgos | Las dos colas tienen **20+ guardas por bugs de campo** (cuarentena, dueño de la cola, `SIN_FILAS`, `visibilitychange` como despertar). DataStore trae su propio modelo de conflictos (last-writer-wins por defecto) y su propio esquema (GraphQL); es tirar todo el Postgres + RLS o duplicarlo. Es la migración (h) por la puerta de atrás |
| Veredicto | 🔴 |

### (f) CloudFront delante de Supabase como caché de `GET`

| | |
|---|---|
| Resuelve | Nada: PostgREST responde según el `Authorization` de cada usuario; una CDN que respete eso tiene hit ratio ≈ 0, y una que no lo respete es una fuga entre tenants |
| Veredicto | 🔴 No aplica a un API autenticado por fila |

### (g) S3/CloudFront para el APK y el bundle OTA en vez de GitHub Releases

| | |
|---|---|
| Resuelve | Descarga del APK (23 MB) y del bundle (1,3 MB) desde un CDN con presencia en Sudamérica; hoy vienen de GitHub (EE. UU.) |
| No resuelve | C1-C4. La descarga del APK ya tiene freno de 6 h por versión (regla 48) |
| Costo | 12 teléfonos × 23 MB por release → despreciable |
| Veredicto | 🟢 Opcional y barato, pero es otra cosa: no toca el problema de hoy |

### (h) Migración total (RDS/Aurora + Cognito + Amplify Hosting)

| | |
|---|---|
| Resuelve | Control total |
| Costo | RDS `db.t4g.micro` Multi-AZ ≈ US$ 30-50/mes + Cognito + tiempo |
| Riesgos | Reimplementar Auth (Google PKCE en el APK costó semanas), Realtime, Storage, pg_cron/pg_net, 8 Edge Functions, RLS con `auth.uid()`. [PLAN_BACKEND_DEDICADO.md](PLAN_BACKEND_DEDICADO.md) ya analiza la alternativa de Supabase self-hosted y concluye que el problema es "red y continuidad, no capacidad" |
| Veredicto | 🔴 Nada de lo medido lo justifica |

### Resumen

| Opción | C1 | C2 | C3 | C4 | Costo/mes hoy | Esfuerzo | Veredicto |
|---|---|---|---|---|---|---|---|
| (a) S3+CloudFront snapshots | ✅ si hay RPC de resumen | — | — | — | $1-3 | 5-7 días | 🟡 paso 2 |
| (b) Lambda/API GW | — | — | — | — | ~0 | 3 días | 🔴 |
| (c) DynamoDB | — | — | — | — | ~0 | semanas | 🔴 |
| (d) IoT Core | — | — | ✅ | — | ~0 | 4 días + APK | 🔴 (hay equivalente) |
| (e) Amplify DataStore | — | — | — | — | ? | semanas | 🔴 |
| (f) CloudFront caché | — | — | — | — | — | — | 🔴 no aplica |
| (g) S3 para APK/OTA | — | — | — | — | ~0 | 1 día | 🟢 opcional |
| (h) Migración total | — | — | — | — | $50+ | meses | 🔴 |
| **Plan A (sin AWS)** | ✅ | ✅ | ✅ | ✅ | $0 | 6-9 días | ✅ |

---

## 4. Adversidades transversales de sumar AWS

1. **Segundo sistema de identidad.** Supabase Auth emite el JWT; AWS no lo conoce. Toda lectura
   desde el teléfono a AWS necesita o una URL firmada (que alguien con el JWT tiene que pedir a una
   Edge Function) o Cognito Identity Pool federado (otro proyecto de configuración). El aislamiento
   por tenant deja de ser sólo RLS.
2. **Credenciales en más lugares.** Service key de Supabase dentro de la Lambda; clave privada de
   CloudFront en la Edge Function; IAM para el deploy. Rotar cualquiera es un release.
3. **Región y latencia.** `sa-east-1` es la misma región de Supabase, así que la latencia no cambia;
   pero AWS en São Paulo cobra **US$ 0,138/GB** de egress y **US$ 0,0405/GB-mes** en S3 contra
   0,09 y 0,023 en Virginia (+50-75 %). A la escala de hoy es centavos; a ×10 sigue siendo poco.
4. **Operación para una persona.** CloudWatch, alarmas, IaC, facturación aparte, otro dashboard que
   nadie mira hasta que falla. El repo ya tiene la lección con Headwind MDM ("operación permanente
   de otro servidor").
5. **Coherencia snapshot ↔ vivo.** Con (a) el trazo viene de un archivo de hace ≤ 60 s y el punto
   "vivo" de otro canal; hay que reconciliar en el cliente (hoy `useRecorridosDelDia` +
   `useEquipoEnVivo` ya lo hacen, pero contra la misma fuente).
6. **Offline-first.** Nada de esto afecta a las colas de escritura (van a Supabase), pero un snapshot
   en caché del cliente tiene que respetar el mismo criterio de "la caché nunca es barrera" de
   `useRecorridosDelDia.js:258-266`.
7. **Regla 36.** La simplificación del trazo (umbrales `HUECO_M`, `PINCHO_*`, `ACCURACY_MAX_M`) vive
   hoy en `lib/geo.js` (JS). Llevarla a una Lambda es una **cuarta** copia del techo de precisión
   (ya son 4 runtimes). En Postgres es una tercera copia también — pero es la que ya tienen
   `metricas_actividad` y `vigilancia_equipo`, y CLAUDE.md dice que "el cálculo pesado se muda al
   servidor y los umbrales se generan desde un archivo único".

---

## 5. Lo que ya existe y se está tirando

`recorridos_snap` guarda, **por persona y día**, la geometría pegada a calles (`geometria` jsonb) y
`snap-recorridos` la devuelve en `geometrias`:

| Día | Personas | Puntos snap | `geometria` JSON | Puntos crudos | Crudo JSON |
|---|---|---|---|---|---|
| 19/09 | 8 | 10.124 | **95 KB** | 15.899 | 2,9 MB |
| 18/09 | 9 | 9.802 | **98 KB** | 18.588 | 3,4 MB |
| 16/09 | 9 | 13.617 | **191 KB** | 22.297 | 4,1 MB |
| 12/09 | 10 | 15.235 | **191 KB** | 23.924 | 4,4 MB |

`recorridos.js:30` lee `geometrias`, las convierte a `{lat,lng}`… y los cuatro consumidores usan sólo
`_conectores`. **Ya hay una versión 20-40× más chica del día, calculada y cacheada, viajando al
teléfono y descartándose.** No es idéntica al crudo (es el snap de OSRM `foot`, con la salvedad de
que a veces adelgaza demasiado —por eso existía `cubreElRecorrido`, hoy sin llamar), pero es el
punto de partida de cualquier "resumen del día".

---

## 6. Plan A — sin AWS, ataca las cuatro causas

Ordenado por relación impacto/esfuerzo. Los pasos 1 y 4 no tocan el cliente.

### Paso 1 · Policies con `(select …)` — C4 — sólo SQL, sin release

Migración `db/77`: reescribir las 21 policies que evalúan helpers por fila
(`clientes_sel/upd/del/ins`, `productos_sel/wr`, `perfiles_upd`, `posiciones_ins`, `estado_disp_ins/upd`,
`pedidos_ins`, `items_ins`, `visitas_ins`, `metas_*`, `tramos_ins`, `coberturas_zona_*`,
`pedido_ediciones_ins`, `ingesta_tokens_sel`, `pcr_sel`, `rutas_sel`) como
`(select es_superadmin()) OR id_empresa = (select mi_empresa())`. Mismo resultado lógico, una
evaluación por consulta. Aprovechar para restringir las 7 `*_wr` a `insert/update/delete` (hoy
duplican el `SELECT`) y agregar los índices de `clientes(id_vendedor)`, `clientes(id_zona)` y
`posiciones(id_empresa, ts)`.

- Esperado: `clientes` de 79 → ~5 ms de CPU por página; `perfiles` deja de sumar millones de scans;
  menos timeouts de 10 s con señal mala.
- Verificación: el `explain analyze` de §1.4 antes y después; `pg_stat_user_tables.seq_scan` de
  `perfiles` sin crecer.
- Riesgo: bajo. Es una reescritura sintáctica; se prueba con los 6 roles antes de aplicar.
- Esfuerzo: medio día.

### Paso 2 · Resumen del día del lado del servidor — C1 — SQL + OTA

RPC `recorridos_resumen(p_empresa uuid, p_fecha date, p_desde_id bigint default null)` que devuelve,
por persona:

- `trazo`: polilínea **simplificada** (Douglas-Peucker con tolerancia ~8-10 m en plpgsql, ~40
  líneas; o directamente `recorridos_snap.geometria` cuando exista para ese día) partida en los
  mismos tramos que hoy define `limpiarTrazo` (hueco > `HUECO_M`, precisión > `ACCURACY_MAX_M`);
- `paradas`: lo que hoy calcula `detectarParadas` en el cliente (ya hay SQL equivalente en
  `metricas_actividad`: `minutos_movimiento`, `paradas`);
- `cola`: los puntos crudos con `id > p_desde_id` (el delta que hoy ya se pide por `id`), acotado a
  las últimas 2 horas;
- `ultimo`: el último punto confiable (hoy `ultimo_punto_equipo`).

El cliente (`useRecorridosDelDia`) pasa a: al abrir, **una llamada** que trae ~150-300 KB en vez de
21 páginas y 4 MB; cada 60 s, sólo `cola` desde el último `id`. En memoria retiene el trazo
simplificado + las 2 h crudas (para las paradas recientes y el "vivo"), no el día entero. Los
umbrales (`HUECO_M`, `ACCURACY_MAX_M`, tolerancia) se generan desde un archivo único hacia JS y SQL,
como pide CLAUDE.md §1 — ese generador es parte del paso.

- Esperado: descarga inicial ×15-25 menor; `byUser` de 20k objetos a ~2-3k; el redibujo por tick
  deja de recorrer el día entero.
- Riesgo: medio. `limpiarTrazo`/`detectarParadas` tienen 8 umbrales calibrados con bugs de campo
  (`lib/geo.js`); la versión SQL tiene que dar el mismo dibujo. Se verifica comparando, para 5 días
  ya cerrados, km y paradas del cliente viejo contra la RPC.
- Esfuerzo: 3-4 días (RPC 1-2, cliente 1-2, comparación 1).
- Canal: SQL + OTA/PWA. **No requiere APK.**

### Paso 3 · IndexedDB en la PWA y nada crudo persistido — C2 — OTA

`services/persistence` gana un backend IndexedDB para web (`idb-keyval` o 40 líneas propias, mismo
contrato `get/set/remove`), con `localStorage` reservado a la sesión de auth-js y a la cola de
escrituras (las dos cosas que no se rehacen de la red). Las cachés (catálogo 1,45 MB, recorridos,
métricas) se mudan a IndexedDB (cientos de MB disponibles). Y con el paso 2, la caché de recorridos
guarda el resumen, no el crudo.

- Esperado: desaparece el `QuotaExceededError` como modo de falla en la PC de la oficina y en el
  iPhone del dueño; la sesión no vuelve a perderse por espacio.
- Riesgo: bajo. El APK no cambia (sigue en SQLite). Safari en iOS purga IndexedDB tras 7 días sin
  uso — es caché, se rehace.
- Esfuerzo: 1 día.

### Paso 4 · Realtime por Broadcast desde trigger — C3 — SQL + OTA

Trigger `after insert on posiciones` → `realtime.send(jsonb_build_object('u',id_usuario,'lat',lat,'lng',lng,'ts',ts,'acc',accuracy), 'pos', 'empresa:'||id_empresa, true)`
(canal privado; policy sobre `realtime.messages` por `mi_empresa()`). El cliente
(`suscribirPosiciones`) escucha `broadcast` en `empresa:<id>` en vez de `postgres_changes`. Sacar
`posiciones` y `pedidos` de la publicación `supabase_realtime` (nadie escucha `pedidos`).

- Esperado: de 289 B a ~80 B por evento (4,6-7,5 → ~1,5-2 MB/día por pantalla); Postgres deja de
  decodificar WAL para dos tablas; el mismo canal sirve para publicar "en ruta sin declarar" u otros
  avisos sin tabla de por medio.
- Riesgo: bajo-medio. Broadcast no reenvía lo perdido durante una desconexión — hoy tampoco
  (`postgres_changes` tampoco), y el incremental por `id` del paso 2 cubre el hueco.
- Esfuerzo: 1 día. De paso, conectar el punto verde "en vivo" al estado real del canal (hoy es
  decorativo, ver auditoría §3.1 #1).

### Paso 5 · Catálogo más liviano — mejora de C1 para el vendedor — OTA

`traerTodo` con columnas explícitas en vez de `select *` (`mapCliente` usa 18 de las 20 columnas de
`clientes` —`created_at` y `codigo_norm` viajan sin uso—; en `productos`, sólo `codigo_norm`), y la consulta a `categorias` (siempre `[]`) deja de hacerse hasta que la tabla se use.
El ahorro por columnas es chico (~5-10 %); el grande es el snapshot comprimido. Opcional y ya "estilo
snapshot" pero sin AWS: una función que al terminar `importar_precios` escriba
`catalogo/<empresa>.json.gz` en **Supabase Storage** (CDN incluida, `ETag`, cached egress a
$0,03/GB) y que el teléfono baje con `If-None-Match`; RLS por prefijo de bucket ya existe (`db/25`).

- Esperado: 1,45 MB → ~1,3 MB por recarga sólo con columnas; con el snapshot comprimido, ~250 KB y un solo request.
- Esfuerzo: medio día (columnas) · 1-2 días (snapshot).

### Resultado esperado del Plan A completo

| Métrica | Hoy | Después |
|---|---|---|
| Descarga inicial del supervisor | 2,9-4,7 MB, 16-26 requests | ~150-300 KB, 1 request |
| Objetos en memoria por pantalla de supervisión | 16-26k | 2-3k |
| Realtime por pantalla/día | 4,6-7,5 MB | 1,5-2 MB |
| `localStorage` en PWA | catálogo + recorridos + cola + sesión en 5 MB | sesión + cola; cachés en IndexedDB |
| `clientes` por página (CPU servidor) | 79 ms / 4.164 buffers | ~5 ms / ~70 buffers |
| Proveedores | 1 | 1 |
| Esfuerzo total | | **6-9 días**, sin APK |

---

## 7. Plan B — con AWS, si igual se decide

Es la opción (a) montada **sobre** el paso 2 del Plan A (la RPC de resumen es la misma; sin ella no
hay nada que publicar).

```
posiciones (Postgres) ──trigger──▶ Broadcast (vivo, paso 4)
        │
        └─ RPC recorridos_resumen(empresa, fecha)
                 ▲
   EventBridge (rate 1 min) ─▶ Lambda distat-snapshot (Node 22, sa-east-1, 256 MB)
                                   │  service key en Secrets Manager
                                   ▼
                        S3 distat-snapshots/<empresa>/<fecha>.json.gz  (SSE-S3, lifecycle 45 días)
                                   │
                        CloudFront (OAC a S3, key group, TTL 30 s, Brotli)
                                   ▲
   Teléfono ─▶ Edge Function firmar-snapshot (verifica JWT + mi_empresa) ─▶ URL firmada 15 min
   Teléfono ─▶ GET CloudFront con If-None-Match ─▶ 200 (JSON) | 304
```

**Qué cambia en la app:** un solo punto — `services/recorridos.js` gana `fetchResumenDia()` que
prueba CloudFront y cae a la RPC directa si hay 403/timeout (mismo criterio "la caché no es barrera").
`useRecorridosDelDia` no sabe de dónde vino.

**Costo mensual (hoy → ×10 empresas):** Lambda $0 → $0 (dentro de la capa gratis permanente);
S3 $0,3 → $3; CloudFront $0 → $0 (1 TB gratis); Secrets Manager $0,40; **total ≈ US$ 1 → 5**.
El costo real es el tiempo: **+3-5 días** sobre el Plan A y una consola más para siempre.

**Cuándo tiene sentido:** cuando haya ≥ 3-4 empresas con supervisión abierta a la vez, o un cliente
que exija que sus datos de recorrido se sirvan desde su propia cuenta de AWS (el escenario de
[PLAN_BACKEND_DEDICADO.md](PLAN_BACKEND_DEDICADO.md) §5). Antes, la misma capa de snapshots se
puede hacer en **Supabase Storage** con `pg_net` + `pg_cron` y cero proveedores nuevos.

---

## 8. Fuentes y precios (consultados el 19/09/2026)

| Servicio | Dato | Fuente |
|---|---|---|
| Supabase Pro | US$ 25/mes · 8 GB DB · 250 GB egress ($0,09/GB después; cached $0,03) · 2 M invocaciones Edge ($2/M) · 5 M mensajes Realtime ($2,50/M) · 500 conexiones pico · 100 GB Storage | https://supabase.com/pricing |
| CloudFront | 1 TB/mes y 10 M requests **gratis para siempre**; después Sudamérica $0,110/GB y $0,022/10k HTTPS; origen S3 → CloudFront gratis | https://aws.amazon.com/cloudfront/pricing/pay-as-you-go/ |
| Lambda | 1 M requests y 400k GB-s/mes gratis; $0,20/M req; $0,0000167/GB-s (us-east-2; SP no listado); Function URLs sin cargo extra | https://aws.amazon.com/lambda/pricing/ |
| S3 Standard | us-east-1: $0,023/GB-mes, PUT $0,005/1k, GET $0,0004/1k; **sa-east-1: $0,0405/GB-mes, egress desde $0,138/GB** | https://aws.amazon.com/s3/pricing/ · https://aws-pricing.com/sa-east-1.html · https://www.rfxtech.com.br/blog/quanto-custa-aws |
| Base viva | `pg_stat_statements`, `pg_stat_user_tables`, `cron.job_run_details`, `storage.objects`, advisors de performance; consultas en [AUDITORIA_CODIGO_2026-09.md](AUDITORIA_CODIGO_2026-09.md) §8 | MCP Supabase, proyecto `lqhtxivednffpiicnbog` |

Consultas reproducibles de este estudio:

```sql
-- puntos y bytes por día
with d as (select (ts at time zone 'America/Argentina/Salta')::date dia, id_usuario, count(*) n,
  sum(length(json_build_object('id',id,'id_usuario',id_usuario,'lat',lat,'lng',lng,'ts',ts,'bateria',bateria,'accuracy',accuracy)::text)) bytes
  from posiciones where ts > now() - interval '9 days' group by 1,2)
select dia, sum(n) puntos, count(*) personas, max(n) max_persona, pg_size_pretty(sum(bytes)::bigint) from d group by 1 order by 1 desc;

-- lo que ya existe resumido
select fecha, count(*) personas, sum(puntos), pg_size_pretty(sum(length(geometria::text))::bigint) from recorridos_snap where fecha > current_date-8 group by 1 order by 1 desc;

-- tamaño del catálogo que baja cada teléfono
select count(*), pg_size_pretty(sum(length(row_to_json(c)::text))::bigint) from clientes c where id_empresa='…';

-- costo de la policy por fila (rol authenticated con JWT de un vendedor)
begin; select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}',true); set local role authenticated;
explain (analyze,buffers) select * from clientes where id_empresa='…' order by nombre_comercio limit 1000; rollback;
```
