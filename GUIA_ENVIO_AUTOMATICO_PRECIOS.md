# Guía de instalación — envío automático de la lista de precios

**Windows · 31/08/2026 · para el servidor de la distribuidora.**

Esta guía deja el envío de la lista de precios funcionando **solo, una vez por hora**, sin que nadie
tenga que acordarse de nada.

**No hay que configurar nada a mano, ni abrir una terminal, ni escribir un solo comando.** Preparamos
un instalador que hace todo el trabajo: le decís cuál es tu archivo de precios y él se encarga del
resto. Son **dos pasos** y se hace una sola vez.

Está todo pensado para **Windows**. Los programas están escritos en **PowerShell**, que viene
instalado de fábrica: **no hay que descargar ni instalar nada.**

---

## Los pasos

### Paso 1 — Copiar la carpeta al servidor

Copiá la carpeta que te mandamos a un lugar fijo del servidor. Sugerimos:

```
C:\DisTAt\
```

Puede ser otra ruta, pero que sea **una carpeta propia y estable**: no el Escritorio de un usuario,
no Descargas, no una carpeta temporal. Si alguien la mueve después, el envío deja de funcionar.

### Paso 2 — Ejecutar el instalador

> **Doble clic** en **`INSTALAR.bat`**.

Eso es todo. **No hay que abrir ninguna terminal ni escribir ningún comando.**

Windows va a mostrar su cartel de siempre preguntando si permitís que la aplicación haga cambios en
el equipo: **decile que sí.** El instalador necesita ese permiso para dejar programado el envío
automático, y se lo pide solo.

> **Puede aparecer una advertencia antes**, del tipo *"Windows protegió su PC"* o *"¿Desea ejecutar
> este archivo?"*. Es normal y sale **una sola vez**: pasa con todo archivo que llegó por mail o por
> chat. Tocá **Más información → Ejecutar de todas formas**.

> ⚠️ **No hagas clic derecho sobre `instalar.ps1`.** Ése es el motor, no la puerta de entrada:
> Windows marca como *"vino de internet"* todo lo que sale de un ZIP, y PowerShell se niega a
> ejecutar un archivo marcado. `INSTALAR.bat` se ocupa de eso solo — es la única forma que funciona
> en cualquier equipo, esté como esté configurado.

### Y de ahí en más, lo guía el instalador

Lo primero que va a hacer es abrir una ventana para que **busques el archivo** que genera el sistema de
gestión, igual que cuando adjuntás algo a un mail. **No hay que escribir ninguna ruta.**

Y listo. De ahí en adelante hace todo solo:

| | Qué hace |
|---|---|
| 1 | Comprueba que el token esté puesto *(ya viene cargado)* |
| 2 | **Abre la ventana para que elijas tu archivo de precios** |
| 3 | Guarda esa elección, así no hay que volver a decirlo nunca |
| 4 | Hace un **envío de prueba** y te dice en castellano cómo salió |
| 5 | Programa el envío automático **cada 1 hora** |
| 6 | **Dispara la tarea y comprueba que de verdad corrió** — configurar no es lo mismo que funcionar |
| 7 | Muestra un resumen de lo que quedó instalado |

**Si algo falla, te lo dice ahí mismo, en pantalla, con la explicación de qué hacer.** No hay forma
de que quede "instalado a medias" sin que te enteres.

> Se puede volver a ejecutar las veces que haga falta. Por ejemplo, si el sistema de gestión pasa a
> generar el archivo en otra carpeta: se corre el instalador de nuevo, se elige el archivo nuevo, y
> listo.

### Sobre el token

Dentro de la carpeta hay un archivo **`token.txt`** que **ya viene con la llave adentro. No hay que
tocarlo.**

> 🔴 **Ese archivo es la credencial que los identifica.** Quien lo tenga puede reescribir el catálogo
> entero: los precios que ven los vendedores en la calle y los que ve el comerciante en la tablet.
> No copien esta carpeta a lugares compartidos ni la reenvíen por chat.
>
> Conviene restringir quién puede leerlo: clic derecho en `token.txt` → **Propiedades** → pestaña
> **Seguridad** → **Editar**, y dejar sólo Administradores y la cuenta `SYSTEM`.

---

## Cómo saber si está funcionando

> **Doble clic** en **`REVISAR.bat`**.

No cambia nada: sólo mira e informa. Te dice, en castellano:

- Si la tarea existe, si está habilitada y cuándo corre la próxima.
- Cómo terminó la última ejecución.
- Cuántos envíos correctos y cuántos errores hubo hoy.
- **Si tu archivo de precios existe y hace cuánto que el sistema de gestión no lo regenera** — que es
  la forma de distinguir *"el envío se rompió"* de *"el que no está generando el archivo es su
  sistema"*. Son dos problemas de dos dueños distintos y se confunden todo el tiempo.
- Y un veredicto de una línea: **"TODO EN ORDEN"** o qué hay que mirar.

