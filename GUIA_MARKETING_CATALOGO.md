# Guía de Marketing — Catálogo

**Para la persona a cargo del catálogo de la distribuidora.** Precios, fotos, productos y códigos.

Todo lo que dice esta guía sale del código real de la app, no de una preferencia estética. Cuando
dice "tiene que ser así", es porque de otra forma **se ve mal en el teléfono del vendedor** o **no
entra en la base**.

---

## 1. Cómo tienen que ser las FOTOS

Esta es la parte más importante y la que más fácil se hace mal. Leela una vez entera antes de
generar la primera imagen.

### La regla de oro: **cuadrada**

La tarjeta del catálogo que ve el vendedor tiene la foto en un **cuadrado**. Si la imagen no es
cuadrada, la app la centra sobre un fondo blanco — pero el producto queda más chico, con bandas al
costado, y el catálogo se ve desparejo. **Una foto cuadrada llena la tarjeta y se ve perfecta.**

> ⚠️ Los generadores de imágenes por IA producen imágenes **verticales por defecto**
> (1024 × 1536). Hay que pedirles el cuadrado explícitamente.

### La tabla completa

| Qué | Cómo tiene que ser | Por qué |
|---|---|---|
| **Proporción** | **1:1 — cuadrada** | La tarjeta es cuadrada. |
| **Tamaño** | **1024 × 1024 px** (mínimo 800 × 800) | La app reduce a 800 px y **nunca agranda**: una imagen de 400 px se ve borrosa en los teléfonos nuevos. |
| **Formato** | **PNG** (también sirven JPG y WEBP) | Son los tres que acepta la app. Después ella sola la convierte y la comprime. |
| **Fondo** | **Blanco liso** | El catálogo se ve limpio y parejo. Además, un fondo transparente en un teléfono viejo puede terminar **negro**. |
| **El producto** | **Centrado**, ocupando **~80 %** del cuadro, con aire parejo en los 4 lados | Sin aire, el producto queda pegado a los bordes de la tarjeta. |
| **Nombre del archivo** | **El código del producto** + la extensión → `0041.png` | Es así como la app sabe a qué producto va cada foto. |
| **Peso del archivo** | No importa | La app la comprime antes de subirla (queda en ~20-90 KB). |

### Lo que NO va en la foto

- ❌ **Texto de cualquier tipo** — nombre, precio, "OFERTA", "NUEVO". El precio cambia y la foto queda mintiendo.
- ❌ **Logos agregados** encima o al costado (el logo que ya trae el envase del producto, obviamente sí).
- ❌ **Marcos, bordes o esquinas redondeadas** — la tarjeta ya tiene las suyas.
- ❌ **Varios productos en una sola imagen** (collages). Una foto = un código.
- ❌ **Sombras largas o reflejos que toquen el borde** — al reducir la imagen se ven sucios.
- ❌ **Fondos de escena** (una heladera, una mesa, un almacén). Fondo blanco liso.

### El prompt para el generador de imágenes

Copiá esto y cambiá solo la primera parte por la descripción del producto:

```
Product photo of <descripción del producto>, centered, front view,
on a pure white background, studio lighting, soft shadow under the product,
no text, no logos, no props, square 1:1 image, 1024x1024,
product occupies about 80% of the frame with even margins on all four sides.
```

Ejemplo real, para el código `0041` (`MANAOS 12X600ML COLA FDO`):

```
Product photo of a 600ml plastic bottle of cola soft drink, centered, front view,
on a pure white background, studio lighting, soft shadow under the product,
no text, no logos, no props, square 1:1 image, 1024x1024,
product occupies about 80% of the frame with even margins on all four sides.
```

> 💡 Si el producto se vende por fardo o por caja, **fotografiá el envase individual**, no el bulto.
> El vendedor reconoce la botella, no el fardo envuelto en film.

### El nombre del archivo

Es lo único que conecta la foto con el producto. **El nombre del archivo es el código, y nada más.**

| ✅ Bien | ❌ Mal | Por qué |
|---|---|---|
| `0041.png` | `manaos cola.png` | La app busca por código, no por nombre. |
| `0041.png` | `0041 manaos.png` | Todo lo que no sea el código sobra. |
| `0041.png` | `0041 (1).png`    | El `(1)` que agrega Windows al descargar dos veces rompe el nombre. |
| `0041.png` | `IMG_20260812.png`| Es el nombre que pone la cámara. Hay que renombrarlo. |

