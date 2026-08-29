# Backend dedicado self-hosted para un cliente + selector de backend en runtime

> **Estado: PROPUESTA. No se ejecutó nada de esto — ni infraestructura ni código.**
> Fecha: 26/08/2026 · Complementa [CLAUDE.md](CLAUDE.md) y [PLAN_SAAS.md](PLAN_SAAS.md).

Un cliente del SaaS quiere comprar una PC propia (Intel i7, 32 GB RAM, 2 TB NVMe) para levantar
**Supabase self-hosted** como backend privado y dedicado a su empresa, en vez de compartir el
proyecto Supabase Cloud multi-tenant que usa el resto de los clientes. Además se pide que la
**misma app** (mismo build de PWA/APK) pueda, según qué usuario inicia sesión, conectarse a ese
backend self-hosted o al backend cloud actual.

Este documento contesta cuatro preguntas: si es viable, qué hay en el backend actual que habría que
replicar, cómo se monta el self-hosted, y cómo hace una sola app para hablar con dos backends
distintos. Todo lo que sigue está verificado contra la base viva (MCP de Supabase, no contra los
`.sql` de `db/`, que están desactualizados — regla 5 de `CLAUDE.md`), contra el código real del
repo, y contra la documentación vigente de self-hosting de Supabase a la fecha de este documento.

**Por qué esto es distinto de [PLAN_SAAS.md](PLAN_SAAS.md):** ese plan resuelve multi-tenancy
*dentro de un mismo proyecto* Supabase (`empresa`/`corporación` + RLS). Lo que se pide acá es dos
**proyectos/instancias físicamente separados** — cloud y el servidor propio del cliente — y una app
que elige a cuál conectarse según el usuario. Los dos mecanismos conviven sin pisarse: adentro de
cada backend (cloud o self-hosted) puede seguir habiendo varias `empresas` si hiciera falta.

---

## 1. Veredicto de viabilidad

### 1.1 Cómputo: sobra, por mucho

La documentación oficial de self-hosting pide un **mínimo** de 4 GB RAM / 2 núcleos / 40 GB de
disco, y **recomienda** 8 GB+ / 4+ núcleos / 80 GB+ para correr el stack completo (Postgres +
GoTrue + PostgREST + Realtime + Storage + gateway + Studio + edge-runtime) con margen. Un i7 con
32 GB de RAM y 2 TB de NVMe es **~4× la RAM recomendada y ~25× el disco recomendado**, para una
carga que va a ser una sola empresa: unas pocas decenas de usuarios, GPS de un puñado de
dispositivos posteando cada 5-30 segundos, un catálogo con fotos. No hay ningún escenario de
CPU/RAM/disco en el que este hardware no alcance.

### 1.2 El problema real: red y continuidad, no capacidad

Poner el backend en una PC dentro de la oficina del cliente tiene cuatro riesgos que no dependen de
qué tan potente sea la máquina:

**(a) Alcanzabilidad.** Los celulares de vendedores y repartidores salen a la calle: necesitan
pegarle al backend por **internet**, no por la red local de la oficina. La mayoría de las
conexiones residenciales y comerciales en Argentina están detrás de **CGNAT** — no hay una IP
pública que exponer sin pagarle al ISP un add-on de "IP fija", que no todos los proveedores ofrecen
y que cuando existe no es gratis.

**(b) Continuidad.** Sin UPS, un corte de luz o de internet en la oficina del cliente tira **todo**
al mismo tiempo: GPS, catálogo, pedidos. No hay SLA como en la nube — si la conexión de la oficina
cae dos horas, el backend está caído dos horas.

**(c) Mantenimiento.** Parches del sistema operativo y de Docker, upgrades de versión de Postgres,
espacio en disco, alguien mirando que el servicio siga arriba. Hoy Supabase Cloud se ocupa de todo
esto; con self-hosted pasa a ser responsabilidad de alguien concreto — el cliente o quien lo
administre a distancia.

