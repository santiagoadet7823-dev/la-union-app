# Auditoría del monitoreo GPS — LA UNIÓN

**Fecha:** 12/08/2026 · **Corte (`t0` del freeze):** 17:08:54 ART
**Alcance:** los 10 teléfonos activos de la empresa `645aa685-…`
**Datos:** 64.183 posiciones (05→12/08, todo lo que retiene `posiciones`) + `recorridos_snap` desde el 07/07 + telemetría de `estado_dispositivo` + el código de los cuatro runtimes.
**Encargo:** diagnóstico y plan de arreglo. No se implementaron cambios salvo el despliegue de ALGO 11, que era condición para poder medir (ver §6.1).

---

## 1. Veredicto

Los tres síntomas reportados —se pierden ubicaciones, hay teléfonos que no mandan, hay saltos ilógicos— son **tres fallas distintas con tres causas distintas**. Ninguna de las tres es la que se sospechaba.

| # | Síntoma del cliente | Causa real | Estado |
|---|---|---|---|
| **1** | "Se pierden ubicaciones" | El **snap borraba días enteros**. Los puntos siempre estuvieron en la base. | 🟢 Arreglado hoy (ALGO 11 + red de contención) |
| **2** | "Hay teléfonos que no mandan" | **Tres teléfonos tienen el GNSS muerto** y uno se degradó. No es software. | 🔴 Abierto — es hardware/configuración |
| **3** | "Saltos ilógicos" | **42 de 44 son rectas dibujadas sobre silencios**, no errores de GPS. | 🟡 El mecanismo honesto existe desde 1.13.1 |

Y una falla transversal que impide gestionar cualquiera de las tres:

| **4** | El panel dice quién no reporta, y **miente**: el latido lo escribe el JS y las posiciones las sube el servicio nativo. Nelson figura sin reportar desde el 11/08 y subió 1.619 puntos hoy. | 🔴 Abierto |

---

## 2. La hipótesis de partida: qué se confirma y qué no

> *"Estimo que al agregar la triangulación se rompió con el pegado a calles."*

**El acoplamiento que intuiste existe y es real, pero la triangulación no es el que lo dispara.**

Lo que es cierto: hay una cadena que va de la precisión al borrado del recorrido, y termina en el pegado a calles.

1. Entran puntos imprecisos (15-25 m).
2. El snap los aparta en la puerta (`soloGps`, `ACC_GPS_MAX = 30`).
3. El segmento queda con pocos puntos y `isStationary` lo da por quieto (mediana al centro < 40 m — con 20 m de error, caminar dos cuadras lo cumple).
4. Hasta ALGO 10 eso era un `continue`: **el tramo no se devolvía**, y como el front usaba solo la geometría pegada, el día desaparecía del mapa.

Lo que **no** es cierto: que esos puntos vengan del carril de triangulación.

El carril de red (`SILENCIO_MS`, `NETWORK_PROVIDER`) aporta **entre 0 y 50 puntos por día y por teléfono** — Orlando 0, Agustin 0, Luis 0, Alejandro 0, Javier 4, Nelson 9, Gabriel 20-50. Contra jornadas de 1.500 a 3.500 puntos, es ruido estadístico.

**Los puntos imprecisos vienen de FusedLocation**, que devuelve posiciones derivadas de antenas y WiFi sin decirlo. Y la app no las puede distinguir, porque su única marca es la `accuracy`: un fused de 20 m pasa el techo de confianza de 30, y entonces **se dibuja como línea llena, suma kilómetros y entra al snap** como si fuera GPS.

> La triangulación explícita es un chivo expiatorio. El problema es que **20 metros de ubicación por antena se están tratando como GPS**.

---

## 3. Hallazgos

### 🔴 H1 — El snap borraba recorridos enteros

**Síntoma:** el vendedor trabajó, sus puntos están en la base, y el mapa muestra el día vacío o partido.

