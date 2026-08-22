# HANDOFF — VIDRIERA (tablet del cliente)

**Estado al 19/08/2026.** La vidriera **funciona de punta a punta en hardware real** y ya se usó una
jornada completa con un cliente enfrente. El veredicto del dueño fue *"anda perfecto"*, con cinco
cosas de uso que se arreglaron en 1.18.1. Lo que queda es **medición en el aparato**, no
construcción.

Publicado: **APK 1.18.0** (versionCode 36) · **OTA + PWA 1.18.1** · `min_version` **1.18.0** — los 9
equipos reinstalaron solos.

> 🩸 **La vidriera salió a la calle ANTES de estar medida, y fue a propósito.** Se subió
> `min_version` por el arreglo de la notificación del GPS, que es nativo, no es de la vidriera y no
> llegaba de ninguna otra forma. Efecto lateral asumido: en los 9 teléfonos el botón **Vidriera**
> existe. Degrada bien (sin fotos es una grilla sin imágenes), pero **nadie corrió todavía "Preparar
> catálogo"**: si alguien la abre delante de un comerciante hoy, se ve gris.

> Este documento es SOLO de la vidriera. Lo demás del proyecto sigue en
> [HANDOFF.md](HANDOFF.md) y [CLAUDE.md](CLAUDE.md).

---

## 1. Qué es y cómo se usa

El cliente explora el catálogo en una tablet mientras el vendedor toma el pedido en su celular. Cada
producto que el cliente toca —con la cantidad que quiere— le aparece al vendedor como un cartel con
el botón de sumarlo al carrito, y se le abre grande en la tablet.

**🩸 La sesión es de la JORNADA, no de la visita** (18/08/2026, segunda mudanza). Primero salió de la
ventana del QR; después subió a `useJornada`, porque `VendedorView` **desmonta la pestaña Catálogo al
cambiar de tab** y el vendedor perdía la tablet camino al próximo check-in. Hoy:

- cerrar la ventana del QR no corta nada;
- cambiar de pestaña no corta nada;
- **cambiar de cliente tampoco corta el enlace**;
  > 🩸 **Acá decía "y la tablet cambia el encabezado sola". ERA FALSO** (corregido el 22/08/2026,
  > lo reportó el cliente). El celular sí republicaba, pero `ServidorLocal.publicarCatalogo`
  > reemplaza la variable **y nada más**: no encola un evento ni hace `notifyAll()`, así que la
  > tablet no se enteraba y seguía con el snapshot del PRIMER comercio — encabezado, precios y
  > ofertas incluidos. Sólo se corregia de casualidad, cuando el vendedor generaba tantos toques que
  > desbordaba el buffer del servidor y forzaba un `resync`; por eso el síntoma parecía errático.
  > Arreglado en 1.21.0: el celular emite un evento `catalogo` por el canal que ya despierta el
  > long-poll (viaja por **OTA**) y la tablet lo escucha (necesita **APK**).
  > El mismo comentario optimista estaba en `useVidriera.js` y en `useJornada.js`.
- se corta con el botón *"Cerrar vidriera y desconectar la tablet"*, al cerrar sesión, o **sola a los
  20 minutos sin que la tablet dé señales** (`INACTIVA_MS`) — ese freno es lo que evita dejar el AP
  prendido toda la tarde, que era la objeción original.

El chip "Vidriera" del header late en verde mientras hay enlace vivo.

**El camino en la app:**

1. Vendedor: **Inicio → check-in en un cliente** (el ✓ verde).
2. Salta a **Catálogo**, con la cabecera "VISITA EN CURSO". Ahí está el botón **Vidriera**.
3. Se abre el QR a pantalla completa.
4. Tablet: **"Soy una tablet · escanear código"** → *Escanear código*, o **Buscar por Bluetooth** si
   están vinculados.
5. La tablet se une sola y trae el catálogo.
6. El vendedor toca **Volver** y sigue trabajando.

