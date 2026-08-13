# Prueba de cadencia fija de GPS — 13/08/2026

Bitácora de UNA prueba con UNA variable. Existe porque el repo ya perdió tres cambios de constante
de GPS por no tener esto: *"Tres cambios de constante de GPS en la historia del repo, tres teorías
plausibles e incompletas"* (`services/gpsConfig.js`). La diferencia entre "no funcionó" y "no llegó"
no se puede recuperar después.

**Qué se cambió:** nada global. Se agregó un perfil de GPS **por usuario** (`db/39`, bundle 1.14.0) y
se le puso `Intensivo · 5 s fijos` a cuatro personas. Todos los demás siguen exactamente igual.

---

## 1. La hipótesis

El cliente reportó que a Javier, Luis, Gabriel y Eduardo "se les muere el GPS": el contador de última
señal va `5s · 5s · 5s · 1 min · 7 min` y los trazos se pierden. Pidió forzarles GPS cada 5 s.

Medido antes de tocar nada, el síntoma mezcla **dos problemas distintos**:

1. **Gabriel y Eduardo están clavados en la cadencia lenta de 30 s** (`NEAR_LIVE_QUIETO_MS`). Activity
   Recognition los declara "quieto" y, caminando, nunca cruzan `VEL_UMBRAL_MPS` (3 m/s), así que
   jamás entran en la rápida. Y a 30 s **un fix perdido ya son 60 s de hueco** (regla 49). Acá el
   pedido del cliente da en el clavo.
2. **Javier y Luis ya corren a 4 s.** Su limitante es la precisión, no el temporizador.

Y "5 s" a secas no era la respuesta: `NEAR_LIVE_MS` ya vale 4.000 ms desde el 12/08. Lo que hace
falta no es bajar la cadencia sino **impedir que baje sola**.

---

## 2. Línea de base — 11, 12 y 13/08, solo jornada (07:00–20:00 local)

Excluye la noche a propósito: el hueco nocturno metía un "máximo" de 539 min que no dice nada.

| | pts/día | huecos > 60 s | % huecos | dt p50 | dt p90 | acc p50 | fixes < 5 m |
|---|---|---|---|---|---|---|---|
| **Gabriel tevez** | 735 | **193** | **8,8 %** | 32,4 s | 56,8 s | 17,4 m | **2 (0,1 %)** |
| **Eduardo ruiz** | 100 | 17 | 5,7 % | 23,1 s | 54,0 s | 18,1 m | 120 (40,1 %) |
| **Luis Mendoza** | 953 | 154 | 5,4 % | 27,5 s | 46,7 s | 17,2 m | 1.166 (40,8 %) |
| **Javier** | 1.077 | 145 | 4,5 % | 12,7 s | 40,0 s | 19,1 m | 298 (9,2 %) |
| *Orlando chavez* (control) | 2.488 | 21 | **0,3 %** | 5,0 s | 40,0 s | **1,6 m** | 6.626 (88,8 %) |
| *Agustin Vasquez* (control) | 2.628 | 14 | **0,2 %** | 5,0 s | 32,0 s | **1,6 m** | 7.331 (93,0 %) |
| Nelson rojas | 1.472 | 2 | 0,0 % | 31,4 s | 31,8 s | 20,1 m | **0 (0,0 %)** |

**Lo que ya se ve sin hacer nada**: los dos controles tienen entre 12 y 44 veces menos huecos y una
precisión mediana **diez veces mejor**, el mismo día y la misma ciudad. Gabriel tuvo 2 fixes de menos
de 5 m en 2.206; Nelson, cero en 4.417. Eso es hardware, y ninguna constante lo arregla.

`gps_intervalo_ms` que reportaba cada teléfono al cerrar la base: Gabriel 30.000 · Eduardo 30.000 ·
Nelson 30.000 · Luis 4.000 · Javier 4.000 · Agustin 4.000 · Orlando 2.000.

---

## 3. La variable que se movió (una sola)

`Intensivo · 5 s fijos` a **Javier, Luis Mendoza, Gabriel Tevez y Eduardo Ruiz**:

```json
{"modo":"intensivo","intervalo_s":5,"fijar_cadencia":true,"desde":"2026-08-13"}
```

Eso iguala `intervaloMs = intervaloRapidoMs = intervaloQuietoMs = 5000`, así que ni Activity
Recognition ni la velocidad pueden bajar la cadencia. Efecto secundario buscado: como
`aplicarCadencia` solo re-pide updates cuando la cadencia deseada difiere de la vigente, con las tres
iguales **`requestLocationUpdates` no se vuelve a llamar en toda la jornada** — el churn, sospechoso
número uno del fracaso de 1.8.1, desaparece.

**NO se tocó el umbral de movimiento**, y fue una decisión deliberada. La tentación era subírselo a
Gabriel (con precisión mediana de 17,4 m, el umbral de 9 m está *por debajo de su propio ruido*: cada
fix "se movió" aunque esté parado). Pero mover dos variables a la vez deja la medición ilegible, que
es exactamente cómo se perdieron las tres pruebas anteriores. **El umbral es el experimento
siguiente, si éste no alcanza.**

---

## 4. Predicción, escrita ANTES de mirar el resultado

Esto es lo que hace falsificable la prueba.

| | Predicción | Si se cumple | Si NO se cumple |
|---|---|---|---|
| **Gabriel, Eduardo** | Dejan de reportar 30.000 y pasan a 5.000. Los huecos > 60 s caen fuerte (8,8 % y 5,7 %). | El escalón de 30 s era la causa: queda puesto | Queda descartada la cadencia; el problema es el chip |
| **Javier, Luis** | **Poco cambio.** Ya corrían a 4 s; su limitante es la precisión | Hay algo que no vimos: volver a medir | Confirma hardware → la prueba decisiva es **cambiarles el teléfono con alguien sano por un día**, no otra constante |
| **Todos** | Los fixes < 5 m **no** suben. La cadencia no fabrica satélites | Esperado | Sorpresa, hay que investigar |

> ⚠️ **"Clavados en 30 s" es una afirmación sobre la MEDIANA DE 3 DÍAS, no sobre una foto.** Un
> `select` instantáneo de `gps_intervalo_ms` agarra a cualquiera en la cadencia lenta: el 13/08 a las
> 14:12 UTC, **Orlando —el mejor del parque— reportaba 30.000** y Agustin 2.000. Lo que los separa no
> es tocar los 30 s, es cuánto tiempo se quedan ahí: la mediana entre puntos guardados es de 32,4 s
> en Gabriel contra 5,0 s en Orlando.
> Y refuerza la predicción de esta misma tabla: **Orlando produce trazos perfectos incluso a 30 s**,
> porque su precisión mediana es 1,6 m. Un fix cada 30 s que cae donde tiene que caer vale más que
> uno cada 5 s con 20 m de error. Si la cadencia fija no alcanza, es esto lo que lo explica.
| **Controles** | Orlando y Agustin no cambian (no se les tocó nada) | Confirma que el cambio es acotado | Algo se publicó de más |

---

## 5. Cómo se mide

**Primero: ¿llegó?** Sin esto, "no funcionó" y "no llegó" se ven igual.

```sql
select p.nombre, p.gps_perfil, e.gps_intervalo_ms, e.app_version, e.modelo, e.telemetria_ts
from public.perfiles p join public.estado_dispositivo e on e.id_usuario = p.id
where p.gps_perfil is not null;
```

Tiene que decir `gps_intervalo_ms = 5000`. Si Gabriel sigue en 30.000, el override no aterrizó.