**Mecanismo:** `snap-recorridos/index.ts`, en el `for` de segmentos, tenía un `continue` cuando `isStationary(seg)` daba verdadero. `trazos.js:182-188` hace `lineas = usable ? segs : crudo` — la geometría pegada **reemplaza** a la cruda, no la complementa. Todo lo que la Edge Function no devolviera desaparecía.

**Evidencia:** 46 filas de `recorridos_snap` con `geometria` literalmente `[]` declarando **11.358 puntos procesados**. Medido sobre el 12/08 antes del arreglo:

| Persona | Metros que desaparecían | % de su día | Mejor fix del día |
|---|---|---|---|
| Nelson rojas | 6.446 m | **100 %** | 15,7 m |
| Luis Mendoza | 5.230 m | 62 % | 1,1 m |
| Gabriel tevez | 1.591 m | 18 % | 5,8 m |
| Orlando · Agustin | 0 m | 0 % | 0,8 m |

**La correlación es con el ruido del fix, no con la persona ni con la versión.**

**Introducido:** el `continue` existe desde que existe `isStationary`. Las filas vacías arrancan el **07/07/2026** y aparecen con **todos** los algoritmos (2, 3, 6, 7, 10) — o sea que **es anterior a la triangulación (1.9.0, 03/08) y anterior a los dos techos de precisión (1.13.3, 11/08)**. Lo que cambió no fue el código: fue que más teléfonos empezaron a entregar fixes ruidosos, y eso hizo aflorar un defecto que estaba desde julio.

**Estado: arreglado y verificado en producción hoy.** Ver §6.1.

---

### 🔴 H2 — Tres teléfonos tienen el GNSS muerto, y uno se degradó

**Síntoma:** "hay celulares que no están enviando bien".

**Mecanismo:** ninguno de software. El discriminador limpio es **el mejor fix del día** y **el porcentaje de fixes por debajo de 5 m**: un techo de precisión puede filtrar los fixes malos, pero **no puede empeorar el mínimo**. Si un teléfono nunca produce un fix sub-5 m en toda una jornada, su GNSS no está haciendo posicionamiento satelital — lo está ubicando la red.

**Evidencia** (% de fixes ≤ 5 m, por teléfono y día):

| Persona | 05/08 | 07/08 | 08/08 | 10/08 | 11/08 | 12/08 | Mejor fix |
|---|---|---|---|---|---|---|---|
| Orlando chavez | 92,8 | 88,3 | 99,1 | 19,8 | 89,5 | **94,4** | 0,8 m |
| Agustin Vasquez | 66,1 | 77,7 | 71,8 | 90,4 | 77,1 | **98,2** | 0,8 m |
| Luis Mendoza | 78,0 | — | 2,9 | 1,1 | 20,3 | **55,6** | 1,1 m |
| Javier | — | — | 5,5 | 6,9 | 8,6 | **9,1** | 0,8 m |
| **Nelson rojas** | — | **82,7** | 0,0 | 0,5 | **0,0** | **0,0** | **15,7 m** |
| **Gabriel tevez** | — | 0,0 | 0,0 | 0,1 | 0,1 | **0,0** | 5,8 m |
| **Alejandro mercado** | — | — | 0,0 | 0,0 | 0,0 | — | **9,6 m** |
| **Zura** | — | 0,0 | 0,0 | 0,0 | 0,0 | — | **10,3 m** |

Tres lecturas:

1. **Zura, Alejandro y Gabriel no produjeron UN SOLO fix sub-5 m en toda la ventana de retención.** Miles de puntos, cero. Eso no es clima ni estar bajo techo: es un GNSS que no engancha satélites.
2. **Nelson es la prueba de la degradación.** El 07/08 tenía 82,7 % de fixes excelentes y un mejor fix de 1,4 m. El 11 y el 12/08 tiene **0,0 % y su mejor fix del día entero es 16 m**. El mismo aparato, el mismo software. Se rompió algo en el teléfono entre el 07 y el 08/08.
3. **Luis es el control que cierra el argumento.** Cayó a 1,1 % el 10/08 y **se recuperó solo** a 55,6 % el 12/08, sin que nadie tocara nada. La variación es por dispositivo y en el tiempo, **independiente de la versión**.

