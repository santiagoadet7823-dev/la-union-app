# GUÍA — Del pedido a la factura y al reparto

Qué existe hoy, qué falta, y qué hay que pedirle al cliente. Escrito el 22/08/2026 verificando el
código **y la base viva** (regla 5: los `db/*.sql` no son fuente de verdad).

---

## 1. El código único: ya existe, no hay que inventarlo

El pedido pidió *"que el ticket, lo que se imprime y lo que toma el repartidor tengan el mismo código
para que todo esté relacionado"*. **Ya lo tienen.**

`pedidos.numero` lo asigna el trigger `asignar_numero_pedido` en el momento del INSERT, **correlativo
por empresa**, con formato `lpad(n, 6, '0')`. En la base viva hoy hay `000001`, `000002`, `000003`.

- **El cliente no lo elige y no lo puede repetir**: el contador vive en `pedidos_contador`, con RLS
  activa y **cero policies a propósito** — sólo lo toca el trigger, que es `SECURITY DEFINER`.
- **Es atómico** (`insert … on conflict do update … returning`), así que dos vendedores confirmando
  al mismo tiempo no pueden sacar el mismo número.
- El vendedor **no lo conoce al armar el pedido**: lo pone la base al llegar. Por eso el ticket se
  imprime después de guardar, no antes.

> ⚠️ `PED-2031` **no existe**. Es texto inventado del demo estático `RuteoTab.jsx`, que además no
> está importado en ningún lado. Si el sistema del cliente necesita un prefijo, se arma en el
> exportador — no se toca el trigger, porque el número ya está impreso en tickets que existen.

---

## 2. El export para facturar — CERRADO el 10/09/2026

### Ya no es provisorio

Durante tres semanas esto emitió un formato **inventado**, escrito sin ver un archivo del cliente y
declarado como tal en su propio encabezado. El 09/09/2026 llegó uno real (`20260909164538.txt`) y el
layout se rehízo contra él.

**25 campos separados por TAB, sin fila de encabezado**, una fila por renglón con la cabecera
repetida, `
`, UTF-8 **sin BOM**. Verificado con `scripts/verificar-formato-pedidos.mjs`:
**23/23 filas idénticas** fuera de tres campos que no pueden coincidir por diseño.

Lo que aquella versión acertó: el separador TAB y la forma "una fila por renglón". Lo que no: las
columnas, el encabezado, el BOM y el formato de fecha.

### Lo que hubo que agregarle al sistema

El archivo real mostró cuatro huecos que no se veían antes (db/62):

- **forma de pago, fecha de entrega y observaciones** — no existían. El pedido no tenía NINGUNA
  pantalla de cabecera: el vendedor elegía productos y cantidades y se guardaba derecho. Ahora hay
  una hoja de confirmación (`ConfirmarPedidoSheet`) con los tres campos, todos opcionales.
- **cantidad fraccionada** — su archivo trae renglones de `0.5` y `pedido_items.cantidad` era
  `int`: media unidad no se podía ni cargar, y el export la redondeaba a 1 (facturaba de más, sin
  error). Ahora es `numeric(10,2)`.
- **el código de producto** — salía por relación viva contra `productos`, así que un producto
  borrado dejaba la celda vacía en un comprobante ya vendido. Ahora se copia en la línea, igual que
  la descripción y el precio.
- **el código ERP del vendedor** (`perfiles.codigo_erp`), para el campo 3.

### El canal automático

El botón sigue estando y sirve para REVISAR. Lo que factura de verdad es el canal: el cliente
ejecuta un comando, su servidor Java pide los pedidos y recibe **sólo lo nuevo desde la vez
anterior**. Todo documentado en **`GUIA_EXPORT_PEDIDOS.md`**.

⚠️ **El botón no marca los pedidos como enviados**, y es a propósito: si lo hiciera, alguien bajando
30 días para mirarlos dejaría fuera del ERP todo lo pendiente sin enterarse.

### Lo que sigue faltando del cliente

El archivo llegó **sin la fila de encabezados**, así que 11 de los 25 campos son constantes cuyo
significado es deducción. Por eso ninguna está en el código: viven en `empresas.export_erp` y se
corrigen con un `update`. La lista completa de lo que falta preguntar está en
`GUIA_EXPORT_PEDIDOS.md` §8; las dos que importan son el campo 7 (probable forma de pago) y el
campo 3.

> ⚠️ El aviso de que `clientes_codigo_key` era UNIQUE **global** ya no corre: `db/48` lo pasó a
> único por empresa.


