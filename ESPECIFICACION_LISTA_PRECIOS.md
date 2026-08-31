# Especificación — Lista de precios y catálogo

**Versión 4 — 31/08/2026.** Cambia cómo se interpretan las columnas de descuento vacías o en cero
(§2, regla 5) — es importante y les simplifica el export. Suma la columna `destacado` (§1) y la
sección **4-bis: cuándo se envía**. Todo lo demás de la versión 2 sigue igual: las
columnas anteriores, el separador y el endpoint **no cambiaron**, así que lo que ya esté programado
sigue funcionando sin tocar una línea.

**Para el equipo técnico de la distribuidora**, quien programe la exportación desde el sistema de
gestión. Va acompañado de la planilla `plantilla-lista-precios.xlsx`, que trae los mismos campos y
filas de ejemplo.

---

## ⚠️ Qué cambió respecto de la versión 1

**Todo pasa a UNIDAD.** No hay más filas de fardo ni de caja cerrada.

La versión 1 decía que las cantidades de los descuentos se contaban en la unidad de facturación de
cada fila (para un fardo de 6×3L, `desde_1 = 6` eran 6 fardos). **Eso ya no es así.** Ahora:

- **Cada fila del catálogo es una unidad suelta**: una botella, un pote, un paquete.
- `precio` es el precio de **esa unidad**.
- `desde_N` se cuenta **siempre en unidades**. Un fardo de 6 son `6`; diez fardos son `60`.
- El primer envío **reemplaza el catálogo entero** (ver §3).

Si ya empezaron a programar con la versión 1, **esto es lo único que hay que rehacer**: las columnas,
el separador y el endpoint no cambiaron.

### 🔴 Una pregunta que necesitamos respondida antes de que exporten

**¿La lista a nivel unidad conserva los códigos actuales, o trae códigos nuevos?**

Las **355 fotos** que ya están cargadas se conectan con el producto **por el código**. Entonces:

- Si `0011` sigue siendo `0011` (ahora como unidad en vez de fardo) → **la foto se conserva sola**.
- Si el producto pasa a tener un código nuevo → entra como producto nuevo y **queda sin foto**, y
  hay que volver a cargar las 355 imágenes a mano.

No es una preferencia nuestra: es la diferencia entre un catálogo con fotos y uno gris. Avísennos
cuál de los dos casos es.

---

Hay **dos caminos** para actualizar el catálogo, y usan **exactamente las mismas columnas**:

| Camino | Quién lo hace | Cuándo conviene |
|---|---|---|
| **A. Planilla Excel** | Una persona, desde la app | Correcciones puntuales, o mientras se termina de programar el automático |
| **B. Envío automático** | El servidor de gestión | La actualización de todos los días |

Se puede empezar por A y pasar a B después, sin cambiar una sola columna.

---

## 1. Las columnas

```
codigo   descripcion   precio   peso   unidades   categoria   marca   unidad_venta
nivel   oferta   precio_oferta   destacado
desde_1  precio_1   desde_2  precio_2   desde_3  precio_3   desde_4  precio_4   desde_5  precio_5
```

