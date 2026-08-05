# Estructura del proyecto — qué es cada archivo

> **Relevamiento del 04/08/2026** sobre `APP_VERSION 1.10.0`. Cubre **toda** la carpeta
> `propuesta LA UNION/`, no solo el repo.
>
> Para qué sirve: saber qué conservar al migrar de máquina, y qué mover a un archivo secundario.
> Pendientes y entorno: [HANDOFF.md](HANDOFF.md) · Arquitectura: [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md).

## Lo primero que hay que entender

**El repo git existe SOLO dentro de `la-union-app/`** (`origin: github.com/santiagoadet7823-dev/la-union-app`,
rama `main`, 441 archivos versionados). La carpeta madre `propuesta LA UNION/` **no está bajo control de
versiones**: los 6 briefs, los 2 mockups, `plan.md`, `.claude/keystore.md` y las tres carpetas del
diseñador viven **solo en ese disco**.

```
propuesta LA UNION/            ← ❌ sin git
├─ .claude/                    ← keystore.md (crítico) + launch.json
├─ BRIEF_*.md            (6)   ← contrato de diseño, todos vigentes
├─ MOCKUP_*.html         (2)
├─ plan.md
├─ la-union-diagramas/         ← html + pdf
├─ noodles-diagramas/          ← html + pdf
├─ scratch_splash/
├─ trabajo del diseñador/      ← handoff v1 (05/07)
├─ trabajo diseñador 27-7/     ← handoff v3 (28/07) ⭐ el vigente
└─ la-union-app/               ← ✅ el repo
```

---

## 1. Raíz `propuesta LA UNION/`

### 1.1 Briefs de diseño (6 archivos, ~100 KB) — **todos vigentes**

| Archivo | Fecha | Contenido | Estado |
|---|---|---|---|
| `BRIEF_DISENO_UXUI.md` | 05/07 | **Brief v1.0, la base.** Design system completo (tokens de color, tipografía, espaciado), layout, jerarquía, estados, microinteracciones, todas las pantallas de los 3 roles originales | 🟢 **Vigente — es el contrato** |
| `BRIEF_DISENO_UXUI_v1.1_SUPERVISION_MOVIL.md` | 10/07 | Adenda: Supervisión Móvil + variante Propietario | 🟢 Implementado |
| `BRIEF_DISENO_v1.2_CATALOGO_Y_REPARTOS.md` | 27/07 | Adenda: Catálogo del Vendedor + Hoja de Repartos | 🟡 Catálogo implementado; **Hoja de Repartos sigue pendiente** |
| `BRIEF_DISENO_v1.3_PROPIETARIO_DUENO.md` | 27/07 | Adenda: rol Propietario/Dueño móvil | 🟢 Implementado en `features/propietario/` |
| `BRIEF_DISENO_v1.4_LOGIN.md` | 28/07 | Adenda: pantalla de Ingreso + animación de arranque | 🟡 Implementado **salvo** el formulario de "Solicitar acceso" (ver HANDOFF §5) |
| `BRIEF_VISUAL_WEB_PUBLICIDAD.md` | 17/07 | Brief para el diseñador de la **landing comercial** | 🔵 **Vigente y NO ejecutado** — no existe landing. Trabajo futuro |

> **El v1.0 no fue superado.** Las v1.1–v1.4 dicen textualmente que "no reemplazan al v1.0: lo
> extienden". Son adendas acumulativas y hay que conservar los seis.

### 1.2 Mockups HTML (2, 65 KB)

| Archivo | Qué es | Estado |
|---|---|---|
| `MOCKUP_LOGIN_v1.4.html` (32 KB) | Mockup navegable del ingreso + animación, con los tokens reales | 🟡 Superado por el código (`LoginView.jsx`). Referencia visual |
| `MOCKUP_UXUI_VENDEDOR_REPARTIDOR.html` (33 KB) | Mockup Vendedor + Repartidor con los tokens de `src/index.css` | 🟡 Vendedor implementado; **Repartidor no** |

### 1.3 Resto de la raíz

| Ítem | Qué es | Estado |
|---|---|---|
| `.claude/keystore.md` (2,4 KB) | ⚠️ Volcado de la sesión de `keytool` que creó la llave de firma: opciones del comando y los campos del *distinguished name*. **NO contiene las contraseñas** (ver HANDOFF §2.1) | 🟢 Conservar — es el único registro de cómo se generó la llave |
| `.claude/launch.json` | Config de preview de Claude Code (`npm --prefix la-union-app run dev`, :5173) | Trivial de rehacer |
| `plan.md` (11 KB) | Plan de implementación del rol `propietario` | 🟡 **Ejecutado** — documento histórico |
| `la-union-diagramas/` (332 KB) | `funciones-app.html` + `.pdf` — diagrama de funciones | 🟡 Superado por `DOCUMENTACION_FUNCIONAL.md` |
| `noodles-diagramas/` (376 KB) | `noodles-arquitectura.html` + `.pdf` | 🟡 Superado por `INFORME_AUDITORIA.md` |
| `scratch_splash/marca.png` (38 KB) | Descarte del splash | 🔵 Descartable |
| `trabajo del diseñador/` (1,7 MB) | Handoff **v1 (05/07)**: 5 `.dc.html` + `uploads/` | 🟡 Superado por el v3 |
| `trabajo diseñador 27-7/` (3,1 MB) | Handoff **v3 (28/07)**, el más completo: **17 `.dc.html`** (Ingreso v1.4, Propietario v1.3, Catálogo Vendedor v1.2, Hoja de Entregas v1.2, Mapa del Repartidor v1.2, Web DisT-At, AdminMobile, Supervisión Móvil y Escritorio…) + `assets/`, `screenshots/`, `uploads/` | 🟢 **El vigente.** Es el único de los tres que hace falta conservar activo |