**Conclusión:** este síntoma no tiene arreglo en el código. Cuatro equipos necesitan intervención física.

---

### 🟡 H3 — Los saltos ilógicos son el dibujo, no el GPS

**Síntoma:** "hay saltos ilógicos".

**Evidencia:** clasificados los 44 saltos de más de 2 km dentro de un mismo día:

| Clase | Cantidad | Km dibujados | Salto máximo |
|---|---|---|---|
| **a) Recta sobre un silencio de más de 45 s** | **42** | **833,3 km** | 59.346 m |
| c) Punto fuera de orden (cola que drenó tarde) | 1 | 44,3 km | 44.266 m |
| d) Teleport imposible del chip (> 162 km/h) | 1 | 2,2 km | 2.192 m |

**El 95 % de los saltos, y el 94,7 % de los kilómetros involucrados, son el trazo afirmando un camino donde no hubo observación.** Las velocidades implícitas son plausibles (Javier: 46 km en 34 min = 81 km/h): la persona sí hizo ese trayecto, pero el teléfono no lo reportó y el mapa dibujó la cuerda.

**El mecanismo honesto ya existe**: `HUECO_DUDOSO_MS` (45 s) en `lib/geo.js:219` parte el dibujo y lo reemplaza por un conector punteado, desde 1.13.1 (10/08). **Pero quien decide es el bundle del dispositivo que MIRA el mapa, no el del teléfono rastreado.** Un supervisor en 1.11.0 los sigue viendo como línea llena.

---

### 🔴 H4 — El diagnóstico miente: dos relojes, dos caminos

**Síntoma:** el panel dice que alguien no reporta cuando sí está reportando, y los avisos al supervisor no son confiables.

**Mecanismo:** `estado_dispositivo` lo escribe el **latido del JS**, que se congela con el WebView en Doze. Las posiciones las sube el **servicio nativo**, que sobrevive. Los dos caminos son independientes.

**Evidencia:** Nelson figura con último latido el **11/08 00:51** y último fix el **10/08 23:00** — y tiene **1.619 posiciones del 12/08**. Alejandro, igual: latido del 11/08, sin novedad desde entonces.

**Corolario grave, y es nuevo:** el auto-updater de OTA también es JS. **Los teléfonos con el WebView congelado no pueden recibir el arreglo** — quedan clavados en la versión que tenían. Por eso Nelson sigue en 1.13.0 y Alejandro en 1.13.1 mientras el resto llegó a 1.13.8. *Los equipos que más necesitan el arreglo son estructuralmente los que no lo pueden bajar.*

**Y los avisos no explican nada:** de 195 alertas en `alertas_equipo`, prácticamente ninguna tiene `motivo`. El teléfono nunca dice por qué se calló.

---

### 🟠 H5 — La telemetría de descartes cuenta dos veces

**Mecanismo:** en `UploaderGpsService.java`, un fix que no supera el filtro de movimiento suma `cDescMovimiento++` y se guarda como `fixRetenido` (`:749-750`). Cuando llega un fix que sí se movió, **ese mismo fix retenido** se encola y suma `cGuardados++` (`:759-762`). Se cuenta en los dos baldes.

**Evidencia:** la suma de destinos supera el total de fixes en **todos** los equipos.

| Persona | `fix_total` | guardados + descartes | Exceso |
|---|---|---|---|
| Agustin Vasquez | 4.642 | 5.234 | +592 (12,8 %) |
| Javier | 1.110 | 1.248 | +138 (12,4 %) |
| Orlando chavez | 1.292 | 1.395 | +103 (8,0 %) |
| Gabriel tevez | 2.074 | 2.157 | +83 (4,0 %) |
| Nelson · Alejandro | 1.739 · 1.452 | 1.799 · 1.512 | +60 cada uno |