> ⚠️ **Un perfil nuevo NO se aplica en el mismo instante, y hay que saber por qué antes de declarar
> que falló.** El servicio nativo lee `K_INTERVALO` de prefs en tres momentos y en ninguno más:
> al ARRANCAR (`UploaderGpsService:824`), en la transición rápido→lento (`:407`, `:908`) y cuando
> Activity Recognition avisa "quieto" (`:413`). Si el servicio ya estaba corriendo cuando llegó el
> `configurar()`, sigue con la cadencia vieja hasta la primera de esas transiciones.
> Medido el 13/08: Gabriel pasó a 5.000 a los pocos minutos; Eduardo, cuyo servicio se levantó
> **antes** de que el JS empujara el perfil, seguía reportando 10.000 (el default del Java) un cuarto
> de hora después.
> **Para la medición de una jornada completa da igual**: desde 1.11.0 el servicio PAUSA y se reanuda
> en el borde de la ventana, y al reanudarse relee prefs — o sea que mañana todos arrancan en 5.000
> desde el primer minuto. Solo importa si se quiere ver el efecto el mismo día.

**Después: ¿sirvió?** La misma consulta que produjo la tabla del §2, corriendo sobre los días nuevos.
Métricas: **huecos > 60 s**, **dt p50**, **puntos/día**, **fixes < 5 m**.

⚠️ Al comparar personas, mirar `updated_at`/`telemetria_ts` de cada fila: los contadores son
acumulados del día y el latido JS se congela con el WebView (regla 18-bis).
⚠️ **No usar `fix_desc_movimiento`**: no son descartes sino *diferidos*, el mismo fix se cuenta dos
veces (H5 de `AUDITORIA_GPS_2026-08.md`).

---

## 🔴 6. Lo que puede invalidar la prueba

- **Eduardo Ruiz estaba en `app_version` 1.11.0** con `min_version` 1.13.0, o sea que **no venía
  tomando OTAs** mientras el resto estaba en 1.13.8/1.13.9. El perfil se le configuró igual, pero
  **no le va a llegar hasta que se le destrabe la actualización** (a mano, por cable o Tailscale —
  ver `INVENTARIO_TELEFONOS.md`). Si no se destraba, la prueba corre con **tres** personas, y su
  falta de mejora **no** cuenta como evidencia en contra.
- **El modelo del teléfono puede venir null.** `estado_dispositivo.modelo` se llena parseando la UA
  del WebView, y Android aplica *UA reduction* (manda `K` en vez del modelo). ✅ **Verificado el
  13/08: la reducción NO está activa** — los primeros dos teléfonos que tomaron 1.14.0 reportaron
  `SM-A075M` y `SM-A065M`. El dato sirve.

---

## 🩸 7. LA HIPÓTESIS DEL MODELO ESTÁ REFUTADA (13/08/2026)

El cliente sospechaba que los cuatro que fallan eran los Samsung A07. **No lo son**, y conviene
dejarlo escrito para que nadie vuelva a comprar hardware por esta teoría.

Cruzando `INVENTARIO_TELEFONOS.md` con la medición del §2:

| Modelo | Funcionan bien | Fallan |
|---|---|---|
| **A07** (`SM-A075M`) | **Orlando chavez** — el mejor del parque (0,3 % de huecos, acc 1,6 m) | Gabriel, Nelson, Javier, Zura, Alejandro |
| **A06** (`SM-A065M`) | **Agustin Vasquez** — el otro mejor (0,2 %, acc 1,6 m) | Luis Mendoza, Eduardo Ruiz |

**Cada familia tiene un teléfono impecable y varios malos.** El modelo no separa los dos grupos, así
que la diferencia no es el modelo — es el chip/antena de la unidad concreta, o algo de su
configuración que todavía no medimos. Confirmado con `ro.product.model` por adb sobre el equipo de
Eduardo (`SM-A065M`) y con la columna nueva sobre el de Gabriel (`SM-A075M`).

**Corolario:** la prueba decisiva sigue siendo **cruzar dos teléfonos entre personas por un día** —
si el problema viaja con el aparato es hardware, si se queda con la persona es la ruta o el uso.

---

## 8. Bitácora

