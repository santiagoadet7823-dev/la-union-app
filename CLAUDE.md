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

`propietario` **existe en el código pero NO en el check constraint de la DB** — ver §8.
`encargado` es dual: se lo trackea por GPS **y** supervisa.

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

5. **Los archivos `db/*.sql` NO son la fuente de verdad y son peligrosos.** `02_saas.sql` y
   `05_schema_real.sql` contienen políticas históricas **inseguras** que reabren agujeros entre
   empresas si se re-ejecutan. Para saber cómo está la base: **consultar la base viva** (MCP de
   Supabase), nunca leer los `.sql` y asumir. Ver [db/00_LEER_PRIMERO.md](db/00_LEER_PRIMERO.md).
6. **El índice de `posiciones.client_uid` JAMÁS puede ser parcial (con `WHERE`).** Un índice parcial
   rompe `upsert(onConflict:'client_uid')` con error **42P10** y **se cae todo el GPS en silencio**
   ([db/04_posiciones_idempotencia.sql:17-20](db/04_posiciones_idempotencia.sql#L17)). Costó dos
   rebuilds del APK persiguiendo un bug que estaba en la base.
7. **`revoke execute ... from public`, nunca `from anon, authenticated`.** Postgres concede EXECUTE a
   PUBLIC por defecto; anon y authenticated lo heredan. Revocar de anon/authenticated es un **NO-OP**
   ([db/06_seguridad_fixes.sql:46-59](db/06_seguridad_fixes.sql#L46)).
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
# update public.app_config set bundle_version='1.5.26', bundle_url='<url>', updated_at=now();

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
| Agregar una vista o cambiar quién ve qué | `src/App.jsx:102` (`decidirSupervisionMovil`) + las tablas de menú en `SupervisionMovil.jsx:78-84` **y** `SupervisionDesktop.jsx:67-73` (⚠️ están duplicadas — cambiar **las dos**) |
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

Hay **cuatro** números que conviven. Hoy **están desfasados** (ver informe §8).

| Número | Dónde | Valor actual | Para qué |
|---|---|---|---|
| `APP_VERSION` | [src/version.js:6](src/version.js#L6) | `1.5.25` | Se compara con `app_config.latest_version`; se reporta en `estado_dispositivo.app_version` |
| `versionName` | [android/app/build.gradle:17](android/app/build.gradle#L17) | `1.5.8` | Versión visible del APK |
| `versionCode` | [android/app/build.gradle:16](android/app/build.gradle#L16) | `8` | Entero incremental de Android |
| `app_config.bundle_version` | Supabase | — | Qué bundle OTA deben bajar los teléfonos |

**¿OTA o APK nuevo?**

| Cambio | Alcanza con OTA | Requiere APK nuevo |
|---|---|---|
| JS/CSS/React, lógica, vistas | ✅ | |
| Plugin nativo nuevo o actualizado | | ✅ |
| Cambio de permisos del manifest | | ✅ |
| Cambio en `capacitor.config.ts` | | ✅ |
| Código en `android/app/src/main/java/` | | ✅ |

> Al publicar un APK nuevo, publicar **también** la misma versión como OTA, para los que ya lo tienen
> instalado.

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

- 🔴 **Backup del keystore** (`android/app/launion.keystore` + `keystore.properties`) fuera de la
  máquina. Si se pierde, **el APK no se puede volver a actualizar nunca**.
- 🔴 **`db/02_saas.sql` y `05_schema_real.sql` reabren agujeros si se re-ejecutan.** Mover a
  `db/historico/`.
- 🔴 **Versiones desfasadas** (§6): alinear en el próximo APK.
- 🔴 **Rol `propietario` fuera del check constraint** de `perfiles.rol`. El código lo usa
  (`App.jsx:66,105`), la DB lo rechazaría. No se puede dar de alta un propietario desde `UsuariosView`.
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
