# Guía de instalación — envío automático de la lista de precios

**Windows · 29/08/2026 · para quien administre el servidor de la distribuidora.**

Esta guía deja el envío de la lista de precios funcionando **solo, tres veces por día**, sin que nadie
tenga que acordarse de nada.

Está escrita para **Windows**, que es lo que ustedes usan. Los scripts están hechos en **PowerShell**,
que viene instalado de fábrica en Windows: **no hay que descargar ni instalar nada**.

Toda la instalación son **seis pasos** y se hace una sola vez. Calculen media hora, con las pruebas
incluidas.

> Esta guía no explica el formato del archivo. Eso está en
> **`2 - Especificacion del formato (tecnico).md`**, que es el documento para quien programe la
> exportación.

---

## Antes de empezar

Tengan a mano estas tres cosas:

| Qué | Dónde lo consiguen |
|---|---|
| **La llave (token)** | Se la entregamos aparte, por canal privado. Es un código largo, parecido a `a1b2c3d4-…` |
| **La ruta exacta del archivo** que exporta el sistema de gestión | Por ejemplo `C:\ERP\export\lista-precios.txt`. Si no la saben de memoria: abran la carpeta, clic derecho en el archivo → *Propiedades*, y copien la ubicación |
| **A qué hora termina el proceso** que genera ese archivo | Para agendar el envío después, y no encima |

### Sobre la llave, una sola vez y en serio

El token es **la credencial que identifica a la distribuidora**. Quien lo tenga puede reescribirles el
catálogo entero: los precios que ven los vendedores en la calle y los que ve el comerciante en la
tablet.

- No va en un chat grupal ni en un mail con varios destinatarios.
- No va a ninguna carpeta compartida ni a un repositorio de código.
- Va en un archivo en el servidor, con permisos restringidos. El **Paso 2** explica cómo.

Si en algún momento sospechan que se filtró, avísennos: lo damos de baja y emitimos uno nuevo en un
minuto. Rotarlo no tiene ningún costo, y es preferible hacerlo de más.

---

## Paso 1 — Copiar la carpeta al servidor

Copien la carpeta que les mandamos a un lugar fijo del servidor. Sugerimos:

```
C:\DisTAt\
```

Puede ser otra ruta, pero que sea **una carpeta propia y estable**: no el Escritorio de un usuario, no
Descargas, no una carpeta temporal. Si alguien la mueve después, el envío deja de funcionar.

Adentro tienen que quedar, como mínimo, estos dos archivos:

```
C:\DisTAt\enviar-precios.ps1
C:\DisTAt\enviar-precios.bat
```

---

## Paso 2 — Guardar la llave

1. Dentro de `C:\DisTAt\`, creen un archivo de texto llamado **`token.txt`**.
2. Peguen adentro **el token y nada más**: una sola línea, sin comillas, sin espacios antes ni
   después, sin la palabra "token" ni dos puntos.
3. Guarden y cierren.

Después, restrinjan quién puede leerlo:

> Clic derecho en `token.txt` → **Propiedades** → pestaña **Seguridad** → **Editar**.
> Dejen únicamente la cuenta que va a correr la tarea y el grupo de Administradores. Quiten el resto.

**¿Por qué un archivo y no una variable de entorno?** Porque una tarea programada corre en una sesión
aparte y **no hereda** las variables de entorno del usuario. Es un error clásico: se configura la
variable, funciona al probarlo a mano, y falla en silencio a las seis de la mañana.

---

## Paso 3 — Decirle dónde está su archivo

Este es **el único archivo que hay que editar de todo el paquete**, y es una sola línea.

1. Clic derecho en `enviar-precios.bat` → **Editar** (se abre con el Bloc de notas).
2. Busquen esta línea:

```
set ARCHIVO=C:\ERP\export\lista-precios.txt
```

3. Reemplacen la ruta por la real. **Sin comillas.**
4. Guarden y cierren.

Nada más. El resto del archivo no se toca.

---

## Paso 4 — Probarlo a mano, ANTES de agendarlo

No saltearse este paso. Es mucho más fácil corregir un error viéndolo en pantalla que descubrirlo a
los tres días revisando un registro.

**Abrir PowerShell:**

> Menú Inicio → escriban `PowerShell` → clic derecho en **Windows PowerShell** → **Ejecutar como
> administrador**.

**Pararse en la carpeta y ejecutar:**

```powershell
cd C:\DisTAt
.\enviar-precios.ps1 -Archivo "C:\ERP\export\lista-precios.txt"
```

*(La ruta entre comillas es la misma que pusieron en el Paso 3.)*

### Qué tienen que ver

Algo así. Lo que importa es el **`HTTP 200`**:

```
[2026-08-29 10:15:02] Enviando C:\ERP\export\lista-precios.txt (48213 bytes) a https://...
[2026-08-29 10:15:04] HTTP 200 {"recibidas":541,"creados":3,"actualizados":511,...}
```

Si dice otra cosa, vayan a **"Qué hacer con cada respuesta"**, más abajo. Está todo contemplado.

> **Si PowerShell responde "no se puede cargar porque la ejecución de scripts está deshabilitada":**
> es una protección de Windows y **no hace falta desactivarla**. El archivo `.bat` del Paso 5 ya la
> sortea correctamente para esta tarea puntual. Para la prueba de ahora, ejecuten en su lugar:
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\enviar-precios.ps1 -Archivo "C:\ERP\export\lista-precios.txt"
> ```

