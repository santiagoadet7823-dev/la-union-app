# HANDOFF — DisT-At

> **Actualizado el 29/08/2026 · `APP_VERSION 1.22.0` · APK **1.21.0** (sin cambios nativos) ·
> `app_config`: bundle+latest en `1.22.0`, `min_version` en `1.21.0`. Publicado el 29/08.** Escrito para retomar el proyecto **en otra
> máquina y en una sesión nueva, sin memoria previa.** Si estás leyendo esto en la PC nueva:
> empezá por §2.
>
> ✅ **1.22.0 PUBLICADO el 29/08** (OTA + PWA + `app_config` + Edge Function; **sin APK**, no hubo
> cambios nativos). Se llevó todo lo que estaba pendiente: el arreglo de la cola de escritura, las
> escalas de precio, Destacados, el envío multi-horario y el refresco del catálogo.
> ⏳ **Falta sólo el push de aviso**, que lleva la `service_role` key y tiene que correrlo una
> persona. La OTA se aplica sola igual (regla 48): el push acelera, no habilita.
>
> Reparto del parque al 28/08 (`estado_dispositivo`): **7 equipos en 1.21.0** con latido de hoy ·
> 3 en 1.20.0 sin reportar desde el 22/08 · 5 filas viejas o sin latido. Publicar no es entregar.
>
> 🔴 **Si sos una sesión nueva: empezá por las secciones que están justo abajo de §1**, en este
> orden — ⏱️ envío por hora + instalador (31/08, lo más reciente) · 🔑 tokens y paquete del cliente ·
> 🟢 release 1.22.0 · 🔵 el hueco de Luis Mendoza · 🟠 qué entró en 1.22.0.
> **No queda trabajo sin publicar en el bundle** (`db/53` está aplicada y no necesita front nuevo).
>
> **Lo que está esperando NO es técnico:** el envío automático de precios está listo de punta a punta
> y el token ya está emitido, pero no puede arrancar hasta que el cliente conteste cuatro preguntas
> (§ 🔑, al final). La primera se lleva puestas 355 fotos.
>
> Complementarios: [CLAUDE.md](CLAUDE.md) (reglas operativas — leerlo entero antes de tocar código) ·
> [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md) (arquitectura y deuda técnica) ·
> [ESTRUCTURA_PROYECTO.md](ESTRUCTURA_PROYECTO.md) (qué es cada archivo de la carpeta).

> 🟣 **17/08/2026 — SE FRENAN LAS FEATURES.** De acá en adelante: deuda técnica y sacarle la marca
> del cliente al producto. **Empezá por la sección del 17/08**, que está abajo de §1 — el cuerpo de
> este documento todavía habla como si el repo fuera de un solo cliente y viviera en la raíz.
>
> ⚠️ **El SDK de Flutter quedó instalado en `C:\src\flutter`** (3.47.0 stable) de la evaluación que
> se descartó el mismo día. **No lo usa nada**: se puede borrar y recuperar ~3 GB.

---

## 1. Dónde está parado el proyecto

**DisT-At** (`com.launion.app`) es un SaaS logístico multi-tenant de seguimiento GPS de equipos en
calle: vendedores y repartidores con la app en el bolsillo, encargados y dueños mirando el mapa. Se
cobra por abono P2P — **no hay pasarela de pago en la app**; la palanca es `empresas.activo` (que hoy,
ojo, **no gatea nada**: se escribe y se muestra, pero ninguna policy la consulta).

Todo en español: código, comentarios, UI y commits.

---

## 🟢 `habilitado` + BAJA POR AUSENCIA — desplegado el 01/09/2026 (`db/54`)

**Estado: LIVE en base y Edge Function. El bundle web queda SIN PUBLICAR** (ver el final).

### Lo que pidió el cliente

Tienen stock mal cargado y **deshabilitan productos** en su sistema. Pidieron una columna
`habilitado` en el archivo, y que **todo lo que no venga —ni marcado ni presente— desaparezca para el
vendedor**, rehabilitable a mano desde marketing / encargado / admin / superadmin.

### Casi todo ya existía

El estado es `productos.descontinuado_ts` y toda la app ya lo respeta (`productosVigentes`). La
pantalla para verlos y rehabilitarlos es `CatalogoTab`, y **los cuatro roles pedidos ya llegaban a
ella** (`gestion.js`, ítem `catalogo`): cero trabajo de permisos. La baja por ausencia ya estaba en
`importar_precios(p_lista_completa)` — pero **apagada**, detrás de un switch que la tarea programada
no pasaba.

### Lo único realmente nuevo: `productos.fijado_ts`

El envío corre **cada hora**. Con la baja por ausencia prendida, un producto rehabilitado a mano se
volvía a apagar solo antes de que terminara la hora: **el botón habría mentido**. Y el corolario
muerde igual — un producto CREADO a mano tampoco está en el archivo del ERP, así que marketing
cargaba un producto y lo veía desaparecer.

`fijado_ts` es "esto lo sostiene una persona": el envío no lo apaga **por ausencia**. Un
`habilitado = no` explícito del ERP sí gana, y limpia la marca.

> 🩸 La columna se agregó **sin default y recién después se le puso el `default now()`**: un
> `add column ... default now()` RELLENA las filas existentes, y en un solo paso los 606 productos
> habrían quedado fijados — la migración aplicaba limpia, sin errores, y la función que venía a
> construir no habría hecho nada nunca. Verificado después: **0 fijados, 606 expuestos**.

### `ingestas_precios.bajas`

QUÉ productos se apagaron y por qué (`ausente` / `habilitado`). Antes había sólo un número, y con un
número no se revisa nada. Se calcula **antes** de escribir —después ya no se distingue "lo apagó este
envío" de "ya estaba apagado"— y **alimenta también la válvula**, así que la lista y el conteo no
pueden discrepar: son el mismo `select`.

### 🔴 Los TRES bugs que cazó la verificación

1. **La CUARTA lista blanca** (`ingest-precios/index.ts`, el `filas.push`). Regla 56. `habilitado`
   no viajaba: el CSV parseaba bien, la respuesta decía `creados: 1`, y el producto quedaba
   **vigente**. Cero errores. Sólo se vio consultando la fila en la base.
2. **El sello de precios** (regla 57). `descontinuado_ts = now()` a secas hacía que cada producto
   apagado contara como modificado **en cada corrida horaria** → los 9 teléfonos bajando el catálogo
   entero cada hora. Va `coalesce(p.descontinuado_ts, now())`, y espejado en el `is distinct from`.
3. **La válvula sin piso** (regla 58). Sobre 3 productos, apagar uno es 33 % y abortaba todo. Va
   `v_bajas > 10 AND ratio > 0.20`.

### Verificado

Seis escenarios contra la base (empresa de descarte, borrada al terminar) y cuatro por el
**endpoint real**: apagar por columna · reenvío idéntico con `actualizados: 0` · reactivar ·
archivo sin la columna sin tocar nada · baja por ausencia · fijado que sobrevive · orden explícita
que gana al fijado. Base limpia después: **606 productos, 606 vigentes, 0 fijados**.

### ⚠️ LO QUE VA A PASAR SOLO, Y HAY QUE MIRARLO

`lista_completa` ahora es **`true` por defecto en el endpoint** (`?lista_completa=0` para apagarlo).
La PC de prueba del cliente manda cada hora, así que **en el próximo envío se van a deshabilitar los
65 productos que están en el catálogo y no vienen en el ARTIK** (606 − 541). Los 65 **tienen foto
cargada a mano**. 65/606 = 10,7 %: la válvula no los frena, y es lo que el cliente pidió.

**Primera tarea de la próxima sesión:**

```sql
select ts, descontinuados, jsonb_pretty(bajas)
  from ingestas_precios where jsonb_array_length(bajas) > 0
 order by ts desc limit 3;
```

Pasarle esa lista al cliente: ¿son productos que ya no existen, o son huecos de su export? Si son
huecos, se rehabilitan desde `CatalogoTab` **y quedan fijados solos**.

### Lo que queda SIN PUBLICAR

El bundle web: el resumen de la pantalla de importación (`ImportarProductos`), `fijado` en
`CatalogContext`, y que **rehabilitar desde `CatalogoTab` fije el producto**. Sale como **1.23.0**.
Hasta que salga, rehabilitar a mano un producto ausente dura una hora — las **altas** a mano ya
están cubiertas por el `default now()` de la columna.

Docs actualizadas: `ESPECIFICACION_LISTA_PRECIOS.md` **v5** (§2-ter), `PARA_EL_CLIENTE` §0,
la plantilla `.xlsx` (23 columnas) y el ZIP del cliente. `CLAUDE.md` reglas **55 a 58**.

> 🟢 **De paso: la CLI de Supabase ya está instalada Y autenticada.** El deploy de Edge
> Functions sale del disco (`npx supabase functions deploy ingest-precios --project-ref …
> --no-verify-jwt`), no hay que transcribir el código nunca más. ⚠️ **El `--no-verify-jwt` no es
> opcional**: el cliente manda su propio token, no un JWT de Supabase; sin ese flag Supabase le
> rechaza todos los envíos con 401.

---

## ⏱️ ENVÍO DE PRECIOS CADA 1 HORA + INSTALADOR — 31/08/2026

El cliente pidió dos cosas: que el envío pase de tres veces por día a **una vez por hora, mandando
siempre** aunque el archivo sea idéntico (*"por las dudas que lo envíe igual"*), y que el paquete
venga **listo para instalar**, porque del lado de ellos lo hace alguien que está aprendiendo a
programar.

### 🔴 `db/53` — lo que sostiene todo lo demás, y por qué no era opcional

**El cambio de cadencia rompía el centinela que se publicó el 29/08.** `sello_precios()` devolvía
`max(ts)` de `ingestas_precios`; el teléfono lo consulta y si cambió **recarga el catálogo completo**.
Con 24 envíos por día se movía 24 veces aunque no cambiara un precio. Medido sobre la base:

| | |
|---|---|
| productos | 170 kB · clientes 340 kB → **~510 kB por recarga** |
| por teléfono/día | **~12 MB** de datos móviles del empleado, para nada |
| × 9 teléfonos | **~110 MB/día** |

Es la regla 48 otra vez, la misma de los ~430 MB/día del auto-updater del APK.

🩸 **Y la causa raíz no era el sello: `importar_precios` mentía.** `v_actualizados` contaba *"cuántos
códigos del archivo YA EXISTÍAN"*, medido **antes de escribir**. Reenviar un archivo idéntico
reportaba **`actualizados: 511`** con cero cambios reales — mentira en el registro que lee el cliente
y en el sello que lee el teléfono.

**Ahora** el `update` lleva un `is distinct from` entre la fila viva y lo que se va a escribir, y los
dos conteos salen de `get diagnostics`. Efecto secundario bueno: el registro del cliente pasa a decir
la verdad, y se escriben muchas menos filas.

⚠️ **`descontinuado_ts` VA DENTRO de la comparación, y es la trampa del cambio.** El `set` lo pone en
`null` incondicionalmente para que un producto que reaparece se reactive solo (db/49). Fuera del
`is distinct from`, un producto descontinuado que vuelve tendría todo lo demás igual, la fila no se
actualizaría y **no se reactivaría nunca**.

**Y quedan dos preguntas distintas con dos consultas distintas, a propósito — que no se unifiquen:**

| Quién | Qué mira | Para qué |
|---|---|---|
| `EstadoCatalogo` | `max(ts)` a secas | *"¿sigue llegando la lista?"* → los 24 envíos lo mantienen fresco y el ámbar de 36 h sigue siendo señal real |
| `sello_precios()` | `max(ts)` **con cambios > 0** | *"¿vale la pena bajar 510 kB?"* |

**Verificado con transacciones separadas** (la primera prueba salió mal por un artefacto: dentro de un
`do $$` todo comparte `now()`, así que las cuatro filas tenían el mismo `ts` y el sello no podía
moverse):

| Caso | Resultado |
|---|---|
| Alta | `creados 1`, sello se mueve |
| **Reenvío idéntico** | **`actualizados 0`, `sin_cambio 1`, sello NO se mueve** — y la última ingesta SÍ avanza (14:33:22 vs 14:33:37) |
| Cambia un precio | `actualizados 1`, sello se mueve |
| Descontinuado que reaparece | **se reactiva** ✅ |

`proacl` de las dos funciones, idéntico antes y después.

### El instalador — `scripts/cliente/INSTALAR.bat`

Doble clic y queda andando (se eleva solo). Siete pasos, todos con
mensajes en castellano:

1. Comprueba el token · 2. **Selector de archivos** (nadie tipea rutas — es el corazón del pedido) ·
3. Guarda la ruta en `config.txt` · 4. **Envío de prueba** traducido · 5. Tarea cada 1 hora ·
6. 🔴 **dispara la tarea y verifica que corrió** · 7. Resumen.

- **Corre como `SYSTEM`**: elimina de raíz el modo de falla de la contraseña que vence o cambia, que
  era el caso C de la guía anterior.
- **Detecta unidades de red mapeadas y las convierte a ruta UNC**, porque SYSTEM no ve las letras de
  unidad (se montan al iniciar sesión, y la tarea corre sin sesión).
- Idempotente: se puede correr de nuevo para cambiar el archivo.

**`REVISAR.bat`** es el diagnóstico de una tecla, con veredicto de una línea. Lo importante: separa
*"el envío se rompió"* de *"el que no genera el archivo es su sistema"* — dos problemas de dos dueños
distintos que se confunden todo el tiempo.

### Lo verificado en esta máquina (Windows, PowerShell 5.1, igual que el cliente)

| Qué | Resultado |
|---|---|
| Sintaxis de los tres scripts | OK |
| **La repetición horaria** | `PT1H` / `P3650D` — **la trampa de `-RepetitionDuration` en PS 5.1 no mordió** |
| Detección de archivo idéntico | `"El archivo NO cambio desde el envio anterior. Se manda igual."` y **manda** |
| El hash **no** se guarda si el envío falló | ✅ — si no, un archivo que nunca llegó figuraría como "sin cambios" para siempre |
| Token de ejemplo | 🩸 Encontrado probando: se mandaba tal cual y volvía `401 token-invalido`, que manda a pedir un token nuevo cuando el que hay nunca se pegó. Ahora corta con un mensaje claro |
| `REVISAR.bat` sin nada instalado | Diagnostica bien y dice qué hacer |

⚠️ **NO se pudo probar el registro de la tarea**: esta sesión no corre como administrador. Lo que sí
está probado es la construcción del disparador, que es donde estaba el riesgo real de PS 5.1.

### El paquete

`enviar-precios.sh` **sale del ZIP** (el servidor del cliente es Windows); sigue en `scripts/cliente/`
por si algún día aparece uno con Linux. El `.bat` **ya no lleva la ruta hardcodeada**: la elige el
instalador y vive en `config.txt`.

🔑 **El ZIP ahora lleva `token.txt` COMPLETO**, así que del lado del cliente no hay que pegar nada —
y eso vuelve sensible al ZIP entero: **va por canal privado, nunca a un grupo.**

---

## 🔑 TOKENS DE INGESTA Y EL PAQUETE DEL CLIENTE — cerrado el 29/08/2026

### El token de precios está EMITIDO y el círculo quedó cerrado

| | |
|---|---|
| Estado | **1 token de precios activo**, a nombre de `Supermercado La unión` (rol `marketing`), empresa LA UNIÓN |
| Emitido por | El usuario, con el SQL de [GUIA_TOKENS_INGESTA.md](GUIA_TOKENS_INGESTA.md) §3.2. **El valor no pasó por Claude** |
| Endpoint | `ingest-precios` **v2** — desde ahora deja de rechazar todo con 401 |

**Todo lo operativo de tokens vive en [GUIA_TOKENS_INGESTA.md](GUIA_TOKENS_INGESTA.md)** (documento
interno, no va al cliente): emitir, revocar, rotar, sumar una empresa y las consultas de auditoría.
Lo que sigue son las tres respuestas que hay que tener a mano.

### 1. ⏳ El token NO VENCE

Verificado sobre la base: `ingesta_tokens` es `token · id_usuario · id_empresa · creado · revocado ·
proposito`. **No hay columna de expiración.** Vale hasta que alguien lo revoque a mano.

Es deliberado: un vencimiento automático haría que el envío del ERP muera un martes a las 6 AM sin que
nadie tocara nada, y el síntoma sería un catálogo congelado que nadie mira. Un `401` sorpresa en el
servidor del cliente es peor que una llave larga. La contrapartida es que la seguridad depende de que
la llave se cuide, no de que caduque: por eso `scripts/cliente/token.txt` está en el `.gitignore`
—este repo es público— y el valor se entrega por canal privado.

⚠️ **Revocar NO borra la fila** (queda con `revocado = true`, sirve para auditar). Si el valor se
filtró de verdad, hay que **borrar la fila**, no sólo revocarla.

### 2. 🩸 La trampa del `on conflict`, que ya mordió una vez

El único es `(id_usuario, proposito)`: **una cuenta tiene UN token de precios**. Llamar
`mi_token_ingesta('precios')` dos veces con el mismo usuario hace `do update set revocado = false` y
**devuelve el MISMO valor**, no uno nuevo.

Pasó el 29/08: el token efímero de la prueba de punta a punta quedó atado al superadmin, y regenerar
con esa cuenta habría devuelto un valor que ya había pasado por la sesión de Claude. Se borró la fila
y se emitió limpio a nombre de marketing. **Por eso el SQL de la guía fuerza `token =
gen_random_uuid()`**: para que "generar" signifique generar.

⚠️ **Y `mi_token_ingesta()` NO se puede llamar desde el SQL editor de Supabase**: resuelve la
identidad con `auth.uid()`, que corriendo como `postgres` viene NULL y tira `sin empresa`. El camino
real de hoy es el `insert … on conflict` de la guía. **No hay pantalla que la llame** — el teléfono
sólo usa la variante sin argumentos, para el token de GPS.

### 3. 🟢 UNA SEGUNDA EMPRESA YA SE PUEDE — el bloqueante murió en `db/48`

Estaba anotado como el impedimento para el segundo cliente. **Verificado sobre la base viva el
29/08**, ya no existe:

```
productos_codigo_norm_uidx  ON productos (id_empresa, codigo_norm)   ← por EMPRESA
clientes_codigo_norm_uidx   ON clientes  (id_empresa, codigo_norm)   ← por EMPRESA
```

Antes el único de `codigo` era **global** y dos distribuidoras no podían compartir un código. Ahora sí.

Sumar una empresa al envío automático **no toca código ni despliega nada**: fila en `empresas` →
usuario con rol de catálogo → emitir el token → mandarle el mismo paquete. **La URL del endpoint es
idéntica para todos**; lo único que cambia es el token, y `id_empresa` sale de ahí y nunca del
archivo.

⚠️ **Pero `empresas.activo` sigue sin gatear nada.** Desactivar una empresa **NO apaga su token**: si
un cliente deja de pagar, hay que revocárselo a mano. Hoy `Prueba SaaS` está en `activo = false` y eso
no significa nada técnicamente.

### El paquete que se le manda al cliente

Se arma en `../DisT-At - lista de precios (para el cliente).zip` — **8 archivos, 40 KB, sin el
token adentro** (verificado). Numerados por orden de lectura, y el `0 - LEEME PRIMERO` explica qué es
cada uno en castellano llano, para alguien que no programa.

🩸 **Es un paquete de WINDOWS, y eso ahora es explícito.** El servidor del cliente es Windows, así que
la guía dejó de ser "Windows o Linux": son seis pasos numerados, con dónde está PowerShell, cómo se
abre el Programador de tareas y qué tildar en cada pestaña. **`enviar-precios.sh` salió del paquete**
(sigue en `scripts/cliente/` por si algún día aparece un servidor Linux).

**La sección que más valor tiene es 🔌 "Si el servidor se apaga o se reinicia"**, porque es la
pregunta que iban a hacer igual. Arranca por la buena noticia —las tareas programadas sobreviven al
apagado y casi siempre no hay que hacer nada—, después una comprobación de dos minutos, y después los
cuatro motivos por los que podría no volver solo:

| | Caso | Cómo se reconoce |
|---|---|---|
| A | La corrida se perdió y no se recuperó | Falta la tilde de *"ejecutar lo antes posible si se pasó por alto"* |
| B | La tarea quedó deshabilitada | Estado dice "Deshabilitado" |
| C | **Cambió la contraseña de la cuenta que corre la tarea** | El que no se ve venir. Se delata porque **el registro del script ni siquiera se escribe**: nunca llegó a arrancar |
| D | El archivo del export no está | O el ERP no arrancó, o es una unidad de red no montada — **la tarea corre SIN sesión iniciada**, así que las unidades con letra no existen: va la ruta UNC |

Y dos trampas de Windows que muerden en producción y quedaron escritas: **"Iniciar en" dice opcional y
no lo es** (sin él la tarea no encuentra el `token.txt`), y **una tarea programada no hereda las
variables de entorno del usuario** — por eso el token va en un archivo y no en una variable.

### 🔴 Lo que sigue bloqueado, y no es técnico

El envío automático **no puede arrancar** hasta que el cliente conteste. Está todo en
[PARA_EL_CLIENTE_LISTA_PRECIOS.md](PARA_EL_CLIENTE_LISTA_PRECIOS.md) §1:

1. 🔴 **¿La lista a nivel unidad conserva los códigos?** — de esto dependen **355 fotos**.
2. ¿Pueden mandar la descripción completa, o los 20 caracteres son un límite del sistema?
3. La tabla de los 20 rubros.
4. ¿UTF-8 o Windows-1252?
5. ¿A qué hora termina el export? (para agendar el envío después)

Y el orden no se puede saltear: **la primera carga va A MANO**. El pasaje a unidades reemplaza el
catálogo entero y el freno del 20 % lo va a rechazar con un 409 **a propósito**.

---

## 🟢 RELEASE 1.22.0 — publicado el 29/08/2026 (madrugada, hora Salta)

Salió por los canales que correspondían, en este orden: `db/51` → `db/52` → OTA → PWA → `app_config`
→ Edge Function. **Sin APK: no cambió una línea de código nativo**, es todo JS + SQL.

| Paso | Resultado |
|---|---|
| `db/51` (`destacado` + `importar_precios`) | ✅ aplicada. `proacl` **idéntico** antes y después |
| `db/52` (`sello_precios()`) | ✅ aplicada. `authenticated=X` sí, `anon` no |
| OTA `ota-1.22.0/bundle.zip` | ✅ 1.327.808 bytes. **Bajado y abierto**: `index.html` en la raíz, y `1.22.0`, `Destacados`, `destacado`, `sello_precios`, `PRECIO POR CANTIDAD`, `Precios actualizados` y `cuarentena` presentes en los **53 chunks modernos Y los 51 legacy** |
| PWA (GitHub Pages) | ✅ workflow `completed success`; verificado sobre el sitio en vivo: sirve `1.22.0` |
| `app_config` | ✅ `bundle_version`/`latest_version` = 1.22.0, `bundle_url` → ota-1.22.0. Las dos URLs devuelven 200 |
| Edge Function `ingest-precios` | ✅ **v2**, con `destacado`, `falta-encabezado` y `p_pisar_descripcion`. Cierra el pendiente **N4** |
| `push-actualizacion` | ⏳ **NO enviado** — ver abajo |

### 🔴 `min_version` NO se subió, y es a propósito

Quedó en **1.21.0**. `apkCheck()` ofrece el APK mientras `instalada < min_version`, y `apk_url`
apunta a `apk-1.21.0`: subir `min_version` a 1.22.0 dejaría a cada teléfono **bajando 21,7 MB de un
APK que ya tiene**, en loop, porque la condición no se levantaría nunca. Es exactamente el gasto que
el freno de `APK_REINTENTO_MS` existe para acotar. Cuando haya un APK 1.22.0 de verdad, ahí se sube.

**Valores anteriores, por si hay que volver:** `bundle_version`/`latest_version` `1.21.0`,
`bundle_url` → `ota-1.21.0/bundle.zip`.

### ⏳ Lo único que quedó sin hacer del release: el push de aviso

Lleva la `service_role` key y **no está en Vault** (`vault.decrypted_secrets` vacío), así que lo
tiene que correr una persona. El SQL está en `CLAUDE.md §3`; el `timeout_milliseconds := 60000` no
es opcional.

⚠️ **No es el mecanismo, es el aviso** (regla 48): desde 1.12.1 la OTA se descarga y se aplica sola
en el próximo arranque en frío. El push acelera, no habilita.

### Cómo se cerró la verificación, y qué NO se pudo verificar

**Verificado en pantalla, con sesión real** (el usuario logueó; Claude no escribe credenciales):
- El switch **Destacado** de la ficha escribió a la base por la write queue.
- `EstadoCatalogo`: pasó de *"La lista de precios nunca se importó"* (ámbar) a **"Precios
  actualizados hace 1 min · 3 filas · planilla"** al insertar una fila real.
- El **sello** (`sello_precios`) devolvió el timestamp correcto con la sesión del usuario.

**Verificado con render aislado** (`createRoot` en un módulo efímero, la técnica de la regla 51 —
el `GpsGate` no deja entrar a la vista de vendedor sin GPS real):
- Chips: `["◆ Destacados","Todos","★ Ofertas","Almacén","Bebidas","Otros"]` — **Destacados primero**.
- El `+` de una tarjeta **NO** abre la ficha (el `stopPropagation`); la tarjeta sí.
- La escalera en vivo: a 6 unidades el precio pasa de $5.700 a **$5.400** y el total a **$32.400**.
- Con vidriera viva, tocar manda a la tablet **y** abre la ficha, con el toast.
- `AvisoVidriera` corregido, leído del DOM: `6 × $5.700 ~~tachado~~ $5.400 = $32.400`.

**Verificado de punta a punta contra el endpoint real** (token efímero, revocado al terminar):
sin encabezado → `400 falta-encabezado`; `destacado=si` → alta con `true`; **reenvío SIN la columna →
el precio se actualiza a 1999 y el destacado sigue en `true`**; token inválido → 401. Producto de
prueba, bitácora y token limpiados (529 productos, 0 restos, 0 destacados).

🔴 **LO QUE NO SE PUDO VERIFICAR: el botón ATRÁS nativo.** El emulador **no bootea en esta máquina**
—queda en `offline` con WHPX operativo, se confirmó otra vez— así que sigue vigente lo que ya estaba
anotado: no gastar tiempo ahí sin hardware nuevo.
Lo que sí se comprobó, en el navegador y contra el módulo real: al montar la ficha, la pila de
`services/atras.js` pasa de **0 a 1**, o sea que hay un handler registrado y el atrás **no cae en el
`minimizeApp()`** de la pila vacía (regla 27). Falta la mitad nativa —que Capacitor dispare ese
handler—, que es genérica y la comparte con todos los overlays de la app.

---

## 🔵 EL HUECO DE LUIS MENDOZA DEL 27/08 — no era un hueco

**Reporte:** *"entre las 13:30 y las 18:30 hay un hueco grande de no tener ubicaciones"*.

**No falta un solo dato.** Luis subió **1.671 puntos** ese día, **601 de ellos dentro de esa
ventana** —uno cada ~30 s— y su hueco más largo de todo el día fue de **24,5 minutos** (16:14 →
16:39). Reportó todas las horas: 13h=103 · 14h=142 · 15h=146 · 16h=82 · 17h=137 · 18h=192.

**Lo que pasó es que no se movió.** Distancia media al comercio **LJ CRISTIAN SANCHEZ (código 793,
Las Lajitas)**, media hora por media hora:

| Bloque | Puntos | Metros recorridos | Distancia media al 793 |
|---|---|---|---|
| 13:00 | 72 | 1.315 | 596 m ← llegando |
| **13:30** | 31 | 478 | **3 m** |
| **14:00** | 80 | 370 | **9 m** |
| **14:30** | 62 | 102 | **5 m** |
| 15:00 | 88 | 1.555 | 154 m ← una vuelta |
| 15:30 | 58 | 590 | 176 m |
| **16:00** | 30 | 79 | **9 m** |
| **16:30** | 52 | 19 | **3 m** |
| **17:00** | 75 | 290 | **6 m** |
| **17:30** | 62 | 40 | **3 m** |
| **18:00** | 63 | 29 | **2 m** |
| 18:30 | 129 | 4.753 | 442 m ← se fue |

En cinco horas recorrió **~3,5 km, y 2,1 de esos son la única vuelta de 15:00-15:30**. El resto del
tiempo estuvo a menos de 10 metros del mismo punto.

**Por eso el mapa se ve vacío: el mapa dibuja movimiento, y no hubo.** Se suma que en esa ventana su
precisión se degradó (p50 **25,8 m** contra 8,8 m el resto del día), así que **el 31,8 % de esos
puntos supera el techo de 30 m** y se dibuja punteado en vez de línea llena.

**Y no hizo un solo check-in ese día.** En los últimos 20 días registró **4 visitas en total** (3 el
10/08 y 1 el 13/08), así que la app no tiene forma de decir si estaba trabajando ahí adentro.

### 🩸 Lo que apareció de paso, y es un problema de verdad: los avisos MIENTEN

Luis tiene **15 avisos `sin_reportar` en 3 días** (26, 27 y 28/08), uno de ellos de **454 minutos**,
mientras sube 1.671 puntos por día con un hueco máximo de 24,5 min. El aviso está mal.

**Cuatro hipótesis medidas y DESCARTADAS** — no repetirlas:

1. **El filtro de precisión de `vigilancia_equipo`** (`accuracy <= 30`). Refutada: el hueco máximo
   contando **sólo** los fixes confiables es **24,6 min**, prácticamente idéntico a los 24,5 de
   contar todos. No es eso.
2. **Empresa cruzada** entre `posiciones` y `perfiles`. Refutada: las dos dicen
   `645aa685-…`.
3. **El latido JS congelado** (patrón A2). Su `estado_dispositivo` está clavado en **26/08 13:12**
   con `fix_total: 8`, así que el WebView sí está muerto — pero `vigilancia_equipo` lee `posiciones`,
   no el latido.
4. **Subida tardía en lote** (los puntos existen hoy pero no existían cuando corrió el cron).
   Refutada: `posiciones` es insert-only, así que el orden físico (`ctid`) ≈ orden de inserción, y
   el desfase entre orden de captura y orden de inserción va de **−45 a +58 posiciones** — minutos,
   no horas. Los puntos de las 13 se insertaron antes que los de las 18.

**Queda abierto.** Lo que hay que hacer es correr `vigilancia_equipo()` **durante la jornada** (no de
madrugada, cuando `en_ventana` es false para todos) y comparar su `ultimo_ts` contra
`max(posiciones.ts)` en vivo. Si divergen, el problema está adentro de la RPC; si coinciden, está en
el cron o en el antirrebote del índice.

---

## 🟠 SESIÓN DEL 28/08/2026 (tarde) — Destacados, el paquete de envío automático, y un precio que mentía

**Estado en una línea: todo implementado y verificado; `db/51` YA APLICADA en la base viva; el
bundle SIGUE SIN PUBLICAR.** Va todo junto en **1.22.0**, decidido con el usuario.

### 1. Filtro "Destacados" — el chip que va primero

Pedido del cliente: un filtro que junte los productos **de baja rotación** para que el vendedor los
saque; toca uno y se le abre al comerciante en la tablet para que decida si lo suma.

🔴 **La decisión de diseño que hay que entender antes de tocarlo: el flag es EXPLÍCITO, no
calculado.** Medido contra la base viva ANTES de escribir una línea:

| | |
|---|---|
| productos | **529** (0 descontinuados) · 355 con foto |
| pedidos | **3 en total, y los 3 ANULADOS** · 3 líneas en `pedido_items` · 82 visitas |

