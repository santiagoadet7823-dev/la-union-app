# Documentación funcional — DisT-At

> Qué hace cada función de la app y a qué rol pertenece.
> Complementa [CLAUDE.md](CLAUDE.md) (reglas técnicas) e [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md)
> (arquitectura y deuda).
>
> **Regenerado el 08/09/2026 sobre `APP_VERSION 1.25.0`** (commit `b6d500c`), midiendo contra el
> código y contra la base viva. La revisión anterior era del 18/07/2026 sobre 1.5.25 y había quedado
> falsa en lo más importante: decía que los pedidos no persistían, describía un rol `propietario` que
> se eliminó el 10/08, documentaba una pantalla (`ConsultasView`) que ya no existe y daba la
> retención de posiciones en 7 días cuando son 45.

---

## 0. Lo primero que hay que entender

> **DisT-At ya no es sólo rastreo: el eje de ventas persiste.**

La revisión anterior abría diciendo que un vendedor podía hacer la jornada completa y al recargar no
quedaba rastro. **Eso dejó de ser cierto.** Hoy `pedidos`, `pedido_items`, `visitas`, `metas` y
`pedido_ediciones` son tablas reales con filas reales: el pedido sobrevive a la recarga, se puede
corregir con auditoría y se puede anular.

Lo que sí sigue siendo cierto es que **el volumen es chiquito**: 12 pedidos y 28 renglones en toda la
base al 08/09. Las pantallas de venta se ven casi vacías, y eso no es un bug — cada bloque lo dice
con palabras en vez de dibujar un cero.

### Estado real de cada módulo

| Estado | Módulos |
|---|---|
| ✅ **REAL** (lee/escribe Supabase) | Login · Usuarios · Empresas · Zonas · Categorías de rastreo · Importar clientes/productos/fotos · Clientes · Catálogo · Marketing · **Pedidos (alta, edición, anulación, export)** · **Metas y Mi tablero** · Visitas · Reportes · Respaldo · Supervisión móvil y escritorio · Panel de dirección · Vidriera · todo el pipeline GPS y de sincronización |
| ⚠️ **REAL pero incompleto** | Entregas del repartidor: los estados y la firma escriben, pero `firmas_ins` sigue sin alcance por empresa · `rutas` está vacía y nunca se usó |
| 🔶 **VIVO PERO SIEMPRE VACÍO** | **Faltante** — `FaltanteTab.jsx:18` declara `const [faltVacio] = useState(true)` **sin setter**, así que la pantalla se abre desde el menú de gestión y no puede mostrar nada nunca |
| ⛔ **CÓDIGO MUERTO** (sin ruta de acceso) | `admin/AdminView.jsx` y todo lo que sólo cuelga de él: `RecorridosView`, `MapaOperativo`, `ReplayJornada` · `admin/tabs/RuteoTab.jsx` (no lo importa **nadie**, ni siquiera el padre muerto) · `vendedor/tabs/PerfilTab.jsx` |

> **Nota sobre `PerfilTab`:** sigue muerto, y sigue sin dejar al vendedor sin "Mi cuenta".
> `AppShell` envuelve la vista del vendedor y del repartidor y monta `MiCuenta` en su topbar. El menú
> —Mi perfil, tema, cerrar sesión— está disponible. `PerfilTab` es una segunda implementación que
> quedó sin conectar. ⚠️ El comentario de `VendedorView.jsx:29` todavía habla de "las 4 pestañas"
> mientras el grid de `:191` es `repeat(3,1fr)`.

### Tamaño del sistema, medido el 08/09/2026

| Parte | Archivos | Líneas |
|---|---|---|
| `web/src/features/` | 94 | 21.096 |
| `web/src/services/` | — | 5.221 |
| `web/src/components/` | — | 4.036 |
| `web/src/lib/` | — | 2.007 |
| `web/src/hooks/` | — | 1.762 |
| `web/src/context/` | — | 1.521 |
| **`web/src/` total** (incluye CSS) | — | **36.515** |
| Nativo Android (`.java`) | 25 | 5.706 |
| Edge Functions | 7 | 2.347 |
| Migraciones `db/*.sql` | 55 | — |