| Columna | Tipo | Qué es |
|---|---|---|
| `codigo` | texto | Código del producto en el sistema de gestión. **Es la llave**: si ya existe, actualiza ese producto; si no existe, crea uno nuevo |
| `descripcion` | texto | Nombre del producto. Obligatorio sólo cuando es un alta |
| `precio` | número | **Precio de UNA unidad**, sin descuento por cantidad |
| `peso` | número | Kilos de **una unidad** |
| `unidades` | entero | Cuántas unidades trae el bulto en que viene de fábrica (el `6` de un fardo de 6×3L). Es **informativo**: sirve para que el vendedor sepa que un fardo son 6, pero **no cambia ningún precio** |
| `categoria` | texto | Rubro. Si viene vacía, se infiere de la descripción |
| `marca` | texto | Marca o proveedor |
| `unidad_venta` | texto | Cómo se nombra la unidad: `UN` · `BOT` · `PACK`. **Ya no se usan `FDO` ni `CJ`**: el fardo dejó de ser una fila y pasó a ser un escalón de descuento |
| `nivel` | 1–4 | Rentabilidad. **Uso interno**: el vendedor ve un color, nunca el número, y el comerciante no lo ve nunca |
| `oferta` | `si`/`no` | Producto en promoción |
| `precio_oferta` | número | Precio promocional |
| `destacado` | `si`/`no` | **Nuevo.** Producto que quieren empujar: baja rotación, sobrestock, algo por vencer. El vendedor los tiene juntos en un filtro propio, primero en la pantalla, y desde ahí se los muestra al comerciante en la tablet. **No cambia ningún precio** — ver §2-bis |
| `desde_1` … `desde_5` | entero | **Cantidad mínima** a partir de la cual aplica ese escalón |
| `precio_1` … `precio_5` | número | **Precio de UNA unidad** a partir de esa cantidad |

### Reglas generales

- **Una celda vacía no borra nada.** Se puede enviar un archivo con sólo `codigo` y los precios: no
  se pierde la foto, ni la categoría, ni la marca que ese producto ya tenía. Es deliberado, y es lo
  que permite mandar sólo la lista de precios sin arrastrar el resto del maestro.
- El cruce por `codigo` **ignora los ceros de la izquierda**: `0041` y `41` son el mismo producto.
- Los códigos repetidos dentro del mismo archivo se descartan (queda el primero) y se informan.
- La **foto no va en este archivo**. Va aparte — ver §5.

---

## 2. Los escalones de descuento

Hasta **5 pares**. Cada par dice: *"comprando `desde_N` o más, cada uno sale `precio_N`"*.

1. `desde_N` es **entero** y tiene que ser **estrictamente creciente**: `desde_2 > desde_1`.
2. `precio_N` es el **precio de UNO**, no el total del combo.
3. Si no se usan los 5, se dejan vacíos los pares que sobran. Se puede usar 1, 2 o 3.
4. Producto sin descuentos por cantidad: todas las columnas `desde_*` y `precio_*` vacías.
5. **Un `0` en `desde_N` significa "este tramo no se usa".** Pueden mandar las columnas que sobran
   en cero sin ningún problema: no se interpretan como un descuento, y **no borran nada**.
   Un producto sin descuentos se manda con las seis columnas en cero, o vacías, como les resulte más
   fácil de exportar.
6. Si viene `desde_N` sin su `precio_N` (o al revés), ese escalón se ignora, **el resto de la fila
   entra igual**, y se informa en la respuesta.

### 🔴 Cómo se saca un descuento que ya no existe

Ésta es la parte que cambió respecto de la versión anterior, y conviene entenderla porque protege el
catálogo:

**Mientras el archivo no traiga NINGÚN descuento, no se borra ningún descuento.** Si las seis
columnas vienen en cero en las 541 filas, el sistema entiende que su export todavía no maneja
descuentos por cantidad, y deja intactos los que estén cargados de nuestro lado.

**En cuanto alguna fila traiga un descuento real, el archivo pasa a mandar.** Ahí una fila con
`desde_1 = 0` significa "este producto no tiene descuento" y se le quita el que tuviera.

Dicho de otro modo: **el archivo tiene que demostrar que sabe hablar de descuentos antes de que se le
permita borrarlos.** Es a propósito. Un export que sale con ceros por configuración —lo más normal
del mundo en un sistema de gestión— no puede vaciarle los descuentos al catálogo sin que nadie se
entere.

> Antes de esta versión, `desde_1 = 0` borraba siempre. Con el envío corriendo cada hora, eso
> significaba que un descuento cargado a las 10:05 desaparecía a las 11:00. Lo detectamos revisando
> su primer archivo, antes de que pasara.

### Ejemplo