---

## Paso 5 — Agendar la primera corrida (06:00)

> Menú Inicio → escriban `Programador de tareas` → abrirlo.
> En el panel derecho: **Crear tarea…**
>
> ⚠️ **"Crear tarea", no "Crear tarea básica".** La versión básica no ofrece las opciones que
> necesitamos.

Completen las pestañas así.

### Pestaña **General**

| Campo | Qué poner |
|---|---|
| Nombre | `DisT-At — precios 06:00` |
| ✅ | **Ejecutar tanto si el usuario inició sesión como si no** |
| ✅ | **Ejecutar con los privilegios más altos** |
| Configurar para | La versión de Windows del servidor |

> Las dos tildes importan. Sin la primera, la tarea **no corre si nadie dejó la sesión abierta** — y
> después de un reinicio, normalmente no hay nadie logueado.

### Pestaña **Desencadenadores** → *Nuevo…*

| Campo | Qué poner |
|---|---|
| Iniciar la tarea | Según una programación |
| Configuración | **Diariamente**, a las **06:00** |
| Repetir cada | *(dejar sin tildar)* |

*(Si prefieren sólo días hábiles: elijan **Semanalmente** y tilden de lunes a sábado.)*

### Pestaña **Acciones** → *Nueva…*

| Campo | Qué poner |
|---|---|
| Acción | Iniciar un programa |
| Programa o script | `C:\DisTAt\enviar-precios.bat` |
| **Iniciar en (opcional)** | `C:\DisTAt` |

> ⚠️ **El campo "Iniciar en" dice "opcional" y no lo es.** Sin él la tarea arranca parada en otra
> carpeta, y no encuentra ni el `token.txt` ni dónde escribir el registro.

### Pestaña **Condiciones**

| Campo | Qué hacer |
|---|---|
| "Iniciar la tarea sólo si el equipo está conectado a la corriente alterna" | ❌ **Destildar** |
| "Reactivar el equipo para ejecutar esta tarea" | ✅ Tildar, si el servidor se suspende |

### Pestaña **Configuración**

| Campo | Qué hacer |
|---|---|
| "Ejecutar la tarea lo antes posible si se pasó por alto un inicio programado" | ✅ **Tildar** |
| "Si la tarea produce un error, reiniciar cada" | ✅ 15 minutos, hasta 2 veces |

> 🔴 **La primera de estas dos es la que salva el día después de un corte de luz.** Con esa tilde, si
> el servidor estaba apagado a las 06:00, Windows corre el envío apenas vuelve. Sin ella esa corrida
> se pierde, y hay que esperar hasta las 11:00.

Al dar Aceptar, Windows va a pedirles **la contraseña de la cuenta** con la que corre la tarea. Es
normal: la necesita para poder ejecutarla sin que nadie esté logueado.

---

## Paso 6 — Las otras dos corridas (11:00 y 16:00)

