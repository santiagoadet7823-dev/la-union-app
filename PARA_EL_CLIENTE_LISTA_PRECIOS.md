# Envío automático de la lista de precios — qué necesitamos de ustedes

**29/08/2026 · para el equipo técnico de la distribuidora.**

Ya está todo listo de nuestro lado: el endpoint, la validación, los frenos de seguridad y los
scripts hechos para que el envío corra solo. Este documento es **lo único que falta para arrancar**,
y son dos cosas: cuatro respuestas y un orden de puesta en marcha.

---

## 1. 🔴 Cuatro respuestas que necesitamos antes de que exporten

Las cuatro condicionan trabajo, y la primera se lleva puestas 355 fotos.

### 1.1 ¿La lista a nivel unidad conserva los códigos actuales?

Es la más importante. Hoy hay **355 fotos de productos cargadas**, y lo único que conecta cada foto
con su producto es **el código**.

- Si `0011` sigue siendo `0011` (ahora como unidad en vez de fardo) → **la foto se conserva sola**.
- Si el producto pasa a tener un código nuevo → entra como producto nuevo, **queda sin foto**, y hay
  que volver a cargar las 355 a mano.

No es una preferencia nuestra: es la diferencia entre un catálogo con fotos y uno gris del lado del
comerciante.

### 1.2 ¿Pueden mandar la descripción completa?

El archivo de prueba que nos mandaron (`ARTIK.csv`) traía **407 de 541 descripciones cortadas a 20
caracteres** — `MANAOS 12X600ML COLA` sin el `FDO`, `PLACER 12X500ML ANAN` por `ANANA`. Parece un
ancho fijo de su sistema.

Ya lo tenemos cubierto: **el envío automático no pisa los nombres** de los productos que ya existen,
justamente para que esto no degrade el catálogo todos los días. Pero necesitamos saber si es un
límite del export o se puede levantar, porque **los productos NUEVOS sí se llevan el nombre cortado**
y después hay que corregirlos a mano.

### 1.3 La tabla de los 20 rubros

La columna 6 del archivo trae códigos `01`…`20`. Necesitamos la equivalencia (qué rubro es cada
número) para que las categorías entren con nombre y no con número.

### 1.4 Las columnas que hoy conviene NO mandar

Revisamos su archivo de prueba (`ARTIK.csv`) contra nuestro catálogo y hay tres columnas que, tal
como vienen hoy, **empeorarían los datos que ya tenemos**. No es un error de ustedes: es que esos
campos todavía no están cargados de su lado.

| Columna | Viene | Tenemos | Si la mandan |
|---|---|---|---|
| `unidades` | `1.00` en todas | 146 productos con las unidades reales (×12, ×15) | Los pisa a todos con 1 |
| `categoria` | `01`, `03`, `04` | 421 productos con el rubro en texto (Bebidas, Almacén) | Los reemplaza por números |
| `descripcion` | Cortada a 20 caracteres | Los nombres completos | La planilla manual sí los pisa |

**Mándenlas vacías hasta que tengan el dato bien.** Una celda vacía no toca nada: es justamente lo
que permite mandar sólo la lista de precios sin arrastrar el resto del maestro.

Con los descuentos por cantidad ya no hace falta hacer nada: **el sistema ahora entiende solo que un
cero no es un descuento** (ver §2, regla 5 de la especificación).

### 1.5 ¿En qué codificación exporta el sistema?

**UTF-8** es lo ideal. Si sólo exporta **Windows-1252 / Latin-1**, avísennos **antes**: se soporta,
pero hay que configurarlo. Si no, los acentos y las `Ñ` llegan rotos y nadie se entera hasta que un
vendedor lee la grilla.

### 1.6 Y una de logística

**¿A qué hora termina el proceso que genera el archivo?** El envío tiene que salir después. Si el
export a veces se estira, lo mejor es colgar el envío del final de ese proceso en vez de agendarlo a
una hora fija (está explicado en la guía, §5).

---

## 2. Lo que les mandamos

| Archivo | Qué es |
|---|---|
| **`ESPECIFICACION_LISTA_PRECIOS.md`** | Las columnas, los escalones de descuento, el endpoint y los códigos de respuesta. Es el documento para quien programe el export |
| **`GUIA_ENVIO_AUTOMATICO_PRECIOS.md`** | El paso a paso, que ahora son **tres pasos**: copiar la carpeta, comprobar el token y ejecutar el instalador. Incluye qué hacer con cada error y qué hacer si el servidor se apaga |
| **`plantilla-lista-precios.xlsx`** | La planilla con las 22 columnas y una hoja INSTRUCTIVO. Sirve para la carga manual y como referencia del formato |
| **`instalar.ps1`** | 🔴 **El instalador.** Clic derecho → Ejecutar con PowerShell y queda todo andando: elige el archivo con una ventana, hace un envío de prueba, programa el envío por hora y comprueba que funcione |
| **`revisar.ps1`** | Para saber en cualquier momento si sigue funcionando. No cambia nada: mira e informa, con un veredicto de una línea |
| **`enviar-precios.ps1`** + **`.bat`** | Los programitas que hacen el envío, en **PowerShell** (viene con Windows). Los usa el instalador; no hay que tocarlos |
| **`token.txt`** | 🔑 La llave, **ya cargada**. No hay que completar nada |
| **`EnviarPrecios.java`** | Opcional: por si prefieren llamarlo desde adentro del sistema de gestión en vez de agendar una tarea aparte |