**Consecuencia:** `fix_guardados` es correcto (son los puntos encolados), pero **`fix_desc_movimiento` no significa "descartados" sino "diferidos"**, y sobreestima. Cualquier porcentaje de descarte por movimiento citado en la bitácora está inflado. *(La decisión de 1.13.3 no queda invalidada: el balde dominante de Alejandro era `desc_precision` (960), que este defecto no toca.)*

---

### ✅ H6 — Cuentas duplicadas partiendo recorridos — **RESUELTO el 12/08**

El 08/08 subieron puntos **dos perfiles del mismo teléfono**: "Orlando chavez" (719) y "Orlando Chavez" (2.317); "Agustin Vasquez" (344) y "Agustin Vazquez" (2.276). El recorrido queda partido en dos y cada mitad se ve incompleta.

**No eran el mismo correo en dos teléfonos**, que era la sospecha: eran **dos cuentas distintas por persona**. Las viejas usaban el correo **personal** del empleado; las nuevas son corporativas (`launionvendedorN@gmail.com` / `launionencargadoN@`), todas creadas el **07/08** — el día del recambio de cuentas del parque. Durante un día convivieron las dos y las dos escribieron.

**Limpieza ejecutada el 12/08** (criterio: se conserva solo lo que tiene "launion" en el correo, más el superadmin):

| Eliminadas | Correo personal | Posiciones borradas |
|---|---|---|
| Orlando Chavez | olysjvgsalta2@ | 8.404 |
| Agustin Vazquez | agusthin414@ | 8.292 |
| Emanuel Arias | manu.ramadamm@ | 7.026 |
| Luis Mendoza | lm8591344@ | 159 |
| Gabriel Tevez | tevezgabrielmaximiliano@ | 64 |
| Jose Zura · Nelson I. Rojas · Gilberto Holt · Mauricio Rodriguez · Oscar Mercado | — | 0 |

Total: **10 perfiles, 10 logins, 23.945 posiciones, 88 filas de snap, 4 visitas**. `posiciones` bajó de 64.183 a 40.866 filas. Quedan 11 perfiles, sin huérfanos en ninguna tabla.

> ⚠️ **Con esto se perdió el historial crudo del 05→08/08 de esas cinco personas** — decidido explícitamente por el cliente sabiendo que es irreversible (`posiciones` no tiene policy de DELETE ni backup). **Las mediciones de este informe se tomaron antes del borrado y siguen siendo válidas; los puntos que las sustentan ya no se pueden volver a consultar.** Lo que queda de esos días son las filas de `recorridos_snap` de las cuentas nuevas.
>
> 🩸 Y queda la lección de esquema: **`posiciones.id_usuario` es `NO ACTION`**, así que borrar a una persona exige borrar antes su recorrido. No hay forma de dar de baja a alguien conservando su historial salvo dejando el perfil inactivo.

---

### 🟡 H7 — Los espejos de constantes están alineados, con una excepción

Verificado contra el código y contra la base viva:

| Constante | Bundle | Deno | SQL | Java | ¿Alineado? |
|---|---|---|---|---|---|
| Techo de confianza (30) | `gpsConfig.js:147` | `segmentar.ts:76` | `metricas_actividad`, `vigilancia_equipo`, `ultimas_posiciones` | `UploaderGpsService.java:229` | ✅ |
| Hueco dudoso / ciego (45 s) | `geo.js:219` | `segmentar.ts:109` | — | — | ✅ |
| Hueco duro (4 min) | `geo.js:164` | `segmentar.ts:16` | — | — | ✅ |
| Radio de parada (40 m) | `dwell.js:52` | `segmentar.ts:17` | — | — | ✅ |

**Excepción:** `ultimas_posiciones_compartidas` **no filtra `accuracy`** (las otras tres RPC sí). Hoy no muerde —`ubicaciones_compartidas` tiene 0 filas— pero rompe la regla 40 en cuanto se use.

---

### 🟠 H8 — Riesgos verificados pero todavía sin morder