> 🩸 **CLAUDE.md §4 dice "17 clases" nativas y `UploaderGpsService` con 1.452 LOC.** Son **25 clases**
> y **1.474 LOC**. Corregir al tocar esa tabla.

---

## 1. Puerta de entrada

### Login — `features/auth/LoginView.jsx`

**Ya no es "un solo botón".** Medido sobre la base de producción: de 14 usuarios, 13 entran con
Google y 1 con email y contraseña. Por eso Google es lo único grande de la pantalla y el formulario
vive **plegado** detrás de un enlace, en vez de ocupar el 70 % de la caja para un solo usuario.

Lo que suma el formulario, y por qué:

- **Recuerda quién entró en este teléfono** — sólo nombre y email, **nunca la contraseña**.
- **Deja ver la contraseña mientras se escribe** — con sol de frente y una mano, escribir a ciegas
  era la causa real de los reintentos.
- **Recupera la contraseña** por enlace. Antes había que llamar al admin para que la cambiara a mano.

### Aprobación — `features/auth/PendienteView.jsx`

**Entrar con Google NO da acceso.** Crea una fila en `perfiles` con `rol = null` y `activo = false`
que un admin debe aprobar.

```
aprobado = activo && rol
```

Sin rol o inactivo → `PendienteView`, con "Ya me aprobaron — reintentar" y "Salir".

### Perfil offline-first

El perfil se cachea. Si hay caché se usa ya y se revalida en segundo plano. **Si la red falla pero
hay caché, no se marca error**: es preferible entrar con el perfil viejo que dejar a un vendedor sin
GPS al abrir la app sin señal. Al cerrar sesión la caché se borra, para que no se filtre a otra
cuenta en el mismo teléfono.

### Quién ve qué — `App.jsx`

`decidirSupervisionMovil()` y `decidirPanelDireccion()` son **el único lugar** que sabe esta regla.
Los roles son **excluyentes**: `RoleRouter` es un if/else.

| Rol | APK (nativo) | PWA en celular | PWA en PC | ¿Se rastrea? |
|---|---|---|---|---|
| `vendedor` / `repartidor` | `VendedorView` / `RepartidorView` + `GpsGate` | idem | idem | **Sí, obligatorio** |
| `encargado` | `SupervisionMovil` (Panel) · `VendedorView` (Mi jornada) | `SupervisionDesktop` | `SupervisionDesktop` | **Sí — es dual** |
| `admin` / `superadmin` | `SupervisionMovil` | **`PanelDireccion`** | `SupervisionDesktop` | No |
| `marketing` | `MarketingView` | `MarketingView` | `MarketingView` | **No — por privacidad** |

> 🩸 **Leer esta tabla ANTES de diagnosticar "al rol X no le aparece Y".** `PanelDireccion` (la
> pantalla con los números, heredada del difunto `propietario`) **sólo aparece en web y con pantalla
> de celular** — es el dueño desde su iPhone. En la APK y en la PC, admin cae en supervisión. No es
> un bug; es `decidirPanelDireccion`.

El corte celular/PC lo da `useDevice().isMobile` (ancho + puntero + userAgent). ⚠️ **El override
manual vive en `localStorage['lu-device']` y es pegajoso**: un navegador que alguna vez eligió
"Celular" entra al `PanelDireccion` aunque esté en 1280 px.

---

## 2. Rol VENDEDOR

El rol que sostiene el negocio: 6 personas activas en el parque.

### El gate de GPS — `GpsGate`

Antes de poder trabajar tiene que dar permiso de ubicación. Bloquea el árbol entero hasta que hay
permiso **y token de ingesta**.

> 🔴 **La trampa que costó la sesión del 08/08:** configurar el teléfono **no** lo pone a rastrear.
> Sin pasar el gate no hay token, y sin token no hay puntos por más impecable que se vea el
> `dumpsys`.

### Paso 1 · Inicio y check-in — `vendedor/tabs/InicioTab.jsx` (285 LOC)

Su cartera en lista y en mapa, con los no visitados destacados. `useSugeridos.js` propone a quién
visitar mirando los pedidos anteriores.