> Hay **tres** handoffs del diseñador (v1 en la raíz, v2 dentro de `la-union-app/`, v3 en la raíz). El
> v3 contiene todo lo del v2 y del v1, más nuevo y más completo.

---

## 2. `la-union-app/` — archivos sueltos

### 2.1 Documentación (16 `.md`) — toda versionada

| Archivo | Qué es | Estado |
|---|---|---|
| `CLAUDE.md` (47 KB) | 🟢 **El documento más importante del repo.** Reglas operativas: dos canales, multi-tenancy, roles, **45 reglas que nunca se violan** (cada una costó un bug), comandos de build/release/emulador, mapa del código, zonas peligrosas, versionado, convenciones, skills y MCPs | 🟢 **Vivo** |
| `HANDOFF.md` | Pendientes, deudas, login, términos y el entorno completo para otra máquina | 🟢 Nuevo (04/08) |
| `INFORME_AUDITORIA.md` (rev. 3) | Arquitectura, deuda técnica, riesgos, checklist | 🟢 Nuevo (04/08, sobre 1.10.0) |
| `ESTRUCTURA_PROYECTO.md` | Este documento | 🟢 Nuevo (04/08) |
| `PLAN_SAAS.md` (29 KB) | Migración planificada a `corporaciones → empresas → datos`. Marcado "**DISEÑO. No se ejecutó nada**" (la Fase 7, `TenantContext`, sí se ejecutó) | 🟢 Vivo como propuesta |
| `DOCUMENTACION_FUNCIONAL.md` (21 KB) | Qué hace cada función y de qué rol es. Escrito sobre 1.5.25 | 🟡 Vivo pero desfasado |
| `GUIA_PUSH_NATIVO_Y_VERSIONES.md` (17 KB) | Wake nativo por FCM + versiones OTA/APK + color de trazo | 🟢 Vivo |
| `GUIA_GPS_EN_VIVO_Y_JORNADA.md` (10 KB) | GPS casi en vivo + jornada + antigüedad de instalación | 🟢 Vivo |
| `GUIA_ACTUALIZACION_APK.md` (7,9 KB) | Publicar update del APK con auto-update de un toque | 🟢 Vivo |
| `GUIA_ACTUALIZACION_OTA.md` (2,1 KB) | Explicación de la OTA para el usuario final | 🟢 Vivo |
| `GUIA_REACTBITS.md` (8,3 KB) | Investigación sobre reactbits.dev — "nada de esto está instalado" | 🔵 Nota de investigación |
| `GUIA_PUBLICACION_1.6.4.md` (4,1 KB) | Checklist de publicación de esa tanda | 🔵 Histórico |
| `BRIEF_DISENO_MOBILE.md` (9,2 KB) | Brief para pulir visuales mobile | 🟡 Superado por las adendas v1.2–v1.4 |
| `GUIA_APK_ANDROID.md` (14 KB) | Generar el APK de cero | 🔴 **Obsoleta**: describe OAuth por browser (ya es nativo) y **se contradice sobre `storeFile`** (`:230` mal, `:320` bien) |
| `GUIA_API_KEY_GOOGLE_MAPS.md` (6,6 KB) | Cómo sacar API key de Google Maps | 🔴 **Obsoleta**: la app usa Leaflet/OSM, nada lee esa variable |
| `README.md` (4,2 KB) | Presentación del proyecto | 🔴 **Obsoleto**: menciona un componente `GoogleMap` que no existe y omite `CAP_BUILD=1` |

### 2.2 Configuración y build

| Archivo | Qué hace |
|---|---|
| `package.json` | `distat-app`. Scripts (`dev`, `build`, `lint`, `cap:*`, `postinstall: patch-package`), 17 deps y 13 devDeps. ⚠️ **No hay `build:apk`** — el `CAP_BUILD=1` va a mano |
| `vite.config.js` | `base` conmutable (`/la-union-app/` para Pages vs `./` con `CAP_BUILD=1`), **`build.target: 'es2015'`** a propósito (tablets con WebView Chrome 79), `define global`, VitePWA (`registerType: 'prompt'`) + plugin-legacy |
| `capacitor.config.ts` | `appId com.launion.app`, `webDir dist`. CapacitorUpdater (`autoUpdate: false`), GoogleAuth, BackgroundGeolocation, SQLite, SplashScreen. **Sin bloque `server`** |
| `index.html` | Entry: fuentes, **bootstrap anti-FOUC del tema**, `theme-color #0C0C0C`, gate de "actualizá el WebView" |
| `.browserslistrc` | **Piso de compatibilidad único**: Chrome ≥79, medido por `adb logcat` en una tablet real. Documenta por qué |
| `.gitignore` | Muy comentado. Ignora `.claude/*` pero **exceptúa `skills/`** a propósito |
| `.env.example` / `.env.production` / `.env.local` | Plantilla / versionado (anon key, pública) / 🔴 **fuera de git**. Los tres tienen sets distintos de variables |
| `package-lock.json` | Lockfile (versionado) |
| `.github/workflows/deploy.yml` | **El único CI**: push a `main` → Node 20 → `npm ci` → `npm run build` → GitHub Pages |

### 2.3 Artefactos sueltos