```
codigo	descripcion	precio	unidades	unidad_venta	destacado	desde_1	precio_1	desde_2	precio_2	desde_3	precio_3
0011	MANAOS COLA 3LT	1850	6	UN	no	6	1750	60	1690	300	1620
0010	MERM DULCOR 500G DURAZNO	1450	12	UN	no	12	1380	48	1290
0048	CAFE COÑAC TRES PLU 200ML	1990		UN	si
```

Se lee así:

| Producto | Cantidad (en unidades) | Precio de cada una |
|---|---|---|
| `0011` | 1 a 5 botellas | $1.850 |
| | 6 a 59 (de un fardo en adelante) | $1.750 |
| | 60 a 299 (de diez fardos en adelante) | $1.690 |
| | 300 o más | $1.620 |
| `0010` | 1 a 11 · 12 a 47 · 48 o más | $1.450 · $1.380 · $1.290 |
| `0048` | cualquiera | $1.990 (precio único) |

Nótese que en `0011` la columna `unidades` dice `6`: eso le informa al vendedor que el fardo trae 6.
**No cambia ningún precio** — quien decide el precio es el escalón.

### 🔴 En qué unidad se cuenta `desde_N`

**Siempre en unidades sueltas. Nunca en fardos ni en cajas.**

Un fardo de 6 se expresa como `desde = 6`. Diez fardos, como `desde = 60`. Es exactamente lo que se
dijo en la reunión: *"si compra 10 fardos serían X unidades"*.

> **La consecuencia práctica**: si su sistema hoy tiene el fardo como un artículo con su propio
> código, esa fila **no va** en esta lista. Va la botella, con su precio unitario, y el fardo pasa a
> ser el primer escalón. Un producto = una unidad = una fila.

## 2-bis. La columna `destacado` — qué es y qué no

`destacado = si` junta ese producto en un **filtro propio del vendedor**, que aparece **primero** en
su pantalla. Tocándolo se le abre grande al comerciante (en la tablet si la están usando, y si no en
el celular del vendedor, que se lo da vuelta).

Es para lo que **no se vende solo**: baja rotación, sobrestock, algo que se acerca al vencimiento,
una marca nueva que hay que instalar.

| | |
|---|---|
| ✅ **No cambia ningún precio** | Un destacado puede estar a precio de lista. La apuesta es que el comerciante lo VEA, no que se lo regalen |
| ✅ **Se combina con oferta y con escalones** | Se pueden usar los tres juntos, o el destacado solo |
| ✅ **Una celda vacía no lo toca** | Si la lista de todos los días no trae esta columna, los destacados marcados se conservan. Sólo cambian los que vengan con `si` o con `no` explícito |
| ❌ **El comerciante no ve la etiqueta** | En la tablet el producto se ve como cualquier otro. "Destacado" es una decisión interna de ustedes y no se muestra del otro lado |

También se puede marcar **a mano**, producto por producto, desde la app (*Catálogo → editar
producto → Destacado*). Los dos caminos escriben lo mismo: usen el que les quede más cómodo.

> **Nombres de columna que también se aceptan** para esta misma cosa, por si su sistema ya la llama
> de otra manera: `destacado`, `destacar`, `baja_rotacion`, `liquidar`, `liquidacion`, `empujar`.

---

### Y si de verdad hay algo que sólo se vende cerrado

Si existe un producto que **no se puede vender suelto** (se vende únicamente por caja), mándenlo como
una unidad igual —"caja de 12"— con su precio de caja, y los escalones contados en cajas. Es una
excepción, no la regla: avísennos cuáles son para tenerlos identificados.

### Un producto en oferta que además tiene escalones

Se aplica **el más bajo de los dos**. La regla que no se puede romper es que el comerciante nunca
pague más de lo que le mostró la pantalla. Si se prefiere que la oferta pise siempre a los escalones,
avisar — es un cambio de un renglón, pero conviene decidirlo ahora.

---

## 3. Camino A — Planilla Excel

Se usa `plantilla-lista-precios.xlsx`. Se carga desde la app en **Catálogo → Importar planilla**.