El check-in marca la llegada al comercio. Desde 1.25.0, si el comercio **ya fue visitado**,
`ElegirTicketSheet` ofrece corregir el pedido ahí mismo — y el pill "Visitado" volvió a ser tocable:
era un `div` inerte, así que un comercio ya visitado quedaba **inalcanzable toda la jornada**.

> 🔴 **El lápiz que ubica un comercio sólo se dibuja si `c.idVendedor === user?.id`.** Es el único
> camino por el que un vendedor geolocaliza un comercio. Al 08/09 hay **38 clientes con vendedor
> asignado sobre 2.016**, así que para el 98 % de la cartera ningún vendedor ve ese lápiz.
> **Mejoró mucho** (el 08/08 eran 3, con 18 ubicados; hoy hay 662 ubicados) pero el gate sigue siendo
> la asignación directa; decidir si el correcto es la ZONA (`clientes.id_zona` → `zonas.id_vendedor`).

### Paso 2 · La visita — `vendedor/tabs/VisitaCatalogo.jsx` (391 LOC)

El catálogo real con la grilla compartida `components/GrillaCatalogo.jsx`, con cantidad tipeable y
**escalas de precio por volumen**.

> 🩸 **Un precio se pregunta en UN SOLO LUGAR: `lib/precios.js`.** La regla del precio efectivo
> estaba copiada en **11 lugares de 7 archivos**. Con precio plano las once coincidían por
> casualidad; con escalones, la primera que quede sin actualizar hace que el celular del vendedor y
> la tablet del cliente muestren **números distintos con el comerciante enfrente**.
> `precioPara(producto, cantidad)` y punto.

### Paso 3 · El carrito — `vendedor/CarritoSheet.jsx`

Suma los renglones y arma el pedido. El pie del carrito es el número que se guarda como
`pedidos.monto_total`.

### Paso 4 · Sin pedido — `vendedor/tabs/SinPedidoSheet.jsx`

Registrar que se visitó y **no** se compró, con el motivo. Es dato de negocio, no un hueco.

### Paso 5 · El ticket — `pedidos/TicketPedido.jsx`

Desde 1.25.0 el ticket **dice quién lo emite**: empresa + vendedor responsable. La leyenda "no es una
factura" dejó de llevar `lu-no-print`, o sea que ahora **sí sale en el PDF**.

> 🔴 **"Compartir el PDF" es código NATIVO** (`ImpresionPlugin.compartirPdf` +
> `android/print/PdfDelWebView.java`) y viaja **sólo en el APK**. En un teléfono con APK viejo el
> botón cae a "Imprimir o guardar como PDF" — no rompe, sólo no mejora.

### Paso 6 · Mis pedidos y repetir — `pedidos/MisPedidosSheet.jsx` · `usePedidos.js`

Rango Hoy / 7 / 30 con total. **Repetir el último pedido** rearma lo que el comercio compró la vez
anterior **a los precios de hoy** — recalcula con `precioPara()`, no copia el monto viejo.

### Paso 7 · Corregir un pedido — `pedidos/EditarPedidoSheet.jsx` · `editarPedido.js`

Corrige un pedido Pendiente sin perder el precio pactado, con auditoría de **quién, cuándo y dónde**
(lat/lng) en `pedido_ediciones`.

> `pedido_ediciones` no tiene policy de UPDATE ni de DELETE **a propósito**: una auditoría editable
> no es auditoría.

### Mi tablero — `metas/TableroSheet.jsx` (473 LOC)

Las metas de venta que **el propio vendedor** se fija (`db/56`), más productos, oportunidades y
clientes dormidos (`db/57`). Siete métricas de **venta**.

> **Km y horas quedan afuera a propósito.** El vendedor se fija metas de lo que vende, no de cuánto
> maneja. Ver el encabezado de `db/56`.

### Qué escribe realmente un vendedor

`posiciones` (por el servicio nativo) · `visitas` · `pedidos` + `pedido_items` ·
`pedido_ediciones` · `metas` · `estado_dispositivo` (latido) · y `clientes` sólo cuando da de alta
uno o ubica uno propio.

---

## 3. Rol REPARTIDOR — `features/repartidor/RepartidorView.jsx` (448 LOC)

Mismo `GpsGate` que el vendedor.

- **Hoja de ruta**: las entregas asignadas, en el orden más corto. El orden sale de
  `services/routing/`, que es el **único punto de swap** del proveedor, por diseño.
