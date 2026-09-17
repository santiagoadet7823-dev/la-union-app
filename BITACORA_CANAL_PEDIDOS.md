# Bitácora — el canal de pedidos hacia el ERP

Qué se hizo, qué se decidió y por qué, y qué quedó abierto. Sesión del **10–11/09/2026**.

Documentación de referencia, que es donde hay que ir a buscar el detalle:

- **`GUIA_EXPORT_PEDIDOS.md`** — cómo funciona el canal (formato, endpoint, cursor, seguridad).
- **`PARA_EL_CLIENTE_PEDIDOS.md`** — la versión para La Unión.
- **`db/62_pedidos_erp.sql`** — la migración, con el porqué de cada decisión.
- **`DisT-At - pedidos (para el cliente).zip`** — el paquete instalable.

---

## 1. De dónde salió esto

El cliente factura y arma su logística desde su propio sistema de gestión. Lo único que teníamos
era un botón que bajaba un `.txt` **con un formato inventado**: se escribió en agosto sin ver un
archivo real y estaba declarado como provisorio en su propio encabezado.

El 09/09/2026 llegó por fin **un archivo real de su ERP** (`20260909164538.txt`, 300 filas). Con eso
se cerraron tres cosas: el formato, los datos que faltaban capturar, y el canal de salida.

El pedido concreto del cliente fue: *ejecutar un comando que levante su servidor Java, que pida los
pedidos al backend, y que los que surjan después se adjunten a la próxima petición para no bajar
toda la base cada vez.* Reciben un archivo llamado `Pedidos.txt`.

---

## 2. Lo que se descubrió leyendo el archivo real

El archivo llegó **sin la fila de encabezados**, así que el mapeo se dedujo. La aritmética lo ancló:
**campo 9 = Σ(campo 19 × campo 21)**, verificado en varios comprobantes.

Son **25 campos separados por TAB, sin encabezado**, una fila por renglón con la cabecera repetida,
`\r\n`, sin BOM. De esos 25, **11 son constantes cuyo significado no sabemos**.

Tres hallazgos que cambiaron el alcance del trabajo:

**a) Cantidades fraccionadas.** El archivo trae renglones de `0.5` y `pedido_items.cantidad` era
`int`: media unidad no se podía ni cargar en la app, y el exportador viejo la redondeaba a 1 al
emitir — o sea que habría facturado de más, sin ningún error.

**b) Los totales del ERP no cuadran con sus propios renglones.** El pedido `1788956231931` declara
`203254` y sus líneas suman `203254.44`; el `1788963940252` declara `93186.9` y suman `93187`. Su
sistema calcula el total con más precisión de la que emite. Es tranquilizador —su importador tolera
un total que no es la suma exacta— y por eso nosotros emitimos **la suma**: que el archivo cierre
consigo mismo vale más que arrastrar centavos.

**c) El campo 1 y el campo 6 son dos relojes distintos.** La diferencia crece con la cantidad de
renglones (6 renglones → 1 min, 14 → 6 min): su app genera el id al ABRIR el pedido y sella la fecha
al CONFIRMARLO.

---

## 3. Lo que se hizo

### Base (`db/62_pedidos_erp.sql`, aplicada)

| Cambio | Por qué |
|---|---|
| `pedidos.forma_pago`, `fecha_entrega`, `observaciones` | El ERP los pide y no se capturaban en ningún lado |
| `pedidos.exportado_ts`, `export_lote` | El cursor de exportación |
| `pedido_items.cantidad` → `numeric(10,2)` | Habilita el `0.5` del archivo real |
| `pedido_items.cantidad_entregada` → `numeric(10,2)` | Si se piden 0.5, se entregan 0.5 |
| `pedido_items.codigo_producto` | Campo 18, **copiado** al confirmar |
| `perfiles.codigo_erp` | Campo 3, si resulta ser el vendedor |
| `clientes.forma_pago_default` | La condición pactada con cada comercio |
| `empresas.export_erp` (jsonb) | **Las 11 constantes del layout**, fuera del código |
| `exportaciones_pedidos` | Bitácora de cada envío |
| `ingesta_tokens.proposito` → `+ 'pedidos'` | Superficie propia |
| RPC `tomar_lote_pedidos`, `pedidos_de_lote`, `reponer_pedidos_para_export` | Tomar lote, reponer, soporte |
| Triggers `pedido_exportado_congelado` / `item_exportado_congelado` | Congelan lo ya facturado |

### Código

