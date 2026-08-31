# LÉAME PRIMERO — qué es cada archivo de esta carpeta

Parecen muchos archivos, pero **cada uno es para una persona distinta y en un momento distinto.
Nadie tiene que leerlos todos.**

Este documento explica qué es cada uno, sin dar nada por sabido.

> **Todo está preparado para Windows.** Los programas están escritos en **PowerShell**, que ya viene
> instalado: no hay que descargar ni instalar nada.

---

## Si tenés diez segundos

Para **poner esto a funcionar** sólo hace falta una cosa:

> Copiar la carpeta al servidor y hacer clic derecho en **`instalar.ps1`** → **Ejecutar con
> PowerShell** (como administrador).

El instalador te va a pedir que elijas tu archivo de precios en una ventana, y hace todo lo demás
solo. El resto de los archivos son documentación y respaldo.

---

## De qué se trata todo esto, en una página

Hoy, cuando ustedes cambian un precio en su sistema de gestión, ese precio **no llega solo** a los
celulares de los vendedores: alguien tiene que bajar una planilla, editarla y subirla a mano.

Lo que estamos armando es que **eso pase solo, una vez por hora**.

Funciona así, y son tres piezas:

**1. Su sistema genera un archivo.** El mismo que ya exporta hoy: una lista de productos con sus
precios, en texto. Siempre en la misma carpeta y con el mismo nombre.

**2. Un programita lo manda por internet.** Nosotros ya lo escribimos. Corre solo, cada hora, aunque
no haya nadie usando el servidor.

**3. Nuestro sistema lo recibe y actualiza el catálogo.** Y los celulares de los vendedores buscan la
lista nueva solos, sin que nadie cierre y abra nada.

### Tres palabras que van a aparecer

| Palabra | Qué es, en criollo |
|---|---|
| **Script** | Una lista de instrucciones guardada en un archivo, que la computadora lee y ejecuta sola, siempre igual. Como una receta: no piensa, hace exactamente lo que dice |
| **Tarea programada** | El despertador de Windows. Se le dice "hacé esto cada una hora" y lo hace, aunque nadie haya iniciado sesión |
| **El token** | 🔑 **La llave.** Prueba que quien manda la lista son ustedes y no otro. **Ya viene cargada**: no hay que completar nada. 🔴 Quien tenga esa llave puede reescribirles el catálogo entero, así que esta carpeta no se copia a lugares compartidos ni se reenvía por chat |

---

## Los archivos, y quién lee cada uno

| # | Archivo | ¿Quién lo lee? |
|---|---|---|
| 1 | `1 - Que necesitamos de ustedes.md` | **Quien coordina.** Empezar acá |
| 2 | `2 - Especificacion del formato (tecnico).md` | Quien **programa** el export en su sistema |
| 3 | `3 - Guia de instalacion Windows.md` | Quien **instala** en el servidor |
| 4 | `4 - plantilla-lista-precios.xlsx` | Quien **carga precios a mano**, y como modelo del formato |
| 5 | `scripts\instalar.ps1` | 🔴 **El que hay que ejecutar** |
| 6 | `scripts\revisar.ps1` | Para saber si sigue funcionando |
| 7 | `scripts\token.txt` | La llave. **Ya está completa**, no se toca |
| 8 | `scripts\enviar-precios.ps1` y `.bat` | Los usa el instalador. Nadie los abre |
| 9 | `scripts\EnviarPrecios.java` | Opcional, para su programador |

---

# 1. `1 - Que necesitamos de ustedes.md`

**Qué es.** El documento de arranque. **Es el que hay que leer primero.**

**Qué tiene adentro.**
- **Cuatro preguntas que necesitamos que nos contesten**, y que hoy están frenando todo. La más
  importante: si la lista nueva conserva los códigos de producto que ya tienen. De esa respuesta
  dependen **355 fotos de productos** que ya están cargadas — si los códigos cambian, el catálogo que
  ve el comerciante queda gris y hay que cargarlas todas de nuevo a mano.
- El orden en que van a pasar las cosas, paso por paso, diciendo qué hace cada uno.
- Cómo va a funcionar el día a día una vez que esté andando.