| Archivo | Qué es | ¿Migrar? |
|---|---|---|
| `bundle.zip` (1,2 MB) | Zip del `dist/` para el release OTA, lo produce `ota-release.sh` | ❌ Regenerable |
| `icon-fuente.png.png` (142 KB) | PNG fuente del ícono, del que salen los mipmaps. Gitignoreado. Hay copia idéntica en `trabajo diseñador 27-7/assets/` | ⚠️ **Conservar una copia** |

---

## 3. `la-union-app/src/` — 142 archivos

### 3.1 Raíz (4)

| Archivo | L | Qué hace |
|---|---|---|
| `App.jsx` | 266 | **Crítico.** Enrutado por **rol + plataforma**. `decidirSupervisionMovil()` es el **único lugar que sabe esta regla**; `AuthedApp` despacha propietario → supervisión móvil → supervisión desktop → `AppShell`+`RoleRouter`. Monta el árbol de 6 providers. ⚠️ `AdminView` quedó **inalcanzable** |
| `main.jsx` | 24 | Entry: `createRoot`, `index.css`, `iniciarAtras()`, y **`notifyAppReady()` de Capgo** (si no se llama, revierte el bundle OTA) |
| `index.css` | 337 | **Design system completo.** Tokens duales (claro/oscuro), estética "sala de control", keyframes `lu-*`, fallback de `backdrop-filter`. Fuente de verdad de `--r-*`, `--fs-*`, `--sp-*`, `--z-*` |
| `version.js` | 6 | `APP_VERSION = '1.10.0'` |

### 3.2 `components/` (20)

| Archivo | L | Qué hace |
|---|---|---|
| `LeafletMap.jsx` | **947** | **El archivo más grande del front.** Todo el mapa: capas base intercambiables, ruteo multi-parada y TSP, marcadores con animación de pin, trazos, dwells, clientes, zonas, modo inmersivo. Lo consumen las dos supervisiones, el propietario, el vendedor y el admin. Lleva `isolation: isolate` **y no se saca** |
| `Overlay.jsx` | 409 | **Primitiva única de modal/sheet.** Animación de entrada **y salida**, Escape, scroll-lock con contador, ARIA, foco, header/footer fijos. **Nunca escribir un overlay a mano** |
| `SplashIntro.jsx` | 193 | Animación de arranque (el isotipo se dibuja solo). Una vez por día, cortable al toque, respeta `prefers-reduced-motion` |
| `AlertasEquipo.jsx` | 176 | Campanita + lista de incidentes abiertos del equipo |
| `GpsGate.jsx` | 164 | Exige GPS activo antes de operar; publica alertas GPS on/off por realtime |
| `AppShell.jsx` | 147 | Shell general (topbar, menú de cuenta, `MiCuenta`); ramifica web/nativo |
| `CompartirUbicacion.jsx` | 146 | Compartir mi ubicación en vivo con otra empresa, y revocarla |
| `UpdatePrompt.jsx` | 131 | Aviso de actualización. **Web y nativo se bifurcan acá**: `registerSW` vs OTA + `apkUpdate` |
| `InvitarModal.jsx` | 99 | QR nativo con el link de descarga del APK |
| `icons.jsx` | 97 | Set mínimo de íconos lineales |
| `ErrorBoundary.jsx` | 60 | Sin esto una excepción deja el WebView en blanco |
| `DeviceBanner.jsx` | 58 | "¿Celular o PC?", una sola vez |
| `GestionHost.jsx` | 55 | Contenedor full-screen para las vistas de gestión abiertas desde "Menú" |
| `SelectorEmpresa.jsx` | 54 | Selector de empresa a mirar — solo superadmin y solo si hay >1 |
| `HaceSegundos.jsx` | 54 | Contador "hace Xs" autocontenido (evita un `setInterval` en la raíz) |
| `BtnInmersivo.jsx` | 53 | Alterna mapa a pantalla completa |
| `PhoneFrame.jsx` | 50 | Marco de teléfono para previsualizar vistas móviles en escritorio |
| `Isotipo.jsx` | 40 | Isotipo en **vector** (hace falta para animarlo trazo a trazo) |
| `form.jsx` | 35 | `Field` + `inputStyle` compartidos |
| `Logo.jsx` | 16 | Sirve `public/logo.png` respetando `BASE_URL` (doble base path) |

### 3.3 `context/` (6)

| Archivo | L | Qué hace |
|---|---|---|
| `CatalogContext.jsx` | 532 | Catálogo offline-first (`mapCliente`/`mapProducto`), mutaciones por write queue, **y arranca las dos colas** |
| `AuthContext.jsx` | 377 | Sesión + login Google nativo/web + email/contraseña + caché offline de sesión y perfil. `signOut` cierra primero el uploader nativo |
| `TenantContext.jsx` | 130 | **Empresa que se MIRA** (≠ la de identidad). Centinela `TODAS = '*'`. Su encabezado es el comentario de seguridad más largo del repo |
| `GpsContext.jsx` | 82 | Orquesta GPS: `usePublishPosition` + `useEstadoDispositivo` + push + alarma + chequeo de update |
| `ThemeContext.jsx` | 45 | Claro/oscuro en `launion-theme` |
| `DeviceContext.jsx` | 19 | Modo de dispositivo compartido |

### 3.4 `data/` (1)

`demoGeo.js` (17 L) — coordenada real del depósito en Las Lajitas (Anta, Salta). La usa `MapaOperativo`.

### 3.5 `features/admin/` (18)

