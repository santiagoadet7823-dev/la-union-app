# HANDOFF — VIDRIERA (tablet del cliente)

**Estado al 18/08/2026.** La vidriera **funciona de punta a punta en hardware real**: el celular
levanta la red, la tablet escanea el QR, se une y trae el catálogo de 529 productos. Lo que sigue
son mejoras y una decisión de producto, no arreglos para que arranque.

Publicado: **OTA + PWA 1.17.1** · en el árbol y **sin publicar**: **APK 1.18.0** (versionCode 36),
instalado a mano en la tablet de prueba. `min_version` **sigue en 1.13.0 a propósito** — el parque
no se toca hasta que esto salga a la calle.

> 🩸 **Lo nativo de 1.18.0 NO llega a nadie hasta que se suba `min_version`.** Eso incluye el
> arreglo de la notificación del GPS, que no es de la vidriera pero viaja en el mismo APK. Subir
> `min_version` reinstala los 9 equipos (misma firma, no pierden datos locales).

> Este documento es SOLO de la vidriera. Lo demás del proyecto sigue en
> [HANDOFF.md](HANDOFF.md) y [CLAUDE.md](CLAUDE.md).

---

## 1. Qué es y cómo se usa

El cliente explora el catálogo en una tablet mientras el vendedor toma el pedido en su celular. Cada
producto que el cliente toca —con la cantidad que quiere— le aparece al vendedor como un cartel con
el botón de sumarlo al carrito.

**🩸 La sesión NO vive en la ventana del QR** (cambio del 19/08). El vendedor puede cerrar esa
ventana y seguir usando su catálogo, ver el pedido y recibir los avisos de lo que el cliente toca —
la tablet sigue conectada. El enlace se corta **solo** con el botón *"Cerrar vidriera y desconectar
la tablet"* o al terminar/cancelar la visita. El chip "Vidriera" del header late en verde mientras
hay enlace vivo, que es la única señal de que sigue activo con la ventana cerrada.

**El camino en la app:**

1. Vendedor: **Inicio → check-in en un cliente** (el ✓ verde).
2. Salta a **Catálogo**, con la cabecera "VISITA EN CURSO". Ahí está el botón **Vidriera**.
3. Se abre el QR a pantalla completa.
4. Tablet: **"Soy una tablet · escanear código"** en el ingreso → *Escanear código*.
5. La tablet se une sola a la red y trae el catálogo.
6. El vendedor toca **Volver**: sigue en su catálogo, con el enlace vivo.

⚠️ **El check-in en un cliente SIN ubicación le asigna las coordenadas de donde estés** y te lo
reclama como propio (`reclamar_y_ubicar_cliente`). Para demostraciones, usar un comercio que ya
tenga ubicación — hay unos pocos; `BU AYELEN ACOSTA` (código 2788) es uno.

---

## 2. Las cuatro decisiones de arquitectura que no se re-discuten

1. **`LocalOnlyHotspot`, no Bluetooth ni WiFi Direct, para los DATOS.** El requisito es que la tablet
   no consuma datos, y esa red **no tiene salida a internet**: el cero es demostrable, no una
   promesa. (Ver §5 para el rol que sí tiene Bluetooth.)
2. 🩸 **El JS NUNCA hace `fetch` a la IP local.** La app se sirve desde `https://localhost` y el
   WebView bloquea el contenido mixto pase lo que pase en el manifest. El HTTP lo hace el nativo.
3. 🔴 **`nivel_rentabilidad` NO viaja, y se filtra en el ORIGEN.** `snapshotCatalogo`
   (`services/vidriera.js`) arma el payload **campo por campo** — nada de spread, que arrastraría
   cualquier columna futura (el costo). Lo que sí sobrevive es el **orden** de la vidriera,
   calculado en el celular y enviado ya resuelto: la tablet muestra el resultado sin conocer el
   criterio. Hay una prueba que lo verifica contra un producto con `costo_real` y `margen`.
4. **La tablet no se loguea nunca.** No toca Supabase, no tiene sesión ni GPS ni cuenta como
   dispositivo. Cero superficie de RLS y nada que revocar si se pierde. Por eso da igual que no se
   pueda crear una cuenta de Google en esas tablets.

---

## 3. El hardware, medido (no lo que dice el cartel)

**Tablet `Cidea CM915`** — **API 28 (Android 9)**, no 13: el `build.prop` está reescrito y el
framework instalado lo confirma (`versionCode=28`). RAM real **1.928 MB** (los "6 GB" son 2 GB +
1 GB de swap). WebView **Chrome 79**. CPU **armeabi-v7a (32 bits)**. Cámara con autofoco.

🩸 **API 28 no es un problema: es mejor.** Android **10** es donde quitaron que una app se conecte
sola a una WiFi. En API ≤28 la API vieja (`addNetwork`/`enableNetwork`) funciona **y sin el diálogo
del sistema**. Las dos ramas están escritas.

Verificar una tablet nueva: `bash scripts/diagnostico-tablet.sh` (acepta serial de USB o IP).