**13/08/2026 11:05** — Eduardo Ruiz destrabado por Tailscale (`vendedor-6`, `100.94.191.76`).
Causa raíz medida, no supuesta: **`installerPackageName=null`**, así que Android le negaba
`USER_ACTION_NOT_REQUIRED` y *todo* intento de auto-actualización caía en un diálogo que nadie
tocaba. Se reinstaló el APK publicado (hash idéntico al build local) con `adb install -r -i
com.launion.app`, que además **gana el privilegio para la próxima**: `installerPackageName` quedó en
`com.launion.app`. Los tres permisos (`ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`,
`POST_NOTIFICATIONS`) y la exención de batería sobrevivieron al `-r`, y la sesión también: el
`UploaderGpsService` levantó en foreground sin pasar de nuevo por el gate de GPS.
Resultado inmediato: de **12,9 h sin latir** a `app_version 1.14.0` y **14 puntos en 10 minutos**.

**13/08/2026 11:0x** — Gabriel Tevez reporta `gps_intervalo_ms = 5000` (venía de 30.000): el perfil
de GPS viajó de punta a punta —panel → base → `getTrackConfig` → `configurar()` → SharedPreferences →
servicio nativo— en un teléfono real en la calle. **El criterio de aceptación del §5 se cumplió.**

---

## 🩸 9. RESULTADO PARCIAL DEL MISMO DÍA: LA CADENCIA NO ES LA PALANCA

Medido a las 14:2x UTC, con el perfil ya aplicado en Gabriel:

| | cadencia PEDIDA | segundos reales entre puntos GUARDADOS |
|---|---|---|
| **Gabriel** | **5.000** (perfil aplicado ✅) | **27,5 s** |
| Eduardo | 10.000 (perfil aún no aterrizó) | 31,0 s |
| Javier | 4.000 (perfil aún no aterrizó) | 36,1 s |
| Luis Mendoza | 30.000 (todavía en 1.13.9) | **13,3 s** |

**A Gabriel el perfil de 5 s le llegó y no cambió nada**: sus puntos siguen saliendo cada 27,5 s. Y
Luis, con la cadencia en 30 s —la más lenta del parque—, guarda cada 13,3 s, porque va en vehículo y
cada fix supera los 9 m.

Es la confirmación de lo que ya decía `gpsConfig.js` sobre `MIN_MOVE_M` y de la predicción del §4:
**pedir más seguido no densifica el trazo de quien camina.** Lo que gobierna es el filtro de
movimiento (9 m) y, cuando ése no salta, el latido de cortesía (`STATIONARY_KEEPALIVE_MS`, 30 s).

### Y de ahí sale el diagnóstico del "todo el trazo en puntos" de Gabriel

El cliente reportó que el recorrido de Gabriel se dibuja punteado y supuso que era la triangulación
borrándole trazo. **No es la triangulación**: ese día tuvo **0 puntos triangulados** y solo el 4,8 %
de sus fixes superó los 30 m. Medido sobre la jornada del 13/08 (10:00 UTC en adelante):

| | km del día | km dibujados punteados | dist. mediana entre puntos |
|---|---|---|---|
| **Gabriel** | 4,27 | **3,42 — el 80,1 %** | **1,6 m** |
| Orlando (control) | 20,08 | 0,01 — 0,1 % | 14,6 m |
| Agustin (control) | 41,78 | 0,05 — 0,1 % | 31,1 m |

Es **`HUECO_DUDOSO_MS`** (45 s, `lib/geo.js`, regla 49): el dibujo deja de afirmar el camino cuando
entre dos puntos pasa más de eso. Con los puntos de Gabriel a 32,5 s de mediana y **58,5 s en el
p90**, sus saltos más largos —los que llevan la distancia— caen todos del lado punteado.

Y su distancia mediana entre puntos es **1,6 m**: sus puntos no los dispara el movimiento, los
dispara el latido de 30 s. Camina, y el filtro de 9 m casi nunca salta.

**La distinción que importa, porque el cliente temía perder recorrido:**

- Los **3,42 km punteados NO se pierden**. Los km salen de `puntos`, no de la línea dibujada. Solo se
  deja de afirmar *por qué calle* fue — que es honesto: con 58 s entre puntos, la recta cruzaría
  manzanas por las que nadie pasó.