**Quién lo lee.** Quien coordine de su lado. **No hace falta saber de programación.**

---

# 2. `2 - Especificacion del formato (tecnico).md`

**Qué es.** El **manual del formato**: cómo tiene que estar armado el archivo que su sistema genera.
Piénselo como el instructivo que da un banco para un archivo de pagos — dice qué columna va en qué
lugar, qué se acepta y qué se rechaza.

**Qué tiene adentro.**
- Las **22 columnas**, una por una: qué significa cada una y si es obligatoria.
- Los **descuentos por cantidad** (a partir de tantas unidades el precio baja) y cómo se escriben.
- **Reglas que evitan errores caros.** Por ejemplo: un precio escrito como `1.450` se rechaza a
  propósito, porque no hay forma de saber si son mil cuatrocientos cincuenta o uno con cuarenta y
  cinco. Preferimos rechazar esa fila antes que inventar un precio y que un vendedor cobre mal.
- Los códigos de respuesta del sistema.

**Quién lo lee.** La persona que programe la exportación. **Es el único documento técnico.**

---

# 3. `3 - Guia de instalacion Windows.md`

**Qué es.** El paso a paso para dejar el envío funcionando solo. **Son tres pasos**, porque el
trabajo pesado lo hace el instalador.

**Qué tiene adentro.**
- Los tres pasos: copiar la carpeta, comprobar el token, ejecutar el instalador.
- Cómo usar `revisar.ps1` para saber si está funcionando.
- Qué hacer con cada respuesta del sistema, en una tabla.
- 🔌 **Qué hacer si el servidor se apaga o se reinicia.** La buena noticia es que la tarea sobrevive
  al apagado y casi siempre no hay que hacer nada; el documento trae igual la comprobación de un
  minuto y los tres casos posibles con su solución.

**Quién lo lee.** Quien administre el servidor.

---

# 4. `4 - plantilla-lista-precios.xlsx`

**Qué es.** Una planilla de Excel común. Se abre con doble clic.

**Para qué sirve, y son dos cosas:**
1. **Como modelo.** Muestra las 22 columnas con los nombres exactos y cuatro productos de ejemplo.
   Quien programe el export mira esto y sabe qué tiene que producir.
2. **Para cargar precios a mano**, mientras el envío automático no esté listo y también después, para
   correcciones sueltas.

**Tiene dos hojas:** `LISTA` (columnas y ejemplos) e `INSTRUCTIVO` (la explicación de cada columna,
adentro de la misma planilla).

---

# 5. `scripts\instalar.ps1` 🔴 **el que hay que ejecutar**

**Qué es.** El instalador. Se ejecuta **una sola vez**, y deja todo funcionando.

> Clic **derecho** → **Ejecutar con PowerShell**, como administrador.

**Qué hace, en orden:**

| | |
|---|---|
| 1 | Comprueba que el token esté puesto |
| 2 | **Abre una ventana para que elijas tu archivo de precios.** No hay que escribir ninguna ruta: se busca el archivo como cuando uno adjunta algo a un mail |
| 3 | Guarda esa elección, así no hay que volver a decirlo nunca |
| 4 | Hace un **envío de prueba** y te dice en castellano cómo salió |
| 5 | Programa el envío automático **cada 1 hora** |
| 6 | **Dispara la tarea y comprueba que de verdad corrió** — configurar no es lo mismo que funcionar |
| 7 | Muestra un resumen de lo que quedó instalado |

**Si algo falla, te lo dice ahí mismo con la explicación de qué hacer.** No puede quedar instalado a
medias sin que te enteres.

Se puede volver a ejecutar cuando haga falta. Por ejemplo, si el sistema pasa a generar el archivo en
otra carpeta: se corre de nuevo, se elige el archivo nuevo, y listo.

---

# 6. `scripts\revisar.ps1`

**Qué es.** El chequeo de "¿esto sigue andando?". **No cambia nada: sólo mira e informa.**

> Clic derecho → **Ejecutar con PowerShell**. Se puede correr cuantas veces se quiera.

Dice, en castellano: si la tarea existe y está habilitada, cuándo corre la próxima, cómo terminó la
última, cuántos envíos correctos y cuántos errores hubo hoy, y **si el archivo de precios existe y
hace cuánto que su sistema no lo regenera**.

