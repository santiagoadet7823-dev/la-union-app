# GUÍA — El canal de pedidos hacia el ERP

Cómo salen los pedidos hacia el sistema de gestión de la distribuidora. Escrito el 10/09/2026,
verificando contra **la base viva y el endpoint desplegado** (regla 5: los `db/*.sql` no son fuente
de verdad).

Gemelo de `GUIA_ENVIO_AUTOMATICO_PRECIOS.md`, que documenta el canal de ENTRADA.

---

## 1. Qué se resolvió

La distribuidora factura y arma la logística desde su ERP. Hasta el 09/09/2026 la única salida era
un botón que bajaba un `.txt` **con un formato inventado**, escrito en agosto sin ver un archivo
real — y declarado provisorio en su propio encabezado.

El 09/09 llegó un archivo real (`20260909164538.txt`, 300 filas). Con él se cerraron tres cosas:

1. **El formato**, que ahora reproduce el suyo y está verificado fila por fila.
2. **Los datos que faltaban** — forma de pago, fecha de entrega, observaciones, cantidad fraccionada
   y el código de producto congelado en la línea.
3. **El canal**: el cliente ejecuta un comando, su servidor Java pide los pedidos y recibe sólo lo
   nuevo desde la vez anterior.

---

## 2. El formato

**25 campos separados por TAB, sin fila de encabezado, una fila por renglón** con la cabecera del
pedido repetida. `\r\n`, UTF-8 **sin BOM**.

Vive en un solo lugar: **`web/src/lib/asciiPedidos.js`**. Lo usan los dos emisores —el botón de la
app y la Edge Function—, y la copia de la Edge Function la mantiene al día
`node scripts/sync-export-pedidos.mjs`. Dos implementaciones sería la regla 36, y el modo de falla
es el peor que hay acá: el que se queda viejo **no falla**, emite un archivo corrido en silencio.

| # | Qué es | De dónde sale |
|---|---|---|
| 1 | id del pedido | epoch ms de `created_at` (configurable a `numero`) |
| 2 | constante | `export_erp.campo_2` |
| 3 | vendedor / sucursal | `perfiles.codigo_erp`, si no `export_erp.campo_3` |
| 4 | código de cliente | `clientes.codigo` **crudo** |
| 5 | constante | `export_erp.campo_5` |
| 6 | fecha y hora | `created_at`, zona de la empresa |
| 7 | forma de pago (probable) | `pedidos.forma_pago` → `clientes.forma_pago_default` → default |
| 8 | constante | `export_erp.campo_8` |
| 9 | total | **Σ(cantidad × precio)**, no `monto_total` |
| 10 | fecha de entrega | `pedidos.fecha_entrega`, o el campo 6 |
| 11-13 | constantes en cero | `export_erp` |
| 14 | observaciones | `pedidos.observaciones` + nuestro `numero` |
| 15-16 | constantes | `export_erp` |
| 17 | nro de renglón | posición, reinicia por pedido |
| 18 | código de producto | `pedido_items.codigo_producto` (copiado) |
| 19 | cantidad | `pedido_items.cantidad` — admite `0.5` |
| 20 | constante | `export_erp.campo_20` |
| 21 | precio unitario | `pedido_items.precio_unitario` (congelado) |
| 22-25 | constantes | `export_erp` |

### Las constantes no están en el código

Viven en **`empresas.export_erp`** (jsonb, db/62). El motivo no es elegancia: **11 de los 25 campos
son constantes cuyo significado no sabemos** — los encabezados del archivo nunca llegaron. El día
que el cliente diga qué es el campo 7 hay que poder corregirlo con un `update`, no con un release de
APK para teléfonos que no siempre actualizan.

```sql
update empresas set export_erp = export_erp || '{"campo_7_es":"forma_pago"}'::jsonb
 where nombre = 'LA UNIÓN';
```

### Cómo se verifica

```bash
node scripts/verificar-formato-pedidos.mjs                    # contra el fixture del 09/09
node scripts/verificar-formato-pedidos.mjs /ruta/otro.txt     # contra un archivo nuevo del cliente
```

Parsea el archivo del ERP hacia atrás, lo vuelve a emitir con nuestro código y compara campo por
campo. Hoy: **23/23 filas idénticas** fuera de tres campos que no pueden coincidir por diseño y que
el propio script explica (6, 9 y 10).