⚠️ **El check-in en un cliente SIN ubicación le asigna las coordenadas de donde estés** y te lo
reclama como propio (`reclamar_y_ubicar_cliente`). Para demostraciones, usar un comercio que ya
tenga ubicación — `BU AYELEN ACOSTA` (código 2788) es uno.

⚠️ **Las fotos las sirve el TELÉFONO, no internet.** Sin correr *Mi cuenta → Preparar catálogo*, la
tablet muestra la grilla sin imágenes. Desde 1.18.1 la ventana del QR avisa cuántas faltan antes de
que le pases la tablet al cliente.

---

## 2. Las cuatro decisiones de arquitectura que no se re-discuten

1. **`LocalOnlyHotspot`, no Bluetooth ni WiFi Direct, para los DATOS.** El requisito es que la tablet
   no consuma datos, y esa red **no tiene salida a internet**: el cero es demostrable, no una
   promesa. Bluetooth existe, pero **solo pasa el sobre de la red** (~120 bytes) — ver §4.
2. 🩸 **El JS NUNCA hace `fetch` a la IP local.** La app se sirve desde `https://localhost` y el
   WebView bloquea el contenido mixto pase lo que pase en el manifest. El HTTP lo hace el nativo.
3. 🔴 **`nivel_rentabilidad` NO viaja, y se filtra en el ORIGEN.** `snapshotCatalogo`
   (`services/vidriera.js`) arma el payload **campo por campo** — nada de spread, que arrastraría
   cualquier columna futura (el costo). Lo que sí sobrevive es el **orden** de la vidriera,
   calculado en el celular y enviado ya resuelto: la tablet muestra el resultado sin conocer el
   criterio. El mismo criterio vale para el canal `emitir()` (carrito espejo, "mirá este").
   > ⚠️ **Corrección**: la versión anterior de este documento decía que *"hay una prueba que lo
   > verifica contra un producto con `costo_real` y `margen`"*. **Esa prueba no existe** — el repo no
   > tiene tests (CLAUDE.md §3). Se verificó a mano el 18/08 renderizando el snapshot con un producto
   > con `nivel`, `costo_real` y `margen`: cero fugas. **Es una verificación manual, no una red.**
4. **La tablet no se loguea nunca.** No toca Supabase, no tiene sesión ni GPS ni cuenta como
   dispositivo. `App.jsx` devuelve la vidriera **antes** de montar `CatalogProvider` y `GpsProvider`,
   así que ahí no hay ni catálogo remoto ni colas. Cero superficie de RLS y nada que revocar si se
   pierde.

---

## 3. El hardware, medido (no lo que dice el cartel)

**Tablet `Cidea CM915`** — **API 28 (Android 9)**, no 13: el `build.prop` está reescrito y el
framework instalado lo confirma (`versionCode=28`). RAM real **1.928 MB** (los "6 GB" son 2 GB +
1 GB de swap). WebView **Chrome 79**. CPU **armeabi-v7a (32 bits)**. Cámara con autofoco.

🩸 **API 28 no es un problema: es mejor.** Android **10** es donde quitaron que una app se conecte
sola a una WiFi. En API ≤28 la API vieja (`addNetwork`/`enableNetwork`) funciona **y sin el diálogo
del sistema**. Las dos ramas están escritas.

Verificar una tablet nueva: `bash scripts/diagnostico-tablet.sh` (acepta serial de USB o IP).

### 🔴 Chrome 79 es más viejo de lo que parece — y ahí está la clase de bug más cara

El navegador de esa tablet es de **diciembre de 2019**. `@vitejs/plugin-legacy` transpila **JS**, no
CSS, y estos estilos son **inline** (`sx()`), así que **por ahí no pasa ni autoprefixer ni el plugin
legacy**. Lo que el navegador no entiende, lo ignora en silencio: no hay error, no hay consola, solo
una pantalla que se ve mal.

