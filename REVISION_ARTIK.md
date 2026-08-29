# Revisión de `ARTIK.csv`

**28/08/2026.** Revisión del primer archivo de prueba. Gracias por mandarlo — sirvió, y sirvió
justo para lo que tenía que servir: encontrar las diferencias ahora y no cuando esté todo andando.

**Resumen: el formato está bien encaminado. Los descuentos por cantidad se entienden perfecto.
Hay dos cosas para corregir y una para confirmar.**

Sobre el nombre del archivo, que era la pregunta: **`ARTIK.csv` está bien y no hace falta
cambiarlo.** En el envío automático el contenido viaja dentro del pedido HTTP, no como archivo
adjunto, así que el nombre no lo lee nadie. Lo que importa es lo de adentro.

---

## ✅ Lo que ya está bien

| | |
|---|---|
| **Separador `;`** | Perfecto. También aceptamos tabulador o coma: lo detectamos solos |
| **Decimales** | `9150.00` con punto y dos decimales — inequívoco, es lo mejor que nos podían mandar |
| **Códigos** | `41`, `1000`, sin ceros a la izquierda. No es problema: cruzamos ignorando los ceros, así que `41` y `0041` son el mismo producto |
| **`FDO` / `UN`** | Se entiende |
| **541 filas, 19 columnas parejas** | Ni una fila corta ni una de más |

### 🎯 Y lo más importante: los descuentos por cantidad están en el formato correcto

Encontramos la fila de ejemplo:

```
11;MANAOS 6X3LT COLA FD;11000.00;...;6;10800.00;12;10600.00;60;10450.00;;
```

Que leemos como: **desde 6 → $10.800 · desde 12 → $10.600 · desde 60 → $10.450**.

Es exactamente el mecanismo que necesitábamos, en las columnas 12 a 17. **Eso ya está resuelto.**

---

## 🔴 1. Falta la fila de encabezados

El archivo arranca directo con datos, en la primera línea:

```
41;MANAOS 12X600ML COLA;9150.00;0.00;1.00;01;;FDO;;;0;0;0.00;0;0.00;0;0.00;;
```

Necesitamos que **la primera línea sean los nombres de las columnas**, con el **mismo separador que
los datos** (o sea `;`, no comas):

```
codigo;descripcion;precio;peso;unidades;categoria;marca;unidad_venta;nivel;oferta;precio_oferta;desde_1;precio_1;desde_2;precio_2;desde_3;precio_3;desde_4;precio_4;desde_5;precio_5
```

**Por qué lo pedimos y no lo damos por sobreentendido:** con los nombres, el archivo se explica solo.
El día que ustedes agreguen una columna, o muevan una de lugar, lo seguimos entendiendo sin que nadie
avise. Sin nombres tendríamos que fijar el orden a mano de nuestro lado, y ese día los precios
entrarían corridos **sin dar ningún error** — que es la peor forma de fallar.

Los nombres no distinguen mayúsculas ni acentos, y el orden de las columnas no importa: `CODIGO`,
`Codigo` y `codigo` son lo mismo.

> Mientras tanto, si mandan el archivo así, el sistema lo rechaza con un mensaje que dice
> exactamente esto y muestra la primera línea que recibió. No importa nada a medias.

---

## 🔴 2. Las descripciones vienen cortadas a 20 caracteres

De las 541 filas, **407 tienen la descripción cortada justo en 20 caracteres**:

| Lo que llegó | Lo que debería decir |
|---|---|
| `MANAOS 12X600ML COLA` | `MANAOS 12X600ML COLA FDO` |
| `PLACER 12X500ML ANAN` | `PLACER 12X500ML ANANA` |
| `MANAOS 6X3LT COLA FD` | `MANAOS 6X3LT COLA FDO` |
| `ACEITE FINCA LAZO 12` | (falta el final) |

Parece un ancho fijo del sistema, no un problema de esta exportación en particular.

**Lo que hicimos mientras tanto:** el envío automático **no va a tocar los nombres** de los productos
que ya existen. Los nombres completos que hoy están cargados se conservan, y ustedes nos mandan
precios y descuentos sin riesgo. (Los productos **nuevos** sí entran con el nombre cortado, y los
corregimos a mano.)

**Lo que les pedimos:** si pueden ampliar el ancho de ese campo en la exportación, mejor —
así los productos nuevos entran bien de una. Si es un límite del sistema y no se puede tocar,
avísennos y seguimos como está.

---

## ⚠️ 3. Para confirmar: los descuentos van contados en UNIDADES

En el ejemplo, el producto `11` es el **fardo** de 6×3L a $11.000, y los tramos son 6, 12 y 60 —
que en ese contexto se leen como *6 fardos, 12 fardos, 60 fardos*.

En la especificación que les pasamos (**versión 2**) quedamos en lo contrario: **cada fila es una
unidad suelta** y los tramos se cuentan **en unidades**. Para ese mismo producto sería:

```
codigo;descripcion;precio;unidades;unidad_venta;desde_1;precio_1;desde_2;precio_2
0011;MANAOS COLA 3LT;1850;6;UN;6;1750;60;1690
```

O sea: la **botella** a $1.850, y el fardo pasa a ser el primer tramo (`desde 6`).

**Puede ser simplemente que este archivo sea anterior a esa versión de la especificación.**
¿Nos confirman si ya la vieron? Si prefieren mantener el fardo como fila, decidámoslo ahora: se puede
hacer, pero cambia la planilla y el instructivo, y es mejor cerrarlo antes de que programen el envío
definitivo.

---

## 📋 4. Un pedido: la tabla de rubros

La columna 6 trae códigos numéricos (`01`, `02`, … `20`). Nos sirven, pero necesitamos saber a qué
rubro corresponde cada número. **¿Nos pasan esa tabla?** Mientras tanto no la importamos y la
categoría se deduce del nombre del producto.

---

## Las columnas, como las leímos

| # | Qué entendimos | |
|---|---|---|
| 1 | Código | ✅ |
| 2 | Descripción | 🔴 cortada a 20 |
| 3 | Precio | ✅ |
| 4 | *(siempre 0.00)* | sin uso |
| 5 | Unidades por bulto | ✅ |
| 6 | Rubro (código numérico) | ⚠️ falta la tabla |
| 7 | *(vacía)* | sin uso |
| 8 | `FDO` / `UN` | ✅ |
| 9, 10, 11 | *(vacías / 0)* | sin uso |
| **12–17** | **Los 3 descuentos: cantidad y precio** | ✅ |
| 18, 19 | *(vacías)* | sin uso |

Si alguna la interpretamos mal, corríjannos.

---

## En resumen, qué necesitamos

1. **La fila de encabezados** al principio, separada por `;` como el resto.
2. **Confirmar** si pueden mandar la descripción completa (o avisar que no).
3. **Confirmar** si los tramos van en unidades sueltas o en fardos.
4. **La tabla de los 20 rubros.**

Con eso ya podemos dejar el envío automático andando de punta a punta.