## 3. Quién baja los pedidos del día

**El `admin`.** La pantalla es *Pedidos*, y la ven `encargado`, `admin` y `superadmin`.

| Rol | Qué pedidos ve | Sirve para el reparto |
|---|---|---|
| `admin` | **Toda la empresa** | ✅ Es el usuario correcto |
| `superadmin` | Todas las empresas | Sirve, pero es la cuenta de quien opera el SaaS |
| `encargado` | **Sólo su gente** (`ids_a_mi_cargo()`) | ❌ Bajaría un día incompleto |

Esto **no lo decide la pantalla**, lo decide `pedidos_sel` en el servidor. Repetir la regla en el
cliente sería tener dos verdades y que una se quede vieja.

El filtro **"Hoy"** ya existe en la pantalla (Hoy / 7 días / 30 días), calculado en hora local.

---

## 4. El repartidor: qué hay y qué falta

### Lo que YA está, y es más de lo que parece

| Pieza | Estado |
|---|---|
| Rol `repartidor` válido, con login | ✅ está en el CHECK de `perfiles.rol` |
| GPS, pin naranja en el mapa, fila en supervisión | ✅ se rastrea igual que un vendedor |
| `pedidos.id_repartidor` en el esquema | ✅ existe desde el día uno |
| `pedido_items.cantidad_entregada` y `motivo_faltante` | ✅ las columnas existen |
| Estados `En camino` / `Entregado` / `No entregado` | ✅ están en el CHECK |
| **RLS**: `pedidos_sel`, `pedidos_upd`, `items_sel`, `items_upd` | ✅ **ya contemplan `id_repartidor in (select ids_a_mi_cargo())`** — verificado en la base viva |
| Motor de **ruta óptima real** (TSP) | ✅ `services/routing/index.js` → `obtenerRutaOptimaTSP()`, **ya en producción** en el botón "Calcular ruta óptima" del vendedor |
| Tabla `rutas` con `orden_paradas jsonb` | ✅ existe, vacía, sin usar |

**Consecuencia importante: el módulo de entregas no necesita ninguna migración para su núcleo.** La
RLS se escribió pensando en esto. Lo que falta es código de aplicación.

### Lo que NO existía, y se hizo en 1.21.0

Todo esto estaba vacío antes de esta tanda:

- **Nada escribía `id_repartidor`.** Cero código en toda la app — era el eslabón que faltaba, y por
  eso `RepartidorView` no podía tener nunca nada que mostrar.
  → Ahora se asigna desde el **detalle del pedido**, en gestión (`DetallePedido`).
- **`RepartidorView` arrancaba con `useState([])` y nadie lo llenaba**, con un comentario que
  prometía "los pedidos asignados, próxima etapa". Esa etapa nunca llegó: la pantalla decía
  *"no tenés entregas asignadas"* para siempre.
  → Ahora hay `useEntregas`, que lee los pedidos del día asignados a esa persona.
- **Nada se persistía.** "Marcar en camino" y "Confirmar entrega" cambiaban estado local y se
  perdían al recargar.
  → Ahora van por la **write queue** (el repartidor está en la calle y la calle no tiene señal
  garantizada), y escriben `estado`, `ts_en_camino`, `ts_entregado`, `cantidad_entregada` y
  `motivo_faltante`.
- **No había recorrido óptimo.** → Botón *"Ordenar por recorrido óptimo"*, que reusa
  `obtenerRutaOptimaTSP()` — el mismo motor que ya está en producción en el botón del vendedor.
  Sale desde la posición actual (`source=first`, `roundtrip=false`) y muestra km y minutos.

Y **un bug que habría reventado en el primer uso**: `RepartidorView` usaba `'en_camino'` y
`'entregado'` en minúscula con guión bajo, valores que **no existen en el CHECK de `pedidos.estado`**
— el UPDATE habría fallado con 23514. Se traducen en un solo lugar (`useEntregas`), sin renombrar los
estados internos de la pantalla, que gobiernan el orden de la lista y el color de la píldora.

### Lo que sigue faltando

- ⚠️ **La firma no sube.** Se dibuja, se muestra y **se pierde al recargar**. Subirla exige tocar
  `firmas_ins`, que sigue siendo `to authenticated` **sin alcance por empresa** — tal como está,
  cualquiera de cualquier distribuidora podría pisar la firma de otra. Es una migración de seguridad
  con su propia verificación, no un detalle de este módulo. **La pantalla lo dice**: donde antes
  aparecía *"Conformidad registrada"* ahora dice *"firma sólo en este teléfono"*, porque una
  conformidad que se cree guardada y no lo está es peor que no tenerla.