Una RPC "los que menos se pidieron" —el espejo de `productos_sugeridos_cliente` (`db/44`)— devolvería
hoy **526 de 529**: el chip nacería indistinguible de "Todos". Es la advertencia que `db/44` se
escribió a sí misma ("no da resultados el día 1"), y acá duraría meses. Y `productos` no tiene ni
stock ni rotación: **el único sistema que sabe qué no se mueve es el ERP del cliente**.

Por eso, columna `destacado` que se llena por **dos caminos con el mismo nombre de campo**: a mano
desde la ficha del producto, y desde la lista de precios del ERP (columna nueva `destacado`, con
sinónimos `baja_rotacion`, `liquidar`, `empujar`…). Cuando haya historial de verdad se le puede
sumar una **sugerencia** automática, pero la decisión sigue siendo del cliente: un producto puede no
rotar porque no lo quiere nadie o porque hay que liquidarlo, y esa diferencia no está en los datos.

**Qué se tocó:**

| Dónde | Qué |
|---|---|
| **`db/51_destacado.sql`** | Columna + `importar_precios` con el campo. ✅ **APLICADA** (`apply_migration`, 28/08). El cuerpo salió de `pg_get_functiondef` sobre la base viva, no de fusionar `db/49` + `db/50` a ojo (regla 5) |
| `VisitaCatalogo.jsx` | El chip **primero** de la fila, con color propio. El filtro por defecto **sigue en 'Todos'** — aparecer primero no es estar seleccionado |
| **`FichaProducto.jsx`** (nuevo) | El producto grande del lado del vendedor. Va por `Overlay variant="sheet"`, así que hereda la pila de `atras.js` (reglas 26-27) y el z-index por token |
| `NuevoProducto` · `CatalogoTab` · `ImportarProductos` · `CatalogContext` · `planillaProductos` · `ingest-precios` | El campo, punta a punta |

🩸 **Tocar la tarjeta hace las DOS cosas a la vez** (abre grande en el celular **y** manda a la
tablet si la vidriera está viva), que es el mismo criterio que ya usa la tablet cuando el toque lo da
el cliente. Sin tablet no se pierde el gesto: queda la ficha del celular, que se le da vuelta al
comerciante. Eso era la mitad que faltaba — la vidriera necesita hotspot, pareo y tablet, y **la
mayoría de las visitas no la tienen**.

⚠️ **`destacado` NO viaja en `snapshotCatalogo`, y no es un olvido.** Significa "esto no rota / hay
que liquidarlo": es una decisión comercial de la distribuidora y esa pantalla la mira el
**comerciante**. Está comentado en `services/vidriera.js` para que nadie lo agregue "por
completitud".

⚠️ **Hay TRES listas blancas explícitas en el camino de importación** y un campo que falte en
cualquiera se pierde **sin un solo error**: `addProducto` e `importProductos` (`CatalogContext`) y el
`.map()` de `ImportarProductos`. Es lo que ya pasó con `marca` y `unidad_venta` el 27/08.

### 2. 🩸 `AvisoVidriera` violaba la regla 52 — y mentía con los escalones

`AvisoVidriera.jsx:28` resolvía el precio a mano (`oferta ? precioOferta : price`) y **no importaba
nada de `lib/precios.js`**. Era el **único de los 11 lugares de la regla 52 que quedó sin migrar**, y
está nombrado en la propia regla.

**El fallo, medido con el código real:** el cliente toca en la tablet un producto con escalón desde 6
y pone 6. La tablet muestra $1.750 c/u; el cartel del celular mostraba `6 × $1.850 = `**$11.100**; el
vendedor toca "Sumar 6" y el carrito —que sí usa `precioDe`— cobra **$10.500**. Tres números
distintos del mismo producto, y el del medio es el que la persona lee en voz alta.

Arreglado con `precioPara(aviso, n)` (la cantidad importa: el escalón se resuelve contra `n`, no
contra 1), y con el precio de lista tachado cuando hay descuento.

### 3. El envío automático de precios — el paquete "todo hecho" para el cliente

La pregunta era *"¿lo hace en cierto horario o cómo?"*. **Respuesta: tarea programada del lado de
ellos, 06:00, lunes a sábado** (la jornada arranca 07:30-08:00 y el catálogo se carga al abrir la
app, así que a las 06:00 la lista del día ya está arriba, con margen para dos reintentos).

| Archivo | Qué es |
|---|---|
| **[GUIA_ENVIO_AUTOMATICO_PRECIOS.md](GUIA_ENVIO_AUTOMATICO_PRECIOS.md)** (nuevo) | El paso a paso: Programador de tareas de Windows campo por campo, `cron`, qué hacer con cada código de respuesta, y cómo saber dentro de tres meses que sigue funcionando |
| `scripts/cliente/enviar-precios.ps1` + `.bat` | Windows. Registro diario, reintentos **sólo** de red, TLS 1.2 explícito |
| `scripts/cliente/enviar-precios.sh` | Linux/cron |
| `scripts/cliente/EnviarPrecios.java` | Para colgarlo del final del export del ERP, que es mejor que una hora fija |
| `ESPECIFICACION_LISTA_PRECIOS.md` | **Versión 3**: columna `destacado` (§1 y §2-bis) y **§4-bis "Cuándo se envía"** |
| `plantilla-lista-precios.xlsx` | Regenerada: **22 columnas**, INSTRUCTIVO actualizado, y el conteo de fotos corregido de 227 a **355** |

🔴 **El token no está escrito en ningún archivo** (regla 25): los scripts lo leen de `DISTAT_TOKEN` o
de un `token.txt` con permisos restringidos. La guía dice **dónde** ponerlo, nunca cuál es.

🔴 **Los scripts NUNCA mandan `?lista_completa=1`.** Las bajas se siguen haciendo a mano, leyendo el
conteo antes de confirmar.

### 4. 🟠 El agujero que se tapó de paso: nadie miraba si la lista llegó

`ingestas_precios` guarda cada corrida desde `db/48` y **no la leía nadie**. Si el cron del cliente se
muere un martes, el catálogo se congela y el primero que se entera es un vendedor cobrando mal frente
a un comercio. Es *"avisar no es actualizar"* una capa más arriba.

**`features/catalog/EstadoCatalogo.jsx`** (nuevo, montado en `CatalogoTab`, o sea en las cuatro
pantallas que editan catálogo) muestra dos números que hasta hoy no existían:

- **"Precios actualizados hace N h · N filas"**, en ámbar pasadas **36 h** sin ingesta.
- **El contador de cuarentena de la cola de escritura** (pendiente **N3**), que aparece **sólo si hay
  algo aislado**. Es el número cuya ausencia hizo que el taponamiento durara dos días: la pantalla
  decía que sí (merge optimista) y nada subía.

### 5. Regla 53 en `CLAUDE.md` — aviso de contexto

Pedido explícito: avisar al ~25 % de contexto restante para actualizar el HANDOFF y abrir una sesión
nueva. Queda escrito en `CLAUDE.md §2 → General`. ⚠️ **La regla dice de sí misma que es conducta y no
un disparador exacto**: desde adentro de la sesión no hay una lectura numérica del contexto, así que
el 25 % es un objetivo, no una garantía. El respaldo confiable sería mostrarlo en la statusline, que
se configura aparte y **no se hizo**.

### 6. Lo verificado, y con qué

| Qué | Cómo |
|---|---|
| Columna y RPC | `information_schema` + **`proacl` idéntico antes y después** (`{postgres=X,service_role=X}`) |
| **"Celda vacía no borra"** | Tres llamadas reales a `importar_precios` contra la base: alta con `destacado=si` → **t**; envío diario **sin la columna** → **sigue en t** (y el precio sí cambió, o sea que la fila entró de verdad); `destacado=no` → **f**. Producto de descarte borrado y bitácora limpia (529 productos, 0 restos) |
| Parseo de la columna | 8 casos contra `filaAImportar` + un archivo tabulado real: `si`/`SI`/`no`/vacío/ausente y los 4 sinónimos. **Ausente → `null`**, que es todo el contrato |
| Chips y filtro | 8 casos sobre las expresiones exactas del componente: Destacados primero, no existe si no hay ninguno, y Todos/Ofertas/categoría **intactos** |
| Regla 52 | Los tres lugares dan 1.750 para 6 unidades. Se reprodujo el número viejo: **11.100 contra 10.500** |
| Build | `npm run build` EXIT=0 |

🔴 **LO QUE FALTA VERIFICAR, Y NO ES OPCIONAL: la pantalla.** La sesión de la PWA está cerrada y
Claude no puede escribir credenciales (regla 43). **Un build en verde no prueba nada de esto**
(regla 51: Vite no detecta TDZ y el `ErrorBoundary` se come la pantalla entera). Falta, con la
sesión abierta:

1. Marcar 3 productos → el chip **Destacados** aparece **primero**.
2. Desmarcarlos todos → el chip **no existe**.
3. Tocar un destacado **sin tablet** → se abre la ficha grande con la escalera.
4. **Botón ATRÁS de Android** (emulador) → cierra la ficha, **no la app**.
5. Tocar el `+` de una tarjeta en Destacados → **NO** abre la ficha (el `stopPropagation`).
6. Con vidriera viva: tocar → la tablet abre la ficha (`VidrieraTablet:639`).

### 7. Lo que sigue pendiente de esto

- **N1** — publicar 1.22.0 por los tres canales. Ahora lleva también todo lo de arriba.
- **N2** — leer la cola trabada de marketing **antes** de sacarle nada (regla 20). Sin hacer.
- **N4** — redesplegar `ingest-precios`. `sync-ingest-precios.mjs` ya corrió y el `--check` da al día,
  pero **el deploy no se hizo**.
- **N5** — las tres preguntas al cliente siguen sin respuesta.
- **N6** — no hay ningún token de precios emitido: el endpoint rechaza todo con 401.

---

## 🔵 SESIONES DEL 27-28/08/2026 — Precios por cantidad, ingesta desde el ERP, y una cola taponada

**Estado en una línea: todo implementado y verificado contra datos reales; NADA publicado.** Los 9
teléfonos siguen corriendo el bundle `1.21.0` que ya estaba.

### 0. 🔴 Lo primero que hay que hacer al abrir la sesión

| # | Qué | Por qué es lo primero |
|---|---|---|
| **A** | **Pedirle a marketing que lea su cola trabada** | Hay una mutación en el `localStorage` de esa persona que estuvo bloqueando la cola dos días. Se reparó el daño y se arregló el código, pero **esa entrada sigue ahí** y hay que ver qué era antes de sacarla (regla 20). El snippet, abajo |
| **B** | **Publicar** por los tres canales (APK + OTA + PWA) | Sin publicar, el arreglo de la cola **no llega a nadie** y el problema de las fotos se repite en la próxima tanda |
| **C** | **Redesplegar `ingest-precios`** desde `supabase/functions/ingest-precios/` | Lo desplegado son copias condensadas de los módulos de `lib/` y le faltan los dos cambios del 28/08. Correr `node scripts/sync-ingest-precios.mjs` primero. Ver el `LEER.md` de esa carpeta |

---

### 1. 🔴 La cola de escritura estuvo TAPONADA DOS DÍAS (28/08)

Marketing reportó que cargó más de 100 fotos y "no se guardaron o se borraron".

**No se perdió ninguna.** Los archivos estaban todos en Storage; lo que faltaba era el vínculo: **147
productos con la foto en el bucket y `imagen_url` en NULL**. Ya se reparó con un UPDATE que
reconstruye la URL desde `storage.objects` (208 → 355 productos con foto, verificado con `curl`:
HTTP 200, `image/webp`).

**La causa:** `writeQueue.js` hacía `if (error) break` ante CUALQUIER error. La cola es FIFO, así que
**una sola mutación que falla siempre bloquea todo lo que venga detrás, para siempre**. El 26/08 a
las 15:29:09 una mutación sobre el producto `0218` empezó a dar `23505` (código duplicado) y desde
ese segundo no subió nada más.

Es la **regla 19/20 de CLAUDE.md** —lo que la cola de POSICIONES ya había pagado en julio con 264
puntos atascados— que nunca se aplicó a la cola de escritura. Peor: el propio archivo ya razonaba
sobre este peligro para la operación `borrarArchivos` y lo resolvía **para una sola operación**.

**Arreglado** (sin publicar): `CODIGOS_PERMANENTES` + cuarentena `lu-write-cuarentena`. Se aísla, no
se borra, con `_motivo` y payload intactos. Verificado reproduciendo el escenario real contra el
código de producción: 5 fotos detrás de un 23505 **suben igual**, y se cumple la invariante de la
regla 21 (`subidas + aisladas == total`). Un error **transitorio** sigue cortando y conservando el
orden — esa distinción es todo el arreglo.

**Falta**: un contador de cuarentena visible en la pantalla de catálogo. Esto falló dos días porque
**no había ningún número que mirar**: la persona cargaba fotos, la pantalla decía que sí (merge
optimista) y nada subía. El síntoma que engaña no es "falla", es *"se guardó y después desapareció"*.

**El snippet para la persona de marketing** (sólo lee, no borra):

```js
copy(JSON.stringify(JSON.parse(localStorage['lu-write-queue']).slice(0,3), null, 2))
```

> 🩸 **Cómo se rastreó, que es lo reutilizable.** (1) Contar Storage contra `imagen_url` → el
> problema es el vínculo, no el archivo. (2) Agrupar por día → el corte fue **de 10 segundos**, y un
> corte así de filoso es firma de cola taponada, no de "a veces falla". (3) `query_logs` sobre
> `edge_logs` → **665 PATCH con 409 en un día**, todos al mismo `id`, uno cada 30 s.
> ⚠️ **`postgres_logs` filtrado por `error_severity` devuelve VACÍO** aunque los errores existan: ese
> campo llega en blanco. Hay que buscar por `event_message` (`duplicate`, `violates`).

---

### 2. Precios por cantidad (escalas) — implementado, sin publicar

El cliente pidió precios por volumen: precio base + hasta 5 escalones. **Decisión cerrada: todo pasa
a UNIDAD** — nada de fardo ni caja cerrada como fila; `desde_N` se cuenta en unidades sueltas.
Oferta vs escalón: gana el más barato. Entrega parcial: el precio **se congela** al tomar el pedido
(es lo que el sistema ya hacía; `useEntregas` no toca `precio_unitario`, y está comentado para que no
parezca olvido).

**Migraciones aplicadas** (`db/48`, `db/49`, `db/50`): columna `escalas jsonb`, `codigo_norm`
generada, **`unique(id_empresa, codigo_norm)` reemplazando el único GLOBAL** en `productos` y
`clientes`, `ingesta_tokens` por fin versionada + columna `proposito`, tabla `ingestas_precios`, y la
RPC `importar_precios`.

**Código nuevo**: `web/src/lib/precios.js` (la ÚNICA fuente de "cuánto sale esto") y
`web/src/lib/planillaProductos.js` (encabezados + parseo, compartido con la Edge Function).
Escalera en las tarjetas del vendedor y de la tablet, ahorro en los dos carritos, editor de 5 filas
en la ficha del producto.

> 🩸 **La regla del precio estaba copiada en 11 lugares de 7 archivos.** Es la regla 52 de CLAUDE.md.
> Con precio plano coincidían por casualidad; con escalones, la primera que quede sin actualizar hace
> que el celular y la tablet muestren números distintos con el comerciante enfrente.

**Tres bugs que aparecieron al medir y quedaron arreglados:**

- `soloNum` **no podía leer NINGÚN decimal**, ni con punto: `normalizar()` convierte el punto en
  espacio, así que `"1450.50"` entraba como **145050**. No dejó daño porque el catálogo salió de un
  PDF sin pesos. El parser nuevo **no adivina** los ambiguos (`1.450`): los rechaza con el nº de fila.
- `addProducto` perdía **`marca` y `unidad_venta`** en silencio (lista blanca implícita).
- `addProducto` descartaba el `id` del llamador → **fotos huérfanas** en Storage que `deleteProducto`
  no podía encontrar nunca.

**Verificado** (suites en el scratchpad, no en el repo — no hay framework de tests): 33 casos de
`precios.js`, el mapeo de encabezados, la RPC contra la base con un producto de descarte, y el
endpoint de punta a punta con archivo tabulado real.

⚠️ **`PROTOCOLO` (services/vidriera.js) NO SE TOCA.** La tablet valida igualdad estricta al escanear
el QR: subirlo deja **toda tablet existente sin poder parear**, y esa tablet no recibe OTA nunca.

---

### 3. La ingesta desde el ERP y el primer archivo real

**`supabase/functions/ingest-precios`** está desplegada y probada: token opaco en `ingesta_tokens`
con `proposito='precios'`, `id_empresa` **del token y nunca del payload**, freno de bajas (>20 % del
catálogo → **409 sin escribir**) y bitácora en `ingestas_precios`. Un token de GPS no puede escribir
precios (probado: 401).

**Hoy no hay ningún token de precios emitido**, así que el endpoint rechaza todo con 401. Se mintea
con `mi_token_ingesta('precios')` y sólo lo puede pedir quien ya edita el catálogo.

**`ARTIK.csv`** (541 filas, 19 columnas, `;`) llegó el 28/08. Análisis completo y el documento para
reenviarle al cliente: [REVISION_ARTIK.md](REVISION_ARTIK.md).

- ✅ Separador, decimales con punto, códigos sin ceros: todo bien. **Los 3 escalones están en el
  formato correcto** (columnas 12-17, con el `0011` cargado de ejemplo).
- 🔴 **Falta la fila de encabezados** — va con el **mismo separador que los datos** (`;`), no comas.
- 🔴 **407 de 541 descripciones cortadas a 20 caracteres.** Por eso `db/50` agregó
  `p_pisar_descripcion`: el envío automático **no toca los nombres** de productos que ya existen.
- ⚠️ Los tramos del ejemplo están contados **en fardos, no en unidades**. Puede que el archivo sea
  anterior a la spec v2 — está preguntado, no reclamado.
- ⚠️ Falta que manden la **tabla de los 20 rubros** (columna 6, códigos `01`…`20`).

Probado contra las 541 filas reales: sin encabezado lo detecta y responde `falta-encabezado`
mostrando la primera línea; con el encabezado agregado, las 541 entran con código, descripción y
precio, cero ambiguos, y el escalón del `0011` sale correcto.

---

### 4. Lo entregado al cliente

| Archivo | Qué es |
|---|---|
| `plantilla-lista-precios.xlsx` | Planilla con las 21 columnas + hoja INSTRUCTIVO. **Versión 2**, a nivel unidad |
| [ESPECIFICACION_LISTA_PRECIOS.md](ESPECIFICACION_LISTA_PRECIOS.md) | La spec del endpoint para quien programe el export |
| [REVISION_ARTIK.md](REVISION_ARTIK.md) | La devolución del primer archivo de prueba |

🔴 **Sigue sin respuesta y condiciona todo**: ¿la lista a nivel unidad **conserva los códigos**? Las
355 fotos se parean por código — si cambian, el catálogo queda gris y hay que recargarlas a mano.

---

### 5. Lo comercial que cambió el 27/08

El cliente **sacó el pago del backend dedicado** y ofreció a cambio ayudar con marketing (tiene
contactos para revender la app). Se sigue en la Supabase compartida pagando planes;
`PLAN_BACKEND_DEDICADO.md` queda como **propuesta archivada, no como plan vigente**.

⚠️ Esto contradice el alto de features del 17/08 y la facturación cerrada en USD 500 + 250/mes **sin
modificaciones**: se cotiza aparte.

---

## 🟣 SESIÓN DEL 17/08/2026 — Alto de features. Se descarta Flutter y se despersonaliza el producto

**La decisión de hoy, textual:** *"paremos acá y conservamos lo que tenemos, vamos a ir corrigiendo la
deuda técnica y quitar todo rastro de La Unión en Google consola y demás"*. O sea: **nada nuevo entra**.
Lo que sigue son las tres cosas que quedan sobre la mesa —lo que hay que conservar, lo que hay que
medir y lo que hay que despersonalizar— en el orden en que conviene hacerlas.

---

### 1. Lo que cambió hoy

| Qué | Estado |
|---|---|
| **`web/`**: el cliente React pasó de la raíz a `web/` con `git mv` — **244 renombres**, el historial se conserva (`git log --follow` sigue andando) | ✅ Commiteado, **sin push** |
| **19 documentos + `deploy.yml` + los 2 scripts de release** reescritos para la estructura nueva | ✅ Commiteado |
| 🗑️ **`flutter/` — descartado el mismo día que nació** | Borrado del repo. El fuente quedó en **`../flutter-descartado-2026-08-17.zip`** (69 archivos, 238 KB) |

**Por qué se descartó Flutter:** se evaluó migrar el APK a `com.distat.app` para sacarse el WebView de
encima (y con él una familia de bugs ya pagados: tablets con Chrome 79 en negro, `plugin-legacy`,
`rAF` que no corre oculto). Se frenó al decidir que el trabajo pasa a ser deuda técnica: **un segundo
cliente duplica cada regla que hoy ya vive en 3 y 4 runtimes**, y no arregla ni la seguridad (vive en
Supabase, que no se migra) ni la precisión del GPS (se degradó a nivel de chip). El análisis completo
—incluido lo que la migración sí resolvía— está en el `README.md` de ese zip. **No volver a proponerlo
sin leerlo.**

⚠️ Y quedó instalado el **SDK de Flutter en `C:\src\flutter`** (~3 GB) que ya no usa nada.

**Nada de esto está en GitHub:** `main` está 0 adelante / 0 atrás de `origin/main`. El commit es local;
lo que sube es `git push`, y pushear a `main` dispara el deploy de la PWA.

⚠️ **Las tres trampas del monorepo** (las tres silenciosas, están en [CLAUDE.md §1](CLAUDE.md)):
`npm`/`vite`/`cap`/`gradle` se corren desde `web/` · un patrón de `.gitignore` que arranca con `/` es
relativo a la RAÍZ y las reglas del keystore necesitaron el prefijo `web/` (**y este repo es
público**) · `defaults.run.working-directory` no afecta a las actions, por eso
`upload-pages-artifact` lleva `web/dist` completo.

**Estado congelado:** `APP_VERSION 1.14.5` · `app_config`: `latest_version` y `bundle_version` en
**1.14.5**, `min_version` **1.13.0** · el parque corre APK **1.13.0** (salvo julii Adet, en 1.6.6).

---

### 2. La calibración de GPS (5 s / 2 s): qué dicen los números del **17/08**

**El veredicto honesto: la cadencia llega donde el chip entrega, y no fabrica precisión.** Medido hoy
sobre `posiciones`, mediana del delta entre puntos consecutivos por persona:

| Persona | Perfil | Cadencia entregada (p50) | `accuracy` p50 | Fixes ≤ 5 m | Puntos |
|---|---|---|---|---|---|
| **Agustin** | `auto` | **2,0 s** | **1,9 m** | 4.067 / 4.406 | 4.406 |
| **Orlando** | `auto` | **2,0 s** | **1,5 m** | 2.642 / 3.086 | 3.086 |
| **Javier** | simple 5 s | 6,3 s ✅ | 36,2 m | 72 / 1.947 | 1.947 |
| **Eduardo** | simple 5 s | 6,6 s ✅ | 39,6 m | 559 / 1.488 | 1.488 |
| **Luis** | simple 5 s | 11,7 s ⚠️ | 4,3 m | 701 / 1.330 | 1.330 |
| **Gabriel** | simple 5 s | **30,0 s** 🔴 | 15,8 m | **0** / 1.014 | 1.014 |
| Nelson | `auto` | 5,4 s | 21,0 m | **0** / 2.392 | 2.392 |
| Zura | `auto` | 6,4 s | 58,8 m | 4 / 1.490 | 1.490 |
| Alejandro | `auto` | 31,8 s | 27,9 m | 1 / 1.002 | 1.002 |

**Lo que sí está probado:**

- **Los 2 s del carril rápido funcionan y son el techo del sistema**: Agustin y Orlando, en `auto`,
  entregan 2,0 s con 1,5-1,9 m. No hace falta perfil para eso — el adaptativo los pone ahí solo.
- **El perfil de 5 s llega al teléfono**: Javier y Eduardo entregan 6,3 y 6,6 s contra los 30 s de
  antes. El camino `panel → perfiles.gps_perfil → configurar() → prefs → servicio nativo` **cierra**.
- **Y no toca la precisión, como estaba dicho de antemano**: Javier corre a 6,3 s con 36 m de error.
  Pedir más seguido no mejora el fix, solo lo pide más seguido (regla 42).

**Lo que el número de Luis explica, y hay que tener presente antes de tocar nada:** pidió 5 s y
entrega 11,7 s **con el chip sano** (4,3 m). No es que no llegue la cadencia: es que **manda
`MIN_MOVE_M` (9 m)**, y caminando despacio uno de cada dos fixes no cruza el umbral y se descarta.
La palanca de densidad caminando es la distancia, no el intervalo.

#### 🔴 Lo que falta probar: los teléfonos con GPS degradado

**Y hay un caso que ya empezó a contestar solo, en contra:** *Gabriel está configurado a 5 s y entrega
30 s* — o sea, exactamente la cadencia del latido de cortesía, que es lo que queda cuando **no hay
nada más que guardar**. Con 0 fixes ≤ 5 m en 1.014 puntos, el candidato es captura, no filtro.

⚠️ **Pero no se puede afirmar todavía, y la razón es la trampa de siempre:** la telemetría de Gabriel
(`estado_dispositivo`) es del **14/08 21:12** y sus puntos son de hoy. Eso significa que **el WebView
no está corriendo y el servicio nativo sí** — el patrón A2. El perfil viaja por `configurar()`, que es
JS: un teléfono con el WebView congelado **no recibe el perfil nuevo y nadie se entera**, porque el
panel muestra el valor viejo que él mismo reportó.

**Protocolo para la prueba, en orden:**

1. **Antes de concluir nada, mirar `updated_at`/`ts` de `estado_dispositivo`.** Si la telemetría no
   es del día, el perfil que muestra el panel es una foto vieja: no prueba qué corre en el teléfono.
2. Los cuatro a probar son los del GNSS que no engancha (§ A1): **Gabriel, Nelson, Zura, Alejandro**.
   Hoy **solo Gabriel tiene perfil**; a los otros tres hay que ponérselo desde el panel.
3. **Para Gabriel el ajuste útil es `min_move_m` HACIA ARRIBA, no hacia abajo** — su `accuracy` p50 es
   15,8 m, o sea que el piso de 9 m está **por debajo de su propio ruido** y cada fix "se movió"
   estando parado. El rango del clamp llega a 100 justamente por esto (`gpsPerfil.js`).
4. **Criterio falsable, escrito antes de mirar:** si con el perfil aplicado y confirmado por
   telemetría del día la cadencia entregada **no baja de ~10 s**, la cadencia no es la palanca para
   ese teléfono — es captura, y lo que lo cierra es el cable o el recambio del equipo (§ A1), no una
   constante.

La consulta que produjo la tabla de arriba (pegar en el SQL editor de Supabase):

```sql
with p as (
  select pos.id_usuario, per.nombre, per.gps_perfil is not null as perfil,
         (pos.ts at time zone 'America/Argentina/Buenos_Aires')::date as dia, pos.accuracy,
         extract(epoch from (pos.ts - lag(pos.ts) over (
           partition by pos.id_usuario, (pos.ts at time zone 'America/Argentina/Buenos_Aires')::date
           order by pos.ts))) as dt
  from posiciones pos join perfiles per on per.id = pos.id_usuario
  where pos.ts >= now() - interval '3 days'
)
select nombre, perfil, dia, count(*) puntos,
       round(percentile_cont(0.5) within group (order by dt)::numeric,1) dt_p50,
       round(percentile_cont(0.5) within group (order by accuracy)::numeric,1) acc_p50,
       count(*) filter (where accuracy <= 5) fixes_buenos
from p group by 1,2,3 order by dia desc, nombre;
```

⚠️ Al leer los contadores de `estado_dispositivo` en la misma sesión: **`fix_desc_movimiento` cuenta
dos veces** el fix retenido (§ A3), así que todo porcentaje de descarte por movimiento está inflado.

---

### 3. 🧹 Sacar "LA UNIÓN" de todo — el plan, en tres olas

**El principio que ordena todo esto:** *LA UNIÓN es un **cliente** (una fila en `empresas`), no la
marca.* El producto se llama **DisT-At**. Lo que se saca es el nombre del cliente de la identidad del
**producto**; los datos del tenant —la empresa, sus clientes, sus usuarios, sus recorridos— **no se
tocan**. El inventario de abajo está verificado contra el repo y las consolas el 17/08/2026.

#### Ola 1 — Consolas. Gratis, sin release, sin riesgo. **Esto es lo que hacés a mano**

| # | Dónde | Qué pasa hoy | Qué hacer | Riesgo |
|---|---|---|---|---|
| **1** | **Google Cloud, proyecto `253436593980`** | Es el proyecto que emite el **Client ID de OAuth** `253436593980-9em17…` (`web/capacitor.config.ts:28`, `AuthContext.jsx:82`) — **el nombre de su pantalla de consentimiento es el que ven los 9 teléfonos al entrar con Google**. Es **otro** proyecto que el de Firebase (`720290370372`), y casi seguro el que `GUIA_API_KEY_GOOGLE_MAPS.md:31` manda a crear como **"LA UNION App"** | Ubicarlo por número en el **Resource Manager** (`console.cloud.google.com/cloud-resource-manager`), y renombrar **dos** cosas: el proyecto (*IAM y administración → Configuración*) y la **pantalla de consentimiento de OAuth** (*APIs y servicios → Pantalla de consentimiento → Nombre de la aplicación*) → `DisT-At` | 🟢 Nulo: el nombre visible no es el ID. **Los scopes son `profile`/`email` (no sensibles), así que no dispara re-verificación** |
| **2** | Mismo proyecto — **API key de Maps** | Google Maps es **código muerto** en este repo (el port está sin consumidores y `VITE_GOOGLE_MAPS_API_KEY` no la lee nadie) | Confirmar que ninguna app la use y **borrarla**. Es superficie de ataque y factura potencial, gratis de eliminar | 🟢 |
| **3** | **Firebase `gestor-local-celulares`** | El **project ID ya es neutro**. Revisar solo el *nombre visible* en *Configuración del proyecto → General* | Si dice LA UNIÓN, renombrar. **El project ID NO se toca** (rompe `google-services.json` y el FCM de los 9 teléfonos) | 🟢 |
| **4** | **Supabase `la-union-pwa`** (ref `lqhtxivednffpiicnbog`) | El nombre del proyecto en el dashboard | Renombrar a `distat` en *Settings → General*. **La URL de la API sale del `ref`, no del nombre**: no se rompe absolutamente nada | 🟢 |
| **5** | **Perfil `pc oficina la union`** (fila de `perfiles`) | Es **dato del cliente**, no marca del producto | Si molesta, se renombra desde el panel de usuarios: es solo un `nombre` | 🟢 |

#### Ola 2 — Cuesta un release. Ordenada, porque el orden importa