- **Confirmar entrega**: estado + firma de quien recibe.
- `useEntregas.js` (204 LOC) lee de `pedidos`.

> 🟠 **Deuda abierta:** `firmas_ins` sigue siendo `to authenticated` **sin alcance por empresa**. Hoy
> no muerde porque casi nadie firma, pero cuando el módulo arranque hay que darle el mismo
> tratamiento que `db/25` le dio a las fotos.

> ⚠️ **Overlay que revienta al cerrarse**: el cuerpo de un modal que deriva de
> `deliveries.find(d => d.id === modal)` se vuelve `undefined` en el mismo frame en que se cierra.
> Se retiene el último valor en un ref — ver `mdView` en este archivo.

---

## 4. Rol ENCARGADO — el rol dual

Se lo trackea por GPS **y** supervisa. Alterna entre "Mi jornada" (la misma vista del vendedor, con
GPS) y "Panel" (auditoría).

- **Ver al equipo en vivo**: `SupervisionMovil` (922 LOC) en la APK, `SupervisionDesktop` (811) en
  web.
- **Paradas**: carteles sobre el mapa con cuánto estuvo detenido en cada lugar (`dwells.js`).
- **Pedidos**: revisar y anular (`db/45`). El alcance real lo pone `pedidos_sel` **en el servidor**
  vía `ids_a_mi_cargo()` — el encargado ve **sólo a su gente**, no toda la empresa. La tabla de
  gestión decide quién ve la pantalla; la base decide qué hay adentro.
- **Reportes**: `ReportesView.jsx` (504 LOC) + 6 componentes — recorrido, paradas, curva de batería,
  línea de tiempo, pedidos del día, salud del dato. Exporta a Excel y PDF.
- **Avisos del equipo**: push cuando alguien deja de reportar o queda quieto. 799 avisos históricos,
  8 abiertos al 08/09.

> 🩸 **Las dos supervisiones NO comparten una línea de código y ya divergieron dos veces.** Lo que
> las dos muestran igual va en un módulo compartido, nunca copiado: `supervision/dwells.js`,
> `trazos.js` y `components/`.

---

## 5. Roles ADMIN y SUPERADMIN

> 🩸 **`propietario` se eliminó el 10/08/2026 (`db/31`).** Existió del 27/07 al 10/08 y **nunca tuvo
> un solo perfil**: era un rol entero mantenido para nadie, y cada policy nueva tenía que acordarse
> de incluirlo o el dueño perdía acceso en silencio. **El dueño de la distribuidora usa `admin`.**
> Lo que no se tiró fue su pantalla: es `features/direccion/PanelDireccion.jsx`.

### Permisos de menú — `lib/gestion.js`

`roles` = quién la ve por ser lo que es · `permiso` = quién la ve por tener un permiso extra
(`perfiles.permisos text[]`, `db/23`), sin importar su rol.

| Ítem | Quién |
|---|---|
| Reportes | encargado · admin · superadmin |
| Pedidos | encargado · admin · superadmin |
| Clientes | encargado · admin · superadmin |
| Revisar repetidos | admin · superadmin |
| Zonas | encargado · admin · superadmin |
| **Catálogo** | encargado · admin · superadmin · **marketing**, o cualquiera con el permiso `catalogo` |
| Faltante | encargado · admin · superadmin — ⚠️ **siempre vacía**, ver §0 |
| Invitar | encargado · admin · superadmin |
| Usuarios | admin · superadmin |
| Empresas | **solo superadmin** |
| Respaldo | admin · superadmin |

> **Cuándo va un permiso y cuándo un rol nuevo.** `permisos` sirve para SUMARLE algo a alguien que ya
> es otra cosa: un vendedor con `'catalogo'` sigue siendo vendedor —conserva GPS, jornada y su lugar
> en el mapa— y además edita el catálogo. El criterio para un rol nuevo no es "¿qué puede hacer?"
> sino **"¿la app la tiene que rastrear?"**.

### Panel de dirección — `features/direccion/PanelDireccion.jsx` (836 LOC)

