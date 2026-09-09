# Revisión del envío automático de precios — 09/09/2026

Medido contra el endpoint real y la base viva. Continúa [REVISION_ARTIK.md](REVISION_ARTIK.md)
(28/08), que revisó el primer archivo; esto revisa **el envío andando**, ocho días después.

---

## 1. Lo primero: no es un servidor Java

Lo que quedó instalado es el paquete **PowerShell + Tarea Programada de Windows** de
[GUIA_ENVIO_AUTOMATICO_PRECIOS.md](GUIA_ENVIO_AUTOMATICO_PRECIOS.md) (`INSTALAR.bat`, corriendo como
`SYSTEM`). El `EnviarPrecios.java` era la alternativa opcional de la guía y **no se usó**: el
`User-Agent` de todos los envíos reales dice `WindowsPowerShell/5.1`.

No cambia nada de lo que hay que hacer, pero conviene saberlo antes de ir a buscar un servicio Java
que no existe.

## 2. Está funcionando

| | |
|---|---|
| Ingestas registradas | **139** desde el 31/08 |
| Cadencia | cada hora, al minuto **:00** |
| Errores registrados | 0 |
| Última carga con cambios | **08/09 23:00** — 11 creados, 76 actualizados, 20 dados de baja, 541 → 547 productos |

El formato ya está bien: encabezados presentes, separador `;`, decimales con punto, códigos con los
ceros de adelante, UTF-8 con BOM. Todo eso se corrigió después de la revisión del 28/08 y anda.

---

## 3. 🔴 Hay DOS máquinas enviando, con el mismo token

Es el hallazgo principal, y no se veía desde la base: salió de los registros de la CDN.

| | Origen | Qué manda | Resultado |
|---|---|---|---|
| **A** | Starlink / Claro · PowerShell 5.1.26100 | 41.808 → **49.492 bytes** (el catálogo entero) | ✅ **200**, cada hora |
| **B** | **Las Lajitas** · Telecom Personal | **1.563 bytes**, siempre los mismos | ❌ **400**, cada hora |

Las dos usan el token `5d4a8068-…`, el único emitido.

**Qué pasó, según las marcas de tiempo:** el primer rechazo de 1.563 bytes salió el **08/09 a las
20:41 desde la IP de la máquina A**, y a partir de las 23:18 los rechazos vienen de Las Lajitas. O
sea que el paquete se probó en una máquina y se copió a la otra, y la copia quedó agendada apuntando
a un archivo que no sirve.

1.563 bytes son unas 17-20 filas: casi seguro **el archivo de prueba de 20 filas** del paso 1 de la
puesta en marcha, que quedó como archivo de producción.

### Por qué importa aunque hoy no rompa nada

Hoy no hace daño porque el endpoint la rechaza. Pero las dos mandan con el mismo token y a la misma
hora: **gana la última que llega** (ya estaba advertido en la guía, §"Si se muda de servidor"). El
día que alguien "arregle" el archivo de la máquina B sin apagar la A, el catálogo va a quedar
mandado por la que llegue segunda.

Lo único que hoy evitaría un desastre es el freno del 20 % de bajas — y un freno no es un plan.

### 🔧 Qué hay que hacer (del lado de ustedes)

1. **Decidir cuál de las dos máquinas queda** y correr `DESINSTALAR.bat` en la otra. Desde acá no las
   podemos distinguir: los envíos no llevan el nombre del equipo.
2. **Mandarnos el registro de la que falla**: `C:\DisTAt\registros\precios-2026-09-09.log`, o correr
   `REVISAR.bat` y pasarnos lo que muestre. Ese archivo guarda la respuesta del servidor, o sea el
   motivo exacto del rechazo — que del lado nuestro todavía no se guardaba (ver §5).

---

## 4. Dónde la estructura todavía no coincide

Medido sobre los 617 productos que hay hoy en la base.

| | Qué pasa | Medición |
|---|---|---|
| 🔴 | **El peso nunca llega** | **617 de 617** en `0.00`. La columna `peso` viene vacía en todos los envíos. Sin eso el reparto no puede calcular carga |
| 🔴 | **Sigue todo a nivel FARDO** | 263 productos con `unidad_venta = FDO` y 50 sin unidad. Las descripciones dicen `MANAOS 6X3LT COLA FDO` con `unidades = 1`. La especificación pide **precio por unidad suelta** (`UN`/`BOT`/`PACK`) desde la versión 2 |
| 🟠 | **Los rubros llegan a medias** | Ya no mandan códigos numéricos (eso se arregló), pero **316 de 617 productos vienen sin categoría**. Falta la tabla `01 = Almacén` |
| 🟠 | **Descripciones cortadas a 20 caracteres** | 112 productos en el borde. Se ve claro en las bajas del 08/09: cuatro `SUAVIZ BORITA 12X900` con códigos distintos (1517, 1518, 1520, 1521), todos cortados **antes** de la parte que los diferencia. ⚠️ **Esto no se arregla solo**: para no degradar los nombres que ya están completos, el endpoint no pisa descripciones. Las cortadas quedan cortadas hasta que se corrijan a mano o nos pidan pisarlas |
| 🟢 | **Escalones de precio: 1 de 617** | La función que hace que el comercio se lleve más está prácticamente sin datos |
| 🟢 | `destacado` y `nivel` | 0 de 617 |

### La pregunta que sigue abierta hace 12 días

**¿La lista a nivel unidad conserva los códigos?** De la respuesta dependen **355 fotos** ya
cargadas: si los códigos cambian, hay que reasociarlas una por una.

Es la misma pregunta del §3 de [REVISION_ARTIK.md](REVISION_ARTIK.md), y es la que más trabajo
destraba de todo lo que está en esta lista.

---

## 5. Lo que corregimos de nuestro lado

**Los rechazos no dejaban rastro en la base.** `ingestas_precios.error` daba 0 en las 139 filas — no
porque no hubiera errores, sino porque los rechazos se devolvían **antes** de la función que escribe
la bitácora. Los 6 fallos por hora de la máquina B solo existían en los registros de la CDN, que
caducan.

Corregido en `supabase/functions/ingest-precios/index.ts`: ahora cada rechazo escribe su fila con el
motivo. Los cinco caminos (`falta-encabezado`, `archivo-vacio`, `demasiadas-filas`, `sin-filas`,
`sin-filas-validas`) más el error de la RPC.

⏳ **Falta desplegarlo** — ver la nota en el HANDOFF.

También se corrigieron dos contradicciones de la especificación que podían hacer daño:

1. Decía que el envío automático estaba agendado a las **06:00, 11:00 y 16:00**. Es **cada hora**
   desde el 31/08.
2. 🔴 Decía *"sin `?lista_completa=1` el envío no da de baja nada"*. **Es al revés desde el
   01/09**: el endpoint trata el archivo como lista completa **por defecto**. Quien leyera esa
   sección creía que su envío no daba de baja nada — y sí da de baja.

---

## Resumen

| | Pregunta | Respuesta |
|---|---|---|
| ✅ | ¿Se instaló? | Sí, y funciona desde el 01/09 |
| ✅ | ¿Manda cada hora? | Sí, al minuto :00 |
| 🔴 | ¿Está en la PC correcta? | **Hay dos**, y una falla siempre. Hay que apagar una |
| 🟠 | ¿La estructura coincide? | **Parcialmente.** El formato sí; el contenido no: falta el peso, sigue a nivel fardo, faltan 316 rubros y hay 112 descripciones cortadas |