| # | Qué | Por qué no es gratis | Orden obligatorio |
|---|---|---|---|
| **6** | **Renombrar el repo** `santiagoadet7823-dev/la-union-app` → `distat-app` | Se lleva puesta la URL de Pages (`/la-union-app/` → `/distat-app/`, que está en `web/vite.config.js:15` y en la regla 1) **y** las URLs de los Releases, que son el CDN del `.apk` y del `bundle.zip`. GitHub deja redirecciones, así que los teléfonos viejos siguen bajando — pero **apoyar el auto-updater en un redirect es exactamente el tipo de cosa que falla en silencio** | (1) renombrar el repo → (2) `base: '/distat-app/'` en `vite.config.js` → (3) `REPO` en `scripts/apk-release.sh` y `ota-release.sh` → (4) push a `main` y verificar que Pages sirve → (5) `update app_config set apk_url=…, bundle_url=…` con las URLs nuevas → (6) publicar una OTA y **verificar en un teléfono real que baja** |
| **6-bis** | ⚠️ **La PWA instalada en el iPhone del dueño se rompe con el rename** | Cambia el path del origen: para el navegador es **otra app** (otro service worker, otro `localStorage`). El ícono del escritorio queda apuntando a una URL que redirige | Avisarle antes, y que la vuelva a agregar a la pantalla de inicio |
| **7** | **Strings sueltos en código** | Ninguno rompe nada, todos son de una línea | `snap-recorridos/index.ts:112` (User-Agent `'la-union-app/1.0 (Distribuidora LA UNION)'`) · `.claude/launch.json:5` (`la-union-dev`) · `localStorage['launion-theme']` (⚠️ cambiarla **resetea el tema** de todos: decidir si vale) · el nombre del `.apk` en el próximo release (`la-union-1.13.0.apk` → `distat-…`) |
| **8** | **Docs** | `GUIA_API_KEY_GOOGLE_MAPS.md` está **obsoleta entera** (nada del código lee esa variable) y es la que manda a crear el proyecto "LA UNION App" | Borrarla, no corregirla. El resto de las menciones son históricas y **se quedan**: son la memoria del proyecto (regla 24) |

#### Ola 3 — Lo que **no se puede** sacar del cliente actual, y cuándo se paga

| Qué | Por qué no se toca | Cuándo se cierra |
|---|---|---|
| 🔴 **`com.launion.app`** — `applicationId`, paquete Java, `custom_url_scheme`, la app Android dentro de Firebase, la restricción del cliente OAuth de Android, el `installerPackageName` y el `-i com.launion.app` de la instalación silenciosa | **Cambiar el applicationId no es un rename: es una app NUEVA.** Los 9 teléfonos quedarían con **dos apps instaladas**; la vieja sigue subiendo con su token (regla 19-bis) y sus datos locales —cola, cuarentena, sesión— **no viajan**; y el auto-updater **no puede actualizar de un package a otro**. Sale caro y sale mal | 🔴 **Sin fecha.** Era lo único que el cliente Flutter (`com.distat.app`) cerraba de una, y Flutter se descartó. **Mientras la app instalada sea la de Capacitor, `com.launion.app` se queda** — es identidad técnica, no marca visible: el usuario ve `DisT-At` (`strings.xml`), el package solo aparece en `adb` y en las consolas |
| 🔴 **Las 9 cuentas `launionvendedorN@gmail.com`** | Gmail **no se renombra**. Solo se sacan creando cuentas nuevas y migrando | **Coincide con el recambio de usuarios ya decidido** (07/08: *"cada teléfono va a tener un usuario nuevo"*). ⚠️ **El orden es obligatorio** (pendiente 4-quater): verificar `app_version ≥ 1.8.0` → actualizar si no → **cerrar sesión DESDE la app** (el `signOut` es el que borra el token; apagar el teléfono NO alcanza) → recién ahí entrar con la cuenta nueva. Si se saltea, los puntos quedan a nombre de quien no estaba, en una tabla sin UPDATE ni DELETE: **incorregible**. Y ojo: la limpieza de duplicados del 12/08 usó como criterio *"se conserva lo que tiene `launion` en el correo"* — con el dominio nuevo ese criterio deja de servir |
| ⚪ **`launion.keystore` y el alias `launion`** | El nombre del archivo y del alias son **internos y no se ven desde afuera**. Cambiar la llave rompe **toda** actualización futura (§2.1) | **Nunca. Se quedan así.** |
| ⚠️ **La carpeta local `propuesta LA UNION/`** | 🩸 La memoria de Claude Code y la config del proyecto cuelgan de una clave **derivada de la ruta** (`C--Users-Gaston-Desktop-propuesta-LA-UNION`). Renombrar la carpeta **sin** renombrar también `~/.claude/projects/<clave>` **pierde el índice de memoria y los settings del proyecto** | Si se renombra, se renombran **las dos** en el mismo movimiento |

#### 🔴 Lo que NO hay que hacer, dicho explícitamente

- **No BORRAR el proyecto de Google Cloud `253436593980`.** Se lleva puesto el Client ID de OAuth, y
  con él el **login con Google de los 9 teléfonos** y el proveedor de Google en Supabase Auth.
  **Renombrar ≠ borrar**, y acá solo se renombra.
- **No cambiar el `applicationId` del cliente Capacitor** (Ola 3).
- **No cambiar el project ID de Firebase** ni el `ref` de Supabase: los dos son inmutables y los dos
  están cableados en clientes que hoy corren en la calle.
- **La empresa LA UNIÓN en la base no se toca.** Es el cliente, y despersonalizar el producto no
  significa borrarle el nombre al que paga.

---

### 4. La deuda técnica, en el orden en que conviene pagarla

El detalle de cada ítem está en **§4 Pendientes** (más abajo) y en
[INFORME_AUDITORIA.md §8](INFORME_AUDITORIA.md). Lo que agrega esta sección es el **orden**, que sale
de agrupar por *qué hace falta desplegar*:

| Bloque | Qué entra | Por qué juntos |
|---|---|---|
| **A — Base y consola** (sin release) | #16 protección de contraseñas filtradas · #14 rotar la key de Stadia · #3 versionar `ingesta_tokens` + `mi_token_ingesta` · #11 `UNIQUE (id_empresa, codigo)` en `clientes` · #13 las 4 columnas sin versionar | Ninguno necesita bundle. Se hacen y se verifican con un `select` el mismo día. **#3 es el más urgente de todos: sin él, una base recreada desde `db/` no puede recibir una sola posición** |
| **B — Una sola OTA** | #12 decidir `AdminView` (borrar 2 vistas, rescatar `ReplayJornada`) · #9 el copy de `PermisoSiemprePrompt` · #18 unificar `getAccessToken` (copiado 3 veces) · #10 `build:apk` con `CAP_BUILD=1` adentro · #15 config de ESLint y sacar el `\|\| true` · #17 sanear docs | Todo JS/docs. Un solo bundle, una sola verificación en el emulador. ⚠️ **Verificar en el DOM, no en el build**: `npm run build` da EXIT=0 con un `ReferenceError` que el `ErrorBoundary` tapa |
| **C — El próximo APK, TODO en un solo build** | P7 el doble conteo de la telemetría · P8 `cola.remove(0)` sin cuarentena (**la única violación viva de la regla 20**) · P9 los defaults de Java que difieren de producción · P10 actualización que no dependa del WebView · 4-ter la ventana de horario por FCM · P11 vidriera: reinstalar por USB — son SEIS arreglos acumulados (gap ×2, botón Pedir, salvapantallas 5 min, fotos cortadas, cambio de cliente) | Un APK cuesta una visita física o una ventana de Tailscale por equipo. Se junta todo o no se junta nada |

> ✅ **La decisión que condicionaba el bloque C ya está tomada (17/08/2026): se descarta Flutter.**
> Las 5 tareas son nativas y ahora tienen **un solo destino**: `web/android/app/src/main/java/`.
> Se escriben una vez y no hay que elegir cliente.
>
> 🟠 **P11 (20/08/2026) — la tablet de la vidriera acumula TRES arreglos sin publicar.** Ninguno le
> puede llegar por OTA: no inicia sesión ni toca internet, así que se queda congelada en el bundle
> que trajo su APK (§6). Todos necesitan **un APK nuevo**:
>
> 🩸 **Y el USB NO es el único camino — esto estaba mal escrito acá (corregido el 22/08/2026).**
> Verificado en el código: `UpdatePrompt` se monta **fuera del `<Gate/>`** y su única condición es
> `nativo`, sin sesión; `apkCheck()` no pide sesión; y `app_config` tiene `app_config_sel` **`to
> public using (true)`**, o sea legible por `anon` (verificado en la base viva). El impedimento de la
> tablet **no es el canal de actualización: es que no tiene internet**. El hotspot del vendedor es
> `startLocalOnlyHotspot`, sin salida a la red — eso es el diseño, no una falla.
>
> **Conectándola UNA vez a un WiFi común con internet, se actualiza sola**: lee `min_version`, baja el
> `.apk` de GitHub Releases y lanza el instalador. El USB sigue sirviendo, pero es la opción cara.
> Dos condiciones: que su APK instalado tenga el plugin `ApkUpdater` (existe desde 1.12.0, y por el
> registro la tablet está en 1.18.0 — **no verificable desde la base**, porque nunca escribe latido),
> y que alguien toque el diálogo de instalación de Android salvo que la app sea su propio instalador
> de registro (ver la nota del `adb install -r -i` en `CLAUDE.md` §6).
>
> Los seis arreglos:
> 1. El `gap` de flexbox en `VidrieraTablet` (commit `511aebb`, 19/08 21:48). El APK 1.18.0 que
>    corre en esa tablet se compiló el 18/08 18:08, **un día antes** del arreglo.
> 2. El `gap` de flexbox en **`LoginView`** — 14 contenedores, y es la PRIMERA pantalla que ve la
>    tablet (ahí está "Soy una tablet · escanear código"). Se había dado por cerrado el tema
>    mirando solo `VidrieraTablet`.
> 3. **La ficha grande apilada**: el botón "Pedir N" medía 34,8 px y caía 9,5 px fuera de la
>    pantalla. Es lo que reportó el cliente con una foto. Medido y arreglado; detalle en
>    [HANDOFF_VIDRIERA.md](HANDOFF_VIDRIERA.md) §4.B-bis.
> 4. **(22/08) El salvapantallas a los 30 s.** El número sube a **5 min**, pero el problema de
>    fondo era otro: el reloj **casi no se rearmaba** — no lo tocaban el scroll, el buscador, los
>    filtros ni el stepper, y el despertador de la raíz sólo actuaba estando ya dormida. Ahora se
>    mide contra un sello de actividad. Verificado con reloj falso: a los 4 min sigue despierta, a
>    los 6 se duerme, un toque la despierta, y 2 min después de un scroll sigue despierta.
> 5. **(22/08) Las fotos cortadas.** El alto estaba FIJO en 190 px con el ancho de columna elástico:
>    a 478 px la caja quedaba **219×190** y `object-fit:cover` se comía **29 px (12,8 %)** del
>    producto. Ahora se calcula del ancho real de la grilla. Medido en 10 anchos: el recorte pasa de
>    **6,7–180 px a 0–0,7 px**.
> 6. **(22/08) La tablet se quedaba con el PRIMER cliente.** El catálogo se republicaba bien desde el
>    celular, pero `ServidorLocal.publicarCatalogo` reemplaza la variable **y nada más**: no encola
>    evento ni despierta el long-poll. El celular ahora emite un evento `catalogo` (eso sí viaja por
>    OTA) y la tablet lo escucha (eso necesita el APK).
>
> 🩸 **Y uno que apareció al verificar**: `VidrieraTablet` ponía `vivo.current = false` al limpiar
> el efecto de montaje y **nunca lo volvía a poner en `true`**. Con `<StrictMode>` —que `main.jsx`
> usa— React 18 invoca cada efecto dos veces en desarrollo, así que **la pantalla entera quedaba
> muerta en dev**: sin fotos, sin reloj de reposo, sin acuse del toque, sin resync. En producción no
> pasa, por eso nunca se notó — y por eso importa: una pantalla que sólo se puede probar en la
> tablet es una pantalla que no se prueba.

---

## 🟢 RELEASE 1.21.0 — publicado el 22/08/2026 21:13 (hora Salta)

Salió por los tres canales, en este orden: `db/47` → Edge Function → OTA → PWA → push.

| Paso | Resultado |
|---|---|
| `db/47` (`alertas_upd` jerarquizada) | ✅ aplicada y verificada: `alertas_sel` y `alertas_upd` nombran las dos a `ids_a_mi_cargo()` |
| Edge Function `alertas-equipo` v4 | ✅ invocada a mano: **200**, `enviados 12 · fallidos 0 · errores []` |
| OTA `ota-1.21.0/bundle.zip` | ✅ 1.315.521 bytes. **Bajado y abierto** para comprobar (lección de 1.19.0): `index.html` en la raíz, y los cambios presentes en el chunk moderno **y** en el legacy — `1.21.0`, `3e5` (los 5 min del reposo), `tab-separated-values`, `Ordenar por recorrido`, `no cambies el WiFi` |
| APK `apk-1.21.0/app-release.apk` | ✅ 22.462.721 bytes, `versionCode 37`, base `./`, firmado |
| `app_config` | ✅ `bundle_version`/`latest_version`/`min_version` = 1.21.0, las dos URLs devuelven 200 |
| PWA (GitHub Pages) | ✅ workflow `completed success` |
| `push-actualizacion` | ✅ **200**, `{"version":"1.21.0","enviados":13,"fallidos":0,"errores":[]}` |

**Valores anteriores, por si hay que volver:** `bundle_version`/`latest_version` `1.20.0`,
`min_version` `1.18.0`, `bundle_url` → `ota-1.20.0/bundle.zip`, `apk_url` → `apk-1.18.0/app-release.apk`.

### La línea de base del parque, y una conclusión que hubo que corregir

⚠️ **Primero se escribió acá que "el auto-update del APK no funciona". Era FALSO**, y salió de
mirar a los rezagados sin mirar al resto. El dato completo:

| APK | Equipos | Bundle que corren |
|---|---|---|
| **1.18.0** | **9** | `1.20.0` los nueve — al día |
| `1.13.0` | 4 | `1.20.0` (Gabriel) · `1.15.1` · `1.14.5` · `1.14.0` |

**El auto-update del APK SÍ funciona: 9 de 13 equipos pasaron solos de ≤1.13.0 a 1.18.0** cuando se
subió `min_version` el 18/08. Eso es justamente lo que se esperaba que hiciera.

De los 4 que quedaron en `1.13.0`, **tres no están corriendo la app**: sus bundles quedaron en 1.14.0,
1.14.5 y 1.15.1, o sea que **tampoco toman OTAs**, y sus latidos son del 14, 18 y 20/08. No hay un
mecanismo roto ahí — hay teléfonos apagados o sin usar. No se puede actualizar lo que no arranca.

### 🔴 Queda UNA anomalía real: Gabriel tevez

| | Gabriel | Los 9 que sí actualizaron |
|---|---|---|
| Bundle (OTA) | `1.20.0` — **el más nuevo** | `1.20.0` |
| APK | **`1.13.0`** | `1.18.0` |
| Equipo | SM-A075M | 4 de ellos, el MISMO SM-A075M |
| `notif_permiso` | `granted` | `granted` |
| `bateria_exenta` | `true` | `true` |
| `instalado_ts` | 07/08 16:01 | 07/08, misma tanda |
| Latido | **22/08 13:48** (activo hoy) | idem |

O sea: **baja y aplica OTAs, pero no el APK**, con el mismo modelo, los mismos permisos y la misma
fecha de instalación que cuatro compañeros que sí se actualizaron. En la telemetría es
**indistinguible** de ellos.

### 🚩 Y por eso no se puede saber más: el camino del APK NO TIENE TELEMETRÍA

`estado_dispositivo` tiene `bundle_aplicado`, `bundle_encolado` y `ota_error` — los tres se
agregaron en 1.20.0 (`db/46`) justamente porque, con 1.19.0, "falló la descarga", "está bajada
esperando" y "ni lo intentó" se veían **idénticos desde el servidor**.

**Para el APK esa ceguera sigue intacta.** No hay `apk_error`, ni `apk_intento_ts`, ni nada. Las tres
explicaciones posibles del caso de Gabriel — falta el permiso de "instalar apps desconocidas", el
equipo no es su propio instalador de registro (`adb install -r -i`), o la descarga falla y el freno
de 6 h (`APK_REINTENTO_MS`) esconde el reintento — **se ven todas igual: nada**.

👉 **Lo que corresponde**: darle al camino del APK la misma telemetría que se le dio a la OTA en
1.20.0. Es la misma lección de 1.19.0, una capa más abajo. Con eso, el caso de Gabriel se contesta
solo en el próximo intento en vez de requerir tener el teléfono en la mano.

### Lo que esto significa para la tablet

Que el mecanismo **funciona en general** (9 de 9 equipos activos), así que conectar la tablet a un
WiFi con internet es una vía razonable y vale la pena probarla antes de sacar el cable. Pero el caso
de Gabriel dice que **puede no cerrar y que no habría forma de enterarse desde acá**. Si se prueba
con la tablet, hay que confirmar el resultado **mirando la tablet**, no el servidor.

---

## 🔴 El Dashboard se cae por timeout, y empeora solo (medido el 22/08/2026)

**Síntoma:** el Dashboard tira **HTTP 500 / `57014 canceling statement due to statement timeout`** al
pedir el horizonte "mes". Se ve en la consola en cada intento, y los números no cargan.

**No es un bug nuevo ni lo introdujo 1.21.0** — apareció al verificar otra cosa. Es la RPC
`metricas_actividad` (`db/21`, endurecida en `db/33`/`db/40`) contra el tamaño actual de `posiciones`.

### Lo medido, contra la base viva

`statement_timeout` del rol `authenticated` = **8 s** (`anon` 3 s). El costo es **lineal en puntos**,
~26 µs por posición:

| Rango | Posiciones | Tiempo | |
|---|---|---|---|
| 1 día | 20.133 | **0,55 s** | ✅ |
| 7 días | 134.906 | **4,30 s** | ✅ |
| 30 días | 207.630 | **7,21 s** | ⚠️ a 0,8 s del muro |
| 150 días | 207.632 | 5,24 s | (mismo dato; la diferencia es caché) |

### Dos hipótesis probadas y DESCARTADAS

- **No es `work_mem`.** El plan derrama ~25 MB a disco (`temp read=3116`), pero subírselo a 64 MB
  bajó de 5.535 ms a 5.197 ms: **6 %**. El derrame no era el cuello; el trabajo es CPU.
- **No es un índice faltante.** `posiciones` no tiene índice por `id_empresa`, que es por donde
  filtra la función — pero **una empresa tiene 207.415 filas de 207.618**. Un índice sobre una
  columna con un 99,9 % de un solo valor no evita leer nada.

El costo real son **207 k filas × haversine (6 llamadas trigonométricas por fila) × 4 pasadas de
window function**, en una función que recomputa todo en cada carga de pantalla.

### 🔴 Y esto empeora sin que nadie toque el código

Es la regla 50 otra vez. Hoy la tabla tiene **10 días** de datos (12/08–22/08), pero la retención es
de **45**. A ~20.000 puntos por día, cuando se llene:

**45 días ≈ 900.000 filas ≈ 23 segundos.** Ahí **también falla el horizonte de 7 días**, no sólo el de
mes. Y cada mejora de densidad del GPS acelera la cuenta.

### El arreglo, y por qué NO se hizo acá

Lo correcto es **precomputar**: una tabla de resumen diario (`metricas_dia`) que llene un cron una vez
por día, y que el Dashboard lea 93 filas en vez de recalcular 200.000. Es lo que convierte 7 segundos
en milisegundos y lo que hace que deje de crecer.

Eso es una migración + un cron + cambiar el hook, con su propia verificación (los números nuevos
tienen que dar **idénticos** a los de hoy sobre los mismos días — regla 49). **No entra apurado en un
release de otra cosa.**

Parches que NO recomiendo, y por qué:
- Subir `statement_timeout` de la función a 30 s: esconde el problema y deja un Dashboard que tarda
  7 segundos en abrir, hasta que a los 45 días tarde 23.
- Cambiar el haversine por una aproximación barata: cambia los kilómetros que la app viene
  informando. Eso es cambiar una decisión, no optimizar (regla 50-bis).

**Mientras tanto**: los horizontes de **día y semana funcionan** (0,55 s y 4,3 s). El que falla es
"mes".

---

## 🟢 SESIÓN DEL 12/08/2026 (tarde) — Auditoría de GPS + primeros arreglos

**Leer esto primero para retomar.** El informe completo, con la evidencia medida, está en
**[AUDITORIA_GPS_2026-08.md](AUDITORIA_GPS_2026-08.md)**.

### El veredicto, en tres líneas

Los tres síntomas del cliente —"se pierden ubicaciones", "hay celulares que no mandan", "hay saltos
ilógicos"— eran **tres fallas distintas**, y **ninguna era la sospechada**. La hipótesis de partida
(*"la triangulación rompió el pegado a calles"*) acierta el mecanismo y falla el culpable: el carril
de triangulación aporta **0-50 puntos por día**; los puntos imprecisos los devuelve **FusedLocation**,
que entrega ubicación de antena sin decirlo y pasa el techo de confianza de 30 m.

Y **no hubo una versión sana**: las filas de snap vacías arrancan el **07/07** y aparecen con todos
los algos (2, 3, 6, 7, 10). El defecto estaba latente desde julio; lo reveló que el parque empezara a
entregar fixes ruidosos.

### ✅ En producción, verificado con datos reales

| Qué | Dónde | Verificación |
|---|---|---|
| **ALGO 11** — quieto = dibujar crudo, no descartar. Era la causa de que se borraran días enteros | `snap-recorridos` **v16** (`verify_jwt: true`) | El 12/08 pasó a `algo 11` y **0 filas vacías**; Nelson de **2 → 207 bytes** |
| **P3** — "reportando" sale de la posición, no del latido del JS | `db/36` + `useDiagnosticoEquipo` | Nelson: de *"Sin actividad hoy"* a **"OK · hace 44s"**, leído del DOM |
| **`gps-no-engancha`** — detecta un GNSS muerto contando fixes ≤ 5 m | `db/37` + el mismo hook | Nelson y Gabriel salen marcados; Javier/Orlando/Agustin no |
| **P5** — `ultimas_posiciones_compartidas` filtra `accuracy` | `db/35` | `proacl` real verificado, sin PUBLIC ni anon |
| **P6** — cuentas duplicadas | — | 10 perfiles + 10 logins + 23.945 posiciones eliminados |

⚠️ **Los `db/35-37` están aplicados en la base viva pero el bundle NO está publicado.** El cambio de
`useDiagnosticoEquipo` vive solo en el working tree: **falta la OTA**.

### 🔴 Lo que NO se puede arreglar desde acá

**Cuatro teléfonos necesitan intervención física** y son la causa principal de lo que ve el cliente:

- **Nelson, Zura, Alejandro, Gabriel** — el GNSS **no engancha**: cero fixes ≤ 5 m en 8 días, sobre
  miles de puntos. Se ubican por antenas a 15-25 m. Nelson además **se degradó** (el 07/08 tenía
  82,7 % de fixes buenos y 1,4 m).
- **Javier es OTRO caso y no hay que confundirlos**: su GNSS engancha perfecto (1,3 m) pero **se le
  apaga** — 9 huecos de más de 10 min y uno de 37,8. Sospechoso: el solapamiento de sensores (el
  watcher JS a 1 Hz peleando con el request nativo). Necesita APK.

🩸 **Y hay un círculo que hay que romper:** los teléfonos con el WebView congelado **no pueden bajar
ni la OTA ni el APK**, porque el auto-updater es JS. Nelson quedó en 1.13.0 y Alejandro en 1.13.1
mientras el resto llegó a 1.13.8, y `latest_version` ya apuntaba bien. *Los equipos que más necesitan
el arreglo son estructuralmente los que no lo pueden recibir* — solo se destraba con el cable.

### Pendiente, en orden

1. **Publicar la OTA** con el `useDiagnosticoEquipo` nuevo (build en verde, verificado en pantalla).
2. **P4** — mostrar en la UI el desglose de `crudos`/`truncados` que el snap ya manda en `_meta`.
3. **Lote de APK (P7-P10), TODO EN UN SOLO BUILD** para que viaje con la visita física:
   - **P7** — `UploaderGpsService.java:749` y `:759-762` cuentan **dos veces** el fix retenido. La
     suma de destinos supera `fix_total` en todos los equipos (Agustin +592). Hasta arreglarlo, la
     invariante "cada fix tiene destino conocido" **no puede cerrar por definición**.
   - **P8** — `cola.remove(0)` (`:1005`) descarta los puntos más viejos **sin cuarentena ni
     telemetría**: la única violación viva de la regla 20.
   - **P9** — los defaults de Java difieren de producción (`intervalo 15 s`, `minMove 12 m`,
     `keepAlive 60 s`, `silencio 90 s`).
   - **P10** — camino de actualización que no dependa del WebView.
4. **Cruce de empresas sin cerrar**: hay **3 posiciones de `cardixteam@gmail.com` (Prueba SaaS)
   escritas dentro de LA UNIÓN** el 11/08 21:26. Son 3 puntos de una cuenta de prueba, pero prueban
   que la guarda de las reglas 11 y 32 **no está sosteniendo**, y `posiciones` no tiene policy de
   UPDATE ni DELETE: esa fila no se corrige desde la app.

### Dos lecciones de método que costaron algo hoy

- 🩸 **El build verde no prueba nada del DOM.** Un `ReferenceError` del HMR quedó tapado por el
  `ErrorBoundary` mientras `npm run build` daba EXIT=0. Lo cazó el chequeo del DOM.
- 🩸 **Un agregado sobre la cola de la distribución miente.** Detectar el GNSS muerto con
  `min(accuracy) > 8` dejaba pasar a Gabriel, que tiene su mejor fix en 5,8 m y **cero** fixes buenos
  en mil puntos. Lo que funciona es **contar**, no medir un extremo.

---

### Publicado — 1.14.8 (18/08/2026) — **Se retira el pegado a calles, y los botones apagados avisan que existen**

#### 🔴 El botón "Calles" se fue, y el pegado de TRAMOS con él

Pedido del cliente, textual: *"los usuarios que actualmente son encargados no entienden el
funcionamiento, deberíamos quitarlo porque se confunde con tantas cosas"* y, sobre el pegado en sí,
*"hay trazos que toman caminos que nunca recorrió, así que lo ideal es sacarlo y borrar, porque hay
teléfonos que son muy fieles a la ubicación que envían"*.

**Tiene respaldo en lo medido**: Orlando y Agustin trabajan con p90 de 1,9 y 5,0 m. Sobre un rastro
así, OSRM solo puede agregar error — reencamina entre waypoints y elige el camino más corto, que no
es necesariamente el que se hizo.

⚠️ **Lo que SÍ se conservó es el CONECTOR de los huecos largos** (el de 1.14.6). Son dos mecanismos
distintos y por suerte quedaron separados el día anterior: el pegado de tramos reencamina lo
observado; el conector solo une dos puntas que **no tienen nada en el medio**, y solo cuando hay un
único camino posible (ruta/recta ≤ ×1,25). Sin él volvía la recta a campo traviesa de González a
Lajitas, que es lo que el mismo cliente pidió arreglar el día anterior.

Y para que no se pisen, el conector recto **se saltea donde ya hay uno ruteado** (se emparejan por
las puntas con 50 m de tolerancia: el ruteo arranca en el punto encajado a la calle, no en el dato).

**Para volver a prenderlo**: `snapped[t.id]` sigue llegando de la Edge Function y `cubreElRecorrido`
sigue escrita con su calibración. Son tres líneas y el botón.

#### Las paradas arrancan apagadas, y los botones lo dicen

`dwellOn` pasa a `false` en las dos supervisiones: `calcularDwells` cuesta **~250 ms por
persona-día** —unos 2,5 s de hilo principal con el equipo completo— y se pagaba siempre, incluso
cuando lo que se quiere ver es dónde está la gente ahora.

Un botón apagado, sin texto y con un ícono, es indistinguible de uno que no hace nada. Por eso
`components/PistaBoton.jsx` (nuevo): una etiqueta que aparece al abrir, **late 3 veces con `lu-blink`
y se va sola a los 4,2 s**. Va en "Paradas" y en "Seguir", en el rail (a la izquierda) y en la barra
de chips de Desktop (arriba). No recuerda si ya se mostró — el pedido es *cada vez*, y con razón: el
problema no es que no se enteraron una vez, es que no lo tienen incorporado.

### Publicado — 1.14.7 (18/08/2026) — **Burbujas de parada, fotos huérfanas y exportación honesta**

#### 1. Burbujas de parada en pantalla completa

`components/BurbujasParadas.jsx` (nuevo, compartido por las dos supervisiones — regla 31). Al tocar
a una persona en modo inmersivo aparece una tira de burbujas, **una por parada, con el mismo número
que los carteles del mapa y la columna "#" de la planilla**; tocar una vuela hasta ella.

Reusa todo lo que ya existía: `calcularDwells` (que ya trae `orden`, `id`, `lat`, `lng`), el
`focus={{points, nonce}}` de `LeafletMap` —que ya distinguía el caso de un punto solo y hace `flyTo`
con zoom mínimo 16— y el lenguaje visual de `BurbujasEquipo`. **No recalcula nada**: filtra un array.

🩸 El índice que viaja es el **global** dentro de `dwells`, no el de la lista filtrada: `dwellSel` es
una posición en el array entero (así lo consume `LeafletMap`), y usar el del filtro abriría el
cartel de otra persona en cuanto haya más de una en el mapa.

#### 2. Las fotos se van con su producto

`deleteProducto` encolaba el DELETE de la fila y **nunca tocaba Storage**: al 18/08 había **626
fotos huérfanas (13 MB) contra 0 productos**. Se agregó la op `borrarArchivos` a la cola de
escrituras (idempotente; y un fallo **no tapona la cola**, que sería peor que la foto perdida) y las
626 se borraron **por la API de Storage** — no por SQL: borrar la fila de `storage.objects` deja el
archivo en S3, invisible y facturándose igual. Inventario en `../fotos-huerfanas-2026-08-18.txt`.

**`db/41`** — la foto ahora exige el **mismo rol que la fila**. `productos_wr` pedía rol y la policy
de Storage solo miraba la carpeta: un `vendedor` no podía borrar un producto pero **sí su foto**. El
aislamiento entre empresas nunca estuvo comprometido.

🟡 Queda sin cerrar: **no hay forma de saber quién borró el catálogo**. `productos` no tiene borrado
lógico ni auditoría.

#### 3. "Excel y PDF salen en blanco" — medido

| Día | Datos | Excel |
|---|---|---|
| 17/08 | 10 personas, 383 km | **73.786 bytes**, hojas pobladas |
| 18/08 (madrugada) | ninguno | **17.509 bytes**, `.xlsx` **válido con las hojas vacías** |

La exportación funciona. Lo que engaña es que **el informe abre en el día de HOY**: de madrugada, o
un domingo (el 16/08 tuvo 3 puntos en total), está legítimamente vacío y el archivo que sale parece
un bug. Desde 1.14.7 **no se exporta un informe vacío: se avisa**.

Y los dos botones **fallaban mudos** — llamaban a funciones `async` sin `catch`, así que cualquier
excepción (el `import('xlsx')`, `Filesystem`, el plugin de impresión) moría en una promesa rechazada.
Ahora el error se muestra. ⚠️ **Los caminos NATIVOS del APK quedaron sin probar** (`Filesystem`+
`Share`, plugin `Impresion`): si ahí falla, ahora se ve el mensaje en vez de un archivo mudo.

> El arreglo de fondo del PDF (`moverInformeABody`) es de 1.14.6, la noche anterior: estaba escrito
> desde una sesión previa y sin publicar.

### Publicado — 1.14.6 (17/08/2026) — **El trazo va por la ruta, y el respaldo se prende por persona**

#### El reporte y el diagnóstico

*"En ruta Javier no guarda ubicaciones o guarda muy esporádicamente, y no logro encontrar si es por
velocidad o porque muere el GPS estando sin señal de internet."* **No era ninguna de las dos.**