| Propiedad | Desde | ¿La tiene Chrome 79? | Estado |
|---|---|---|---|
| `aspect-ratio` | Chrome 88 | ❌ | Ya evitado |
| `inset` (forma corta) | Chrome 87 | ❌ | **Arreglado el 18/08** — 5 fotos que no se posicionaban |
| **`gap` en FLEXBOX** | Chrome 84 | ❌ | ✅ **Cerrado.** `VidrieraTablet` el 19/08 (`--gx`/`--gy`), **`LoginView` el 20/08** |
| `gap` en GRID | Chrome 66 | ✅ | Sin problema |
| `min()` / `max()` / `clamp()` | Chrome 79 | ✅ | Justo en el piso; se usa en el reposo y anda |
| `ResizeObserver` | Chrome 64 | ✅ (existe) | 🩸 **PERO NO SE USA, y a propósito.** Con el documento oculto **no entrega callbacks**, igual que `rAF` e `IntersectionObserver` (regla 35). Medido el 22/08 con la pestaña en segundo plano: los tres dieron **0 disparos en 800 ms**. Y ésta es, literalmente, la pantalla que se queda sola. El ancho de la grilla se re-mide en el evento `resize` |

🩸 **La superficie de la tablet no es solo `VidrieraTablet`** (20/08/2026). El 19/08 se convirtió esa
pantalla y se dio el tema por cerrado, pero la tablet **arranca en `LoginView`**: ahí está el botón
"Soy una tablet · escanear código". Sus **14** contenedores flex con `gap` se venían viendo con todo
pegado —el logo, los dos botones de ingreso y el pie— en la primera pantalla que ve la tablet.
Convertida el 20/08. El recorrido completo es **`LoginView` → `ParearTablet` → `VidrieraTablet`**;
`ParearTablet` se revisó y no usa `gap` (ni `inset`, ni `aspect-ratio`).

⚠️ **Y el reemplazo tiene un borde que `gap` no tenía**: `[style*="--gx"] > * + *` **no alcanza a un
nodo de texto suelto**. Un `<button><svg/>Texto</button>` queda sin separación aunque declare
`--gx`. En `LoginView` hubo que envolver el texto de 4 botones en un `<span>`.

**Antes de tocar cualquier cosa de la pantalla del cliente, chequear la propiedad contra Chrome 79.**

⚠️ **Riesgo abierto: memoria.** 2 GB con recolección de basura en cadena al arrancar. Desde 1.18.1 la
grilla dibuja de a 60 tarjetas y no 529, lo que baja mucho el DOM — pero **con fotos hay que volver a
medirlo**.

---

## 4. Lo que falta

### 🔴 A. Probar con fotos — sigue siendo el único riesgo grande

El catálogo cargado (529 productos) **no tiene imágenes**, así que dos cosas siguen escritas y **sin
verificar**:

- Que las fotos **se bajen una sola vez**. El archivo se guarda como `<producto>_<version>`, con la
  versión derivada de la URL (que cambia sola cuando marketing reemplaza una foto): "¿la tengo?" y
  "¿cambió?" son la misma pregunta.
- Que una tablet de **2 GB aguante** una grilla con ~20 MB de imágenes.

**Cómo probarlo, en orden:**

1. Cargar fotos a ~30 productos desde la pantalla de marketing.
2. En el celular: *Mi cuenta → **Preparar catálogo*** hasta que el contador llegue a 30/30.
   ⚠️ **Sin este paso la prueba no mide nada** (ver §5, la trampa del espejo).
3. Abrir la vidriera **dos veces** y leer el log de la tablet:
   `[vidriera] fotos: N del disco · M bajadas`. La segunda vez, **M tiene que ser 0**.
4. Después, el catálogo completo: `adb shell dumpsys meminfo com.launion.app`, tiempo hasta la grilla
   llena, y si hay GC en cadena.

### ✅ B. `gap` en flexbox — CERRADO (19/08 la vidriera · 20/08 el login)

Ver la tabla de §3. Quedó convertido a `--gx`/`--gy` en las dos pantallas de la tablet.
**Verificar en la tablet real, no en el navegador de escritorio** — en Chrome moderno el `gap`
funciona y el bug es invisible.