`0041.png` y `41.png` funcionan los dos: la app ignora los ceros de adelante. Pero **usá el código
tal como figura en la lista de precios** (con los ceros), así lo podés copiar y pegar sin pensar.

### El paso a paso

1. Abrí el catálogo en la app y usá el filtro **"Sin foto"** para ver qué falta.
2. Anotá los códigos y las descripciones (o bajá la planilla con **"Descargar planilla"**).
3. Generá las imágenes con el prompt de arriba.
4. **Renombrá cada archivo con su código.**
5. En la app: **Cargar fotos** → *Elegir fotos* (o *Elegir carpeta*, solo en la computadora).
6. **Mirá la tabla de pareo antes de subir.** Cada archivo muestra a qué producto va a ir:
   - `Listo` → va a subir.
   - `Ya tiene foto` → no sube, salvo que tildes *"Reemplazar…"*.
   - `Sin producto` → **ese código no existe en el catálogo**. Revisá el nombre del archivo.
   - `Código repetido` → dos archivos con el mismo código en la misma tanda.
7. Tocá **Subir** y esperá a que termine la barra.

### Checklist de 4 puntos, antes de subir

- [ ] ¿Es **cuadrada**?
- [ ] ¿El fondo es **blanco**?
- [ ] ¿El archivo se llama **igual que el código**?
- [ ] ¿**No tiene texto** ni precio encima?

---

## 2. Los PRECIOS y la planilla

La lista de precios del sistema (el PDF que llega como `LISTA <fecha> M.pdf`) se convierte en una
planilla y se importa. **No hay que cargar 500 precios a mano.**

### Columnas que entiende la planilla

`codigo` · `descripcion` · `precio` · `peso` · `unidades` · `categoria` · `marca` ·
`unidad_venta` · `nivel` · `oferta` · `precio_oferta` ·
`desde_1`/`precio_1` … `desde_5`/`precio_5`

Solo **`descripcion`** es obligatoria. Los encabezados admiten variantes (`cod`, `sku`, `nombre`,
`rubro`, `precio unitario`…), con o sin mayúsculas y acentos.

### Los DESCUENTOS POR CANTIDAD (desde el 27/08/2026)

Los cinco pares del final son la escala de precios por volumen: *"comprando `desde_N` o más, cada
unidad sale `precio_N`"*.

| Regla | |
|---|---|
| **La cantidad va en unidades sueltas** | Un fardo de 6 se escribe `6`. Diez fardos, `60`. Nunca en fardos ni en cajas |
| **El precio es el de UNA unidad** | No el total del combo |
| **Tiene que ir en aumento** | `desde_2` mayor que `desde_1`, y así |
| **Se pueden usar menos de 5** | Los pares que sobran se dejan vacíos |
| **Para BORRAR la escala** de un producto | `desde_1 = 0` |

Ejemplo, con el precio base en 1.850:

```
codigo   descripcion       precio   desde_1  precio_1   desde_2  precio_2
0011     MANAOS COLA 3LT   1850     6        1750       60       1690
```

Se lee: 1 a 5 unidades → $1.850 · 6 a 59 → $1.750 · 60 o más → $1.690.

El vendedor ve la escalera en la tarjeta del producto y el ahorro en el carrito; el comerciante la
ve en la tablet. **La rentabilidad (`nivel`) sigue sin viajar a la tablet** — eso no cambió.

> Si un producto está en oferta **y** además tiene escala, se cobra **el más barato de los dos**.

### ⚠️ Los decimales: punto o coma, pero SIN separador de miles

`1450,50` y `1450.50` se entienden los dos. **`1.450` no**: puede ser mil cuatrocientos cincuenta o
uno coma cuarenta y cinco, y la app no lo adivina — marca la celda con un ⚠ en la previsualización y
no la importa. Es a propósito: un precio inventado en el catálogo no se descubre hasta que un
vendedor cobra mal.

Antes de confirmar, la pantalla muestra una columna **Descuentos** con la escala de cada fila, y un
cartel con cuántas filas tienen algo que se va a ignorar. **Leelos.**

### Cómo funciona la importación

- **Se cruza por `codigo`.** Si el código ya existe → **actualiza** ese producto. Si no existe →
  **crea** uno nuevo.