| Hipótesis | Veredicto | Evidencia |
|---|---|---|
| Velocidad (el filtro descarta) | ❌ | 7 tramos de 21-27 km con **cero puntos**. A 50 km/h cualquier fix supera los 50 m: cero puntos ⇒ no llegó ni un fix. Y en la banda 40-70 km/h el parque guarda uno cada **29,8 m** (9.663 hops) |
| Falta de internet | ❌ | En el **medio de ese mismo corredor**, Orlando tiene **3.621 puntos a 1,5 m** de precisión. 1,5 m es GNSS puro, que no usa internet. Y `cola_pendiente` = 0 |
| La hora se sella al subir | ❌ | El `ts` sale de `loc.getTime()` y sobrevive intacto hasta el render. Prueba empírica: **cero segundos con más de 2 puntos** en 5 días — si se sellara al subir, un lote offline caería junto |
| **El chip de Javier** | ✅ | 46,9 m contra los 1,5 de Orlando en la misma ruta. Su servicio registró un silencio de **38,8 min**: despierto, contando, y sin recibir nada |

#### Lo que se cambió

- **`snap-recorridos` ALGO 12** — se rutea el **conector** entre segmentos (no el tramo: un hueco de
  27 min supera `GAP_MS`, así que los 25 km **no son parte de ningún tramo**, son el borde entre
  dos). Condiciones: > 5 km, < 90 min, velocidad de vehículo, y la ruta no puede medir más de
  **×1,25** la recta — la prueba de que hay un solo camino. Sobre el día real: **29 conectores → 4
  ruteados** (los 4 viajes en ruta, ratios ×1,005 a ×1,042) y **25 quedan rectos** (todos urbanos,
  el mayor de 0,82 km).
  **Verificado en producción** (v17, `verify_jwt` true) sobre el 17/08: los 10 usuarios recalculados
  con `algo 12`, **Javier 5 conectores y Eduardo 2**, y **0 en los otros ocho** — los que trabajan en
  el pueblo. Los km no se inflan: Javier 117 → 120,6 (×1,03), Eduardo 66,2 → 67,5 (×1,02).
  (Javier dio 5 y no los 4 del harness porque aquella copia de sus puntos era de las 20:15.)
- **`gpsPerfil.js`** — clave nueva `silencio_s` [150, 900] que **pisa el apagado de la triangulación
  del modo simple**. Los teléfonos con el GNSS degradado tenían apagada la única red que podía
  taparlos. Campo nuevo en el panel de Usuarios.

#### Tres cosas que costaron y conviene no repetir

- 🩸 **La primera hipótesis (relajar la guarda de tramo ciego) era falsa, y solo se supo corriendo el
  código real contra el día real.** El harness está en el scratchpad; el patrón —compilar
  `segmentar.ts` a `.mjs` y alimentarlo con los puntos de la base— vale para cualquier cambio del snap.
- 🩸 **El conector no puede ir mezclado en `geometrias`**: `cubreElRecorrido` compara pegado contra
  crudo para descartar un snap que borró recorrido, y un conector agrega largo **sin contraparte
  cruda**. Mezclarlo apagaba la guarda. Viaja en `_conectores`, aparte.
- 🩸 **Y tiene presupuesto propio de ruteos** (`MAX_RUTEOS_CONECTOR`): se resuelven últimos, así que
  compartiendo el pote de 40 se habrían quedado sin cupo justo los días cargados — la feature
  andaría los días tranquilos y fallaría en silencio los demás.

### Publicado — 1.13.8 (12/08/2026) — **El snap borraba recorrido. OTA + PWA**

#### 🔴 "El pegado a calles elimina el trazo" — el cliente tenía razón, y el mecanismo era literal

Reportado así: *"al tener un ruido de gps el pegado a calles no sabe a cuál va y elimina el trazo"*.

`snap-recorridos` descartaba **el segmento entero** cuando `isStationary` lo consideraba quieto —un
`continue` sin devolver nada—. Y como el front usa **SOLO** la geometría pegada cuando viene no vacía
(`construirLeaflet`: `segs && segs.length`), cada segmento que caía ahí **desaparecía del mapa**.

`isStationary` compara la mediana de distancia al centro contra `STATIONARY_R` = **40 m**: en un
teléfono con 20 m de error, un tramo caminado de un par de cuadras la cumple. Medido sobre la jornada
del 12/08, metros que desaparecían al prender "Calles" (que está **encendido por defecto** en las
tres supervisiones):

| | segmentos | descartados | **metros que desaparecían** | % del día |
|---|---|---|---|---|
| **Nelson rojas** | 1 | 1 | **6.446 m** | **100 %** |
| **Luis Mendoza** | 5 | 3 | **5.230 m** | **62 %** |
| Gabriel tevez | 3 | 1 | 1.591 m | 18 % |
| Javier | 7 | 3 | 47 m | 0 % |
| Orlando · Agustin (1,6 m de precisión) | 1 | **0** | **0** | **0 %** |

**La correlación es con el RUIDO del GPS, no con la persona.** Los de 14-20 m de mediana perdían
trazo; los de 1,6 m no perdían nada. La intención original era correcta —rutear jitter inventa
vueltas— pero la ejecución tiraba el dato en vez de dejarlo crudo. Con "Calles" APAGADO esos mismos
puntos SÍ se dibujan: prender el botón borraba parte del recorrido.

**Dos arreglos, uno publicado y uno listo sin desplegar:**

1. ✅ **PUBLICADO (front, OTA)** — `construirLeaflet` compara el largo de lo pegado contra el crudo y
   **usa el crudo si la cobertura cae por debajo del 75 %**. No es una optimización: es el invariante
   *"el snap no puede borrar recorrido"*, y **se queda para siempre** — el snap es un servicio remoto
   con su propio cache y sus propias guardas, y ninguna puede tener licencia para borrar kilómetros.
   Recupera **11.676 de los 13.314 m** (Nelson y Luis enteros; Gabriel queda al 82 % y no dispara).
2. ⏳ **ESCRITO Y SIN DESPLEGAR (Edge Function)** — `snap-recorridos`: `quieto` deja de descartar y
   pasa a `usarCrudo('quieto')`, con `ALGO` subido a **11** para invalidar el cache viejo (sin eso los
   días ya calculados seguirían devolviendo la geometría incompleta). Cubre además el 18 % de Gabriel.
   **El deploy quedó pendiente por presupuesto de contexto, no por riesgo**: el cambio está commiteado
   y verificado, y si la función fallara el front cae al crudo, que es más seguro que hoy.
   ⚠️ Va con **`verify_jwt: true`** (es el valor actual; se autentica con la sesión del usuario).

### Publicado — 1.13.7 (12/08/2026) — **OTA + PWA. Y la comparación que reencuadra todo**

#### 🔴 LO MÁS IMPORTANTE DE ESTA SESIÓN: el código no empeoró, el GPS de los teléfonos sí

El cliente pidió comparar contra versiones anteriores *"cuando todo funcionaba ok"*. Tenía razón, y
el dato reencuadra semanas de trabajo. Misma vara, todos los días guardados:

| día | personas | km | **línea llena** | punteado | **sin nada** | huecos duros | recta más larga |
|---|---|---|---|---|---|---|---|
| **06/08** | 3 | 106 | **100 %** | 0 | **0 %** | 1 | **270 m** |
| **07/08** | 7 | 271 | **100 %** | 0 | **0 %** | 2 | **285 m** |
| 08/08 | 12 | 647 | 36 % | 0 | **64 %** | **97** | 3.839 m |
| 10/08 | 8 | 231 | 73 % | 1 % | 26 % | 71 | 1.016 m |
| 11/08 | 9 | 552 | 53 % | 3 % | 44 % | 65 | 2.192 m |
| 12/08 | 6 | 200 | 57 % | 24 % | 19 % | **5** | 4.174 m |

**Algo se rompió el 08/08.** Y la causa NO es la app — es la PRECISIÓN del chip. Mediana de
`accuracy` por persona y día:

| | 05-07/08 | 08/08 | 12/08 |
|---|---|---|---|
| **Nelson rojas** | **1,5 m** (86 % ≤10 m) | **23,5 m** (0 %) | 19,6 m (0 %) |
| **Luis Mendoza** | **3,2 m** (98 %) | **25,7 m** (4 %) | 16,8 m |
| Orlando chavez | — | 1,0 m (81 %) | **1,6 m (96 %)** |
| Agustin Vasquez | — | 24,2 m | **1,6 m (100 %)** |
| Javier | — | 20,0 m | 18,3 m |
| Gabriel tevez | 12,1 m | 14,6 m | 13,7 m |

**Nelson pasó de 1,5 m a 23,5 m de un día para el otro. Luis, de 3,2 a 25,7.** Con mediana de 1,5 m
el carril de triangulación no se enciende NUNCA y el trazo es 100 % línea llena; con 20 m se
enciende todo el tiempo. Todo lo demás —el punteado, los huecos, las rectas largas— es consecuencia.

**Y que no es la app lo prueban Orlando y Agustin**: corren exactamente el mismo bundle y están en
1,6 m con trazos perfectos. Si el software hubiera degradado el GPS, los degradaría a todos.

⚠️ El 08/08 es el día en que se configuró el parque nuevo por cable (`INVENTARIO_TELEFONOS.md`) y se
cambiaron las cuentas. **Hay dos poblaciones de aparato y hay que separarlas mirando `accuracy`, no
la versión.**

🔎 **La sospecha número uno para el próximo turno** (medida a medias, NO confirmada): el plugin JS de
Capacitor mantiene un watcher con `PRIORITY_HIGH_ACCURACY` **a 1 Hz** —hardcodeado, no se toca desde
JS— **en paralelo** con el request del servicio nativo. Con el uploader nativo activo ese carril **ya
no encola ni sube nada** (`tracker.js`, `if (!uploaderNativoActivo)`): sobrevive solo para alimentar
el heartbeat y el `pos` del `GpsGate`. En `dumpsys location` de Javier se ven los dos requests
peleando (`@0` / `@+1s0ms` en ráfagas cada 60 s, y después `OFF`). Sacarlo o espaciarlo es un cambio
de APK y necesita reemplazar antes las dos cosas que sí usa.

#### Lo que sí se publicó hoy: el carril punteado deja de inventar camino

El cliente reportó que el trazo *"sigue haciendo trazos por sobre las cuadras"*. Medido: **el 80 % de
los metros dibujados de Javier salían del carril TRIANGULADO**, con rectas de 141 m de promedio. Su
línea de GPS puro promedia 21 m — ésa nunca estuvo mal.

Unir con una recta dos fixes de ±100 m separados por kilómetros no es un trazo impreciso: es una
invención. Es el mismo error de la regla 49, cometido en el otro carril. Desde 1.13.7 el tramo
punteado **se corta a los `APROX_MAX_TRAMO_M` = 150 m**.

A/B con el código real sobre la jornada del 12/08:

| | antes tramos / metros / **la más larga** | después |
|---|---|---|
| Javier | 234 / 32.794 m / **4.174 m** | 213 / **7.249 m** / **144 m** |
| Luis Mendoza | 156 / 31.877 m / **21.594 m** | 142 / **5.479 m** / **150 m** |
| Gabriel tevez | 73 / 4.548 m / **997 m** | 64 / **1.699 m** / **129 m** |
| Orlando · Agustin · Nelson | 0 | 0 (sin cambio) |

**Ninguna recta punteada de más de 150 m sobrevive** y se dejan de dibujar **56 km de camino
inventado**. Los **km no cambian en ninguno** (salen de `puntos`, que nunca incluyó triangulados).
Solo **19 puntos de 336** quedan sin dibujar por caer aislados.

#### 🟠 Y un bug encontrado verificando

`reiniciarContadoresSiCambioElDia` tiene un comentario que promete que los contadores sobreviven a un
reinicio del servicio a media jornada. **El código nunca los vuelve a leer**: quedan en 0 en memoria,
la función sale temprano porque el día no cambió, y el primer volcado pisa lo acumulado con ceros. Se
ve en los datos (Javier con `fix_total = 1` subiendo 54 puntos en 30 min). Va con el próximo APK.
⚠️ **Varias cifras de telemetría citadas estos días están subestimadas** para los equipos que
reiniciaron. Lo que sale de `posiciones` (km, huecos, triangulados) **no está afectado**.

### Publicado — 1.13.6 (12/08/2026) — **OTA + PWA. Cuatro umbrales de GPS: es un EXPERIMENTO**

`app_config`: `latest_version` = `bundle_version` = **1.13.6**; `min_version` sigue en 1.13.0.