**(d) Backups.** El self-hosting de Supabase **no trae ningún mecanismo de backup automático** —
es explícito en la documentación oficial. Hoy Supabase Cloud hace backups solo; con self-hosted hay
que armar un cron propio (`pg_dump` o WAL-G) y sacar la copia **fuera del sitio**: si se prende
fuego o roban la oficina, un backup en el mismo disco no sirve de nada.

> **Precedente dentro de este mismo proyecto.** Al decidir dónde alojar el servidor de Headwind MDM
> (que los 9 teléfonos del parque necesitan poder alcanzar desde la calle — el mismo problema de
> forma que el (a) de acá), `HANDOFF.md §7.9` ya resolvió explícitamente: *"el servidor va en un VPS
> con dominio antes de que lleguen los teléfonos, nunca en una PC [...] el problema existe solo
> porque el servidor viviría en una máquina que se mueve. En un VPS [...] el servidor queda
> accesible desde la calle, que es donde están."* Headwind MDM y Supabase no son la misma pieza de
> software, pero el dilema es idéntico y ya se resolvió una vez con el mismo criterio.

### 1.3 Tres opciones, comparadas

| | **PC en la oficina, sola** | **PC + túnel saliente (Cloudflare Tunnel)** | **VPS económico** |
|---|---|---|---|
| **Alcanzabilidad (a)** | 🔴 Probablemente no funciona sin pagar IP fija al ISP (CGNAT) | 🟢 `cloudflared` abre una conexión saliente — funciona igual detrás de CGNAT, sin tocar el router ni el ISP | 🟢 IP pública real de fábrica |
| **Continuidad (b)** | 🔴 Depende 100% de la luz/internet de la oficina | 🔴 Igual — el túnel resuelve el acceso, no la disponibilidad de la PC | 🟢 Datacenter con energía/red redundante (SLA del proveedor) |
| **Mantenimiento (c)** | 🔴 Todo a cargo del cliente o de soporte remoto | 🟠 Igual, más la pieza extra del túnel (carga baja) | 🟠 Sigue habiendo que mantener Docker/Postgres, pero es una máquina Linux dedicada, más fácil de administrar por SSH |
| **Backups (d)** | 🔴 Sin copia fuera del sitio, un siniestro en la oficina lo pierde todo | 🔴 Mismo problema, el túnel no lo resuelve | 🟠 Mismo trabajo de fondo, pero más natural automatizar una copia a otro proveedor desde un datacenter con buena subida |
| **Costo** | Ya comprado | Ya comprado + Cloudflare Tunnel es gratis | ~USD 20-40/mes, para siempre |
| **Dominio + TLS** | Dominio propio + certbot a mano, y solo sirve si hay IP pública | Dominio propio; Cloudflare termina TLS en su borde automáticamente | Dominio propio + Caddy/Nginx (hay overrides oficiales que emiten y renuevan Let's Encrypt solos) |

Variante adicional, si el cliente insiste en usar la PC de la oficina: **IP pública fija como
add-on del ISP** (algunos proveedores argentinos la venden para líneas comerciales). Resuelve (a)
pero no (b)/(c)/(d) — sigue siendo la PC del cliente con todo lo que eso implica.

### 1.4 Recomendación

No hay una sola respuesta correcta — es una decisión de costo/riesgo que conviene conversar
explícitamente con el cliente, no asumirla:

- **Si el objetivo es que ande bien y no pensar más en esto**, un VPS chico es la opción
  aburrida-y-correcta, y es consistente con lo que este mismo proyecto ya decidió para un problema
  análogo (Headwind). La PC que el cliente ya compró no se desperdicia: sirve perfecto como entorno
  de **staging** (probar una migración o una versión nueva antes de tocar la instancia real) o como
  máquina de respaldo.
- **Si el cliente quiere sí o sí usar la PC como backend real**, el mínimo viable es
  **PC + Cloudflare Tunnel + UPS + backup automático fuera del sitio**, siendo explícitos con el
  cliente en que (b), (c) y (d) siguen siendo su responsabilidad (o de quien la administre a
  distancia).
- **PC sin túnel ni IP fija** solo tiene sentido como entorno de desarrollo/demo en la LAN de la
  oficina, no como backend de producción para dispositivos que salen a la calle.

---

## 2. Estructura actual del backend (qué hay que replicar)

Inventario verificado contra la base viva del proyecto cloud (`lqhtxivednffpiicnbog`, Postgres
17.6.1, Supabase Cloud, región `sa-east-1`) a la fecha de este documento.

### 2.1 Base de datos

**20 tablas en `public`, todas con Row Level Security habilitado.** Por volumen: `posiciones`
(270.997 filas — el GPS crudo), `clientes` (2.014), `productos` (529), `perfiles` (19 usuarios).
El resto: `pedidos`, `pedido_items`, `pedidos_contador`, `rutas`, `empresas`, `zonas`, `app_config`
(+ `_historial`), `recorridos_snap`, `estado_dispositivo`, `categorias` (+ `_rastreo`),
`ingesta_tokens`, `visitas`, `alertas_equipo`, `ubicaciones_compartidas`,
`perfiles_categorias_rastreo`.

Multi-tenancy actual (columna `id_empresa` + políticas RLS `id_empresa in (select
empresas_visibles())`) vive dentro de este mismo proyecto — ver [PLAN_SAAS.md](PLAN_SAAS.md). Es
ortogonal a este documento: el backend self-hosted del cliente nuevo puede tener una sola `empresa`
adentro, o varias, sin que eso cambie nada de lo de acá.

**Extensiones realmente instaladas** (no solo disponibles en la imagen): `pg_cron` 1.6.4, `pg_net`
0.20.3 (en schema `public`, usado para `net.http_post` desde cron hacia las Edge Functions),
`pg_stat_statements`, `pgcrypto`, `uuid-ossp`, `supabase_vault`.

> ⚠️ **PostGIS y pgRouting están disponibles en la imagen pero NO instalados.** Todo el cálculo
> geográfico (distancias haversine, snap de recorridos a calles) se hace a mano en SQL/TypeScript,
> no con funciones espaciales de PostGIS. No hace falta instalar PostGIS en el self-hosted para que
> esto funcione igual.

### 2.2 Edge Functions

6 funciones activas (Deno, código en `supabase/functions/`):

| Función | Qué hace | Notas |
|---|---|---|
| `ingest-posiciones` | Ingesta del uploader GPS **nativo** de Android (el foreground service que sigue subiendo posiciones con la pantalla apagada) | `verify_jwt:false` — se autentica con un **token de dispositivo** propio (tabla `ingesta_tokens`), no con el JWT de sesión |
| `snap-recorridos` | Pega los recorridos del día a las calles, vía OSRM público | |
| `crear-usuario` | Alta de usuarios (`auth.admin.createUser`) | Requiere `service_role` |
| `push-heartbeat` | Watchdog de push FCM | |
| `push-actualizacion` | Avisa a la flota que hay versión nueva | |
| `alertas-equipo` | Avisos al supervisor (sin reportar / quieto) | |

Secretos que usan: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (los tres los
inyecta automáticamente el runtime de Supabase, tanto en cloud como en self-hosted) más
`FCM_SERVICE_ACCOUNT` (secreto manual: el JSON de una cuenta de servicio de Firebase, para mandar
push a Android vía la API HTTP v1 de FCM).

### 2.3 pg_cron

Hay jobs programados que llaman `net.http_post` contra las Edge Functions de arriba: watchdog de
push cada ~30 minutos, `alertas-equipo` cada ~10 minutos, purga de retención de `posiciones`.
**Viven como filas en `cron.job` — no están versionados en ningún archivo del repo hoy.**

### 2.4 Storage

3 buckets: `productos` y `avatares` (públicos, con escritura acotada por empresa vía la función
`puede_escribir_objeto()`), `firmas` (privado). Las rutas llevan el prefijo `${id_empresa}/…`.

### 2.5 Auth

Supabase Auth (GoTrue), con dos métodos: email/password y Google OAuth. El login con Google tiene
**dos caminos distintos** según la plataforma (verificado en `AuthContext.jsx`):

- **Nativo (APK):** usa el selector de cuentas de Android vía el plugin
  `capacitor-google-auth` → obtiene un `idToken` → `supabase.auth.signInWithIdToken({provider:
  'google', token})`. **No hay browser ni deep link involucrados** — el propio código lo dice: *"sin
  navegador ni deep link, que no funcionaban en estos equipos"*. Es el camino que usa casi toda la
  flota.
- **Web/PWA:** `supabase.auth.signInWithOAuth({provider: 'google', options: {redirectTo: ...}})`,
  flujo de redirección normal del navegador. El manejador de `com.launion.app://auth` +
  `exchangeCodeForSession` (PKCE) que existe en `AuthContext.jsx` es el fallback de este camino, no
  del nativo.

Un solo proyecto de Google Cloud, un solo Client ID, hardcodeado en `capacitor.config.ts` y en
`AuthContext.jsx`.

### 2.6 Realtime

Se usa en `services/sync/realtime.js` para la supervisión en vivo: un canal escuchando cambios de
`posiciones`.

### 2.7 Cómo se conecta el frontend hoy

[`web/src/services/supabase.js`](web/src/services/supabase.js) crea **un cliente único a nivel de
módulo**:

```js
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = createClient(url, anonKey, { auth: { ...} })
```

`url`/`anonKey` salen de variables de Vite **fijadas en tiempo de build** — están hardcodeadas en
`web/.env.production` (versionado a propósito: la anon key es pública por diseño, la seguridad la
da RLS). Ese mismo build alimenta los tres canales de despliegue (PWA en GitHub Pages, OTA del APK
vía Capgo, instalador nativo): **hoy solo existe un backend posible por build.**

El cliente tiene un `lock` custom (`noHangLock`) que reemplaza `navigator.locks` porque en el
WebView de Android colgaba `getSession()` — no se toca en ningún escenario de este documento.

Solo **2 archivos** leen esas variables de entorno directamente: `services/supabase.js` (crea el
cliente) y `services/uploaderNativo.js` (arma la URL que le pasa al plugin nativo de GPS). Los
otros ~25 archivos del código consumen el `supabase` ya creado (`.from()`, `.rpc()`, `.auth...`,
`.channel()`, `.storage.from()`). El plugin nativo Android (`UploaderGpsPlugin.java`) **ya recibe
la URL como parámetro** en cada llamada `configurar()` — no está hardcodeado del lado Java.

---

## 3. Guía de puesta en marcha del self-hosted

Checklist ordenada, basada en la documentación oficial vigente a la fecha de este documento.
⚠️ **El self-hosting de Supabase cambia rápido — hace apenas ~2 semanas y media pasó a usar Envoy
como gateway por defecto en lugar de Kong.** Antes de ejecutar esto, reverificar contra la
documentación del momento; no asumir que lo de acá sigue siendo el default.

### 3.1 Antes de instalar

1. Elegir alojamiento (según la sección 1) y conseguir un **dominio o subdominio propio** apuntando
   ahí — GoTrue necesita URLs de redirect estables y TLS necesita un nombre, no alcanza con una IP.
2. **Fijar el gateway explícitamente a Kong**, aunque ya no sea el default. Envoy es demasiado
   nuevo (semanas) y su documentación todavía tiene huecos — por ejemplo, no queda claro cómo
   exponer rutas propias más allá de `/functions/v1/` y `/storage/v1/`, que vienen hardcodeadas.
   Kong tiene años de tooling y guías probadas para este stack exacto. Reevaluar Envoy en unos
   meses, cuando esté más maduro.
3. Elegir el mecanismo de TLS: los overrides oficiales `docker-compose.caddy.yml` (más simple,
   Caddy emite y renueva Let's Encrypt solo) o `docker-compose.nginx.yml`. El gateway no termina
   TLS por sí mismo, hace falta un proxy delante en cualquiera de los dos casos.

### 3.2 Instalación base

4. Clonar el repo oficial de Supabase en el **tag de release más reciente** (no `master`), copiar
   la carpeta `docker/` al proyecto real, `cp .env.example .env`.
5. Generar las claves: `sh utils/generate-keys.sh` (genera `JWT_SECRET`, `ANON_KEY`,
   `SERVICE_ROLE_KEY`). Esto es lo mínimo necesario y es compatible con la versión de
   `@supabase/supabase-js` que ya usa el proyecto.
   > Nota: el proyecto cloud actual ya usa el esquema de claves nuevo (`sb_publishable_...`, con
   > firma asimétrica). Los dos esquemas conviven — no hace falta adoptar el nuevo en el
   > self-hosted para que funcione, y de todos modos las claves de una instancia no son
   > intercambiables con las de otra: el cliente JS las trata como strings opacos.
6. `docker compose -f docker-compose.yml -f docker-compose.kong.yml -f docker-compose.caddy.yml up
   -d` (ajustar según lo elegido en el punto 2-3).
7. Confirmar que levantaron: Studio, GoTrue (Auth), PostgREST, Realtime, Storage, imgproxy,
   postgres-meta, Postgres, Edge Runtime, Supavisor (pooler). Logflare/Vector (analítica/logs) se
   pueden dejar apagados — no hacen falta para esta app y ahorran RAM (aunque sobre).
8. Configurar en `.env`: `SUPABASE_PUBLIC_URL`, `API_EXTERNAL_URL`
   (`https://<dominio>/auth/v1`), `SITE_URL` (a dónde vuelve el usuario tras login/reset de
   password).

### 3.3 Auth — Google OAuth

9. **No hace falta un proyecto de Google Cloud nuevo.** En el mismo proyecto que ya usa la app,
   agregar a "Authorized redirect URIs" del client OAuth existente:
   `https://<dominio-selfhosted>/auth/v1/callback`. El Client ID y el secret no cambian.
10. En el `.env` del self-hosted:
    ```
    GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
    GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=<mismo client id que ya está en capacitor.config.ts / AuthContext.jsx>
    GOTRUE_EXTERNAL_GOOGLE_SECRET=<mismo secret del proyecto de Google existente>
    GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://<dominio-selfhosted>/auth/v1/callback
    ```
11. Agregar a `URI_ALLOW_LIST` de GoTrue los orígenes válidos de retorno (el origin de la PWA de
    este cliente, y `com.launion.app://auth` si se preserva el fallback web).
12. El login con email/password ya viene habilitado por defecto.

> El camino que usa casi toda la flota (login nativo vía `signInWithIdToken`, sección 2.5) **ni
> siquiera depende de un redirect URI** — el `idToken` de Google se canjea directo contra el GoTrue
> que esté activo en ese momento. Los pasos 9-11 solo importan para el flujo web/PWA.

### 3.4 Base de datos

13. Habilitar `pgcrypto`, `uuid-ossp`, `supabase_vault`. Confirmar que `pg_cron` y `pg_net` están
    en `shared_preload_libraries` de Postgres — no alcanza con `CREATE EXTENSION` si la imagen no
    los precarga (gotcha conocido de `pg_cron`, independiente de Supabase).
14. Confirmar la versión de Postgres de la imagen `supabase/postgres` contra la del proyecto cloud
    (17.6.1) al momento de instalar.
15. **Migrar el esquema con un `pg_dump`/`supabase db dump` tomado directo de la base viva —
    nunca reconstruyendo desde los `.sql` de `db/`.** Esos archivos están desactualizados (regla 5
    de `CLAUDE.md`) y hay objetos que existen en la base viva y en ningún `.sql` versionado: la
    tabla `ingesta_tokens` y la función `mi_token_ingesta` (sin las cuales el uploader nativo no
    puede autenticar ni un solo punto), `recorridos_snap`, `ubicaciones_compartidas`, y varios
    campos sueltos más (ver `db/00_LEER_PRIMERO.md` y `CLAUDE.md §8` para la lista completa).
16. Después de restaurar, verificar tres cosas puntuales antes de dar por buena la migración:
    - Los roles `anon`, `authenticated` y `service_role` existen.
    - El índice de `posiciones.client_uid` **no** quedó parcial (`where ...`) — si lo está, el
      upsert idempotente del GPS se rompe en silencio (regla 6 de `CLAUDE.md`).
    - Los `GRANT`/`REVOKE` de las funciones `SECURITY DEFINER` quedaron como en la base viva —
      este proyecto tuvo que aprender a mano que Postgres/Supabase dan EXECUTE explícito a `anon` y
      `authenticated` sobre funciones nuevas, y que hay que revocarlo de los tres roles (`public`,
      `anon`, `authenticated`), nunca solo de dos (reglas 7, 7-bis y 8 de `CLAUDE.md`).
17. Confirmar `wal_level=logical` y que la publicación `supabase_realtime` incluya `posiciones` (y
    cualquier otra tabla que la app escuche por Realtime).

### 3.5 Edge Functions

18. Copiar las 6 carpetas de `supabase/functions/` a `volumes/functions/<nombre>/` en el
    self-hosted.
19. Setear `FUNCTIONS_VERIFY_JWT=false` de forma global en `.env` — en el self-hosted es un único
    toggle para todas las funciones, no hay verificación por-función como en el dashboard de cloud.
    Es seguro para las 6 funciones de este proyecto porque **cada una ya hace su propio chequeo de
    identidad en código** (no dependen del gateway): `ingest-posiciones` valida contra
    `ingesta_tokens`, y `crear-usuario`/`snap-recorridos` re-derivan el usuario leyendo el header
    `Authorization` a mano con su propio cliente.
20. Agregar `FCM_SERVICE_ACCOUNT` a las variables de entorno del contenedor de funciones —
    ver sección 5 sobre por qué tiene que ser el **mismo** proyecto de Firebase que usa cloud.
21. Reiniciar el servicio `functions` para que tome las funciones copiadas.

### 3.6 Storage

22. Recrear los 3 buckets (`productos`, `avatares` públicos; `firmas` privado) y sus políticas.
23. Migrar los **archivos**, no solo los metadatos: un dump de `storage.objects` trae la fila de
    metadata pero no el contenido — hay que bajar los archivos de la Storage API de cloud y
    subirlos a la del self-hosted.

### 3.7 Backups

24. El self-hosting **no incluye backup automático**. Opciones: **WAL-G** para point-in-time
    recovery continuo, o algo más simple como `pg_dump`/`supabase db dump` disparado por un cron
    **del sistema operativo** (no `pg_cron`, que vive adentro de la misma base que se respalda),
    con la copia final en un destino **fuera del sitio** (otro proveedor, no el mismo disco/oficina).
25. Probar el restore al menos una vez antes de dar por bueno el esquema de backup.

---

## 4. Qué configurar puntualmente para este proyecto

Además de la checklist general de arriba:

- **pg_cron**: los jobs (watchdog de push, `alertas-equipo`, purga de `posiciones`) no viajan en un
  dump de esquema — son filas de `cron.job`, hay que recrearlos a mano con `cron.schedule(...)`,
  copiando la definición exacta desde la base viva. Es una buena oportunidad para versionarlos por
  primera vez en un archivo nuevo (`db/48_pg_cron_jobs.sql`), algo que hoy no existe en ningún
  lado.
- **`FCM_SERVICE_ACCOUNT`: usar el mismo proyecto de Firebase, no uno nuevo.** No es una cuestión de
  comodidad — es estructural: a qué app le llega un push lo determina el `google-services.json`
  compilado dentro del APK, y el APK es **el mismo binario** para los dos backends (esa es la
  premisa de este documento). Un proyecto de Firebase nuevo implicaría un `google-services.json`
  nuevo, que implicaría un APK distinto, y eso contradice tener una sola app.
- **Dominio + TLS** propios para el self-hosted, con `SITE_URL`/`API_EXTERNAL_URL`/`URI_ALLOW_LIST`
  de GoTrue apuntando a los orígenes reales de la app de este cliente.
- **No hace falta un build separado del frontend** — la resolución de a qué backend conectarse pasa
  a ser en tiempo de ejecución (sección 5), no de compilación.

---

## 5. Mecanismo: una sola app, backend según el usuario

### 5.1 Qué NO conviene hacer

Envolver el cliente `supabase-js` en un `Proxy` que delegue a una instancia interna reemplazable
**no es una buena idea acá.** `supabase.auth` tiene estado propio (temporizadores de refresh de
token) y `supabase.channel()` abre un WebSocket real. Si el cambio de backend ocurre después de que
algo ya se suscribió — `AuthContext` llama `onAuthStateChange` al montar, `realtime.js` abre un
canal — esas suscripciones quedan atadas a la instancia **vieja**: reemplazar la referencia interna
del proxy no las migra. El resultado sería un split-brain (la sesión activa en un backend, las
queries nuevas yendo a otro, o un socket de Realtime contra el servidor equivocado).

### 5.2 Diseño propuesto

La alternativa que evita ese problema de raíz: **resolver a qué backend conectarse de forma
síncrona, en el momento en que se evalúa el módulo — antes de que exista cualquier componente
React** (no hace falta ningún gate asíncrono nuevo en el arranque).

1. **Archivo nuevo `web/src/services/backend.js`.** Al cargarse, lee de forma síncrona
   `localStorage.getItem('lu-backend-override')` (JSON `{url, anonKey, nombre?}`):
   - Si hay un override guardado, exporta esos valores.
   - Si no, exporta `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — **el
     comportamiento de hoy, sin ningún cambio**, para cualquier dispositivo que nunca configuró
     nada. La flota actual (9 teléfonos) queda intacta por construcción, no por una rama de código
     que "decide no tocarlos".
   - Expone `setBackendOverride(cfg)` (escribe `localStorage`, nada más — no reconstruye ningún
     cliente en caliente) y `limpiarBackendOverride()`. `setBackendOverride` también tiene que
     limpiar el mirror de sesión y las cachés de perfil: son datos de otra base, con otros UUIDs de
     usuario, y no deben sobrevivir a un cambio de backend.
2. **`web/src/services/supabase.js`**: las dos líneas que hoy leen `import.meta.env` pasan a
   importar `{url, anonKey}` desde `./backend`. El resto del archivo —la creación del cliente, el
   `lock` custom— no se toca.
3. **`web/src/services/uploaderNativo.js`**: la línea que arma `BASE`/`INGEST_URL` pasa a leer la
   misma URL resuelta desde `./backend`. El plugin nativo Android no necesita ningún cambio: ya
   acepta `url` como parámetro en `UploaderGps.configurar({..., url, ...})`.
4. **Aplicar un cambio de backend requiere reiniciar la app** (no hay hot-swap a mitad de sesión) —
   el mismo modelo que ya usa la actualización OTA, que se aplica recién en el próximo arranque en
   frío.

**Esto no requiere un APK nuevo.** No se agrega ningún plugin nativo (alcanza con `localStorage`,
ya disponible; `@capacitor/preferences` no es una dependencia hoy y agregarla sí obligaría a un
APK nuevo), no cambia el `AndroidManifest`, no cambia `capacitor.config.ts`. Alcanza con **OTA +
push a `main`** para la PWA — los mismos dos canales que ya existen, sin tocar el tercero.

### 5.3 Cómo se asigna un dispositivo a un backend

El punto natural para elegir backend es `LoginView.jsx`, porque hay que resolverlo **antes** de
poder loguearse. Dos formas de hacerlo, de menor a mayor esfuerzo de construcción:

- **Un link de configuración, consumido una sola vez al arrancar** (`main.jsx`, antes de montar la
  app): un parámetro en la URL que, si está presente, escribe el override en `localStorage` y se
  limpia solo. Un técnico entrega el dispositivo ya configurado abriendo ese link una vez; después
  de eso el dispositivo nunca vuelve a necesitar tocar nada. Es la opción más liviana — sin
  pantalla nueva — y tiene sentido si de verdad va a ser un puñado de dispositivos configurados una
  vez.
- **Un campo en la pantalla de login**, del mismo tipo que ya existe para otro caso de dispositivo
  especial (el botón chico de "tablet · escanear código" de la vidriera): un renglón escondido que
  abre una hoja para cargar servidor + clave a mano. Más descubrible, más trabajo de UI.

Recomendación: empezar por la primera (link de configuración), que además es la base de la segunda
si más adelante hace falta.

Un lugar de solo-lectura (qué backend está activo en este dispositivo) puede sumarse a "Mi cuenta"
más adelante, útil para soporte telefónico.

### 5.4 Camino de escalamiento (si aparece más de un cliente self-hosted)

Si en el futuro hay varios clientes con backend propio (no solo uno), conviene reemplazar la
configuración manual por un **directorio consultable en runtime**, resuelto por código de empresa
o dominio de email antes del login. El patrón ya existe en el repo y no hay que inventarlo:
`app_config` es hoy una tabla de una fila, legible por `anon` sin restricción, consultada antes de
cualquier lógica de sesión. Una tabla nueva `backends_directorio` (`codigo`, `url`, `anon_key`,
`nombre`, `activo`), con la misma política de lectura abierta, replica ese patrón — consultada
siempre contra el proyecto cloud (el único punto estable conocido de antemano), nunca a través del
cliente `supabase` ya resuelto. **No construir esto todavía**: con un solo cliente self-hosted, la
opción manual de la sección 5.3 alcanza y es la base sobre la que se construiría el directorio el
día que haga falta.

Exponer la anon key de un backend self-hosted en una tabla de lectura pública no es un problema de
seguridad nuevo: es el mismo nivel de exposición que ya tiene hoy `VITE_SUPABASE_ANON_KEY` en
`web/.env.production` — versionada a propósito porque la seguridad la da RLS, no el secreto de la
clave.

### 5.5 Propiedades y límites que vale la pena dejar explícitos

- **Aislamiento entre flotas por diseño.** Como el override es por dispositivo y no hay nada
  compartido entre "apunta a cloud" y "apunta a self-hosted" salvo el bundle de la app, una caída
  del backend self-hosted de este cliente no afecta a la flota actual, y viceversa.
- **La resiliencia offline que ya tiene la app tiene un techo distinto acá.** La cola de posiciones
  y el mirror de sesión ya toleran cortes cortos de red. Un corte de **horas** de luz/internet en
  la oficina del cliente (el escenario de riesgo (b) de la sección 1) satura ese colchón de forma
  distinta a como lo haría un blip de la nube — un self-hosted intermitente no es equivalente a
  cloud solo porque la app aguante cortes cortos.

---

## 6. Riesgos y notas abiertas

- **El self-hosting de Supabase cambia rápido.** El cambio de gateway (Kong→Envoy) de la sección 3
  tiene semanas a la fecha de este documento — cualquier guía/tutorial con más de un par de meses
  puede describir un default que ya no es tal. Fijar versión/tag del stack al implementar, no
  asumir el default del momento.
- **IP pública fija de ISP** (mencionada en la sección 1.3) es una variante más a cotizar si el
  cliente insiste en usar la PC de oficina, pero no resuelve continuidad, mantenimiento ni backup.
- **`supabase_vault`** está instalado en el proyecto cloud pero no se detectó uso real en el código
  (los secretos de las Edge Functions van por variables de entorno). Si en el futuro se empezara a
  usar, lo cifrado con la clave raíz de un proyecto **no migra** a otra instancia con un dump — se
  recrearía vacío.

---

## 7. Próximos pasos, si se decide avanzar

1. Definir con el cliente cuál de las tres opciones de la sección 1.3 se usa (o una variante).
2. Levantar el self-hosted siguiendo la sección 3, sobre esa infraestructura.
3. Migrar esquema + funciones + Storage + cron jobs siguiendo las secciones 3 y 4, verificando cada
   punto marcado como crítico (índice no-parcial, grants de funciones `SECURITY DEFINER`).
4. Recién ahí, implementar el mecanismo de la sección 5 (`backend.js` + los dos cambios de una
   línea en `supabase.js` y `uploaderNativo.js` + el link de configuración) — es JS puro, sale por
   OTA + push a `main`, no necesita esperar a que el self-hosted esté probado para escribirse, pero
   sí para probarse de punta a punta con un dispositivo real apuntando al backend nuevo.