- **La actualización es PARCIAL: una celda vacía no borra lo que el producto ya tenía.** Podés subir
  una planilla con solo `codigo` y `precio` y no se pierde ni una foto ni una categoría.
- **La foto NO va en la planilla.** Vive aparte (§1).
- Antes de confirmar, la pantalla muestra el resumen: cuántas filas actualizan, cuántas crean y
  cuántas se saltan. **Leelo siempre.**

### ⚠️ La opción "Esta planilla es la lista completa vigente"

Cuando la tildás, **todo producto que no venga en la planilla se da de baja** (deja de verse en el
catálogo del vendedor, pero conserva su foto y su código, y vuelve solo si reaparece en una lista
futura).

- ✅ **Tildala** cuando estás subiendo la lista de precios entera del sistema.
- ❌ **No la tildes** cuando subís una planilla parcial para corregir unos pocos precios: daría de
  baja todo el resto del catálogo.

El número de bajas se muestra **antes** de confirmar. Si dice un número que no esperabas, no
confirmes.

### El camino de ida y vuelta

**Descargar planilla** baja el catálogo vivo con las mismas columnas que acepta la importación. Es
la forma cómoda de corregir muchas descripciones o categorías: bajás, arreglás en Excel, subís.

---

## 3. Los CÓDIGOS

El código es la llave de todo: parea las fotos, cruza los precios y evita que un producto entre dos
veces. La pantalla **Control de códigos** muestra los cuatro problemas posibles:

| Problema | Qué significa | Qué hacer |
|---|---|---|
| **Sin foto** | El producto existe pero no tiene imagen | Generar y subir la foto (§1) |
| **Sin precio** | El producto existe con precio $0 | Importar la lista, o corregirlo a mano |
| **Sin marca** | No sabemos de qué marca es | Completar en la ficha del producto |
| **Dados de baja** | No vinieron en la última lista | Revisar si de verdad salieron de circulación |
| **Código raro** | No tiene 4 dígitos como los demás | Corregirlo a mano — suele ser un error de carga |

Un par de reglas que ahorran problemas:

- **Un producto sin código no se puede actualizar por planilla.** Volvería a entrar como producto
  nuevo. Si ves alguno sin código, ponéselo.
- **El código lo manda el sistema de la distribuidora.** No inventes códigos nuevos para productos
  que ya existen ahí.
- **Nunca reutilices el código de un producto dado de baja** para un producto distinto: se le
  quedaría la foto del anterior.

---

## 4. Qué se puede hacer desde el celular y qué no

| | Computadora (navegador) | Celular / app |
|---|---|---|
| Buscar y editar productos (precio, marca, categoría, oferta) | ✅ | ✅ |
| Cargar la foto de **un** producto (galería o cámara) | ✅ | ✅ |
| Ver los pendientes y el control de códigos | ✅ | ✅ |
| Importar la planilla de precios | ✅ | ✅ |
| Descargar la planilla | ✅ | ✅ |
| **Cargar muchas fotos de una carpeta** | ✅ | ❌ |

La carga masiva por carpeta **solo funciona en la computadora** (es una limitación de Android, no de
la app). En el celular podés seleccionar varias fotos sueltas de la galería, pero para tandas
grandes conviene la computadora.

---

## 5. Preguntas frecuentes

**¿Puedo subir una foto que saqué con el celular en el depósito?**
Sí, pero recortala en cuadrado antes y buscá un fondo lo más liso y claro posible. Una foto de
producto sobre una pared blanca funciona bien; sobre una estantería llena, no.

**Subí una foto y no se ve. ¿Qué pasó?**
Casi siempre es el nombre del archivo. Fijate en la tabla de pareo si decía `Sin producto`.

**Cambié una foto y sigo viendo la vieja.**
Cerrá y volvé a abrir la pantalla. La app le pone una marca de versión a cada foto nueva, así que la
correcta llega en unos segundos.

**¿Puedo borrar un producto?**
Podés, pero casi nunca conviene. Si salió de circulación, **dalo de baja** (o dejá que la
importación lo haga): así conserva su foto y vuelve solo si reaparece. Borrar es para un producto
cargado por error.

**¿El vendedor ve el costo o la ganancia?**
No. El "nivel de rentabilidad" es solo un color en el marco de la tarjeta (1 a 4). El número y el
costo no salen nunca del sistema.