**El cliente pidió "bajar los segundos" con la batería descartada como criterio** (*"no nos interesa
vida útil de teléfono por ahora, Javier se tiene que solucionar ya"*), después de ver que el trazo se
renderiza como puntos sueltos y no como recorrido.

#### Lo que estaba pasando, medido

| | puntos | **triangulados** | tramos punteados sueltos |
|---|---|---|---|
| **Javier** | 408 | **170 (42 %)** | **46** |
| Luis Mendoza | 343 | 95 (27 %) | 37 |
| Gabriel tevez | 272 | 29 (11 %) | 17 |
| Orlando chavez | 740 | **0** | 0 |
| Agustin Vasquez | 882 | **0** | 0 |

El cliente preguntó si el mapa le estaba mostrando ubicaciones **trianguladas y no puras**. La
respuesta es sí: **el 42 % de lo que ve de Javier lo es**, y está partido en 46 pedacitos punteados
que alternan con la línea llena. Eso es exactamente "muchos puntos y no trazos" — no es un trazo
malo, son 46 tramos de otra cosa intercalados.

**Y el reparto dice dónde está el problema: 115 de esos 170 entraron con el GPS bueno callado MENOS
de 150 s.** No tapaban un apagón: tapaban un bache de dos minutos que el propio GPS iba a cerrar
solo, y el precio era un tramo punteado nuevo con su corte a cada lado.

#### Los cuatro números

| constante | antes | ahora | por qué |
|---|---|---|---|
| `NEAR_LIVE_MS` | 10 s | **4 s** | más fixes buenos → menos silencios que crucen el umbral |
| `NEAR_LIVE_RAPIDO_MS` | 5 s | **2 s** | en ruta, ~55 m entre puntos en vez de ~140 |
| `SILENCIO_MS` | 90 s | **150 s** | el respaldo deja de encenderse por hipos (los 115) |
| `MIN_MOVE_RUTA_M` | 100 m | **50 m** | esto es lo que literalmente no guardaba en ruta: a 100 m las curvas se dibujan como cuerdas |

Todos son prefs → viajan por OTA, **sin APK**. `NEAR_LIVE_QUIETO_MS` (30 s) **no se toca**: parado no
hay trazo que perder y bajarlo es batería a cambio de nada.

> 🩸 **ESTE MISMO CAMBIO YA FALLÓ UNA VEZ.** El 03/08, en 1.8.1, el único teléfono que corrió
> 5 s / 2 s pasó de **0,9 % a 24 %** de huecos de más de un minuto. Lo que hace que hoy sea un
> experimento DISTINTO y no el mismo error: en 1.8.1 no existía nada de lo que se culpó del fracaso.
> Desde 1.9.0 están el **WakeLock parcial**, el **piso anti-churn `REPEDIDO_MIN_MS` de 60 s** (que
> impide que el modo rápido entre y salga reiniciando la agenda de entrega, la causa señalada
> entonces) y la telemetría para medirlo. **Se revierte por OTA en minutos si sale mal.**

#### 🔴 Qué mirar mañana, y el número que obliga a revertir

1. **`gps_silencio_max_ms` y los huecos > 60 s de Orlando y Agustin** (los sanos, hoy con 0 % de
   triangulados). **Si se degradan, se revierte**: es exactamente el fracaso de 1.8.1 repitiéndose.
2. Los triangulados de Javier bajan de 42 % a menos del 15 %, y los tramos punteados sueltos de 46 a
   menos de 15.
3. `posiciones` por día: con `MIN_MOVE_RUTA_M` a la mitad, los viajes largos duplican filas. Si el
   mapa vuelve a arrastrarse, **el primer sospechoso es este número, no el detector de paradas**.

⚠️ **Lo que esto NO arregla, y hay que decirlo**: el GNSS de Javier **se apaga solo**
(`ProviderRequest[OFF]` **17 veces hoy**, una de **44 minutos** seguidos, contra **cero** en Orlando
y Agustin — mismo modelo SM-A075M, mismo build `A075MUBS6CZF6`, mismo parche, mismos ajustes, misma
versión de la app). Pedir más seguido no sirve cuando el proveedor está apagado. **Eso se dirime
cambiándole el teléfono con alguien sano por un día**: si el problema sigue en el aparato, es
hardware; si sigue con la persona, es dónde lo lleva.

### Publicado — 1.13.5 (12/08/2026) — **OTA + PWA, sin APK ni migración**

Dos cosas: **el cache del detector que en 1.13.4 quedó a medio camino**, y el **buscador de clientes**
en la pantalla del vendedor (pendiente desde el 08/08).

#### 🩸 El cache estaba en el consumidor, no en el módulo

1.13.4 puso el `WeakMap` en `features/supervision/dwells.js` y por eso el cliente reportó que el mapa
**seguía lento**. `MetricasEquipo.metricasParadas` llama a `detectarParadas` **por su cuenta**, así
que en una supervisión el detector corría dos veces por persona y solo una estaba cacheada. Medido
sobre la jornada del 11/08 con 1.13.4 puesto: 673 ms el del mapa (cacheado) **+ 552 ms el de las
métricas, en cada recálculo**. Son cuatro los llamadores (mapa, métricas, ficha de persona e informe
de jornada) y ninguno debería tener que acordarse.

Movido adentro de `detectarParadas`. Medido sobre los 63 persona-días reales: la segunda llamada
pasa de **552 ms a 1,2 ms**, con **0 diferencias** en 605 paradas.

⚠️ Se cachea **solo con las opciones por defecto** (si no, dos llamadas con umbrales distintos se
pisarían) y **el array devuelto no se muta** — verificado en los cuatro llamadores.

#### 🩸 Y la lista del vendedor dibujaba las 1.803 tarjetas siempre

Al verificar el buscador nuevo apareció el problema de fondo: **escribir UNA tecla no terminaba en
30 segundos**, tres intentos seguidos. Son ~12 nodos de DOM y **13 llamadas a `sx()` por tarjeta**, y
`sx()` parsea un string CSS en cada llamada → **~22.000 nodos y ~23.400 parseos por render**.

Con el tope de 50: **906 nodos** (medido en pantalla, con los 1.803 clientes reales cargados), pie
"Mostrando 50 de 1803" y botón "Ver 50 más".

#### Qué se verificó y qué no

✅ **En pantalla, con la sesión real y los 1.803 clientes**: 50 tarjetas numeradas 01-50, **906
nodos**, `basura: false` en el recorrido de nodos de texto (la lección del 11/08 — cada tarjeta tiene
exactamente número, nombre, localidad, `·`, código y estado), nombre en una línea con ellipsis, botón
de check-in de 44×44, y el pie con "Ver 50 más".

⚠️ **El filtrado NO se pudo accionar desde el navegador**, y la causa es del arnés, no de la app: el
panel del navegador está oculto (no compone frames, así que no hay clicks ni tecleo reales), y el
mock de `navigator.geolocation` que uso para pasar el `GpsGate` entrega una posición y después se
queda mudo → el gate declara el fix viejo, **remonta el árbol y `useJornada` pierde el estado**. Se
verificó en cambio la lógica exacta contra la cartera real: `acosta` → **7 de 1.803**, `zayago` → 2,
un código → 1, `kiosco` → 106 (dibuja 50 y ofrece el resto), `zzzzz` → 0 con el mensaje de vacío.

> 📌 **Para la próxima**: el arnés necesita un mock de geolocalización que lata solo (un
> `setInterval` que alimente a TODOS los suscriptores). Sin eso, cualquier verificación de estado en
> la vista del vendedor se cae sola a los 2 segundos y parece un bug de la app.

### Publicado — 1.13.4 (11/08/2026) — **OTA + PWA, sin APK ni migración**

`app_config`: `latest_version` = `bundle_version` = **1.13.4**; `min_version` sigue en 1.13.0.

**El mapa lento al final de la jornada: era el detector de paradas, y era cuadrático.**

El cliente lo viene reportando hace tres sesiones. La primera vez era la cantidad de capas de
Leaflet (352 `<path>` → ~24) y el arreglo sirvió. Volvió igual, así que esta vez se **perfilaron las
cuatro etapas** con el código real sobre la forma de la jornada del 11/08:

| etapa | los 8 de la flota |
|---|---|
| `limpiarTrazo` | 36 ms |
| `kmDePuntos` | 18 ms |
| `simplificarTrazo` | 54 ms |
| **`detectarParadas`** | **7.090 ms — el 99 %** |

`detectarParadas` copiaba la ventana entera y ordenaba tres veces **por cada punto**: 200 puntos
55 ms, 800 → 682 ms, **2.152 → 5.607 ms**. Y ese día Nelson rojas tenía 2.152 puntos con la racha
quieta más larga de 2.152 — su jornada entera era UNA ventana, y él solo costaba ~7 s.
**Por eso "volvía" después de cada arreglo: el costo crece con la densidad de captura, sin que nadie
toque el código.** Los comentarios de media docena de archivos decían "~410 ms por persona-día", y
era cierto cuando un día traía ~850 puntos.

El arreglo **no cambia una sola decisión del algoritmo**: quickselect en vez de `sort`, un buffer
reusado, y `push`/`pop` en vez de `[...win, p]`. Más un cache de paradas por persona (WeakMap sobre
el array de puntos) y una grilla para `comercioCercano`, que recorría los 1.803 clientes por cada
parada.

Medido sobre **63 persona-días REALES** (7 días, 49.954 puntos, 605 paradas):

| | antes | después | |
|---|---|---|---|
| `detectarParadas` | 14.193 ms | 1.809 ms | **×7,8** |
| `calcularDwells` (8 jornadas) | 14.224 ms | 2.136 ms | ×6,7 |
| `calcularDwells` 2ª vez (tocar el chip Vend./Rep.) | 14.224 ms | **14 ms** | ×998 |

**Salida bit-idéntica**: 0 días con distinto número de paradas, centro corrido 0,000000 m, duración
0 s de diferencia, 0 carteles distintos. Eso importa porque `detectarParadas` también numera las
paradas del **informe de jornada** (`features/reportes/informe.js`): si el detector cambiara, el
reporte y el mapa dejarían de coincidir.

> 🩸 **Lo que se probó primero y NO sirve — no repetirlo.** La idea inicial era acotar las medianas a
> una muestra de K puntos. Contra trazas **sintéticas** daba ×7,7 con salida idéntica y parecía
> resuelto. Contra los **63 persona-días reales** cambiaba el número de paradas en 8, con el centro
> corrido hasta **286 m** y duraciones distintas por hasta **29 minutos** (con K=128 seguía fallando
> en 5). El dato real tiene deriva y paradas que se solapan; el sintético no. Ver la regla 50-bis.

### Publicado — 1.13.3 (11/08/2026) — **OTA + PWA + 2 migraciones, sin APK**

`app_config`: `latest_version` = `bundle_version` = **1.13.3**; `min_version` sigue en 1.13.0.

**El trazo tenía agujeros porque el teléfono tiraba los fixes, no porque el mapa los dibujara mal.**
El cliente reportó por enésima vez "saltos, zonas con puntos, en ruta no marca el recorrido" y esta
vez la causa no estaba en el dibujo: `ACCURACY_MAX_M = 30` gobernaba **tres** cosas a la vez —qué
CAPTURA el servicio nativo, qué se dibuja lleno y qué suma km— y solo la segunda quería ese número.
Como el nativo tiraba el fix, el punto **no llegaba a existir**, así que la maquinaria que existe
desde 1.9.0 para dibujarlo punteado (regla 40) no tenía nada que dibujar.

Desde 1.13.3 son dos techos: `ACCURACY_CAPTURA_MAX_M` (120 m, viaja al nativo por prefs) y
`ACCURACY_MAX_M` (30 m, decide línea vs. punteado y los km). **Ni una línea de dibujo cambió.**

Y con el techo de captura arriba, dos RPC que calculan movimiento en SQL pasaron a ser un riesgo, así
que van en la misma tanda (`db/33`): `metricas_actividad` habría inflado los km del panel con jitter
y —peor— `vigilancia_equipo` habría **apagado los dos avisos al supervisor**, porque su umbral de "se
movió" son 40 m y un fix de ±120 m los supera solo. Efecto medido del filtro sobre los 7 días ya
guardados: **máximo −1,9 km (Javier), resto por debajo de −0,5**. Hoy es casi un no-op; desde mañana
es lo que sostiene el cambio.

`db/34` agrega `fix_desc_precision_racha` y `telemetria_ts`, que los estrena el próximo APK.

#### ⏳ Listo en el repo, SIN publicar — va con el próximo APK

Tres cambios escritos y compilando (`gradlew compileReleaseJavaWithJavac` en verde), a propósito
sin salir hoy porque **lo nativo no viaja por OTA**:

1. 🔴 **`procesarFix`: `ultimoFixAt` y `apagarCarrilRed()` pasan a correr DESPUÉS del filtro de
   precisión.** Es la causa raíz. Hasta hoy un fix de 400 m —uno que estaba por descartarse—
   reseteaba el reloj del silencio y apagaba el carril de triangulación, así que el respaldo que
   existe desde 1.9.0 **no se encendía nunca** (Alejandro: `gps_fixes_red` = 0). Ver la regla 18-bis.
2. **Un fix por encima del techo de confianza se trata como los del carril de red**: se guarda, pero
   no vota la cadencia ni mueve la referencia del filtro de salto. **Eso cierra el riesgo declarado
   de la Parte 1** (con el APK 1.13.0 en la calle, un fix de 100 m sí puede votar la cadencia).
   Viaja por la pref nueva `accuracyConfM`, que el bundle 1.13.3 **ya manda** — los APK viejos la
   ignoran y se quedan con su default de 30.
3. **La telemetría se manda con cada lote a `ingest-posiciones`** en vez de depender del latido del
   JS, más el contador `fix_desc_precision_racha`.

⚠️ **La Edge Function `ingest-posiciones` NO se desplegó** aunque el código está en el repo: es
inerte hasta que exista un APK que mande `tel`, y es el endpoint por el que entra TODO el GPS del
parque. Se despliega junto con el APK, no antes. **Y va con `verify_jwt: false`** — se autentica con
token de dispositivo, no con JWT; desplegarla con el default `true` corta la ingesta de los 9
teléfonos.

#### Línea de base del 11/08 — contra esto se mide mañana

Jornada completa. `km línea` es lo que se dibuja lleno; el resto son km que el mapa solo puede
insinuar. Los contadores del teléfono son **acumulados del día**, así que va la hora del latido: sin
eso se comparan cortes distintos (Orlando a las 07:37 daba 30 % de descarte y al cierre 0 %).

| Persona | km | km línea | **no dibujado** | descarte x precisión | carril red | silencio máx | latido |
|---|---|---|---|---|---|---|---|
| **Alejandro mercado** | 58,0 | 9,4 | **84 %** | **960/1.452 = 66 %** | **0** | 0,3 min | 11:17 |
| **Javier** | 135,9 | 22,1 | **84 %** | 457/1.507 = 30 % | 30 | **44,6 min** | 16:18 |
| Gabriel tevez | 18,8 | 11,6 | 39 % | 154/1.528 = 10 % | 50 | 484 min | 15:30 |
| Zura (sigue en 1.11.0) | 3,1 | 2,1 | 33 % | — | — | — | — |
| Luis Mendoza | 27,1 | 19,6 | 27 % | 256/923 = 28 % | 22 | 42,2 min | 14:42 |
| Agustin Vasquez ← control | 100,2 | 89,5 | 11 % | 0/62 = 0 % | 0 | 0,2 min | 09:05 |
| Nelson rojas | 13,5 | 13,5 | 0 % | — | 9 | 62,2 min | 00:51 |
| Orlando chavez ← control | 86,4 | 86,3 | **0 %** | **10/3.131 = 0 %** | 0 | 0,5 min | 14:52 |

**Los dos que descartan ~0 % son exactamente los dos que dibujan al 100 %.** Ésa es la correlación
que sostiene el cambio, y los dos controles son los que la cierran.

#### El criterio de aceptación es de MAÑANA (12/08), con la jornada completa

1. `fix_desc_precision` de Alejandro **baja de 66 % a < 10 %** — los fixes dejan de tirarse.
2. Los km **no dibujados** de Alejandro y Javier bajan de 84 % a **menos de 40 %**, contando el
   punteado como dibujado.
3. 🔴 **Los km de Orlando y Agustin NO cambian.** Salen de `puntos`, que sigue filtrando en 30 m. Si
   sus km se mueven, la separación de techos está mal hecha y hay que revertir el 120.
4. Aparecen filas con `accuracy` entre 30 y 120 en `posiciones` (hoy hay 43 en todo el parque, todas
   del carril de red).
5. **La prueba honesta es visual**: abrir el recorrido de Javier y ver si el tramo de ruta quedó como
   una línea punteada continua o sigue siendo una recta entre dos pueblos.

⚠️ **Lo que este cambio NO arregla**: el silencio real de Javier (§ diagnósticos abiertos). Si su
`no dibujado` no baja tanto como el de Alejandro, es esperable — son dos causas distintas.

### Publicado — 1.13.2 (11/08/2026, 13:13) — **OTA + PWA, sin APK**

`app_config`: `latest_version` = `bundle_version` = **1.13.2**; `min_version` sigue en 1.13.0.
PWA: commit `9cc23da`, workflow **success**. Bundle: release `ota-1.13.2`.

Arregla lo que 1.13.1 rompió en la tarjeta del vendedor, y hace bien el cambio que se había pedido:
el botón de Check-in pasa a **solo ícono, 44×44** en vez de ~90 de ancho. Medido a 375 px sobre los
1.803 clientes reales: **antes entraban 0 nombres enteros (88 px de espacio), ahora 1.560 (87 %)** —
por eso el vendedor los veía todos cortados. Los 243 que siguen cortados pasan de ~29 caracteres.

> 🩸 **1.13.1 imprimió texto basura en CADA tarjeta durante toda una mañana, y el build daba verde.**
> Un `{/* … */}` escrito como ejemplo **adentro** de un comentario JSX lo cierra antes de tiempo y el
> resto se renderiza. **Para JSX el build no alcanza: hay que mirar el DOM.** El chequeo que lo caza
> es recorrer los nodos de texto del componente y comprobar que no haya ninguno de más. Y para
> sintaxis, `curl localhost:5173/la-union-app/src/…/Archivo.jsx` tarda 2 s contra los 7 min del build.
>
> 🟢 **De paso quedó medido lo que se quería testear**: a las 13:00 del 11/08, **7 de 8 equipos ya
> habían aplicado el bundle 1.13.1 solos**, sin que nadie tocara nada. El auto-update funciona. El
> único rezagado fue Nelson rojas, que no abrió la app desde las 00:51.

> 🔧 **`RoleRouter` ahora pasa por `rolEfectivo`.** El override `localStorage['lu-dev-rol']` servía
> para las decisiones de `AuthedApp` pero `RoleRouter` releía el rol REAL, así que forzar `vendedor`
> desde una sesión de gestión caía en `AdminView`. Costó no poder mirar la pantalla del vendedor para
> verificar un arreglo ya publicado. En producción es un no-op.

### Publicado — 1.13.1 (10/08/2026, 23:36) — **OTA + PWA, sin APK**

`app_config`: `latest_version` = `bundle_version` = **1.13.1**; `min_version` sigue en **1.13.0**
(1.13.1 es JS puro). PWA: commit `228a731`, workflow **success**. Bundle: release `ota-1.13.1`.

Contenido: piso de ruido **adaptativo con ancla** + **filtro de pinchos** + piso de distancia en el
corte de 45 s (`lib/geo.js`); mapa con **una capa por persona y por tipo** + **renderer canvas**
(`trazos.js`, `LeafletMap.jsx`); nombre del cliente completo en la lista del vendedor; falsa alarma
"recorridos INCOMPLETO".

> 🩸 **El primer intento de publicar se cayó, y la causa vale más que el incidente.** Un
> `{/* comentario */}` metido entre el `? (` de un ternario y su elemento **no es un comentario, es
> un error de sintaxis**: volteó el build entero (`Expected ")" but found "onClick"`). El
> `ota-release.sh` tiene `set -e` y cortó antes de publicar, así que ningún teléfono recibió nada; y
> el workflow de Pages falló, que **no despliega**, así que la PWA en vivo siguió sirviendo 1.13.0.
> La lección: se había corrido un `vite build` en verde ANTES de ese cambio y se lo dio por válido
> después. El chequeo barato es pedirle el módulo al dev server (`curl
> localhost:5173/la-union-app/src/…/Archivo.jsx`) — tarda dos segundos y devuelve el error exacto.

⚠️ **Los teléfonos aplican el bundle en el PRÓXIMO arranque de la app, no al bajarlo** (regla 48: no
se fuerza `reload()`). La noche del 10/08 se despertaron 4 equipos por Tailscale y a las 23:39
seguían reportando `app_version` 1.13.0 con el bundle ya descargándose: **eso es lo esperado**, no un
fallo. Se confirma mirando `estado_dispositivo.app_version` a la mañana siguiente.

### Publicado — 1.13.0 (10/08/2026)

| | |
|---|---|
| Versión publicada | **1.13.0** en los TRES canales. `app_config`: `latest_version` = `min_version` = `bundle_version` = `1.13.0`, con `apk_url` y `bundle_url` al release `ota-1.13.0`. PWA: commit `3cae911` en `main`, workflow **success** |
| Versión en el código | **1.13.0** — `web/src/version.js`, `versionName` 1.13.0 / `versionCode 32`. Alineados |
| ⏳ **Único paso sin hacer** | **El push de aviso a los teléfonos.** Es el `net.http_post` a `push-actualizacion` de `CLAUDE.md §3` (con `timeout_milliseconds := 60000`). No se mandó porque el header lleva la `service_role` key y no se transcriben credenciales |
| Rastreo | 08:00–23:55, Lunes a Sábado, alertas de equipo activas |
| Parque | 9 teléfonos. **7 con el APK 1.13.0**; faltan Eduardo ruiz (nunca conectó — parece que no le entregaron el equipo) y Gabriel tevez (sin adb remoto, tiene que venir por cable) |

#### ⏳ La verificación que falta, y es la que dice si esto sirvió

1.13.0 corrige el **ancla del filtro de movimiento** (nativo, `UploaderGpsService.java`). **No se pudo
probar acá**: el emulador no tiene GPS real ni Doze. La medición honesta es post-jornada, contra la
base viva.

> 🩸 **EL CRITERIO DE ACEPTACIÓN ESTABA MAL Y HABRÍA MANDADO A REABRIR EL JAVA AL PEDO**
> (corregido el 10/08 a las 18:00, midiendo la base viva). Este documento pedía que *"los km de ruido
> parado (hops < 9 m) cayeran cerca de cero"*. **No pueden caer.** El arreglo clava el ancla pero
> **el punto de cortesía se sigue encolando igual** — lo dice el comentario del propio
> `procesarFix()`. Esos hops < 9 m son el jitter entre puntos de keepalive obligatorios: existen
> pase lo que pase, y lo que los saca del NÚMERO es el piso de `kmDePuntos` (`lib/geo.js`) + `db/32`,
> que ya están publicados. Medido el 10/08: el ritmo de puntos guardados estando quieto es de
> **110-130 por hora en todos los equipos, 1.13.0 y 1.11.0 por igual** = el keepalive de 30 s y nada
> más. Los metros de jitter por persona (1,0-1,7 km) **no separan una versión de la otra**.

**El número que el ancla sí tiene que mover** es el **trinquete estando quieto**: hops **≥ 9 m** cuyo
desplazamiento neto en ±6 puntos es **< 40 m**. Ésos son los que hoy inflan los km, y son los que
desaparecen si el ancla quedó sujeta. Línea de base medida el **10/08 (jornada PRE-fix, ver abajo)**:

| | km del día | m de trinquete parado | **% de km falso** |
|---|---|---|---|
| Zura | 1,32 | 500 | **37,8 %** |
| Nelson rojas | 6,07 | 1.392 | **22,9 %** |
| Orlando chavez | 6,45 | 1.339 | **20,8 %** |
| Luis Mendoza | 14,45 | 2.022 | 14,0 % |
| Gabriel tevez (**control**, sigue en 1.11.0) | 17,10 | 480 | 2,8 % |
| Agustin Vasquez | 51,86 | 1.300 | 2,5 % |
| Javier | 61,48 | 569 | 0,9 % |

**Criterio:** el % de km falso baja en los cinco que tienen `apk_version = 1.13.0` y **se queda igual
en Gabriel tevez**, que es el control natural porque no recibió el APK. Si baja en todos por igual,
no fue el ancla. Si no baja en ninguno, ahí sí se vuelve al Java.

#### 🟡 Medido el 11/08 — **INCONCLUSO, y el control se perdió**

| | 10/08 (pre) | 11/08 (post) | km del día 10 → 11 |
|---|---|---|---|
| Alejandro mercado | 30,7 % | **1,4 %** | 27,7 → 57,8 |
| Orlando chavez | 27,7 % | **0,5 %** | 7,1 → 85,7 |
| Luis Mendoza | 23,2 % | 8,6 % | 27,5 → 25,0 |
| Zura | 60,9 % | 19,3 % | 1,5 → 2,7 |
| Gabriel tevez (era el control) | 3,7 % | 2,0 % | 17,2 → 17,3 |
| Javier | 1,7 % | 1,3 % | 71,6 → 134,6 |
| Agustin Vasquez | 4,2 % | 4,0 % | 52,8 → 97,5 |
| **Nelson rojas** | 22,7 % | **99,8 %** | 8,8 → 10,4 |

**No se puede concluir nada de esto, por dos motivos, y conviene decirlo antes de festejar los −27
puntos de Orlando:**

1. 🩸 **El porcentaje depende de cuánto caminó la persona ese día, así que se mueve solo.** Orlando
   hizo 7 km el lunes y 86 el martes: su ratio se derrumbaba con arreglo o sin él. Alejandro,
   igual (28 → 58 km). Los metros ABSOLUTOS de trinquete cuentan otra historia y tampoco son
   limpios: bajan en Orlando (1.953 → 448), Alejandro (8.518 → 814), Luis (6.376 → 2.134) y Zura,
   pero **suben** en Javier (1.196 → 1.743) y Agustin (2.193 → 3.913).
2. 🔴 **Gabriel tevez ya no es control**: recibió el APK 1.13.0 y al 11/08 reporta
   `apk_version = 1.13.0`. Los 9 equipos están en la misma versión nativa, o sea que **no queda
   ningún grupo de comparación** y el A/B ya no se puede correr contra el parque.

**Qué hacer en vez de insistir con esta métrica:** medir metros de trinquete **por hora quieto**
(normalizado por tiempo, no por km recorridos), que es lo único que no se mueve con la jornada. Si
después de eso sigue sin separarse, dar el ancla por no medible en producción y cerrarlo — el
arreglo es correcto por lectura del código y el costo de seguir persiguiéndolo ya supera al del bug.

> 🔴 **Y salió un hallazgo nuevo que NO es esto: Nelson rojas al 99,8 %.** El 11/08 figura con
> 10,4 km de los cuales 10,3 son trinquete: en todo el día **no tuvo un solo desplazamiento neto de
> más de 40 m**. Su teléfono captura 1.116 puntos con una cadencia de metrónomo de 31,5 s, precisión
> de 17-28 m y saltos de 35 m como máximo. `dumpsys location` en su equipo (`100.89.1.75`) muestra
> el proveedor GNSS en `OFF`: **se está ubicando por red, no por satélite.** O el equipo pasó el día
> quieto en un lugar sin cielo, o hay que mirarle el GPS. Es lo primero a revisar mañana.

> 🔴 **La jornada del 10/08 NO sirve para medir: es PRE-fix.** El `app-release.apk` con el ancla
> arreglada se compiló ese mismo día a las **13:08** y llegó a los teléfonos a la tarde
> (`app_config` pasó a 1.13.0 a las 17:32). Es además la misma jornada de la que salió esta línea de
> base. **La primera jornada medible es la del martes 11/08.**

> 🩸 **Para cualquier cosa NATIVA la columna que vale es `estado_dispositivo.apk_version`, no
> `app_version`.** `app_version` es el bundle OTA: un teléfono con el APK 1.13.0 puesto sigue
> diciendo `app_version = 1.12.1` hasta que baje la OTA, y al revés. Medido el 10/08 a las 18:00:
> **con APK 1.13.0** → Orlando chavez, Javier, Nelson rojas, Agustin Vasquez, Luis Mendoza (+ Zura y
> Alejandro mercado, que lo tienen puesto pero no abren la app, así que reportan 1.11.0 viejo);
> **sin el APK** → **Gabriel tevez**, que reportó hoy a las 17:07 en 1.11.0 y es justamente el peor
> trazo del parque.

### La base viva (verificado el 10/08 por MCP)

**2 empresas** · 24 perfiles · 1.998 clientes · 693 productos · **42.804 posiciones** · 5 visitas ·
**0 pedidos**.

⚠️ **Roles: son CINCO.** `superadmin` · `admin` · `encargado` · `vendedor` · `repartidor`.
`propietario` **se eliminó el 10/08** (`db/31`) sin haber tenido nunca un perfil — el dueño usa
`admin`, y su pantalla vive en `features/direccion/PanelDireccion.jsx` (la ven admin/superadmin en
web + celular; resuelve el caso del dueño entrando por PWA desde su iPhone).

### Los tres canales de despliegue, que son independientes

| Canal | Se actualiza con | Alcanza para |
|---|---|---|
| **PWA** (GitHub Pages) | `git push origin main` → workflow | Web de escritorio |
| **OTA** (Capgo self-hosted) | `bash scripts/ota-release.sh <v>` + UPDATE en `app_config` | Cualquier cambio de JS/CSS/React en el APK |
| **APK** (GitHub Releases) | `bash scripts/apk-release.sh <v>` + `apk_url`/`min_version` | **Obligatorio** si tocaste `.java`, el manifest o `web/capacitor.config.ts` |

> ⚠️ Publicar una OTA **no** actualiza la PWA, y pushear a `main` **no** actualiza el APK. Al publicar
> un APK nuevo, publicar **también** la misma versión como OTA.

---

## 2. 🔴 ANTES de mudar la carpeta

### 2.1 El keystore — hacer esto primero, hoy

Android exige que **toda actualización esté firmada con la MISMA llave** que la app instalada. No están
en Play Store, así que no hay respaldo de Google que valga. Si se pierde el archivo **o** se olvidan las
contraseñas: la OTA sigue viva, pero **ningún APK nuevo se puede instalar como actualización** —
habría que desinstalar+reinstalar en cada teléfono, perdiendo la cola de posiciones, la cuarentena y la
sesión de cada uno.

**Corrección importante, verificada el 04/08:** hasta ahora se dio por sentado que
`../.claude/keystore.md` era el respaldo de las credenciales de firma. **No lo es.** Ese archivo es el
volcado de la sesión de `keytool`: la ayuda de opciones y las respuestas del *distinguished name*
(nombre, unidad, organización, ciudad, provincia, país). **Las contraseñas no están ahí**, porque se
tipearon en un prompt que no las imprime.

Estado real: **`android/keystore.properties` es la única copia de `storePassword`, `keyPassword` y
`keyAlias`**, y está fuera de git, en un solo disco.

Antes de copiar nada:

1. Abrir `android/keystore.properties` y pasar las tres credenciales a un **gestor de contraseñas**.
2. Copiar `web/android/app/launion.keystore` a **dos** lugares privados distintos (no un repo público).
3. En la máquina nueva, **probar que firma** (`assembleRelease`) antes de dar la mudanza por terminada.

### 2.2 Los archivos que se pierden si solo clonás el repo

La carpeta raíz `propuesta LA UNION/` **no es un repositorio git** — el repo existe solo dentro de
`la-union-app/`. Todo lo de afuera viaja únicamente por copia física.

| Archivo | Consecuencia si se pierde | ¿Se puede recuperar? |
|---|---|---|
| `web/android/app/launion.keystore` | **Catastrófico** (§2.1) | ❌ Nunca |
| `android/keystore.properties` | Igual de grave: sin las contraseñas el `.keystore` es inútil | ❌ Solo desde un gestor |
| `la-union-app/.env.local` | No arranca `npm run dev` contra el backend real | ✅ Desde `.env.production` + panel de Supabase |
| Toda la raíz `propuesta LA UNION/` | 6 briefs de diseño, 2 mockups, 3 handoffs del diseñador, 2 carpetas de diagramas, `plan.md` | ❌ Solo copia física |
| `la-union-app/trabajo diseñador ui ux/` | Handoff v2 del diseñador (gitignoreado) | ❌ Solo copia física |
| `icon-fuente.png.png` | De él salen los mipmaps del ícono | ⚠️ Hay copia en `trabajo diseñador 27-7/` |
| `android/local.properties` | Gradle no encuentra el SDK | ✅ Se regenera al abrir en Android Studio |

**Sí viajan en el repo** (verificado con `git ls-files`): `.env.production`,
`web/android/app/google-services.json`, `package-lock.json`, `web/patches/*.patch`, **`.claude/skills/**`**,
todo `db/`, todo `supabase/functions/`, todo `web/src/` y los `.md` de documentación.

Comando para chequear antes de copiar:

```bash
ls -la la-union-app/.env.local la-union-app/android/keystore.properties la-union-app/android/app/launion.keystore
```

### 2.3 Lo que NO hace falta copiar (~645 MB)

`node_modules/` (530 MB) · `android/build/` + `web/android/app/build/` (105 MB) ·
`android/capacitor-cordova-android-plugins/` · `web/android/app/src/main/assets/public/` · `dist/` ·
`bundle.zip` · `graphify-out/` · `.idea/` · `android/local.properties`. Todo se regenera.

---

## 3. Entorno de trabajo — qué instalar en la PC nueva

### 3.1 Toolchain (versiones medidas en la máquina actual)

| Herramienta | Versión acá | Para qué | ¿Obligatorio? |
|---|---|---|---|
| **Node.js** | v24.15.0 (el CI usa Node 20) | `npm install`, Vite, Capacitor CLI, los scripts `.mjs` de la skill `impeccable` | ✅ |
| **npm** | 11.12.1 | `postinstall` aplica `patch-package` solo | ✅ |
| **Git + Git Bash** | 2.54 | Clonar, y **obligatorio** para `scripts/*.sh` (son bash, no PowerShell) | ✅ |
| **Android Studio** | — | Trae el **JBR** en `C:\Program Files\Android\Android Studio\jbr` | ✅ para el APK |
| **Android SDK** | platform 34, build-tools, cmdline-tools, platform-tools | Gradle, `cap sync`, `adb` | ✅ para el APK |
| **`gh` (GitHub CLI)** | 2.94, logueado como `santiagoadet7823-dev`, scopes `repo, workflow, read:org, gist` | Los dos scripts de release publican con `gh` | ✅ para publicar |
| **Python** | 3.13.14 | Lo usa **una sola cosa**: `ui-ux-pro-max/scripts/search.py`. Sin dependencias externas | ⚪ solo diseño |
| **JDK suelto** | Temurin 25 en el PATH | ⚠️ **Gradle NO va con este**: hay que pasarle el JBR o salta `Unsupported class file major version 69` | — |

### 3.2 Emulador de Android

Instalado el 04/08: `cmdline-tools` + `system-images;android-34;google_apis;x86_64` + AVD **`launion`**.

> ⚠️ **`google_apis` y NO `default`**: sin Play Services no hay FCM, y FCM es lo único que de verdad
> sirve probar acá.

```bash
"$LOCALAPPDATA/Android/Sdk/emulator/emulator.exe" -avd launion -no-snapshot -no-boot-anim
# Con ventana, en una máquina sin GPU utilizable:
#   ... -gpu swiftshader_indirect -feature -Vulkan
# Headless (para adb/dumpsys):
#   ... -no-window -no-audio -gpu swiftshader_indirect
adb devices    # "offline" = todavía booteando; "device" = listo
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell dumpsys notification --noredact | grep -i channel   # en qué canal cayó un push
```

**Dos advertencias honestas:**

1. **En esta máquina nunca llegó a bootear**: Mesa/Vulkan lo cuelga y le quedan 2 cores, así que por
   software se queda en "offline". Si la PC nueva tiene GPU decente, probablemente ande. No gastar
   media hora más sin hardware nuevo.
2. **Techo de lo que sirve probar ahí**: interfaz, botones, overlays, el trazo en el mapa y los canales
   de notificación. **No tiene GPS real, ni Doze, ni los killers de los fabricantes** → **no sirve para
   probar nada de `UploaderGpsService`**. Eso se verifica en la calle, con consultas de huecos contra la
   base, y no hay atajo.

> 🟢 **Esto último cambia con el parque nuevo.** Un Samsung A07 real conectado por USB con depuración
> **sí** permite probar Doze, buckets de App Standby, alarmas y batería — es exactamente lo que
> faltaba. El checklist de esa sesión está en **§7.7**, y conviene leerlo antes de que lleguen los
> teléfonos, porque comparte ventana con la decisión de Device Owner (§7.2).

Si queda un proceso colgado (`Running multiple emulators with the same AVD`):

```bash
powershell -Command "Get-Process qemu-system-x86_64* | Stop-Process -Force"
```

### 3.3 Skills de diseño (8)

Están **duplicadas a propósito**:

- `la-union-app/.claude/skills/` — **versionadas en git** (`.gitignore` ignora `.claude/*` pero
  **exceptúa** `skills/`). **Viajan solas con el repo: no hay que reinstalarlas.**
- `~/.claude/skills/` — para el resto de los proyectos de la máquina. Estas **sí** hay que reinstalarlas
  si las querés fuera de este repo.

| Skill | Origen | Necesita | Cuándo se usa |
|---|---|---|---|
| `impeccable` | github.com/pbakaus/impeccable | **Node** (scripts `.mjs`) | Antes de tocar cualquier UI existente: `/impeccable audit <pantalla>` |
| `ui-ux-pro-max` | github.com/nextlevelbuilder/ui-ux-pro-max-skill | **Python 3.13** | Al diseñar una pantalla o componente **nuevo** |
| `review-animations` | github.com/emilkowalski/skills | — | Antes de tocar cualquier animación. ⚠️ `disable-model-invocation: true`: hay que invocarla a mano |
| `improve-animations` | ídem | — | Para planificar una tanda grande de motion |
| `find-animation-opportunities` | ídem | — | Dónde *falta* animación |
| `emil-design-eng` | ídem | — | Filosofía general de pulido |
| `apple-design` | ídem | — | Gestos, springs, sheets, materiales — el chrome de `SupervisionMovil` |
| `animation-vocabulary` | ídem | — | Glosario inverso ("¿cómo se llama el efecto de…?") |

> ⚠️ **Traducir siempre, nunca copiar el stack.** La app **no usa Tailwind** (está instalado y sin
> consumidores) ni librerías de animación. Las skills van a proponer `framer-motion`, `tailwind` y
> `shadcn/ui` por defecto. Tomar de ellas el **criterio** (curvas, duraciones, jerarquía, espaciado) y
> traducirlo a lo que el repo usa: CSS vars de `web/src/index.css`, keyframes `lu-*`, `sx()` y estilos
> inline.
>
> Y `/impeccable init` escribe `PRODUCT.md` y `DESIGN.md` en la raíz — **no correrlo sin avisar**.

### 3.4 Conectores / MCPs

**Viajan con la cuenta de Claude, no con la carpeta.** En la máquina nueva hay que **volver a
autorizarlos** (es OAuth por conector).

| MCP | Uso en este proyecto |
|---|---|
| **Supabase** | 🟢 **El único que se usa de verdad, y es obligatorio.** La regla 5 dice que los `db/*.sql` **no** son la fuente de verdad: para saber cómo está la base hay que consultarla viva. Herramientas: `list_tables`, `execute_sql`, `get_advisors`, `apply_migration`, `get_logs` |
| Firebase | Plugin `firebase@claude-plugins-official` (marketplace oficial). Conectado, sin uso todavía — podría servir para FCM |
| Notion · Gmail · Calendar · Canva · Context7 | Conectados, sin uso en el proyecto |

Ajustes de `~/.claude/settings.json` en esta máquina: `enableWorkflows: true`, tema oscuro,
`autoUpdatesChannel: latest`.

### 3.5 Cuentas y dónde vive cada cosa

Ninguna credencial se transcribe acá (regla 25 del repo: referenciar por ubicación).

| Servicio | Identificador | Qué guarda | Dónde está la credencial |
|---|---|---|---|
| **GitHub** | `santiagoadet7823-dev/la-union-app` | Código, PWA en Pages, y los **Releases que hacen de CDN** para el bundle OTA y el `.apk` | `gh auth` (keyring de la máquina) |
| **Supabase** | proyecto `lqhtxivednffpiicnbog`, cuenta `cardixteam@gmail.com` | Postgres, Auth, Storage, Realtime, 6 Edge Functions, 4 crons | `.env.production` (anon, pública) · service role y `FCM_SERVICE_ACCOUNT` como secrets de Edge Functions |
| **Firebase / FCM** | proyecto `gestor-local-celulares` | Push a los teléfonos | `web/android/app/google-services.json` (commiteado, es config de cliente) + la cuenta de servicio en Supabase |
| **Google Cloud** | Client ID Web de OAuth | Login con Google (nativo y web) | `web/capacitor.config.ts` y `AuthContext.jsx` — público por diseño |
| **Stadia Maps** | — | Capas de mapa Oscuro y Satélite | ⚠️ **Hardcodeada** en `web/src/services/maps/basemap.js`. Si vence, la app **no se rompe**: se queda con OSM |
| **OSRM público** | `router.project-osrm.org` + FOSSGIS | Ruteo y snap a calles | **Sin cuenta, sin key, sin SLA** |

### 3.6 Primer arranque, en orden

```bash
# 1. Restaurar a mano: la-union-app/.env.local, android/keystore.properties, android/app/launion.keystore
cd la-union-app
npm install                    # el postinstall aplica patch-package solo
npm run dev                    # verificar la web en :5173
```

Después, para el APK: abrir `web/android/` una vez en Android Studio (genera `local.properties`), y:

```bash
CAP_BUILD=1 npm run build && npx cap sync android
cd android && ./gradlew assembleRelease -Dorg.gradle.java.home="C:\Program Files\Android\Android Studio\jbr"
```

**Las tres trampas que cuestan una tarde:**

1. **`CAP_BUILD=1` es obligatorio** para cualquier build destinado al APK o a una OTA. Sin eso, Vite
   compila con base `/la-union-app/` y el APK arranca en **pantalla blanca**.
2. En `keystore.properties`, **`storeFile` debe ser `launion.keystore`** (relativo al módulo `app`), no
   `app/launion.keystore`. `GUIA_APK_ANDROID.md:230` dice lo contrario y **está mal**; la línea que
   funciona es la `:320`.
3. **`npm run lint` es `eslint . || true` — nunca falla**, y además no hay archivo de config de ESLint
   en el repo. **No sirve como verificación.** Y **no hay tests**.

### 3.7 ⏳ Pendientes de instalar — evaluados el 25/08/2026, no instalados todavía

Dos herramientas externas investigadas a pedido del dueño para ayudar a captar clientes y ordenar el
despliegue. Quedan documentadas acá para que la sesión de la PC nueva sepa qué instalar; ninguna de
las dos se instaló/desplegó en esta máquina.

**agency-agents (subagentes Sales/Marketing/DevOps para Claude Code)**
- **Repo:** https://github.com/msitarzewski/agency-agents (MIT, 230+ agentes)
- **Para qué:** subagentes de IA — archivos `.md` con frontmatter YAML (`name`/`description`) que
  Claude Code lee directo desde `.claude/agents/`, sin conversión — especializados en
  prospección/ventas B2B, growth/contenido/SEO y DevOps/mobile-release. No es una plataforma de
  despliegue ni de leads: da un "personaje experto" más estructurado que un prompt genérico.
- **Cómo se instala:** copiar directo (sin build) los archivos curados de abajo a `.claude/agents/`
  — quedan disponibles como `subagent_type` del Agent tool tras reiniciar la sesión. **No correr
  `scripts/install.sh`** del repo: instala para múltiples herramientas (Cursor, Copilot, etc.) y el
  catálogo completo de 230+, mucho más de lo que hace falta acá.
- **Selección curada (16 de 230+, priorizando B2B/logística sobre redes de consumo masivo):**
  - Sales (`sales/`): `sales-outbound-strategist.md`, `sales-offer-lead-gen-strategist.md`,
    `sales-discovery-coach.md`, `sales-proposal-strategist.md`, `sales-pipeline-analyst.md`
  - Marketing (`marketing/`): `marketing-growth-hacker.md`, `marketing-content-creator.md`,
    `marketing-seo-specialist.md`, `marketing-linkedin-content-creator.md`,
    `marketing-email-strategist.md`, `marketing-app-store-optimizer.md`
  - Engineering/DevOps (`engineering/`): `engineering-devops-automator.md`,
    `engineering-mobile-release-engineer.md`, `engineering-sre.md`,
    `engineering-backend-architect.md`, `engineering-database-optimizer.md`

**wacrm — CRM open-source con WhatsApp oficial (evaluado, no desplegado)**
- **Repo:** https://github.com/ArnasDon/wacrm (MIT, 2.000+ estrellas, activo)
- **Para qué:** CRM self-hosted (bandeja compartida multi-agente, pipeline de ventas Kanban,
  broadcasts con plantillas aprobadas, automatizaciones) conectado a WhatsApp por la **Meta Cloud
  API** — la API OFICIAL de WhatsApp Business, legal y sin riesgo de baneo del número. Para captar y
  gestionar clientes de DisT-At.
- **Cómo se instala:** fork del repo. Stack Next.js 16 + React + TypeScript + **Supabase** — mismo
  backend que ya usa La Unión (§3.5). Antes de desplegarlo de verdad hace falta: verificación de
  negocio en Meta Business Manager, un número de WhatsApp dedicado, elegir hosting
  (Hostinger/Vercel/VPS), y decidir si usa un proyecto Supabase nuevo o reutiliza
  `lqhtxivednffpiicnbog`.
- **Es un proyecto aparte**, no vive en este repo — no toca el código de DisT-At.
- **Alternativas evaluadas y descartadas:** Frappe CRM (stack Python/Frappe pesado, no encaja con lo
  ya instalado), OpenWA / Evolution API / MultiWA (usan WhatsApp Web no oficial vía Baileys — riesgo
  de baneo, incumplen el requisito de "legal").

---

## 4. Pendientes

### 📌 Qué pasó en la sesión del 10/08/2026 (leer antes que nada)

Cuatro cosas cerradas, y **tres hipótesis que se probaron y se revirtieron** — esas son las que más
ahorran tiempo, porque son caminos que ya se recorrieron:

| Qué | Dónde | Estado |
|---|---|---|
| Rol `propietario` eliminado, fusionado en `admin` | `db/31`, `crear-usuario` v4, `features/direccion/PanelDireccion.jsx`, `App.jsx` (`decidirPanelDireccion`) | ✅ aplicado |
| `DespachoGestion` — el despacho de pantallas de gestión estaba copiado en las dos supervisiones | `features/supervision/components/DespachoGestion.jsx` | ✅ |
| Corte del dibujo a 45 s (`HUECO_DUDOSO_MS`) | `lib/geo.js` | ✅ verificado con el código real |
| Piso de ruido en los km (`kmDePuntos`, único lugar del front) | `lib/geo.js` + `db/32` | ✅ aplicado |
| Ancla que no persigue al ruido | `UploaderGpsService.java` | ✅ en 7 de 9 teléfonos — **sin medir** |
| PWA en iPhone (metas `apple-mobile-web-app-*`) | `web/index.html` | ✅ |
| 🔴 **Piso de distancia en el corte por hueco dudoso** — el corte de 45 s disparaba sobre saltos que no recorrieron nada y dejaba el trazo hecho confeti | `lib/geo.js` (`limpiarTrazo`) | ⏳ **hecho y verificado, SIN PUBLICAR** (sale por OTA, es JS puro) |
| 🔴 **Piso de ruido ADAPTATIVO por incertidumbre, con ancla** — el piso era 9 m fijo para todos; ahora es `max(9, 0,75·√(σ₁²+σ₂²))` medido contra un ancla que acumula | `lib/geo.js` (`pisoDeRuido`, `kmDePuntos`) | ⏳ **hecho y verificado, SIN PUBLICAR** |
| 🔴 **Filtro de PINCHOS** — el fix que se va 40-90 m y vuelve; el filtro de salto no los ve porque mide velocidad | `lib/geo.js` (`marcarPinchos`) | ⏳ **hecho y verificado, SIN PUBLICAR** |

**🩸 Lo que se probó y NO funcionó — no repetirlo sin datos nuevos:**

1. **Bajar `CIEGO_MAX_FRAC` de 0,35 a 0,30**: probado contra 7 días guardados, **cero tramos
   cambiados**. La fracción ciega es bimodal (o ~0, o 57-100 %); no hay nada en esa franja.
2. **Subir `VEL_HIST_MS` de 20 s a 45 s** (hipótesis: el churn de modo causa los huecos):
   **refutada**. Gabriel da 3 % de cruces de umbral en los huecos contra 2,8 % en los tramos
   normales — cero enriquecimiento. Y sus huecos pasan **caminando** (0,5-1,5 m/s), muy por debajo
   del umbral de 3 m/s: la histéresis nunca lo hubiera tocado.
3. **"Salta calles" NO es el snap inventando**: con el `fraccionCiega` real, Gabriel ya iba **72 %
   crudo** y Javier **57 %** — la guarda ya los rechazaba. Eran las rectas del crudo.

**Moraleja, que vale más que los tres:** antes de tocar una constante de GPS, **contrastar la
hipótesis contra los datos**. Tres cambios en la historia del repo, tres teorías plausibles e
incompletas.

**🔴 El corte de 45 s dejaba el trazo hecho confeti, y el 80-100 % de los cortes no decía nada**
(medido el 10/08 a las 18:00, y es lo que el cliente estaba viendo como "el trazo sigue fallando").
`HUECO_DUDOSO_MS` parte el dibujo por TIEMPO, y con la cadencia lenta (30 s) **un solo fix perdido ya
son 60 s** — cualquier hipo del chip estando parado partía el trazo. Cortes de menos de 9 m sobre el
total de cortes dudosos de la jornada: Alejandro mercado 27/27, Orlando chavez 42/43, **Agustin
Vasquez 181/189** (y Agustin es el equipo más sano: **cero** metros dudosos de ≥ 50 m). Los que sí
valen se concentran en tres personas: Gabriel tevez 6.843 m, Javier 2.321 m, Luis Mendoza 1.248 m.
**Arreglado con un piso de `MIN_MOVE_M` en la condición del corte** (regla 49 de `CLAUDE.md`);
verificado con el código real sobre la jornada de Zura: 26 → 9 segmentos, 341,0 → 336,3 m punteados,
km idénticos hasta el sexto decimal.

**Diagnósticos que quedaron abiertos** (medidos, sin arreglar):

- ✅ **"Luis Mendoza captura fixes y no guarda ninguno" — RESUELTO el 11/08, y era una clase entera
  de bug, no un caso suelto.** El camino que faltaba no era `!movio && !vivo`: era el **filtro de
  precisión**. `procesarFix` avanzaba `ultimoFixAt` y llamaba `apagarCarrilRed()` ANTES de tirar el
  fix, así que un fix de 400 m —uno que estaba por descartarse— reseteaba el reloj del silencio y
  apagaba el respaldo de triangulación. De ahí la firma imposible: `fix_ultimo_ts` fresco,
  `gps_silencio_max_ms` bajo, cola en 0, y cero filas. Ver 1.13.3 y la regla 18-bis.
- 🆕 **Luis Mendoza dejó de ESCRIBIR posiciones a las 14:43 con el servicio vivo.** El 10/08 su
  último punto es 14:43 y sin embargo `fix_ultimo_ts` marca **17:30**, `gps_silencio_max_ms` solo
  **10 min** y `cola_pendiente` 0. O sea: el servicio nativo **captura fixes y no guarda ninguno**
  durante 2 h 45. No es un silencio de GPS y no es la cola. Es un modo de falla nuevo — el keepalive
  de 30 s tendría que estar encolando un punto de cortesía igual. Mirar `procesarFix`: el único
  camino que explica "fixes sí, filas no" es `!movio && !vivo` sostenido, que con `lastSentAt`
  avanzando no debería poder pasar.
- 🆕 **Los silencios son el defecto dominante del trazo, y 1.13.0 no los tocaba.** Minutos perdidos
  en huecos > 4 min el 10/08: **Luis Mendoza 509** (máximo 201 min), **Javier 180** (máximo 40 min,
  con un salto de **28 km** adentro), **Gabriel tevez 132**, **Zura 95**, **Nelson rojas 91**
  (máximo **62 min**, y arrancó 10:50 en vez de 08:00). Mientras esto siga así, el trazo va a tener
  tramos punteados por más que el dibujo se afine: **no hay dato**.

- 🔶 **Javier se calla 23 y 29 min manejando a 73 km/h** entre pueblos. El teléfono está sano
  (permisos, servicio, batería, 31 satélites). La cola **sí** guarda sin internet — se leyó el
  código: `encolar()` no consulta la red. Los puntos **nunca se capturaron**, no es que no se
  subieron.
  **Avance del 11/08 (parcial, y la hipótesis vieja quedó descartada):** el silencio se ve DESDE
  AFUERA. `dumpsys location` en su equipo (`100.126.96.63`) guarda
  `ProviderRequest[OFF] WorkSource{}` **de 14:00:03 a 14:36:51 — 36m48s** que coinciden al segundo
  con su agujero de 37 min y 28,6 km. El propio servicio lo mide: `gps_silencio_max_ms` = **44,6
  min**. **No es Doze ni el WakeLock** (verificado en los 4 equipos alcanzables: el
  `PARTIAL_WAKE_LOCK 'launion:uploader-gps'` estaba tomado hacía ~6 h, standby bucket 5, en la
  whitelist de deviceidle, foreground service vivo) **y no es la cola** (`cola_pendiente` y
  `cuarentena_nativa` en 0, y la cola nativa retiene 5.000 puntos sin descartar). Los equipos sanos
  (Orlando, Agustin) alternan `@+10s` ↔ `@+5s` sin un solo `OFF`.
  **Lo que falta**: por qué GMS deja de encender el chip. Es la cuarta teoría de GPS de este repo y
  las tres anteriores se revirtieron por saltarse la medición, así que **no se toca una constante
  hasta tener el muestreo**: `dumpsys location` por minuto en Javier + Alejandro contra Orlando +
  Agustin como control, una jornada entera.
  ⚠️ Ojo con confundirlo con el bug de precisión que se arregló en 1.13.3: **el silencio de Javier
  es real** (el servicio no recibía NADA), mientras que el agujero de Alejandro era el filtro
  tirando fixes que sí llegaban. Se distinguen por `gps_silencio_max_ms`: 44,6 min contra 0,3.
- **Luis Mendoza: saltos de 115 y 124 km/h en el pueblo**, de 11 s. Invisibles para los dos filtros
  (precisión 20-25 m, bajo el techo de 30; velocidad bajo `MAX_SPEED_MPS` = 162 km/h). El arreglo
  correcto es un umbral **por modo**, como ya lo son `MIN_MOVE_URBANO_M`/`MIN_MOVE_RUTA_M`.
- **La cadena de alarmas se rompe**: 6 de 9 teléfonos tenían `alarma_proxima_ts` clavada dos días
  atrás. La alarma que no dispara **no se re-arma sola**. Eso —y no la ventana horaria— es el
  "no arrancan a las 8".
- 🩸 **`estado_dispositivo` lo escribe el JS**, que solo corre con la app abierta. Hay teléfonos con
  puntos de hoy y latido de hace días. **Para saber si un equipo está vivo, mirar
  `max(posiciones.ts)`, no `estado_dispositivo.updated_at`** — el panel de diagnóstico miente.

**Fuera del código:** el **documento de servicios/contrato** (.docx + .pdf) quedó **sin empezar**.
Decisiones ya tomadas con el cliente: abono **mensual por módulo** ($300.000 rastreo con tope de 20
usuarios + $300.000 catálogo/pedidos), los **$200.000 ya cobrados** se imputan como **puesta en
marcha abonada**, y la tienda virtual B2B queda como plus a cotizar. El plan completo con las 13
secciones está en `~/.claude/plans/1-el-rol-de-smooth-trinket.md`.

### 🔴 Hacer ya

> **Lo de arriba de esta tabla es lo del 27-28/08 y lo del 28/08 a la tarde** (Destacados, el
> paquete de envío automático y el arreglo de la regla 52) y va primero: ver las secciones 🟠 y 🔵
> debajo de §1. **Todo eso sale junto en 1.22.0.**

| # | Pendiente | Por qué duele | Qué lo cierra |
|---|---|---|---|
| **N1** | 🔴 **Publicar el arreglo de la cola de escritura** (APK + OTA + PWA) | Está implementado y verificado, y **sin publicar no llega a nadie**. Mientras tanto, cualquier error permanente de una mutación vuelve a taponar la cola de esa persona y sus ediciones dejan de subir en silencio — pasó dos días con 147 fotos. Va junto con las escalas de precio, que ya están hechas | Subir `APP_VERSION`, `versionName`, `versionCode`; `CAP_BUILD=1`; los tres canales; y **cerrar el release mirando `estado_dispositivo.bundle_aplicado`, no la respuesta del push** (precedente 1.19.0) |
| **N2** | 🔴 **Leer la cola trabada de marketing antes de sacarle nada** | La mutación que bloqueó dos días sigue en el `localStorage` de esa persona. Puede ser un cambio de código legítimo que haya que aplicar a mano. **Regla 20: lo que no se pudo inspeccionar no se destruye** | `copy(JSON.stringify(JSON.parse(localStorage['lu-write-queue']).slice(0,3), null, 2))` en la consola de la app, y decidir con eso a la vista |
| **N3** | ✅ **HECHO el 28/08 (tarde)** — `features/catalog/EstadoCatalogo.jsx`, montado en `CatalogoTab` (o sea en las cuatro pantallas que editan catálogo). Muestra el contador de cuarentena **sólo si hay algo aislado**, y de paso el renglón de "precios actualizados hace N h" que faltaba para el envío automático. Sin publicar | | |
| **N4** | 🔴 **Redesplegar `ingest-precios` desde el repo** | Lo desplegado son copias **condensadas** de los tres módulos de `lib/` y **le faltan los dos cambios del 28/08** (`falta-encabezado` y `p_pisar_descripcion`). No está en uso —no hay token emitido— pero hay que alinearlo antes de emitir el primero | `node scripts/sync-ingest-precios.mjs` y desplegar los 4 archivos. Ver `supabase/functions/ingest-precios/LEER.md` |
| **N5** | 🟠 **Que el cliente responda tres cosas** | Condicionan el trabajo que sigue, y una de ellas se lleva puestas las 355 fotos | (a) ¿la lista a nivel unidad **conserva los códigos**?; (b) ¿pueden mandar la descripción completa o es ancho fijo?; (c) la **tabla de los 20 rubros**. Todo está en [REVISION_ARTIK.md](REVISION_ARTIK.md) |
| **N6** | 🟡 **Emitir el token de precios y hacer la primera carga a mano** | El pasaje a unidad **reemplaza el catálogo entero**: es demasiado grande para un endpoint sin nadie mirando, y el freno del 20 % lo va a rechazar a propósito | Primero un archivo de prueba de 20 filas **sin** tildar "lista completa", revisar en la app, y recién después la lista entera desde la pantalla leyendo el conteo de bajas |
| **0** | ⏳ **MEDIR 1.13.0 — lo primero de la sesión del martes 11/08** | El arreglo del **ancla** es nativo y **no se pudo probar**: el emulador no tiene GPS real ni Doze. Un arreglo sin medir no está confirmado. ⚠️ **La jornada del 10/08 no sirve: el APK se compiló ese día 13:08 y llegó a la tarde, así que es PRE-fix** | El **% de km falso** (trinquete parado: hops ≥ 9 m con neto < 40 m en ±6 puntos) tiene que bajar en los 5 con `apk_version=1.13.0` y quedarse igual en **Gabriel tevez**, que es el control porque no lo recibió. Tabla de línea de base y la advertencia sobre el criterio viejo, en §1. **Si no baja en ninguno, volver sobre `UploaderGpsService.java`** |
| **0-bis** | ⏳ **Mandar el push de aviso de 1.13.0** | Los tres canales están publicados pero **nadie avisó a los teléfonos**. Sin el push, los que no se actualizan solos no se enteran | El `net.http_post` a `push-actualizacion` de `CLAUDE.md §3`, con `timeout_milliseconds := 60000`. Lo tiene que correr una persona: lleva la `service_role` key |
| **0-ter** | 🔴 **Terminar de actualizar 2 teléfonos** | **Eduardo ruiz** nunca se conectó (parece que no le entregaron el equipo) y **Gabriel tevez** no tiene adb remoto | Eduardo: `adb install -r -i com.launion.app` por Tailscale cuando aparezca. Gabriel: por cable cuando venga — y aprovechar para dejarle `adb tcpip 5555`, así deja de depender de una visita. ⚠️ **El `-i` no es opcional**: sin él el equipo no queda como su propio instalador y la próxima tampoco es silenciosa |
| **0-cuatro** | 🟠 **Alejandro mercado y Zura: APK puesto, app sin abrir** | Tienen 1.13.0 instalado pero el latido sigue viejo. **`estado_dispositivo` lo escribe el JS**, que solo corre con la app abierta — el dashboard los muestra en 1.11.0 aunque el nativo esté actualizado | Abrirles la app por Tailscale (`adb shell monkey -p com.launion.app -c android.intent.category.LAUNCHER 1`) o esperar a que la abran ellos |
| **A1** | 🔴 **Cuatro teléfonos con el GNSS muerto — es hardware, no código** ([AUDITORIA_GPS_2026-08.md](AUDITORIA_GPS_2026-08.md) §3 H2) | **Zura, Alejandro mercado y Gabriel tevez no produjeron UN SOLO fix de ≤ 5 m** en los 8 días de retención: miles de puntos, cero. Y **Nelson rojas se degradó**: el 07/08 tenía 82,7 % de fixes sub-5 m y mejor fix de 1,4 m; el 11 y 12/08 tiene **0,0 % y su mejor fix del día entero es 16 m**. Mismo aparato, mismo software. El control que cierra el argumento es **Luis Mendoza, que se recuperó solo** (1,1 % el 10/08 → 55,6 % el 12/08) sin que nadie tocara nada. 🩸 **El discriminador es el MEJOR fix del día, no la mediana**: un techo de precisión filtra los fixes malos pero no puede empeorar el mínimo, así que es inmune al cambio de `ACCURACY_CAPTURA_MAX_M`. Mientras esto siga, **ningún umbral arregla nada**: es lo que dispara el borrado del snap y lo que llena el trazo de ruido | Los cuatro equipos en la mano: ubicación en "alta precisión" (`location_mode=3`), prueba a cielo abierto y `dumpsys location` para ver si el GNSS entrega. Si no engancha, **cambiar el equipo** |
| **A2** | 🔴 **El latido lo escribe el JS, y por eso el que necesita el arreglo no lo puede bajar** (§3 H4) | `estado_dispositivo` sale del WebView y las posiciones del servicio nativo: son dos caminos independientes. **Nelson figura sin latido desde el 11/08 00:51 y subió 1.619 posiciones el 12/08.** El panel dice que no reporta cuando sí reporta, y los avisos al supervisor heredan la mentira. 🩸 **Y el corolario es peor: el auto-updater de OTA también es JS**, así que un WebView congelado tampoco se actualiza — por eso Nelson quedó en 1.13.0 y Alejandro en 1.13.1 mientras el resto llegó a 1.13.8. *Los equipos que más necesitan el arreglo son estructuralmente los que no lo pueden recibir* | **OTA**: que "reportando" salga de la posición más nueva y no del latido — `ingest-posiciones` ya recibe `tel{}` y estampa `telemetria_ts`. **APK**: que el watchdog nativo dispare la descarga de la OTA, sin depender del WebView |
| **A3** | 🟠 **La telemetría de descartes cuenta dos veces** (§3 H5) | En `UploaderGpsService.java:749` el fix retenido suma `cDescMovimiento++`, y en `:759-762` **ese mismo fix** vuelve a sumar `cGuardados++` al encolarse. La suma de destinos supera `fix_total` en **todos** los equipos (Agustin +592, Javier +138, Orlando +103). O sea que **`fix_desc_movimiento` no significa "descartados" sino "diferidos"**, y todo porcentaje de descarte por movimiento citado en esta bitácora está inflado. Mientras siga así, la invariante "cada fix tiene destino conocido" **no puede cerrar por definición** | **APK**: no sumar `cDescMovimiento` al retener, o descontarlo al encolar. Recién después se puede verificar `fix_total = guardados + descartes` |
| 1 | **Respaldar el keystore** (§2.1) | Punto único de falla, y se está por mudar de disco | Contraseñas a un gestor + `.keystore` en 2 lugares |
| 2 | **Cerrar el circuito de recuperación de contraseña** | Está **roto en producción**: el botón manda el mail y no hay pantalla donde poner la nueva. Ver §5 | Vista nueva + handler de `PASSWORD_RECOVERY` |
| 3 | ✅ **HECHO el 27/08 (`db/48`)** — `ingesta_tokens` versionada, con `proposito` (`gps` / `precios`) y único `(id_usuario, proposito)`. `mi_token_ingesta` pasó a tomar un parámetro con default, así el `rpc('mi_token_ingesta')` sin argumentos del uploader nativo sigue andando sin APK nuevo | | |
| 4 | **Unificar la ventana de rastreo**, hoy implementada 3 veces | `dentroDeHorario()` (JS), `VentanaRastreo.dentro()` (Java) y `en_ventana` (SQL). Tocar una sin las otras hace que **los avisos al supervisor mientan en silencio** | Una sola fuente — el SQL es el candidato: se verifica con un `select` |
| 4-bis | ⚠️ **1.11.0 publicada** (arranque del rastreo al horario) — **SUPERADA por 1.13.0, y la medición NUNCA se hizo.** Sigue vigente como deuda | Se publicó en los tres canales el 05/08 (verificado por MCP el 07/08). Pero **un arreglo sin medir no está confirmado**: la línea de base era 51 min de mediana de retraso sobre 29 días hábiles (`db/30`) | Consulta contra `posiciones`: primer punto del día por usuario vs. las 08:00, sobre los días hábiles desde el 05/08. Si sigue arriba de ~15 min, el arreglo no alcanzó |
| 4-ter | **Que un cambio de horario llegue al teléfono con la app cerrada** | Las prefs con la ventana solo las escribe `configurar()` con la app viva. Si el admin cambia el horario y la persona no abre la app en días, el teléfono sigue con la ventana vieja — y ahora también con la alarma calculada sobre ella | `LaUnionMessagingService` escribiendo la ventana en prefs desde un data-message de FCM (corre en nativo, con el WebView muerto) |
| 4-cinco | 🟢 **Pasar los 9 teléfonos por `diagnostico-usb.sh --configurar`** | **Medido el 07/08 en un A07 real: un cable resuelve el onboarding entero en ~30 s** — exención de batería (que **sobrevive al reboot**), los 5 permisos incluido "Permitir siempre", y los 2 appops. Hoy **3 de 5** equipos con diagnóstico están **sin exención de batería**, que es la palanca del arranque al horario. **No hace falta esperar a Headwind, ni al recambio de personal, ni resetear nada** | [`scripts/diagnostico-usb.sh`](scripts/diagnostico-usb.sh). Ir anotando marca/modelo/API de cada equipo en el `.txt` que genera — es el dato que el pendiente #7 todavía no recolecta |
| 4-quater | 🔴🔴 **ANTES de reasignar un teléfono a un usuario nuevo: actualizarlo a ≥1.8.0** | Se va a hacer un recambio total de usuarios (07/08: *"los usuarios que ya están se descartan, cada teléfono va a tener un usuario nuevo"*). **Tres equipos están por debajo del fix de la regla 19-bis** — Nelson Rojas y Luis Mendoza en **1.6.0**, julii Adet en **1.6.6** — y en esas versiones el uploader nativo sigue subiendo con el token de la cuenta anterior: los puntos se escriben **a nombre de quien no estaba**, en una tabla **sin policy de UPDATE ni de DELETE**. 🩸 **Incorregible: no se puede borrar ni reasignar después.** Que el escenario es real ya está probado — Emanuel Arias tiene **42 puntos en `cuarentena_nativa`**, o sea que la cuarentena ya atrapó un cambio de cuenta | Orden obligatorio **por equipo**: (1) verificar `app_version ≥ 1.8.0` en `estado_dispositivo`; (2) si no, actualizar y confirmar que subió; (3) recién ahí cerrar sesión **desde la app** (el `signOut` es el que llama `cerrarSesionUploader()` y borra el token — apagar el teléfono NO alcanza); (4) entrar con el usuario nuevo |
| 5 | **Términos y condiciones + política de privacidad** | La app pide `ACCESS_BACKGROUND_LOCATION` y rastrea empleados; hoy no hay ni una línea legal. Ver §6 | Borradores ya escritos en [`legal/`](legal/) — falta revisión, publicación y link |
| 6 | 🔴 **Device Owner ANTES de desprecintar los Samsung A07** | Device Owner exige un teléfono sin ninguna cuenta configurada. Si se configuran primero, cuesta un **factory reset por equipo** (~media jornada, más el FRP). **Decidido el 07/08: sí, vía Headwind MDM** (§7.9) | Leer §7.2-7.3 y §7.9. La sesión de USB (§7.7) va **primero**, antes de la cuenta de Google |
| 6-bis | 🔴 **Laboratorio de Headwind ANTES de gastar un peso** | Se eligió Headwind sin haber visto el panel funcionando. Tres cosas están **sin verificar** y una de ellas (¿bloquea el force-stop?) es la única capacidad que justifica todo el aparato de Device Owner | WSL2 + Ubuntu 22.04 contra un teléfono viejo. **Nunca contra un A07.** Ver §7.9, Fase 0 |
| 7 | **Registrar marca/modelo/API level en `estado_dispositivo`** | Es la precondición de toda decisión por dispositivo. Hoy se mide el **síntoma** del OEM agresivo (`fgs_bloqueado`, `bateria_exenta`, `gps_silencio_max_ms`) y **nunca la identidad**: no se puede contestar con un `select` qué teléfonos hay, ni cruzar los síntomas contra un modelo | Parseo del user-agent en `useEstadoDispositivo.js` + una migración nueva (⚠️ `db/31` y `db/32` YA están usadas — la próxima es `db/33`). **Sale por OTA, sin APK.** Ver §7.10 #1 |
| 8 | **Actualización silenciosa: `PackageInstaller` + `UPDATE_PACKAGES_WITHOUT_USER_ACTION`** | Hoy actualizar cuesta 3-4 toques del vendedor (6-7 la primera vez). **Decidido**, va en el próximo APK — pero ⚠️ **si Headwind pasa la Fase 0, esto queda redundante para los A07**: decidir #6-bis primero para no escribirlo al pedo | Reemplazar `lanzarInstalador` en `ApkUpdaterPlugin.java:121-130`. Ver §7.4 |

### 🟠 Próximo sprint

| # | Pendiente | Nota |
|---|---|---|
| 9 | **Corregir el copy de `PermisoSiemprePrompt.jsx`** | Hoy le dice a TODOS *"En Xiaomi, Huawei y similares, activá Inicio automático"*, y **va a ser falso para el 100 % del parque nuevo**: Samsung no tiene lista de autostart. Sale por OTA y depende del pendiente #7 (saber la marca). Ver §7.8 |
| 10 | Script `build:apk` con `CAP_BUILD=1` incorporado | `cross-env` por Windows. Cierra el riesgo #4 de la auditoría, vigente desde julio |
| 11 | ✅ **HECHO el 27/08 (`db/48`)** — `unique (id_empresa, codigo_norm)` en `clientes` **y** en `productos`, sobre una columna generada que espeja `codigoKey()` (ignora los ceros a la izquierda). Verificado antes de migrar: 0 colisiones en 529 productos y 2.014 clientes |
| 12 | Decidir `AdminView` | Está **inalcanzable** y con él 3 vistas muertas (511 L). Borrar `RecorridosView` y `MapaOperativo`; **rescatar `ReplayJornada`** (reproduce la jornada como película, no hay nada equivalente) colgándola de "Menú" |
| 13 | Versionar las 4 columnas restantes | `posiciones.bateria`, `perfiles.numero`, `zonas.numero`, `zonas.id_vendedor` + `ubicaciones_compartidas` y su RPC |
| 14 | Rotar la key de Stadia y moverla a `VITE_STADIA_KEY` | Está commiteada: considerarla quemada. Agregarla como secret del workflow o la PWA pierde esas capas |
| 15 | Config de ESLint + quitar el `\|\| true` | Hoy no hay ninguna red de seguridad |
| 16 | Prender la **protección de contraseñas filtradas** en Supabase Auth | Una casilla del panel. Relevante porque las contraseñas iniciales las elige un admin |
| 17 | Sanear las docs obsoletas | `README.md` (menciona un componente `GoogleMap` inexistente), `GUIA_APK_ANDROID.md` (se contradice sobre `storeFile`), `GUIA_API_KEY_GOOGLE_MAPS.md` (obsoleta entera) |
| 18 | `supabase/functions/_shared/fcm.ts` | `getAccessToken` está copiado **3 veces**; la cuarta va a divergir |

### 🟡 Cuando haya aire

- Tests de las funciones puras. **Empezar por `segmentar.ts`**, que está separada justamente para poder
  probarse sin Deno ni Supabase. Después `dwell.js`, `estados.js`, `format.js`, `geofence.js`, `geo.js`.
- Seguir extrayendo lo común de `SupervisionMovil` (891 L) y `SupervisionDesktop` (790 L): **no comparten
  una sola línea** y ya divergieron dos veces.
- Decidir el futuro de `pedidos` / `pedido_items` / bucket `firmas`.
- Borrar `VITE_GOOGLE_MAPS_API_KEY`, el port muerto de Google Maps y la dep `qrcode` (declarada y sin un
  solo import: el QR se hace en nativo con ZXing).
- Evaluar alternativa a OSRM demo público — habilitaría `/match`, mejor algoritmo que `/route` para
  pegar un rastro a las calles.
- Unificar `.env.local` / `.env.production` / `.env.example`, que tienen sets distintos de variables.

> ⚠️ **Al escribir tests de una cola, la invariante es "no se pierde ni un punto", no "el descarte
> funciona".** Los tests de 1.5.26 pasaron 9/9 y aun así el cambio **borró 264 puntos reales en
> producción**: probaban que el borrado ocurriera, no si correspondía. Contar siempre
> `subidos + aislados == total`.

---

## 5. Login y alta de cuentas

Esta es una de las dos cosas que quedaron a medias a propósito, y conviene tener el mapa completo antes
de tocarla.

### 5.1 Lo que hay hoy

`web/src/features/auth/LoginView.jsx` (357 L), diseño v1.4:

- **Google, en dos formas**: la tarjeta "Continuar como X" (última cuenta usada en el teléfono) y el
  botón blanco estándar. **Es el camino real**: 13 de 14 usuarios de producción entran por acá, y por
  eso el diseño v1.4 dio vuelta la jerarquía y plegó el formulario.
- **Email + contraseña**, detrás de un renglón que lo despliega.
- Tres errores distintos y bien escritos (sin conexión / contraseña incorrecta / otro), clasificados por
  el mensaje y **no** por `navigator.onLine` — decisión deliberada, el WebView miente.
- "Recordar mi usuario" (guarda **solo el email**), ojito de contraseña, toggle de tema antes de entrar,
  detalle técnico plegable con `authError`/`authStatus`/versión.

`AuthContext.jsx` sostiene: login nativo por `idToken` (`GoogleAuth.initialize()` es obligatorio antes
de `signIn()`, si no crashea), OAuth web con la página puente `web/public/oauth.html` (un 302 del servidor a
un esquema custom el navegador no lo respeta, así que el salto lo hace el cliente), caché de sesión y de
perfil offline-first, y un `signOut` que **primero** llama a `cerrarSesionUploader()` (§ regla del token
nativo) y recién al final a `supabase.auth.signOut()`.

**Cómo nace una cuenta hoy — dos caminos, ninguno de autoservicio:**

1. **Un admin la crea** (`UsuariosView` → Edge Function `crear-usuario`): email + **contraseña inicial**
   + nombre + rol + empresa. Se crea con `email_confirm: true`, sin mail de confirmación ni de
   invitación — la decisión está escrita en la función: *el gate real de esta app no es el mail, es la
   aprobación (rol + activo)*. **Consecuencia operativa: el admin elige la contraseña y se la pasa por
   fuera de la app** (WhatsApp, en persona).
2. **La persona entra con Google** y el trigger `handle_new_user` le crea el perfil con `rol = null,
   activo = false` → cae en `PendienteView`. **3 de 15 perfiles están así ahora mismo.**

### 5.2 Lo que está roto

| | |
|---|---|
| 🔴 **Recuperar contraseña no cierra** | El botón existe, la hoja pide el email y `resetPasswordForEmail` manda el mail. Pero **no hay ninguna pantalla donde poner la contraseña nueva**: cero `updateUser` y cero manejo del evento `PASSWORD_RECOVERY` en todo `web/src/` (verificado por grep). La persona hace clic en el mail, la PWA le crea sesión y entra a la app — con la contraseña vieja intacta y sin lugar donde cambiarla |
| 🟠 **El `redirectTo` no vuelve al APK** | Usa `window.location.origin + BASE_URL`, que en el APK es el origin del WebView. El OAuth sí lo resolvió (con `oauth.html`); la recuperación no |
| 🟠 **El copy promete algo que no pasa** | La hoja "Solicitar acceso" dice *"tu pedido le llega al administrador"*. **No le llega nada**: no hay notificación de cuenta pendiente. El admin se entera solo si mira la lista de usuarios |

### 5.3 Lo que falta

**No existe `signUp` en ninguna parte** (verificado). Y "Solicitar acceso" es hoy una **hoja
explicativa que redirige a Google**, no el formulario que pedía el brief v1.4 §4.4 (nombre, email,
teléfono, distribuidora → crea una solicitud). El comentario en el código explica por qué se dejó así:
*sería un endpoint anónimo abierto a internet, necesita tabla nueva, aviso al admin y límite de spam*.
Tampoco existe el tercer estado de `PendienteView` ("solicitud enviada") que el diseñador entregó.

### 5.4 La decisión, ahora desbloqueada

Estaba frenada por una duda de seguridad razonable: *si abrimos el alta, ¿alguien puede autoasignarse un
rol?* **Verificado en la base viva el 04/08: no.**

- `handle_new_user` inserta `rol = null, activo = false`.
- `perfiles` **no tiene policy de INSERT** y **no tiene self-update**: `perfiles_upd` exige superadmin o
  admin de la misma empresa.
- `perfiles_sel` sí deja al usuario leer su propia fila, que es lo que necesita `PendienteView`.

**Recomendación: formulario de "Solicitud de acceso" + invitación por mail. NO `signUp` abierto.** En un
multi-tenant siempre va a hacer falta que un admin asigne rol y empresa, así que el registro
autoservicio no ahorra el paso de aprobación — solo agrega un endpoint anónimo que hay que defender del
spam, plantillas de confirmación en español y un SMTP propio (el de cortesía de Supabase tiene rate
limit bajo).

### 5.5 Orden de trabajo sugerido

| # | Tarea | Esfuerzo | Toca |
|---|---|---|---|
| 1 | **Pantalla "poner contraseña nueva"** (`PASSWORD_RECOVERY` + `updateUser`) | S | `AuthContext.jsx` + vista nueva en `features/auth/` |
| 2 | **Arreglar el `redirectTo`** para el APK + cargar las Redirect URLs en el panel | S | `AuthContext.jsx`, patrón de `web/public/oauth.html` |
| 3 | **Links a T&C y privacidad** en el pie del login y en `PendienteView` | XS | `LoginView.jsx` (bloque "¿Todavía no tenés acceso?"), `PendienteView.jsx` |
| 4 | **Modo "invitar por mail"** en `crear-usuario` (`inviteUserByEmail`) | M | Edge Function + `UsuariosView` — deja de dictar contraseñas por WhatsApp |
| 5 | **Formulario "Solicitar acceso"** completo: tabla + RLS + endpoint anónimo con rate limit + aviso al admin + estado "solicitud enviada" | M-L | `LoginView`, `PendienteView`, migración nueva, Edge Function nueva |
| 6 | Prender la protección de contraseñas filtradas | XS | Panel de Supabase |

Fuera de alcance por decisión (documentada en el brief y en el código): registro autoservicio abierto y
biometría/huella.

---

## 6. Términos y condiciones

**No existía ni una línea de texto legal en todo el proyecto** — ni archivo, ni link, ni casilla de
aceptación, ni registro de consentimiento en la base. Tampoco lo preveían los briefs ni los mockups del
diseñador: es un **hueco de alcance**, no un bug. Nadie lo pidió nunca.

**Ya están redactados los dos borradores** en [`legal/`](legal/):

- [`legal/TERMINOS_Y_CONDICIONES.md`](legal/TERMINOS_Y_CONDICIONES.md)
- [`legal/POLITICA_DE_PRIVACIDAD.md`](legal/POLITICA_DE_PRIVACIDAD.md)

**Falta:** revisión legal (están marcados como borrador), publicarlos en una URL accesible —lo más
barato es junto a la PWA en GitHub Pages— y linkearlos desde `LoginView` y `PendienteView`.

**Por qué importa más de lo que parece:**

1. **Google Play**, el día que se publique. Para `ACCESS_BACKGROUND_LOCATION` exige política de
   privacidad en URL accesible, declaración de seguridad de datos, justificación escrita del uso en
   segundo plano y **video demostrativo**. Hoy la app se distribuye por APK directo (el QR de
   `InvitarModal` apunta a GitHub Releases), así que todavía no aplica.
2. **La pantalla de consentimiento de Google OAuth**: pasar el proyecto de GCP a "producción" pide
   privacy policy URL.
3. **Ley 25.326** (Argentina). La app rastrea la ubicación continua de trabajadores en relación de
   dependencia. Hoy lo único que se le dice al usuario es `PermisoSiemprePrompt`, que explica **para
   qué** hace falta "Permitir siempre" en términos operativos ("para que tu recorrido no se corte"),
   pero no dice qué se guarda, por cuánto tiempo ni quién lo ve.

---

## 7. El parque nuevo (Samsung A07) — la ventana que se cierra al desprecintar

> ⚠️ **Leer ANTES de configurar el primer teléfono.** Hay una decisión que, tomada después de poner
> la cuenta de Google, cuesta un factory reset por equipo.

> 🩸 **CORRECCIÓN DEL 07/08/2026 — la premisa de esta sección era falsa en parte.** Se escribió
> creyendo que los A07 todavía no habían llegado. **No es así: los 9 teléfonos que están hoy en la
> calle YA son Samsung A07 y A06, y están configurados desde el 27/07.** Consecuencias, y son grandes:
>
> 1. **Para esos 9 la ventana de provisioning YA SE CERRÓ.** Device Owner sobre ellos no cuesta
>    "decidir a tiempo": cuesta **9 factory resets**, con su cola de posiciones, su cuarentena y su
>    sesión (regla 20). Todo lo que 7.2 dice sobre *decidir antes de desprecintar* aplica **solo a
>    teléfonos que todavía no se configuraron**.
> 2. **El parque ya está casi unificado** — y aun así sigue sin registrarse marca ni modelo en ningún
>    lado (pendiente §4 #7). Que sean A07/A06 se sabe porque lo dijo una persona, no por un `select`.
> 3. 🔴 **El problema medido no es el que Device Owner arregla.** Medición del 07/08 sobre los 5 que
>    reportan diagnóstico completo: **3 de 5 NO tienen la exención de batería**, y `alarma_exacta`
>    sigue exactamente a `bateria_exenta` en los 5 casos — **confirmación de campo de la cadena que
>    7.3 predijo**. Device Owner no toca eso. `adb` sí, y sin resetear nada (7.7, Fase 3).
>
> **Traducción operativa: la palanca más grande que queda no es un MDM, es un cable USB — y los
> teléfonos ya están acá.** Ver 7.7.

> 🟢 **SEGUNDA CORRECCIÓN, mismo día — la ventana SE REABRE.** Poco después se definió que **se
> descartan todos los usuarios actuales, cada teléfono pasa a un empleado nuevo, y cada equipo se
> resetea de fábrica.** Eso cambia el cálculo entero:
>
> - **Device Owner vuelve a costar cero.** El factory reset se iba a hacer igual, así que la ventana
>   de provisioning se abre 9 veces sin trabajo extra. Todo 7.2 vuelve a aplicar **en su forma
>   original**, y el punto 1 de la corrección de arriba queda superado.
> - 🔴 **Pero ahora el orden es crítico y hay una sola oportunidad por equipo.** El provisioning de
>   Device Owner va **inmediatamente después del reset y antes de la cuenta de Google**. Si el
>   servidor de MDM no existe todavía, el QR no apunta a ningún lado y la ventana se quema — otra
>   vez, y esta vez sin excusa. **El servidor va PRIMERO (7.9, Fase 1). No se resetea nada hasta
>   que esté arriba y probado.**
> - 🟢 **El riesgo de la regla 19-bis se disuelve solo** para los equipos que se reseteen: el factory
>   reset borra la app y sus prefs, o sea el token viejo. El pendiente §4 #4-quater sigue valiendo
>   **solo** para cualquier teléfono al que se le cambie el usuario **sin** resetear.
> - ⚠️ **Verificar `cola_pendiente = 0` en `estado_dispositivo` justo antes de cada reset.** El reset
>   borra la cola local: lo que no se subió, se pierde. El 07/08 los 9 estaban en 0.

### 7.1 Qué cambió

El cliente unifica el parque a **un solo modelo, Samsung A07, comprado por la empresa**, y los va a
configurar uno por uno antes de entregarlos. ⚠️ **Ver la corrección de arriba: buena parte del parque
ya está unificada y ya configurada.**

Los dos cambios importantes no son técnicos: **un solo modelo** (antes, 9 teléfonos distintos) y
**teléfonos de la empresa** (antes, personales).

🩸 **Y eso tira abajo la premisa de una decisión ya tomada.**
[`GUIA_GPS_EN_VIVO_Y_JORNADA.md:104-113`](GUIA_GPS_EN_VIVO_Y_JORNADA.md) descartó kiosco/MDM con este
argumento textual: *"no es alcanzable como garantía **en los teléfonos personales de los
vendedores**"* y *"exige **teléfonos dedicados** provisionados como dispositivos administrados (MDM).
✔ El usuario eligió NO ir por ahí"*.

**Fue un rechazo a comprar hardware dedicado, no a Android Enterprise como tecnología — y el hardware
dedicado ya está comprado.** La decisión queda formalmente reabierta acá. Ojo: eso **no** la convierte
automáticamente en un sí. Ver 7.3.

### 7.2 🔴 La ventana de provisioning — lo que hay que leer sí o sí

**Device Owner exige un dispositivo sin NINGUNA cuenta configurada.** En la práctica: de fábrica, o
factory reset. No hay forma de convertir en Device Owner un teléfono que ya tiene la cuenta de Google
del vendedor puesta — el sistema rechaza el provisioning si existe cualquier cuenta.

> **El orden obligatorio, si la respuesta es sí:**
>
> desprecintar → wizard **SIN agregar cuenta de Google** → habilitar depuración USB → provisioning →
> **recién ahí** cuenta, WhatsApp y la app.
>
> Si se invierte, se pierde.

**Techo honesto, para no dramatizar:** la ventana **se reabre** con un factory reset. No es
irreversible, es **caro**: ~20-30 min por teléfono entre reset, wizard, cuenta, WhatsApp y re-login,
×9-12 ≈ **media jornada del cliente**, más el bloqueo **FRP** si la cuenta de Google no se saca antes
del reset. La decisión hay que tomarla antes de desprecintar no porque después sea imposible, sino
porque después cuesta una tarde y una conversación incómoda.

#### 🟢 Qué hacer el día que llegan las cajas (decidido: probar en el primero)

La decisión **no** está tomada todavía, y no hace falta tomarla a ciegas. El plan acordado es medir en
uno antes de comprometer los doce:

1. **Abrir UNA sola caja.** Las otras quedan cerradas.
2. Pasar el wizard **sin agregar cuenta de Google** y habilitar depuración USB.
3. Correr las **Fases 1 a 3 de §7.7**. Son 20 minutos y contestan las tres preguntas que deciden todo:
   - ¿`adb shell dpm set-device-owner` funciona en este A07, o Samsung lo bloquea post-wizard?
   - ¿el permiso de **"Permitir siempre"** queda concedido sin que nadie entre a Ajustes?
   - ¿la **exención de batería** puesta por `adb` **sobrevive al reboot**?
4. **Con esas tres respuestas, decidir** (§7.3) y recién ahí abrir las otras cajas.
5. Si la decisión es "no": ese teléfono se termina de configurar normal y no se perdió nada. Si es
   "sí": ya está provisionado y sirve de molde para los otros.

> ⚠️ **Lo único que NO se puede hacer es configurar los doce primero y decidir después.** Ese es el
> camino que cuesta media jornada de resets.

| Método | Cómo | Requisitos | ¿Sirve para 9-12? |
|---|---|---|---|
| **QR desde el setup wizard** | En la pantalla de bienvenida, tocar 6 veces la misma zona → se abre el lector → escanea un JSON con el DPC, el checksum de su firma y la URL de descarga | Android 7+, WiFi | ✅ **El método recomendado.** Un QR generado una vez, ~2 min por equipo |
| **`adb shell dpm set-device-owner`** | Por USB, después del wizard pero **sin ninguna cuenta agregada** | Depuración USB, sin cuentas | 🟡 ⚠️ **VERIFICAR en el A07** — hay reportes de que Samsung lo bloquea post-wizard. **Si funciona, es el camino ideal: colapsa el provisioning y la sesión de USB (7.7) en una sola pasada.** Probarlo con UN teléfono antes de tocar los otros |
| **`afw#setup`** | En el wizard, donde pide el mail, escribir `afw#setup` | Cuenta de Google gestionada + un EMM detrás | Solo si van por AMAPI |
| **NFC bump** | Un teléfono "programador" toca al nuevo | NFC en ambos; se rompe por versión | ⚪ Suplente del QR |
| **Samsung KME / zero-touch** | Se auto-inscriben al primer boot, **sin poder saltearlo ni con reset** | KME es **gratis**, pero el reseller tiene que registrarlos (o el admin a mano con la Knox Deployment App) | ⚠️ **VERIFICAR si el comercio es reseller Knox.** Con 9-12 unidades de retail, lo más probable es que no |

### 7.3 Qué compra Device Owner, y qué NO

> 🟢 **MEDIDO el 07/08/2026 sobre un A07 real — y el resultado desarma media tabla.**
> Equipo: **SM-A075M, Android 16 (API 36), One UI 8.0.5**, con la app 1.11.0 instalada por `adb`.
> Salida completa en [`scripts/diagnostico-SM-A075M-20260807-1605.txt`](scripts/).
>
> | Qué se probó | Resultado |
> |---|---|
> | Exención de batería por `adb shell cmd deviceidle whitelist +com.launion.app` | ✅ **Funciona**, y deja el standby bucket en **5 (EXEMPTED)**, el mejor estado posible |
> | 🔴 **¿Sobrevive al reboot?** | ✅ **SÍ** — verificado con reinicio real. Queda como `user,com.launion.app` en la whitelist |
> | `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`, `ACTIVITY_RECOGNITION` por `adb shell pm grant` | ✅ Concedidos |
> | 🔴 **`ACCESS_BACKGROUND_LOCATION`** ("Permitir siempre") por `pm grant` | ✅ **SÍ, concedido** — el permiso que Android 11+ **no deja pedir por diálogo** |
> | `SCHEDULE_EXACT_ALARM` y `REQUEST_INSTALL_PACKAGES` por `cmd appops set … allow` | ✅ Ambos en `allow` |
>
> 🩸 **Consecuencia: el onboarding entero se resuelve con un cable, en ~30 segundos por equipo, sin
> Device Owner, sin factory reset y sin servidor de MDM.** La fila de abajo que decía *"probablemente,
> solo en fully managed"* sobre `ACCESS_BACKGROUND_LOCATION` quedó **superada**: no hace falta.
> Lo hace [`scripts/diagnostico-usb.sh --configurar`](scripts/diagnostico-usb.sh).
>
> **Lo que Device Owner SIGUE comprando en exclusiva son dos cosas, y las dos son la misma idea —
> que el operador no pueda desarmar el rastreo:** bloquear el force-stop, y el GPS del sistema
> (volver a encenderlo o impedir que lo apaguen). Nada más. Todo el resto ya está resuelto por USB.

⚠️ **El resto de esta tabla sigue sin confirmarse sobre un A07.** Es lo que la documentación de
Android habilita; la Fase 2 del checklist (7.7) es la que lo convierte en hecho.

| Problema | ¿DO lo resuelve? | Mecanismo / honestidad |
|---|---|---|
| **Instalación y actualización silenciosa** (hoy 3-4 toques, 6-7 la primera vez) | ✅ Resuelve | `PackageInstaller` desde el DO. **Pero hay una alternativa más barata sin DO** — ver 7.4 |
| Auto-conceder `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS`, `ACTIVITY_RECOGNITION` | ✅ Resuelve | `setPermissionPolicy(PERMISSION_POLICY_AUTO_GRANT)` |
| Auto-conceder **`ACCESS_BACKGROUND_LOCATION`** ("Permitir siempre", que Android 11+ **no** deja pedir por diálogo) | 🟡 Probablemente, solo en *fully managed* | Los permisos de sensor se auto-conceden solo en dispositivo totalmente administrado. ⚠️ **VERIFICAR: es la comprobación más valiosa de toda la sesión.** Si anda, la parte más frágil del onboarding desaparece |
| 🩸 **Exención de optimización de batería / Doze** | ❌ **NO lo toca** | **Acá es donde la propuesta original promete de más.** No existe API de `DevicePolicyManager` para la allowlist de Doze: se toca con el diálogo al usuario (lo que ya hace `BatteryOptimizationPlugin.request()`), por `adb`, o con una API de OEM (Knox). **Device Owner NO ahorra este paso** |
| **`SCHEDULE_EXACT_ALARM`** (de él depende el arranque de 1.11.0) | ❌ No directamente | Es un *special app access*, no un permiso de runtime. Pero **se concede solo al estar exento de batería** — o sea que **la cadena entera del arranque sigue colgando de la exención, con o sin Device Owner** |
| 🟢 **Que el vendedor apague el GPS del sistema** (pedido explícito del 07/08: *"si ellos apagan manual el gps… poder encenderlo desde esta PC"*) | ✅ **Resuelve, y de dos maneras — la segunda es mejor** | **Detectarlo ya se hace hoy**: `estado_dispositivo.permiso` / `gps_ok` (Nelson Rojas figura `denegado` ahora mismo). **Encenderlo** es lo que no se puede: cambiar `location_mode` exige `WRITE_SECURE_SETTINGS`, que solo tienen las apps del sistema y `adb`. Con Device Owner hay dos caminos: `setLocationEnabled()` (API 30+) para **prenderlo a distancia**, y `addUserRestriction(DISALLOW_CONFIG_LOCATION)` para que **no lo puedan apagar** — esta segunda es la buena, porque prevenir no depende de que el teléfono tenga señal en ese momento. ⚠️ VERIFICAR ambas en el A07. **Sin Device Owner no hay ninguna forma**: ni la app, ni un push, ni el panel |
| **Impedir el force-stop del usuario** | ✅ **Resuelve — y es lo ÚNICO que solo DO resuelve** | `setUserControlDisabledPackages()` (API 30+) saca "Forzar detención" y "Borrar datos". Importa mucho: un force-stop **cancela las alarmas y corta los broadcasts hasta que alguien abra la app a mano** — mata el watchdog *y* el arranque al horario. Es justo lo que `GUIA_GPS_EN_VIVO_Y_JORNADA.md:107` declara inalcanzable. **Con DO deja de serlo** |
| **Los OEM killers de Samsung** (Sleeping apps / Deep sleeping apps / Adaptive battery) | 🟡 Solo con Knox encima; DO puro **no** | AOSP no expone esas listas. Se tocan con **Knox Service Plugin**, la app OEMConfig gratuita que un EMM empuja por managed configurations. ⚠️ **VERIFICAR si esa política concreta necesita licencia Knox *Premium* (paga) o le alcanza Standard** |
| **Autostart** | ⚪ No aplica | **Samsung no tiene lista de autostart** al estilo MIUI/EMUI/ColorOS. Sus equivalentes son la fila de arriba. Ver 7.8 |
| **Kiosco / lock-task** | ✅ Resuelve, si lo quisieran | `setLockTaskPackages()`. **Recomendación: NO activarlo** — el vendedor no podría usar WhatsApp ni la cámara. Queda anotado como palanca disponible |

> 🟢 **ACTUALIZACIÓN 07/08/2026 — ahora resuelve 3, y el tercero es el que más se quiere.** Se pidió
> poder **volver a encender el GPS** cuando el vendedor lo apaga a mano. Eso **no tiene ninguna
> solución sin Device Owner** — no es cuestión de escribir más código, la API está cerrada para apps
> normales. Sumado al force-stop, quedan **dos capacidades que solo DO compra**, y ambas son sobre lo
> mismo: **que el operador no pueda desarmar el rastreo.** Como los 9 equipos se van a resetear igual
> (ver la corrección al principio de §7), esas dos salen sin trabajo extra. **Es el argumento más
> fuerte a favor que apareció en todo el análisis.**

> 🩸 **Device Owner resuelve 2 de los 7 problemas, y de esos 2 uno tiene alternativa más barata.**
> **La exención de batería —la palanca de la que cuelga el arranque al horario (`db/30`)— sigue
> exactamente igual con o sin Device Owner.** Lo único que compra en exclusiva es que el vendedor no
> lo pueda romper. Con teléfonos de la empresa eso no es poco, pero es un argumento de *integridad de
> la configuración*, no de *capacidad técnica nueva*. Hay que venderlo así.

**Decidido: probar en el primer A07 y decidir después.** No se compromete la flota entera hasta tener
las tres mediciones de la Fase 2 y 3.

### 7.4 Actualización sin toques — por qué Uptodown no, y qué sí

🔴 **Uptodown no logra el objetivo, y no es culpa de Uptodown: es del sistema operativo.** En Android,
una instalación sin diálogo la puede hacer exactamente uno de estos tres: un instalador
**privilegiado** de la imagen del sistema (Play Store), un **Device Owner** vía `PackageInstaller`, o
alguien con **root**. Uptodown no es ninguno: pide `REQUEST_INSTALL_PACKAGES` para sí mismo y después
lanza el mismo diálogo que ya lanza `ApkUpdaterPlugin`. **Automatiza la descarga, no la instalación.**

Y además suma: latencia de moderación entre `apk-release.sh` y que el teléfono lo vea (hoy es cero y
la controla `min_version`), un tercero en el camino crítico del mecanismo que sostiene el arreglo del
arranque, y un **listado público** de una app que rastrea empleados — con la deuda legal de §6
todavía abierta. Nota justa: el APK **ya es público** (GitHub Releases, y el QR de `InvitarModal`
apunta ahí); el delta no es secreto perdido, es descubribilidad más un tercero. Solo se pagaría si
comprara algo, y no compra nada.

| Camino | Toques | Notas |
|---|---|---|
| **Hoy** — `Intent.ACTION_VIEW` + FileProvider | **3-4**, y **6-7 la primera vez** en cada teléfono (hay que activar "Instalar apps desconocidas" y volver a tocar Actualizar) | `ApkUpdaterPlugin.java:121-130`. El encabezado del archivo ya lo dice: *"NO es una instalación silenciosa"* |
| ✅ **`PackageInstaller` + `UPDATE_PACKAGES_WITHOUT_USER_ACTION`** (Android 12+) | **0 desde la segunda actualización** | **Decidido, va en el próximo APK.** Requiere las cuatro condiciones a la vez: el permiso (nivel `normal`, se concede solo), `targetSdk ≥ 31` (hoy **34** ✅), `setRequireUserAction(USER_ACTION_NOT_REQUIRED)`, y ser **installer of record**. Esa última es el costo: la primera actualización todavía pide confirmar (bootstrap) y deja a `com.launion.app` como installer; de ahí en más, silenciosas. ~80-100 líneas dentro del plugin que ya existe. **Sin servidor, sin tienda, sin cuota, sin factory reset.** ⚠️ VERIFICAR en el A07 (One UI puede endurecerlo; Android 14 agregó *update ownership*) y ⚠️ VERIFICAR el piso de API del parque |
| **Device Owner** | **0 desde la primera** | Sin bootstrap, y permite `setUninstallBlocked()`. Pero cuesta todo lo de 7.2-7.5 |

> ⚠️ **Los tres exigen la MISMA llave de firma.** §2.1 no deja de ser el riesgo #1 del proyecto — al
> contrario, cuanto más automática es la actualización, más caro es perder el keystore.

### 7.5 Rutas de EMM, con costos honestos

| Ruta | Costo | Integración | ¿APK auto-hospedado? | Veredicto |
|---|---|---|---|---|
| **DPC propio** (la app es su propio Device Owner) | **US$0** | ~1-2 días: un `DeviceAdminReceiver`, `device_admin.xml`, el JSON del QR y los llamados a `DevicePolicyManager`. Es el mismo tipo de trabajo que este repo ya hace (7 plugins Java a mano) | ✅ **Sí, sigue con GitHub Releases.** Cero cambios de pipeline | 🟢 **Recomendada** si la respuesta es sí |
| **Android Management API** (Google) | API gratis + Play Console US$25 una vez | 2-4 días | ❌ **No.** Instala **solo** desde managed Google Play → obliga a subir a Play (7.6) | 🔴 Descartar |
| **Intune / Azure AD** (Microsoft) | Licencia por usuario | — | — | 🔴 **Probado y descartado el 07/08/2026** por fricción de la consola. Es lo que reabrió toda esta discusión |
| **Headwind MDM** (open source) | Gratis + VPS ~US$5-10/mes | 2-3 días + **operación permanente** de otro servidor | ✅ Sí | 🟢 **ELEGIDA el 07/08/2026 — ver 7.9.** El costo de operación sigue siendo real: se acepta a cambio de consola propia, código abierto y cero cuota por dispositivo |
| **Samsung KME** | Gratis | Bajo, pero **no es un EMM**: solo fuerza la inscripción en uno | — | 🟡 Complemento, no ruta |
| **Samsung Knox Manage** | ⚠️ ~US$3-4/disp/mes → ~US$400-500/año por 12 (verificar precio vigente) | Bajo | ✅ Sí | 🟠 La única que trae **KSP con licencia Premium**, o sea las listas de sueño de Samsung. La salida si el A07 resulta imposible de domar a mano — pero **medirlo primero** |
| **ManageEngine MDM Plus** | ⚠️ **Free tier hasta 25 dispositivos** (verificar límites vigentes) | Bajo | ✅ Sí | 🟡 **Si quieren consola sin pagar, empezar por acá** |
| **Comerciales** (Scalefusion, Hexnode, Esper, SOTI) | ~US$2-4/disp/mes | Muy bajo | ✅ Sí | 🟠 Cuota perpetua por gestionar 12 teléfonos que están sentados en la misma oficina |

> ⚠️ **Este párrafo cambió de decisión el 07/08/2026.** Lo que sigue explica por qué DPC propio *era*
> la recomendación, y por qué dejó de serlo. **La ruta elegida es Headwind (7.9).**

**El argumento a favor de DPC propio era:** la necesidad real no es *gestionar una flota*, es
*configurar bien una vez* — los 12 equipos están en la misma oficina y los configura la misma persona.
Todas las consolas venden gestión remota continua, que se paga todos los meses. Y es la única ruta que
**no toca el pipeline de release**: `apk-release.sh` + `ota-release.sh` + `app_config` siguen igual.

**Por qué se eligió Headwind igual:** se pidió explícitamente **consola para ver y gestionar los
teléfonos**, y eso es justo lo que el DPC propio no da (riesgo 3 de abajo). Headwind la da gratis, es
Apache 2.0, y **no cobra por dispositivo**. El precio es un servidor propio para siempre.

🩸 **Y hay una consecuencia irreversible que hay que entender antes de inscribir el primer teléfono:
solo puede haber UN Device Owner por dispositivo.** Si Headwind lo ocupa, `com.launion.app` **nunca**
podrá serlo — la ruta "DPC propio" queda cerrada de forma permanente, salvo factory reset. No es una
decisión que se pueda revisar el mes que viene.

**Los tres riesgos, sin maquillar** (siguen valiendo, ahora aplicados a Headwind):

1. 🩸 **Un Device Owner solo se saca con `clearDeviceOwnerApp()` desde el propio DPC, o con factory
   reset.** Si el DPC se rompe o se desinstala mal, el teléfono queda administrado por un fantasma.
   **Con Headwind esto es peor, no mejor**: el DPC es código de un tercero y la salida de emergencia
   depende de que su panel siga vivo y accesible. **Probar el des-enrolamiento en el primer teléfono,
   antes que cualquier otra cosa.**
2. Era **código sin tests en la posición más privilegiada del sistema**. Con Headwind el código no es
   nuestro — cambia el riesgo de "sin tests" a "sin control", que para 12 teléfonos es mejor negocio.
3. **Sin consola no hay política remota**: éste es el riesgo que Headwind cierra, y por eso se eligió.

Si Headwind no rinde en la Fase 0 de 7.9: **ManageEngine free tier** (hasta 25 dispositivos, sin
servidor propio, y ⚠️ es de los pocos que exponen la allowlist de batería vía Knox), y si no alcanza,
Knox Manage.

### 7.6 Managed Google Play: por qué no

| Tema | Realidad |
|---|---|
| **`ACCESS_BACKGROUND_LOCATION` en app privada** | 🟡 La política contempla exención para apps distribuidas solo por managed Google Play. ⚠️ **VERIFICAR en el formulario de declaración de Play Console.** Si no aplica: revisión de permisos, justificación escrita, política de privacidad publicada y **video demostrativo** — lo que §6 ya anticipa. Y hoy los dos documentos de [`legal/`](legal/) están **en borrador y sin publicar** |
| **`SCHEDULE_EXACT_ALARM`** | ✅ No es problema. Play restringe `USE_EXACT_ALARM`, no este. El manifest ya eligió bien |
| 🩸 **`targetSdk`** | ⚠️ **El costo escondido, y probablemente el más caro.** `web/android/app/build.gradle` tiene un `resolutionStrategy` fijando `androidx.work` en 2.9.1 con este comentario: *"El plugin OTA (capgo) arrastra androidx.work 2.10 que exige compileSdk 35. Fijamos una versión compatible con compileSdk 34 para no tener que subir el SDK"*. Publicar en Play desarma esa decisión y arrastra el plugin OTA |
| **Política de privacidad** | Obligatoria sí o sí. Pero ya hace falta igual por el OAuth de Google y por la Ley 25.326 (§6): **esto se paga con o sin Play** |
| **Firma** | Play App Signing implicaría que Google pase a tener la llave. Mejora el backup pero cambia el modelo de confianza de §2.1 — se decide a propósito, no de refilón |

**Solo se justifica si la ruta es AMAPI. Como no lo es, Play no entra.**

### 7.7 La sesión de USB con el primer A07 — checklist

**Regla de oro: se hace sobre UN teléfono, entero, antes de tocar los otros.**

> 🟢 **Las fases 1 a 5 están automatizadas en
> [`scripts/diagnostico-usb.sh`](scripts/diagnostico-usb.sh)** (07/08/2026). **No es destructivo**: solo
> lee, salvo la exención de batería con `--exentar`, que es lo que se quiere poner y es reversible.
> Guarda la salida en un `.txt` por equipo para poder compararlos. Encuentra `adb` solo en el SDK de
> Android. Uso:
>
> ```bash
> bash scripts/diagnostico-usb.sh              # solo lee
> bash scripts/diagnostico-usb.sh --exentar    # además pone la exención de batería
> adb reboot                                   # y después de que arranque:
> bash scripts/diagnostico-usb.sh --post-reboot
> ```
>
> Trae de arranque el gate de la regla 19-bis: si la app está por debajo de **1.8.0**, avisa en rojo
> que **no se puede cambiar de usuario sin actualizar primero** (§4 #4-quater).
>
> 🟢 **Se puede correr HOY, sin resetear nada y sin haber decidido lo del MDM.** De hecho conviene:
> las fases 1-3 son las que contestan si `adb` puede dejar los 9 teléfonos exentos de batería, que
> es la palanca que ni Device Owner ni Headwind resuelven.
>
> **La receta por equipo, en este orden** (el orden importa: así el vendedor no ve un solo diálogo):
>
> 1. Instalar la app — `adb install -r android/app/build/outputs/apk/release/app-release.apk`
> 2. `bash scripts/diagnostico-usb.sh --configurar` — ~30 s
> 3. 🔴 **Abrir la app e iniciar sesión.** No es opcional: ver abajo
>
> 🩸 **El paso 3 no se puede saltear, y el motivo es sutil.** Una app recién instalada que **nunca se
> abrió** queda en estado `stopped`, y una app en `stopped` **no recibe broadcasts** — incluido
> `BOOT_COMPLETED`. O sea que `BootReceiver` y `AlarmReceiver` quedan **inertes**: el arranque al
> horario de 1.11.0 y el watchdog de la regla 44 **no existen** hasta que alguien la abre una vez.
> Es exactamente el mismo agujero que el force-stop, entrando por otra puerta. Detectado el 07/08 en
> el segundo A07 (`notLaunched=true`); el script ahora lo avisa en rojo.
>
> ⚠️ **El parque tiene Android mixto**, aun siendo todos SM-A075M: el primer equipo vino con
> **Android 16 / One UI 8.0.5** y el segundo con **Android 15 / One UI 7.0** (parche de seguridad un
> año más viejo). Es la prueba concreta de lo que dice 7.8: **el eje útil es el API level, no el
> modelo** — "unificar el parque a un modelo" no unifica el comportamiento.

§3.2 y la regla 43 dicen que el emulador no sirve para nada de `UploaderGpsService` (sin Doze, sin GPS
real, sin killers de OEM) y que "se verifica en la calle y no hay atajo". **Sigue siendo cierto — y
este aparato es lo que faltaba.**

**Fase 0 — decisión previa (bloqueante).** Si la respuesta de 7.2 es "sí", el orden de arranque
cambia y no se puede deshacer sin reset.

**Fase 1 — identidad y línea de base (5 min).**

```bash
adb shell getprop ro.product.manufacturer     # samsung
adb shell getprop ro.product.model            # SM-A07xx  ← el dato que hoy NO se guarda
adb shell getprop ro.build.version.sdk        # API level
adb shell getprop ro.build.version.release
adb shell getprop ro.build.display.id         # build de One UI + parche de seguridad
adb shell settings get global device_provisioned   # 0 = todavía se puede dpm set-device-owner
adb shell dumpsys package com.launion.app | grep -iE "versionName|installerPackageName"
```

> 🩸 **Anotar `ro.product.model` a mano acá.** Es el valor que va a poblar la columna nueva del
> pendiente #7 y el único que permite cruzar los síntomas de `db/29`/`db/30` contra un teléfono.

**Fase 2 — permisos y app-ops (5 min).** Repetir **antes y después** del provisioning.

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell dumpsys package com.launion.app | grep -A40 "runtime permissions"
adb shell cmd appops get com.launion.app
```

⚠️ **La prueba de 7.3 es que `ACCESS_BACKGROUND_LOCATION` figure `granted` sin que nadie haya entrado
a Ajustes.**

**Fase 3 — la palanca de batería, medida en vez de supuesta (10 min).**

```bash
adb shell dumpsys deviceidle whitelist | grep -i launion
adb shell dumpsys deviceidle whitelist +com.launion.app
adb reboot && adb wait-for-device
adb shell dumpsys deviceidle whitelist | grep -i launion   # ⚠️ ¿SOBREVIVIÓ al reboot?
adb shell cmd appops set com.launion.app SCHEDULE_EXACT_ALARM allow
adb shell am get-standby-bucket com.launion.app
```

⚠️ **Si sobrevive, la sesión de USB puede dejar los 12 teléfonos exentos sin depender de que el
vendedor toque un diálogo — y eso, solo, vale más que todo Android Enterprise**, porque es la palanca
del arranque *y* de la alarma exacta.

**Fase 4 — Samsung: encontrar la pantalla real (10 min).**

```bash
adb shell pm list packages | grep -iE "lool|android.sm|spm"
adb shell dumpsys package com.samsung.android.lool | grep -i "Activity"
```

Objetivo: el componente de **Batería → Límites de uso en segundo plano → Apps que nunca entran en
suspensión**. Es el reemplazo correcto de "agregar Samsung al array de autostart" (7.8).

**Fase 5 — 🔴 verificar el arreglo de 1.11.0 sin esperar a mañana.**

> ⚠️ **Mover la VENTANA, nunca el reloj.** Cambiar la hora del teléfono rompe la validación de los JWT
> de Supabase y el TLS: se rompe justo todo lo que hay que observar.

1. En Supabase, poner `categorias_rastreo.hora_inicio` del usuario de prueba en **ahora + 8 min**.
2. **Abrir la app** — obligatorio: las prefs de la ventana solo las escribe `configurar()` con la app
   viva (es el pendiente 4-ter, y acá muerde de entrada).
3. Confirmar el armado **antes de esperar nada**, con dos fuentes independientes:
   ```bash
   adb shell dumpsys alarm | grep -B5 -A20 launion
   ```
   y en la base: `select alarma_proxima_ts, alarma_exacta, bateria_exenta, fgs_bloqueado from
   estado_dispositivo where id_usuario = …`. **`db/30` se escribió exactamente para esto.**
4. Reproducir el caso peor (bucket `rare` + Doze + app cerrada):
   ```bash
   adb shell am set-standby-bucket com.launion.app rare
   adb shell dumpsys battery unplug        # sin esto NUNCA entra en Doze
   adb shell dumpsys deviceidle force-idle
   adb shell dumpsys deviceidle step       # repetir hasta IDLE
   ```
5. Esperar y verificar:
   ```bash
   adb shell dumpsys activity services com.launion.app   # fg=true, type=location
   adb logcat -d | grep -iE "ForegroundServiceStartNotAllowed|AlarmManager"
   adb shell dumpsys battery reset                       # ⚠️ restaurar SIEMPRE
   adb shell dumpsys deviceidle unforce
   ```
   El veredicto real es un `select`: ¿entraron posiciones a la hora del borde? ¿subió `fgs_bloqueado`?

> 🩸 **Correr el test DOS veces: una sin `force-stop` y otra con.** El force-stop cancela las alarmas
> y deja la app en estado *stopped*. Eso no es un defecto del test: es **la medición más informativa
> de toda la sesión.** Si con force-stop no arranca nunca, acabás de medir con precisión **lo único
> que Device Owner arregla**, y esa medición es la que debería decidir 7.3.

**Fase 6 — arranque en frío por reboot**, sin abrir la app: `adb shell dumpsys alarm | grep -A20
launion` y `alarma_proxima_ts` de nuevo poblado en la base.

**Fase 7 — GPS, wakelock y batería.**

```bash
adb shell dumpsys batterystats --reset
# ... jornada simulada / caminata real de 1-2 h ...
adb shell dumpsys location | grep -A30 -i "fused"      # cadencia PEDIDA vs. gpsConfig
adb shell dumpsys power | grep -i -A10 wake            # el PARTIAL_WAKE_LOCK de la regla 42
adb shell dumpsys batterystats --charged com.launion.app
```

`web/src/services/gpsConfig.js` dice textualmente *"cuánto cuesta en batería hay que medirlo en un
teléfono real"*. **Esta es esa oportunidad y no vuelve.** El número que salga es el que permite
decidir si `NEAR_LIVE_MS` puede volver a bajar de 10 s — decisión que ya se tomó y se revirtió dos
veces a ciegas.

**Fase 8 — el experimento de la actualización silenciosa (7.4).**

```bash
adb shell dumpsys package com.launion.app | grep -i installerPackageName
```

Si dice `com.google.android.packageinstaller`, confirma que hoy el installer of record **no** es la
app. Después de la primera actualización hecha con `PackageInstaller`, tiene que decir
`com.launion.app`.

> ⚠️ **Dos límites de la sesión.**
>
> 1. **No hay una sola línea de `Log.*` en los 15 `.java`.** `logcat` no va a mostrar nada de los
>    plugins: solo tags del sistema (`ActivityManager`, `AlarmManager`, `LocationManagerService`, la
>    excepción de FGS). Si se quiere trazabilidad real, agregar unos `Log.w` **antes** de compilar el
>    APK que se lleva al teléfono. Es barato y cambia por completo lo que se puede ver.
> 2. **Las SharedPreferences no se leen por `adb` en un build release** — `run-as` solo funciona sobre
>    builds debuggables. El build `debug` usa `applicationIdSuffix ".debug"`, así que **se puede
>    instalar al lado** y leer sus prefs, pero es otro paquete: otra sesión de Supabase, otro registro
>    FCM, y **no comparte estado** con el release.
> 3. **`dumpsys deviceidle` prueba el Doze de AOSP, no el power manager de Samsung.** Las "Deep
>    sleeping apps" son de One UI y no se ven ahí. Eso solo se prueba dejando el teléfono quieto
>    varios días. No hay atajo: sigue valiendo el techo de §3.2, ahora sobre hardware real.

#### 🟢 La configuración por cable es permanente (08/08/2026, medido)

Las dos dudas que quedaban sobre la sesión USB están cerradas, sobre hardware real y no por deducción:

| Evento | Qué se midió | Resultado |
|---|---|---|
| **Reinicio** (SM-A075M `R8ML200TWMW`) | exención de batería, bucket, 4 permisos, alarma exacta | ✅ **todo intacto** |
| **Actualización mayor de sistema** — Android 15 / One UI 7 → **Android 16 / One UI 8.0.5** (SM-A075M `R8ML2008BLP`) | lo mismo | ✅ **todo intacto** |
| **Salto de DOS versiones mayores** — Android 14 / One UI 6.1 → **Android 16 / One UI 8.0** (SM-A065M `R8MY402185J`) | lo mismo | ✅ **todo intacto** |

**Consecuencia: el cable se pasa UNA vez por teléfono.** No hay mantenimiento periódico, y una actualización de One UI no obliga a rehacer nada. Esto es lo que vuelve viable configurar los 9 en una sola sesión.

> ⚠️ **Lo único que NO sobrevive es `adb tcpip` (ver más abajo).** No confundir: la configuración de
> la app es permanente; el puerto de depuración por red no.

#### 🩸 Configurar el teléfono NO lo pone a rastrear (08/08/2026, medido)

El error más caro del día, y el más fácil de repetir. Los 9 quedaron con exención de batería, bucket
5, los 4 permisos y alarma exacta — **y 6 de 9 no habían capturado un solo punto en su vida.**

Los tres que sí rastreaban eran los tres donde, además de configurar por cable, se **abrió la app, se
inició sesión y se completó la pantalla de permisos de GPS**. La diferencia se ve en una línea:

```bash
adb -s <ip>:5555 shell dumpsys activity services com.launion.app | grep -c ServiceRecord
# 0 = el uploader NUNCA arrancó → cero puntos, por más configurado que esté el equipo
```

**Por qué:** el uploader nativo necesita el **token de dispositivo**, que la app obtiene recién al
completar el gate de GPS. Sin token, `AlarmReceiver` despierta cada 30 min, no ve token y no arranca
nada (regla 19-bis: sin `K_TOKEN` no se resucita el servicio). El síntoma engaña porque **las alarmas
sí se reprograman puntualmente** — el teléfono se ve sano por todos lados menos el que importa.

> **Verificación real de que un teléfono quedó listo: puntos en `posiciones`, no configuración en
> `dumpsys`.** El `select` de abajo es el único veredicto que vale.

```sql
select p.nombre, count(po.id) as puntos_hoy, max(po.ts) as ultimo
from public.perfiles p
left join public.posiciones po on po.id_usuario = p.id
  and po.ts >= timestamp '<hoy> 00:00' at time zone 'America/Argentina/Buenos_Aires'
where p.id_empresa = '<empresa>' group by p.nombre order by puntos_hoy;
```

🟢 **De paso, el arranque de 1.11.0 quedó validado en la calle:** los tres teléfonos que rastreaban
pusieron su primer punto del día a las **08:00:01, 08:00:01 y 08:00:02**, contra la mediana de
**51 minutos** de retraso medida sobre 29 días hábiles antes del arreglo.

#### 🩸 Dos formas de que `adb` no vea un teléfono que está enchufado

Antes de perder tiempo, mirar **qué interfaces expone** el equipo en Windows:

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -like "USB\VID_04E8&PID_6860*" } |
  Select-Object Status, FriendlyName, InstanceId | Format-Table -AutoSize
```

| Síntoma | Causa | Fix |
|---|---|---|
| **Falta `MI_03`** (solo aparecen `MI_00` multimedia y `MI_01` serie) | 🟢 **casi siempre: la pantalla del teléfono está BLOQUEADA.** Samsung no expone el ADB con el equipo bloqueado. Si desbloqueado sigue faltando, ahí sí es Depuración USB apagada — One UI la desactiva sola tras una actualización mayor | desbloquear el teléfono; si no, reactivar Opciones de desarrollador |
| **`MI_03` presente y en estado OK, pero `adb devices` vacío** | el registro de Windows tiene el descriptor cacheado en vacío (ver abajo) | `scripts/fix-adb-interface.ps1` como administrador |

Los dos dan el mismo `adb devices` vacío y se parecen mucho. La consulta de arriba los separa en un segundo.

#### 🩸 El teléfono que Windows ve y `adb` no (07/08/2026, medido)

Ocho de los nueve equipos entraron sin fricción. El noveno (SM-A065M, serial `R8MY5027YQT`) **nunca
mostró el cartel de "¿Permitir depuración USB?"**, y `adb devices` salía vacío — ni siquiera
`unauthorized`. Se perdió cerca de una hora atacando el teléfono. **El teléfono no tenía nada.**

Lo que descarta el síntoma, y no hay que volver a probar:

| Se probó | Resultado |
|---|---|
| Depuración USB on/off, revocar autorizaciones, modo *Transferir archivos* | sin efecto |
| Reiniciar el teléfono, cambiar el cable, cambiar de puerto | sin efecto |
| Bloqueo automático (Auto Blocker) de One UI | ya estaba apagado |
| `adb kill-server` / `start-server`, backend `ADB_LIBUSB=1` | sin efecto |
| Otro `adb` peleando por el puerto 5037 | no había: un solo proceso |
| Driver equivocado | ❌ **falsa pista**: los 9 usan el mismo `winusb.inf` genérico |

**La causa está en el registro de Windows, no en Android.** Windows le pide al dispositivo el
descriptor *MS OS Extended Properties* para saber qué interfaz publicar. Este teléfono lo respondió
vacío —casi seguro porque la primera conexión ocurrió mientras corría su actualización de sistema y
`adbd` todavía no había levantado—, y Windows **cachea el fracaso** con `ExtPropDescSemaphore = 1` y
no vuelve a preguntar nunca. WinUSB carga igual, pero la interfaz `MI_03` no publica ninguna clase, y
`adb` no tiene nada que abrir.

El diagnóstico es de una sola consulta, y es binario. Un equipo sano publica **dos** clases de
interfaz; el trabado no publica ninguna:

```powershell
# {dee824ef-...} = WinUSB genérica · {f72fe0d4-...} = la de ADB
Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceClasses" | ForEach-Object {
  $c = $_.PSChildName
  Get-ChildItem $_.PSPath -EA SilentlyContinue |
    Where-Object { $_.PSChildName -match "VID_04E8&PID_6860&MI_03" } |
    ForEach-Object { "$c  $($_.PSChildName)" }
}
```

**Fix:** `scripts/fix-adb-interface.ps1`, **como administrador**, con el teléfono conectado. Borra la
marca cacheada y desinstala el nodo con `pnputil /remove-device` para forzar la re-enumeración; al
reconectar el cable, Windows vuelve a preguntar y el cartel sale. Es reversible y no toca el teléfono
ni otros dispositivos: sólo apunta a nodos ADB de Samsung **presentes** que no publican interfaz.

> **Regla práctica:** si Windows muestra "ADB Interface" en estado OK y `adb devices` sale vacío,
> dejar de tocar el teléfono y mirar `DeviceClasses`. Todo lo que se hace del lado de Android es
> inútil, porque Windows ya decidió y no está preguntando de nuevo.

### 7.8 "Ir agregando características de ciertos modelos al plugin" — el reencuadre

**La idea es correcta en el diagnóstico y equivocada en el eje.**

**Lo que es correcto:** falta un registro de quirks, y sobre todo falta la **precondición**. Hoy no se
guarda marca, modelo ni versión de Android en ningún lado (cero `Build.MANUFACTURER`/`MODEL`/`BRAND`
en todo `web/android/`, ninguna columna en `estado_dispositivo`). Se mide el **síntoma** del OEM agresivo
—`fgs_bloqueado`, `bateria_exenta`, `gps_silencio_max_ms`— y **nunca la identidad del OEM**. Por eso
"los OEM agresivos" es folklore del proyecto y no un `select`.

**El contraejemplo está adentro del repo.** `BatteryOptimizationPlugin.abrirAutostart()` es
exactamente esta idea aplicada durante un año: **9 componentes de OEM probados por fuerza bruta**, que
devuelven `{abierto:bool}` sin verificar nada, y **sin un solo dato en la base que diga si alguno
matcheó alguna vez en un teléfono real**. Y ninguno es Samsung.

**La corrección de eje: ramificar por API level sí, por modelo casi nunca.** Aun con parque 100 % A07,
`Build.VERSION.SDK_INT` sigue siendo legítimo — el código ya ramifica por él en cuatro lugares
(`ApkUpdaterPlugin`, `BatteryOptimizationPlugin`, `AlarmWatchdogPlugin.puedeExacta`, `AlarmReceiver`).
Un modelo ≠ un API level: el A07 va a recibir actualizaciones de OS, y en dos años la "flota
unificada" va a tener tres versiones de Android conviviendo. Y la flota **no se unifica de golpe**:
va a haber un período mixto que hoy `estado_dispositivo` ni siquiera puede contar.

**La forma correcta, en tres pasos y en ese orden:**

1. **El dato primero** (pendiente #7): `marca`, `modelo`, `android_release`, `android_sdk`. Eso
   convierte todas las columnas de síntoma que ya existen en algo **agrupable por identidad de OEM**.
2. **El registro de quirks es una TABLA de documentación, no un `if`**: modelo/versión, síntoma
   medido, cómo se midió, qué lo mitigó, y si sigue vigente. Cero código.
3. **Si alguna vez hace falta un umbral distinto por modelo, NO va como rama en Java.** La regla 22-ter
   es explícita: `gpsConfig.js` es la única fuente y los umbrales viajan por SharedPreferences → se
   afinan por OTA. La forma que respeta eso es una tabla de overrides en la base, resuelta en JS y
   empujada por el mismo canal de prefs. Un `if (Build.MODEL.equals(...))` adentro de
   `UploaderGpsService` sería una **segunda** fuente de umbrales — el bug exacto que la regla 22-ter
   existe para prevenir — y encima solo cambiable por APK.

> ⚠️ **No construir el paso 3 ahora.** Es YAGNI hasta que el paso 1 produzca un `group by marca` con
> una diferencia medida. Escribir el mecanismo antes que el dato es la misma idea otra vez, con mejor
> arquitectura.

**Donde la idea sí tiene razón y conviene rescatarlo:** la app hoy es ciega a la marca en la UI, y eso
ya produce copy incorrecto. `PermisoSiemprePrompt.jsx` le dice a **todos** *"En Xiaomi, Huawei y
similares, activá Inicio automático"* — y eso va a ser **falso para el 100 % del parque nuevo**. La
solución no es acumular componentes de OEM: es **saber la marca y decir la verdad**. Que es, otra vez,
el paso 1.

### 7.9 Headwind MDM self-hosted — la decisión y el orden

**Decidido el 07/08/2026: Headwind MDM, self-hosted.** Lo que sigue es *dónde* va el servidor y *en
qué orden* se hacen las cosas — y esa parte importa más que la elección de herramienta, porque una de
las tres opciones que estaban sobre la mesa destruye datos.

#### Lo que se verificó (07/08/2026, documentación oficial)

| Hecho | Fuente |
|---|---|
| Servidor = **Ubuntu 18.04-24.04 (22.04 recomendado) + Tomcat 9 + PostgreSQL**. **Sin soporte Windows** | [advanced-web-panel-installation](https://h-mdm.com/advanced-web-panel-installation/) |
| La imagen Docker es Ubuntu 22.04 + Tomcat 9, exige **PostgreSQL externo** y pide `BASE_DOMAIN` | [hmdm-docker](https://github.com/h-mdm/hmdm-docker) |
| 🩸 **HTTPS NO funciona con certificados autofirmados.** Exige dominio real + certbot | [advanced-web-panel-installation](https://h-mdm.com/advanced-web-panel-installation/) |
| HTTP plano **sí** funciona en red interna contra la IP del server. Pierde el control remoto | [private-network](https://h-mdm.com/private-network/) |
| ✅ **Instalación silenciosa de apps: está en la versión Community** (gratis). Kiosco también. Sin límite de dispositivos declarado | [version-comparison](https://h-mdm.com/headwind-mdm-version-comparison/) |
| Los APK se **suben al panel**. No instala desde una URL externa ni desde Google Play | [quick-start](https://h-mdm.com/quick-start/) |
| El cliente (`com.hmdm.launcher`) **reemplaza la pantalla de inicio** | [quick-start](https://h-mdm.com/quick-start/) · [F-Droid](https://f-droid.org/packages/com.hmdm.launcher/) |
| Licencia Apache 2.0 | [hmdm-server](https://github.com/h-mdm/hmdm-server) |

#### 🩸 Por qué el servidor NO va en una PC

Se evaluó levantarlo en la PC de desarrollo y **rehacerlo en un mes**, cuando se migre a la máquina
nueva (§2), pidiendo los teléfonos de vuelta. **Es la peor de las opciones**, y no por comodidad:

1. **Los A07 todavía no llegaron.** No hay nada que inscribir hoy, y lo único que se puede verificar
   de un MDM es un teléfono inscripto. El mes de "dejarlo listo" no produce nada comprobable.
2. 🩸 **La ventana de provisioning es de un solo uso.** 7.2 ya lo dice: Device Owner exige el equipo
   **sin ninguna cuenta**. Inscribir los 12 contra una IP de LAN temporal y re-inscribirlos en un mes
   significa **factory reset de los 12** — y eso borra la cola de posiciones, la cuarentena y la
   sesión de cada uno (regla 20, §2.1). Media jornada y pérdida de datos para llegar al mismo lugar.
3. **Un servidor en LAN no ve vendedores en la calle.** Se comunican por datos móviles: una
   `192.168.x.x` es inalcanzable. El panel los vería solo cuando pasen por la oficina.
4. **No hace falta migrar de PC para romperlo.** La IP la da el DHCP y cambia sola.

> **La migración de PC no hay que planificarla: hay que hacerla desaparecer.** El problema existe solo
> porque el servidor viviría en una máquina que se mueve. En un VPS, migrar la PC de desarrollo deja
> de tocar a los teléfonos — y de paso el servidor queda accesible desde la calle, que es donde están.

#### Las tres fases, en este orden

> 🔴 **El orden manda, y desde el 07/08 hay fecha:** se van a resetear los 9 equipos para pasarlos a
> empleados nuevos. **Ese reset es la única ventana de provisioning que va a haber**, así que el
> servidor tiene que estar arriba y probado ANTES de que se resetee el primero. Si el recambio de
> personal llega antes que el servidor, se resetea igual y se pierde Device Owner para siempre —
> en ese caso, mejor asumirlo de entrada y quedarse con `PackageInstaller` (7.4) que improvisar.

**Fase 0 — Laboratorio en la PC actual (ahora, descartable).** El instinto de "dejarlo listo" es
correcto; lo que cambia es *qué* se deja listo. Se levanta Headwind acá **para aprender el panel y
medir tres cosas**, no para producción.

🔴 **Regla que no se rompe: en este servidor NO se inscribe ni un A07, ni ninguno de los 9 teléfonos
que están hoy en la calle.** Tiene que ser un equipo **realmente descartable**, porque inscribirlo lo
deja con Headwind de Device Owner y sacárselo es **factory reset** — o sea que en un teléfono de
producción cuesta la cola de posiciones, la cuarentena y la sesión (regla 20). Sin un equipo así
disponible, **la Fase 0 se salta entera**: el emulador no sirve (regla 43 y §3.2), y probar sobre uno
de los 9 sale más caro que no probar.

1. `wsl --install -d Ubuntu-22.04` — **22.04 y no 24.04**: el instalador quiere `tomcat9`, que 24.04
   ya no empaqueta.
2. En `%USERPROFILE%\.wslconfig`, `networkingMode=mirrored`. WSL comparte la IP del host y **evita
   todo el `netsh interface portproxy`**, que además habría que rehacer en cada reinicio porque la IP
   interna de WSL2 cambia sola.
3. `hmdm_install.sh` con `PROTOCOL=http` y la IP LAN de la PC. Sin dominio ni certificado: para un
   laboratorio alcanza, y es lo que la doc de red privada contempla.
4. Regla de firewall de Windows para el puerto del panel, **solo en el perfil de red privada**.
5. Subir el `app-release.apk` ya publicado y medir:
   - ¿se instala **sin que nadie toque nada**?
   - ¿se **actualiza** sola al subir una versión mayor?
   - ⚠️ ¿el panel expone algo para **bloquear el force-stop** de `com.launion.app`? **Es la capacidad
     más valiosa (7.3) y no está documentada en ningún lado.** Hay que verla en el panel, no
     creerle a nadie — ni a este documento.

> **Criterio de salida:** si las dos primeras dan ✅, Headwind sirve y se pasa a la Fase 1. Si no, se
> abandona y queda `PackageInstaller` (7.4), que ya estaba decidido y no necesita servidor.

**Fase 1 — El servidor definitivo, ANTES de que lleguen las cajas.**

- **VPS** ~US$5-10/mes. ⚠️ Evaluar Oracle Cloud Always Free ARM — Java/Tomcat corre en ARM64, pero
  **verificar**, no está confirmado.
- **Dominio propio** apuntando ahí (sirve un subdominio gratis de DuckDNS). Lo que importa es que
  **sea un nombre y no una IP**, para que el servidor se pueda mudar sin tocar un solo teléfono.
- **HTTPS con certbot.** No es opcional: sin él no hay control remoto, y un panel MDM en HTTP plano
  sobre internet no se sostiene.
- Endurecimiento mínimo: firewall, contraseña de admin cambiada, backup de PostgreSQL. 🔴 **Un panel
  MDM expuesto a internet controla 12 teléfonos de empleados: es un objetivo de compromiso total, no
  una web más.** Otra razón para que viva en un VPS con firewall y no detrás del router de una casa.

**Fase 2 — El día de las cajas.** Ya está escrito en 7.2 (orden de desprecintado) y 7.7 (las 8 fases
de la sesión USB). No se reescribe. Solo se agrega que la inscripción va **contra el dominio
definitivo**, y que **la sesión USB con `adb` se hace igual**, porque hay tres cosas que Headwind no
da y solo el cable resuelve: la exención de batería, la medición de `batterystats` (Fase 7) y la
verificación del arranque de 1.11.0 sin esperar al día siguiente (Fase 5).

#### Los cuatro costos, sin maquillar

1. 🩸 **No resuelve la exención de batería.** Igual que cualquier Device Owner: **no existe API
   pública de `DevicePolicyManager` para la allowlist de Doze.** (⚠️ Circula por internet un supuesto
   `setIgnoreBatteryOptimizations()` de `DevicePolicyManager` — **no existe** en el SDK público; la
   fuente es contenido generado, no documentación. No construir nada sobre eso.) Quien sí la expone es
   **Knox vía OEMConfig**, exactamente lo que ya decía 7.3. **La cadena del arranque al horario sigue
   colgando del diálogo manual, con Headwind o sin él.**
2. 🩸 **Un solo DPC por dispositivo** → `com.launion.app` no podrá ser Device Owner nunca. Ver el
   recuadro de 7.5. Y el bloqueo del force-stop —lo único que solo DO compra— queda dependiendo de
   que el panel de Headwind lo exponga. ⚠️ **Sin verificar. Es lo primero que hay que mirar.**
3. **Un cuarto canal de despliegue.** Hoy son tres (PWA · OTA · APK) y §1 ya advierte que se
   desincronizan. El panel de Headwind agrega un cuarto lugar donde la versión puede quedar vieja, en
   paralelo a `min_version`. **Decidir explícitamente quién manda** — propuesta: `apk-release.sh`
   sigue siendo la fuente de verdad y el panel es un espejo, **nunca al revés**.
4. **Reemplaza la pantalla de inicio.** El teléfono deja de verse como un Samsung. Para equipos de la
   empresa puede ser hasta deseable, pero es un cambio visible: **avisarlo antes, no después.**

### 7.10 Qué hacer antes de que lleguen

| # | Cambio | Canal | Esfuerzo | Nota |
|---|---|---|---|---|
| 1 | 🔴 **Registrar marca/modelo/API level en `estado_dispositivo`** | **OTA** | S | La precondición de todo lo demás. Se puede empezar **hoy, sin APK**: el WebView pone modelo y versión en `navigator.userAgent` (`Linux; Android 15; SM-A075F`) y `web/capacitor.config.ts` **no** pisa el UA (verificado). Se parsea en JS, se agrega al objeto `identidad` de `useEstadoDispositivo.js` (que ya omite todo en web, criterio correcto) + `db/31`. **Empieza a recolectar sobre los 9 teléfonos actuales**, lo que hace legible retroactivamente todo `db/29`/`db/30`. Después, en el próximo APK, sustituir el UA por `Build.*` reales vía `InfoAppPlugin`, sin tocar el esquema. ⚠️ **NO instalar `@capacitor/device` para esto**: sería una dep nueva y un APK obligatorio por un dato que el UA ya da |
| 2 | 🔴 **Corregir el copy de `PermisoSiemprePrompt.jsx`** | **OTA** | XS | Hoy dice "En Xiaomi, Huawei y similares" y va a ser falso para todo el parque nuevo. El cambio más barato del documento y el único que le habla al usuario final |
| 3 | 🟠 **`PackageInstaller` + `UPDATE_PACKAGES_WITHOUT_USER_ACTION`** | APK | M | **Decidido** (7.4). De 3-4 toques a cero. Reemplaza `lanzarInstalador` en `ApkUpdaterPlugin.java:121-130`. ⚠️ Verificar en el A07 con la Fase 8 antes de invertir. 🟢 Device Owner lo vuelve redundante → decidir 7.2 primero |
| 4 | 🟡 **Unos `Log.w` de diagnóstico** en `AlarmReceiver` / `UploaderGpsService` | APK | XS | Habilita la Fase 5. Hoy `logcat` no dice nada de la app. Va en el mismo APK que #3 |
| 5 | 🟡 **Rama Samsung en `abrirAutostart`** | APK | S | **Pero NO como una fila más del array**: Samsung no tiene lista de autostart. Rutear a la pantalla de suspensión de One UI, con el componente **verificado en la Fase 4**. Hacerlo **después** de tener el teléfono, no antes |
| 6 | 🟡 **`isDeviceOwnerApp()` → columna `administrado`** | APK | XS | Solo si 7.2 da "sí". Permite ver con un `select` cuáles quedaron bien provisionados |
| 7 | ⚪ **Overrides de umbrales por modelo** | — | — | ❌ **NO construir.** Ver 7.8, paso 3 |
| 8 | 🔴 **Laboratorio de Headwind (Fase 0)** | — | M | **Va primero de todo, y antes de gastar un peso.** WSL2 + Ubuntu 22.04, contra un teléfono viejo. Mide tres cosas (7.9): instala solo · actualiza solo · ⚠️ ¿bloquea el force-stop? Si las dos primeras fallan, se abandona Headwind y queda #3 |
| 9 | 🟠 **VPS + dominio + certbot** | — | S | Solo **después** de que la Fase 0 dé ✅, y **antes** de que lleguen las cajas. Nunca en una PC: ver el bloque 🩸 de 7.9. El dominio es lo que hace que el servidor se pueda mudar sin tocar los teléfonos |
| 10 | 🟠 **Decidir quién manda: `min_version` o el panel** | — | XS | Headwind sería el **cuarto** canal de despliegue. Propuesta: `apk-release.sh` es la fuente de verdad y el panel un espejo, **nunca al revés**. Escribirlo como regla en `CLAUDE.md` el día que el panel entre en producción |

**Lo que Device Owner volvería innecesario** (solo para los A07; hay que conservarlo mientras el parque
sea mixto): el baile de `canRequestPackageInstalls`, el pedido de "Permitir siempre" y el de
notificaciones. **Lo que NO**: el pedido de exención de batería, la alarma exacta y las listas de
sueño de Samsung. `PermisoSiemprePrompt` no desaparece — **se encoge a un solo botón, el de batería,
que es justamente el que importa.**

---

## 8. Las deudas de fondo

No son tareas: son decisiones pendientes.

- **`AdminView` está muerto** y arrastra 511 líneas de vistas que nadie ejecuta. Decisión de producto,
  no de datos (los datos de las tres están vivos).
- **El módulo de pedidos está a mitad de camino desde el principio.** `pedidos`, `pedido_items`, el
  bucket `firmas` y `RepartidorView` (320 L) existen, tienen RLS y **0 filas**. Hay que arrancarlo o
  retirarlo. Nota: `firmas_ins` sigue siendo `to authenticated` sin alcance de empresa — hoy no muerde
  porque nadie firma nada, pero cuando arranque hay que darle el mismo tratamiento que a `db/25`.
- **Las dos supervisiones están duplicadas** y ya divergieron dos veces (los carteles de parada
  existieron solo en Movil durante versiones; el arreglo de performance del 26/07 tardó dos días en
  llegar a Desktop porque era una copia).
- **OSRM público en camino crítico**, y ahora con dos hosts y tres perfiles: la dependencia de servicios
  gratuitos sin SLA **creció** en vez de bajar.
- ⚠️ **El parque corre Android 16 (API 36) y el proyecto compila contra `targetSdk 34`.** Verificado
  el 07/08 en un SM-A075M. No está roto —Android mantiene compatibilidad hacia atrás— pero la brecha
  es de **dos versiones mayores** y sigue creciendo: cada release nueva de Android aplica los
  *behavior changes* de `targetSdk 35` y `36` como opt-in que este proyecto no tomó. Subirlo está
  bloqueado por una decisión deliberada: `web/android/app/build.gradle` fija `androidx.work` en 2.9.1
  porque el plugin OTA de Capgo arrastra 2.10, que exige `compileSdk 35`. **Desatar ese nudo es
  trabajo real y conviene planificarlo antes de que lo fuerce un bug en la calle.**
- **Cero tests, cero lint efectivo.** Cada release se verifica a mano o en la calle.
- **Las tres fallas más caras del último mes no se pueden reproducir en el emulador** (multi-cuenta del
  uploader, canales de notificación, cadencia no entregada). Se verifican en la calle con consultas
  contra la base. Es una limitación real del proyecto, no algo que se arregle con más herramientas.

---

## 9. Si sos una sesión nueva en la máquina nueva

0. **Antes que nada: la sección 🔵 del 27-28/08**, justo debajo de §1. Hay trabajo implementado y
   verificado **sin publicar**, y una cola de escritura que estuvo taponada dos días en producción.
   Los pendientes concretos son **N1 a N6** al principio de §4.
1. Leé **[CLAUDE.md](CLAUDE.md) entero** — son 52 reglas y **cada una costó un bug de producción**.
   Las dos más nuevas: la **52** (un precio se pregunta en un solo lugar) y el refuerzo de la **19/20**
   (una cola FIFO no puede cortar ante un error permanente — le pasó a la de posiciones en julio y a
   la de escritura en agosto).
2. Para el estado de la base: **consultá la base viva por el MCP de Supabase**, nunca los `db/*.sql`
   (son el registro de migraciones ya aplicadas, no la fuente de verdad; y `db/historico/` tiene
   políticas **inseguras** que reabren agujeros si se re-ejecutan).
3. Para saber qué es cada archivo: [ESTRUCTURA_PROYECTO.md](ESTRUCTURA_PROYECTO.md).
4. Para arquitectura y deuda: [INFORME_AUDITORIA.md](INFORME_AUDITORIA.md).
5. **Los comentarios largos con fechas y números de bug no son ruido: son la memoria del proyecto.** Si
   refactorizás el código que explican, migrá el comentario.
6. La memoria de Claude de la máquina vieja **no viaja**. Todo lo que hacía falta recordar está en estos
   cuatro documentos; si descubrís algo que no está, escribilo acá.