🔑 **El token ya viene cargado en `token.txt`.** Del lado de ustedes no hay que completar nada.
🔴 **Pero eso vuelve sensible a toda la carpeta:** ese archivo identifica a la distribuidora, y quien
lo tenga puede reescribir el catálogo. No la copien a carpetas compartidas ni la reenvíen por chat.

---

## 3. El orden de la puesta en marcha

🔴 **El primer envío NO va por el camino automático**, y es a propósito.

El pasaje a unidades **reemplaza el catálogo entero**: los 529 productos que hoy están cargados como
fardo salen y entran las filas nuevas a nivel unidad. Eso es demasiado grande para que lo haga un
endpoint sin que nadie mire — de hecho **nuestro freno de seguridad lo va a rechazar a propósito**
(si un envío dejaría fuera más del 20 % del catálogo vigente, responde `409` y no escribe nada).

| # | Paso | Quién |
|---|---|---|
| 1 | Nos contestan las cuatro preguntas del §1 | Ustedes |
| 2 | Mandan un **archivo de prueba de 20 filas** | Ustedes |
| 3 | Lo cargamos a mano desde la app, **sin** tildar "lista completa", y revisamos que los precios y los escalones se vean bien | Nosotros |
| 4 | Mandan **la lista entera** | Ustedes |
| 5 | La cargamos a mano, tildando "lista completa vigente" y leyendo el conteo de bajas antes de confirmar | Nosotros |
| 6 | Ejecutan `instalar.ps1` en el servidor (el token ya viene adentro) | Ustedes |
| 7 | Verificamos al día siguiente que los envíos por hora entraron solos | Los dos |

---

## 4. Cómo va a funcionar una vez andando

**Un envío por hora, todos los días, las 24 horas.**

Lo programa el instalador solo. Manda **siempre**, aunque el archivo no haya cambiado: reenviar es
gratis y no rompe nada, y así cualquier precio que corrijan está arriba **como máximo una hora
después**, sin que nadie tenga que acordarse de nada.

⚠️ **Un envío sin cambios no le gasta datos a nadie**: nuestro sistema distingue "llegó una lista" de
"cambió el catálogo", y los teléfonos sólo se bajan el catálogo cuando de verdad cambió algo.

**Y la otra mitad, que ya está hecha:** desde la versión que publicamos ayer, el teléfono del
vendedor **va a buscar la lista nueva solo**, sin cerrar y abrir la app. Consulta una línea de datos
cada tanto —y cada vez que el vendedor abre la app, que es lo que hace en cada comercio— y sólo baja
el catálogo completo si de verdad cambió. En la práctica: ustedes mandan a las 11 y el vendedor ve
el precio nuevo en el comercio siguiente.

### Dos cosas que el envío automático NO hace

- **No da de baja productos.** Aunque un día el export salga incompleto, los productos que falten
  **no se dan de baja**: quedan como estaban. Las bajas se hacen a mano, mirando el número antes de
  confirmar.
- **No pisa las descripciones** de los productos que ya existen (§1.2).

### Cómo saber que sigue funcionando

- **De su lado:** `revisar.ps1` da un veredicto de una línea, y el script deja un registro por día
  con la respuesta de cada envío.
- **Del nuestro:** la pantalla de catálogo muestra *"Precios actualizados hace N horas · N filas"*, y
  se pone en ámbar si pasan más de 36 horas sin recibir nada.

---

## 5. Una columna nueva que quizás les sirva: `destacado`

Junto con esto agregamos un filtro en la app del vendedor que junta los productos que ustedes
quieran **empujar**: baja rotación, sobrestock, algo que se acerca al vencimiento, una marca nueva.
El vendedor los tiene **primero** en su pantalla y con un toque se los muestra grandes al comerciante.

Se marca de dos formas, la que les quede más cómoda:

- **A mano**, producto por producto, desde la app.
- **Desde esta misma lista**, con una columna `destacado` que diga `si` / `no`. Si su sistema ya
  tiene un campo de baja rotación o de liquidación, también aceptamos esos nombres de columna
  (`baja_rotacion`, `liquidar`, `liquidacion`, `empujar`).

**No cambia ningún precio** y **el comerciante no ve la etiqueta**: es una decisión interna de
ustedes. Y si la columna no viene en el archivo, los destacados marcados a mano **se conservan**.

Es opcional: si no la usan, no pasa nada.