### 🟠 B-bis. La ficha grande se dibujaba siempre en DOS columnas — arreglado, falta verlo en la tablet

El cliente mandó (20/08) una foto de la tablet con el botón **"Pedir 7" aplastado contra el borde y
cortado**, y la primera hipótesis —que era el `gap` de §3— **era falsa**: eso ya estaba arreglado. El
problema real es que la ficha se dibujaba siempre en fila (foto de 300 px + columna de texto), y la
tablet se usa **parada**, reportando ~478 px CSS de ancho — que es también por qué la grilla se ve de
2 columnas y no de 3.

Medido con el componente real a 478 px, **antes**:

| | |
|---|---|
| fila de acción | 153,3 px |
| stepper (`flex:none`) | **166 px** — más ancho que la fila entera |
| botón "Pedir N" | **34,8 px** |
| borde derecho del botón | **487,5 px** → **9,5 px FUERA de la pantalla** |

`flex:1` no tiene piso: el botón se encogía sin quejarse y el texto se partía en dos renglones
cortados. **Después**: botón **378 px**, borde derecho 428 px, dentro de la pantalla.

El arreglo mide el ancho en JS (`FICHA_FILA_MIN`, 640) porque **estos estilos son inline y no admiten
media queries**: por debajo del corte la ficha se apila y el botón va en su propio renglón. El
stepper mide 166 px fijos y no se puede achicar sin romper el área táctil mínima, así que compartir
renglón con él en una pantalla angosta siempre iba a dejar al botón sin lugar.

⚠️ **Verificado en el navegador a 478 px, no todavía en la tablet.** Y como la tablet no recibe OTA
(ver [CLAUDE.md](CLAUDE.md) §6), esto necesita **APK nuevo + reinstalación por USB**.

### 🟠 C. El pareo por Bluetooth, contra el celular

`EnlaceBluetoothPlugin` está escrito y **verificado del lado de la tablet**: el botón "Buscar por
Bluetooth" aparece, el plugin contesta y el mensaje de error es el correcto (*"El Bluetooth de la
tablet está apagado"*). Los permisos quedan concedidos solos en API 28, como se esperaba.

**Falta la otra mitad**: vincular tablet y celular una vez, abrir la vidriera en el celular y
confirmar que la tablet trae el sobre. Sin eso, el camino sin cámara es teoría.

- **Lo práctico: vincularlos UNA vez en el depósito.** Después cada visita es un toque.
- El QR sigue siendo el camino por defecto y no depende de nada de esto.

### 🟠 D. Medir la fluidez en la tablet, no en el escritorio

En 1.18.1 se atacó el "va trabado" y **la causa era el código, no el hardware**: cada foto que bajaba
repintaba la pantalla entera (hasta 529 renders) y cada uno de esos renders volvía a ordenar los 529
productos, porque no había un solo `useMemo`. Medido en escritorio: la derivación cruda son
**2,11 ms × 529 = 1.114 ms** de puro reordenar.

Ahora: derivados memoizados, fotos volcadas en tandas de 250 ms, tarjeta con `React.memo`, y la
grilla dibuja 60 y crece al scrollear (**1.017 nodos en el DOM en vez de ~9.000**).

**Lo que falta medir es en el aparato**, con los 529 productos y el catálogo real. Y hay una cosa
puntual sin verificar de punta a punta:

- ⚠️ **El crecimiento por scroll**. Se probó despachando el evento a mano (crece de 60 a 529 y frena
  ahí), pero **nunca con un dedo en la tablet**: el panel de vista previa de esta máquina jamás
  llega a estar visible, y con el documento oculto el navegador **no despacha eventos de scroll ni
  callbacks de `IntersectionObserver`** (es la regla 35 otra vez). Por eso el crecimiento va por un
  `scroll` pasivo y no por observer — pero el toque real sigue sin hacerse.

### ⚪ E. Menores