Scroll único que **empieza por los números**, con el mapa como una tarjeta que se abre. Es la
pantalla que el dueño mira desde su iPhone. Componentes propios: `KpiCard`, `MiniKpi`, `FilaEquipo`,
`SheetPersona`, `SinDatoBloque` y `titulares.js`.

⚠️ Pasa `showDeviceToggle` a `MiCuenta` — sin eso quedaría encerrado por el override pegajoso de
`lu-device`.

### Usuarios — `admin/UsuariosView.jsx` (806 LOC)

Invitar, asignar rol, activar/desactivar y dar permisos extra.

> 🩸 **`posiciones.id_usuario` es `NO ACTION`.** Borrar a una persona **exige borrar antes su
> recorrido**: en la limpieza del 12/08 costó 23.945 posiciones, el 37 % de la tabla, irreversible.
> Si hay que dar de baja a alguien **conservando** su historial, el único camino es `activo=false`.
> Y ojo: `estado_dispositivo` y `recorridos_snap` **no tienen FK a `perfiles`**, no se van solas.

### Empresas — `admin/EmpresasView.jsx` (440 LOC) · solo superadmin

Alta de distribuidoras. Monta `CategoriasRastreo.jsx` (los horarios de rastreo).

> ⚠️ **`empresas.activo` no gatea nada hoy.** Se escribe y se muestra, pero ninguna policy ni el gate
> de `App.jsx` lo consultan. Desactivar una empresa **no tiene efecto**, aunque la UI diga lo
> contrario.

### Zonas — `admin/ZonasView.jsx`

Divide el territorio. 16 zonas, 15 clientes con zona asignada.

### Cartera — `admin/tabs/ClientesTab.jsx` · `FichaCliente.jsx` · `ImportarClientes.jsx` · `RevisarDuplicados.jsx`

2.016 clientes. **662 con ubicación** (33 %), 38 con vendedor.

> ⚠️ **Una capa de Leaflet que no está agregada al mapa no puede responder `getBounds()`.** El
> encuadre del geocerco en la ficha de un cliente reventaba con *"Cannot read properties of undefined
> (reading 'layerPointToLatLng')"*. Va `L.latLng(lat,lng).toBounds(radio*2)`, que no necesita mapa
> (ojo: toma el LADO, no el radio).

### Catálogo — `admin/tabs/CatalogoTab.jsx` (407 LOC)

617 productos, 547 vigentes. Lo alcanzan **tres** pantallas distintas por `lazy`: `MarketingView`,
`DespachoGestion` y `VendedorView`.

> 🩸 **Un campo nuevo del catálogo hay que ponerlo en CUATRO listas blancas, y la cuarta se olvida
> siempre**: `lib/planillaProductos.js` → `filaAImportar`; el `.map()` de `ImportarProductos.jsx`;
> `CatalogContext.jsx`; y **`supabase/functions/ingest-precios/index.ts`**. Las tres primeras las
> ejercita cualquiera subiendo una planilla; **la cuarta sólo corre en el canal automático del
> cliente**, así que un campo que falte ahí funciona perfecto en todas las pruebas manuales y no hace
> nada en producción.

### Respaldo — `features/gestion/RespaldoDatos.jsx` (252 LOC)

> Los recorridos se purgan a los **45 días** (`db/42`). Esto es la **única** salida del historial
> fuera de Supabase. Sólo admin y superadmin: exporta la empresa entera.

---

## 6. Rol MARKETING — `features/marketing/MarketingView.jsx` (227 LOC)

Creado el 12/08/2026 (`db/38`). Es la persona a cargo del catálogo —precios, fotos, productos,
códigos— y **no sale a la calle**.

- **Una sola pantalla**, la misma en los tres canales.
- **Una sola fila** en `GESTION_ITEMS`.
- `ControlCodigos.jsx` (códigos repetidos) · `GuiaFotos.jsx` (cómo sacarlas) · `ImportarFotos.jsx`.

> 🔴 **Es el único rol que NO se trackea, y eso es una decisión de privacidad, no un olvido.**
> Ninguna policy de `posiciones`, `recorridos_snap`, `estado_dispositivo`, `visitas`,
> `alertas_equipo`, `rutas` ni `ubicaciones_compartidas` lo menciona.
>
> **Por qué un rol y no un permiso:** `vendedor` la encerraba detrás del `GpsGate` y `encargado` la
> ponía en el mapa del supervisor y en los avisos de "sin reportar" todos los días. Ver el encabezado
> de `db/38_rol_marketing.sql`.