⚠️ **Riesgo abierto: memoria.** 2 GB con recolección de basura en cadena al arrancar. Con el catálogo
sin fotos anda bien; **con fotos hay que volver a medirlo**.

---

## 4. Lo que falta, por prioridad

> ## Qué se hizo el 18/08/2026
>
> Todo lo de §4 está **implementado y compilado**; lo que falta es **medirlo en la calle**.
>
> · **A (fotos)** — el mecanismo se arregló antes de probarlo, porque medía otra cosa: `foto: true`
>   salía de la URL de Storage y no del espejo del teléfono (la tablet pedía 529 fotos y cobraba
>   404); "Preparar catálogo" **era inalcanzable** (vivía en `PerfilTab.jsx`, que no lo monta nadie
>   — ahora cuelga del menú de cuenta); y la tablet guardaba en `cacheDir`, que Android borra bajo
>   presión de espacio. Falta la medición con fotos reales.
> · **B (Bluetooth)** — hecho. `EnlaceBluetoothPlugin` + botón "Buscar por Bluetooth".
>   **Verificado en la tablet real**: el botón aparece y contesta. Falta el pareo contra el celular.
> · **C-bis / C** — hechos: carrito espejo, ficha grande, reposo, "mirá este", "miró y no compró".
> · **D** — reintentar en `EspejoTablet` y fijado de pantalla, hechos. Varias tablets: sin probar.
>
> 🩸 Y un bug que la prueba con fotos iba a destapar: la pantalla de la tablet usaba `inset:0`, que
> recién existe desde **Chrome 87**; el WebView de esa tablet es **Chrome 79**. No se notó nunca
> porque el catálogo cargado no tiene imágenes.

### 🔴 A. Probar con fotos — es el único riesgo real que queda

El catálogo cargado (529 productos) **no tiene imágenes**, así que dos cosas están escritas y **sin
verificar**:

- Que las fotos **se bajen una sola vez**. El mecanismo: el archivo se guarda como
  `<producto>_<version>`, con la versión derivada de la URL (que ya cambia sola cuando marketing
  reemplaza una foto). "¿La tengo?" y "¿cambió?" son la misma pregunta.
- Que una tablet de **2 GB aguante** una grilla con ~20 MB de imágenes.

**Cómo probarlo**: cargar fotos a unos 30 productos desde la pantalla de marketing, abrir la
vidriera dos veces y confirmar que la segunda no vuelve a bajarlas. Después, el catálogo completo.

### 🟠 B. Bluetooth para VINCULAR (no para los datos)

El cliente lo pidió porque la cámara fallaba. **Achicar el QR (213 → 105 caracteres) redujo mucho el
problema — confirmado por el cliente el 19/08** —, así que esto bajó de necesario a cómodo.

El alcance correcto: Bluetooth pasa **solo el sobre con los datos de la red** (~120 bytes: SSID,
clave, IP, puerto, token). El catálogo y las fotos siguen por WiFi. Así se saca la cámara del camino
sin perder velocidad.

- Celular: `listenUsingInsecureRfcommWithServiceRecord` con un UUID propio (**inseguro = sin PIN**).
- Tablet: `getBondedDevices()` si están vinculados —instantáneo— o `startDiscovery()` si no.
- **Lo práctico: vincular tablet y celular UNA vez en el depósito.** Después cada visita es un toque.
- ⚠️ Permisos: `BLUETOOTH_CONNECT`/`BLUETOOTH_SCAN` son **de runtime** en Android 12+; en la tablet
  (API 28) alcanza con los normales más ubicación, que ya tiene. **Pedirlos desde el principio** —
  esta misma clase de error costó dos vueltas con `NEARBY_WIFI_DEVICES`.

### 🟢 C-bis. Hecho el 19/08 y sin verificar en la calle

- **Buscador y filtros en la tablet** (por nombre y marca; chips que alternan entre categorías y
  marcas). Pedido del cliente con la vidriera ya en uso: 529 productos en una grilla son
  imposibles de recorrer delante de un comerciante.
- **Cantidades desde la tablet** (stepper por tarjeta) → el cartel del celular dice "Sumar N".
- **El carrito se abre y se edita** (`CarritoSheet`) tocando la barra del pedido.
- **La sesión sobrevive al cierre de la ventana del QR** (ver §1).
- **QR de 213 → 105 caracteres + `TRY_HARDER`**. ✅ **El cliente confirmó menos problemas de
  escaneo**, que es lo que bajó a Bluetooth de necesario a cómodo.

### 🟡 C. Extras de la vidriera acordados y no hechos

- **Vidriera en reposo**: a los 30 s sin tocar, un carrusel de ofertas y destacados. El orden ya
  viene resuelto del celular, así que no hay que mandar el criterio de rentabilidad.
- **Carrito espejo**: que el cliente vea el pedido armándose y el total, como la pantalla de una caja.
  El canal `emitir()` (celular → tablet) ya existe y no tiene consumidor todavía.