| Archivo | L | Qué hace |
|---|---|---|
| `UsuariosView.jsx` | 509 | RBAC: usuarios + pendientes de Google, asignar rol/activar, crear usuario, color de trazo |
| `EmpresasView.jsx` | 439 | Solo superadmin: alta de distribuidoras y palanca activar/desactivar |
| `tabs/ClientesTab.jsx` | 315 | Cartera: tabla en PC / tarjetas en teléfono, ficha en acordeón |
| `ImportarClientes.jsx` | 268 | Import masivo desde `.xlsx`; el cliente hereda el vendedor de su zona |
| `ImportarProductos.jsx` | 245 | Import masivo de productos (upsert por código) |
| `ImportarFotos.jsx` | 243 | Carga masiva de fotos, pareo por **nombre de archivo = código** |
| `tabs/FichaCliente.jsx` | 239 | Ficha editable, desplegada en línea |
| `tabs/CatalogoTab.jsx` | 234 | ABM de productos |
| `components/ReplayJornada.jsx` | 226 | Reproduce la jornada como película: play/pausa, scrub, 1×–8×, export PNG. ⚠️ **Muerto pero vale rescatarlo** |
| `RevisarDuplicados.jsx` | 154 | Detecta clientes repetidos (usa `lib/texto.js`) |
| `AdminView.jsx` | 149 | Shell del panel Admin. 🔴 **Hoy inalcanzable** |
| `CategoriasRastreo.jsx` | 147 | Horarios/días de rastreo reutilizables por usuario |
| `tabs/MapaOperativo.jsx` | 145 | Cartera + móviles + ficha + consola de eventos. ⚠️ **Muerto — borrar** |
| `RecorridosView.jsx` | 140 | Recorridos del día de todos. ⚠️ **Muerto — borrar** (es subconjunto de `SupervisionDesktop`) |
| `ZonasView.jsx` | 135 | Zonas con color, asignación cliente → zona → vendedor |
| `tabs/RuteoTab.jsx` | 111 | Parámetros del plan + selección de órdenes (andamiaje TSP) |
| `tabs/FaltanteTab.jsx` | 109 | Stock generado vs entregado — **maqueta, sin datos reales** |
| `ui.jsx` | 91 | Tokens y componentes chicos de las pestañas |

### 3.6 `features/` — resto por rol (35)

**`auth/` (2)** — `LoginView.jsx` (357 L): ingreso v1.4, jerarquía invertida a propósito (13 de 14
usuarios entran con Google) · `PendienteView.jsx` (152 L): "cuenta en espera", distingue sin-rol de
desactivada, teléfono de soporte en dos pasos.

**`catalog/` (4)** — `NuevoProducto.jsx` (211 L): alta/edición con foto a Storage, unidades por bulto,
rentabilidad · `NuevoCliente.jsx` (195 L): alta con pin en el mapa o "usar mi ubicación" ·
`EditarClienteVendedor.jsx` (142 L): edición **acotada** por el vendedor (solo ubicación y días) ·
`GestionarCategorias.jsx` (99 L): quitar una categoría manda sus productos a "Otros".

**`movil/` (1)** — `PermisoSiemprePrompt.jsx` (112 L): aviso de un paso para "Permitir siempre"
(Android 11+ no lo deja pedir por diálogo).

**`perfil/` (2)** — `MiCuenta.jsx` (102 L): sección reutilizable de cuenta ·
`MiPerfilModal.jsx` (122 L): edición del propio nombre y teléfono por RPC.

**`propietario/` (7)**

| Archivo | L | Qué hace |
|---|---|---|
| `PropietarioMovil.jsx` | 672 | **Dashboard del dueño.** Scroll único que **empieza por los números, no por el mapa** |
| `components/SheetPersona.jsx` | 239 | Detalle de una persona, con variante explícita de "sin datos" |
| `titulares.js` | 147 | Genera la frase grande ("El equipo salió completo") en vez de un número crudo |
| `components/FilaEquipo.jsx` | 71 | Fila como **barra de proporción, no ranking numerado** (decisión ética) |
| `components/SinDatoBloque.jsx` | 71 | "N sin datos hoy" separado de la lista — quien no reporta no aparece con 0 km |
| `components/KpiCard.jsx` | 62 | Número grande + delta contra semanas previas + base del cálculo |
| `components/MiniKpi.jsx` | 22 | Número de tercer nivel |

**`repartidor/` (1)** — `RepartidorView.jsx` (320 L): hoja de entregas (pendiente/en camino/entregado,
motivos, cantidades). **Sin datos reales**: espera el módulo de pedidos.

**`supervision/` (10)**

| Archivo | L | Qué hace |
|---|---|---|
| `SupervisionMovil.jsx` | **891** | **Crítico.** Supervisión full-screen del APK: mapa de fondo + chrome de vidrio (header, chips, bottom-nav, sheet) |
| `SupervisionDesktop.jsx` | **790** | **Crítico.** Equivalente de escritorio: sidebar fija, colapsa a drawer. ⚠️ **No comparte una sola línea con la móvil** |
| `animarPin.js` | 237 | Interpola el movimiento del pin A→B. Compara contra el **último destino mandado**, nunca contra `getLatLng()` |
| `trazos.js` | 106 | Recorridos → geometría Leaflet. **Compartido** por las dos supervisiones. Incluye la limpieza obligatoria |
| `MetricasEquipo.jsx` | 103 | Km del día + tiempo de parada (promedio, menor, mayor, cantidad) |
| `dwells.js` | 88 | Paradas → carteles del mapa. **Compartido** |
| `components/BurbujasEquipo.jsx` | 184 | Burbujas del equipo para el modo pantalla completa |
| `components/RailMapa.jsx` | 177 | Rail vertical de controles del mapa |
| `components/TarjetaPin.jsx` | 111 | Tarjeta flotante del pin tocado |
| `components/EstadoEquipo.jsx` | 77 | "Por qué no llega la señal" (OK / GPS apagado / sin señal desde X) |