Antes de escribir nada, la pantalla muestra el resumen: cuántas filas crean producto, cuántas
actualizan y cuántas se saltan. **Hay que leerlo.**

⚠️ La opción **"Esta planilla es la lista completa vigente"** da de baja todo producto que no venga
en el archivo. Se tilda sólo cuando se sube la lista entera; nunca para corregir unos pocos precios.
El número de bajas se muestra **antes** de confirmar.

### 🔴 El primer envío va por este camino, no por el automático

El pasaje a unidades **reemplaza el catálogo entero**: los 529 productos que hoy están cargados como
fardo salen, y entran las filas nuevas a nivel unidad. Eso es exactamente lo que la opción de arriba
hace, y es demasiado grande para que lo haga un endpoint sin que nadie mire.

**Entonces: la primera carga se hace a mano, desde la app, leyendo el resumen antes de confirmar.**
El envío automático (§4) queda para las actualizaciones de precio de todos los días, que son las que
no dan de baja nada.

Conviene hacerlo en dos pasos: primero subir un archivo de prueba con **20 filas sin tildar** la
opción de lista completa, revisar que los precios y los escalones se vean bien en la app, y recién
después subir la lista entera.

---

## 4. Camino B — Envío automático

### El request

```
POST https://lqhtxivednffpiicnbog.supabase.co/functions/v1/ingest-precios
Authorization: Bearer <TOKEN>
Content-Type: text/csv; charset=utf-8

codigo	descripcion	precio	...	desde_1	precio_1	...
0011	MANAOS COLA 3LT	1850	...	6	1750	...
```

El `TOKEN` se entrega aparte, por un canal privado. **El token identifica a la distribuidora**: no
hace falta —ni se acepta— mandar un identificador de empresa dentro del archivo.

Para reemplazar la lista completa (dar de baja lo que no venga en el archivo) se agrega
`?lista_completa=1` a la URL. Leer antes el freno de más abajo.

También se acepta `Content-Type: application/json` con los mismos nombres de campo, si resulta más
natural desde Java:

```json
{ "filas": [ { "codigo": "0011", "precio": 1850, "desde_1": 6, "precio_1": 1750 } ] }
```

### El formato del cuerpo

| Qué | Regla |
|---|---|
| **Separador** | **TABULADOR** preferido. También se acepta `;` o `,` — se detecta solo |
| **Codificación** | **UTF-8**, con o sin BOM. Si el sistema sólo exporta **Windows-1252 / Latin-1**, avisar antes: se soporta, pero hay que configurarlo, o los acentos y las `Ñ` llegan rotos y nadie se entera |
| **Decimales** | Punto o coma: `1450.50` o `1450,50` |
| **Separador de miles** | **Nunca.** `1.450` es ambiguo (¿1450 o 1,45?) y esa fila se **rechaza**: el sistema no adivina un precio |
| **Primera fila** | Los encabezados. El orden no importa; mayúsculas y acentos son indistintos |
| **Fin de línea** | `CRLF` o `LF`, cualquiera |
| **Tamaño** | Hasta 5.000 filas por envío |

### La respuesta

`200 OK` con el resumen. **Conviene loguearlo**: es la única forma de saber que la lista entró.

```json
{
  "recibidas": 529,
  "creados": 3,
  "actualizados": 511,
  "sin_cambio": 12,
  "rechazadas": [
    { "fila": 47, "codigo": "0212", "motivo": "precio ambiguo: \"1.450\"" },
    { "fila": 88, "codigo": "0390", "motivo": "desde_2 (5) no es mayor que desde_1 (10)" }
  ]
}
```

| Código | Qué significa |
|---|---|
| `200` | Procesado. Puede haber filas rechazadas — mirar `rechazadas` |
| `400` | El archivo no se pudo interpretar (faltan encabezados, cuerpo vacío) |
| `401` | Token inválido o revocado |
| `409` | Freno de seguridad — ver abajo |
| `413` | Más de 5.000 filas |