- **"Miró y no compró"**: cada toque ya se registra en `mirados`. Falta mostrarlo al cerrar la visita
  como inteligencia comercial ("le mostraste 12, tocó 6, compró 2").
- **Ficha grande al tocar**: hoy el toque manda el aviso; falta abrir el producto a pantalla completa.
- **El vendedor empuja un producto a la tablet** ("mirá este"). El canal es bidireccional; son pocas
  líneas.

### ⚪ D. Menores

- `EspejoTablet` **no tiene botón de reintentar** en el estado de error: hay que cerrar la hoja y
  volver a abrirla.
- **Fijar la tablet dentro de la app** (screen pinning) para que el cliente no se salga a otra cosa.
  Android lo permite sin Device Owner; con Headwind (HANDOFF §7.9) sale gratis.
- **Varias tablets a la vez**: el servidor acepta N clientes; no está probado.

---

## 5. Trampas ya pagadas — leer antes de tocar el nativo

| Síntoma | Causa real |
|---|---|
| "Android bloqueó la creación de la red" | `NEARBY_WIFI_DEVICES` **es de runtime** desde Android 13. Un comentario mío en el manifest decía lo contrario. Verificar con `dumpsys package … \| grep NEARBY` |
| `cleartext HTTP traffic not permitted` | La política de cleartext **también aplica al nativo**, no solo al WebView. **No se prende `usesCleartextTraffic`** (habilita HTTP en toda la app, y por acá viajan GPS y datos de clientes): el cliente HTTP va sobre un `Socket` crudo, que no atraviesa esa política |
| El import de `ListenableFuture` no resuelve | CameraX declara Guava como `implementation` y Gradle no lo propaga. Y agregar `listenablefuture` **no alcanza**: Google publica una versión `9999.0` **vacía** que Gradle elige por número mayor. Se usa `LifecycleCameraController`, que no expone futuros |
| "Conecta pero no carga" | Falta `bindProcessToNetwork`. La red del hotspot no tiene internet y Android manda el tráfico por otro lado |
| El QR no se lee | Densidad. Ya se achicó de 213 a 105 caracteres y **el cliente confirmó la mejora**. Si vuelve a pasar, mirar el tamaño del payload antes que la cámara |
| El build dice verde y falló | El notificador de tareas reporta el exit del wrapper. **Vale el log, no el resumen** |

⚠️ **No editar los `.java` con scripts de Python.** Rompió literales de cadena tres veces en un día;
el compilador los caza pero cuesta vueltas. Usar edición directa.

---

## 6. Mapa del código

**Nativo** (`web/android/app/src/main/java/com/launion/app/`):

| Archivo | Qué hace |
|---|---|
| `EnlaceLocalPlugin` | Celular: levanta el hotspot, pide el permiso de WiFi cercano, arranca el servidor |
| `ServidorLocal` | HTTP escrito a mano, 4 rutas. Se ata a la IP del hotspot (**no** a `0.0.0.0`), token en tiempo constante, `/foto/<id>` con lista blanca de caracteres |
| `EnlaceTabletPlugin` | Tablet: se une a la red (dos ramas por versión de Android) y habla por socket crudo |
| `EscanerQrActivity` + `EscanerQrPlugin` | Cámara con CameraX + el decodificador de ZXing que ya estaba |

**Web** (`web/src/`):

| Archivo | Qué hace |
|---|---|
| `services/vidriera.js` | Lado celular. **`snapshotCatalogo` es la frontera de privacidad** |
| `services/vidrieraTablet.js` | Lado tablet. Sin un solo `fetch` |
| `features/vidriera/EspejoTablet.jsx` | El QR del vendedor + el cartel emergente |
| `features/vidriera/ParearTablet.jsx` | El emparejamiento, con sus cuatro pasos visibles |
| `features/vidriera/VidrieraTablet.jsx` | La grilla del cliente: buscador, filtros, cantidades |
| `features/vendedor/CarritoSheet.jsx` | El pedido abierto y editable |
| `scripts/extraer-lista-precios.py` | La lista de precios en PDF → filas importables |

---

## 7. Datos del entorno

- **Tablet de prueba**: `Cidea CM915`, serial `202410210004880`, adb por red en `192.168.18.74:5555`.
  Con `installerPackageName=com.launion.app` (instalada con `-i`), así la próxima se actualiza sola.
- **Celular de prueba**: motorola edge 30 neo, `ZY22G7DCNB`, API 34. **Sin chip de datos** — mientras
  el hotspot está activo se queda sin internet. En los 9 del parque no pasa: tienen SIM.
- **Catálogo**: 529 productos y 28 marcas de LA UNIÓN, de `LISTA 08-08 M.pdf`. Sin fotos, sin peso,
  sin categoría propia (la infiere la app) y **sin rentabilidad**.
- **Secuencia acordada**: el parque de tablets se configura recién con el MDM (Headwind) andando.
  Ponerlo en una PC obliga a re-inscribir, y re-inscribir es factory reset (HANDOFF §7.9).