Una sola corrida a las 06:00 **no alcanza**. Si corrigen un precio a las diez de la mañana, el
vendedor que ya salió sigue con la lista de las seis hasta el día siguiente. Por eso van tres.

**La forma más rápida:** clic derecho sobre la tarea que acaban de crear → **Exportar** → guarden el
`.xml`. Después, en el panel derecho, **Importar tarea…** dos veces, y en cada una cambien sólo el
nombre y la hora del desencadenador.

| Tarea | Hora |
|---|---|
| `DisT-At — precios 06:00` | 06:00 |
| `DisT-At — precios 11:00` | 11:00 |
| `DisT-At — precios 16:00` | 16:00 |

*(Alternativa: una sola tarea con **tres desencadenadores diarios**. Funciona igual. Preferimos tres
tareas separadas porque se leen mejor en la lista y se pueden desactivar de a una.)*

> **Los horarios son una sugerencia.** Si les queda mejor 12:30 y 17:00, cambien la hora del
> desencadenador y listo. Agregar una cuarta corrida es duplicar la tarea otra vez.
>
> 🔴 **Lo único que pedimos: que ninguna de ellas use `-ListaCompleta`.** Ese parámetro da de baja
> productos, y eso no lo tiene que hacer algo que corre solo de madrugada.

⚠️ **Cada corrida tiene que salir después del export.** Si el proceso que genera `lista-precios.txt`
corre a las 05:50 y a veces se estira, muevan el envío quince minutos — o, mejor, cuélguenlo del final
del export (ver la sección "Desde adentro del sistema de gestión").

---

## Cómo saber que anduvo

El script escribe un registro por día en:

```
C:\DisTAt\registros\precios-2026-08-29.log
```

Ahí queda todo: a qué hora salió cada corrida, qué contestó nuestro sistema, cuántas filas entraron y
si algo se rechazó. **Un día normal tiene tres respuestas**, una por corrida.

Y en el Programador de tareas, la columna **"Resultado de la última ejecución"** dice cómo terminó:
`0x0` significa que salió bien.

---

## 🔌 Si el servidor se apaga o se reinicia

Un corte de luz, un reinicio por actualizaciones de Windows, alguien que apagó la máquina un viernes.
Pasa. Esto es lo que hay que saber.

### Primero, la buena noticia

**Las tareas programadas sobreviven al apagado.** No viven en la memoria: quedan guardadas dentro de
Windows. Cuando el servidor vuelve a encender siguen ahí, configuradas igual, y se ejecutan en el
próximo horario **sin que nadie toque nada**.

Y si dejaron tildado *"Ejecutar la tarea lo antes posible si se pasó por alto un inicio programado"*
(Paso 5), Windows además **recupera la corrida perdida** apenas arranca.

**En la enorme mayoría de los casos no hay que hacer absolutamente nada.**

### La comprobación de dos minutos cuando el servidor vuelve

Igual conviene mirar, sobre todo las primeras veces:

1. Abran el **Programador de tareas** y ubiquen las tres tareas `DisT-At — precios …`.
2. Miren la columna **Estado**: tiene que decir **"Listo"**. Si dice **"Deshabilitado"**, vayan al
   caso **B**.
