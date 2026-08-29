# Guía — Envío automático de la lista de precios

**29/08/2026 · para el equipo técnico de la distribuidora.**

Esto es el paso a paso para que **el sistema de gestión mande la lista de precios solo, varias veces
por día, sin que nadie toque nada**. Los scripts ya están hechos: la parte de ustedes es apuntarlos
al archivo que su ERP exporta y agendarlos.

Acompaña a [ESPECIFICACION_LISTA_PRECIOS.md](ESPECIFICACION_LISTA_PRECIOS.md), que es donde están
las columnas y las reglas del formato. **Esta guía no las repite**: si algo del archivo no cierra, la
respuesta está allá.

---

## 1. Lo que hay que saber antes de empezar

| | |
|---|---|
| **A dónde se manda** | `POST https://lqhtxivednffpiicnbog.supabase.co/functions/v1/ingest-precios` |
| **Con qué se autentica** | Un token que les entregamos por canal privado, en el header `Authorization: Bearer <TOKEN>` |
| **Qué se manda** | El archivo de texto que ya exportan (tabulado, `;` o `,`), **con la fila de encabezados primero** |
| **Cuándo** | **06:00, 11:00 y 16:00**, lunes a sábado — tres corridas del mismo script (§3.4) |
| **Cuánto tarda** | Segundos. Las 541 filas del archivo de prueba entraron en menos de 2 |

### 🔴 Tres cosas que hay que respetar

1. **El token identifica a la distribuidora.** Quien lo tenga puede escribir el catálogo. No va
   dentro del archivo, no va en un correo, no va a un repositorio. Los scripts lo leen de una
   variable de entorno o de un `token.txt` con permisos restringidos.
2. **El envío automático NO da de baja productos.** Eso se pide aparte (`?lista_completa=1`) y los
   scripts **no lo usan**. Las bajas se hacen a mano desde la app, leyendo el conteo antes de
   confirmar.
3. **Loguear siempre la respuesta.** Es la única forma de saber que la lista entró. Los scripts ya
   lo hacen, un archivo por día con las tres corridas adentro.
4. **Los teléfonos tienen que estar en la versión 1.22.0 o superior.** Antes de esa versión la app
   cargaba el catálogo una sola vez al abrirse: el envío de las 11:00 entraba en el sistema pero el
   vendedor que ya estaba en la calle seguía viendo los precios de las 06:00. Desde 1.22.0 el
   teléfono va a buscar la lista nueva solo (§7).

---

## 2. Los archivos que les pasamos

Todos están en la carpeta `cliente/`:

| Archivo | Para qué |
|---|---|
| `enviar-precios.ps1` | **Windows.** Hace el envío, guarda el registro y reintenta si falla la red |
| `enviar-precios.bat` | **Windows.** Lo que se pega en el Programador de tareas (llama al `.ps1`) |
| `enviar-precios.sh` | **Linux / macOS.** Lo mismo, para `cron` |
| `EnviarPrecios.java` | Por si prefieren llamarlo **desde adentro** del sistema de gestión en vez de agendar una tarea aparte |

---

## 3. Windows — puesta en marcha

### 3.1 Copiar y configurar