- Lo que **sí** queda afuera de los km y del snap son **0,94 km (el 22 %)**: los fixes peores que
  `ACCURACY_MAX_M`. Eso es pérdida real, y es la precisión del aparato (regla 40).

### Próxima palanca, identificada y DEFERIDA a propósito

Bajarle a Gabriel el latido de cortesía de 30 s a ~20 s pondría todos sus saltos por debajo del corte
de 45 s y le devolvería la línea llena. `keepAliveMs` **ya viaja al nativo**, así que es solo sumar
`keepalive_s` a la whitelist de `gpsPerfil.js` y un campo en el modal.

**Se decidió NO hacerlo todavía** (13/08): primero se mide la jornada completa de mañana con la
cadencia fija. Una variable por vez — que es la regla que este archivo existe para sostener.

---

## 🔴 10. LA PRUEBA CAMBIÓ DE FORMA ESA MISMA TARDE (13/08, 1.14.2)

⚠️ **Leer esto antes de interpretar los números de mañana**: a partir de 1.14.2 los cuatro NO están
en `intensivo` (solo cadencia) sino en **`simple`**, que apaga tres cosas a la vez —cadencia
adaptativa, distancia por modo y triangulación—. **Ya no se mide una variable, se mide un paquete.**
Se hace igual porque el cliente lo pidió explícitamente y porque la evidencia de abajo mostró que la
cadencia sola no alcanzaba; pero si mañana algo mejora, **no se va a poder atribuir a una causa**.

### El reporte del cliente, y qué mostró la medición

Reportó que el GPS se apaga sin internet, que Javier hizo dos tramos de ruta sin marcar nada, y que
al volver al pueblo **las ubicaciones se subían y se borraban** por superar una guarda de salto.

**La mitad del diagnóstico es correcta y la otra mitad no**, y la diferencia decide dónde buscar:

| | |
|---|---|
| Tramo de ida (09:02) | **28 min · 25,7 km · CERO puntos** |
| Tramo de vuelta (14:00) | **26 min · 21,1 km · CERO puntos** |
| `fix_desc_salto` del día | **0** — no se descartó ni un punto por salto |
| `cuarentena_nativa` / `cola_pendiente` | 0 / 1 — nada trabado, nada aislado |
| `gps_silencio_max_ms` | **62 minutos** |

**La prueba que lo cierra**: el latido de cortesía guarda un punto cada 30 s *aunque no haya
movimiento*. Si en esos 28 minutos hubiera llegado **un solo fix**, habría ~56 puntos. Hay cero.
Entonces no es que se capturó y se filtró: **el chip no entregó nada**. Es un problema de CAPTURA, y
**ningún cambio de filtro, de guarda ni de dibujo lo va a recuperar**.

Y la cola ya hacía lo que se pedía restaurar: el uploader nativo encola en el teléfono y sube al
recuperar red desde 1.8.0 — por eso `cola_pendiente` es 1 y no 3.000.

### Lo que SÍ era cierto del reporte

La triangulación le metió a Javier **16 puntos de ~100 m de precisión** ese día. Valen para "por acá
anduvo" y para nada más, y son los que pican el trazo en tramos punteados sueltos. Por eso `simple`
la apaga.

### 🔴 Lo que queda ABIERTO y es lo importante

**Por qué el chip deja de entregar en la ruta.** Hipótesis a distinguir, ninguna medida todavía:

1. **A-GPS sin datos**: sin internet el teléfono no refresca las efemérides, y recuperar lock a
   50 km/h sin asistencia puede tardar minutos. Encaja con que falle *en ruta* y ande *en el pueblo*.
2. **El servicio muere o se congela** en el trayecto (Doze, OEM killer) y revive al llegar. Se
   distingue mirando si `fix_total` avanzó durante el hueco.
3. **Pérdida de lock por velocidad/geometría** en un chip que ya es malo (Javier: 174 fixes sub-5 m
   en 2.353).

La forma de separarlas es `logcat` sobre el teléfono durante un viaje real, o comparar `fix_total`
antes y después del tramo. **No se resuelve con constantes.**