- ⚠️ **No hay fecha de reparto.** La hoja del día filtra por `created_at`, así que **un pedido tomado
  ayer y asignado hoy no aparece**. Es una simplificación consciente; cuando moleste, la respuesta es
  una columna de fecha de reparto, no ampliar el rango.
- ⚠️ **El recorrido no se guarda.** `rutas` existe con su `orden_paradas jsonb`, pero `rutas_wr` es
  sólo de `admin` y todavía nadie necesita leer ese orden después.
### Verificado de punta a punta el 22/08/2026

Con datos de prueba (3 pedidos, 2 comercios ubicados, un repartidor activado), **ya borrados**:

| Paso | Resultado |
|---|---|
| Asignar desde gestión | ✅ `id_repartidor` escrito en la base, por la cola y aceptado por RLS |
| La hoja del repartidor | ✅ 3 entregas con número, comercio, artículos, peso y monto reales |
| "Marcar en camino" | ✅ `estado = 'En camino'` — el valor del CHECK, no el `'en_camino'` viejo — y `ts_en_camino` sellado |
| Confirmar entrega con faltante | ✅ `estado = 'Entregado'`, `ts_entregado`, y `cantidad_entregada` por renglón |
| Recorrido óptimo | ✅ 38,8 km / 37 min sobre las 3 paradas reales, y el orden **no** es el de entrada (`[0,2,1,3]`): está optimizando |
| Sin GPS | ✅ avisa *"Hace falta el GPS para ordenar el recorrido"*, no rompe |
| Sin repartidores activos | ✅ el selector se reemplaza por *"No hay ningún repartidor activo"* en vez de un desplegable vacío |

🩸 **Y ahí apareció un bug que sólo se veía ejecutando.** El primer renglón con faltante guardó
`cantidad_entregada = 0` y **`motivo_faltante = NULL`**, mientras la pantalla mostraba *"Sin stock"*
seleccionado. El default vivía **sólo en el render** (`motivos[k] || 'Sin stock'`) y nunca entraba al
estado: si el repartidor no tocaba el chip, se guardaba null. La pantalla decía una cosa y el dato
guardaba otra, sin error. Arreglado moviendo `MOTIVO_CHIPS` y `MOTIVO_POR_DEFECTO` a `useEntregas`,
al lado del guardado — un solo default para los dos. Re-verificado: ahora persiste `'Sin stock'`.

⚠️ **Lo que la prueba consumió**: los números `000004`, `000005` y `000006` quedaron gastados. Las
filas se borraron pero `pedidos_contador` no vuelve atrás, así que el próximo pedido real será
`000007`. Un salto en la numeración, sin ninguna consecuencia.

### 🔴 El repartidor NO puede elegir sus pedidos por sí mismo — y hay que decidirlo

El pedido original fue *"que el repartidor indique qué pedidos está llevando en su viaje"*. **Hoy la
RLS no lo permite, y no es un descuido.**

Verificado simulando la sesión del repartidor contra la base viva: `ids_a_mi_cargo()` le devuelve
**1 fila (él mismo)**, y `pedidos` le devuelve **cero filas**. No puede ver un pedido sin asignar, así
que mucho menos reclamarlo.

Por eso lo que se implementó es **la asignación desde gestión** (en el detalle del pedido, un selector
de repartidor). Funciona hoy, sin migración — verificado: como `admin`, el `USING` y el `WITH CHECK`
de `pedidos_upd` dan `true` en los tres pedidos reales, antes y después del cambio.

Para que el repartidor se auto-asigne haría falta una policy nueva que le deje **ver los pedidos sin
asignar de su empresa**. Eso tiene una consecuencia que no es técnica: **un repartidor pasaría a ver
la cartera de pedidos completa de la distribuidora** — quién compró qué, a cuánto y cuánto gastó cada
comercio. Es la misma clase de decisión que se tomó al dejar a `marketing` fuera de los recorridos.

Las tres opciones, para elegir:

| | Qué ve el repartidor | Trabajo |
|---|---|---|
| **A. Gestión asigna** (implementado) | Sólo lo suyo | Ya está |
| **B. Se auto-asigna de una lista acotada** — sólo `Pendiente`, sólo del día, sólo sin repartidor, y sin montos | Los pedidos del día aún sin repartir, sin precios | Policy nueva + pantalla |
| **C. Se auto-asigna sin límites** | Toda la cartera de pedidos | Policy nueva, y es la opción que yo **no** recomendaría |