1. Copiar la carpeta a, por ejemplo, `C:\DisTAt\`.
2. Crear `C:\DisTAt\token.txt` con el token adentro, **en una sola línea y sin comillas**.
3. Botón derecho sobre `token.txt` → *Propiedades → Seguridad*: dejar acceso sólo a la cuenta que va
   a correr la tarea y a los administradores.
4. Abrir `enviar-precios.bat` con el Bloc de notas y cambiar **una sola línea**, la ruta del archivo
   que exporta el sistema de gestión:

```
set ARCHIVO=C:\ERP\export\lista-precios.txt
```

### 3.2 Probarlo a mano ANTES de agendarlo

Desde PowerShell, parados en `C:\DisTAt\`:

```powershell
.\enviar-precios.ps1 -Archivo "C:\ERP\export\lista-precios.txt"
```

Tiene que imprimir `HTTP 200` y un resumen. Si dice otra cosa, ver §6.

### 3.3 Agendar la PRIMERA corrida

*Programador de tareas → Crear tarea* (no "tarea básica", que no tiene las opciones de abajo):

| Pestaña | Qué poner |
|---|---|
| **General** | Nombre: `DisT-At — precios 06:00`. Marcar **"Ejecutar tanto si el usuario inició sesión como si no"** y **"Ejecutar con los privilegios más altos"** |
| **Desencadenadores** | Nuevo → Diariamente → **06:00**. Si prefieren sólo días hábiles, usar "Semanalmente" y tildar lunes a sábado |
| **Acciones** | Nueva → *Iniciar un programa* → Programa: `C:\DisTAt\enviar-precios.bat` → **Iniciar en: `C:\DisTAt`** ⚠️ este campo no es opcional |
| **Condiciones** | **Destildar** "Iniciar la tarea sólo si el equipo está conectado a la corriente alterna" |
| **Configuración** | Tildar "Ejecutar la tarea lo antes posible si se pasó por alto un inicio programado" — cubre el servidor que estaba apagado a esa hora |

### 3.4 🔴 Las otras dos corridas — esto es lo que hace que sirva

Una sola corrida a las 06:00 **no alcanza**: si corrigen un precio a las 10, el vendedor que ya salió
sigue con la lista de las 6 hasta mañana. Por eso van tres.

**La forma fácil:** en el Programador de tareas, botón derecho sobre la tarea que acaban de crear →
**Exportar** → guardar el `.xml`. Después **Importar tarea** dos veces, cambiando sólo el nombre y la
hora del desencadenador:

| Tarea | Hora |
|---|---|
| `DisT-At — precios 06:00` | 06:00 |
| `DisT-At — precios 11:00` | 11:00 |
| `DisT-At — precios 16:00` | 16:00 |

O, si prefieren una sola tarea: en *Desencadenadores* se pueden agregar **tres desencadenadores
diarios** a la misma tarea, uno por horario. Las dos formas funcionan igual; tres tareas separadas
son más fáciles de leer en la lista y de desactivar de a una.

> **Los horarios son una sugerencia, no una restricción.** Si les queda mejor 12:30 y 17:00, se
> cambia la hora del desencadenador y listo. Agregar una cuarta corrida es duplicar la tarea otra
> vez. Lo único que pedimos es que **ninguna** de ellas use `-ListaCompleta`.

⚠️ **Cada corrida tiene que salir DESPUÉS del export.** Si el proceso que genera
`lista-precios.txt` corre a las 05:50 y a veces se estira, conviene mover el envío 15 minutos, o
—mejor— colgarlo del final del export (§5). El script avisa en el registro si el archivo tiene más de
20 horas, pero manda igual: una lista vieja es mejor que ninguna.

---

## 4. Linux — puesta en marcha

```bash
sudo mkdir -p /opt/distat && sudo cp enviar-precios.sh /opt/distat/
sudo chmod +x /opt/distat/enviar-precios.sh
printf '%s' 'EL-TOKEN-ACA' | sudo tee /opt/distat/token.txt > /dev/null
sudo chmod 600 /opt/distat/token.txt
```

Probarlo a mano y después agendarlo con `crontab -e`. **Tres líneas, una por horario:**

```
0 6  * * 1-6 /opt/distat/enviar-precios.sh /srv/erp/export/lista-precios.txt
0 11 * * 1-6 /opt/distat/enviar-precios.sh /srv/erp/export/lista-precios.txt
0 16 * * 1-6 /opt/distat/enviar-precios.sh /srv/erp/export/lista-precios.txt
```

Cambiar un horario es cambiar el número de la hora; agregar uno es agregar una línea.

> ⚠️ **`cron` no hereda el entorno de la sesión.** Una variable `DISTAT_TOKEN` exportada en el
> `.bashrc` **no existe** cuando la tarea corre. Por eso conviene el `token.txt`.

---

## 5. Desde adentro del sistema de gestión (opcional, y es la mejor opción)

Si el ERP ya tiene un proceso nocturno que genera el export, lo más robusto es llamar al envío
**al terminar ese proceso** en vez de agendar una tarea aparte a una hora fija. Así el envío ocurre
siempre después de que el archivo está completo, y si el export se atrasa el envío se atrasa con él.

`EnviarPrecios.java` es eso, sin dependencias (`java.net.http`, Java 11+):

```java
EnviarPrecios.Respuesta r = EnviarPrecios.enviar(Path.of(rutaExport), token, false);
log.info("ingesta precios: HTTP {} {}", r.codigo, r.cuerpo);
```

---

## 6. Qué hacer con cada respuesta

El script escribe todo en `registros/precios-AAAA-MM-DD.log`.

| Respuesta | Qué significa | Qué hacer |
|---|---|---|
| `HTTP 200` con `recibidas`, `actualizados`… | Entró | Nada. Si `rechazadas` no está vacío, mirar esas filas: el motivo viene con el **número de fila** tal como se ve en Excel |
| `HTTP 400 falta-encabezado` | El archivo arranca directo con datos | Agregar la primera fila con los nombres de columna, **con el mismo separador que los datos**. La respuesta trae un ejemplo listo para copiar |
| `HTTP 400 archivo-vacio` | El export no generó nada | Revisar el proceso del ERP. **No es un problema del envío** |
| `HTTP 401` | Token inválido o revocado | Pedirnos uno nuevo. No reintentar |
| `HTTP 409 demasiadas-bajas` | Sólo puede pasar con `?lista_completa=1`: el archivo dejaría fuera más del 20 % del catálogo. **No se escribió nada** | Avisarnos. Es el freno que evita que un export parcial borre el catálogo |
| `HTTP 413` | Más de 5.000 filas | Partir el envío, o avisarnos |
| Error de red | No llegamos al servidor | El script reintenta solo a los 15 y a los 30 minutos. Si igual falla, queda en el registro |

**Filas rechazadas más frecuentes**, y las dos son de formato, no del envío:

- `precio ambiguo: "1.450"` — el export está poniendo separador de miles. `1.450` puede ser mil
  cuatrocientos cincuenta o uno coma cuarenta y cinco, y **el sistema no lo adivina**: rechaza esa
  fila y deja el resto entrar. Se arregla sacando el separador de miles del export.
- `desde_2 (5) no es mayor que desde_1 (10)` — los escalones tienen que ir de menor a mayor.

---

## 7. Cómo llega al teléfono, y cómo saber que sigue funcionando

### Cómo le llega el precio nuevo al vendedor que ya está en la calle

Esto es la otra mitad de los tres horarios, y sin ella no servirían de nada.

Hasta la versión 1.21.0 la app cargaba el catálogo **una sola vez, al abrirse**: el vendedor que
abría a las 8 tenía la lista de las 6 hasta el día siguiente. Desde **1.22.0** el teléfono pregunta
cada tanto —y cada vez que el vendedor vuelve a abrir la app, que es lo que hace en cada comercio— si
entró una lista nueva. Esa pregunta es **una línea de datos**; sólo si la lista cambió se baja el
catálogo completo, así no se le queman los datos móviles al vendedor.

**En la práctica:** ustedes mandan a las 11:00 y el vendedor ve el precio nuevo la próxima vez que
abre la app, normalmente en el comercio siguiente. Con la app abierta y quieta, hasta 20 minutos.

⚠️ Si un teléfono quedó en una versión anterior, el envío entra igual en el sistema pero **ese**
teléfono sigue con la lista con la que arrancó el día. Es una razón más para que el parque esté al
día.

### Cómo saber que sigue funcionando dentro de tres meses

Esta es la parte que se suele saltear, y es la que importa: **un envío automático que deja de correr
no avisa**. El catálogo se queda con los precios de la última vez que anduvo, y el primero que se
entera es un vendedor cobrando mal frente a un comercio.

Hay dos controles, y conviene tener los dos:

1. **De su lado:** el registro diario. Si un día no hay archivo `precios-AAAA-MM-DD.log`, ninguna
   de las tres tareas corrió; si el archivo tiene **menos de tres respuestas**, faltó alguna. Vale la
   pena mirarlo la primera semana todos los días, y después de vez en cuando.
2. **Del nuestro:** la app muestra en la pantalla de catálogo un renglón que dice **"Precios
   actualizados hace N horas · N filas"**, y se pone en **ámbar pasadas 36 horas** sin recibir una
   lista. La persona que administra el catálogo lo ve al entrar, sin buscar nada.

---

## 8. Checklist de puesta en marcha

- [ ] Nos avisan a qué hora termina el export del ERP, para agendar el envío después
- [ ] Token recibido y guardado en `token.txt` con permisos restringidos
- [ ] `enviar-precios.bat` apuntando al archivo correcto
- [ ] Probado a mano: `HTTP 200`
- [ ] Las **tres** tareas programadas creadas (06:00, 11:00, 16:00), lunes a sábado
- [ ] Verificado que corrieron solas al día siguiente: el registro tiene **tres** respuestas
- [ ] Confirmado que los teléfonos están en 1.22.0 o superior (si no, sólo sirve la corrida de la mañana)
- [ ] Alguien de ustedes sabe dónde está el registro y qué mirar

> ⚠️ **Antes del primer envío automático van los pasos manuales** del §6 de la especificación:
> archivo de prueba de 20 filas → revisar en la app → lista completa a mano → recién ahí, esto.