**`vendedor/` (8)**

| Archivo | L | Qué hace |
|---|---|---|
| `VisitaCatalogo.jsx` | 190 | Catálogo de la visita: buscador, chips, grilla 2×N con foto/precio/marco de rentabilidad, barra de carrito |
| `useJornada.js` | 160 | **Crítico.** Máquina de estado del día: tabs, visita en curso (check-in/timer), carrito, estado por cliente, toast. Dueña única de la lógica para que las tabs sean presentacionales |
| `InicioTab.jsx` | 149 | Activación de GPS, resumen del día, lista de clientes con check-in |
| `VendedorView.jsx` | 99 | Shell con 4 pestañas + bottom nav |
| `RutaTab.jsx` | 93 | Mapa 70vh + ruta óptima + paradas scrolleables |
| `SinPedidoSheet.jsx` | 85 | Cierre de visita sin pedido con motivo (centrado, no sheet: la bottom-nav lo taparía) |
| `PerfilTab.jsx` | 72 | Venta del día, meta, visitas/efectividad, cierre de jornada |
| `ui.jsx` | 13 | Tarjeta + stat compartidos |

### 3.7 `hooks/` (11)

| Archivo | L | Qué hace |
|---|---|---|
| `useRecorridosDelDia.js` | 244 | Posiciones del día por usuario, refresco **incremental** cada 60 s (ahorro de egress) |
| `useEstadoDispositivo.js` | 229 | Latido de salud del móvil → `estado_dispositivo` |
| `useDiagnosticoEquipo.js` | 162 | Estado real de cada teléfono y **por qué** no reporta |
| `useMetricasActividad.js` | 155 | Actividad agregada para el dashboard del dueño; usa la RPC, **no** baja puntos |
| `useEquipoEnVivo.js` | 152 | Nombres + última posición por móvil, sembrado a 15 min y actualizado por Realtime |
| `usePublishPosition.js` | 130 | Publica cada fix **por movimiento**, no por tiempo |
| `useLivePosition.js` | 103 | Watch de posición; en móvil el permiso se pide desde un tap |
| `useAlertasEquipo.js` | 80 | Lee/marca vistos los incidentes. Existe porque **la PWA de escritorio no recibe FCM** |
| `useDeviceMode.js` | 61 | `'mobile' \| 'desktop'` con override manual persistido |
| `usePerfilesEquipo.js` | 48 | Perfiles móviles con cache a nivel de módulo |
| `useEmpresaBase.js` | 34 | Coordenada base de la empresa, con fallback a `CENTRO_DEFECTO` |

### 3.8 `lib/` (12)

| Archivo | L | Qué hace |
|---|---|---|
| `geo.js` | 240 | 🩸 **`limpiarTrazo`** (saca los teleports que el uploader nativo no filtra) y **`simplificarTrazo`** (RDP ε=7 m). **Todo lo que dibuje o mida un recorrido pasa por acá** |
| `texto.js` | 223 | Comparación de texto para detectar clientes repetidos (medido sobre 1.998 reales) |
| `comparar.js` | 182 | Contexto para los números del dueño: referencia, delta y honestidad cuando la base es pobre |
| `colors.js` | 58 | Color estable por id (hash → paleta de 16), sobreescribible por el superadmin |
| `format.js` | 55 | Formateo — incluye **`hoyStr()`**. ⚠️ Nunca `toISOString().slice(0,10)`: da UTC y de 21 a 24 h mostraba el mapa vacío |
| `gestion.js` | 36 | **Fuente única** del menú de Gestión + quién puede abrir qué (unificado el 28/07) |
| `glass.js` | 36 | Tratamiento "liquid glass" de los controles flotantes |
| `botones.js` | 27 | Par "Cancelar / Guardar" compartido |
| `categoria.js` | 25 | Infiere categoría desde la descripción (el CSV no la trae) |
| `version.js` | 20 | Compara "x.y.z" por tramos numéricos, no lexicográfico |
| `sx.js` | 18 | String CSS → objeto de estilo React (permite portar mockups 1:1) |
| `uid.js` | 8 | UUID v4 con fallback si el WebView no expone `crypto.randomUUID` |

### 3.9 `services/` (35)

**Raíz (16)**