- **Varias tablets a la vez**: el servidor acepta N clientes; **sin probar**. Con dos, verificar que
  el long-poll de `/eventos` no se pise (cada una lleva su `desde`) y que el pool de hilos alcance —
  cada `/eventos` colgado ocupa uno hasta 25 s.
- **`PerfilTab.jsx` es una pantalla que no monta nadie.** Se rescató lo que importaba (la tarjeta
  "Preparar catálogo", que estaba ahí adentro y por eso era inalcanzable) y el resto quedó como
  copia muerta de `MiCuenta`. Falta decidir si se borra, con el mismo criterio que la tabla de
  pantallas inalcanzables de [CLAUDE.md §8](CLAUDE.md).
- **Fijado de pantalla (screen pinning)**: implementado, se activa al abrir la vidriera y se suelta
  al salir. Sin Device Owner no es un kiosco (se sale con Atrás + Recientes mantenidos) y **no se
  probó con un cliente intentando salirse**.

---

## 5. Trampas ya pagadas — leer antes de tocar

| Síntoma | Causa real |
|---|---|
| **La grilla del cliente se ve gris, sin fotos** | El espejo del teléfono está vacío. Las fotos NO salen de Storage: las sirve el celular desde su carpeta `espejo/`, y eso se llena solo apretando *Preparar catálogo*. Desde 1.18.1 `snapshotCatalogo` declara `foto:true` **solo** para lo que está espejado — antes mentía y la tablet pedía 529 fotos para cobrar 404 |
| **La foto de la tarjeta aparece recortada o de 0 px** | Dos causas distintas, las dos medidas el 18/08: la tarjeta es un contenedor flex y un alto fijo **igual se encoge** sin `flex:none`; y con las filas del grid en `auto` y el contenedor con altura definida, el navegador **las colapsa al alto del texto** (37 px contra 303) — va `grid-auto-rows:max-content` |
| **Los filtros se van al scrollear** | La raíz estaba en `min-height:100vh`: crece con el contenido y el `overflow-y:auto` de la grilla nunca acota nada, así que scrollea el documento. Va `height:100vh;overflow:hidden` |
| **El aviso del toque no llega** | Estaba con un `z-index:6` literal contra los 300 del sheet del pedido. Va `--z-aviso` (550). **Nunca un z-index literal** (CLAUDE.md §7) |
| **Un flotante queda debajo de la botonera** | La bottom-nav crece con `env(safe-area-inset-bottom)`; los flotantes clavados en píxeles quedan abajo en cualquier teléfono con gestos. Van con el mismo `env()` |
| "Android bloqueó la creación de la red" | `NEARBY_WIFI_DEVICES` **es de runtime** desde Android 13. Verificar con `dumpsys package … \| grep NEARBY`. Lo mismo vale para `BLUETOOTH_CONNECT`/`BLUETOOTH_SCAN` desde Android 12 |
| `cleartext HTTP traffic not permitted` | La política de cleartext **también aplica al nativo**. **No se prende `usesCleartextTraffic`**: el cliente HTTP va sobre un `Socket` crudo, que no atraviesa esa política |
| El import de `ListenableFuture` no resuelve | CameraX declara Guava como `implementation` y Gradle no lo propaga. Agregar `listenablefuture` **no alcanza**: Google publica una `9999.0` **vacía** que Gradle elige por número mayor. Se usa `LifecycleCameraController` |
| "Conecta pero no carga" | Falta `bindProcessToNetwork`. La red del hotspot no tiene internet y Android manda el tráfico por otro lado |
| El QR no se lee | Densidad. Ya se achicó de 213 a 105 caracteres y el cliente confirmó la mejora. Mirar el tamaño del payload antes que la cámara |
| El build dice verde y falló | El notificador reporta el exit del wrapper. **Vale el log y el exit code real, no el resumen** |
| **Una prueba en el navegador "no hace nada"** | El panel de vista previa está **oculto** (`visibilityState: 'hidden'`) y ahí no corren `rAF`, ni eventos de scroll, ni `IntersectionObserver`. Mirar `document.hidden` antes de creerle a una medición |