| Archivo | Qué |
|---|---|
| `web/src/lib/asciiPedidos.js` | **nuevo** — el layout de 25 campos, compartido por los dos emisores |
| `web/src/features/pedidos/exportarPedidos.js` | Reescrito sobre la lib; sin encabezado ni BOM |
| `web/src/features/pedidos/exportado.js` | **nuevo** — la guarda de "ya facturado" |
| `web/src/features/vendedor/ConfirmarPedidoSheet.jsx` | **nuevo** — la hoja de cabecera del pedido |
| `web/src/features/vendedor/useJornada.js` | Los tres campos nuevos + `codigo_producto` congelado |
| `web/src/features/pedidos/usePedidos.js` | Columnas nuevas; el código sale de la línea |
| `editarPedido.js`, `anularPedido.js`, `DetallePedido.jsx`, `TicketPedido.jsx` | Bloqueo y visualización |
| `supabase/functions/export-pedidos/` | **nueva** Edge Function, desplegada |
| `scripts/sync-export-pedidos.mjs` | Mantiene la copia de la lib al día |
| `scripts/verificar-formato-pedidos.mjs` + `scripts/fixtures/` | La verificación del formato |
| `scripts/cliente/BajarPedidos.java`, `bajar-pedidos.ps1`, `BAJAR-PEDIDOS.bat`, `PROBAR.bat`, `probar-pedidos.ps1`, `config.txt` | El paquete del cliente |

---

## 4. Las decisiones que importan

### El cursor es una marca por fila, no un "último timestamp"

Es la decisión que sostiene todo el canal. El vendedor toma pedidos sin señal y la cola los sube
cuando aparece: **un pedido de las 09:00 puede llegar a la base a las 18:00, después del lote de las
17:00**. Con un cursor por fecha ese pedido no entra en ningún lote nunca y nadie se entera — el ERP
factura de menos y los dos sistemas quedan sin cuadrar.

Verificado empíricamente: se tomó el lote 1 a las 23:45, después se insertó un pedido con
`created_at` de las 09:00 del mismo día, y entró en el lote 2.

### El freno de edición NO se hizo con RLS

La idea original era endurecer `pedidos_upd` con `exportado_ts is null`. **Eso rompe el reparto
entero**: el pedido se factura a la mañana y se entrega a la tarde, así que después de exportado el
repartidor todavía tiene que escribir `estado`, `ts_en_camino`, `cantidad_entregada`. Una policy
decide por FILA, no por columna.

Se resolvió con triggers que miran columna por columna. Verificado con cinco casos, incluida una
entrega parcial de `0.5`.

Y en la app la guarda va **antes de encolar**: la write queue es FIFO y **corta al primer fallo**,
así que una mutación que la base va a rechazar no se pierde sola — tapona la cola y se lleva puestos
los pedidos nuevos de un vendedor que está en la calle.

### Las 11 constantes no están en el código

Viven en `empresas.export_erp`. No es elegancia: no sabemos qué significan, y el día que el cliente
conteste hay que poder corregirlo con un `update`, no con un release de APK para teléfonos que no
siempre actualizan.

### El vendedor NO ve selector de forma de pago

Que el campo 7 sea la forma de pago **es una deducción**. Ofrecerle etiquetas inventadas mapeadas a
códigos inventados sería peor que no preguntar: cargaría un dato falso con cara de dato bueno.
Cuando lleguen los códigos se cargan en `export_erp.formas_pago` y el selector aparece solo.

---

## 5. Bugs encontrados ejecutando (no leyendo)

**1. El canal automático emitía UTC.** El código decía "hora local, nunca UTC (regla 23)" y era
cierto en el teléfono — pero el runtime de la Edge Function es UTC. Un pedido de las 22:33 salía
como `11/09/2026 01:33`: **día de facturación equivocado para todo pedido posterior a las 21:00**.
Se corrigió fijando la zona explícitamente (`America/Argentina/Salta`, configurable por empresa), de
modo que los dos runtimes den lo mismo siempre.

**2. `EnviarPrecios.java` no compilaba en Windows.** `javac` asume windows-1252 y falla con
`unmappable character` en un comentario del propio archivo. Estaba así desde que se escribió, en el
canal de precios. Se documentó `-encoding UTF-8` en los dos Java.

**3. El em-dash de las observaciones.** `—` no existe en Latin-1: si el cliente pide `?enc=latin1`
se convertiría en `?`. Se cambió por un separador ASCII.

---

## 6. Verificaciones hechas