3. Miren **"Resultado de la última ejecución"**: `0x0` es correcto.
4. Si quieren confirmar sin esperar al próximo horario: **clic derecho sobre una tarea → Ejecutar**.
   Eso la dispara ahora mismo. Después revisen el registro del día en `C:\DisTAt\registros\`.

Con esos cuatro pasos ya saben si quedó todo en orden.

### Si no volvió solo: los cuatro motivos posibles

Son estos, en orden de probabilidad. Todos se resuelven en minutos.

---

#### A · La corrida se perdió y no se recuperó

**Síntoma.** El registro del día no tiene las tres respuestas, o directamente no existe.

**Por qué.** El servidor estaba apagado a esa hora y la tarea no tiene tildado *"Ejecutar la tarea lo
antes posible si se pasó por alto un inicio programado"*.

**Qué hacer ahora.** Clic derecho sobre la tarea → **Ejecutar**.

**Para que no vuelva a pasar.** Clic derecho → **Propiedades** → pestaña **Configuración** → tilden esa
opción → Aceptar. Háganlo en las tres tareas.

---

#### B · La tarea aparece "Deshabilitada"

**Síntoma.** En la columna Estado dice "Deshabilitado" en vez de "Listo".

**Por qué.** Alguien la deshabilitó, o una restauración del sistema la dejó así.

**Qué hacer.** Clic derecho sobre la tarea → **Habilitar**. Después **Ejecutar**, para verificar.

---

#### C · Cambió la contraseña de la cuenta que corre la tarea

*Este es el que no se ve venir, y es más frecuente de lo que parece.*

**Síntoma.** La tarea figura como ejecutada pero falla siempre, con un resultado tipo `0x1` o un error
de credenciales. Y —la pista que lo delata— **el registro del script no se escribe**: nunca llegó a
arrancar.

**Por qué.** Al crear la tarea, Windows guardó la contraseña de esa cuenta. Si después alguien la
cambió, o venció por una política de expiración, la tarea ya no puede iniciar sesión para ejecutarse.

**Qué hacer.** Clic derecho sobre la tarea → **Propiedades** → pestaña **General** → botón **Cambiar
usuario o grupo…** → seleccionen la misma cuenta → **Aceptar**. Windows va a pedir la contraseña
nueva. Repítanlo en las tres tareas.

> Se evita del todo usando una cuenta de servicio cuya contraseña no expire. Si tienen esa política en
> la empresa, vale la pena aplicarla acá.

---

#### D · El archivo del export no está donde estaba

**Síntoma.** El registro dice `ERROR: no existe el archivo …`.

**Por qué.** Dos posibilidades, y conviene distinguirlas:

- **El sistema de gestión no arrancó** después del reinicio, así que nunca generó el archivo. Es lo
  más frecuente, y se resuelve del lado de ustedes: levanten el sistema y después corran la tarea a
  mano.
- **El archivo está en una unidad de red** (`Z:\…`, `\\servidor\carpeta\…`) que todavía no estaba
  disponible cuando la tarea corrió. Las unidades con letra se conectan cuando un usuario inicia
  sesión, y la tarea corre **sin** sesión iniciada.

  *Solución:* en el Paso 3, usen la **ruta de red completa** (`\\servidor\carpeta\lista-precios.txt`)
  en lugar de la letra de unidad, y corran el horario unos minutos más tarde para darle tiempo a la
  red.

---

### Si el servidor va a estar apagado varios días

No hay nada que preparar y no se rompe nada. El catálogo simplemente se queda con los últimos precios
que recibió.

Y **nos vamos a dar cuenta**: nuestra pantalla de catálogo muestra hace cuánto llegó la última lista y
se pone en **ámbar pasadas 36 horas** sin recibir nada. Si igual saben de antemano que el servidor va
a estar parado más de un día, avísennos y nos ahorramos el llamado.

Cuando vuelva a encender: la comprobación de dos minutos de más arriba, y listo.

---

## Qué hacer con cada respuesta

| Respuesta | Qué significa | Qué hacer |
|---|---|---|
| **`HTTP 200`** con `recibidas`, `actualizados`… | Entró bien | Nada. Si `rechazadas` no viene vacío, miren esas filas: el motivo llega con **el número de fila tal como se ve en Excel** |
| `HTTP 400 falta-encabezado` | El archivo arranca directo con datos, sin la fila de nombres de columna | Agregar esa primera fila, **con el mismo separador que los datos**. La propia respuesta trae un ejemplo listo para copiar |
| `HTTP 400 archivo-vacio` | El export no generó nada | Revisar el proceso del sistema de gestión. **No es un problema del envío** |
| `HTTP 401` | La llave es inválida o fue dada de baja | Pídannos una nueva. **No reintentar** |
| `HTTP 409 demasiadas-bajas` | Sólo puede pasar con `-ListaCompleta`: el archivo dejaría fuera más del 20 % del catálogo. **No se escribió nada** | Avísennos. Es el freno que impide que un export parcial borre el catálogo |
| `HTTP 413` | Más de 5.000 filas | Partir el envío, o avisarnos |
| `Error de red` | No se llegó al servidor | El script reintenta solo a los 15 y a los 30 minutos. Si aun así falla, queda anotado en el registro |

### Las dos filas rechazadas más frecuentes

Las dos son de formato, no del envío, y se corrigen del lado del export:

- **`precio ambiguo: "1.450"`** — el export está poniendo separador de miles. `1.450` puede ser mil
  cuatrocientos cincuenta o uno con cuarenta y cinco, y **el sistema no adivina**: rechaza esa fila y
  deja entrar el resto. Se arregla exportando sin separador de miles.
- **`desde_2 (5) no es mayor que desde_1 (10)`** — los escalones de descuento tienen que ir de menor a
  mayor.

---

## Desde adentro del sistema de gestión (opcional, y es la mejor opción)

Si el sistema de gestión ya tiene un proceso que genera el export, lo más robusto es **llamar al envío
al terminar ese proceso**, en vez de agendarlo a una hora fija. Así el envío ocurre siempre después de
que el archivo está completo, y si el export se atrasa el envío se atrasa con él.

El archivo `scripts\EnviarPrecios.java` es exactamente eso, sin dependencias externas
(`java.net.http`, Java 11 o superior). Son unas pocas líneas que su programador pega al final del
proceso que ya exporta:

```java
EnviarPrecios.Respuesta r = EnviarPrecios.enviar(Path.of(rutaExport), token, false);
log.info("ingesta precios: HTTP {} {}", r.codigo, r.cuerpo);
```

Es opcional. Si les resulta más simple la tarea programada, funciona perfectamente igual.

---

## Cómo llega el precio nuevo al vendedor que ya está en la calle

Esta es la otra mitad de los tres horarios, y sin ella no servirían de nada.

Hasta la versión anterior, la app cargaba el catálogo **una sola vez, al abrirse**: el vendedor que
abría a las ocho tenía la lista de las seis hasta el día siguiente. Desde la versión que publicamos,
el teléfono pregunta cada tanto —y cada vez que el vendedor vuelve a abrir la app, que es lo que hace
en cada comercio— si entró una lista nueva. Esa consulta es **una línea de datos**; sólo si la lista
cambió se descarga el catálogo completo, así no se le gastan los datos móviles al vendedor.

**En la práctica:** ustedes mandan a las 11:00 y el vendedor ve el precio nuevo en el comercio
siguiente. Con la app abierta y quieta, hasta veinte minutos.

---

## Cómo saber que sigue funcionando dentro de tres meses

Esta parte se suele saltear y es la que más importa: **un envío automático que deja de correr no
avisa**. El catálogo se queda con los precios de la última vez que anduvo, y el primero en enterarse
termina siendo un vendedor cobrando mal frente a un comercio.

Hay dos controles, y conviene tener los dos:

- **De su lado:** el registro diario en `C:\DisTAt\registros\`. Si un día **no hay archivo**, ninguna
  de las tres tareas corrió; si el archivo tiene **menos de tres respuestas**, faltó alguna. Vale la
  pena mirarlo todos los días la primera semana, y después de vez en cuando.
- **Del nuestro:** la pantalla de catálogo muestra *"Precios actualizados hace N horas · N filas"*, y
  se pone en **ámbar pasadas 36 horas** sin recibir una lista.

---

## Checklist de puesta en marcha

- [ ] Nos avisaron a qué hora termina el export, para agendar el envío después
- [ ] Carpeta copiada en `C:\DisTAt\`
- [ ] `token.txt` creado, con la llave adentro y permisos restringidos
- [ ] `enviar-precios.bat` editado con la ruta real del archivo
- [ ] Probado a mano desde PowerShell: **`HTTP 200`**
- [ ] Las **tres** tareas creadas (06:00, 11:00, 16:00), de lunes a sábado
- [ ] En las tres: *"Ejecutar tanto si el usuario inició sesión como si no"* ✅
- [ ] En las tres: *"Ejecutar la tarea lo antes posible si se pasó por alto un inicio programado"* ✅
- [ ] Al día siguiente: el registro tiene **tres** respuestas
- [ ] Alguien de ustedes sabe dónde está el registro y qué mirar
- [ ] Alguien de ustedes leyó la sección **"Si el servidor se apaga o se reinicia"**

---

**Cualquier duda, por chica que parezca, pregúntennos.** Es preferible una consulta de dos minutos que
un catálogo con precios equivocados.