---

## 7. Supervisión

`SupervisionMovil` (APK, full-screen) y `SupervisionDesktop` (PWA/PC). Componentes compartidos:
`BurbujasEquipo`, `BurbujasParadas`, `EstadoEquipo`, `TarjetaPin`, `RailMapa`, `DespachoGestion`.

### Reglas no obvias

- **`LeafletMap` lleva `isolation: isolate` y NO se saca.** Leaflet asigna z-index de hasta 1000 a
  sus capas y las esquinas de controles se escapan al contexto padre. Toda la escala `--z-*` depende
  de esto.
- **Un overlay flotante sobre el mapa va con `pointerEvents:'none'`** en su contenedor y `'auto'` sólo
  en las piezas que se tocan. Un contenedor absoluto con `left`/`right` fijos ocupa todo el ancho
  aunque su contenido mida 40 px, y se traga los toques del mapa en esa franja.
- **El pin animado se compara contra el último destino MANDADO**, nunca contra `getLatLng()`, que a
  mitad de animación devuelve el fotograma actual.
- **`requestAnimationFrame` NO dispara con el documento oculto.** Toda animación por rAF necesita red
  de contención en `visibilitychange`, o el pin queda congelado en una posición por la que la persona
  ya pasó — y eso es peor que no animar, porque es indistinguible de un dato real.
- **"El mapa está lento" se PERFILA, no se adivina.** `detectarParadas` era cuadrática: 7.090 ms sobre
  una jornada real, el 99 % del costo. Hoy quickselect, ×7,8 y salida **bit-idéntica** sobre 63
  persona-días.
- **El recorrido crudo miente.** Pasarlo siempre por `limpiarTrazo` (`lib/geo.js`): hay teleports de
  127 km. Un día figuraba con 524,8 km y los reales eran 17,9.

---

## 8. Vidriera — la tablet del mostrador

Módulo grande y con reglas propias: `VidrieraTablet.jsx` (1.041 LOC), `useVidriera.js`,
`ParearTablet`, `EspejoTablet`, `PrepararCatalogo`, `AvisoVidriera`.

Una tablet en el mostrador le muestra al comerciante el catálogo mientras el vendedor carga el
pedido. Se conecta por **hotspot local** del teléfono (`EnlaceTabletPlugin.java`, 544 LOC) contra un
servidor HTTP embebido (`ServidorLocal.java`, 405 LOC), con pareo por QR.

> 🔴 **La tablet NO PUEDE recibir una OTA, nunca.** No se loguea, se une a un hotspot sin salida a
> internet y no tiene SIM: se queda congelada en el bundle que trajo su APK. Todo arreglo de
> `VidrieraTablet.jsx` necesita **un APK nuevo, o una sesión en un WiFi con internet de verdad**.

> El aviso "el cliente está mirando esto" tiene su propio nivel de apilamiento (`--z-aviso`, 550),
> **arriba de los modales**: en la primera jornada real el vendedor estaba en el carrito, el cliente
> tocó otro producto y el aviso no llegó nunca porque el sheet lo tapaba.

---

## 9. Reglas del producto, en un solo lugar

**Verificadas contra el código el 08/09/2026.** Las tres marcadas ⚠️ estaban mal en la revisión
anterior.

