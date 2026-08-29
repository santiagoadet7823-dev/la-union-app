# LÉAME PRIMERO — qué es cada archivo de esta carpeta

Además de este, la carpeta tiene **8 archivos**. Parecen muchos, pero cada uno es para una persona
distinta y en un momento distinto. **Nadie tiene que leerlos todos.**

Están numerados por orden: el **1** es el que abre, y de ahí en adelante cada uno tiene su momento.

Este documento explica **qué es cada uno y quién lo necesita**, sin dar nada por sabido.

---

## Primero, de qué se trata todo esto en una página

Hoy, cuando ustedes cambian un precio en su sistema de gestión, ese precio **no llega solo** a los
celulares de los vendedores: alguien tiene que bajar una planilla, editarla y subirla a mano.

Lo que estamos armando es que **eso pase solo, tres veces por día**.

Funciona así, y son tres piezas:

**1. Su sistema genera un archivo.** El mismo tipo de archivo que ya exporta hoy: una lista de
productos con sus precios, en texto.

**2. Un "programita" lo manda por internet.** Ese programita es uno de los archivos de esta carpeta.
Nosotros ya lo escribimos: ustedes sólo tienen que decirle dónde está su archivo y a qué hora
mandarlo.

**3. Nuestro sistema lo recibe y actualiza el catálogo.** Y los celulares de los vendedores buscan
la lista nueva solos, sin que nadie cierre y abra nada.

### Dos palabras que van a aparecer todo el tiempo

| Palabra | Qué es, en criollo |
|---|---|
| **La dirección (o URL)** | Es como la dirección de un buzón. El programita deja ahí el archivo y nosotros lo levantamos. Es siempre la misma y está escrita adentro de los archivos, no hay que tocarla |
| **El token** | Es **la llave**. Prueba que quien deja el archivo en el buzón son ustedes y no otro. Se los entregamos **por separado**, no viene en esta carpeta. 🔴 **Quien tenga esa llave puede cambiarles el catálogo entero**: no se manda por correo junto con nada, no se pega en un chat grupal, no se guarda en un lugar compartido |

---

## Los 8 archivos, y quién lee cada uno

| # | Archivo | ¿Quién lo lee? |
|---|---|---|
| 1 | `1 - Que necesitamos de ustedes.md` | **Quien coordina.** Empezar acá |
| 2 | `2 - Especificacion del formato (tecnico).md` | Quien **programa** el export en su sistema |
| 3 | `3 - Guia de instalacion (servidor).md` | Quien **administra el servidor** |
| 4 | `4 - plantilla-lista-precios.xlsx` | Quien **carga precios a mano**, y como modelo del formato |
| 5 | `scripts/enviar-precios.ps1` | Nadie lo lee. Se copia y funciona |
| 6 | `scripts/enviar-precios.bat` | **El único que hay que editar**, y es una línea |
| 7 | `scripts/enviar-precios.sh` | Sólo si el servidor es Linux |
| 8 | `scripts/EnviarPrecios.java` | Opcional, para su programador |

---

# 1. `1 - Que necesitamos de ustedes.md`

### Qué es
El documento de arranque. **Es el que hay que leer primero.**

### Qué tiene adentro
- **Cuatro preguntas que necesitamos que nos contesten**, y que hoy están frenando todo. La más
  importante: si la lista nueva conserva los códigos de producto que ya tienen. De esa respuesta
  dependen **355 fotos de productos** que ya están cargadas — si los códigos cambian, el catálogo
  que ve el comerciante queda gris y hay que cargarlas todas de nuevo a mano.
- **El orden en que van a pasar las cosas**, paso por paso, diciendo qué hace cada uno.
- Cómo va a funcionar el día a día una vez que esté andando.

### Quién lo lee
Quien coordine de su lado. **No hace falta saber de programación.**

---

# 2. `2 - Especificacion del formato (tecnico).md`