- **`cola.remove(0)` (`UploaderGpsService.java:1005`)**: al pasar `MAX_COLA = 5000` descarta los puntos más viejos **sin cuarentena y sin telemetría** — la única violación estructural de la regla 20 que queda viva. No hay evidencia de que haya disparado (`cola_pendiente` está en 0 o 1 en todos los equipos), pero con la cadencia en 4 s la cola se llena mucho más rápido que cuando se fijó ese techo.
- **Defaults de Java ≠ producción**: `intervalo 15 s`, `minMove 12 m`, `keepAlive 60 s`, `minMoveRuta 100 m`, `silencio 90 s`. Si el servicio arranca desde `BootReceiver`/`AlarmReceiver` antes del primer `configurar()`, corre con umbrales viejos y token válido.
- **`MAX_RUTEOS = 40`** puede truncar el snap en silencio; viaja en `crudos.presupuesto` y **nadie lo mira en la UI**.

---

## 4. Línea de tiempo: cuándo estaba bien y cuándo se rompió

⚠️ **`posiciones` solo retiene 8 días.** Todo lo anterior al 05/08 se reconstruyó desde `recorridos_snap` (que llega al 07/07) y desde los comentarios fechados del repo. Es evidencia indirecta y está marcada como tal.

| Versión | Fecha | Qué entró | Efecto medible |
|---|---|---|---|
| — | 08/07 | Nace el pegado a calles | Filas vacías de snap **desde el 07/07** (indirecto) |
| 1.5.44 | 24/07 | Nace el uploader GPS nativo | — |
| 1.6.9 | 29/07 | Nace `limpiarTrazo` (filtro de teleports) | 524,8 km falsos → 17,9 reales |
| 1.8.1 | 03/08 | ALGO 8: un motor OSRM por modo | — |
| **1.9.0** | **03/08** | **Nace la triangulación** + guarda de tramo a ciegas | Aporta 0-50 puntos/día: **no es la causa de nada de esto** |
| 1.12.1 | 08/08 | Se arregla `accuracy` que se tiraba en el front | La regla 40 empieza a existir de verdad |
| 1.13.0 | 10/08 | El ancla deja de perseguir al ruido (APK) | — |
| 1.13.1 | 10/08 | `HUECO_DUDOSO_MS` parte el dibujo a los 45 s | Es lo que vuelve honestos los saltos de H3 |
| **1.13.3** | **11/08** | **Techo de captura a 120 m** | Aparecen los puntos > 30 m: Javier pasa de 2,5 % a **50,5 %** de fixes desconfiados |
| 1.13.6 | 12/08 | Cuatro umbrales de GPS a la vez | Experimento declarado, sin resultado concluyente |
| 1.13.8 | 12/08 | `cubreElRecorrido` (red de contención del front) | Publicado |
| **ALGO 11** | **12/08 17:09** | **Quieto → dibujar crudo, no descartar** | **0 filas vacías** (ver §6.1) |

**Respuesta directa a "en qué versión estaba todo ok":** en ninguna. El defecto que borra recorridos (H1) está presente desde julio, en todas las versiones del algoritmo. Lo que cambió en agosto no fue el código sino **el parque**: entre el 07 y el 08/08 varios teléfonos dejaron de conseguir fixes satelitales, y eso activó un defecto latente. La tanda 1.13.x no lo causó — lo reveló, y en 1.13.8 + ALGO 11 lo corrigió.

---

## 5. Plan de arreglo priorizado

### Requiere intervención física (no hay arreglo por software)

| # | Acción | Por qué |
|---|---|---|
| **P1** | Revisar **Nelson, Zura, Alejandro y Gabriel** en la mano: ajustes de ubicación en "alta precisión", `location_mode=3`, prueba a cielo abierto, y `dumpsys location` para ver si el GNSS entrega. Si no engancha, **cambiar el equipo**. | H2. Cero fixes sub-5 m en toda la ventana. Ningún umbral arregla un chip que no posiciona. |
| **P2** | Confirmar si **Eduardo y Zura** (1.11.0, sin latido desde el 08/08) son equipos vivos o bajas. | No se pueden actualizar en remoto. |