| Regla | Valor | Dónde |
|---|---|---|
| **Una parada** | permanecer **≥ 3 min dentro de 40 m** | `geolocation/dwell.js:51-52` |
| Centro de la parada | **mediana** de lat y lng por separado (robusto a outliers) | `dwell.js` |
| Movimiento mínimo para registrar un punto | ⚠️ **9 m** (la revisión anterior decía 10) | `gpsConfig.js:18` |
| Movimiento mínimo, urbano (11-40 km/h) | **15 m** | `gpsConfig.js:220` |
| Movimiento mínimo, ruta (> 40 km/h) | **50 m** | `gpsConfig.js:239` |
| Reenvío de cortesía estando quieto | **90 s** | `gpsConfig.js:19` |
| Cadencia de captura, quieto / normal / rápido | **30 s · 4 s · 2 s** | `gpsConfig.js:245, 80, 106` |
| Umbral de "va rápido" | **3 m/s** (~11 km/h), con 20 s de histéresis anti-flapping | `gpsConfig.js:112, 146` |
| **Precisión que se CAPTURA** | **120 m** | `gpsConfig.js:196` |
| **Precisión que se CONFÍA** (línea llena y km) | **30 m** — el que no se toca | `gpsConfig.js:147` |
| Velocidad máxima creíble | **45 m/s** (~160 km/h); más rápido = glitch | `gpsConfig.js:197` |
| Ventana horaria de rastreo | ⚠️ default **07:30–22:00**, pero ya **no es global**: hay categorías por persona con semántica de **unión** | `services/tracking.js:30, 64` |
| Meta diaria del vendedor | **$900.000**, todavía hardcodeada para todos | `useJornada.js:336` |
| Geofence por cliente | 50–150 m, default **75 m** | `NuevoCliente.jsx` |
| **Retención de posiciones** | ⚠️ **45 días** (la revisión anterior decía 7). La cuenta está en el encabezado: 45 días ≈ 900.000 filas ≈ 293 MB, y le da 15 días de gracia a la exportación mensual | `db/42_retencion_posiciones.sql` |
| La zona lleva el vendedor | el cliente hereda el vendedor de su zona | `ZonasView.jsx` |
| Cliente cargado por rol móvil | nace `activo=false`, necesita confirmación | `CatalogContext.jsx` |
| Cliente importado por admin | nace `activo=true` | `CatalogContext.jsx` |

> ⛔ **La "cuota de consultas" (5.000/mes por empresa) ya no existe.** `admin/ConsultasView.jsx` fue
> eliminado y no queda un solo rastro de la regla en el código. La revisión anterior la documentaba
> como "la regla comercial del sistema"; hoy no hay ninguna.

Otras reglas transversales:

1. **Los roles son excluyentes.** Para sumar una capacidad va `perfiles.permisos`, no un rol nuevo.
2. **Un precio se pregunta sólo a `lib/precios.js`.**
3. **La ventana de rastreo está implementada TRES veces** —`dentroDeHorario()` en JS,
   `VentanaRastreo.dentro()` en Java, `en_ventana` en SQL— y nada las sincroniza. Tocar una sin las
   otras hace que los avisos al supervisor **mientan en silencio**.
4. **El techo de confianza del GPS vive en CUATRO runtimes**: `gpsConfig.js`, `metricas_actividad` y
   `vigilancia_equipo` (SQL), más el nativo. Si se mueve el 30, se mueven los cuatro.
5. **Nunca `new Date().toISOString().slice(0,10)`** — devuelve UTC y Salta es UTC−3. Usar `hoyStr()`.
6. **Un punto de la cola nunca se borra**: va a cuarentena.
7. **Publicar no es entregar.** El release se cierra mirando `estado_dispositivo`, no la respuesta
   del push.

---

## 10. Brechas funcionales y deuda, al 08/09/2026

### 🔴 Bloqueante

- **El keystore no está respaldado fuera de una máquina.** `web/android/app/launion.keystore` y
  `web/android/keystore.properties` no viajan en git. Sin ellos **ningún APK nuevo se puede instalar
  como actualización**: habría que desinstalar y reinstalar en cada teléfono, perdiendo cola de
  posiciones, cuarentena y sesión.
  🩸 **`.claude/keystore.md` NO es un respaldo**: es el volcado de la sesión de `keytool`, y las
  contraseñas no están ahí.

### 🟠 Abierto

- **6 de 12 equipos siguen por debajo de `min_version`** cinco días después de subirla a 1.24.0
  (Zura en APK 1.21.0, Gabriel en 1.13.0, Nelson y Gustavo en 1.18.0). Nelson y Gustavo **no dan
  señal desde el 21-22/08**. Luis Mendoza tiene un `bundle_encolado` de 1.22.0 con 1.23.0 ya
  aplicado — un encolado más viejo que lo aplicado, huérfano.