⚠️ **No editar los `.java` con scripts de Python.** Rompió literales de cadena tres veces en un día.
Usar edición directa.

⚠️ **Probar con el catálogo REAL, no con tres productos.** Los dos bugs de layout de arriba **no
aparecen con 12 productos y sí con 529**. Es la regla 50-bis aplicada al dibujo.

---

## 6. Mapa del código

**Nativo** (`web/android/app/src/main/java/com/launion/app/`):

| Archivo | Qué hace |
|---|---|
| `EnlaceLocalPlugin` | Celular: levanta el hotspot, pide el permiso de WiFi cercano, arranca el servidor |
| `ServidorLocal` | HTTP escrito a mano, 4 rutas. Se ata a la IP del hotspot (**no** a `0.0.0.0`), token en tiempo constante, `/foto/<id>` con lista blanca de caracteres |
| `EnlaceTabletPlugin` | Tablet: se une a la red (dos ramas por versión de Android), habla por socket crudo, guarda las fotos en `filesDir`, las poda y fija la pantalla |
| `EnlaceBluetoothPlugin` | El sobre de la red por RFCOMM. Solo ~120 bytes; el catálogo sigue por WiFi |
| `EscanerQrActivity` + `EscanerQrPlugin` | Cámara con CameraX + el decodificador de ZXing |

**Web** (`web/src/`):

| Archivo | Qué hace |
|---|---|
| `services/vidriera.js` | Lado celular. **`snapshotCatalogo` es la frontera de privacidad**; `sobreDe` es el formato único del QR y del Bluetooth |
| `services/vidrieraTablet.js` | Lado tablet. Sin un solo `fetch` |
| `services/vidrieraBluetooth.js` | El camino sin cámara |
| `services/data/espejoFotos.js` | El espejo de fotos del celular. **`idsEnEspejo` es lo que hace que `foto:true` no mienta** |
| `features/vidriera/useVidriera.js` | **Dueña de la sesión.** La usa `useJornada`, no la pestaña |
| `features/vidriera/EspejoTablet.jsx` | El QR, el aviso de fotos faltantes y el reintento |
| `features/vidriera/ParearTablet.jsx` | Emparejamiento: QR o Bluetooth, con sus pasos visibles |
| `features/vidriera/VidrieraTablet.jsx` | La grilla del cliente: buscador, filtros, cantidades, ficha grande, carrito espejo y reposo |
| `features/vidriera/PrepararCatalogo.jsx` | Baja las fotos al teléfono. **Se monta en `components/AppShell.jsx`**, solo para vendedor |
| `features/vendedor/tabs/VisitaCatalogo.jsx` | Consume `j.vid`. **No crea la sesión** |
| `features/vendedor/CarritoSheet.jsx` | El pedido abierto y editable |

---

## 7. Datos del entorno

- **Tablet de prueba**: `Cidea CM915`, serial `202410210004880`, adb por red en `192.168.18.74:5555`.
  Con `installerPackageName=com.launion.app`. Tiene el APK 1.18.0 (versionCode 36) instalado.
- **Celular de prueba**: motorola edge 30 neo, `ZY22G7DCNB`, API 34 (cuenta `cardixteam@gmail.com`).
  **Sin chip de datos** — mientras el hotspot está activo se queda sin internet. En los 9 del parque
  no pasa: tienen SIM.
  ⚠️ Ese equipo tiene **`bg_ok = false`** (sin permiso de ubicación en segundo plano). No afecta a la
  vidriera, pero **sí ensucia cualquier prueba de GPS** que se haga con él.
- **Catálogo**: 529 productos y 28 marcas de LA UNIÓN, de `LISTA 08-08 M.pdf`. Sin fotos, sin peso,
  sin categoría propia (la infiere la app) y **sin rentabilidad**.
- **Secuencia acordada**: el parque de tablets se configura recién con el MDM (Headwind) andando.
  Ponerlo en una PC obliga a re-inscribir, y re-inscribir es factory reset (HANDOFF §7.9).