Ese último punto es el que más ahorra tiempo: separa *"el envío se rompió"* de *"el que no está
generando el archivo es su sistema"*. Son dos problemas de dos dueños distintos y se confunden todo
el tiempo.

Termina con un veredicto de una línea: **"TODO EN ORDEN"** o qué hay que mirar.

> **Si algo no cierra, mándennos una foto de esa pantalla.** Con eso solo alcanza para diagnosticar
> casi cualquier cosa.

---

# 7. `scripts\token.txt`

**Qué es.** 🔑 La llave que identifica a la distribuidora. **Ya viene completa: no hay que tocarla.**

Sólo conviene restringir quién puede leerla: clic derecho → **Propiedades** → **Seguridad** →
**Editar**, y dejar únicamente Administradores y la cuenta `SYSTEM`.

🔴 **Quien tenga ese archivo puede reescribir el catálogo entero**: los precios que ven los vendedores
en la calle y los que ve el comerciante en la tablet. Por eso esta carpeta no va a lugares
compartidos.

Si alguna vez sospechan que se filtró, avísennos: la damos de baja y emitimos una nueva en un minuto.

---

# 8. `scripts\enviar-precios.ps1` y `scripts\enviar-precios.bat`

**Qué son.** Los programitas que hacen el envío de verdad. **El instalador los usa solo; no hay que
abrirlos ni editarlos.**

**Qué hace el envío, cada vez que corre:**

1. Busca el archivo que eligieron en el instalador y comprueba que exista y no esté vacío.
2. **Se fija si cambió** desde el envío anterior y lo anota en el registro. **Lo manda igual** — es a
   propósito: reenviar es gratis y así ningún cambio se puede perder.
3. Lo envía junto con la llave.
4. **Anota la respuesta** en un registro, uno por día.
5. **Si falló internet, reintenta** a los 5 y a los 10 minutos.

**Y algo que hace bien, que conviene saber:** distingue los dos tipos de problema. Si fue de
internet, reintenta. Si fue del archivo —una fila mal escrita, la llave vencida— **no reintenta**,
porque el resultado sería el mismo: eso necesita que lo mire una persona.

**Y algo que NO hace, deliberadamente:** **nunca da de baja productos.** Aunque un día el export
salga incompleto por un filtro mal puesto, los productos que falten **quedan como estaban**.

> El `.bat` es sólo el puente que Windows necesita para llamar al `.ps1`. Se le puede hacer doble
> clic para **forzar un envío ahora mismo**, sin esperar a la hora.

---

# 9. `scripts\EnviarPrecios.java`

**Qué es.** Una alternativa **opcional**, y en realidad la mejor de las dos.

**La diferencia.** El envío por hora funciona bien, pero es un reloj: manda lo que encuentre en ese
momento. Este archivo permite algo mejor — que el envío ocurra **justo después de que el archivo
terminó de generarse**, sea la hora que sea.

**Qué hacer con él.** Dárselo a la persona que programa su sistema de gestión: son unas pocas líneas
que se pegan al final del proceso que ya genera el export. Si el sistema está hecho en Java —que es
lo que nos comentaron— entra directo.

**Es opcional, y se puede sumar después.** Si se hace, conviene dejar igual la tarea de cada hora:
una cosa no reemplaza a la otra, se complementan.

---

## Por dónde empezar

| Paso | Qué | Quién |
|---|---|---|
| 1 | Leer el archivo **1** y contestarnos las **cuatro preguntas** | Quien coordina |
| 2 | Pasarle los archivos **2** y **4** a quien programa el export | Quien coordina |
| 3 | Mandarnos un **archivo de prueba de 20 filas** | Quien programa |
| 4 | Lo revisamos juntos y avisamos si hay que corregir algo | Nosotros |
| 5 | Recién ahí: copiar la carpeta al servidor y ejecutar **`instalar.ps1`** | Quien administra el servidor |

**Cualquier duda de cualquiera de los archivos, pregúntennos.** Es preferible una consulta de dos
minutos que un catálogo con precios equivocados.