### Qué es
El **manual del formato**. Es la descripción exacta de cómo tiene que estar armado el archivo que su
sistema va a generar.

Piénselo como el instructivo que da un banco cuando uno le manda un archivo de pagos: dice qué
columna va en qué lugar, qué se acepta y qué se rechaza.

### Qué tiene adentro
- **Las 22 columnas**, una por una: qué significa cada una y si es obligatoria.
- **Los descuentos por cantidad** (a partir de tantas unidades, el precio baja) y cómo se escriben.
- **Reglas que evitan errores caros.** Por ejemplo: un precio escrito como `1.450` se rechaza a
  propósito, porque no hay forma de saber si son mil cuatrocientos cincuenta o uno con cuarenta y
  cinco. Preferimos rechazar esa fila antes que inventar un precio y que un vendedor cobre mal.
- Los **códigos de respuesta**: qué contesta nuestro sistema cuando algo sale bien y cuándo no.

### Quién lo lee
**La persona que programe la exportación** desde el sistema de gestión. Es el único documento de los
cuatro que es técnico.

---

# 3. `3 - Guia de instalacion (servidor).md`

### Qué es
El **instructivo de instalación**. Explica cómo dejar el envío funcionando solo.

### Qué tiene adentro
- Dónde copiar los archivos y dónde guardar la llave (el token).
- **Cómo crear la "tarea programada" de Windows**, campo por campo, con lo que hay que tildar y lo
  que hay que destildar. Una tarea programada es, literalmente, un despertador: le decís a la
  computadora "todos los días a las 6 de la mañana hacé esto", y lo hace sola aunque no haya nadie.
- Cómo hacer las **otras dos corridas** (11:00 y 16:00), que es duplicar la primera y cambiarle la
  hora.
- **Qué hacer con cada error**, en una tabla: si el sistema contesta tal cosa, significa esto y se
  arregla así.
- Cómo darse cuenta, dentro de tres meses, de que **sigue funcionando**. Esta parte se suele saltear
  y es la que importa: un envío automático que deja de correr **no avisa**.

### Quién lo lee
Quien administre el servidor donde corre el sistema de gestión.

---

# 4. `4 - plantilla-lista-precios.xlsx`

### Qué es
**Una planilla de Excel**, común y corriente. Se abre con doble clic.

### Para qué sirve, y son dos cosas
1. **Como modelo.** Muestra las 22 columnas con los nombres exactos y cuatro productos de ejemplo ya
   cargados. Quien programe el export mira esto y sabe qué tiene que producir.
2. **Para cargar precios a mano.** Mientras el envío automático no esté listo —y también después,
   para correcciones sueltas— se puede llenar esta planilla y subirla desde la app.

### Tiene dos hojas
- **`LISTA`**: las columnas y los ejemplos.
- **`INSTRUCTIVO`**: la explicación de cada columna, escrita adentro de la misma planilla para no
  tener que abrir otro documento.

---

# 5. `scripts/enviar-precios.ps1`

### Primero: ¿qué es un "script"?

Un **script** es una lista de instrucciones escritas en un archivo de texto, que la computadora lee
y ejecuta sola, siempre igual. Es como una receta: no piensa, hace exactamente lo que dice.

**Ustedes no tienen que entenderlo ni modificarlo.** Se copia a una carpeta y funciona.

### Qué hace este, paso por paso

Es el **cartero**. Cada vez que se ejecuta:

1. **Busca el archivo** que exportó el sistema de gestión y se fija que exista y no esté vacío.
2. **Avisa si el archivo es viejo.** Si tiene más de 20 horas —o sea, si el export de hoy no
   corrió— lo anota en el registro. Igual lo manda: una lista vieja es mejor que ninguna.
3. **Lo envía** a nuestro sistema, junto con la llave.
4. **Anota la respuesta** en un archivo de registro, uno por día. Ahí queda escrito cuántas filas
   entraron, cuántas se actualizaron y si algo se rechazó.