### 🔴 El freno de seguridad

Enviar la lista **no da de baja** ningún producto. Para eso hay que pedirlo explícitamente
(`?lista_completa=1`), y **aun así**: si el archivo dejaría fuera más del **20 %** del catálogo
vigente, la respuesta es `409`, **no se escribe nada**, y hay que revisarlo a mano.

Existe porque un export parcial —un martes a la mañana, por un filtro mal aplicado— daría de baja el
catálogo entero sin que nadie lo note hasta que un vendedor abre la app frente a un comercio.

### Reintentos

El envío es **idempotente**: mandar dos veces el mismo archivo deja el catálogo igual. Si el request
falla por red, se puede reintentar sin riesgo.

---

## 4-bis. Cuándo se envía

**No hace falta que nadie toque nada, ni configurar nada a mano: les pasamos un instalador.** Se
ejecuta una vez, elige el archivo con una ventana —sin escribir rutas— y deja programado el envío
**una vez por hora**.

Todo está en **PowerShell**, que viene instalado en Windows: no hay que descargar nada. También va un
ejemplo en Java para llamarlo desde adentro del sistema de gestión. El paso a paso está en la guía de
instalación.

### La cadencia: una vez por hora, todos los días

| | |
|---|---|
| **Cada** | **1 hora**, las 24 horas, todos los días |
| **Manda** | **Siempre**, aunque el archivo no haya cambiado desde el envío anterior |
| **Reintentos** | A los 5 y a los 10 minutos ante error de red o `5xx`. Si igual falla, la próxima corrida es en una hora: no hay nada que rescatar |
| **`?lista_completa=1`** | 🔴 **Nunca en el envío automático.** Sin ese parámetro el envío **no da de baja nada**, que es lo que se quiere de algo que corre solo. Las bajas se hacen a mano desde la app |
| **Si el export se atrasa** | Mejor todavía: llamar al envío **al terminar** el proceso que genera el archivo, en vez de esperar a la hora (§5 de la guía) |

**Por qué cada hora y no tres veces por día.** Ustedes corrigen precios a media mañana y a la tarde, y
no siempre a la misma hora. Con el envío por hora, cualquier precio que cambien está arriba **como
máximo 60 minutos después**, sin que nadie tenga que acordarse de nada.

**Por qué manda aunque no haya cambiado.** Reenviar es gratis y es seguro: el endpoint es idempotente
—si llega dos veces lo mismo, el catálogo queda igual— y así no hay ninguna situación en la que un
cambio se pierda por una comparación mal hecha. El envío igual **detecta** si el archivo cambió y lo
anota en el registro, para que se pueda leer de un vistazo:

```
Archivo NUEVO (cambio desde el envio anterior).
El archivo NO cambio desde el envio anterior. Se manda igual.
```

⚠️ **Y un envío sin cambios no le cuesta datos a nadie.** Nuestro sistema distingue "llegó una lista"
de "cambió el catálogo": si las 541 filas vienen iguales, la respuesta dice `actualizados: 0` y **los
teléfonos ni se enteran**. Sólo se bajan el catálogo cuando de verdad cambió algo.

### Cómo llega al teléfono que ya está en la calle

Esto es la otra mitad, y sin ella los tres horarios no servirían de nada.

Hasta ahora la app cargaba el catálogo **una sola vez, al abrirse**. Desde esta versión, el teléfono
pregunta cada tanto —y cada vez que el vendedor vuelve a abrir la app, que es lo que hace en cada
comercio— si entró una lista nueva. La pregunta es **una línea de datos**; sólo si la lista cambió
se baja el catálogo completo. Así el precio nuevo llega en minutos sin gastarle los datos móviles al
vendedor.

**En la práctica:** ustedes mandan a las 11:00, y el vendedor ve el precio nuevo la próxima vez que
abre la app — normalmente, en el comercio siguiente.