### Sale por OTA (sin APK nuevo)

| # | Acción | Por qué |
|---|---|---|
| ✅ **P3** | **HECHO el 12/08.** "Reportando" sale de la posición más nueva, no del latido. RPC nueva `ultimo_punto_equipo` (`db/36`) + `useDiagnosticoEquipo`. | H4. Verificado en pantalla: ver §6.3. |
| **P4** | Mostrar en la UI el desglose de `crudos` y `truncados` que el snap ya devuelve en `_meta`. | H8. Un tope silencioso se lee como "salió todo bien". |
| ✅ **P5** | **HECHO el 12/08** (`db/35`): `ultimas_posiciones_compartidas` filtra `accuracy`, como las otras tres RPC. ACL verificado con `proacl` real. | H7. |
| ✅ **P6** | **HECHO el 12/08.** 10 perfiles + 10 logins eliminados. | H6. |

### Requiere APK nuevo

| # | Acción | Por qué |
|---|---|---|
| **P7** | **Dejar de contar dos veces el fix retenido**: no sumar `cDescMovimiento` cuando el fix se retiene, o descontarlo al encolarlo. | H5. Sin esto, ninguna métrica de descarte es confiable. |
| **P8** | `cola.remove(0)` → **cuarentena**, con telemetría del desborde. | H8, regla 20. |
| **P9** | Alinear los defaults de Java con los valores de producción. | H8. |
| **P10** | Un camino de actualización que **no dependa del WebView** (el watchdog nativo ya despierta; que además dispare la descarga). | H4. Es lo que rompe el círculo de "el que necesita el arreglo no lo puede bajar". |

### No hacer

- **No tocar los umbrales de GPS.** Cuatro se movieron el 12/08 sin resultado concluyente, y la bitácora ya registra tres teorías plausibles e incompletas. El problema medido es de hardware (H2) y de dibujo (H1, H3), no de calibración.
- **No bajar `ACCURACY_MAX_M`** (regla 18): vaciaría los recorridos de los cuatro equipos ruidosos.

---

## 6. Verificación

### 6.1 ✅ Verificado en producción (medición antes/después, con datos reales)

**ALGO 11 desplegado** (`snap-recorridos` v16, `verify_jwt: true`) a las 17:09 ART.

- Arranque correcto: con JWT válido llega al código de la función (`{"error":"no-auth"}`); sin header lo frena el gateway. El grafo de módulos carga y `segmentar.ts` resuelve.
- **Recálculo real a las 17:10:03**, disparado por el uso normal de la app:

| Persona | Antes (ALGO 10) | Después (ALGO 11) |
|---|---|---|
| **Nelson rojas** | `[]` — **2 bytes, día borrado** | **207 bytes** |
| Todo el 12/08 | 5 filas ALGO 10, **1 vacía** | 6 filas ALGO 11, **0 vacías** |

**El borrado total se terminó.** Pero con una salvedad honesta: Nelson tiene 570 puntos y **207 bytes** de geometría contra los 16.443 de Orlando. El snap sigue devolviendo casi nada para los teléfonos ruidosos — lo que salva su recorrido en el mapa es la red de contención del front (`cubreElRecorrido`), que detecta que lo pegado cubre menos del 75 % del crudo y dibuja el crudo. **Es la red la que está trabajando, no el snap.**

### 6.3 ✅ P3 verificado en pantalla (PWA, sesión de superadmin, 12/08 ~20:45)

`SupervisionDesktop` → Estado del equipo, leído del DOM tras una carga limpia:

| Persona | Antes (latido JS) | Ahora (posición) |
|---|---|---|
| **Nelson rojas** | **"Sin actividad hoy"** (latido del 11/08 00:51) | **"OK · 2º plano confirmado · hace 44s"** |
| Luis · Gabriel · Javier · Orlando · Agustin | mezcla de estados por latidos de 1,5 a 5,5 h | OK, con la antigüedad real del último punto |
| Alejandro · Zura | — | "Sin actividad hoy" (correcto: no mandaron un punto hoy) |