5. **Si falló internet, vuelve a intentar** a los 15 minutos y a los 30. Si ahí tampoco pudo, deja
   el error anotado y para.

### Una cosa importante que hace, y es a propósito

**Distingue dos tipos de problema.** Si el problema fue de internet, reintenta. Si el problema fue
del archivo —una fila mal escrita, la llave vencida— **no reintenta**, porque el resultado iba a ser
el mismo: eso necesita que lo mire una persona.

### Y una cosa que NO hace, deliberadamente

**Nunca da de baja productos.** Aunque un día el export salga incompleto por un filtro mal puesto,
los productos que falten en el archivo **quedan como estaban**. Las bajas se hacen a mano, mirando el
número antes de confirmar. Está pensado así para que un error de un martes a la mañana no les vacíe
el catálogo sin que nadie se entere hasta que un vendedor abre la app frente a un comercio.

---

# 6. `scripts/enviar-precios.bat` 🔴 **el único que hay que tocar**

### Qué es
El **botón de arranque**. Es un archivo de dos líneas cuyo único trabajo es llamar al anterior.

### ¿Por qué existe, si ya está el otro?
Porque el programador de tareas de Windows no puede llamar directamente al archivo `.ps1`: hay que
invocarlo de una forma particular, y escribir eso a mano en la configuración de la tarea es la forma
más fácil de equivocarse. Acá queda escrito bien, una sola vez.

### Lo único que hay que editar de toda la carpeta

Se abre con el Bloc de notas y se cambia **una línea**: la ruta del archivo que exporta el sistema
de gestión.

```
set ARCHIVO=C:\ERP\export\lista-precios.txt
```

Donde dice `C:\ERP\export\lista-precios.txt` va la ruta real. Nada más.

---

# 7. `scripts/enviar-precios.sh`

### Qué es
**Exactamente lo mismo que el punto 5, pero para servidores Linux.**

### Cuándo se usa
Sólo si el servidor donde corre el sistema de gestión es Linux. **Si es Windows, se ignora este
archivo por completo.**

Su administrador va a saber cuál de los dos corresponde con sólo mirarlo.

---

# 8. `scripts/EnviarPrecios.java`

### Qué es
Una **alternativa opcional**, y en realidad es la mejor de las dos.

### La diferencia con el resto
Los archivos 5 y 6 arman un envío que sale **a una hora fija** (06:00, 11:00, 16:00). Eso funciona
bien, pero tiene una debilidad: si un día el proceso que genera el archivo se atrasa y todavía no
terminó a las 6, el envío sale con el archivo del día anterior.

Este archivo permite algo mejor: que el envío ocurra **justo después de que el archivo se terminó de
generar**, sea la hora que sea. En vez de un despertador, es una consecuencia.

### Qué hay que hacer con él
Dárselo a **la persona que programa su sistema de gestión**. Son unas pocas líneas que se pegan al
final del proceso que ya genera el export. Si el sistema está hecho en Java —que es lo que nos
comentaron— entra directo.

**Es opcional.** Si les resulta más simple la tarea programada, funciona igual.

---

## Resumen: por dónde empezar

| Paso | Qué | Quién |
|---|---|---|
| 1 | Leer el archivo **1** y contestarnos las **cuatro preguntas** | Quien coordina |
| 2 | Pasarle los archivos **2** y **4** a quien programa el export | Quien coordina |
| 3 | Mandarnos un **archivo de prueba de 20 filas** | Quien programa |
| 4 | Lo revisamos juntos y les avisamos si algo hay que corregir | Nosotros |
| 5 | Recién ahí: instalar los scripts siguiendo el archivo **3** | Quien administra el servidor |

**Cualquier duda de cualquiera de los archivos, pregúntennos.** Es preferible una consulta de dos
minutos que un catálogo con precios equivocados.
