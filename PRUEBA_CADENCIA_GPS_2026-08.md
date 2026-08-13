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
  del WebView, y Android aplica *UA reduction* (manda `K` en vez del modelo). Si queda null en todo
  el parque, la reducción está activa y el dato hay que sacarlo por el camino nativo
  (`Build.MODEL`/`Build.MANUFACTURER`) en el próximo APK. Sin modelo, la hipótesis "son todos
  Samsung A07" sigue sin poder probarse ni descartarse.