**Si algo no cierra, mandanos una foto de esa pantalla.** Con eso solo alcanza para diagnosticar casi
cualquier cosa.

Para **forzar un envío ahora mismo**, sin esperar a la hora: doble clic en `enviar-precios.bat`.

---

## Cómo funciona, una vez andando

**Un envío por hora, todos los días, las 24 horas.**

Manda **siempre**, aunque el archivo no haya cambiado. Es a propósito: reenviar es gratis, no rompe
nada (si llega dos veces lo mismo, el catálogo queda igual), y garantiza que un precio corregido esté
arriba **como máximo una hora después**, sin importar cuándo lo hayan cambiado.

En el registro vas a ver una de estas dos líneas en cada envío:

```
Archivo NUEVO (cambio desde el envio anterior).
El archivo NO cambio desde el envio anterior. Se manda igual.
```

Así se lee el registro de un vistazo: lo que importa son las líneas que dicen **NUEVO**.

### Dos cosas que el envío automático NO hace

- **Nunca da de baja productos.** Aunque un día el export salga incompleto por un filtro mal puesto,
  los productos que falten **quedan como estaban**. Las bajas se hacen a mano, mirando el número
  antes de confirmar.
- **No pisa las descripciones** de los productos que ya existen.

### El registro

El programa deja un archivo por día en:

```
C:\DisTAt\registros\precios-2026-08-31.log
```

Ahí queda todo: a qué hora salió cada envío, qué contestó nuestro sistema, cuántas filas entraron y
si algo se rechazó.

---

## 🔌 Si el servidor se apaga o se reinicia

Un corte de luz, un reinicio por actualizaciones de Windows, alguien que apagó la máquina un viernes.
Pasa. Esto es lo que hay que saber.

### Primero, la buena noticia

**La tarea programada sobrevive al apagado.** No vive en la memoria: queda guardada dentro de
Windows. Cuando el servidor vuelve a encender sigue ahí, configurada igual, y se ejecuta en la
siguiente hora **sin que nadie toque nada**.

Y como corre **cada hora**, una corrida perdida se recupera sola en la próxima. No hay nada que
rescatar.

**En la enorme mayoría de los casos no hay que hacer absolutamente nada.**

### La comprobación de un minuto cuando el servidor vuelve

> **Doble clic** en **`REVISAR.bat`**.

Si dice **"TODO EN ORDEN"**, terminaste. Si no, te dice qué mirar. Los casos posibles son estos tres.

---

#### A · La tarea aparece "Deshabilitada"

**Cómo se ve.** `REVISAR.bat` avisa que la tarea existe pero está deshabilitada.

**Por qué.** Alguien la deshabilitó, o una restauración del sistema la dejó así.

**Solución.** Programador de tareas → clic derecho sobre `DisT-At - enviar lista de precios` →
**Habilitar**.

---

#### B · El archivo de precios no está

**Cómo se ve.** `REVISAR.bat` dice que el archivo no existe, o que hace más de un día que no se
regenera.

**Por qué.** Casi siempre: **el sistema de gestión no arrancó** después del reinicio, así que nunca
generó el archivo.

**Solución.** Levantar el sistema de gestión. El envío se recupera solo en la próxima hora.

> ⚠️ Este caso **no es un problema del envío**. El envío manda lo que encuentra; si el archivo es
> viejo, manda el viejo y lo anota en el registro. Por eso `REVISAR.bat` los separa.

---

#### C · El archivo está en una carpeta de red y dejó de verse

**Cómo se ve.** Funcionaba y después del reinicio el registro dice `ERROR: no existe el archivo`.

**Por qué.** La tarea corre **sin que nadie inicie sesión**, y las unidades de red con letra
(`Z:\…`) sólo existen cuando un usuario inicia sesión.

**Solución.** El instalador ya convierte esas rutas a la forma `\\servidor\carpeta\…`, que sí
funciona sin sesión. Si aun así falla, hay que darle permiso de lectura a la cuenta del equipo sobre
esa carpeta compartida. Avisanos y lo vemos juntos.

---

> **Un modo de falla que ya está resuelto y conviene saber que no va a pasar:** la tarea corre como
> `SYSTEM`, que es una cuenta del sistema **sin contraseña y que no vence nunca**. Es la causa más
> común de que una tarea programada deje de funcionar meses después —a alguien le vence o le cambian
> la contraseña y la tarea deja de arrancar en silencio— y acá no puede ocurrir.

### Si el servidor va a estar apagado varios días

No hay nada que preparar y no se rompe nada. El catálogo simplemente se queda con los últimos precios
que recibió.

Y **nos vamos a dar cuenta**: nuestra pantalla de catálogo muestra hace cuánto llegó la última lista
y se pone en ámbar pasadas 36 horas sin recibir nada. Si igual saben de antemano que el servidor va a
estar parado, avísennos y nos ahorramos el llamado.

---

## Qué hacer con cada respuesta

`REVISAR.bat` y el registro muestran la respuesta de nuestro sistema. Estas son todas las posibles:

| Respuesta | Qué significa | Qué hacer |
|---|---|---|
| **`HTTP 200`** | Entró bien | Nada. Si aparece `rechazadas`, mirar esas filas: el motivo llega con **el número de fila tal como se ve en Excel**. Si aparece `bajas`, son los productos que se deshabilitaron y por qué |
| `HTTP 400 falta-encabezado` | El archivo arranca directo con datos, sin la fila con los nombres de columna | Agregar esa primera fila, **con el mismo separador que los datos**. La propia respuesta trae un ejemplo listo para copiar |
| `HTTP 400 archivo-vacio` | El export no generó nada | Revisar el sistema de gestión. **No es un problema del envío** |
| `HTTP 401` | La llave es inválida o fue dada de baja | Pedirnos una nueva. **No reintentar** |
| `HTTP 409 demasiadas-bajas` | El envío deshabilitaría más de 10 productos **y** más del 20 % del catálogo — sea porque no vienen en el archivo o porque vienen con `habilitado = no`. **No se escribió nada** | Avisarnos. Es el freno que impide que un export parcial o mal filtrado apague el catálogo. Las dos condiciones van juntas a propósito: sin el piso de 10, un catálogo chico no podría apagar ni un producto |
| `HTTP 413` | Más de 5.000 filas | Partir el envío, o avisarnos |
| `Error de red` | No se llegó al servidor | Reintenta solo a los 5 y a los 10 minutos. Si aun así falla, la próxima corrida es en una hora |

### Las dos filas rechazadas más frecuentes

Las dos son de formato y se corrigen del lado del export:

- **`precio ambiguo: "1.450"`** — el export está poniendo separador de miles. `1.450` puede ser mil
  cuatrocientos cincuenta o uno con cuarenta y cinco, y **el sistema no adivina**: rechaza esa fila y
  deja entrar el resto.
- **`desde_2 (5) no es mayor que desde_1 (10)`** — los escalones de descuento tienen que ir de menor
  a mayor.

---

## Cómo llega el precio nuevo al vendedor que ya está en la calle

Esta es la otra mitad, y sin ella el envío por hora no serviría de nada.

El teléfono del vendedor pregunta cada tanto —y cada vez que abre la app, que es lo que hace en cada
comercio— **si el catálogo cambió**. Esa consulta es una línea de datos. Sólo si de verdad cambió
algo se descarga el catálogo completo.

Por eso los envíos que no traen cambios **no le gastan datos móviles a nadie**: llegan, se registran,
y como no cambian nada, ningún teléfono se entera. Los que sí traen un precio nuevo llegan al
vendedor en su próximo comercio.

---

## Desde adentro del sistema de gestión (opcional, y es la mejor opción)

Si el sistema de gestión ya tiene un proceso que genera el export, lo más robusto es **llamar al
envío al terminar ese proceso**. Así el envío ocurre siempre después de que el archivo está completo.

El archivo `scripts\EnviarPrecios.java` es exactamente eso, sin dependencias externas
(`java.net.http`, Java 11 o superior):

```java
EnviarPrecios.Respuesta r = EnviarPrecios.enviar(Path.of(rutaExport), token, false);
log.info("ingesta precios: HTTP {} {}", r.codigo, r.cuerpo);
```

**Es opcional y se puede sumar después.** Si se hace, conviene dejar igual la tarea de cada hora: una
cosa no reemplaza a la otra, se complementan.

---

## Cómo apagarlo

> **Doble clic** en **`DESINSTALAR.bat`**.

Quita la tarea programada, y con eso el equipo deja de mandar la lista. Pide confirmación antes, y no
borra ni el token ni los registros: se vuelve a encender con `INSTALAR.bat` cuando haga falta.

**Hay un caso en el que esto no es opcional:** si el envío se muda a otro servidor, **hay que apagar
el viejo**. Si quedan los dos mandando, gana el último que llega — y si ése tiene el archivo
desactualizado, pisa al bueno. Apagar el viejo es parte de la mudanza, no un detalle.

> ⚠️ Un equipo puede estar mandando sin que nadie lo note: la tarea corre como `SYSTEM`, sin ventana
> y sin que nadie inicie sesión. Si hay dudas de si una máquina está mandando, se contesta con
> `REVISAR.bat` en esa máquina.

---

## Checklist

- [ ] Carpeta copiada a `C:\DisTAt\`, con los archivos sueltos adentro
- [ ] `INSTALAR.bat` y `token.txt` están en la MISMA carpeta
- [ ] Doble clic en `INSTALAR.bat`, y se aceptó el cartel de Windows
- [ ] El instalador terminó sin errores
- [ ] El instalador mostró el resumen con la próxima corrida
- [ ] Al día siguiente: `REVISAR.bat` dice **"TODO EN ORDEN"**
- [ ] Alguien de ustedes sabe que existe `REVISAR.bat` y qué hace

---

**Cualquier duda, por chica que parezca, pregúntennos.** Es preferible una consulta de dos minutos
que un catálogo con precios equivocados.