| Archivo | L | Qué hace |
|---|---|---|
| `uploaderNativo.js` | 181 | **Crítico.** Bridge al uploader GPS **nativo**. Mientras el servicio corre, **es la única fuente de subida** y el pipeline JS se apaga. Existe porque el WebView se congela en Doze |
| `push.js` | 138 | FCM **como watchdog**: mensaje silencioso cada ~30 min. Desde 1.10.0 también dibuja el cartel con la app abierta |
| `tracking.js` | 135 | Ventana horaria de rastreo, dos niveles (global y por categoría). `dentroDeHorario()` soporta días y cruce de medianoche |
| `gpsConfig.js` | 132 | **La única fuente de los umbrales de GPS.** Viajan al nativo por SharedPreferences → afinables por OTA |
| `updateNotify.js` | 62 | Notificación nativa "tocá para actualizar" en cada despertar |
| `battery.js` | 58 | Exención de optimización de batería (Doze) |
| `alarm.js` | 56 | Watchdog **offline** por AlarmManager (sin internet) |
| `apkUpdate.js` | 55 | Reinstalación del APK nativo |
| `atras.js` | 51 | **Pila** del botón atrás de Android. Con la pila vacía va `minimizeApp()`, **jamás `exitApp()`** (mataría el foreground service) |
| `recorridos.js` | 51 | Pide a `snap-recorridos` la geometría pegada a calles |
| `ota.js` | 46 | OTA capgo: chequea, descarga, aplica, recarga |
| `supabase.js` | 44 | **Cliente único.** ⚠️ Tiene un `lock` custom que reemplaza `navigator.locks` porque el WebView colgaba `getSession()` para siempre. **No revertir** |
| `download.js` | 44 | Descarga de blobs: `<a download>` en web, filesystem + hoja de compartir en nativo |
| `nativeUI.js` | 35 | Barra de estado integrada + esconder el splash |
| `infoApp.js` | 24 | Fecha real de instalación del APK |
| `platform.js` | 8 | `isNative` sin importar Capacitor de forma dura |

**`geolocation/` (6) — 🔴 zona peligrosa**

| Archivo | L | Qué hace |
|---|---|---|
| `estados.js` | 194 | Máquina de estados del GPS. **El GPS nunca se apaga en reposo** (`:15-29` explica por qué) |
| `tracker.js` | 189 | **Módulo NO-React a propósito**: el callback nativo dispara con React congelado en Doze. Filtra y encola. ⚠️ **Con el uploader nativo activo NO encola**: es el camino de la PWA |
| `index.js` | 179 | Puerto: `watchPosition` en web / `background-geolocation` en nativo |
| `dwell.js` | 137 | Detección de paradas (cálculo puro) |
| `movimiento.js` | 69 | Puente de Activity Recognition |
| `geofence.js` | 43 | Entrada/salida de radio alrededor de un cliente |

**`sync/` (4) — 🔴 zona peligrosa**

| Archivo | L | Qué hace |
|---|---|---|
| `queue.js` | 247 | **Crítico.** Cola local de posiciones + **cuarentena** (`lu-pos-cuarentena`) + `CODIGOS_PERMANENTES` + `separarPorDueño()`. **Nunca borra un punto** |
| `realtime.js` | 104 | Suscripciones de Supabase Realtime + broadcast de alertas |
| `writeQueue.js` | 96 | Cola de **escrituras** offline (clientes/productos/zonas/visitas); toda op idempotente |
| `index.js` | 33 | Pub/sub **local** (BroadcastChannel) entre pestañas — nada que ver con Supabase |

**`data/` (4)** — `productoImagen.js` (115 L, subida a Storage con URL inmune al doble base path) ·
`catalogo.js` (85 L, queries + cache offline-first con `.eq('id_empresa')` explícito **además** de RLS) ·
`perfiles.js` (63 L, perfil con timeout/reintentos/cache) · `appConfig.js` (11 L, la fila única).

**`maps/` (2)** — `basemap.js` (105 L, capas Stadia/OSM persistidas; ⚠️ **key hardcodeada**) ·
`index.js` (8 L, `CENTRO_DEFECTO`; el port de Google Maps está muerto).

**`persistence/` (1)** — `index.js` (98 L): localStorage (web) / SQLite (nativo), **con timeout de 5 s y
fallback** — un `await` colgado congelaba la cola de GPS para siempre.

**`report/` (1)** — `rutaPng.js` (162 L): compone un PNG del recorrido en `<canvas>`.

**`routing/` (1)** — `index.js` (131 L): puerto de ruteo (OSRM público). **Único punto de swap.**

---

## 4. El resto de `la-union-app/`

### 4.1 `db/` — 29 `.sql` + `schema.sql` + histórico · versionado

> ⚠️ **`db/` NO es la fuente de verdad.** Es el **registro** de migraciones ya aplicadas. Para saber
> cómo está la base: **consultarla viva por el MCP de Supabase**. Leer `00_LEER_PRIMERO.md` primero.

El detalle de qué hace cada migración está en [INFORME_AUDITORIA.md §6](INFORME_AUDITORIA.md). Resumen:

- `00_LEER_PRIMERO.md` · `schema.sql` (esquema original) · `03` retención · `04` idempotencia de
  posiciones (**el índice que jamás puede ser parcial**) · `06` endurecimiento de RLS (**va siempre
  último**).
- `07`–`15`: diagnóstico, catálogo visual, categorías, 🩸`10` (la policy de SELECT sin la cual **ninguna
  subida a Storage funcionó jamás**), versión del APK, color de trazo, días de rastreo, fecha de
  instalación, poda a 60 días.
- `16`–`22`: visitas, reclamar/ubicar cliente, categorías de rastreo, estado del plan, **rol
  propietario**, métricas de actividad, archivado de clientes.
- `23`–`29`: permisos por perfil, teléfono de soporte, 🔴`25` (**alcance de Storage por empresa**),
  alertas de equipo, horarios múltiples + telemetría, `ultimas_posiciones` solo GPS, telemetría 1.9.0.
- `historico/` — `LEER_ANTES_DE_TOCAR.md` + `02_saas.sql` + `05_schema_real.sql`. 🚨 **No ejecutar nada
  de esta carpeta**: tienen políticas históricas inseguras que reabren agujeros entre empresas.

### 4.2 `supabase/functions/` — 6 funciones · versionado