- **"Faltante" es una pantalla viva que nunca puede mostrar nada** (`FaltanteTab.jsx:18`).
- **`firmas_ins`** sin alcance por empresa.
- **`empresas.activo`** no gatea nada: la palanca de cobro está desconectada, y el texto de la propia
  interfaz —*"deja sin acceso a todos sus usuarios"*— es falso hoy.
- **La meta de $900.000 está hardcodeada** para todos los vendedores de todas las empresas.
- **`rutas` está vacía** y nunca se usó. `categorias` también: la categoría vive como texto en
  `productos`.
- **Key de Stadia** hardcodeada en `services/maps/basemap.js:13`. Si vence, la app no se rompe: se
  queda con OSM y se ocultan las capas Oscuro y Satélite.
- **No hay red de verificación.** `npm run lint` es `eslint . || true` sobre un repo **sin config de
  ESLint**: nunca falla. No hay tests. Y desde 1.12.1 la OTA se aplica sola en los 9 equipos,
  mientras `notifyAppReady()` sólo cubre un bundle que revienta **al arrancar**, no uno que arranca
  bien y rompe adentro — que fue exactamente el caso de la regla 51.
- **`ingest-posiciones`** cita en su encabezado un `db/16_ingesta_tokens.sql` que no existe
  (`db/16` es `visitas`); la referencia correcta es `db/48`.

### ✅ Cerrado desde la revisión anterior

- **Los pedidos persisten** (`db/45`, `db/55`, `db/56`, `db/57`). Era "la brecha más grande del
  producto" y dejó de serlo.
- **El repartidor ya recibe entregas**: `useEntregas.js` lee de `pedidos`.
- **Las categorías numéricas del ERP no volvieron**: cero productos con categoría enteramente
  numérica. La guarda de `filaAImportar` aguanta. Quedan 316 con categoría nula **a propósito**, que
  la app deduce con `inferCategoria`.
- **La cartera se destrabó**: de 18 clientes ubicados el 08/08 a **662** hoy.
- **Rol `propietario` eliminado**; ya no hay un rol que no se pueda dar de alta.
- **Códigos únicos por empresa** (`db/48`): dos distribuidoras ya pueden usar el mismo código.
- **Storage con alcance por empresa** (`db/25`).

### Código muerto verificado — 850 líneas

Trazado por `import` real, no por menciones en comentarios. `AuthedApp` ataja a los seis roles antes
de que `RoleRouter` llegue a su `return <AdminView/>`.

| Archivo | LOC | Único importador | Veredicto |
|---|---|---|---|
| `admin/AdminView.jsx` | 150 | `App.jsx` (rama muerta) | Inalcanzable |
| `admin/components/ReplayJornada.jsx` | 226 | `AdminView` | **Rescatar** — reproduce la jornada como película; no hay equivalente vivo |
| `admin/tabs/MapaOperativo.jsx` | 145 | `AdminView` | Borrar — sólo la consola de eventos es única |
| `admin/RecorridosView.jsx` | 140 | `AdminView` | Borrar — subconjunto de `SupervisionDesktop` |
| `admin/tabs/RuteoTab.jsx` | 112 | **nadie** | Borrar — andamiaje TSP; ni el padre muerto lo importa |
| `vendedor/tabs/PerfilTab.jsx` | 77 | **nadie** | Borrar — la bottom-nav tiene 3 columnas |

Los datos de todas están vivos, así que borrarlas es una decisión de **producto**, no de datos.
Rescatar `ReplayJornada` significa colgarla del menú "Menú" (`GestionHost`), que es el único camino
vivo.

---

## 11. Docs que no hay que creer

- `ESTRUCTURA_PROYECTO.md` — del 04/08, pre-monorepo, describe el rol `propietario` que ya no existe.
  Sirve como mapa histórico, no como verdad.
- `README.md` — menciona un componente `GoogleMap` que no existe; omite `CAP_BUILD=1`.
- `GUIA_APK_ANDROID.md` — se contradice sobre `storeFile` (`:230` mal, `:320` bien).
- `GUIA_API_KEY_GOOGLE_MAPS.md` — obsoleta; nada del código lee esa variable.
- `INFORME_AUDITORIA.md` — rev. 3, sobre 1.10.0. La arquitectura sigue valiendo; los números no.