⚠️ **Requiere que los teléfonos estén en la versión 1.22.0 o superior.** Con una versión anterior el
envío entra igual en el sistema, pero ese teléfono sigue mostrando la lista con la que arrancó el
día hasta que se cierre y se vuelva a abrir la app.

### Cómo saber que entró

Del lado de ustedes: **el script guarda la respuesta del servidor en un archivo de registro**, uno
por día, con las tres corridas. Ahí está el resumen (`recibidas`, `actualizados`, `rechazadas`) y
cualquier error.

Del nuestro: la app muestra en la pantalla de catálogo un renglón que dice **"Precios actualizados
hace N horas · N filas"**, y se pone en **ámbar si pasaron más de 36 horas** sin recibir una lista.
Es la forma de que un envío que dejó de correr se note el mismo día, y no cuando un vendedor cobra
un precio viejo frente a un comercio.

---

## 5. Las fotos de los productos

**No van en este archivo.** Se cargan por separado desde la app (*Catálogo → Cargar fotos*), y lo
único que las conecta con el producto es **el nombre del archivo, que tiene que ser el código**.

> 🔴 **Por eso importa la pregunta del principio.** Hoy hay **355 fotos** cargadas, guardadas contra
> el código del producto. Si la lista a nivel unidad conserva los códigos, esas 355 se conservan
> solas. Si trae códigos nuevos, hay que volver a cargarlas todas a mano — y hasta que eso pase, el
> catálogo que ve el comerciante en la tablet se ve **gris, sin imágenes**.

| ✅ Bien | ❌ Mal |
|---|---|
| `0041.png` | `manaos cola.png` |
| `41.png` (los ceros de adelante se ignoran) | `0041 manaos.png` · `0041 (1).png` · `IMG_2026.png` |

Requisitos de la imagen:

- **Cuadrada, 1:1** — 1024 × 1024 px (mínimo 800 × 800). La app la reduce, nunca la agranda.
- **PNG, JPG o WEBP.** El peso no importa: se comprime al subirla.
- **Fondo blanco liso**, producto centrado ocupando ~80 % del cuadro.
- **Sin texto encima** (ni el nombre, ni el precio, ni "OFERTA"): el precio cambia y la foto queda
  mintiendo. Sin marcos, sin collages, sin fondos de escena.
- Si el producto se vende por fardo, fotografiar **el envase individual**, no el bulto envuelto.

El detalle completo, con el prompt para generar imágenes y la lista de errores frecuentes, está en
`GUIA_MARKETING_CATALOGO.md`.

---

## 6. Checklist antes del primer envío

**Lo que necesitamos que nos respondan:**

- [ ] 🔴 **¿La lista a nivel unidad conserva los códigos actuales o trae códigos nuevos?** (arriba) —
      de esto dependen las 355 fotos ya cargadas
- [ ] ¿Hay productos que **sólo** se venden cerrados? ¿Cuáles? (§2)
- [ ] ¿Qué gana cuando un producto está en oferta **y** tiene escalones? Nosotros aplicamos el más
      bajo de los dos (§2)
- [ ] ¿La exportación sale en UTF-8 o en Windows-1252 / Latin-1? (§4)

**Lo que hay que verificar del lado de ustedes:**

- [ ] Cada fila es **una unidad suelta**, no un fardo ni una caja (§2)
- [ ] `desde_N` va contado **en unidades** (§2)
- [ ] El export **no** pone separador de miles (§4)
- [ ] El sistema loguea la respuesta de cada envío (§4)

**El orden de la puesta en marcha:**

- [ ] 1. Archivo de prueba de **20 filas**, cargado a mano desde la app, **sin** tildar "lista
      completa vigente" (§3)
- [ ] 2. Revisar en la app que los precios y los escalones se vean bien
- [ ] 3. La lista entera, a mano, tildando "lista completa vigente" y leyendo el conteo de bajas
- [ ] 4. Recién ahí, el envío automático (§4 y §4-bis), agendado a las **06:00, 11:00 y 16:00**