| Función | L | Qué hace |
|---|---|---|
| `alertas-equipo/index.ts` | 461 | Avisa cuando alguien deja de reportar o queda quieto, + resumen horario. Cron cada 10 min. **La detección está en SQL**, no acá |
| `alertas-equipo/fcm.ts` | 113 | Auth y envío de FCM. ⚠️ Tercera copia de `getAccessToken` |
| `snap-recorridos/segmentar.ts` | 346 | **Geometría pura**: corta la jornada en tramos ruteables, decide el modo, mide la fracción a ciegas. Separada para poder **probarse sin Deno ni Supabase** |
| `snap-recorridos/index.ts` | 321 | Recorridos pegados a calles, un motor OSRM por modo |
| `push-actualizacion/index.ts` | 223 | Aviso de versión nueva con la app cerrada (cron horario, sellado por teléfono) |
| `push-heartbeat/index.ts` | 148 | Watchdog por push (~30 min); borra tokens FCM muertos |
| `crear-usuario/index.ts` | 116 | Alta de usuarios con `service_role`; valida escalada server-side |
| `ingest-posiciones/index.ts` | 87 | Endpoint del uploader nativo. Autentica con **token de dispositivo**, no con JWT |

### 4.3 `scripts/` (2) · versionado

`ota-release.sh` (44 L) — publica el bundle OTA y imprime el SQL de `app_config`.
`apk-release.sh` (56 L) — publica el `.apk` en un Release y da la URL + el SQL del auto-update.
Ambos requieren **Git Bash** y `gh` logueado.

### 4.4 `android/` — ~1 MB artesanal dentro de 156 MB

**🟢 ARTESANAL — no se regenera con `cap add android`** (versionado, salvo lo marcado):

| Archivo | L | Qué es |
|---|---|---|
| `.../UploaderGpsService.java` | **1.200** | 🔴 **El archivo nativo más importante.** Foreground service propio: captura con FusedLocation y postea directo a `ingest-posiciones`, sin WebView. Es lo que hace que el GPS siga subiendo con la pantalla bloqueada |
| `.../MovimientoPlugin.java` | 265 | Activity Recognition. **`FLAG_MUTABLE` obligatorio** en API 31+ |
| `.../AlarmWatchdogPlugin.java` | 220 | Watchdog offline por AlarmManager |
| `.../UploaderGpsPlugin.java` | 204 | Bridge JS → servicio (recibe el token de dispositivo y los 5 umbrales) |
| `.../ApkUpdaterPlugin.java` | 131 | Descarga el `.apk` y lanza el instalador |
| `.../BatteryOptimizationPlugin.java` | 120 | Exención de Doze |
| `.../LaUnionApp.java` | 84 | 🩸 Crea los **canales de notificación** al arrancar (fix de 1.10.0) |
| `.../AlarmReceiver.java` | 76 | Receptor de la alarma (manifest, con WakeLock corto) |
| `.../QrPlugin.java` | 71 | QR nativo con ZXing |
| `.../BootReceiver.java` | 64 | Re-arma el watchdog tras reboot / update |
| `.../MovimientoReceiver.java` | 55 | Transiciones de actividad — **manifest, no dinámico** |
| `.../LaUnionMessagingService.java` | 49 | Servicio FCM propio que **extiende** al del plugin |
| `.../InfoAppPlugin.java` | 41 | `PackageManager.firstInstallTime` |
| `.../MainActivity.java` | 37 | Registra los 7 plugins **antes** de `super.onCreate()` |
| `app/src/main/AndroidManifest.xml` | — | Permisos, receivers y servicios declarados a mano |
| `app/build.gradle` | — | Versiones, firma, 4 pins de dependencias deliberados |
| `build.gradle`, `settings.gradle`, `variables.gradle`, `gradle.properties`, wrapper | — | Config Gradle |
| `app/src/main/res/` (38) | — | Mipmaps, splashes, `strings.xml`, `styles.xml`, `file_paths.xml` |
| `app/google-services.json` | — | ⚠️ Config de Firebase/FCM. **Versionada en git**, necesaria para compilar |
| `app/proguard-rules.pro` | — | Reglas ProGuard |

**🔴 ARTESANAL Y FUERA DE GIT:** `app/launion.keystore` (la llave de firma, **irreemplazable**) ·
`keystore.properties` (las contraseñas — ⚠️ `storeFile` debe ser `launion.keystore`, relativo al módulo)
· `local.properties` (ruta del SDK, específica de la máquina).

**⚪ REGENERABLE:** `build/`, `app/build/`, `.gradle/`, `.idea/`,
`capacitor-cordova-android-plugins/`, `app/src/main/assets/public/`, los `capacitor.*.json` de assets, y
los dos tests de ejemplo de Capacitor (versionados pero inútiles: **no hay tests en el repo**).

### 4.5 El resto

| Ruta | Qué es |
|---|---|
| `patches/@capacitor-community+background-geolocation+1.2.26.patch` (14 KB) | 🟢 **Esencial.** 4 cambios, todos necesarios. **Sin él el GPS no se configura desde JS.** Se aplica solo en `postinstall` |
| `public/` (125 KB) | Íconos de marca y PWA, `oauth.html` (página puente del OAuth web), `data/*.csv` (semillas de importación) |
| `.claude/skills/` (156 archivos, 4,4 MB) | Las 8 skills de diseño, **versionadas a propósito** (`.gitignore` exceptúa `skills/`). ⚠️ Hay `__pycache__/*.pyc` versionados: ruido inofensivo |
| `.claude/launch.json` | Config de preview (gitignoreada) |
| `trabajo diseñador ui ux/` (2,1 MB) | Handoff **v2 (13/07)** del diseñador. **Gitignoreado.** Superado por el v3 de la raíz |