Sin `ErrorBoundary`, 9 filas renderizadas, mapa con sus tiles y marcadores. Build en verde.

🩸 **Y el DOM atajó un bug que el build no vio**: entre las dos ediciones quedó un
`ReferenceError: bgConfirmado is not defined` que el HMR sirvió y el `ErrorBoundary` tapó. `npm run
build` daba EXIT=0 igual. Es la regla de siempre — **verificar el DOM, no el build**.

⚠️ `sin-gps-confiable` **no** alcanzaba para marcar a la población de H2: esos equipos se ubican a
15-25 m y eso **pasa** el techo de 30. Se cerró con un estado más (ver abajo).

### 6.4 ✅ H2 ahora se detecta solo — `gps-no-engancha` (`db/37`)

La vara que separa un chip muerto de uno sano **no es la precisión sino cuántas veces consigue un
fix de GPS real**. Medido sobre el 12/08, % de fixes ≤ 5 m:

| Nelson | Gabriel | Javier | Luis | Orlando | Agustin |
|---|---|---|---|---|---|
| **0,0 %** (2.118 pts) | **0,0 %** (1.025) | 7,8 % | 56,4 % | 91,2 % | 98,4 % |

Salto limpio entre 0,0 y 7,8, así que la condición es **exactamente cero en 200+ puntos** y no un
porcentaje elegido a dedo.

🩸 **Y no sirve `min(accuracy)` con un umbral, que fue el primer intento y falló en la verificación**:
Gabriel tiene su mejor fix en **5,8 m** —por debajo de cualquier corte razonable— y aun así tiene
**cero** fixes buenos en mil puntos. El mínimo lo salva un único fix afortunado; el conteo no.

Verificado en pantalla: Nelson y Gabriel muestran *"El GPS no engancha: en 2.118 puntos no bajó ni
una vez de 5 m"*; Javier, Orlando y Agustin siguen en OK.

> **Javier no entra acá, y la distinción importa.** Su GNSS **sí** engancha (mejor fix 1,3 m) pero
> se le apaga: 7,8 % de fixes buenos, **9 huecos de más de 10 minutos y uno de 37,8**. Es el caso
> `ProviderRequest[OFF]`, y el sospechoso es el solapamiento de sensores (§5 P10) — no el chip.

### 6.2 Pendiente de verificar

- **Confirmar visualmente el mapa.** Abrir `SupervisionDesktop` en la PWA sobre el día de Nelson y confirmar que el recorrido se dibuja. *Requiere que vos loguees la sesión de superadmin — no puedo escribir credenciales.*
- **Las filas vacías del pasado se curan al mirarlas**, no solas: `ALGO = 11` invalida el cache, pero la fila se recalcula recién cuando alguien abre ese día. Quedan **46 filas** entre el 07/07 y el 11/08 esperando una visita.
- **La invariante "cada fix tiene destino conocido" no se puede verificar hoy** — y no por falta de datos: los contadores están definidos de forma que no puede cerrar (H5). Se verifica después de P7.

---

## 7. Lo que quedó abierto

1. **Por qué el GNSS de esos cuatro equipos no engancha.** Se puede afirmar que no entrega fixes satelitales; no se puede decir si es antena, ajuste, funda, ubicación en el vehículo o el modelo. Necesita los teléfonos en la mano.
2. **El solapamiento de sensores JS/nativo** (dos `LocationRequest` a la vez) sigue siendo la sospecha principal del silencio de Javier. Se comprueba con `dumpsys location` en un equipo real; el emulador no sirve para esto.
3. **El punto fuera de orden con −5.665 de desfase** (Orlando, 08/08) se explicó como cola que drenó tarde, pero no se verificó si el backfill de `useRecorridosDelDia` lo recupera siempre.
4. **Tres formatos de geometría conviven** en `recorridos_snap` (`[]`, `[[[lat,lng]]]`, `[{"f":…}]`). El código descarta los viejos por `algo`, así que no rompe — pero nadie los migró.
