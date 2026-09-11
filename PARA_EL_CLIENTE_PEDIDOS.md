# Cómo les llegan los pedidos a su sistema

Para La Unión. 10/09/2026.

---

## Qué hace

Un comando que ustedes ejecutan. Pide los pedidos a nuestro servidor y deja un archivo
**`Pedidos.txt`** en la carpeta que su sistema lee, en el mismo formato de texto con tabuladores que
ya usan hoy.

**Cada vez trae solamente lo nuevo.** No hay que pasarle fechas ni recordar nada: nosotros llevamos
la cuenta de qué pedidos ya les entregamos. Si lo ejecutan a las 11 y otra vez a las 17, la segunda
vez vienen únicamente los pedidos que entraron entre medio.

Lo pueden ejecutar cuantas veces quieran y a la hora que quieran. Si no hay nada nuevo, avisa y
**no toca el archivo anterior**.

---

## Las tres formas de usarlo

Elijan una. Hacen exactamente lo mismo.

### 1. Desde su servidor Java (`BajarPedidos.java`)

Es la que pidieron. No necesita ninguna librería.

```
javac -encoding UTF-8 BajarPedidos.java
java BajarPedidos "C:\ruta\a\la\carpeta\del\ERP"
```

> ⚠️ El `-encoding UTF-8` hace falta. Sin él, `javac` en Windows falla al compilar.

O llamándolo desde el proceso que ya tienen andando:

```java
BajarPedidos.Respuesta r = BajarPedidos.bajar(Path.of(carpeta), token, false);
log.info("pedidos: HTTP {} lote {} pedidos {}", r.codigo, r.lote, r.pedidos);
```

### 2. Con doble clic (`BAJAR-PEDIDOS.bat`)

Abran el archivo con el Bloc de notas y cambien esta línea por su carpeta:

```
set "CARPETA_ERP=C:\ERP\entrada"
```

Después alcanza con hacerle doble clic. También se puede agendar en el Programador de tareas de
Windows si quieren que corra solo.

### 3. Desde PowerShell (`bajar-pedidos.ps1`)

```
.\bajar-pedidos.ps1 -Carpeta "C:\ERP\entrada"
```

---

## El token

Es la clave que identifica a la distribuidora. Se los pasamos aparte; **no está escrito dentro de
ninguno de los archivos y no hay que mandarlo por mail junto con nada más**.

Se guarda de una de estas dos formas:

- en la variable de entorno `DISTAT_TOKEN`, o
- en un archivo `token.txt` al lado de los scripts.

---

## Qué queda registrado

Cada ejecución escribe una línea en `registros\pedidos-AAAA-MM-DD.log`:

```
2026-09-10 17:05:12  HTTP 200  lote=14  pedidos=23  filas=87  ->  C:\ERP\entrada\Pedidos.txt
2026-09-10 18:05:09  HTTP 204  sin novedades  (no se toca Pedidos.txt)
```

Si un día no llegan pedidos, ese registro es el lugar donde mirar.

---

## Si se pierde un archivo

Puede pasar: se llenó el disco, se cortó la luz, el archivo quedó en la carpeta equivocada. Como
nosotros ya los dimos por entregados, esos pedidos **no vuelven solos** en la próxima ejecución.

Para recuperarlos, pidan de nuevo el último envío:

```
java BajarPedidos "C:\ruta" --repetir
```

o

```
.\bajar-pedidos.ps1 -Carpeta "C:\ERP\entrada" -Repetir
```

Eso trae otra vez el mismo archivo y **no consume** los pedidos nuevos: la próxima ejecución normal
sigue trayendo lo que corresponde.

---

## Dos cosas que nos faltan de ustedes

Ya está todo funcionando, pero hay dos datos que no pudimos confirmar y que conviene cerrar:

1. **El archivo de ejemplo que nos pasaron vino sin la fila de encabezados.** Por eso hay 11 campos
   de los 25 que estamos mandando con el valor fijo que vimos en su archivo, sin saber qué
   significan. Si nos pasan los nombres de las columnas, los ajustamos.

2. **El campo 7** (el que en su archivo viene siempre en `3`). Si es la forma de pago, necesitamos
   la lista de códigos que usan — cuál es contado, cuál cuenta corriente, cuál cheque. Hasta que nos
   la pasen, **el vendedor no ve esa opción en el celular**: preferimos no ofrecerle una lista
   inventada, porque cargaría un dato equivocado sin darse cuenta y les llegaría como si fuera
   bueno.

Con esos dos datos se ajusta de nuestro lado en el momento, sin actualizar los celulares.