| Qué | Resultado |
|---|---|
| Formato contra el archivo real del ERP | **23/23 filas idénticas** fuera de los campos 6, 9 y 10, que no pueden coincidir por diseño |
| Aritmética (campo 9 = Σ cantidad × precio) | Cuadra |
| Triggers de congelado | 5 casos: monto, anulación y cantidad bloqueados; **reparto y entrega de 0.5 funcionando**; cursor no editable |
| Incremental | GET → N pedidos · GET → 204 · pedido nuevo → GET → sólo ese |
| Pedido que sube tarde | Entra en el lote siguiente ✅ |
| `?repetir=1` | Devuelve el mismo lote sin avanzar |
| Aislamiento entre distribuidoras | Token de una empresa, con pedido pendiente de la otra → 204, 0 bytes |
| Token cruzado | Token de `precios` contra este endpoint → 401 |
| Paquete del cliente | Descomprimido en carpeta limpia: `PROBAR.bat`, `BAJAR-PEDIDOS.bat`, `-Repetir` y `javac` — todo OK |
| Build de la app | Limpio |
| **Prueba final con el cliente** | ✅ El servidor de ellos recibió el `Pedidos.txt` (lote 2) |

---

## 7. Estado al cerrar

- Migración **aplicada** y Edge Function **desplegada**.
- Árbol de git **limpio**, todo commiteado en `main`.
- Base: **25 pedidos, 0 pendientes reales**, sin restos de prueba.
- 22 pedidos figuran como "pendientes" pero **están todos `Anulado`** (limpieza del histórico hecha
  por el usuario) y la RPC los excluye, así que no pueden salir al ERP.
- Token de `pedidos` emitido a nombre de *"pc oficina la union"*, activo.
- Los números `000030`–`000045` se consumieron en pruebas. Un salto en la numeración, sin
  consecuencias.

### ⚠️ Un error propio, registrado

Durante la sesión re-ejecuté el backfill de `db/62` (`update pedidos set exportado_ts = now() where
exportado_ts is null`) para "blindar" el histórico. **Fue un mal criterio**: ese update no distingue
entre un anulado viejo y un pedido real todavía sin enviar, así que si hubiera habido uno pendiente
lo habría marcado como enviado y no se habría facturado nunca, en silencio. En este caso no se
perdió nada porque los 24 afectados estaban anulados, pero la operación era riesgosa. Otra sesión lo
detectó y dejó el aviso correspondiente en `db/62` (commit *"el backfill no se re-ejecuta (mordió
dos veces en 48 h)"*). **El backfill se corre una sola vez, en la migración.**

---

## 8. Lo que queda abierto

### Del cliente — bloqueante para cerrar el formato

1. **Los encabezados del archivo.** Sin ellos, 11 campos son deducción.
2. **El campo 7**: ¿es la forma de pago? Y su tabla de códigos. Hasta entonces el vendedor no ve el
   selector.
3. **El campo 3 (`002`)**: ¿vendedor, sucursal o depósito?
4. **El campo 1**: ¿acepta nuestro `numero` de 6 dígitos? Hoy se manda el epoch y el correlativo
   viaja en observaciones.
5. **Codificación** (UTF-8 o Latin-1), **decimales de relleno**, y si su ERP **borra `Pedidos.txt`**
   después de importarlo.

### Nuestro

- **20 comercios sin código de cliente** (de 2021). Sus pedidos salen con el campo 4 vacío y el ERP
  no puede identificarlos. Hoy sólo uno tiene un pedido hecho (`000042`, de Abregu blanca, cargado
  por Javier). **Se acordó una sincronización de códigos y nombres con el cliente en los próximos
  días**, que es la solución de fondo.
- **Pendiente de decidir**: que el archivo avise (`FALTA CODIGO: <comercio>` en observaciones) y que
  la app muestre en gestión los comercios sin código. Las dos tocan `asciiPedidos.js`.
- **Los teléfonos todavía no tienen la hoja de confirmación.** Compila, pero no se sacó APK ni OTA.
  Mientras tanto los pedidos salen sin forma de pago, fecha de entrega ni observaciones cargadas por
  el vendedor.

---

## 9. Para el que siga

- **Si tocás `web/src/lib/asciiPedidos.js`, corré `node scripts/sync-export-pedidos.mjs` antes de
  desplegar.** La copia de la Edge Function no se actualiza sola, y si queda vieja los dos emisores
  sacan formatos distintos **sin que ninguno falle**: el archivo sale corrido, en silencio.
- **Antes de tocar el formato, corré `node scripts/verificar-formato-pedidos.mjs`.** Y si el cliente
  manda un archivo nuevo, pasáselo como argumento: es la forma de convertir "se ve parecido" en un
  número.
- **El backfill de `db/62` no se re-ejecuta.** Ver §7.