> 🩸 **Los totales del ERP no cuadran con sus propios renglones.** El pedido `1788956231931` declara
> `203254` y sus líneas suman `203254.44`; el `1788963940252` declara `93186.9` y suman `93187`.
> Calcula el total con más precisión interna de la que emite. Es tranquilizador —su importador
> tolera un total que no es la suma exacta— y es la razón por la que nosotros emitimos la **suma**:
> que el archivo cierre consigo mismo vale más que arrastrar una diferencia de centavos.

> 🩸 **El campo 1 y el campo 6 son dos relojes distintos en su archivo.** La diferencia crece con la
> cantidad de renglones (6 renglones → 1 min, 3 → 2 min, 14 → 6 min): su app genera el id al ABRIR
> el pedido y sella la fecha al CONFIRMARLO. En el nuestro los dos salen de `created_at`.

---

## 3. El cursor: qué se manda y qué no

🔑 **`pedidos.exportado_ts` es una marca POR FILA, no un "último timestamp".** Es la decisión que
sostiene todo el canal.

El vendedor toma pedidos sin señal y la cola los sube cuando aparece: un pedido de las 09:00 puede
llegar a la base a las 18:00, **después** del lote de las 17:00. Con un cursor por fecha ("mandame
lo posterior a T") ese pedido no entra en ningún lote nunca, el ERP factura de menos y nadie se
entera. Con la marca por fila entra solo en el lote siguiente.

Verificado el 10/09/2026: se tomó el lote 1 a las 23:45, después se insertó un pedido con
`created_at` de las 09:00 del mismo día, y entró en el lote 2.

**Qué NO entra en un lote:**
- los anulados;
- las cabeceras **sin renglones** — la cola es FIFO y sube la cabecera primero, así que hay una
  ventana real donde el pedido existe sin líneas. Mandar media factura es peor que mandarla en el
  lote siguiente.

**El histórico quedó marcado como ya enviado** (`export_lote = 0`, 23 pedidos). Sin ese backfill el
primer GET se llevaba todo lo viejo y le duplicaba la facturación de lo ya hecho a mano.

---

## 4. El endpoint

```
GET https://<proyecto>.supabase.co/functions/v1/export-pedidos
Authorization: Bearer <token con proposito='pedidos'>
```

| Parámetro | Qué hace |
|---|---|
| *(ninguno)* | toma el lote siguiente, lo marca y lo devuelve |
| `?repetir=1` | devuelve el ÚLTIMO lote **sin avanzar el cursor** |
| `?lote=N` | repone un lote concreto (soporte) |
| `?probar=1` | arma el archivo **sin marcar nada** (puesta en marcha) |
| `?enc=latin1` | responde en Latin-1 en vez de UTF-8 |

Respuestas: **200** con el archivo · **204** sin novedades (cuerpo vacío) · **401** token inválido o
de otro propósito · **404** lote inexistente.

Headers de respuesta: `X-Lote`, `X-Pedidos`, `X-Filas`. El script del cliente los deja en su registro
diario — es el único lugar donde alguien del lado de ellos puede notar que un día no llegó nada.

**`?repetir=1` es la red de seguridad que hay que conocer.** Si la respuesta salió bien pero el
archivo se perdió del lado del cliente (disco lleno, proceso muerto, carpeta equivocada), esos
pedidos ya figuran como entregados y **no vuelven solos**: el cursor avanzó y el layout no tiene
forma de pedirlos de nuevo.

### Seguridad

Calcado de `ingest-precios`, con la regla de oro intacta: **`id_empresa` sale del TOKEN, nunca del
request**. Verificado el 10/09 con las dos distribuidoras vivas: con el token de una, y un pedido
pendiente de la otra, la respuesta fue 204 y 0 bytes.

`proposito = 'pedidos'` es propio (db/62). Un token de precios contra este endpoint da 401: de las
tres superficies ésta es la más sensible — expone qué compró cada comercio y a cuánto.

### Emitir un token

```sql
insert into ingesta_tokens (id_usuario, id_empresa, proposito)
values ('<perfil de la PC del cliente>', '<empresa>', 'pedidos')
returning token;
```

---

## 5. El comando del cliente

En `scripts/cliente/`:

| Archivo | Para qué |
|---|---|
| `BajarPedidos.java` | para embeber en su servidor Java — es lo que el cliente pidió |
| `bajar-pedidos.ps1` | el mismo trabajo desde PowerShell |
| `BAJAR-PEDIDOS.bat` | el puente para el Programador de tareas / doble clic |

Los tres escriben **`Pedidos.txt`** (el nombre que ellos ya reciben) en la carpeta que el ERP lee.

> ⚠️ **Compilar el Java con `-encoding UTF-8`.** Sin eso `javac` asume windows-1252 en un Windows en
> español y **falla en un comentario**. `EnviarPrecios.java` tenía el mismo problema desde que se
> escribió; se descubrió el 10/09/2026 probando su gemelo y se documentó en los dos.

Dos comportamientos que no son obvios y que hay que respetar si alguien los reescribe:

1. **Escritura atómica.** Se escribe `Pedidos.txt.tmp` en la misma carpeta y recién entonces se
   renombra. Si el ERP vigila la carpeta, un archivo a medio escribir es una importación corrupta —
   y a diferencia de un error, ésa no avisa: importa lo que alcanzó a leer y lo da por bueno.
2. **Sin novedades no se toca el archivo anterior.** Pisarlo con uno vacío haría que, si el ERP
   todavía no importó el lote anterior, lo pierda — y un archivo vacío se importa sin error.

---

## 6. La bitácora

`exportaciones_pedidos` (db/62), lectura para `admin`. Una fila por llamada, **incluidas las
rechazadas**: es la lección textual de `ingest-precios`, donde los 400 se devolvían antes de llegar
a la capa que escribía la bitácora y "cero errores registrados" se leía como "está todo bien" —
mientras había dos máquinas mandando con el mismo token.

Guarda los `ids` del lote, que es lo que permite reponerlo sin mover el cursor.

```sql
select ts, lote, pedidos, filas, bytes, origen, error
  from exportaciones_pedidos order by ts desc limit 20;
```

Para devolver pedidos al estado "sin mandar" (sólo superadmin, deja rastro):

```sql
select reponer_pedidos_para_export(array['<uuid>']::uuid[], 'por qué');
```

---

## 7. Un pedido exportado no se reescribe

Una vez que el pedido salió a facturación, **no se puede editar ni anular desde la app**. El archivo
de 25 campos no tiene ningún campo para comunicar una corrección ni una anulación: los dos sistemas
quedarían diciendo cosas distintas sin que nada falle. La corrección se hace en el ERP.

🩸 **Esto NO se hizo con RLS, y el motivo importa.** Endurecer `pedidos_upd` con
`exportado_ts is null` **rompe el reparto entero**: el pedido se factura a la mañana y se entrega a
la tarde, así que después de exportado el repartidor todavía tiene que escribir `estado`,
`ts_en_camino`, `ts_entregado`, `cantidad_entregada` y `motivo_faltante`. Una policy decide por FILA,
no por columna, y no sabe distinguir "confirmar la entrega" de "cambiar lo que se vendió".

El freno son dos triggers (db/62) que miran columna por columna: congelan cliente, cantidades,
precios, montos, forma de pago y la anulación, y dejan abierto todo el circuito de entrega.
Verificado con los cinco casos, incluido el de una entrega parcial de `0.5`.

En la app la guarda está además **antes de encolar** (`features/pedidos/exportado.js`), y eso no es
redundancia: la write queue es FIFO y **corta al primer fallo**, así que una mutación que la base va
a rechazar no se pierde sola — tapona la cola y se lleva puesto todo lo que venga detrás, incluidos
los pedidos nuevos de un vendedor que está en la calle.

---

## 8. Lo que sigue abierto con el cliente

1. **Los encabezados del archivo.** Se pidieron y no llegaron. Sin ellos, 11 campos son deducción.
2. **Campo 7**: ¿es la forma de pago? Si sí, su tabla de códigos. Hasta entonces la app **no le
   muestra el selector al vendedor** — cargar una etiqueta inventada sería peor que no preguntar.
3. **Campo 3 (`002`)**: ¿vendedor, sucursal o depósito?
4. **Campo 1**: ¿acepta nuestro `numero` de 6 dígitos? Hoy se manda el epoch, compatible con lo que
   ya come, y el `numero` viaja en observaciones para poder cruzar los dos sistemas.
5. **Codificación**: ¿UTF-8 o Latin-1? El endpoint ya sirve las dos.
6. **Decimales**: ¿tolera `38000.00` o necesita `38000`? Hoy se emite como su archivo.
7. **¿El ERP borra `Pedidos.txt` después de importarlo?** De eso depende si se puede pisar sin
   riesgo de perder un lote no consumido.