---

## 5. Clasificación para la migración

### 5.1 🟢 ESENCIAL

Sin esto no compila, no se publica, o se pierde conocimiento.

| Bloque | Ruta |
|---|---|
| Código fuente | `la-union-app/src/**` (142 archivos) |
| Nativo artesanal | `la-union-app/android/` **excepto** `build/`, `app/build/`, `.gradle/`, `.idea/`, `capacitor-cordova-android-plugins/`, `app/src/main/assets/public/` |
| 🔴 Secretos de firma | `android/app/launion.keystore`, `android/keystore.properties`, y `../.claude/keystore.md` |
| 🔴 Entorno local | `la-union-app/.env.local` |
| Backend | `supabase/functions/**` · `db/**` |
| Build y config | `package.json`, `package-lock.json`, `vite.config.js`, `capacitor.config.ts`, `index.html`, `.browserslistrc`, `.gitignore`, `.env.example`, `.env.production` |
| Parche | `patches/*.patch` |
| Automatización | `scripts/*.sh` · `.github/workflows/deploy.yml` |
| Assets servidos | `public/**` |
| Documentación viva | `CLAUDE.md`, `HANDOFF.md`, `INFORME_AUDITORIA.md`, `ESTRUCTURA_PROYECTO.md`, `PLAN_SAAS.md`, `DOCUMENTACION_FUNCIONAL.md`, las 4 `GUIA_*` vivas, `legal/**`, `db/00_LEER_PRIMERO.md`, `db/historico/LEER_ANTES_DE_TOCAR.md` |
| Skills | `la-union-app/.claude/skills/**` |
| Historial | `la-union-app/.git/` (o reclonar) |
| Ícono fuente | `icon-fuente.png.png` (una copia) |
| Briefs | Los 6 `BRIEF_*.md` de la raíz — **contrato del design system** |

### 5.2 🟡 SECUNDARIO / ARCHIVABLE

Estructura propuesta (**documentada, no ejecutada**):

```
propuesta LA UNION/
├─ la-union-app/                      ← el repo, intacto
├─ BRIEF_DISENO_UXUI.md               ← los 6 briefs quedan en raíz (son contrato vivo)
├─ BRIEF_DISENO_UXUI_v1.1_SUPERVISION_MOVIL.md
├─ BRIEF_DISENO_v1.2_CATALOGO_Y_REPARTOS.md
├─ BRIEF_DISENO_v1.3_PROPIETARIO_DUENO.md
├─ BRIEF_DISENO_v1.4_LOGIN.md
├─ BRIEF_VISUAL_WEB_PUBLICIDAD.md
├─ .claude/                           ← keystore.md + launch.json · NO archivar
│
└─ _archivo/
   ├─ diseno/
   │  ├─ handoff-2026-07-28-v3/       ← "trabajo diseñador 27-7/"           (3,1 MB) ⭐ el vigente
   │  ├─ handoff-2026-07-13-v2/       ← "la-union-app/trabajo diseñador ui ux/" (2,1 MB) superado
   │  ├─ handoff-2026-07-05-v1/       ← "trabajo del diseñador/"            (1,7 MB) superado
   │  └─ mockups/
   │     ├─ MOCKUP_LOGIN_v1.4.html
   │     └─ MOCKUP_UXUI_VENDEDOR_REPARTIDOR.html
   ├─ diagramas/
   │  ├─ funciones-app.{html,pdf}         ← "la-union-diagramas/"    (332 KB)
   │  └─ noodles-arquitectura.{html,pdf}  ← "noodles-diagramas/"     (376 KB)
   ├─ docs-superadas/
   │  ├─ plan.md                      ← rol propietario, ya ejecutado
   │  └─ BRIEF_DISENO_MOBILE.md       ← superado por v1.2–v1.4
   └─ scratch/
      └─ marca.png                    ← "scratch_splash/"
```

> ⚠️ **`README.md`, `GUIA_APK_ANDROID.md`, `GUIA_API_KEY_GOOGLE_MAPS.md` y `GUIA_PUBLICACION_1.6.4.md`
> están obsoletos pero versionados en el repo.** Moverlos hace que git los marque como borrados. Es más
> limpio dejarlos donde están —`CLAUDE.md §8` ya avisa que no hay que confiar en ellos— o hacerlo con
> `git mv` en un commit dedicado. Solo `plan.md` y `BRIEF_DISENO_MOBILE.md` se pueden mover sin ruido.

### 5.3 ❌ NO copiar — ~645 MB de artefactos regenerables

| Ruta | Tamaño | Se regenera con |
|---|---|---|
| `node_modules/` | 530 MB | `npm install` |
| `android/build/` + `android/app/build/` | 105 MB | `gradlew assembleRelease` |
| `android/capacitor-cordova-android-plugins/` | 5,6 MB | `npx cap sync android` |
| `android/app/src/main/assets/public/` | 3,7 MB | `npx cap sync android` |
| `dist/` | 3,7 MB | `npm run build` |
| `bundle.zip` | 1,2 MB | `scripts/ota-release.sh` |
| `graphify-out/` | 833 KB | Artefacto de una auditoría del 16/07 — descartable |
| `.idea/` | 110 KB | El IDE |
| `android/local.properties` | — | Android Studio, al abrir el proyecto |
